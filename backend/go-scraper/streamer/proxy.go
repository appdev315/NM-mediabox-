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

var prohibitedCIDRs []*net.IPNet

func init() {
	cidrs := []string{
		"0.0.0.0/8",
		"10.0.0.0/8",
		"100.64.0.0/10",
		"127.0.0.0/8",
		"169.254.0.0/16",
		"172.16.0.0/12",
		"192.0.0.0/24",
		"192.0.2.0/24",
		"192.88.99.0/24",
		"192.168.0.0/16",
		"198.18.0.0/15",
		"198.51.100.0/24",
		"203.0.113.0/24",
		"224.0.0.0/4",
		"240.0.0.0/4",
		"255.255.255.255/32",
		"::/128",
		"::1/128",
		"100::/64",
		"2001::/23",
		"2001:db8::/32",
		"2002::/16",
		"fc00::/7",
		"fe80::/10",
		"ff00::/8",
	}
	for _, c := range cidrs {
		_, netCIDR, err := net.ParseCIDR(c)
		if err == nil {
			prohibitedCIDRs = append(prohibitedCIDRs, netCIDR)
		}
	}
}

func isIPSafe(raw net.IP) bool {
	if raw == nil {
		return false
	}
	for _, block := range prohibitedCIDRs {
		if block.Contains(raw) {
			return false
		}
	}
	if ip4 := raw.To4(); ip4 != nil {
		for _, block := range prohibitedCIDRs {
			if block.Contains(ip4) {
				return false
			}
		}
	}
	if raw.IsLoopback() || raw.IsPrivate() || raw.IsUnspecified() ||
		raw.IsLinkLocalUnicast() || raw.IsLinkLocalMulticast() || raw.IsInterfaceLocalMulticast() {
		return false
	}
	return true
}

func safeDialContext(dialer *net.Dialer) func(ctx context.Context, network, addr string) (net.Conn, error) {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			host = addr
			port = "80"
		}
		ips, err := net.LookupIP(host)
		if err != nil {
			return nil, err
		}
		var safeIP net.IP
		for _, ip := range ips {
			if !isIPSafe(ip) {
				return nil, fmt.Errorf("connection to prohibited IP address %s blocked (SSRF guard)", ip.String())
			}
			if safeIP == nil {
				safeIP = ip
			}
		}
		if safeIP == nil {
			return nil, fmt.Errorf("no IP addresses resolved for %s", host)
		}
		return dialer.DialContext(ctx, network, net.JoinHostPort(safeIP.String(), port))
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

	if directIP := net.ParseIP(host); directIP != nil {
		return isIPSafe(directIP)
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
