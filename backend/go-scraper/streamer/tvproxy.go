package streamer

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

var uriRegex = regexp.MustCompile(`URI="([^"]+)"`)

func rewriteM3u8(body string, originalUrl string, proxyBase string) string {
	parsedUrl, err := url.Parse(originalUrl)
	if err != nil {
		return body
	}

	// Calculate base directory of the current M3U8 URL
	lastSlash := strings.LastIndex(parsedUrl.Path, "/")
	baseDir := parsedUrl.Scheme + "://" + parsedUrl.Host
	if lastSlash != -1 {
		baseDir += parsedUrl.Path[:lastSlash+1]
	} else {
		baseDir += "/"
	}

	lines := strings.Split(body, "\n")
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}

		// Rewrite URI="..." inside tags like #EXT-X-MAP or #EXT-X-KEY
		if strings.HasPrefix(trimmed, "#") && strings.Contains(trimmed, `URI="`) {
			lines[i] = uriRegex.ReplaceAllStringFunc(line, func(match string) string {
				submatches := uriRegex.FindStringSubmatch(match)
				if len(submatches) < 2 {
					return match
				}
				uri := submatches[1]
				fullUrl := uri
				if !strings.HasPrefix(uri, "http://") && !strings.HasPrefix(uri, "https://") {
					resolved, err := url.Parse(uri)
					if err == nil {
						base, _ := url.Parse(baseDir)
						fullUrl = base.ResolveReference(resolved).String()
					}
				}
				return fmt.Sprintf(`URI="%s?url=%s"`, proxyBase, url.QueryEscape(fullUrl))
			})
			continue
		}

		if strings.HasPrefix(trimmed, "#") {
			continue
		}

		// Segment or sub-playlist URL
		fullUrl := trimmed
		if !strings.HasPrefix(trimmed, "http://") && !strings.HasPrefix(trimmed, "https://") {
			resolved, err := url.Parse(trimmed)
			if err == nil {
				base, _ := url.Parse(baseDir)
				fullUrl = base.ResolveReference(resolved).String()
			}
		}
		lines[i] = fmt.Sprintf("%s?url=%s", proxyBase, url.QueryEscape(fullUrl))
	}

	return strings.Join(lines, "\n")
}

var hopByHopHeaders = map[string]bool{
	"connection":          true,
	"keep-alive":          true,
	"proxy-authenticate":  true,
	"proxy-authorization": true,
	"te":                  true,
	"trailers":            true,
	"transfer-encoding":   true,
	"upgrade":             true,
}

func ProxyTVHandler(w http.ResponseWriter, r *http.Request) {
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
		http.Error(w, `{"error":"Missing url parameter"}`, http.StatusBadRequest)
		return
	}

	if !IsAllowedProxyUrl(targetUrl) {
		http.Error(w, `{"error":"Invalid host or URL not allowed"}`, http.StatusForbidden)
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), r.Method, targetUrl, nil)
	if err != nil {
		http.Error(w, `{"error":"Failed to create request"}`, http.StatusInternalServerError)
		return
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "*/*")
	// Prevent Icecast/Shoutcast servers from interleaving metadata inside raw audio stream
	req.Header.Set("Icy-MetaData", "0")

	// Forward client Range header if present
	if rangeHeader := r.Header.Get("Range"); rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}

	resp, err := streamClient.Do(req)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"Proxy Error: %v"}`, err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// Copy safe response headers, ignoring hop-by-hop and connection closing headers
	for k, vv := range resp.Header {
		lowerK := strings.ToLower(k)
		if hopByHopHeaders[lowerK] {
			continue
		}
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}

	contentType := resp.Header.Get("Content-Type")
	isM3u8 := strings.Contains(strings.ToLower(contentType), "mpegurl") || 
		strings.Contains(strings.ToLower(contentType), "m3u") || 
		strings.HasSuffix(strings.ToLower(strings.Split(targetUrl, "?")[0]), ".m3u8")

	if isM3u8 {
		bodyBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			http.Error(w, `{"error":"Failed to read M3U8"}`, http.StatusInternalServerError)
			return
		}

		proxyBase := "/api/proxy" // Frontend expects this path
		rewritten := rewriteM3u8(string(bodyBytes), targetUrl, proxyBase)

		w.Header().Del("Content-Length")
		w.WriteHeader(resp.StatusCode)
		w.Write([]byte(rewritten))
		return
	}

	// For infinite continuous live streams, strip Content-Length so client keeps reading
	isLiveStream := strings.HasPrefix(strings.ToLower(contentType), "audio/") || 
		strings.HasPrefix(strings.ToLower(contentType), "video/") ||
		resp.ContentLength <= 0

	if isLiveStream {
		w.Header().Del("Content-Length")
	}

	w.WriteHeader(resp.StatusCode)

	// Stream audio/video chunks in real-time with immediate flushing to prevent buffer underruns
	flusher, isFlusher := w.(http.Flusher)
	buf := make([]byte, 8*1024)
	for {
		n, rerr := resp.Body.Read(buf)
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
