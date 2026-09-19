package scraper

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"scraper/types"
)

func SearchAdult(ctx context.Context, query string, page int) []types.Video {
	cleanQ := strings.TrimSpace(strings.ToLower(query))
	if cleanQ == "популярное" || cleanQ == "популярный" || cleanQ == "популярные" || cleanQ == "" {
		cleanQ = "popular"
	}

	// 1. Parallel fetch from RedTube and Eporner with 4s timeout
	subCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()

	var (
		rtVideos []types.Video
		epVideos []types.Video
		wg       sync.WaitGroup
	)

	wg.Add(2)
	go func() {
		defer wg.Done()
		rtVideos = searchRedtube(subCtx, cleanQ, page)
	}()
	go func() {
		defer wg.Done()
		epVideos = searchEporner(subCtx, cleanQ, page)
	}()
	wg.Wait()

	// 2. Interleave results round-robin (RedTube, Eporner, RedTube, Eporner...)
	return interleaveVideos(rtVideos, epVideos)
}

func interleaveVideos(lists ...[]types.Video) []types.Video {
	maxLen := 0
	for _, list := range lists {
		if len(list) > maxLen {
			maxLen = len(list)
		}
	}
	var result []types.Video
	seen := make(map[string]bool)
	for i := 0; i < maxLen; i++ {
		for _, list := range lists {
			if i < len(list) {
				v := list[i]
				if !seen[v.ID] && v.ID != "" && v.Title != "" {
					seen[v.ID] = true
					result = append(result, v)
				}
			}
		}
	}
	return result
}


type redtubeSearchResponse struct {
	Videos []struct {
		Video struct {
			Duration     string `json:"duration"`
			Views        int    `json:"views"`
			VideoID      string `json:"video_id"`
			Rating       string `json:"rating"`
			Title        string `json:"title"`
			URL          string `json:"url"`
			EmbedURL     string `json:"embed_url"`
			DefaultThumb string `json:"default_thumb"`
			Thumb        string `json:"thumb"`
		} `json:"video"`
	} `json:"videos"`
}

func searchRedtube(ctx context.Context, query string, page int) []types.Video {
	q := strings.TrimSpace(query)
	if q == "" {
		q = "popular"
	}
	apiUrl := fmt.Sprintf("https://api.redtube.com/?data=redtube.Videos.searchVideos&output=json&search=%s&page=%d&thumbsize=medium", url.QueryEscape(q), page+1)
	client := GetAdultHTTPClient(5 * time.Second)
	req, err := http.NewRequestWithContext(ctx, "GET", apiUrl, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

	res, err := client.Do(req)
	// Resilient fallback: if proxy fails (e.g. 402 bandwidth limit or timeout), retry direct
	if err != nil || res == nil || res.StatusCode != 200 {
		if res != nil {
			res.Body.Close()
		}
		if ctx.Err() == nil {
			directClient := GetDirectHTTPClient(3 * time.Second)
			reqDirect, errD := http.NewRequestWithContext(ctx, "GET", apiUrl, nil)
			if errD == nil {
				reqDirect.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
				res, err = directClient.Do(reqDirect)
			}
		}
	}
	if err != nil || res == nil || res.StatusCode != 200 {
		if res != nil {
			res.Body.Close()
		}
		return nil
	}
	defer res.Body.Close()

	var data redtubeSearchResponse
	if err := json.NewDecoder(res.Body).Decode(&data); err != nil {
		return nil
	}

	var results []types.Video
	for _, item := range data.Videos {
		v := item.Video
		if v.VideoID != "" && v.Title != "" {
			thumb := v.DefaultThumb
			if thumb == "" {
				thumb = v.Thumb
			}
			results = append(results, types.Video{
				ID:       "rt_" + v.VideoID,
				Title:    v.Title,
				Poster:   thumb,
				Duration: v.Duration,
				Type:     "adult",
				Href:     v.URL,
			})
		}
	}
	return results
}

type epornerSearchResponse struct {
	Count  int `json:"count"`
	Videos []struct {
		ID           string `json:"id"`
		Title        string `json:"title"`
		LengthMin    string `json:"length_min"`
		DefaultThumb struct {
			SRC string `json:"src"`
		} `json:"default_thumb"`
		URL string `json:"url"`
	} `json:"videos"`
}

func searchEporner(ctx context.Context, query string, page int) []types.Video {
	q := strings.TrimSpace(query)
	if q == "" {
		q = "popular"
	}
	apiUrl := fmt.Sprintf("https://www.eporner.com/api/v2/video/search/?query=%s&per_page=30&page=%d&thumbsize=medium&format=json", url.QueryEscape(q), page+1)
	client := GetAdultHTTPClient(5 * time.Second)
	req, err := http.NewRequestWithContext(ctx, "GET", apiUrl, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

	res, err := client.Do(req)
	// Resilient fallback: if proxy fails (e.g. 402 bandwidth limit or timeout), retry direct
	if err != nil || res == nil || res.StatusCode != 200 {
		if res != nil {
			res.Body.Close()
		}
		if ctx.Err() == nil {
			directClient := GetDirectHTTPClient(3 * time.Second)
			reqDirect, errD := http.NewRequestWithContext(ctx, "GET", apiUrl, nil)
			if errD == nil {
				reqDirect.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
				res, err = directClient.Do(reqDirect)
			}
		}
	}
	if err != nil || res == nil || res.StatusCode != 200 {
		if res != nil {
			res.Body.Close()
		}
		return nil
	}
	defer res.Body.Close()

	var data epornerSearchResponse
	if err := json.NewDecoder(res.Body).Decode(&data); err != nil {
		return nil
	}

	var results []types.Video
	for _, v := range data.Videos {
		if v.ID != "" && v.Title != "" {
			thumb := v.DefaultThumb.SRC
			duration := v.LengthMin
			if !strings.Contains(duration, "min") && !strings.Contains(duration, ":") {
				duration += " min"
			}
			results = append(results, types.Video{
				ID:       "ep_" + v.ID,
				Title:    v.Title,
				Poster:   thumb,
				Duration: duration,
				Type:     "adult",
				Href:     v.URL,
			})
		}
	}
	return results
}

func AdultDetails(id string) *types.VideoDetails {
	if strings.HasPrefix(id, "rt_") {
		rtID := strings.TrimPrefix(id, "rt_")
		embedUrl := fmt.Sprintf("https://embed.redtube.com/?id=%s", rtID)
		return &types.VideoDetails{
			Iframe:  embedUrl,
			Mp4:     nil,
			Mirrors: []string{embedUrl},
		}
	}

	if strings.HasPrefix(id, "ep_") {
		epID := strings.TrimPrefix(id, "ep_")
		embedUrl := fmt.Sprintf("https://www.eporner.com/embed/%s/", epID)
		return &types.VideoDetails{
			Iframe:  embedUrl,
			Mp4:     nil,
			Mirrors: []string{embedUrl},
		}
	}

	return nil
}
