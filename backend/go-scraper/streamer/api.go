package streamer

import (
	"net/http"
)

func StreamApiHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	title := r.URL.Query().Get("title")
	if title == "" {
		http.Error(w, `{"error":"Title is required"}`, http.StatusBadRequest)
		return
	}

	// Delegate directly to Liftw clean provider handler
	LiftwApiHandler(w, r)
}
