package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
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

	xvideosRes := scraper.SearchXvideos(q, page)
	if xvideosRes == nil {
		xvideosRes = []types.Video{}
	}

	dataBytes, err := json.Marshal(xvideosRes)
	if err != nil {
		w.Write([]byte("[]"))
		return
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

	// TMDB proxy (supports wildcards /api/tmdb/*)
	mux.HandleFunc("/api/tmdb/", streamer.TMDBApiHandler)

	// Adult endpoints
	mux.HandleFunc("/api/adult/search", middleware.CheckAdultAccess(searchHandler))
	mux.HandleFunc("/api/adult/details", middleware.CheckAdultAccess(detailsHandler))
	mux.HandleFunc("/api/adult/stream", middleware.CheckAdultAccess(detailsHandler))

	// Stream and proxy handlers
	mux.HandleFunc("/api/proxy/stream", streamer.ProxyStreamHandler)
	mux.HandleFunc("/api/proxy", streamer.ProxyTVHandler)
	mux.HandleFunc("/api/stream", streamer.StreamApiHandler)
	mux.HandleFunc("/api/liftw", streamer.LiftwApiHandler)

	// Start background cache warmer for trends
	streamer.StartCacheWarmer()

	// Apply global middleware chain: Gzip -> RateLimiter -> Metrics -> CORS -> Mux
	rateLimiter := middleware.RateLimiterMiddleware(10*time.Minute, 150)
	handler := middleware.CORSMiddleware(middleware.MetricsMiddleware(middleware.GzipMiddleware(rateLimiter(mux))))

	port := os.Getenv("PORT")
	if port == "" {
		port = "7860"
	}
	if !strings.HasPrefix(port, ":") {
		port = ":" + port
	}

	log.Printf("MediaBox Unified Go Microservice starting on %s...", port)
	log.Fatal(http.ListenAndServe(port, handler))
}
