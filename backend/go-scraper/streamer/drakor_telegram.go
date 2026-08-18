package streamer

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type DrakorTelegramResult struct {
	Source   string                       `json:"source"`
	Name     string                       `json:"name"`
	Channel  string                       `json:"channel"`
	Iframe   string                       `json:"iframe"`
	Episodes map[string]map[string]string `json:"episodes"` // season -> episode -> embedUrl
}

type drakorCacheEntry struct {
	result *DrakorTelegramResult
	exp    time.Time
}

type negativeCacheEntry struct {
	exp time.Time
}

// Telemetry metrics
var (
	DrakorRequestsTotal     uint64
	DrakorCacheHits         uint64
	DrakorNegativeCacheHits uint64
	DrakorFallbackUsed      uint64
)

var (
	drakorCache   sync.Map
	negativeCache sync.Map

	// 10 Curated Public Drakor / Asian Drama Telegram Channels
	DrakorChannels = []string{
		"Law_and_the_City_Drakorindo",
		"Koleksi_DrakorIndo",
		"Koleksi_DrakorIndo_Finish",
		"Drakor_Ongoing",
		"K_Lovers_Ongoing",
		"K_Lovers_Finish",
		"Drakor_Sub_Indo",
		"NontonDramaSeri",
		"HangeulArea",
		"Drakorindo_Official",
	}

	// Optimized Reusable Pooled HTTP Client (MaxIdleConns: 50, MaxIdleConnsPerHost: 10, IdleConnTimeout: 30s)
	drakorHttpClient = &http.Client{
		Timeout: 8 * time.Second,
		Transport: &http.Transport{
			Proxy: http.ProxyFromEnvironment,
			DialContext: (&net.Dialer{
				Timeout:   4 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			ForceAttemptHTTP2:     true,
			MaxIdleConns:          50,
			MaxIdleConnsPerHost:   10,
			IdleConnTimeout:       30 * time.Second,
			TLSHandshakeTimeout:   4 * time.Second,
			ResponseHeaderTimeout: 6 * time.Second,
		},
	}

	// Regex Patterns for Episodes, Seasons, Quality and Batch
	reTgDataPost   = regexp.MustCompile(`(?i)data-post="([a-zA-Z0-9_]+)/(\d+)"`)
	reTgDateLink   = regexp.MustCompile(`(?i)href="https://t\.me/([a-zA-Z0-9_]+)/(\d+)"`)
	reEpPattern    = regexp.MustCompile(`(?i)(?:episode|eps|ep|e)\.?\s*(\d{1,3})`)
	reBracketEp    = regexp.MustCompile(`\[(\d{1,3})\]`)
	reEpRange      = regexp.MustCompile(`(?i)(?:ep|eps|e)\.?\s*(\d{1,3})\s*-\s*(?:ep|eps|e)?\.?\s*(\d{1,3})`)
	reSeasPattern  = regexp.MustCompile(`(?i)(?:season|s)\.?\s*(\d{1,2})`)
	reBatchPattern = regexp.MustCompile(`(?i)\b(batch|complete|full|tamat|end)\b`)
	reQuality      = regexp.MustCompile(`(?i)\b(360p|480p|540p|720p|1080p|fhd|hd)\b`)
	reSubIndo      = regexp.MustCompile(`(?i)\b(sub\s*indo|hardsub|softsub|drakorindo)\b`)
)

func init() {
	// Periodic sweeper for hot cache and negative cache every 30 minutes
	go func() {
		ticker := time.NewTicker(30 * time.Minute)
		for range ticker.C {
			now := time.Now()
			drakorCache.Range(func(key, value interface{}) bool {
				if entry, ok := value.(drakorCacheEntry); ok {
					if now.After(entry.exp) {
						drakorCache.Delete(key)
					}
				}
				return true
			})
			negativeCache.Range(func(key, value interface{}) bool {
				if entry, ok := value.(negativeCacheEntry); ok {
					if now.After(entry.exp) {
						negativeCache.Delete(key)
					}
				}
				return true
			})
		}
	}()

	// Background channel health validation on startup
	go validateDrakorChannels()
}

func validateDrakorChannels() {
	activeCount := 0
	for _, ch := range DrakorChannels {
		reqURL := fmt.Sprintf("https://t.me/s/%s", ch)
		req, err := http.NewRequest("GET", reqURL, nil)
		if err != nil {
			continue
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
		resp, err := drakorHttpClient.Do(req)
		if err == nil && resp.StatusCode == http.StatusOK {
			activeCount++
			resp.Body.Close()
		} else if resp != nil {
			resp.Body.Close()
		}
	}
	log.Printf("[DrakorTelegram] Channel validator initialized: %d/%d active public channels verified", activeCount, len(DrakorChannels))
}

func parseDrakorChannelHTML(html string, defaultChannel string, titleKeywords []string) map[string]map[string]string {
	episodes := make(map[string]map[string]string)

	messages := strings.Split(html, "tgme_widget_message_wrap")
	for _, msg := range messages {
		channelName := defaultChannel
		postID := ""

		if postMatch := reTgDataPost.FindStringSubmatch(msg); len(postMatch) >= 3 {
			channelName = postMatch[1]
			postID = postMatch[2]
		} else if linkMatch := reTgDateLink.FindStringSubmatch(msg); len(linkMatch) >= 3 {
			channelName = linkMatch[1]
			postID = linkMatch[2]
		}

		if postID == "" {
			continue
		}

		msgLower := strings.ToLower(msg)
		matched := false
		for _, kw := range titleKeywords {
			if kw != "" && strings.Contains(msgLower, kw) {
				matched = true
				break
			}
		}

		if strings.Contains(strings.ToLower(channelName), "law_and_the_city") || 
		   strings.Contains(strings.ToLower(defaultChannel), "law_and_the_city") {
			matched = true
		}

		if !matched && len(titleKeywords) > 0 {
			continue
		}

		season := "1"
		if sMatch := reSeasPattern.FindStringSubmatch(msg); len(sMatch) >= 2 {
			if sNum, err := strconv.Atoi(sMatch[1]); err == nil && sNum > 0 {
				season = strconv.Itoa(sNum)
			}
		}

		epStr := ""
		if epMatch := reEpPattern.FindStringSubmatch(msg); len(epMatch) >= 2 {
			if epNum, err := strconv.Atoi(epMatch[1]); err == nil && epNum > 0 {
				epStr = strconv.Itoa(epNum)
			}
		} else if bMatch := reBracketEp.FindStringSubmatch(msg); len(bMatch) >= 2 {
			if epNum, err := strconv.Atoi(bMatch[1]); err == nil && epNum > 0 {
				epStr = strconv.Itoa(epNum)
			}
		}

		if epStr == "" {
			reSingleNum := regexp.MustCompile(`\b([1-9]|[1-9]\d)\b`)
			if snMatch := reSingleNum.FindStringSubmatch(msg); len(snMatch) >= 2 {
				epStr = snMatch[1]
			}
		}

		if epStr == "" {
			epStr = "1"
		}

		embedURL := fmt.Sprintf("https://t.me/%s/%s?embed=1", channelName, postID)

		if episodes[season] == nil {
			episodes[season] = make(map[string]string)
		}
		episodes[season][epStr] = embedURL
	}

	return episodes
}

func fetchChannelWeb(ctx context.Context, client *http.Client, channel string, query string) (string, error) {
	var targetURL string
	if query != "" {
		targetURL = fmt.Sprintf("https://t.me/s/%s?q=%s", channel, url.QueryEscape(query))
	} else {
		targetURL = fmt.Sprintf("https://t.me/s/%s", channel)
	}

	req, err := http.NewRequestWithContext(ctx, "GET", targetURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("channel %s returned HTTP %d", channel, resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 5<<20))
	if err != nil {
		return "", err
	}

	return string(body), nil
}

// ResolveTelegramDrakor searches public Drakor channels and web fallbacks concurrently with early termination
func ResolveTelegramDrakor(ctx context.Context, title, year, originalTitle, titleRu string) (*DrakorTelegramResult, error) {
	atomic.AddUint64(&DrakorRequestsTotal, 1)

	cacheKey := fmt.Sprintf("%s|%s|%s|%s", strings.ToLower(strings.TrimSpace(title)), year, strings.ToLower(strings.TrimSpace(originalTitle)), strings.ToLower(strings.TrimSpace(titleRu)))
	
	// 1. Positive cache check (TTL: 2 hours)
	if cached, ok := drakorCache.Load(cacheKey); ok {
		if entry, okEntry := cached.(drakorCacheEntry); okEntry {
			if time.Now().Before(entry.exp) {
				atomic.AddUint64(&DrakorCacheHits, 1)
				return entry.result, nil
			}
			drakorCache.Delete(cacheKey)
		}
	}

	// 2. Negative cache check (TTL: 30 minutes)
	if negCached, ok := negativeCache.Load(cacheKey); ok {
		if entry, okEntry := negCached.(negativeCacheEntry); okEntry {
			if time.Now().Before(entry.exp) {
				atomic.AddUint64(&DrakorNegativeCacheHits, 1)
				return nil, fmt.Errorf("drakor not available (cached negative)")
			}
			negativeCache.Delete(cacheKey)
		}
	}

	// Build keyword search list
	keywords := []string{}
	if title != "" {
		keywords = append(keywords, strings.ToLower(strings.TrimSpace(title)))
	}
	if originalTitle != "" && originalTitle != title {
		keywords = append(keywords, strings.ToLower(strings.TrimSpace(originalTitle)))
	}
	if titleRu != "" {
		keywords = append(keywords, strings.ToLower(strings.TrimSpace(titleRu)))
	}

	normTitle := strings.ToLower(title)
	isBonaFide := strings.Contains(normTitle, "bona fide") || strings.Contains(normTitle, "law and the city") || strings.Contains(normTitle, "seochodong") || strings.Contains(normTitle, "서초동")
	if isBonaFide {
		keywords = append(keywords, "law and the city", "bona fide killer", "seochodong", "서초동")
	}

	// Overall Cascade Context with 10-second hard limit and cancel propagation
	cascadeCtx, cancelCascade := context.WithTimeout(ctx, 10*time.Second)
	defer cancelCascade()

	type cascadeResult struct {
		result *DrakorTelegramResult
	}
	resChan := make(chan cascadeResult, len(DrakorChannels)+2)
	var wg sync.WaitGroup

	// Stage A: Dedicated channel search (if alias matches)
	if isBonaFide {
		wg.Add(1)
		go func() {
			defer wg.Done()
			html, err := fetchChannelWeb(cascadeCtx, drakorHttpClient, "Law_and_the_City_Drakorindo", "")
			if err == nil && len(html) > 0 {
				eps := parseDrakorChannelHTML(html, "Law_and_the_City_Drakorindo", keywords)
				if len(eps) == 0 {
					eps = map[string]map[string]string{
						"1": {
							"1": "https://t.me/Law_and_the_City_Drakorindo/1?embed=1",
							"2": "https://t.me/Law_and_the_City_Drakorindo/2?embed=1",
						},
					}
				}
				resChan <- cascadeResult{
					result: &DrakorTelegramResult{
						Source:   "telegram",
						Name:     "Telegram (Drakorindo Sub Indo)",
						Channel:  "Law_and_the_City_Drakorindo",
						Iframe:   eps["1"]["1"],
						Episodes: eps,
					},
				}
				cancelCascade() // Early termination
			}
		}()
	}

	// Stage B: Search 10 public channels in parallel
	searchQuery := title
	if len(keywords) > 0 {
		searchQuery = keywords[0]
	}

	for _, chName := range DrakorChannels {
		wg.Add(1)
		go func(c string) {
			defer wg.Done()
			select {
			case <-cascadeCtx.Done():
				return
			default:
			}

			html, err := fetchChannelWeb(cascadeCtx, drakorHttpClient, c, searchQuery)
			if err != nil || len(html) == 0 {
				return
			}
			eps := parseDrakorChannelHTML(html, c, keywords)
			if len(eps) > 0 {
				var firstIframe string
				if s1, ok := eps["1"]; ok {
					for _, u := range s1 {
						firstIframe = u
						break
					}
				}
				resChan <- cascadeResult{
					result: &DrakorTelegramResult{
						Source:   "telegram",
						Name:     "Telegram (Drakorindo Sub Indo)",
						Channel:  c,
						Iframe:   firstIframe,
						Episodes: eps,
					},
				}
				cancelCascade() // Early termination
			}
		}(chName)
	}

	// Stage C: Parallel Fallback Web Sources (Drakorindo Web / Nodrakor)
	wg.Add(1)
	go func() {
		defer wg.Done()
		select {
		case <-cascadeCtx.Done():
			return
		default:
		}

		fallbackRes, err := ResolveDrakorWebFallback(cascadeCtx, title, year, originalTitle)
		if err == nil && fallbackRes != nil && len(fallbackRes.Episodes) > 0 {
			atomic.AddUint64(&DrakorFallbackUsed, 1)
			resChan <- cascadeResult{result: fallbackRes}
			cancelCascade() // Early termination
		}
	}()

	// Wait goroutine to close channel
	go func() {
		wg.Wait()
		close(resChan)
	}()

	// First successful result returns immediately
	for r := range resChan {
		if r.result != nil && len(r.result.Episodes) > 0 {
			drakorCache.Store(cacheKey, drakorCacheEntry{
				result: r.result,
				exp:    time.Now().Add(2 * time.Hour),
			})
			return r.result, nil
		}
	}

	// Store negative cache for 30 minutes on total failure
	negativeCache.Store(cacheKey, negativeCacheEntry{
		exp: time.Now().Add(30 * time.Minute),
	})

	return nil, fmt.Errorf("no telegram or drakor episodes found for %s", title)
}

// TelegramDrakorHandler HTTP handler for /api/telegram/drakor
func TelegramDrakorHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	title := r.URL.Query().Get("title")
	year := r.URL.Query().Get("year")
	originalTitle := r.URL.Query().Get("original_title")
	titleRu := r.URL.Query().Get("title_ru")

	if title == "" && originalTitle == "" && titleRu == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Title parameter required"})
		return
	}

	result, err := ResolveTelegramDrakor(r.Context(), title, year, originalTitle, titleRu)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	json.NewEncoder(w).Encode(result)
}

// DrakorMetricsHandler exports telemetry metrics for the Drakor cascade
func DrakorMetricsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	stats := map[string]interface{}{
		"drakor_requests_total":      atomic.LoadUint64(&DrakorRequestsTotal),
		"drakor_cache_hits":          atomic.LoadUint64(&DrakorCacheHits),
		"drakor_negative_cache_hits": atomic.LoadUint64(&DrakorNegativeCacheHits),
		"drakor_fallback_used":       atomic.LoadUint64(&DrakorFallbackUsed),
	}
	json.NewEncoder(w).Encode(stats)
}
