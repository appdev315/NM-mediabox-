package streamer

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestTMDBApiHandler_OversizedQueryGuard(t *testing.T) {
	// Create an oversized query (> 150 chars)
	hugeQuery := strings.Repeat("a", 300)
	req := httptest.NewRequest("GET", "/api/tmdb/search/multi?query="+hugeQuery, nil)
	w := httptest.NewRecorder()

	TMDBApiHandler(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200 OK, got %d", resp.StatusCode)
	}

	body := w.Body.String()
	expected := `{"page":1,"results":[],"total_pages":0,"total_results":0}`
	if strings.TrimSpace(body) != expected {
		t.Fatalf("expected body %s, got %s", expected, body)
	}
}

func TestTMDBApiHandler_CyrillicOversizedBlocked(t *testing.T) {
	// 180 Cyrillic characters (> 150 runes)
	hugeCyrillic := strings.Repeat("фильм", 36)
	req := httptest.NewRequest("GET", "/api/tmdb/search/multi?query="+hugeCyrillic, nil)
	w := httptest.NewRecorder()

	TMDBApiHandler(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200 OK, got %d", resp.StatusCode)
	}

	body := w.Body.String()
	expected := `{"page":1,"results":[],"total_pages":0,"total_results":0}`
	if strings.TrimSpace(body) != expected {
		t.Fatalf("expected body %s, got %s", expected, body)
	}
}

func TestTMDBApiHandler_Cyrillic120CharsAllowed(t *testing.T) {
	// 100 Cyrillic characters (200 bytes in UTF-8, 600 bytes in URL-encode)
	// Under 150 runes and under 2048 bytes URL - MUST NOT be blocked by guard!
	cyrillic100 := strings.Repeat("кино", 25)
	
	// Pre-seed cache to intercept network call
	vals := url.Values{}
	vals.Set("api_key", getTMDBApiKey())
	vals.Set("query", cyrillic100)
	cacheURL := "https://api.themoviedb.org/3/search/multi?" + vals.Encode()
	dummyData := []byte(`{"page":1,"results":[{"id":123,"title":"Тест"}],"total_pages":1,"total_results":1}`)
	tmdbCache.Store(cacheURL, tmdbCacheEntry{
		data:       dummyData,
		statusCode: http.StatusOK,
		headers:    make(http.Header),
		expiry:     time.Now().Add(1 * time.Hour),
	})

	req := httptest.NewRequest("GET", "/api/tmdb/search/multi?query="+cyrillic100, nil)
	w := httptest.NewRecorder()

	TMDBApiHandler(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200 OK, got %d", resp.StatusCode)
	}

	body := w.Body.String()
	if !strings.Contains(body, "Тест") {
		t.Fatalf("expected legitimate 100-rune Cyrillic query to pass guard and return results, got %s", body)
	}
}

func TestTMDBApiHandler_OversizedRawQueryGuard(t *testing.T) {
	// Create an oversized raw query (> 2048 chars)
	hugeQuery := strings.Repeat("foo=bar&", 300)
	req := httptest.NewRequest("GET", "/api/tmdb/search/multi?"+hugeQuery, nil)
	w := httptest.NewRecorder()

	TMDBApiHandler(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200 OK, got %d", resp.StatusCode)
	}

	body := w.Body.String()
	expected := `{"page":1,"results":[],"total_pages":0,"total_results":0}`
	if strings.TrimSpace(body) != expected {
		t.Fatalf("expected body %s, got %s", expected, body)
	}
}
