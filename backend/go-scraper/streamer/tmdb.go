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

	"golang.org/x/sync/singleflight"
)

type tmdbCacheEntry struct {
	data       []byte
	statusCode int
	headers    http.Header
	expiry     time.Time
}

var (
	tmdbCache       sync.Map
	tmdbSingleGroup singleflight.Group
	tmdbApiKey      string
	tmdbApiKeyOnce  sync.Once
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

	// Check in-memory cache (0ms hit)
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

	// Singleflight: collapse duplicate concurrent requests for uncached endpoints
	val, fetchErr, _ := tmdbSingleGroup.Do(cacheKey, func() (interface{}, error) {
		// Re-check cache inside singleflight callback
		if cachedVal, ok := tmdbCache.Load(cacheKey); ok {
			entry := cachedVal.(tmdbCacheEntry)
			if time.Now().Before(entry.expiry) {
				return entry, nil
			}
		}

		// TTL: 2 hours for search endpoints, 24 hours for all other endpoints
		ttl := 24 * time.Hour
		if strings.Contains(r.URL.Path, "/search") {
			ttl = 2 * time.Hour
		}

		client := defaultClient
		var lastRes *http.Response
		var attemptErr error

		for attempt := 1; attempt <= 3; attempt++ {
			req, err := http.NewRequest("GET", targetUrl.String(), nil)
			if err != nil {
				attemptErr = err
				break
			}
			req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MediaBoxBackend/1.0")
			req.Header.Set("Accept", "application/json")

			res, err := client.Do(req)
			if err != nil {
				attemptErr = err
				log.Printf("[TMDB] Fetch attempt %d failed for %s: %v", attempt, path, err)
				if attempt < 3 {
					time.Sleep(time.Duration(attempt) * 1 * time.Second)
				}
				continue
			}

			lastRes = res
			attemptErr = nil
			if res.StatusCode == 200 {
				break
			}

			log.Printf("[TMDB] Endpoint %s returned status %d", path, res.StatusCode)
			break
		}

		if attemptErr != nil || lastRes == nil {
			return nil, fmt.Errorf("TMDB fetch failed: %v", attemptErr)
		}
		defer lastRes.Body.Close()

		bodyBytes, err := io.ReadAll(lastRes.Body)
		if err != nil {
			return nil, fmt.Errorf("Failed to read response: %v", err)
		}

		entry := tmdbCacheEntry{
			data:       bodyBytes,
			statusCode: lastRes.StatusCode,
			headers:    lastRes.Header.Clone(),
			expiry:     time.Now().Add(ttl),
		}

		if lastRes.StatusCode == 200 {
			tmdbCache.Store(cacheKey, entry)
		}
		return entry, nil
	})

	if fetchErr != nil {
		log.Printf("[TMDB] Singleflight fetch error for %s: %v", path, fetchErr)
		http.Error(w, fmt.Sprintf(`{"error":%q}`, fetchErr.Error()), http.StatusInternalServerError)
		return
	}

	entry := val.(tmdbCacheEntry)
	for k, vv := range entry.headers {
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(entry.statusCode)
	w.Write(entry.data)
}

func ClearTMDBCache() {
	tmdbCache.Range(func(key, value interface{}) bool {
		tmdbCache.Delete(key)
		return true
	})
}
