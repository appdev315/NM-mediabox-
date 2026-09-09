package streamer

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
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
		"https://m.anwap.media",
		"https://m.anwap.movie",
	}
	anwapCache sync.Map

	reFilmLink   = regexp.MustCompile(`(?i)<a[^>]+href="(/films/\d+)"[^>]*>([\s\S]*?)</a>`)
	reOrtified   = regexp.MustCompile(`(?i)(https?://api\.ortified\.ws/embed/[^"'\s>]+)`)
	reStream     = regexp.MustCompile(`href="(/films/load/[0-9a-fA-F]+/\d+/\d+)"`)
	htmlTagRegex = regexp.MustCompile(`<[^>]*>`)

	diacriticReplacer = strings.NewReplacer(
		"á", "a", "à", "a", "â", "a", "ä", "a", "ã", "a", "å", "a",
		"é", "e", "è", "e", "ê", "e", "ë", "e",
		"í", "i", "ì", "i", "î", "i", "ï", "i",
		"ó", "o", "ò", "o", "ô", "o", "ö", "o", "õ", "o", "ø", "o",
		"ú", "u", "ù", "u", "û", "u", "ü", "u",
		"ñ", "n", "ç", "c", "ý", "y", "ÿ", "y",
		"Á", "a", "À", "a", "Â", "a", "Ä", "a",
		"É", "e", "È", "e", "Ê", "e", "Ë", "e",
		"Í", "i", "Ì", "i", "Î", "i", "Ï", "i",
		"Ó", "o", "Ò", "o", "Ô", "o", "Ö", "o",
		"Ú", "u", "Ù", "u", "Û", "u", "Ü", "u",
		"Ñ", "n", "Ç", "c",
	)
)

func cleanAnwapString(s string) string {
	s = html.UnescapeString(s)
	s = htmlTagRegex.ReplaceAllString(s, " ")
	s = diacriticReplacer.Replace(s)
	return normString(s)
}

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

	// Match film detail page links and their titles
	allMatches := reFilmLink.FindAllStringSubmatch(html, 15)
	if len(allMatches) == 0 {
		return "", fmt.Errorf("no movie link found")
	}

	normQuery := cleanAnwapString(title)
	var chosenPath string

	for _, m := range allMatches {
		linkPath := m[1]
		linkText := cleanAnwapString(m[2])
		if linkText != "" && normQuery != "" && (strings.Contains(linkText, normQuery) || strings.Contains(normQuery, linkText) || linkText == normQuery) {
			chosenPath = linkPath
			break
		}
	}

	// If query has subtitle or multiple words, do not pick an unrelated first result
	if chosenPath == "" {
		if len(allMatches) == 1 {
			chosenPath = allMatches[0][1]
		} else {
			return "", fmt.Errorf("no accurate title match found for %s", title)
		}
	}

	filmUrl := mirror + chosenPath

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
	// Priority 1: stable Ortified embed iframe (works in Player.tsx, no X-Frame-Options)
	if m := reOrtified.FindStringSubmatch(detailHtml); len(m) >= 2 {
		return strings.TrimSpace(m[1]), nil
	}

	// Priority 2: fallback to direct video stream download URL (hex token)
	streamMatches := reStream.FindStringSubmatch(detailHtml)
	if len(streamMatches) >= 2 {
		streamCandidate := mirror + streamMatches[1]

		// Verify stream candidate content-type and resolve final CDN redirect URL
		verifyReq, err := http.NewRequestWithContext(ctx, "GET", streamCandidate, nil)
		if err == nil {
			verifyReq.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
			verifyReq.Header.Set("Referer", filmUrl)
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
				if strings.HasPrefix(cType, "video/") || strings.Contains(cType, "application/") || strings.Contains(finalURL, "/films/load/") {
					return finalURL, nil
				}
				return "", fmt.Errorf("invalid content-type: %s", cType)
			}
		}
		return "", fmt.Errorf("failed to verify stream candidate")
	}

	return "", fmt.Errorf("no direct stream link found on detail page")
}

func queryMirrorsForTitle(ctx context.Context, client *http.Client, cand string) string {
	type resChanStruct struct {
		url string
		err error
	}
	reqCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()

	ch := make(chan resChanStruct, len(anwapMirrors))
	for _, mirror := range anwapMirrors {
		go func(m string) {
			u, err := fetchFromMirror(reqCtx, m, client, cand)
			ch <- resChanStruct{url: u, err: err}
		}(mirror)
	}

	for i := 0; i < len(anwapMirrors); i++ {
		res := <-ch
		if res.err == nil && res.url != "" {
			cancel()
			return res.url
		}
	}
	return ""
}

