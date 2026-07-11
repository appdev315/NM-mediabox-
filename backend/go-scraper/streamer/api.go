package streamer

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"scraper/types"
)

var imdbCache = make(map[string]string)

func StreamApiHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	title := r.URL.Query().Get("title")
	if title == "" {
		http.Error(w, `{"error":"Title is required"}`, http.StatusBadRequest)
		return
	}

	vType := r.URL.Query().Get("type")
	tmdb := r.URL.Query().Get("tmdb")
	imdbId := r.URL.Query().Get("imdb")

	if imdbId == "" && tmdb != "" {
		if cached, ok := imdbCache[tmdb]; ok {
			imdbId = cached
		} else {
			tmdbEndpoint := "movie"
			if vType == "tv" || vType == "series" {
				tmdbEndpoint = "tv"
			}
			
			client := &http.Client{Timeout: 4 * time.Second}
			url := fmt.Sprintf("https://api.themoviedb.org/3/%s/%s/external_ids?api_key=cd5b69242e715dc87d65957d7460eba2", tmdbEndpoint, tmdb)
			res, err := client.Get(url)
			if err == nil && res.StatusCode == 200 {
				var data map[string]interface{}
				if err := json.NewDecoder(res.Body).Decode(&data); err == nil {
					if id, ok := data["imdb_id"].(string); ok && id != "" {
						imdbId = id
						imdbCache[tmdb] = id
					}
				}
				res.Body.Close()
			}
		}
	}

	if imdbId != "" {
		isTv := vType == "tv" || vType == "series"
		reserveUrl := fmt.Sprintf("https://vidsrc.me/embed/movie?imdb=%s", imdbId)
		if isTv {
			reserveUrl = fmt.Sprintf("https://vidsrc.me/embed/tv?imdb=%s", imdbId)
		}

		response := types.StreamResponse{
			Iframe: fmt.Sprintf("https://api.ortified.ws/embed/imdb/%s", imdbId),
			Sources: []types.StreamSource{
				{Name: "Основной", URL: fmt.Sprintf("https://api.ortified.ws/embed/imdb/%s", imdbId)},
				{Name: "Резерв", URL: reserveUrl},
			},
		}
		json.NewEncoder(w).Encode(response)
		return
	}

	if tmdb != "" {
		isTv := vType == "tv" || vType == "series"
		reserveUrl := fmt.Sprintf("https://vidsrc.me/embed/movie?tmdb=%s", tmdb)
		if isTv {
			reserveUrl = fmt.Sprintf("https://vidsrc.me/embed/tv?tmdb=%s", tmdb)
		}

		response := types.StreamResponse{
			Iframe: reserveUrl,
			Sources: []types.StreamSource{
				{Name: "Резерв", URL: reserveUrl},
			},
		}
		json.NewEncoder(w).Encode(response)
		return
	}

	http.Error(w, `{"error":"Not found"}`, http.StatusNotFound)
}
