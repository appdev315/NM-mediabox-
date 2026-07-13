package streamer

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

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

	isSeries := (vType == "tv" || vType == "series")
	
	candidates := []string{strings.TrimSpace(title)}

	if tmdb != "" {
		tmdbType := "movie"
		if isSeries {
			tmdbType = "tv"
		}
		tmdbUrl := fmt.Sprintf("https://api.themoviedb.org/3/%s/%s?api_key=cd5b69242e715dc87d65957d7460eba2&append_to_response=alternative_titles,translations", tmdbType, tmdb)
		client := &http.Client{Timeout: 4 * time.Second}
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
	}

	candidates = uniqueStrings(candidates)
	candidates = sortCandidates(candidates)

	// Valid types
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

	var bestMatch *LiftwSearchItem
	client := &http.Client{Timeout: 4 * time.Second}

	searchLimit := 3
	if len(candidates) < 3 {
		searchLimit = len(candidates)
	}

	for _, cand := range candidates[:searchLimit] {
		sUrl := fmt.Sprintf("https://api.liftw.ws/search?q=%s", url.QueryEscape(cand))
		res, err := client.Get(sUrl)
		if err != nil {
			continue
		}
		
		var sRes LiftwSearchResponse
		if err := json.NewDecoder(res.Body).Decode(&sRes); err == nil {
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
					bestMatch = &item
					break
				}
			}
		}
		res.Body.Close()

		if bestMatch != nil {
			break
		}
	}

	if bestMatch == nil {
		http.Error(w, `{"error":"Exact match not found on liftw"}`, http.StatusNotFound)
		return
	}

	infoUrl := fmt.Sprintf("https://api.liftw.ws/info/%d", bestMatch.ID)
	infoClient := &http.Client{Timeout: 8 * time.Second}
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

	if info.IframeURI == "" {
		http.Error(w, `{"error":"No iframe found on liftw"}`, http.StatusNotFound)
		return
	}

	resp := map[string]interface{}{
		"iframe":    info.IframeURI,
		"liftwId":   info.ID,
		"liftwType": info.Type,
		"name":      info.Name,
		"episodes":  info.Episodes,
	}
	json.NewEncoder(w).Encode(resp)
}
