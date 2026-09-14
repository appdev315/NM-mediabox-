package streamer

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"golang.org/x/sync/singleflight"
	"scraper/scraper"
)

var (
	liftwCache       sync.Map
	liftwSingleGroup singleflight.Group
)

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
	for _, r := range s {
		if (r >= 'а' && r <= 'я') || (r >= 'А' && r <= 'Я') || r == 'ё' || r == 'Ё' {
			return true
		}
	}
	return false
}

func hasLatin(s string) bool {
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
			return true
		}
	}
	return false
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

func expandTitleVariants(cands []string) []string {
	var res []string
	seen := make(map[string]bool)
	rePlus := regexp.MustCompile(`(?i)plus`)
	reRu := regexp.MustCompile(`(?i)плюс`)

	for _, c := range cands {
		c = strings.TrimSpace(c)
		if c == "" {
			continue
		}
		if !seen[c] {
			seen[c] = true
			res = append(res, c)
		}
		if strings.Contains(c, "+") {
			withPlusRu := strings.TrimSpace(strings.ReplaceAll(c, "+", " плюс"))
			if withPlusRu != "" && !seen[withPlusRu] {
				seen[withPlusRu] = true
				res = append(res, withPlusRu)
			}
			withPlusEn := strings.TrimSpace(strings.ReplaceAll(c, "+", " plus"))
			if withPlusEn != "" && !seen[withPlusEn] {
				seen[withPlusEn] = true
				res = append(res, withPlusEn)
			}
		}
		if strings.Contains(strings.ToLower(c), "plus") {
			withRu := strings.TrimSpace(rePlus.ReplaceAllString(c, "плюс"))
			if withRu != "" && !seen[withRu] {
				seen[withRu] = true
				res = append(res, withRu)
			}
			withSign := strings.TrimSpace(rePlus.ReplaceAllString(c, "+"))
			if withSign != "" && !seen[withSign] {
				seen[withSign] = true
				res = append(res, withSign)
			}
		}
		if strings.Contains(strings.ToLower(c), "плюс") {
			withEn := strings.TrimSpace(reRu.ReplaceAllString(c, "plus"))
			if withEn != "" && !seen[withEn] {
				seen[withEn] = true
				res = append(res, withEn)
			}
			withSign := strings.TrimSpace(reRu.ReplaceAllString(c, "+"))
			if withSign != "" && !seen[withSign] {
				seen[withSign] = true
				res = append(res, withSign)
			}
		}
	}
	return res
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

func doLiftwGetRequest(ctx context.Context, client *http.Client, targetUrl string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", targetUrl, nil)
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

func fetchLiftwData(ctx context.Context, targetUrl string) (*http.Response, string, error) {
	// Stage 1: Try via Proxy (if PROXY_URL configured) with short 1.5s timeout
	proxyClient := scraper.GetHTTPClient(1500 * time.Millisecond)
	res, err := doLiftwGetRequest(ctx, proxyClient, targetUrl)
	if err == nil && res.StatusCode == 200 {
		return res, "proxy", nil
	}

	proxyFailReason := ""
	if err != nil {
		proxyFailReason = err.Error()
	} else if res != nil {
		proxyFailReason = fmt.Sprintf("status code %d", res.StatusCode)
		res.Body.Close()
	}

	// If context was cancelled (e.g. early exit because another candidate won), do not attempt stage 2
	if ctx.Err() != nil {
		return nil, "", ctx.Err()
	}

	// Stage 2: Immediate direct fallback without proxy (2.5s)
	directClient := scraper.GetDirectHTTPClient(2500 * time.Millisecond)
	directRes, directErr := doLiftwGetRequest(ctx, directClient, targetUrl)
	if directErr != nil {
		return nil, "", fmt.Errorf("proxy failed (%s); direct failed: %w", proxyFailReason, directErr)
	}
	if directRes.StatusCode != 200 {
		code := directRes.StatusCode
		directRes.Body.Close()
		return nil, "", fmt.Errorf("proxy failed (%s); direct status code %d", proxyFailReason, code)
	}

	return directRes, "direct", nil
}

func searchLiftwCandidates(ctx context.Context, candidates []string, targetYear int, validTypesMap map[int]bool, lastErr *string) *LiftwSearchItem {
	searchLimit := 8
	if len(candidates) < 8 {
		searchLimit = len(candidates)
	}
	if searchLimit == 0 {
		return nil
	}

	searchCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	var (
		once      sync.Once
		bestMatch *LiftwSearchItem
		errMu     sync.Mutex
		wg        sync.WaitGroup
	)

	for _, cand := range candidates[:searchLimit] {
		wg.Add(1)
		go func(c string) {
			defer wg.Done()

			searchUrl := fmt.Sprintf("https://api.liftw.ws/search?q=%s", url.QueryEscape(c))
			res, via, err := fetchLiftwData(searchCtx, searchUrl)
			if err != nil {
				if searchCtx.Err() == nil {
					errMu.Lock()
					*lastErr = err.Error()
					errMu.Unlock()
				}
				return
			}
			if res == nil {
				return
			}

			var sRes LiftwSearchResponse
			decodeErr := json.NewDecoder(res.Body).Decode(&sRes)
			res.Body.Close()
			if decodeErr != nil {
				if searchCtx.Err() == nil {
					errMu.Lock()
					*lastErr = fmt.Sprintf("via %s decode error: %v", via, decodeErr)
					errMu.Unlock()
				}
				return
			}

			for i := range sRes.Items {
				if searchCtx.Err() != nil {
					return
				}

				item := sRes.Items[i]
				if !validTypesMap[item.Type] {
					continue
				}

				nameLower := normString(item.Name)
				origLower := normString(item.OriginName)
				matched := false
				for _, candName := range candidates {
					cn := normString(candName)
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
					cWords := cleanWords(candName)
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
					// Flexible +/- 2 year allowance for international festival & documentary release disparities
					if targetYear == 0 || (item.Year >= targetYear-2 && item.Year <= targetYear+2) {
						found := item
						once.Do(func() {
							bestMatch = &found
							cancel() // Early exit: cancel other concurrent searches immediately
						})
						return
					}
				}
			}
		}(cand)
	}

	wg.Wait()
	return bestMatch
}

var (
	lokTokenRegex = regexp.MustCompile(`var\s+lok\s*=\s*1\s*,\s*([a-zA-Z0-9_]+)\s*=\s*"([^"]+)"`)
	hlsRegex      = regexp.MustCompile(`\bhls\s*:\s*"([^"]+)"`)
	ccRegex       = regexp.MustCompile(`\bcc\s*:\s*(\[.*?\])\s*,\s*\n`)
	audioRegex    = regexp.MustCompile(`\baudio\s*:\s*(\{.*?\})\s*,\s*\n`)
)

type liftwEpDirect struct {
	Episode  int         `json:"episode"`
	Hls      string      `json:"hls"`
	Title    string      `json:"title"`
	Duration float64     `json:"duration"`
	Cc       interface{} `json:"cc"`
	Audio    struct {
		Names []string `json:"names"`
	} `json:"audio"`
}

type liftwSeasonDirect struct {
	Season   int             `json:"season"`
	Episodes []liftwEpDirect `json:"episodes"`
}

func extractDirectStreamsFromHtml(html string) (string, map[string]map[string]interface{}, []map[string]string, []string) {
	var token string
	if m := lokTokenRegex.FindStringSubmatch(html); len(m) > 2 {
		token = m[2]
	}

	idx := strings.Index(html, "seasons:[")
	if idx != -1 {
		depth := 0
		endIdx := idx + 8
		for i := idx + 8; i < len(html); i++ {
			if html[i] == '[' {
				depth++
			} else if html[i] == ']' {
				depth--
				if depth == 0 {
					endIdx = i + 1
					break
				}
			}
		}
		var seasons []liftwSeasonDirect
		if err := json.Unmarshal([]byte(html[idx+8:endIdx]), &seasons); err == nil {
			streams := make(map[string]map[string]interface{})
			for _, s := range seasons {
				sKey := strconv.Itoa(s.Season)
				streams[sKey] = make(map[string]interface{})
				for _, ep := range s.Episodes {
					eKey := strconv.Itoa(ep.Episode)
					hls := ep.Hls
					if hls != "" && token != "" {
						hls = hls + "&" + token
					}
					streams[sKey][eKey] = map[string]interface{}{
						"hls":      hls,
						"title":    ep.Title,
						"duration": ep.Duration,
						"cc":       ep.Cc,
						"audio":    ep.Audio.Names,
					}
				}
			}
			return "", streams, nil, nil
		}
	}

	if m := hlsRegex.FindStringSubmatch(html); len(m) > 1 {
		hls := m[1]
		if token != "" {
			hls = hls + "&" + token
		}
		var subtitles []map[string]string
		if mCc := ccRegex.FindStringSubmatch(html); len(mCc) > 1 {
			var ccList []struct {
				Name string `json:"name"`
				Url  string `json:"url"`
			}
			if err := json.Unmarshal([]byte(mCc[1]), &ccList); err == nil {
				for _, item := range ccList {
					if item.Url != "" {
						label := item.Name
						if label == "" {
							label = "Субтитры"
						}
						subtitles = append(subtitles, map[string]string{
							"src":   item.Url,
							"label": label,
						})
					}
				}
			}
		}

		var audioTracks []string
		if mAudio := audioRegex.FindStringSubmatch(html); len(mAudio) > 1 {
			var aObj struct {
				Names []string `json:"names"`
			}
			if err := json.Unmarshal([]byte(mAudio[1]), &aObj); err == nil {
				audioTracks = aObj.Names
			}
		}

		return hls, nil, subtitles, audioTracks
	}

	return "", nil, nil, nil
}

// ResolveLiftw resolves a streaming path for a movie/series and caches it.
// If bypassCache is true, it ignores the cache and forces a fresh query.
func ResolveLiftw(ctx context.Context, title, yearStr, vType, tmdb, titleRu, originalTitle string, bypassCache bool) ([]byte, error) {
	cacheKey := fmt.Sprintf("%s|%s|%s|%s|%s|%s", title, yearStr, vType, tmdb, titleRu, originalTitle)
	var tmdbKey string
	if tmdb != "" {
		canonicalType := "movie"
		if vType == "tv" || vType == "series" {
			canonicalType = "tv"
		}
		tmdbKey = fmt.Sprintf("tmdb:%s:%s", tmdb, canonicalType)
	}
	
	if bypassCache {
		liftwCache.Delete(cacheKey)
		if tmdbKey != "" {
			liftwCache.Delete(tmdbKey)
		}
	} else {
		// 1. Check canonical TMDB key first (shared with cache warmer)
		if tmdbKey != "" {
			if val, ok := liftwCache.Load(tmdbKey); ok {
				if entry, isEntry := val.(cacheEntry); isEntry {
					if time.Now().Before(entry.exp) {
						return entry.data, nil
					}
					liftwCache.Delete(tmdbKey)
				}
			}
		}
		// 2. Check title-based cache key
		if val, ok := liftwCache.Load(cacheKey); ok {
			if entry, isEntry := val.(cacheEntry); isEntry {
				if time.Now().Before(entry.exp) {
					return entry.data, nil
				}
				liftwCache.Delete(cacheKey)
			}
		}
	}

	flightKey := tmdbKey
	if flightKey == "" {
		flightKey = cacheKey
	}
	if bypassCache {
		flightKey = fmt.Sprintf("bypass:%s:%d", flightKey, time.Now().UnixNano())
	}

	val, err, _ := liftwSingleGroup.Do(flightKey, func() (interface{}, error) {
		if !bypassCache {
			if tmdbKey != "" {
				if v, ok := liftwCache.Load(tmdbKey); ok {
					if entry, isEntry := v.(cacheEntry); isEntry && time.Now().Before(entry.exp) {
						return entry.data, nil
					}
				}
			}
			if v, ok := liftwCache.Load(cacheKey); ok {
				if entry, isEntry := v.(cacheEntry); isEntry && time.Now().Before(entry.exp) {
					return entry.data, nil
				}
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
		candidates = expandTitleVariants(uniqueStrings(candidates))

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
		resolveCtx, cancel := context.WithTimeout(ctx, 7500*time.Millisecond)
		defer cancel()

		// Fast path: try the exact title without calling TMDB!
		bestMatch := searchLiftwCandidates(resolveCtx, candidates, targetYear, validTypesMap, &lastErr)

		// Fallback: If not found, fetch TMDB alternative titles and search them
		if bestMatch == nil && tmdb != "" {
			tmdbType := "movie"
			if isSeries {
				tmdbType = "tv"
			}
			tmdbUrl := fmt.Sprintf("https://api.themoviedb.org/3/%s/%s?api_key=%s&append_to_response=alternative_titles,translations", tmdbType, tmdb, getTMDBApiKey())
			client := scraper.GetHTTPClient(4 * time.Second)
			req, rErr := http.NewRequestWithContext(resolveCtx, "GET", tmdbUrl, nil)
			if rErr == nil {
				res, err := client.Do(req)
				if err == nil && res != nil {
					if res.StatusCode == 200 {
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
					}
					res.Body.Close()
				}
			}
			candidates = expandTitleVariants(uniqueStrings(candidates))
			candidates = sortCandidates(candidates)
			
			// Search all candidates with Cyrillic prioritized
			if len(candidates) > 0 {
				bestMatch = searchLiftwCandidates(resolveCtx, candidates, targetYear, validTypesMap, &lastErr)
			}
		}

		// Fallback: Cross-type match across all categories (1-7) for documentaries, miniseries, and specials
		if bestMatch == nil && len(candidates) > 0 {
			allTypesMap := map[int]bool{1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: true}
			bestMatch = searchLiftwCandidates(resolveCtx, candidates, targetYear, allTypesMap, &lastErr)
		}

		if bestMatch == nil {
			if lastErr != "" {
				return nil, fmt.Errorf("exact match not found on liftw, last err: %v", lastErr)
			}
			return nil, fmt.Errorf("exact match not found on liftw")
		}

		infoUrl := fmt.Sprintf("https://api.liftw.ws/info/%d", bestMatch.ID)
		infoRes, infoVia, infoErr := fetchLiftwData(resolveCtx, infoUrl)
		if infoRes == nil {
			if infoErr != nil {
				return nil, fmt.Errorf("failed to get info (%v)", infoErr)
			}
			return nil, fmt.Errorf("failed to get info")
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

		if info.IframeURI != "" {
			embedCtx, embedCancel := context.WithTimeout(resolveCtx, 3500*time.Millisecond)
			embedRes, _, embedErr := fetchLiftwData(embedCtx, info.IframeURI)
			if embedErr == nil && embedRes != nil {
				embedBytes, _ := io.ReadAll(embedRes.Body)
				embedRes.Body.Close()
				if len(embedBytes) > 0 {
					hls, streams, subs, audios := extractDirectStreamsFromHtml(string(embedBytes))
					if hls != "" {
						response["hls"] = hls
					}
					if len(streams) > 0 {
						response["streams"] = streams
					}
					if len(subs) > 0 {
						response["subtitles"] = subs
					}
					if len(audios) > 0 {
						response["audioTracks"] = audios
					}
				}
			}
			embedCancel()
		}

		responseBytes, err := json.Marshal(response)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal response")
		}

		// Cache the result for 3 hours (increased from 1 hour to support longer cache warming)
		cEntry := cacheEntry{
			data: responseBytes,
			exp:  time.Now().Add(3 * time.Hour),
		}
		liftwCache.Store(cacheKey, cEntry)
		if tmdbKey != "" {
			liftwCache.Store(tmdbKey, cEntry)
		}

		return responseBytes, nil
	})
	if err != nil {
		return nil, err
	}
	return val.([]byte), nil
}

func LiftwApiHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=10800")

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
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
		data, err := ResolveLiftw(ctx, title, yearStr, vType, tmdb, titleRu, originalTitle, bypassCache)
		ch <- liftwRes{data: data, err: err}
	}()

	select {
	case <-ctx.Done():
		http.Error(w, `{"error":"exact match not found on liftw"}`, http.StatusNotFound)
		return
	case res := <-ch:
		if res.err != nil {
			status := http.StatusNotFound
			errMsg := res.err.Error()
			http.Error(w, fmt.Sprintf(`{"error":%q}`, errMsg), status)
			return
		}
		w.Write(res.data)
	}
}
