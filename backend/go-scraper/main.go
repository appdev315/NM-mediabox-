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

func searchHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	q := r.URL.Query().Get("q")
	pageStr := r.URL.Query().Get("page")
	page := 0
	if pageStr != "" {
		if p, err := strconv.Atoi(pageStr); err == nil {
			page = p
		}
	}

	var wg sync.WaitGroup
	wg.Add(2)

	var xvideosRes []types.Video
	var epornerRes []types.Video

	go func() {
		defer wg.Done()
		xvideosRes = scraper.SearchXvideos(q, page)
	}()

	go func() {
		defer wg.Done()
		epornerRes = scraper.SearchEporner(q, page)
	}()

	wg.Wait()

	var mixed []types.Video
	maxLen := len(xvideosRes)
	if len(epornerRes) > maxLen {
		maxLen = len(epornerRes)
	}

	for i := 0; i < maxLen; i++ {
		if i < len(epornerRes) {
			mixed = append(mixed, epornerRes[i])
		}
		if i < len(xvideosRes) {
			mixed = append(mixed, xvideosRes[i])
		}
	}

	if mixed == nil {
		mixed = []types.Video{}
	}

	json.NewEncoder(w).Encode(mixed)
}

func detailsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, `{"error":"Missing id"}`, http.StatusBadRequest)
		return
	}

	var details *types.VideoDetails
	if len(id) > 8 && id[:8] == "eporner_" {
		details = scraper.EpornerDetails(id)
	} else {
		details = scraper.XvideosDetails(id)
	}

	if details != nil {
		json.NewEncoder(w).Encode(details)
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
