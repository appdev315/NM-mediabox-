package scraper

import (
	"crypto/tls"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

var (
	proxyIndex      uint32
	transportCache  sync.Map
	directTransport = &http.Transport{
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 30,
		IdleConnTimeout:     90 * time.Second,
		TLSHandshakeTimeout: 10 * time.Second,
	}
)

func getOrCreateTransport(proxyURL *url.URL) *http.Transport {
	key := proxyURL.String()
	if cached, ok := transportCache.Load(key); ok {
		return cached.(*http.Transport)
	}

	transport := &http.Transport{
		Proxy:               http.ProxyURL(proxyURL),
		TLSClientConfig:     &tls.Config{InsecureSkipVerify: true},
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 30,
		IdleConnTimeout:     90 * time.Second,
		TLSHandshakeTimeout: 10 * time.Second,
	}

	actual, _ := transportCache.LoadOrStore(key, transport)
	return actual.(*http.Transport)
}

func GetHTTPClient(timeout time.Duration) *http.Client {
	proxyUrlStr := os.Getenv("PROXY_URL")
	if proxyUrlStr == "" {
		return &http.Client{
			Timeout:   timeout,
			Transport: directTransport,
		}
	}

	proxies := strings.Split(proxyUrlStr, ",")
	var proxyList []string
	for _, p := range proxies {
		trimmed := strings.TrimSpace(p)
		if trimmed != "" {
			proxyList = append(proxyList, trimmed)
		}
	}

	if len(proxyList) == 0 {
		return &http.Client{
			Timeout:   timeout,
			Transport: directTransport,
		}
	}

	// Rotate proxy index
	idx := atomic.AddUint32(&proxyIndex, 1) % uint32(len(proxyList))
	selectedProxy := proxyList[idx]

	proxyUrl, err := url.Parse(selectedProxy)
	if err != nil {
		return &http.Client{
			Timeout:   timeout,
			Transport: directTransport,
		}
	}

	return &http.Client{
		Timeout:   timeout,
		Transport: getOrCreateTransport(proxyUrl),
	}
}

func GetDirectHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout:   timeout,
		Transport: directTransport,
	}
}
