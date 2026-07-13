package scraper

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	"scraper/types"
)

type EpornerResponse struct {
	Videos []struct {
		ID           string `json:"id"`
		Title        string `json:"title"`
		URL          string `json:"url"`
		LengthMin    string `json:"length_min"`
		DefaultThumb struct {
			Src string `json:"src"`
		} `json:"default_thumb"`
	} `json:"videos"`
}

func SearchEporner(query string, page int) []types.Video {
	client := GetHTTPClient(8 * time.Second)
	epPage := page + 1
	searchQ := "popular"
	if query != "" {
		searchQ = url.QueryEscape(query)
	}

	apiUrl := fmt.Sprintf("https://www.eporner.com/api/v2/video/search/?query=%s&per_page=30&page=%d&thumbsize=big", searchQ, epPage)
	res, err := client.Get(apiUrl)
	if err != nil || res.StatusCode != 200 {
		return []types.Video{}
	}
	defer res.Body.Close()

	var apiRes EpornerResponse
	if err := json.NewDecoder(res.Body).Decode(&apiRes); err != nil {
		return []types.Video{}
	}

	var videos []types.Video
	for _, v := range apiRes.Videos {
		videos = append(videos, types.Video{
			ID:       fmt.Sprintf("eporner_%s", v.ID),
			Title:    v.Title,
			Poster:   v.DefaultThumb.Src,
			Duration: v.LengthMin,
			Type:     "adult",
			Href:     v.URL,
		})
	}

	return videos
}

func EpornerDetails(id string) *types.VideoDetails {
	realID := strings.Replace(id, "eporner_", "", 1)
	return &types.VideoDetails{
		Iframe: fmt.Sprintf("https://www.eporner.com/embed/%s/", realID),
		Mp4:    nil,
	}
}
