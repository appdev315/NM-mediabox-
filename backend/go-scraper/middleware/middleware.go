package middleware

import (
	"encoding/json"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type ErrorMetrics struct {
	Total        uint64 `json:"total"`
	RateLimits   uint64 `json:"rateLimits"`
	NotFounds    uint64 `json:"notFounds"`
	Internal     uint64 `json:"internal"`
	DonorBans    uint64 `json:"donorBans"`
}

type ServerMetrics struct {
	StartTime          int64        `json:"startTime"`
	TotalRequests      uint64       `json:"totalRequests"`
	SuccessfulRequests uint64       `json:"successfulRequests"`
	Errors             ErrorMetrics `json:"errors"`
}

var (
	GlobalMetrics = ServerMetrics{
		StartTime: time.Now().UnixMilli(),
	}
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
		if isOriginAllowed(origin) {
			if origin != "" {
				w.Header().Set("Access-Control-Allow-Origin", origin)
			} else {
				w.Header().Set("Access-Control-Allow-Origin", "*")
			}
		} else {
			w.Header().Set("Access-Control-Allow-Origin", "https://web.telegram.org")
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

func MetricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddUint64(&GlobalMetrics.TotalRequests, 1)

		lrw := &statusResponseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(lrw, r)

		code := lrw.statusCode
		if code == 200 || code == 304 || code == 206 {
			atomic.AddUint64(&GlobalMetrics.SuccessfulRequests, 1)
		} else {
			atomic.AddUint64(&GlobalMetrics.Errors.Total, 1)
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
		}
	})
}

// IP-based Rate Limiter
type rateLimitEntry struct {
	count     int
	resetTime time.Time
}

var (
	rateLimiterMap sync.Map
)

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

			if now.After(entry.resetTime) {
				entry.count = 1
				entry.resetTime = now.Add(window)
			} else {
				entry.count++
			}

			if entry.count > maxRequests {
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

	uptimeSec := (time.Now().UnixMilli() - GlobalMetrics.StartTime) / 1000
	stats := map[string]interface{}{
		"uptime_seconds": uptimeSec,
		"metrics":        GlobalMetrics,
	}

	if r.URL.Query().Get("reset") == "true" {
		atomic.StoreUint64(&GlobalMetrics.TotalRequests, 0)
		atomic.StoreUint64(&GlobalMetrics.SuccessfulRequests, 0)
		atomic.StoreUint64(&GlobalMetrics.Errors.Total, 0)
		atomic.StoreUint64(&GlobalMetrics.Errors.RateLimits, 0)
		atomic.StoreUint64(&GlobalMetrics.Errors.NotFounds, 0)
		atomic.StoreUint64(&GlobalMetrics.Errors.Internal, 0)
		atomic.StoreUint64(&GlobalMetrics.Errors.DonorBans, 0)
	}

	json.NewEncoder(w).Encode(stats)
}
