package middleware

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type gzipResponseWriter struct {
	http.ResponseWriter
	Writer io.Writer
}

func (w gzipResponseWriter) Write(b []byte) (int, error) {
	return w.Writer.Write(b)
}

func GzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}

		if strings.HasPrefix(r.URL.Path, "/api/proxy") || strings.HasPrefix(r.URL.Path, "/api/stream") {
			next.ServeHTTP(w, r)
			return
		}

		w.Header().Set("Content-Encoding", "gzip")
		gz := gzip.NewWriter(w)
		defer gz.Close()

		gzw := gzipResponseWriter{Writer: gz, ResponseWriter: w}
		next.ServeHTTP(gzw, r)
	})
}

type ErrorMetrics struct {
	Total        uint64 `json:"total"`
	RateLimits   uint64 `json:"rateLimits"`
	NotFounds    uint64 `json:"notFounds"`
	Internal     uint64 `json:"internal"`
	DonorBans    uint64 `json:"donorBans"`
}

type CategoryMetrics struct {
	Movies uint64 `json:"movies"`
	Series uint64 `json:"series"`
	Radio  uint64 `json:"radio"`
	TV     uint64 `json:"tv"`
}

type DonorMetrics struct {
	LiftwRequests uint64 `json:"liftwRequests"`
	LiftwFails    uint64 `json:"liftwFails"`
	GoRequests    uint64 `json:"goRequests"`
	GoFails       uint64 `json:"goFails"`
}

type RecentError struct {
	Timestamp string `json:"timestamp"`
	Path      string `json:"path"`
	Status    int    `json:"status"`
	Message   string `json:"message"`
}

type ServerMetrics struct {
	StartTime          int64           `json:"startTime"`
	TotalRequests      uint64          `json:"totalRequests"`
	SuccessfulRequests uint64          `json:"successfulRequests"`
	UniqueIPs          uint64          `json:"uniqueIPs"`
	Categories         CategoryMetrics `json:"categories"`
	Donors             DonorMetrics    `json:"donors"`
	Errors             ErrorMetrics    `json:"errors"`
	RecentErrors       []RecentError   `json:"recentErrors"`
}

var (
	GlobalMetrics = ServerMetrics{
		StartTime:    time.Now().UnixMilli(),
		RecentErrors: make([]RecentError, 0),
	}
	metricsMutex  sync.Mutex
	uniqueIPStore sync.Map
)

// Allowed origins for CORS
var defaultOrigins = []string{
	"https://web.telegram.org",
	"https://media-box.xyz",
	"https://www.media-box.xyz",
	"https://moviemaniak5555.xyz",
}

func isOriginAllowed(origin string) bool {
	if origin == "" {
		return true
	}

	envOrigins := os.Getenv("ALLOWED_ORIGINS")
	if envOrigins != "" {
		for _, o := range strings.Split(envOrigins, ",") {
			if strings.TrimSpace(o) == origin {
				return true
			}
		}
	}

	for _, o := range defaultOrigins {
		if o == origin {
			return true
		}
	}

	if strings.Contains(origin, "localhost") || strings.Contains(origin, "127.0.0.1") {
		return true
	}

	return false
}

// Global CORS Middleware
func CORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		} else {
			w.Header().Set("Access-Control-Allow-Origin", "*")
		}

		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Range, Origin, Accept")
		w.Header().Set("Access-Control-Expose-Headers", "Content-Length, Content-Range")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// Request Metrics Middleware
type statusResponseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (lrw *statusResponseWriter) WriteHeader(code int) {
	lrw.statusCode = code
	lrw.ResponseWriter.WriteHeader(code)
}

func RecordRecentError(path string, status int, msg string) {
	metricsMutex.Lock()
	defer metricsMutex.Unlock()

	errEntry := RecentError{
		Timestamp: time.Now().Format("15:04:05"),
		Path:      path,
		Status:    status,
		Message:   msg,
	}

	GlobalMetrics.RecentErrors = append(GlobalMetrics.RecentErrors, errEntry)
	if len(GlobalMetrics.RecentErrors) > 5 {
		GlobalMetrics.RecentErrors = GlobalMetrics.RecentErrors[len(GlobalMetrics.RecentErrors)-5:]
	}
}

func MetricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddUint64(&GlobalMetrics.TotalRequests, 1)

		// Unique IP tracking
		ip := getClientIP(r)
		if _, loaded := uniqueIPStore.LoadOrStore(ip, true); !loaded {
			atomic.AddUint64(&GlobalMetrics.UniqueIPs, 1)
		}

		// Category tracking
		path := r.URL.Path
		if strings.Contains(path, "/discover/movie") || strings.Contains(path, "/api/movie") {
			atomic.AddUint64(&GlobalMetrics.Categories.Movies, 1)
		} else if strings.Contains(path, "/discover/tv") || strings.Contains(path, "/api/series") {
			atomic.AddUint64(&GlobalMetrics.Categories.Series, 1)
		} else if strings.Contains(path, "/api/radio") {
			atomic.AddUint64(&GlobalMetrics.Categories.Radio, 1)
		} else if strings.Contains(path, "/api/tv") {
			atomic.AddUint64(&GlobalMetrics.Categories.TV, 1)
		}

		// Donor tracking
		if strings.Contains(path, "/api/liftw") {
			atomic.AddUint64(&GlobalMetrics.Donors.LiftwRequests, 1)
		} else if strings.Contains(path, "/api/stream") {
			atomic.AddUint64(&GlobalMetrics.Donors.GoRequests, 1)
		}

		lrw := &statusResponseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(lrw, r)

		code := lrw.statusCode
		if code == 200 || code == 304 || code == 206 {
			atomic.AddUint64(&GlobalMetrics.SuccessfulRequests, 1)
		} else {
			atomic.AddUint64(&GlobalMetrics.Errors.Total, 1)

			if strings.Contains(path, "/api/liftw") {
				atomic.AddUint64(&GlobalMetrics.Donors.LiftwFails, 1)
			} else if strings.Contains(path, "/api/stream") {
				atomic.AddUint64(&GlobalMetrics.Donors.GoFails, 1)
			}

			switch code {
			case 429:
				atomic.AddUint64(&GlobalMetrics.Errors.RateLimits, 1)
			case 404:
				atomic.AddUint64(&GlobalMetrics.Errors.NotFounds, 1)
			case 403:
				atomic.AddUint64(&GlobalMetrics.Errors.DonorBans, 1)
			default:
				if code >= 500 {
					atomic.AddUint64(&GlobalMetrics.Errors.Internal, 1)
				}
			}

			if code >= 400 {
				RecordRecentError(path, code, fmt.Sprintf("HTTP %d error", code))
			}
		}
	})
}

