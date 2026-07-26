package streamer

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

type tmdbCacheEntry struct {
	data       []byte
	statusCode int
	headers    http.Header
	expiry     time.Time
}

var (
	tmdbCache    sync.Map
	tmdbApiKey   string
	tmdbApiKeyOnce sync.Once
)

func getTMDBApiKey() string {
	tmdbApiKeyOnce.Do(func() {
		tmdbApiKey = os.Getenv("TMDB_API_KEY")
		if tmdbApiKey == "" {
			tmdbApiKey = "cd5b69242e715dc87d65957d7460eba2"
		}
	})
	return tmdbApiKey
}

func init() {
	// Background sweeper to remove expired TMDB cache entries every hour
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		for range ticker.C {
			now := time.Now()
			tmdbCache.Range(func(key, value interface{}) bool {
				if entry, ok := value.(tmdbCacheEntry); ok {
					if now.After(entry.expiry) {
						tmdbCache.Delete(key)
					}
				}
				return true
			})
		}
	}()
}

func TMDBApiHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Extract endpoint path after /api/tmdb/
	path := strings.TrimPrefix(r.URL.Path, "/api/tmdb/")
	if path == "" {
		http.Error(w, `{"error":"Endpoint required"}`, http.StatusBadRequest)
		return
	}

	targetUrl, err := url.Parse(fmt.Sprintf("https://api.themoviedb.org/3/%s", path))
	if err != nil {
		http.Error(w, `{"error":"Invalid URL"}`, http.StatusBadRequest)
		return
	}

	// Forward all query parameters
	queryParams := r.URL.Query()
	queryParams.Set("api_key", getTMDBApiKey())
	targetUrl.RawQuery = queryParams.Encode()

	cacheKey := targetUrl.String()

	// Check in-memory cache
	if val, ok := tmdbCache.Load(cacheKey); ok {
		entry := val.(tmdbCacheEntry)
		if time.Now().Before(entry.expiry) {
			for k, vv := range entry.headers {
				for _, v := range vv {
					w.Header().Add(k, v)
				}
			}
			w.WriteHeader(entry.statusCode)
			w.Write(entry.data)
			return
		}
		tmdbCache.Delete(cacheKey)
	}

	// TTL: 2 hours for search endpoints, 24 hours for all other endpoints
	ttl := 24 * time.Hour
	if strings.Contains(r.URL.Path, "/search") {
		ttl = 2 * time.Hour
	}

	client := defaultClient

	var res *http.Response
	var fetchErr error

	// Retry up to 3 times with exponential backoff
	for attempt := 1; attempt <= 3; attempt++ {
		req, err := http.NewRequest("GET", targetUrl.String(), nil)
		if err != nil {
			fetchErr = err
			break
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MediaBoxBackend/1.0")
		req.Header.Set("Accept", "application/json")

		res, fetchErr = client.Do(req)
		if fetchErr == nil && res.StatusCode == 200 {
			break
		}

		if res != nil {
			res.Body.Close()
		}

		log.Printf("[TMDB] Fetch attempt %d failed for %s: %v", attempt, path, fetchErr)
		if attempt < 3 {
			time.Sleep(time.Duration(attempt) * 1 * time.Second)
		}
	}

	if fetchErr != nil || res == nil {
		log.Printf("[TMDB] All 3 fetch attempts failed for %s: %v", path, fetchErr)
		http.Error(w, fmt.Sprintf(`{"error":"TMDB fetch failed: %v"}`, fetchErr), http.StatusInternalServerError)
		return
	}
	defer res.Body.Close()

	bodyBytes, err := io.ReadAll(res.Body)
	if err != nil {
		http.Error(w, `{"error":"Failed to read response"}`, http.StatusInternalServerError)
		return
	}

	// Cache successful responses
	if res.StatusCode == 200 {
		tmdbCache.Store(cacheKey, tmdbCacheEntry{
			data:       bodyBytes,
			statusCode: res.StatusCode,
			headers:    res.Header.Clone(),
			expiry:     time.Now().Add(ttl),
		})
	}

	for k, vv := range res.Header {
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(res.StatusCode)
	w.Write(bodyBytes)
}

func ClearTMDBCache() {
	tmdbCache = sync.Map{}
}