func ResolveAnwap(ctx context.Context, title, titleRu, originalTitle, tmdb string) (*AnwapResult, error) {
	if title == "" && titleRu == "" && originalTitle == "" && tmdb == "" {
		return nil, fmt.Errorf("title or metadata required")
	}

	cacheKey := fmt.Sprintf("%s|%s|%s|%s", strings.TrimSpace(title), strings.TrimSpace(titleRu), strings.TrimSpace(originalTitle), strings.TrimSpace(tmdb))
	tmdbKey := ""
	if tmdb != "" {
		tmdbKey = "anwap_tmdb:" + tmdb
		if cached, ok := anwapCache.Load(tmdbKey); ok {
			if entry, okEntry := cached.(cacheAnwapEntry); okEntry && time.Now().Before(entry.exp) {
				return entry.res, nil
			}
		}
	}
	if cached, ok := anwapCache.Load(cacheKey); ok {
		if entry, okEntry := cached.(cacheAnwapEntry); okEntry {
			if time.Now().Before(entry.exp) && (strings.HasPrefix(entry.res.URL, "http") && (!strings.Contains(entry.res.URL, "/films/") || strings.Contains(entry.res.URL, "/films/load/"))) {
				return entry.res, nil
			}
			anwapCache.Delete(cacheKey)
		}
	}

	client := &http.Client{Timeout: 3 * time.Second}

	var candidates []string
	if titleRu != "" {
		candidates = append(candidates, strings.TrimSpace(titleRu))
	}
	if originalTitle != "" && originalTitle != titleRu {
		candidates = append(candidates, strings.TrimSpace(originalTitle))
	}
	if title != "" && title != titleRu && title != originalTitle {
		candidates = append(candidates, strings.TrimSpace(title))
	}
	candidates = uniqueStrings(candidates)
	if len(candidates) == 0 && title != "" {
		candidates = []string{strings.TrimSpace(title)}
	}

	var foundUrl string
	for _, cand := range candidates {
		if cand == "" {
			continue
		}
		if u := queryMirrorsForTitle(ctx, client, cand); u != "" {
			foundUrl = u
			break
		}
	}

	// Fallback: If not found and TMDB ID provided, query TMDB translations & alt titles
	if foundUrl == "" && tmdb != "" {
		for _, mediaType := range []string{"movie", "tv"} {
			tmdbUrl := fmt.Sprintf("https://api.themoviedb.org/3/%s/%s?api_key=%s&append_to_response=alternative_titles,translations", mediaType, tmdb, getTMDBApiKey())
			req, rErr := http.NewRequestWithContext(ctx, "GET", tmdbUrl, nil)
			if rErr == nil {
				resp, err := client.Do(req)
				if err == nil && resp != nil {
					if resp.StatusCode == 200 {
						var tData TMDBResponse
						if err := json.NewDecoder(resp.Body).Decode(&tData); err == nil {
							var moreCands []string
							if tData.Title != "" {
								moreCands = append(moreCands, strings.TrimSpace(tData.Title))
							}
							if tData.Name != "" {
								moreCands = append(moreCands, strings.TrimSpace(tData.Name))
							}
							for _, tr := range tData.Translations.Translations {
								if tr.Data.Title != "" {
									moreCands = append(moreCands, strings.TrimSpace(tr.Data.Title))
								}
								if tr.Data.Name != "" {
									moreCands = append(moreCands, strings.TrimSpace(tr.Data.Name))
								}
							}
							for _, alt := range tData.AlternativeTitles.Results {
								if alt.Title != "" {
									moreCands = append(moreCands, strings.TrimSpace(alt.Title))
								}
							}
							for _, alt := range tData.AlternativeTitles.Titles {
								if alt.Title != "" {
									moreCands = append(moreCands, strings.TrimSpace(alt.Title))
								}
							}
							moreCands = uniqueStrings(moreCands)
							moreCands = sortCandidates(moreCands)

							for _, cand := range moreCands {
								if cand == "" {
									continue
								}
								if u := queryMirrorsForTitle(ctx, client, cand); u != "" {
									foundUrl = u
									break
								}
							}
						}
					}
					resp.Body.Close()
				}
			}
			if foundUrl != "" {
				break
			}
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
	if tmdbKey != "" {
		anwapCache.Store(tmdbKey, cacheAnwapEntry{res: res, exp: time.Now().Add(1 * time.Hour)})
	}

	return res, nil
}

func AnwapApiHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	title := r.URL.Query().Get("title")
	titleRu := r.URL.Query().Get("title_ru")
	originalTitle := r.URL.Query().Get("original_title")
	tmdb := r.URL.Query().Get("tmdb")

	if title == "" && titleRu == "" && tmdb == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Title or TMDB parameter is required"})
		return
	}

	res, err := ResolveAnwap(r.Context(), title, titleRu, originalTitle, tmdb)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	json.NewEncoder(w).Encode(res)
}
