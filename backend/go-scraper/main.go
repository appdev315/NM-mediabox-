package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"sync"

	"scraper/scraper"
	"scraper/streamer"
	"scraper/types"
)

func searchHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	q := r.URL.Query().Get("q")
	pageStr := r.URL.Query().Get("page")
	page := 0
	if pageStr != "" {
		if p, err := strconv.Atoi(pageStr); err == nil {
			page = p
		}
	}

	var wg sync.WaitGroup
	wg.Add(2)

	var xvideosRes []types.Video
	var epornerRes []types.Video

	go func() {
		defer wg.Done()
		xvideosRes = scraper.SearchXvideos(q, page)
	}()

	go func() {
		defer wg.Done()
		epornerRes = scraper.SearchEporner(q, page)
	}()

	wg.Wait()

	var mixed []types.Video
	maxLen := len(xvideosRes)
	if len(epornerRes) > maxLen {
		maxLen = len(epornerRes)
	}

	for i := 0; i < maxLen; i++ {
		if i < len(epornerRes) {
			mixed = append(mixed, epornerRes[i])
		}
		if i < len(xvideosRes) {
			mixed = append(mixed, xvideosRes[i])
		}
	}

	if mixed == nil {
		mixed = []types.Video{}
	}

	json.NewEncoder(w).Encode(mixed)
}

func detailsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, `{"error":"Missing id"}`, http.StatusBadRequest)
		return
	}

	var details *types.VideoDetails
	if len(id) > 8 && id[:8] == "eporner_" {
		details = scraper.EpornerDetails(id)
	} else {
		details = scraper.XvideosDetails(id)
	}

	if details != nil {
		json.NewEncoder(w).Encode(details)
	} else {
		http.Error(w, `{"error":"Video not found"}`, http.StatusNotFound)
	}
}

func main() {
	http.HandleFunc("/api/adult/search", searchHandler)
	http.HandleFunc("/api/adult/details", detailsHandler)
	http.HandleFunc("/api/proxy/stream", streamer.ProxyStreamHandler)
	http.HandleFunc("/api/proxy", streamer.ProxyTVHandler)
	http.HandleFunc("/api/stream", streamer.StreamApiHandler)
	http.HandleFunc("/api/liftw", streamer.LiftwApiHandler)

	log.Println("Go microservice started on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
