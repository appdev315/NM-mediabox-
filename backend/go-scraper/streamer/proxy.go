package streamer

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

func isIPSafe(raw net.IP) bool {
	if raw == nil {
		return false
	}
	// Extract embedded IPv4 from IPv4-mapped IPv6 (e.g., ::ffff:127.0.0.1 -> 127.0.0.1)
	ip := raw.To4()
	if ip == nil {
		ip = raw
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsInterfaceLocalMulticast() {
		return false
	}

	// Extra checks for CGNAT (100.64.0.0/10), link-local / cloud metadata (169.254.x.x), 0.0.0.0
	if ip4 := ip.To4(); ip4 != nil {
		if ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127 {
			return false
		}
		if ip4[0] == 169 && ip4[1] == 254 {
			return false
		}
		if ip4[0] == 0 {
			return false
		}
	}
	return true
}

func safeDialContext(dialer *net.Dialer) func(ctx context.Context, network, addr string) (net.Conn, error) {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, _, err := net.SplitHostPort(addr)
		if err != nil {
			host = addr
		}
		ips, err := net.LookupIP(host)
		if err != nil {
			return nil, err
		}
		for _, ip := range ips {
			if !isIPSafe(ip) {
				return nil, fmt.Errorf("connection to prohibited IP address %s blocked (SSRF guard)", ip.String())
			}
		}
		return dialer.DialContext(ctx, network, addr)
	}
}

var defaultDialer = &net.Dialer{
	Timeout:   10 * time.Second,
	KeepAlive: 30 * time.Second,
}

var defaultClient = &http.Client{
	Timeout: 30 * time.Second,
	Transport: &http.Transport{
		DialContext:         safeDialContext(defaultDialer),
		MaxIdleConns:        1000,
		MaxIdleConnsPerHost: 100,
		IdleConnTimeout:     90 * time.Second,
	},
}

// StreamBufferPool allocates and reuses 64KB byte slices to achieve zero-allocation streaming
var StreamBufferPool = sync.Pool{
	New: func() interface{} {
		b := make([]byte, 64*1024)
		return &b
	},
}

// streamClient has Timeout: 0 (no overall duration deadline) for infinite live Radio & TV streams
var streamClient = &http.Client{
	Timeout: 0,
	Transport: &http.Transport{
		DialContext:         safeDialContext(defaultDialer),
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
	if host == "localhost" || host == "127.0.0.1" || host == "::1" || strings.Contains(host, "metadata.google") {
		return false
	}

	ips, err := net.LookupIP(host)
	if err != nil {
		return false
	}

	for _, ip := range ips {
		if !isIPSafe(ip) {
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

	// Anti-buffering headers for Cloudflare / Nginx streaming resilience
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Accept-Ranges", "bytes")

	if isLiveStream {
		w.Header().Del("Content-Length")
	}

	w.WriteHeader(res.StatusCode)

	flusher, isFlusher := w.(http.Flusher)
	bufPtr := StreamBufferPool.Get().(*[]byte)
	defer StreamBufferPool.Put(bufPtr)
	buf := *bufPtr

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
