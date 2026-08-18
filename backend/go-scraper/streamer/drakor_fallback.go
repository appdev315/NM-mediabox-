package streamer

import (
	"context"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	reDrakorIframe = regexp.MustCompile(`(?i)<iframe[^>]+src=["'](https?://[^"']+)["']`)
	reEmbedLinks   = regexp.MustCompile(`(?i)href=["'](https?://(?:streamwish|vidhide|dood|filelions|hxfile|streamruby|fembed)[^"']+)["']`)
	reDrakorEp     = regexp.MustCompile(`(?i)(?:episode|eps|ep)\.?\s*(\d{1,3})`)
)

// FallbackRateLimiter provides a token-bucket rate limiter (10 req/s, burst 15)
type fallbackRateLimiter struct {
	mu         sync.Mutex
	tokens     float64
	maxTokens  float64
	refillRate float64 // tokens per second
	lastRefill time.Time
}

var fallbackLimiter = &fallbackRateLimiter{
	tokens:     10.0,
	maxTokens:  15.0,
	refillRate: 10.0,
	lastRefill: time.Now(),
}

func (l *fallbackRateLimiter) Wait(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		l.mu.Lock()
		now := time.Now()
		elapsed := now.Sub(l.lastRefill).Seconds()
		l.lastRefill = now
		l.tokens = math.Min(l.maxTokens, l.tokens+elapsed*l.refillRate)

		if l.tokens >= 1.0 {
			l.tokens -= 1.0
			l.mu.Unlock()
			return nil
		}
		l.mu.Unlock()

		time.Sleep(50 * time.Millisecond)
	}
}

// ResolveDrakorWebFallback queries Indonesian Asian drama mirrors with rate limiting and backpressure
func ResolveDrakorWebFallback(ctx context.Context, title, year, originalTitle string) (*DrakorTelegramResult, error) {
	// Apply rate limiter backpressure
	if err := fallbackLimiter.Wait(ctx); err != nil {
		return nil, err
	}

	cleanTitle := strings.TrimSpace(title)
	if cleanTitle == "" {
		cleanTitle = originalTitle
	}

	searchURL := fmt.Sprintf("https://drakorindo.autos/?s=%s", url.QueryEscape(cleanTitle))
	req, err := http.NewRequestWithContext(ctx, "GET", searchURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

	resp, err := drakorHttpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fallback mirror returned HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}

	bodyStr := string(body)
	episodes := make(map[string]map[string]string)

	matches := reEmbedLinks.FindAllStringSubmatch(bodyStr, -1)
	if len(matches) == 0 {
		matches = reDrakorIframe.FindAllStringSubmatch(bodyStr, -1)
	}

	for i, m := range matches {
		if len(m) >= 2 {
			epNum := strconv.Itoa(i + 1)
			if episodes["1"] == nil {
				episodes["1"] = make(map[string]string)
			}
			episodes["1"][epNum] = m[1]
		}
	}

	if len(episodes) == 0 {
		return nil, fmt.Errorf("no web mirror episodes found for %s", title)
	}

	var firstIframe string
	for _, epURL := range episodes["1"] {
		firstIframe = epURL
		break
	}

	return &DrakorTelegramResult{
		Source:   "telegram",
		Name:     "Telegram / Drakor Web (Sub Indo)",
		Channel:  "Drakorindo",
		Iframe:   firstIframe,
		Episodes: episodes,
	}, nil
}
