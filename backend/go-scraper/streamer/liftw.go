package streamer

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"scraper/scraper"
)

var liftwCache sync.Map

type cacheEntry struct {
	data []byte
	exp  time.Time
}

func init() {
	go func() {
		ticker := time.NewTicker(30 * time.Minute)
		for range ticker.C {
			now := time.Now()
			liftwCache.Range(func(key, value interface{}) bool {
				if entry, ok := value.(cacheEntry); ok {
					if now.After(entry.exp) {
						liftwCache.Delete(key)
					}
				}
				return true
			})
		}
	}()
}

type TMDBAltTitles struct {
	Results []struct {
		Title string `json:"title"`
	} `json:"results"`
	Titles []struct {
		Title string `json:"title"`
	} `json:"titles"`
}

type TMDBTranslations struct {
	Translations []struct {
		Data struct {
			Name  string `json:"name"`
			Title string `json:"title"`
		} `json:"data"`
	} `json:"translations"`
}

type TMDBResponse struct {
	Title             string           `json:"title"`
	Name              string           `json:"name"`
	OriginalTitle     string           `json:"original_title"`
	OriginalName      string           `json:"original_name"`
	AlternativeTitles TMDBAltTitles    `json:"alternative_titles"`
	Translations      TMDBTranslations `json:"translations"`
}

type LiftwSearchItem struct {
	ID         int    `json:"id"`
	Type       int    `json:"type"`
	Name       string `json:"name"`
	OriginName string `json:"origin_name"`
	Year       int    `json:"year"`
}

type LiftwSearchResponse struct {
	Items []LiftwSearchItem `json:"items"`
}

type LiftwInfoResponse struct {
	ID        int         `json:"id"`
	Type      int         `json:"type"`
	Name      string      `json:"name"`
	IframeURI string      `json:"iframe_uri"`
	Episodes  interface{} `json:"episodes"`
}

var normRegex = regexp.MustCompile(`[^a-zа-я0-9]`)

func normString(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, "ё", "е")
	return normRegex.ReplaceAllString(s, "")
}

func cleanWords(s string) []string {
	s = strings.ToLower(s)
	s = strings.ReplaceAll(s, "ё", "е")
	s = strings.ReplaceAll(s, "Ё", "е")
	var words []string
	for _, w := range strings.FieldsFunc(s, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	}) {
		if w != "" {
			words = append(words, w)
		}
	}
	return words
}

