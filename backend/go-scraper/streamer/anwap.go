package streamer

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

var (
	anwapMirrors = []string{
		"https://mm.anwap.media",
		"https://mj.anwap.today",
		"https://anwap.tube",
		"https://anwap.vip",
	}
	anwapCache sync.Map
)

type AnwapResult struct {
	URL   string `json:"url"`
	Name  string `json:"name"`
	Error string `json:"error,omitempty"`
}

func fetchFromMirror(mirror string, client *http.Client, title string) (string, error) {
	searchUrl := fmt.Sprintf("%s/search?q=%s", mirror, url.QueryEscape(title))
	req, err := http.NewRequest("GET", searchUrl, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("mirror status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	html := string(body)

	// Regexp to match film/series page links
	reLink := regexp.MustCompile(`href="(/film/[^"]+|/serials/[^"]+|/movie/[^"]+)"`)
	matches := reLink.FindStringSubmatch(html)
	if len(matches) < 2 {
		return "", fmt.Errorf("no movie link found")
	}

	filmPath := matches[1]
	filmUrl := mirror + filmPath
	if strings.HasPrefix(filmPath, "http") {
		filmUrl = filmPath
	}

	// Fetch detail page
	reqDetail, _ := http.NewRequest("GET", filmUrl, nil)
	reqDetail.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	respDetail, err := client.Do(reqDetail)
	if err != nil {
		return "", err
	}
	defer respDetail.Body.Close()

	detailBody, err := io.ReadAll(respDetail.Body)
	if err != nil {
		return "", err
	}
	detailHtml := string(detailBody)

	// Regexp to extract iframe or mp4 video stream URL
	reStream := regexp.MustCompile(`(?i)(src|href)="([^"]+\.(mp4|m3u8)[^"]*|/embed/[^"]+|https?://[^"]*player[^"]*)"`)
	streamMatches := reStream.FindStringSubmatch(detailHtml)
	if len(streamMatches) >= 3 {
		streamUrl := streamMatches[2]
		if strings.HasPrefix(streamUrl, "/") {
			streamUrl = mirror + streamUrl
		}
		return streamUrl, nil
	}

	// Return filmUrl as player fallback if direct stream link is obfuscated
	return filmUrl, nil
}

func ResolveAnwap(title string) (*AnwapResult, error) {
	if title == "" {
		return nil, fmt.Errorf("title required")
	}

	cacheKey := strings.ToLower(strings.TrimSpace(title))
	if cached, ok := anwapCache.Load(cacheKey); ok {
		if res, isRes := cached.(*AnwapResult); isRes {
			return res, nil
		}
	}

	client := &http.Client{Timeout: 3 * time.Second}

	// Backend Mirror Carousel: Query all mirrors concurrently
	type resChanStruct struct {
		url string
		err error
	}
	ch := make(chan resChanStruct, len(anwapMirrors))

	for _, mirror := range anwapMirrors {
		go func(m string) {
			u, err := fetchFromMirror(m, client, title)
			ch <- resChanStruct{url: u, err: err}
		}(mirror)
	}

	var foundUrl string
	for i := 0; i < len(anwapMirrors); i++ {
		res := <-ch
		if res.err == nil && res.url != "" {
			foundUrl = res.url
			break
		}
	}

	if foundUrl == "" {
		return nil, fmt.Errorf("no live anwap mirror returned stream")
	}

	res := &AnwapResult{
		URL:  foundUrl,
		Name: "anwap",
	}
	anwapCache.Store(cacheKey, res)

	return res, nil
}

func AnwapApiHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	title := r.URL.Query().Get("title")
	if title == "" {
		http.Error(w, `{"error":"Title parameter is required"}`, http.StatusBadRequest)
		return
	}

	res, err := ResolveAnwap(title)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(res)
}
