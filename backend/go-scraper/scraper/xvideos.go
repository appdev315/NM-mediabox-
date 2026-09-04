package scraper

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"scraper/types"

	"github.com/PuerkitoBio/goquery"
)

var (
	xvideosRegex  = regexp.MustCompile(`/video\.?([a-zA-Z0-9_-]+)`)
	durationRegex = regexp.MustCompile(`\s*\d+\s*(мин\.|sec\.|min\.)`)
)

func SearchXvideos(query string, page int) []types.Video {
	// 1. High-speed primary provider: RedTube Public API
	rtVideos := searchRedtube(query, page)
	if len(rtVideos) > 0 {
		return rtVideos
	}

	// 2. Secondary provider: XVideos scraper
	client := GetHTTPClient(5 * time.Second)
	domains := []string{"www.xvideos.com", "www.xvideos2.com", "www.xvideos3.com", "www.xv-ru.com", "www.xvideos.es"}

	cleanQ := strings.TrimSpace(strings.ToLower(query))
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
			req, err := http.NewRequest("GET", reqUrl, nil)
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

func searchRedtube(query string, page int) []types.Video {
	q := strings.TrimSpace(query)
	if q == "" {
		q = "popular"
	}
	apiUrl := fmt.Sprintf("https://api.redtube.com/?data=redtube.Videos.searchVideos&output=json&search=%s&page=%d&thumbsize=medium", url.QueryEscape(q), page+1)
	client := &http.Client{Timeout: 6 * time.Second}
	req, err := http.NewRequest("GET", apiUrl, nil)
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
