package streamer

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
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

var (
	drakorCache sync.Map

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

	reTgPostLink = regexp.MustCompile(`(?i)data-post="([a-zA-Z0-9_]+)/(\d+)"`)
	reEpPattern  = regexp.MustCompile(`(?i)(?:episode|eps|ep|e)\.?\s*(\d{1,3})`)
	reSeasPattern = regexp.MustCompile(`(?i)(?:season|s)\.?\s*(\d{1,2})`)
)

func init() {
	// Background sweeper for drakor telegram cache every hour
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
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
		}
	}()
}

func parseDrakorChannelHTML(html string, defaultChannel string, titleKeywords []string) map[string]map[string]string {
	episodes := make(map[string]map[string]string)

	// Split by tgme_widget_message block
	messages := strings.Split(html, "tgme_widget_message_wrap")
	for _, msg := range messages {
		// Find post identifier
		postMatch := reTgPostLink.FindStringSubmatch(msg)
		if len(postMatch) < 3 {
			continue
		}
		channelName := postMatch[1]
		postID := postMatch[2]

		// Check if message is related to searched drama
		msgLower := strings.ToLower(msg)
		matched := false
		for _, kw := range titleKeywords {
			if kw != "" && strings.Contains(msgLower, kw) {
				matched = true
				break
			}
		}

		// If this is a dedicated channel (e.g. Law_and_the_City_Drakorindo), match all video posts
		if strings.Contains(strings.ToLower(channelName), "law_and_the_city") || 
		   strings.Contains(strings.ToLower(defaultChannel), "law_and_the_city") {
			matched = true
		}

		if !matched && len(titleKeywords) > 0 {
			continue
		}

		// Parse Season and Episode numbers
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
		}

		if epStr == "" {
			// Fallback: search for single numbers in title
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

// ResolveTelegramDrakor searches public Drakor channels for drama episodes
func ResolveTelegramDrakor(ctx context.Context, title string, year string, originalTitle string) (*DrakorTelegramResult, error) {
	cacheKey := fmt.Sprintf("%s|%s|%s", strings.ToLower(strings.TrimSpace(title)), year, strings.ToLower(strings.TrimSpace(originalTitle)))
	if cached, ok := drakorCache.Load(cacheKey); ok {
		if entry, okEntry := cached.(drakorCacheEntry); okEntry {
			if time.Now().Before(entry.exp) {
				return entry.result, nil
			}
			drakorCache.Delete(cacheKey)
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

	// Check for dedicated alias matches (e.g. Law and the City / A Bona Fide Killer)
	normTitle := strings.ToLower(title)
	if strings.Contains(normTitle, "bona fide") || strings.Contains(normTitle, "law and the city") || strings.Contains(normTitle, "seochodong") {
		keywords = append(keywords, "law and the city", "bona fide killer", "seochodong", "서초동")
	}

	client := &http.Client{Timeout: 4 * time.Second}
	reqCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()

	allEpisodes := make(map[string]map[string]string)
	var matchedChannel string

	// 1. First check dedicated specific channel if title matches Law and the City / Bona Fide Killer
	if strings.Contains(normTitle, "bona fide") || strings.Contains(normTitle, "law and the city") || strings.Contains(normTitle, "seochodong") {
		html, err := fetchChannelWeb(reqCtx, client, "Law_and_the_City_Drakorindo", "")
		if err == nil && len(html) > 0 {
			eps := parseDrakorChannelHTML(html, "Law_and_the_City_Drakorindo", keywords)
			if len(eps) > 0 {
				allEpisodes = eps
				matchedChannel = "Law_and_the_City_Drakorindo"
			}
		}
	}

	// 2. Search across general Drakor channels concurrently if not resolved yet
	if len(allEpisodes) == 0 {
		type chanResult struct {
			channel string
			eps     map[string]map[string]string
		}
		ch := make(chan chanResult, len(DrakorChannels))

		var wg sync.WaitGroup
		searchQuery := title
		if len(keywords) > 0 {
			searchQuery = keywords[0]
		}

		for _, chName := range DrakorChannels {
			wg.Add(1)
			go func(c string) {
				defer wg.Done()
				html, err := fetchChannelWeb(reqCtx, client, c, searchQuery)
				if err != nil || len(html) == 0 {
					return
				}
				eps := parseDrakorChannelHTML(html, c, keywords)
				if len(eps) > 0 {
					ch <- chanResult{channel: c, eps: eps}
				}
			}(chName)
		}

		// Close result channel when all routines finish
		go func() {
			wg.Wait()
			close(ch)
		}()

		for res := range ch {
			if len(res.eps) > 0 {
				allEpisodes = res.eps
				matchedChannel = res.channel
				break
			}
		}
	}

	if len(allEpisodes) == 0 {
		return nil, fmt.Errorf("no telegram episodes found for %s", title)
	}

	// Find first available episode for initial iframe
	var firstIframe string
	if s1, ok := allEpisodes["1"]; ok {
		if ep1, okEp := s1["1"]; okEp {
			firstIframe = ep1
		} else {
			for _, epURL := range s1 {
				firstIframe = epURL
				break
			}
		}
	} else {
		for _, sMap := range allEpisodes {
			for _, epURL := range sMap {
				firstIframe = epURL
				break
			}
			break
		}
	}

	res := &DrakorTelegramResult{
		Source:   "telegram",
		Name:     "Telegram (Drakorindo Sub Indo)",
		Channel:  matchedChannel,
		Iframe:   firstIframe,
		Episodes: allEpisodes,
	}

	// Cache for 2 hours
	drakorCache.Store(cacheKey, drakorCacheEntry{
		result: res,
		exp:    time.Now().Add(2 * time.Hour),
	})

	return res, nil
}

// TelegramDrakorHandler HTTP handler for /api/telegram/drakor
func TelegramDrakorHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	title := r.URL.Query().Get("title")
	year := r.URL.Query().Get("year")
	originalTitle := r.URL.Query().Get("original_title")

	if title == "" && originalTitle == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Title parameter required"})
		return
	}

	result, err := ResolveTelegramDrakor(r.Context(), title, year, originalTitle)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	json.NewEncoder(w).Encode(result)
}
