package scraper

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"scraper/types"

	"github.com/PuerkitoBio/goquery"
)

var xvideosRegex = regexp.MustCompile(`/video\.([^/]+)`)

func SearchXvideos(query string, page int) []types.Video {
	client := GetHTTPClient(8 * time.Second)
	url := "https://www.xvideos.com/"
	if query != "" {
		url = fmt.Sprintf("https://www.xvideos.com/?k=%s&p=%d", query, page)
	} else if page > 0 {
		url = fmt.Sprintf("https://www.xvideos.com/new/%d/", page)
	}

	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	req.Header.Set("Cookie", "lang=english")

	res, err := client.Do(req)
	if err != nil || res.StatusCode != 200 {
		return []types.Video{}
	}
	defer res.Body.Close()

	doc, err := goquery.NewDocumentFromReader(res.Body)
	if err != nil {
		return []types.Video{}
	}

	var videos []types.Video
	durationRegex := regexp.MustCompile(`\s*\d+\s*(мин\.|sec\.|min\.)`)

	doc.Find(".mozaique .thumb-block").Each(func(i int, s *goquery.Selection) {
		titleNode := s.Find("p.title a")
		title := titleNode.Text()
		if title == "" {
			title, _ = s.Find("a").Attr("title")
		}
		title = durationRegex.ReplaceAllString(title, "")
		title = strings.TrimSpace(title)

		href, _ := s.Find("a").Attr("href")
		img, exists := s.Find("img").Attr("data-src")
		if !exists {
			img, _ = s.Find("img").Attr("src")
		}
		if strings.Contains(img, "THUMBNUM") {
			img = strings.Replace(img, "THUMBNUM", "1", 1)
		}

		duration := strings.TrimSpace(s.Find(".duration").Text())

		if title != "" && href != "" && img != "" && !strings.Contains(href, "promo") {
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

	return &types.VideoDetails{
		Iframe: fmt.Sprintf("https://www.xvideos.com/embedframe/%s", realID),
		Mp4:    nil,
	}
}
