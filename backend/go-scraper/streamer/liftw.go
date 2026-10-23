package streamer

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
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
		Iso639_1 string `json:"iso_639_1"`
		Data     struct {
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

var (
	normRegex        = regexp.MustCompile(`[^a-zа-я0-9]`)
	validScriptRegex = regexp.MustCompile(`^[a-zA-Zа-яА-ЯёЁ0-9\s\-–—_:.,'\"!?+&()/\\#]+$`)
)

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

// calculateTokenDice вычисляет коэффициент Дайса (Dice similarity) для двух наборов токенов
func calculateTokenDice(itemWords, candWords []string) float64 {
	if len(itemWords) == 0 || len(candWords) == 0 {
		return 0
	}
	itemFreq := make(map[string]int, len(itemWords))
	for _, w := range itemWords {
		itemFreq[w]++
	}
	matches := 0
	for _, w := range candWords {
		if itemFreq[w] > 0 {
			matches++
			itemFreq[w]--
		}
	}
	return float64(2*matches) / float64(len(itemWords)+len(candWords))
}

// calculateMatchScore оценивает релевантность кандидата донора относительно тайтла (0–110 баллов)
func calculateMatchScore(item LiftwSearchItem, candidate string, targetYear int) (int, bool) {
	cn := normString(candidate)
	if cn == "" {
		return 0, false
	}

	nameLower := normString(item.Name)
	origLower := normString(item.OriginName)
	itemWords := cleanWords(item.Name)
	origWords := cleanWords(item.OriginName)
	candWords := cleanWords(candidate)

	isExact := false
	baseScore := 0

	// 1. Абсолютное совпадение полного названия или сегмента через слэш
	if nameLower == cn || origLower == cn {
		isExact = true
		baseScore = 100
	} else {
		for _, part := range strings.Split(item.Name, "/") {
			if normString(part) == cn {
				isExact = true
				baseScore = 100
				break
			}
		}
		if !isExact && item.OriginName != "" {
			for _, part := range strings.Split(item.OriginName, "/") {
				if normString(part) == cn {
					isExact = true
					baseScore = 100
					break
				}
			}
		}
	}

	// 2. Нечёткое совпадение по токенам (если нет 100% точного совпадения строки)
	if !isExact && len(candWords) > 0 {
		if len(candWords) == 1 {
			cw := candWords[0]
			// Однословные кандидаты допускаются ТОЛЬКО если и тайтл донора состоит не более чем из 2 слов
			matchInShort := false
			if len(itemWords) <= 2 {
				for _, iw := range itemWords {
					if iw == cw {
						matchInShort = true
						break
					}
				}
			}
			if !matchInShort && len(origWords) <= 2 {
				for _, ow := range origWords {
					if ow == cw {
						matchInShort = true
						break
					}
				}
			}
			if matchInShort {
				baseScore = 75
			}
		} else {
			diceName := calculateTokenDice(itemWords, candWords)
			diceOrig := calculateTokenDice(origWords, candWords)
			bestDice := diceName
			if diceOrig > bestDice {
				bestDice = diceOrig
			}
			if bestDice >= 0.70 {
				baseScore = int(bestDice*90 + 0.5)
			}
		}
	}

	if baseScore == 0 {
		return 0, false
	}

	// 3. Валидация года выпуска: строгая дельта +/- 2 года
	yearDelta := 0
	if targetYear > 0 && item.Year > 0 {
		yearDelta = item.Year - targetYear
		if yearDelta < 0 {
			yearDelta = -yearDelta
		}
	}

	yearBonus := 0
	if targetYear == 0 || item.Year == 0 {
		yearBonus = 0
	} else if yearDelta == 0 {
		yearBonus = 10
	} else if yearDelta == 1 {
		yearBonus = 5
	} else if yearDelta == 2 {
		yearBonus = 0
	} else {
		// Разница более 2 лет дисквалифицирует совпадение
		return 0, false
	}

	return baseScore + yearBonus, isExact
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
	// Query liftw directly (fast 2.5s) to protect proxy bandwidth for adult catalog
	directClient := scraper.GetDirectHTTPClient(2500 * time.Millisecond)
	directRes, directErr := doLiftwGetRequest(ctx, directClient, targetUrl)
	if directErr == nil && directRes.StatusCode == 200 {
		return directRes, "direct", nil
	}

	directFailReason := ""
	if directErr != nil {
		directFailReason = directErr.Error()
	} else if directRes != nil {
		directFailReason = fmt.Sprintf("status code %d", directRes.StatusCode)
		directRes.Body.Close()
	}

	if ctx.Err() != nil {
		return nil, "", ctx.Err()
	}

	// Optional fallback to LIFTW_PROXY_URL only if explicitly provided
	if liftwProxy := os.Getenv("LIFTW_PROXY_URL"); liftwProxy != "" {
		proxyClient := scraper.GetHTTPClient(2000 * time.Millisecond)
		res, err := doLiftwGetRequest(ctx, proxyClient, targetUrl)
		if err == nil && res.StatusCode == 200 {
			return res, "proxy", nil
		}
		if res != nil {
			res.Body.Close()
		}
	}

	return nil, "", fmt.Errorf("liftw direct failed: %s", directFailReason)
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
		itemsMu  sync.Mutex
		allItems []LiftwSearchItem
		seenIds  = make(map[int]bool)
		errMu    sync.Mutex
		wg       sync.WaitGroup
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

			itemsMu.Lock()
			for _, it := range sRes.Items {
				if !seenIds[it.ID] {
					seenIds[it.ID] = true
					allItems = append(allItems, it)
				}
			}
			itemsMu.Unlock()
		}(cand)
	}

	wg.Wait()

	// Выбор лучшего совпадения (Best-Match) по максимальному скорингу вместо жадного первого совпадения
	var bestMatch *LiftwSearchItem
	highestScore := 0

	for i := range allItems {
		item := allItems[i]
		if !validTypesMap[item.Type] {
			continue
		}

		for _, candName := range candidates {
			score, _ := calculateMatchScore(item, candName, targetYear)
			if score >= 70 && score > highestScore {
				highestScore = score
				found := item
				bestMatch = &found
				if highestScore >= 110 {
					break
				}
			}
		}
		if highestScore >= 110 {
			break
		}
	}

	return bestMatch
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
			// url.PathEscape нейтрализует path-инъекцию пользовательского tmdb в URL
			tmdbUrl := fmt.Sprintf("https://api.themoviedb.org/3/%s/%s?api_key=%s&append_to_response=alternative_titles,translations", tmdbType, url.PathEscape(tmdb), getTMDBApiKey())
			client := scraper.GetHTTPClient(4 * time.Second)
			req, rErr := http.NewRequestWithContext(resolveCtx, "GET", tmdbUrl, nil)
			if rErr == nil {
				res, err := client.Do(req)
				if err == nil && res != nil {
					if res.StatusCode == 200 {
						var tData TMDBResponse
						if err := json.NewDecoder(res.Body).Decode(&tData); err == nil {
							appendIfValid := func(s string) {
								s = strings.TrimSpace(s)
								if s != "" && validScriptRegex.MatchString(s) {
									candidates = append(candidates, s)
								}
							}
							appendIfValid(tData.Title)
							appendIfValid(tData.Name)
							appendIfValid(tData.OriginalTitle)
							appendIfValid(tData.OriginalName)

							for _, r := range tData.AlternativeTitles.Results {
								appendIfValid(r.Title)
							}
							for _, t := range tData.AlternativeTitles.Titles {
								appendIfValid(t.Title)
							}
							for _, tr := range tData.Translations.Translations {
								iso := tr.Iso639_1
								if iso == "ru" || iso == "en" || iso == "uk" || iso == "be" {
									appendIfValid(tr.Data.Name)
									appendIfValid(tr.Data.Title)
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
	// Cache-Control ставится только на успешный ответ (ниже): раньше заголовок
	// выставлялся до обработки ошибок, и промежуточные кэши держали 404/500 три часа.

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
		w.Header().Set("Cache-Control", "public, max-age=10800")
		w.Write(res.data)
	}
}