// IP-based Rate Limiter
type rateLimitEntry struct {
	mu        sync.Mutex
	count     int
	resetTime time.Time
}

var (
	rateLimiterMap sync.Map
)

func init() {
	// Background sweeper: evict expired rate limiter entries every 10 minutes to prevent memory leak
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		for range ticker.C {
			now := time.Now()
			rateLimiterMap.Range(func(key, value interface{}) bool {
				entry := value.(*rateLimitEntry)
				entry.mu.Lock()
				expired := now.After(entry.resetTime)
				entry.mu.Unlock()
				if expired {
					rateLimiterMap.Delete(key)
				}
				return true
			})
		}
	}()

	// Background sweeper: clear uniqueIPStore every 24 hours to prevent memory leak
	go func() {
		ticker := time.NewTicker(24 * time.Hour)
		for range ticker.C {
			uniqueIPStore.Range(func(key, value interface{}) bool {
				uniqueIPStore.Delete(key)
				return true
			})
		}
	}()
}

func getClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	if xreal := r.Header.Get("X-Real-IP"); xreal != "" {
		return strings.TrimSpace(xreal)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}

func RateLimiterMiddleware(window time.Duration, maxRequests int) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := getClientIP(r)
			now := time.Now()

			val, _ := rateLimiterMap.LoadOrStore(ip, &rateLimitEntry{count: 0, resetTime: now.Add(window)})
			entry := val.(*rateLimitEntry)

			entry.mu.Lock()
			if now.After(entry.resetTime) {
				entry.count = 1
				entry.resetTime = now.Add(window)
			} else {
				entry.count++
			}
			currentCount := entry.count
			entry.mu.Unlock()

			if currentCount > maxRequests {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusTooManyRequests)
				w.Write([]byte(`{"error":"Too many requests, please slow down"}`))
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// Health Check Handler
func HealthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "ok",
		"time":   time.Now().Format(time.RFC3339),
	})
}

// Stats Handler
func StatsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	authHeader := r.Header.Get("Authorization")
	expectedToken := os.Getenv("BOT_TOKEN_MAIN")
	if expectedToken == "" {
		expectedToken = os.Getenv("BOT_TOKEN")
	}

	if authHeader != "Bearer "+expectedToken {
		http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
		return
	}

	metricsMutex.Lock()
	defer metricsMutex.Unlock()

	uptimeSec := (time.Now().UnixMilli() - GlobalMetrics.StartTime) / 1000
	stats := map[string]interface{}{
		"uptime_seconds": uptimeSec,
		"metrics":        GlobalMetrics,
	}

	if r.URL.Query().Get("reset") == "true" {
		atomic.StoreUint64(&GlobalMetrics.TotalRequests, 0)
		atomic.StoreUint64(&GlobalMetrics.SuccessfulRequests, 0)
		atomic.StoreUint64(&GlobalMetrics.UniqueIPs, 0)
		atomic.StoreUint64(&GlobalMetrics.Categories.Movies, 0)
		atomic.StoreUint64(&GlobalMetrics.Categories.Series, 0)
		atomic.StoreUint64(&GlobalMetrics.Categories.Radio, 0)
		atomic.StoreUint64(&GlobalMetrics.Categories.TV, 0)
		atomic.StoreUint64(&GlobalMetrics.Donors.LiftwRequests, 0)
		atomic.StoreUint64(&GlobalMetrics.Donors.LiftwFails, 0)
		atomic.StoreUint64(&GlobalMetrics.Donors.GoRequests, 0)
		atomic.StoreUint64(&GlobalMetrics.Donors.GoFails, 0)
		atomic.StoreUint64(&GlobalMetrics.Errors.Total, 0)
		atomic.StoreUint64(&GlobalMetrics.Errors.RateLimits, 0)
		atomic.StoreUint64(&GlobalMetrics.Errors.NotFounds, 0)
		atomic.StoreUint64(&GlobalMetrics.Errors.Internal, 0)
		atomic.StoreUint64(&GlobalMetrics.Errors.DonorBans, 0)
		GlobalMetrics.RecentErrors = make([]RecentError, 0)

		// Clear unique IP map
		uniqueIPStore.Range(func(key, value interface{}) bool {
			uniqueIPStore.Delete(key)
			return true
		})
	}

	json.NewEncoder(w).Encode(stats)
}
