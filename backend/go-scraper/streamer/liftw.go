package streamer

import (
	"crypto/tls"
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
	"sync/atomic"
	"time"
)

var (
	proxyUrls []string
	proxyOnce sync.Once
	proxyIdx  uint64
)

var liftwCache sync.Map

type cacheEntry struct {
	data []byte
	exp  time.Time
}

func getHttpClient(timeout time.Duration) *http.Client {
	proxyOnce.Do(func() {
		if p := os.Getenv("PROXY_URL"); p != "" {
			parts := strings.Split(p, ",")
			for _, part := range parts {
				part = strings.TrimSpace(part)
				if part != "" {
					proxyUrls = append(proxyUrls, part)
				}
			}
		}
	})

	client := &http.Client{Timeout: timeout}
	if len(proxyUrls) > 0 {
		idx := atomic.AddUint64(&proxyIdx, 1)
		proxyStr := proxyUrls[idx%uint64(len(proxyUrls))]
		if !strings.Contains(proxyStr, "://") {
			proxyStr = "http://" + proxyStr
		}
		if proxyUrl, err := url.Parse(proxyStr); err == nil {
			client.Transport = &http.Transport{
				Proxy:           http.ProxyURL(proxyUrl),
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			}
		}
	} else {
		client.Transport = &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		}
	}
	return client
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
	return normRegex.ReplaceAllString(s, "")
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

func searchLiftwCandidates(candidates []string, targetYear int, validTypesMap map[int]bool, lastErr *string) *LiftwSearchItem {
	searchLimit := 3
	if len(candidates) < 3 {
		searchLimit = len(candidates)
	}

	for _, cand := range candidates[:searchLimit] {
		searchUrl := fmt.Sprintf("https://api.liftw.ws/search?q=%s", url.QueryEscape(cand))
		var res *http.Response
		var err error
		var sRes LiftwSearchResponse
		success := false

		for attempt := 0; attempt < 3; attempt++ {
			client := getHttpClient(4 * time.Second)
			res, err = client.Get(searchUrl)
			if err != nil {
				*lastErr = err.Error()
				continue
			}
			if res.StatusCode != 200 {
				*lastErr = fmt.Sprintf("status code %d", res.StatusCode)
				res.Body.Close()
				continue
			}
			if decodeErr := json.NewDecoder(res.Body).Decode(&sRes); decodeErr == nil {
				success = true
				res.Body.Close()
				break
			}
			res.Body.Close()
		}

		if !success {
			continue
		}

		for i := range sRes.Items {
			item := sRes.Items[i]
			if !validTypesMap[item.Type] {
				continue
			}
			if targetYear > 0 {
				if item.Year != targetYear && item.Year != targetYear+1 && item.Year != targetYear-1 {
					continue
				}
			}

			nameLower := normString(item.Name)
			origLower := normString(item.OriginName)

			matched := false
			for _, c := range candidates {
				cn := normString(c)
				if nameLower == cn || origLower == cn {
					matched = true
					break
				}
			}
			if matched {
				return &item
			}
		}
	}
	return nil
}

func LiftwApiHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	title := r.URL.Query().Get("title")
	yearStr := r.URL.Query().Get("year")
	vType := r.URL.Query().Get("type")
	tmdb := r.URL.Query().Get("tmdb")

	if title == "" {
		http.Error(w, `{"error":"Title is required"}`, http.StatusBadRequest)
		return
	}

	cacheKey := fmt.Sprintf("%s|%s|%s|%s", title, yearStr, vType, tmdb)
	if val, ok := liftwCache.Load(cacheKey); ok {
		entry := val.(cacheEntry)
		if time.Now().Before(entry.exp) {
			w.Write(entry.data)
			return
		} else {
			liftwCache.Delete(cacheKey)
		}
	}

	isSeries := (vType == "tv" || vType == "series")
	candidates := []string{strings.TrimSpace(title)}

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
		tmdbUrl := fmt.Sprintf("https://api.themoviedb.org/3/%s/%s?api_key=cd5b69242e715dc87d65957d7460eba2&append_to_response=alternative_titles,translations", tmdbType, tmdb)
		client := getHttpClient(4 * time.Second)
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
		
		// Search the rest of candidates
		if len(candidates) > 1 {
			bestMatch = searchLiftwCandidates(candidates[1:], targetYear, validTypesMap, &lastErr)
		}
	}

	if bestMatch == nil {
		if lastErr != "" {
			http.Error(w, fmt.Sprintf(`{"error":"Exact match not found on liftw, last err: %v"}`, lastErr), http.StatusNotFound)
			return
		}
		http.Error(w, `{"error":"Exact match not found on liftw"}`, http.StatusNotFound)
		return
	}

	infoUrl := fmt.Sprintf("https://api.liftw.ws/info/%d", bestMatch.ID)
	infoClient := getHttpClient(8 * time.Second)
	infoRes, err := infoClient.Get(infoUrl)
	if err != nil || infoRes.StatusCode != 200 {
		http.Error(w, `{"error":"Failed to get info"}`, http.StatusInternalServerError)
		return
	}
	defer infoRes.Body.Close()

	var info LiftwInfoResponse
	if err := json.NewDecoder(infoRes.Body).Decode(&info); err != nil {
		http.Error(w, `{"error":"Failed to decode info"}`, http.StatusInternalServerError)
		return
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
	if err == nil {
		liftwCache.Store(cacheKey, cacheEntry{
			data: responseBytes,
			exp:  time.Now().Add(1 * time.Hour),
		})
	}

	w.Write(responseBytes)
}
