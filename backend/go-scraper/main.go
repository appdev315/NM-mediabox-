package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"scraper/middleware"
	"scraper/scraper"
	"scraper/streamer"
	"scraper/types"
)

type adultCacheEntry struct {
	data string
	exp  time.Time
}

var (
	adultSearchCache  sync.Map
	adultDetailsCache sync.Map
)

func init() {
	// Background sweeper to evict expired adult search and details cache entries
	go func() {
		ticker := time.NewTicker(30 * time.Minute)
		for range ticker.C {
			now := time.Now()
			adultSearchCache.Range(func(key, value interface{}) bool {
				if entry, ok := value.(adultCacheEntry); ok {
					if now.After(entry.exp) {
						adultSearchCache.Delete(key)
					}
				}
				return true
			})
			adultDetailsCache.Range(func(key, value interface{}) bool {
				if entry, ok := value.(adultCacheEntry); ok {
					if now.After(entry.exp) {
						adultDetailsCache.Delete(key)
					}
				}
				return true
			})
		}
	}()
}

func searchHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")

	q := r.URL.Query().Get("q")
	pageStr := r.URL.Query().Get("page")
	page := 0
	if pageStr != "" {
		if p, err := strconv.Atoi(pageStr); err == nil {
			page = p
		}
	}

	// Check search cache with TTL
	cacheKey := q + "|" + strconv.Itoa(page)
	if val, ok := adultSearchCache.Load(cacheKey); ok {
		entry := val.(adultCacheEntry)
		if time.Now().Before(entry.exp) {
			w.Write([]byte(entry.data))
			return
		}
		adultSearchCache.Delete(cacheKey)
	}

	xvideosRes := scraper.SearchXvideos(q, page)
	if xvideosRes == nil {
		xvideosRes = []types.Video{}
	}

	dataBytes, err := json.Marshal(xvideosRes)
	if err != nil {
		w.Write([]byte("[]"))
		return
	}

	// Store in cache with 30 min TTL only if results found
	if len(xvideosRes) > 0 {
		adultSearchCache.Store(cacheKey, adultCacheEntry{
			data: string(dataBytes),
			exp:  time.Now().Add(30 * time.Minute),
		})
	}

	w.Write(dataBytes)
}

func detailsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600")

	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, `{"error":"Missing id"}`, http.StatusBadRequest)
		return
	}

	if val, ok := adultDetailsCache.Load(id); ok {
		entry := val.(adultCacheEntry)
		if time.Now().Before(entry.exp) {
			w.Write([]byte(entry.data))
			return
		}
	}

	details := scraper.XvideosDetails(id)

	if details != nil {
		dataBytes, err := json.Marshal(details)
		if err == nil {
			adultDetailsCache.Store(id, adultCacheEntry{
				data: string(dataBytes),
				exp:  time.Now().Add(1 * time.Hour),
			})
		}
		w.Write(dataBytes)
	} else {
		http.Error(w, `{"error":"Video not found"}`, http.StatusNotFound)
	}
}

func rootHandler(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "OK",
		"message": "MediaBox Go API is running",
	})
}

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("/", rootHandler)
	mux.HandleFunc("/api/health", middleware.HealthHandler)
	mux.HandleFunc("/api/stats", middleware.StatsHandler)
	mux.HandleFunc("/api/config", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Write([]byte(`{"status":"ok","version":"1.0.0"}`))
	})

	// Telegram Webhook handler to acknowledge bot updates and eliminate 404 logs
	mux.HandleFunc("/api/telegram/webhook/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true}`))
	})

	// TMDB proxy (supports wildcards /api/tmdb/*)
	mux.HandleFunc("/api/tmdb/", streamer.TMDBApiHandler)

	// Adult endpoints
	mux.HandleFunc("/api/adult/search", middleware.CheckAdultAccess(searchHandler))
	mux.HandleFunc("/api/adult/details", middleware.CheckAdultAccess(detailsHandler))
	mux.HandleFunc("/api/adult/stream", middleware.CheckAdultAccess(detailsHandler))

	// Stream and proxy handlers
	mux.HandleFunc("/api/radio/stations", streamer.RadioStationsHandler)
	mux.HandleFunc("/api/proxy/stream", streamer.ProxyStreamHandler)
	mux.HandleFunc("/api/proxy", streamer.ProxyTVHandler)
	mux.HandleFunc("/api/stream", streamer.StreamApiHandler)
	mux.HandleFunc("/api/liftw", streamer.LiftwApiHandler)
	mux.HandleFunc("/api/anwap", streamer.AnwapApiHandler)
	mux.HandleFunc("/api/telegram/drakor", streamer.TelegramDrakorHandler)
	mux.HandleFunc("/api/metrics/drakor", streamer.DrakorMetricsHandler)
	mux.HandleFunc("/api/report-missing", streamer.ReportMissingHandler)

	// Start background cache warmers (trends and weekly smooth radio catalog updater)
	streamer.StartCacheWarmer()
	streamer.StartRadioCacheWarmer()

	// Apply global middleware chain: Gzip -> RateLimiter -> BotGuard -> Metrics -> CORS -> Mux
	rateLimiter := middleware.RateLimiterMiddleware(10*time.Minute, 150)
	handler := middleware.CORSMiddleware(middleware.BotGuardMiddleware(middleware.MetricsMiddleware(middleware.GzipMiddleware(rateLimiter(mux)))))

	port := os.Getenv("PORT")
	if port == "" {
		port = "7860"
	}
	if !strings.HasPrefix(port, ":") {
		port = ":" + port
	}

	srv := &http.Server{
		Addr:    port,
		Handler: handler,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("MediaBox Unified Go Microservice starting on %s...", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("ListenAndServe error: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("Shutting down gracefully (10s timeout)...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("Forced shutdown: %v", err)
	}
	log.Println("Server stopped cleanly.")
}
