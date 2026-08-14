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
		proxyList = []string{
			"http://ezyxagjl:vkx1ms0rbzk7@31.59.20.176:6754",
			"http://ezyxagjl:vkx1ms0rbzk7@31.56.127.193:7684",
			"http://ezyxagjl:vkx1ms0rbzk7@45.38.107.97:6014",
			"http://ezyxagjl:vkx1ms0rbzk7@198.105.121.200:6462",
			"http://ezyxagjl:vkx1ms0rbzk7@64.137.96.74:6641",
			"http://ezyxagjl:vkx1ms0rbzk7@198.23.243.226:6361",
			"http://ezyxagjl:vkx1ms0rbzk7@38.154.185.97:6370",
			"http://ezyxagjl:vkx1ms0rbzk7@84.247.60.125:6095",
			"http://ezyxagjl:vkx1ms0rbzk7@142.111.67.146:5611",
			"http://ezyxagjl:vkx1ms0rbzk7@191.96.254.138:6185",
		}
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
