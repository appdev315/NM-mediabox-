package streamer

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

type TrendingItem struct {
	ID           int    `json:"id"`
	Title        string `json:"title"`
	Name         string `json:"name"`
	ReleaseDate  string `json:"release_date"`
	FirstAirDate string `json:"first_air_date"`
}

type TrendingResponse struct {
	Results []TrendingItem `json:"results"`
}

type warmItem struct {
	ID    int
	Title string
	Type  string // "movie" or "tv"
	Year  string
}

var (
	warmQueue []warmItem
	queueMu   sync.Mutex
)

func fetchTopTrending() []warmItem {
	var items []warmItem
	client := &http.Client{Timeout: 10 * time.Second}
	apiKey := "cd5b69242e715dc87d65957d7460eba2"

	// Fetch 100 movies (5 pages)
	for page := 1; page <= 5; page++ {
		url := fmt.Sprintf("https://api.themoviedb.org/3/trending/movie/day?api_key=%s&page=%d", apiKey, page)
		res, err := client.Get(url)
		if err != nil {
			log.Printf("[Warmer] Failed to fetch movie trending page %d: %v", page, err)
			continue
		}
		var resp TrendingResponse
		if err := json.NewDecoder(res.Body).Decode(&resp); err == nil {
			for _, it := range resp.Results {
				year := ""
				if it.ReleaseDate != "" {
					year = strings.Split(it.ReleaseDate, "-")[0]
				}
				title := it.Title
				if title == "" {
					title = it.Name
				}
				if title != "" {
					items = append(items, warmItem{
						ID:    it.ID,
						Title: title,
						Type:  "movie",
						Year:  year,
					})
				}
			}
		}
		res.Body.Close()
		time.Sleep(200 * time.Millisecond) // slight delay
	}

	// Fetch 100 series (5 pages)
	for page := 1; page <= 5; page++ {
		url := fmt.Sprintf("https://api.themoviedb.org/3/trending/tv/day?api_key=%s&page=%d", apiKey, page)
		res, err := client.Get(url)
		if err != nil {
			log.Printf("[Warmer] Failed to fetch tv trending page %d: %v", page, err)
			continue
		}
		var resp TrendingResponse
		if err := json.NewDecoder(res.Body).Decode(&resp); err == nil {
			for _, it := range resp.Results {
				year := ""
				if it.FirstAirDate != "" {
					year = strings.Split(it.FirstAirDate, "-")[0]
				}
				title := it.Name
				if title == "" {
					title = it.Title
				}
				if title != "" {
					items = append(items, warmItem{
						ID:    it.ID,
						Title: title,
						Type:  "series",
						Year:  year,
					})
				}
			}
		}
		res.Body.Close()
		time.Sleep(200 * time.Millisecond) // slight delay
	}

	log.Printf("[Warmer] Fetched %d items from TMDB trends to warm", len(items))
	return items
}

func StartCacheWarmer() {
	log.Println("[Warmer] Cache warmer service starting...")

	// Initial warm load
	go func() {
		// Wait a bit after app start to let it boot up
		time.Sleep(10 * time.Second)
		refreshTrendingQueue()
	}()

	// 24 hour ticker to reload trends from TMDB
	reloadTicker := time.NewTicker(24 * time.Hour)
	go func() {
		for range reloadTicker.C {
			refreshTrendingQueue()
		}
	}()

	// 2 minute ticker to process warm queue batches
	processTicker := time.NewTicker(2 * time.Minute)
	go func() {
		for range processTicker.C {
			processNextBatch()
		}
	}()
}

func refreshTrendingQueue() {
	items := fetchTopTrending()
	if len(items) == 0 {
		return
	}

	queueMu.Lock()
	warmQueue = items
	queueMu.Unlock()
	log.Printf("[Warmer] Queue refreshed with %d items.", len(items))
}

func processNextBatch() {
	queueMu.Lock()
	if len(warmQueue) == 0 {
		queueMu.Unlock()
		return
	}

	// Extract up to 5 movies and 5 series from the queue
	var batch []warmItem
	var remaining []warmItem

	moviesCount := 0
	seriesCount := 0

	for _, item := range warmQueue {
		if item.Type == "movie" && moviesCount < 5 {
			batch = append(batch, item)
			moviesCount++
		} else if item.Type == "series" && seriesCount < 5 {
			batch = append(batch, item)
			seriesCount++
		} else {
			remaining = append(remaining, item)
		}
	}

	// Move the processed batch items to the back of the queue so we loop in a circle!
	warmQueue = append(remaining, batch...)
	queueMu.Unlock()

	log.Printf("[Warmer] Processing batch of %d items (movies: %d, series: %d)", len(batch), moviesCount, seriesCount)

	// Process items sequentially with spacing to avoid DDoS
	go func() {
		for _, item := range batch {
			// Check if already in cache and not expired (ResolveLiftw bypassCache=false does this automatically)
			// Wait, to see if it actually scraped or used cache, we check cache first
			cacheKey := fmt.Sprintf("%s|%s|%s|%d", item.Title, item.Year, item.Type, strconv.Itoa(item.ID))
			if val, ok := liftwCache.Load(cacheKey); ok {
				entry := val.(cacheEntry)
				if time.Now().Before(entry.exp) {
					// Fresh in cache, skip!
					continue
				}
			}

			log.Printf("[Warmer] Warming cache for %s (%s, %s, ID: %d)...", item.Title, item.Year, item.Type, item.ID)
			_, err := ResolveLiftw(item.Title, item.Year, item.Type, strconv.Itoa(item.ID), false)
			if err != nil {
				log.Printf("[Warmer] Failed to warm %s: %v", item.Title, err)
			} else {
				log.Printf("[Warmer] Successfully warmed %s", item.Title)
			}

			// Wait 3 seconds to keep requests friendly
			time.Sleep(3 * time.Second)
		}
	}()
}
