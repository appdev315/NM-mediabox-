package scraper

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"scraper/types"

	"github.com/PuerkitoBio/goquery"
)

var xvideosRegex = regexp.MustCompile(`/video\.?([a-zA-Z0-9_-]+)`)

func SearchXvideos(query string, page int) []types.Video {
	client := GetHTTPClient(8 * time.Second)
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
			req, _ := http.NewRequest("GET", reqUrl, nil)
			req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
			req.Header.Set("Accept-Language", "en-US,en;q=0.9")
			req.Header.Set("Cookie", "age_verified=1; lang=english")

			res, err := client.Do(req)
			if err == nil && res != nil && (res.StatusCode == 200 || res.StatusCode == 500) {
				doc, errDoc := goquery.NewDocumentFromReader(res.Body)
				res.Body.Close()
				if errDoc == nil {
					var videos []types.Video
					durationRegex := regexp.MustCompile(`\s*\d+\s*(мин\.|sec\.|min\.)`)

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

func XvideosDetails(id string) *types.VideoDetails {
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