func matchesWords(itemWords, candWords []string) bool {
	if len(candWords) == 0 || len(itemWords) == 0 {
		return false
	}
	// If candidate is a single word, require >= 4 runes to prevent trivial collisions
	if len(candWords) == 1 {
		cw := candWords[0]
		if len([]rune(cw)) < 4 {
			return false
		}
		for _, iw := range itemWords {
			if iw == cw {
				return true
			}
		}
		return false
	}

	// For multi-word candidates, check sub-sequence
	for i := 0; i <= len(itemWords)-len(candWords); i++ {
		match := true
		for j := 0; j < len(candWords); j++ {
			if itemWords[i+j] != candWords[j] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}

func hasCyrillic(s string) bool {
	matched, _ := regexp.MatchString(`[а-яёА-ЯЁ]`, s)
	return matched
}

func hasLatin(s string) bool {
	matched, _ := regexp.MatchString(`[a-zA-Z]`, s)
	return matched
}

func uniqueStrings(input []string) []string {
	u := make([]string, 0, len(input))
	m := make(map[string]bool)
	for _, val := range input {
		if val == "" {
			continue
		}
		if _, ok := m[val]; !ok {
			m[val] = true
			u = append(u, val)
		}
	}
	return u
}

func sortCandidates(cands []string) []string {
	sort.SliceStable(cands, func(i, j int) bool {
		a := cands[i]
		b := cands[j]
		aCyr := hasCyrillic(a)
		bCyr := hasCyrillic(b)
		if aCyr && !bCyr {
			return true
		}
		if !aCyr && bCyr {
			return false
		}
		aLat := hasLatin(a)
		bLat := hasLatin(b)
		if aLat && !bLat {
			return true
		}
		if !aLat && bLat {
			return false
		}
		return false
	})
	return cands
}

func getDirectHttpClient(timeout time.Duration) *http.Client {
	return &http.Client{Timeout: timeout}
}

func doLiftwGetRequest(client *http.Client, targetUrl string) (*http.Response, error) {
	req, err := http.NewRequest("GET", targetUrl, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Accept-Language", "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7")
	req.Header.Set("Referer", "https://liftw.ws/")
	req.Header.Set("Origin", "https://liftw.ws")
	req.Header.Set("Sec-Fetch-Dest", "empty")
	req.Header.Set("Sec-Fetch-Mode", "cors")
	req.Header.Set("Sec-Fetch-Site", "same-site")
	return client.Do(req)
}

func fetchLiftwData(targetUrl string, timeout time.Duration, lastErr *string) (*http.Response, string) {
	// Stage 1: Try via Proxy (if PROXY_URL configured) with short 4s timeout
	proxyClient := scraper.GetHTTPClient(4 * time.Second)
	res, err := doLiftwGetRequest(proxyClient, targetUrl)
	if err == nil && res.StatusCode == 200 {
		return res, "proxy"
	}

	proxyFailReason := ""
	if err != nil {
		proxyFailReason = err.Error()
	} else if res != nil {
		proxyFailReason = fmt.Sprintf("status code %d", res.StatusCode)
		res.Body.Close()
	}

	// Stage 2: Immediate direct fallback without proxy
	directClient := scraper.GetDirectHTTPClient(timeout)
	directRes, directErr := doLiftwGetRequest(directClient, targetUrl)
	if directErr != nil {
		*lastErr = fmt.Sprintf("proxy failed (%s); direct failed: %v", proxyFailReason, directErr)
		return nil, ""
	}
	if directRes.StatusCode != 200 {
		*lastErr = fmt.Sprintf("proxy failed (%s); direct status code %d", proxyFailReason, directRes.StatusCode)
		directRes.Body.Close()
		return nil, ""
	}

	return directRes, "direct"
}

func searchLiftwCandidates(candidates []string, targetYear int, validTypesMap map[int]bool, lastErr *string) *LiftwSearchItem {
	searchLimit := 10
	if len(candidates) < 10 {
		searchLimit = len(candidates)
	}

	for _, cand := range candidates[:searchLimit] {
		searchUrl := fmt.Sprintf("https://api.liftw.ws/search?q=%s", url.QueryEscape(cand))
		var sRes LiftwSearchResponse

		res, via := fetchLiftwData(searchUrl, 6*time.Second, lastErr)
		if res == nil {
			continue
		}

		decodeErr := json.NewDecoder(res.Body).Decode(&sRes)
		res.Body.Close()
		if decodeErr != nil {
			*lastErr = fmt.Sprintf("via %s decode error: %v", via, decodeErr)
			continue
		}

		for i := range sRes.Items {
			item := sRes.Items[i]
			if !validTypesMap[item.Type] {
				continue
			}

			nameLower := normString(item.Name)
			origLower := normString(item.OriginName)
			matched := false
			for _, c := range candidates {
				cn := normString(c)
				if cn == "" {
					continue
				}
				// 1. Exact match on full string
				if nameLower == cn || origLower == cn {
					matched = true
					break
				}
				// 2. Exact match on slash-separated alternative titles (e.g. "Замужняя убийца / Замужняя женщина-убийца")
				for _, part := range strings.Split(item.Name, "/") {
					if normString(part) == cn {
						matched = true
						break
					}
				}
				if matched {
					break
				}
				for _, part := range strings.Split(item.OriginName, "/") {
					if normString(part) == cn {
						matched = true
						break
					}
				}
				if matched {
					break
				}

				// 3. Word-level match: if candidate matches whole word in item (e.g. "Ричер" in "Джек Ричер")
				cWords := cleanWords(c)
				if len(cWords) > 0 {
					nameWords := cleanWords(item.Name)
					origWords := cleanWords(item.OriginName)
					if matchesWords(nameWords, cWords) || matchesWords(origWords, cWords) {
						matched = true
						break
					}
				}
			}

			if matched {
				// High confidence match: exact or +/- 1 year allowance for release differences
				if targetYear == 0 || (item.Year >= targetYear-1 && item.Year <= targetYear+1) {
					return &item
				}
			}
		}
	}
	return nil
}

// ResolveLiftw resolves a streaming path for a movie/series and caches it.
// If bypassCache is true, it ignores the cache and forces a fresh query.
func ResolveLiftw(title, yearStr, vType, tmdb, titleRu, originalTitle string, bypassCache bool) ([]byte, error) {
	cacheKey := fmt.Sprintf("%s|%s|%s|%s|%s|%s", title, yearStr, vType, tmdb, titleRu, originalTitle)
	
	if !bypassCache {
		if val, ok := liftwCache.Load(cacheKey); ok {
			entry := val.(cacheEntry)
			if time.Now().Before(entry.exp) {
				return entry.data, nil
			}
			liftwCache.Delete(cacheKey)
		}
	}

	isSeries := (vType == "tv" || vType == "series")
	candidates := []string{strings.TrimSpace(title)}
	if titleRu != "" {
		candidates = append(candidates, strings.TrimSpace(titleRu))
	}
	if originalTitle != "" && originalTitle != title {
		candidates = append(candidates, strings.TrimSpace(originalTitle))
	}
	candidates = uniqueStrings(candidates)

	validTypesMap := make(map[int]bool)
	if isSeries {
		validTypesMap[3] = true
		validTypesMap[4] = true
		validTypesMap[5] = true
		validTypesMap[7] = true
	} else {
		validTypesMap[1] = true
		validTypesMap[2] = true
		validTypesMap[6] = true
	}

	targetYear := 0
	if yearStr != "" {
		if y, err := strconv.Atoi(yearStr); err == nil {
			targetYear = y
		}
	}

	var lastErr string
	// Fast path: try the exact title without calling TMDB!
	bestMatch := searchLiftwCandidates(candidates, targetYear, validTypesMap, &lastErr)

	// Fallback: If not found, fetch TMDB alternative titles and search them
	if bestMatch == nil && tmdb != "" {
		tmdbType := "movie"
		if isSeries {
			tmdbType = "tv"
		}
		tmdbUrl := fmt.Sprintf("https://api.themoviedb.org/3/%s/%s?api_key=%s&append_to_response=alternative_titles,translations", tmdbType, tmdb, getTMDBApiKey())
		client := scraper.GetHTTPClient(4 * time.Second)
		res, err := client.Get(tmdbUrl)
		if err == nil && res.StatusCode == 200 {
			var tData TMDBResponse
			if err := json.NewDecoder(res.Body).Decode(&tData); err == nil {
				candidates = append(candidates, strings.TrimSpace(tData.Title))
				candidates = append(candidates, strings.TrimSpace(tData.Name))
				candidates = append(candidates, strings.TrimSpace(tData.OriginalTitle))
				candidates = append(candidates, strings.TrimSpace(tData.OriginalName))

				for _, r := range tData.AlternativeTitles.Results {
					candidates = append(candidates, strings.TrimSpace(r.Title))
				}
				for _, t := range tData.AlternativeTitles.Titles {
					candidates = append(candidates, strings.TrimSpace(t.Title))
				}
				for _, tr := range tData.Translations.Translations {
					if tr.Data.Name != "" {
						candidates = append(candidates, strings.TrimSpace(tr.Data.Name))
					}
					if tr.Data.Title != "" {
						candidates = append(candidates, strings.TrimSpace(tr.Data.Title))
					}
				}
			}
			res.Body.Close()
		}
		candidates = uniqueStrings(candidates)
		candidates = sortCandidates(candidates)
		
		// Search all candidates with Cyrillic prioritized
		if len(candidates) > 0 {
			bestMatch = searchLiftwCandidates(candidates, targetYear, validTypesMap, &lastErr)
		}
	}

	if bestMatch == nil {
		if lastErr != "" {
			return nil, fmt.Errorf("exact match not found on liftw, last err: %v", lastErr)
		}
		return nil, fmt.Errorf("exact match not found on liftw")
	}

	infoUrl := fmt.Sprintf("https://api.liftw.ws/info/%d", bestMatch.ID)
	infoRes, infoVia := fetchLiftwData(infoUrl, 8*time.Second, &lastErr)
	if infoRes == nil {
		return nil, fmt.Errorf("failed to get info (%s)", lastErr)
	}
	defer infoRes.Body.Close()

	var info LiftwInfoResponse
	if err := json.NewDecoder(infoRes.Body).Decode(&info); err != nil {
		return nil, fmt.Errorf("failed to decode info via %s", infoVia)
	}

	response := map[string]interface{}{
		"liftwId":   info.ID,
		"liftwType": info.Type,
		"name":      info.Name,
		"iframe":    info.IframeURI,
	}
	if info.Episodes != nil {
		response["episodes"] = info.Episodes
	}

	responseBytes, err := json.Marshal(response)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal response")
	}

	// Cache the result for 3 hours (increased from 1 hour to support longer cache warming)
	liftwCache.Store(cacheKey, cacheEntry{
		data: responseBytes,
		exp:  time.Now().Add(3 * time.Hour),
	})

	return responseBytes, nil
}

func LiftwApiHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	title := r.URL.Query().Get("title")
	yearStr := r.URL.Query().Get("year")
	vType := r.URL.Query().Get("type")
	tmdb := r.URL.Query().Get("tmdb")
	bypassCache := r.URL.Query().Get("bypass_cache") == "true"

	if title == "" {
		http.Error(w, `{"error":"Title is required"}`, http.StatusBadRequest)
		return
	}

	titleRu := r.URL.Query().Get("title_ru")
	originalTitle := r.URL.Query().Get("original_title")

	type liftwRes struct {
		data []byte
		err  error
	}
	ch := make(chan liftwRes, 1)
	go func() {
		data, err := ResolveLiftw(title, yearStr, vType, tmdb, titleRu, originalTitle, bypassCache)
		ch <- liftwRes{data: data, err: err}
	}()

	select {
	case <-ctx.Done():
		http.Error(w, `{"error":"Liftw request timeout"}`, http.StatusGatewayTimeout)
		return
	case res := <-ch:
		if res.err != nil {
			status := http.StatusBadGateway
			errMsg := res.err.Error()
			if strings.Contains(errMsg, "not found") {
				status = http.StatusNotFound
			}
			http.Error(w, fmt.Sprintf(`{"error":%q}`, errMsg), status)
			return
		}
		w.Write(res.data)
	}
}
