package streamer

import (
	"context"
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
		"https://my.anwap.love",
		"https://anwap.film",
		"https://mm.anwap.media",
		"https://anwap.org",
	}
	anwapCache sync.Map
)

type cacheAnwapEntry struct {
	res *AnwapResult
	exp time.Time
}

func init() {
	go func() {
		ticker := time.NewTicker(30 * time.Minute)
		for range ticker.C {
			now := time.Now()
			anwapCache.Range(func(key, value interface{}) bool {
				if entry, ok := value.(cacheAnwapEntry); ok {
					if now.After(entry.exp) {
						anwapCache.Delete(key)
					}
				}
				return true
			})
		}
	}()
}

type AnwapResult struct {
	URL   string `json:"url"`
	Name  string `json:"name"`
	Error string `json:"error,omitempty"`
}

func fetchFromMirror(ctx context.Context, mirror string, client *http.Client, title string) (string, error) {
	searchUrl := fmt.Sprintf("%s/films/search/?slv=%s&vid=1", mirror, url.QueryEscape(title))
	req, err := http.NewRequestWithContext(ctx, "GET", searchUrl, nil)
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

	body, err := io.ReadAll(io.LimitReader(resp.Body, 5<<20))
	if err != nil {
		return "", err
	}

	html := string(body)

	// Regexp to match film detail page links
	reLink := regexp.MustCompile(`href="(/films/\d+)"`)
	matches := reLink.FindStringSubmatch(html)
	if len(matches) < 2 {
		return "", fmt.Errorf("no movie link found")
	}

	filmUrl := mirror + matches[1]

	// Fetch detail page
	reqDetail, err := http.NewRequestWithContext(ctx, "GET", filmUrl, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create detail request: %w", err)
	}
	reqDetail.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

	respDetail, err := client.Do(reqDetail)
	if err != nil {
		return "", fmt.Errorf("failed to fetch detail page: %w", err)
	}
	defer respDetail.Body.Close()

	detailBody, err := io.ReadAll(io.LimitReader(respDetail.Body, 5<<20))
	if err != nil {
		return "", fmt.Errorf("failed to read detail page: %w", err)
	}
	detailHtml := string(detailBody)

	// Regexp to extract direct video stream download URL (hex token)
	reStream := regexp.MustCompile(`href="(/films/load/[0-9a-fA-F]+/\d+/\d+)"`)
	streamMatches := reStream.FindStringSubmatch(detailHtml)
	if len(streamMatches) >= 2 {
		streamCandidate := mirror + streamMatches[1]

		// Verify stream candidate content-type and resolve final CDN redirect URL
		verifyReq, err := http.NewRequestWithContext(ctx, "GET", streamCandidate, nil)
		if err == nil {
			verifyReq.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
			verifyReq.Header.Set("Range", "bytes=0-1024")
			verifyResp, err := client.Do(verifyReq)
			if err == nil {
				defer verifyResp.Body.Close()
				finalURL := verifyResp.Request.URL.String()
				cType := strings.ToLower(verifyResp.Header.Get("Content-Type"))

				// Reject if redirected back to an HTML page
				if strings.Contains(cType, "text/html") || (strings.Contains(finalURL, "/films/") && !strings.Contains(finalURL, "/films/load/")) {
					return "", fmt.Errorf("stream candidate redirected to html page: %s", finalURL)
				}
				// Return resolved direct CDN or media stream URL
				if strings.HasPrefix(cType, "video/") || strings.Contains(cType, "application/") || strings.Contains(finalURL, ".anwap.") || strings.Contains(finalURL, "/films/load/") {
					return finalURL, nil
				}
				return "", fmt.Errorf("invalid content-type: %s", cType)
			}
		}
		return "", fmt.Errorf("failed to verify stream candidate")
	}

	return "", fmt.Errorf("no direct stream link found on detail page")
}

func ResolveAnwap(ctx context.Context, title string) (*AnwapResult, error) {
	if title == "" {
		return nil, fmt.Errorf("title required")
	}

	cacheKey := strings.ToLower(strings.TrimSpace(title))
	if cached, ok := anwapCache.Load(cacheKey); ok {
		if entry, okEntry := cached.(cacheAnwapEntry); okEntry {
			if time.Now().Before(entry.exp) && (strings.HasPrefix(entry.res.URL, "http") && (!strings.Contains(entry.res.URL, "/films/") || strings.Contains(entry.res.URL, "/films/load/"))) {
				return entry.res, nil
			}
			anwapCache.Delete(cacheKey)
		}
	}

	reqCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()

	client := &http.Client{Timeout: 3 * time.Second}

	// Backend Mirror Carousel: Query live mirrors concurrently
	type resChanStruct struct {
		url string
		err error
	}
	ch := make(chan resChanStruct, len(anwapMirrors))

	for _, mirror := range anwapMirrors {
		go func(m string) {
			u, err := fetchFromMirror(reqCtx, m, client, title)
			ch <- resChanStruct{url: u, err: err}
		}(mirror)
	}

	var foundUrl string
	for i := 0; i < len(anwapMirrors); i++ {
		res := <-ch
		if res.err == nil && res.url != "" {
			foundUrl = res.url
			cancel() // Cancel pending mirror requests once a valid stream is found
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
	anwapCache.Store(cacheKey, cacheAnwapEntry{res: res, exp: time.Now().Add(1 * time.Hour)})

	return res, nil
}

func AnwapApiHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	title := r.URL.Query().Get("title")
	if title == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Title parameter is required"})
		return
	}

	res, err := ResolveAnwap(r.Context(), title)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	json.NewEncoder(w).Encode(res)
}
