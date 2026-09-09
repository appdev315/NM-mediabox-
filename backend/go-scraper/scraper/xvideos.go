package scraper

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"scraper/types"

	"github.com/PuerkitoBio/goquery"
)

var (
	xvideosRegex  = regexp.MustCompile(`/video\.?([a-zA-Z0-9_-]+)`)
	durationRegex = regexp.MustCompile(`\s*\d+\s*(мин\.|sec\.|min\.)`)
)

func SearchXvideos(ctx context.Context, query string, page int) []types.Video {
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
	mixed := interleaveVideos(rtVideos, epVideos)
	if len(mixed) > 0 {
		return mixed
	}

	// 3. Fallback to XVideos HTML scraper if both APIs returned no results
	return searchXvideosHtml(ctx, cleanQ, page)
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

func searchXvideosHtml(ctx context.Context, cleanQ string, page int) []types.Video {
	client := GetHTTPClient(5 * time.Second)
	domains := []string{"www.xvideos.com", "www.xvideos2.com", "www.xvideos3.com", "www.xv-ru.com", "www.xvideos.es"}

	tagQ := strings.ReplaceAll(cleanQ, " ", "-")

	for _, domain := range domains {
		var reqUrls []string
		if cleanQ != "" {
			if page > 0 {
				reqUrls = []string{
					fmt.Sprintf("https://%s/tags/%s/%d", domain, url.PathEscape(tagQ), page),
					fmt.Sprintf("https://%s/?k=%s&p=%d", domain, url.QueryEscape(cleanQ), page),
				}
			} else {
				reqUrls = []string{
					fmt.Sprintf("https://%s/tags/%s", domain, url.PathEscape(tagQ)),
					fmt.Sprintf("https://%s/?k=%s", domain, url.QueryEscape(cleanQ)),
				}
			}
		} else {
			if page > 0 {
				reqUrls = []string{fmt.Sprintf("https://%s/new/%d/", domain, page)}
			} else {
				reqUrls = []string{fmt.Sprintf("https://%s/", domain)}
			}
		}

		for _, reqUrl := range reqUrls {
			if ctx.Err() != nil {
				return nil
			}
			req, err := http.NewRequestWithContext(ctx, "GET", reqUrl, nil)
			if err != nil {
				continue
			}
			req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
			req.Header.Set("Accept-Language", "en-US,en;q=0.9")
			req.Header.Set("Cookie", "age_verified=1; lang=english")

			res, err := client.Do(req)
			if err == nil && res != nil && (res.StatusCode == 200 || res.StatusCode == 500) {
				doc, errDoc := goquery.NewDocumentFromReader(res.Body)
				res.Body.Close()
				if errDoc == nil {
					var videos []types.Video

					doc.Find(".thumb-block, div[id^='video_']").Each(func(i int, s *goquery.Selection) {
						titleNode := s.Find("p.title a")
						title := titleNode.Text()
						if title == "" {
							title, _ = s.Find("a").Attr("title")
						}
						title = durationRegex.ReplaceAllString(title, "")
						title = strings.TrimSpace(title)

						href, _ := s.Find("a").Attr("href")
						img, exists := s.Find("img").Attr("data-src")
						if !exists || img == "" || strings.Contains(img, "lightbox-blank.gif") {
							img, _ = s.Find("img").Attr("src")
						}
						img = strings.Replace(img, "THUMBNUM", "1", 1)

						duration := strings.TrimSpace(s.Find(".duration").Text())

						if title != "" && href != "" && img != "" && !strings.Contains(href, "promo") && !strings.Contains(img, "lightbox-blank.gif") {
							id := ""
							matches := xvideosRegex.FindStringSubmatch(href)
							if len(matches) > 1 {
								id = matches[1]
							} else {
								id = base64.StdEncoding.EncodeToString([]byte(href))
							}

							videos = append(videos, types.Video{
								ID:       id,
								Title:    title,
								Poster:   img,
								Duration: duration,
								Type:     "adult",
								Href:     href,
							})
						}
					})

					if len(videos) > 0 {
						return videos
					}
				}
			} else if res != nil {
				res.Body.Close()
			}
		}
	}

	return []types.Video{}
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
	client := &http.Client{Timeout: 6 * time.Second}
	req, err := http.NewRequestWithContext(ctx, "GET", apiUrl, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

	res, err := client.Do(req)
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
	client := &http.Client{Timeout: 6 * time.Second}
	req, err := http.NewRequestWithContext(ctx, "GET", apiUrl, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

	res, err := client.Do(req)
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

func XvideosDetails(id string) *types.VideoDetails {
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

	realID := id
	if strings.HasPrefix(id, "video.") {
		parts := strings.Split(id, ".")
		if len(parts) > 1 {
			realID = parts[1]
		}
	} else if strings.HasPrefix(id, "/video.") {
		matches := xvideosRegex.FindStringSubmatch(id)
		if len(matches) > 1 {
			realID = matches[1]
		}
	}

	mirrors := []string{
		fmt.Sprintf("https://www.xv-ru.com/embedframe/%s", realID),
		fmt.Sprintf("https://www.xvideos2.com/embedframe/%s", realID),
		fmt.Sprintf("https://www.xvideos3.com/embedframe/%s", realID),
		fmt.Sprintf("https://www.xvideos.es/embedframe/%s", realID),
		fmt.Sprintf("https://www.xvideos.com/embedframe/%s", realID),
	}

	return &types.VideoDetails{
		Iframe:  mirrors[0],
		Mp4:     nil,
		Mirrors: mirrors,
	}
}
