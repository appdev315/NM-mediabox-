package streamer

import (
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var defaultClient = &http.Client{
	Timeout: 30 * time.Second,
	Transport: &http.Transport{
		MaxIdleConns:        1000,
		MaxIdleConnsPerHost: 100,
		IdleConnTimeout:     90 * time.Second,
	},
}

// streamClient has Timeout: 0 (no overall duration deadline) for infinite live Radio & TV streams
var streamClient = &http.Client{
	Timeout: 0,
	Transport: &http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:        1000,
		MaxIdleConnsPerHost: 100,
		IdleConnTimeout:     90 * time.Second,
		TLSHandshakeTimeout: 10 * time.Second,
	},
}

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

	ips, err := net.LookupIP(host)
	if err != nil {
		return false
	}

	for _, ip := range ips {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
			return false
		}
	}

	return true
}

func ProxyStreamHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Range, Icy-MetaData")
	w.Header().Set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	targetUrl := r.URL.Query().Get("url")
	if targetUrl == "" {
		http.Error(w, `{"error":"URL is required"}`, http.StatusBadRequest)
		return
	}
	if !IsAllowedProxyUrl(targetUrl) {
		http.Error(w, `{"error":"URL not allowed"}`, http.StatusForbidden)
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), r.Method, targetUrl, nil)
	if err != nil {
		http.Error(w, `{"error":"Proxy failed"}`, http.StatusInternalServerError)
		return
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Icy-MetaData", "0")

	if rangeHeader := r.Header.Get("Range"); rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}

	res, err := streamClient.Do(req)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"Proxy failed: %v"}`, err), http.StatusInternalServerError)
		return
	}
	defer res.Body.Close()

	for k, vv := range res.Header {
		lowerK := strings.ToLower(k)
		if hopByHopHeaders[lowerK] {
			continue
		}
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}

	contentType := res.Header.Get("Content-Type")
	isLiveStream := strings.HasPrefix(strings.ToLower(contentType), "audio/") || 
		strings.HasPrefix(strings.ToLower(contentType), "video/") ||
		res.ContentLength <= 0

	if isLiveStream {
		w.Header().Del("Content-Length")
	}

	w.WriteHeader(res.StatusCode)

	flusher, isFlusher := w.(http.Flusher)
	buf := make([]byte, 8*1024)
	for {
		n, rerr := res.Body.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				break
			}
			if isFlusher {
				flusher.Flush()
			}
		}
		if rerr != nil {
			break
		}
	}
}
