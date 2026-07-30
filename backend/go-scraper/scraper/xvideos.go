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
	domains := []string{"www.xvideos2.com", "www.xvideos3.com", "www.xvideos.es", "www.xv-ru.com", "www.xvideos.com"}

	cleanQ := strings.TrimSpace(strings.ToLower(query))

	var res *http.Response
	var err error

	for _, domain := range domains {
		reqUrl := fmt.Sprintf("https://%s/", domain)
		if cleanQ != "" {
			reqUrl = fmt.Sprintf("https://%s/?k=%s&p=%d", domain, url.QueryEscape(cleanQ), page)
		} else if page > 0 {
			reqUrl = fmt.Sprintf("https://%s/new/%d/", domain, page)
		}

		req, _ := http.NewRequest("GET", reqUrl, nil)
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
		req.Header.Set("Accept-Language", "en-US,en;q=0.9")

		res, err = client.Do(req)
		if err == nil && res.StatusCode == 200 {
			break
		}
		if res != nil {
			res.Body.Close()
		}
	}

	if res == nil || res.StatusCode != 200 {
		return []types.Video{}
	}
	defer res.Body.Close()

	doc, err := goquery.NewDocumentFromReader(res.Body)
	if err != nil {
		return []types.Video{}
	}

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

	return videos
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
