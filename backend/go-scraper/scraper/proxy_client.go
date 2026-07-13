package scraper

import (
	"crypto/tls"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"time"
)

var proxyIndex uint32

func GetHTTPClient(timeout time.Duration) *http.Client {
	proxyUrlStr := os.Getenv("PROXY_URL")
	if proxyUrlStr == "" {
		return &http.Client{Timeout: timeout}
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
		return &http.Client{Timeout: timeout}
	}

	// Rotate proxy index
	idx := atomic.AddUint32(&proxyIndex, 1) % uint32(len(proxyList))
	selectedProxy := proxyList[idx]

	proxyUrl, err := url.Parse(selectedProxy)
	if err != nil {
		return &http.Client{Timeout: timeout}
	}

	transport := &http.Transport{
		Proxy:           http.ProxyURL(proxyUrl),
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}

	return &http.Client{
		Timeout:   timeout,
		Transport: transport,
	}
}
