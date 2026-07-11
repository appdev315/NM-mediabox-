package streamer

import (
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func IsAllowedProxyUrl(urlStr string) bool {
	parsed, err := url.Parse(urlStr)
	if err != nil {
		return false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" || host == "127.0.0.1" || host == "::1" {
		return false
	}
	if strings.HasPrefix(host, "10.") || strings.HasPrefix(host, "192.168.") || strings.HasPrefix(host, "0.") || strings.HasPrefix(host, "169.254.") {
		return false
	}
	if strings.HasPrefix(host, "172.") {
		return false
	}
	return true
}

func ProxyStreamHandler(w http.ResponseWriter, r *http.Request) {
	targetUrl := r.URL.Query().Get("url")
	if targetUrl == "" {
		http.Error(w, `{"error":"URL is required"}`, http.StatusBadRequest)
		return
	}
	if !IsAllowedProxyUrl(targetUrl) {
		http.Error(w, `{"error":"URL not allowed"}`, http.StatusForbidden)
		return
	}

	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest("GET", targetUrl, nil)
	if err != nil {
		http.Error(w, `{"error":"Proxy failed"}`, http.StatusInternalServerError)
		return
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	req.Header.Set("Accept", "*/*")

	res, err := client.Do(req)
	if err != nil {
		http.Error(w, `{"error":"Proxy failed"}`, http.StatusInternalServerError)
		return
	}
	defer res.Body.Close()

	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Range")
	w.Header().Set("Access-Control-Expose-Headers", "Content-Length, Content-Range")

	if ct := res.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	if cl := res.Header.Get("Content-Length"); cl != "" {
		w.Header().Set("Content-Length", cl)
	}
	if cr := res.Header.Get("Content-Range"); cr != "" {
		w.Header().Set("Content-Range", cr)
	}

	w.WriteHeader(res.StatusCode)
	io.Copy(w, res.Body)
}
