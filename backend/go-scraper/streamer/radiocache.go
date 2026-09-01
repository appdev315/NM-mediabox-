package streamer

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

//go:embed radiopotok.json
var embeddedRadiopotokJSON []byte

type StationItem struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	URL      string `json:"url"`
	Logo     string `json:"logo"`
	Group    string `json:"group,omitempty"`
	Category string `json:"category,omitempty"`
	Type     string `json:"type"`
}

type RadiopotokItem struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Logo     string `json:"logo"`
	Stream   string `json:"stream"`
	Category string `json:"category"`
}

type RadioBrowserStation struct {
	StationUUID string `json:"stationuuid"`
	Name        string `json:"name"`
	URLResolved string `json:"url_resolved"`
	Favicon     string `json:"favicon"`
	Tags        string `json:"tags"`
}

var CountryNames = map[string]string{
	"au": "Australia",
	"by": "Belarus",
	"br": "Brazil",
	"fr": "France",
	"de": "Germany",
	"in": "India",
	"id": "Indonesia",
	"ir": "Iran",
	"kz": "Kazakhstan",
	"mx": "Mexico",
	"ru": "Russia",
	"kr": "South Korea",
	"gb": "United Kingdom",
	"us": "United States",
}

var SupportedCountryCodes = []string{
	"ru", "us", "gb", "de", "fr", "by", "kz", "in", "id", "kr", "ir", "br", "mx", "au",
}

var RadioBrowserMirrors = []string{
	"de1.api.radio-browser.info",
	"nl1.api.radio-browser.info",
	"at1.api.radio-browser.info",
}

var (
	radioCacheMu sync.RWMutex
	radioCache   = make(map[string][]byte) // key: country_source -> JSON bytes
)

func init() {
	// Initialize Russia radiopotok cache from embedded asset on startup
	if len(embeddedRadiopotokJSON) > 0 {
		var rpItems []RadiopotokItem
		if err := json.Unmarshal(embeddedRadiopotokJSON, &rpItems); err == nil {
			stations := make([]StationItem, 0, len(rpItems))
			for idx, it := range rpItems {
				if it.Stream == "" {
					continue
				}
				id := it.ID
				if id == "" {
					id = fmt.Sprintf("rp_%d", idx)
				}
				stations = append(stations, StationItem{
					ID:       id,
					Name:     it.Name,
					URL:      it.Stream,
					Logo:     it.Logo,
					Group:    "",
					Category: it.Category,
					Type:     "radio",
				})
			}
			if bytes, err := json.Marshal(stations); err == nil {
				radioCacheMu.Lock()
				radioCache["ru_1"] = bytes
				radioCacheMu.Unlock()
			}
		}
	}
}

// Fetch stations for a given country with mirror failover
func fetchCountryStationsFromMirrors(countryCode string) ([]StationItem, error) {
	countryName := CountryNames[countryCode]
	if countryName == "" {
		countryName = "Russia"
	}

	client := &http.Client{
		Timeout: 5 * time.Second,
	}

	var lastErr error
	for _, mirror := range RadioBrowserMirrors {
		targetUrl := fmt.Sprintf("https://%s/json/stations/search?limit=500&country=%s&hidebroken=true&order=votes&reverse=true",
			mirror, url.QueryEscape(countryName))

		req, err := http.NewRequest("GET", targetUrl, nil)
		if err != nil {
			lastErr = err
			continue
		}
		req.Header.Set("User-Agent", "MediaBox/1.0 (Mobile Radio Cache)")

		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}

		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			lastErr = fmt.Errorf("mirror %s returned HTTP %d", mirror, resp.StatusCode)
			continue
		}

		var rawStations []RadioBrowserStation
		err = json.NewDecoder(resp.Body).Decode(&rawStations)
		resp.Body.Close()

		if err != nil {
			lastErr = err
			continue
		}

		stations := make([]StationItem, 0, len(rawStations))
		for _, s := range rawStations {
			if strings.TrimSpace(s.URLResolved) == "" {
				continue
			}
			stations = append(stations, StationItem{
				ID:    s.StationUUID,
				Name:  s.Name,
				URL:   s.URLResolved,
				Logo:  s.Favicon,
				Group: s.Tags,
				Type:  "radio",
			})
		}

		if len(stations) > 0 {
			return stations, nil
		}
	}

	return nil, fmt.Errorf("failed to fetch stations from all mirrors: %v", lastErr)
}

func getOrFetchCountryStations(countryCode string, source string) []byte {
	countryCode = strings.ToLower(strings.TrimSpace(countryCode))
	if countryCode == "" {
		countryCode = "ru"
	}
	if source == "" {
		source = "1"
	}

	cacheKey := fmt.Sprintf("%s_%s", countryCode, source)

	radioCacheMu.RLock()
	cachedData, exists := radioCache[cacheKey]
	radioCacheMu.RUnlock()

	if exists && len(cachedData) > 0 {
		return cachedData
	}

	// If country is RU and source is 1, check embedded radiopotok
	if countryCode == "ru" && source == "1" {
		radioCacheMu.RLock()
		ru1Data := radioCache["ru_1"]
		radioCacheMu.RUnlock()
		if len(ru1Data) > 0 {
			return ru1Data
		}
	}

	// Fetch on demand
	stations, err := fetchCountryStationsFromMirrors(countryCode)
	if err == nil && len(stations) > 0 {
		if bytes, err := json.Marshal(stations); err == nil {
			radioCacheMu.Lock()
			radioCache[cacheKey] = bytes
			radioCacheMu.Unlock()
			return bytes
		}
	}

	// Fallback to RU_1 if completely failed
	radioCacheMu.RLock()
	fallback := radioCache["ru_1"]
	radioCacheMu.RUnlock()

	if len(fallback) > 0 {
		return fallback
	}

	return []byte("[]")
}

// StartRadioCacheWarmer runs a background task updating station catalogs country-by-country smoothly once a week
func StartRadioCacheWarmer() {
	go func() {
		// Initial gentle warm-up 15 seconds after startup
		time.Sleep(15 * time.Second)
		warmAllCountriesSmoothly()

		// Periodic weekly warmer: updates country by country every 7 days
		ticker := time.NewTicker(7 * 24 * time.Hour)
		for range ticker.C {
			warmAllCountriesSmoothly()
		}
	}()
}

func warmAllCountriesSmoothly() {
	log.Println("[RadioWarmer] Starting smooth weekly radio catalog update (country-by-country)...")

	for _, country := range SupportedCountryCodes {
		// Source 2 for RU, Source 1 for all others
		source := "1"
		if country == "ru" {
			source = "2"
		}

		cacheKey := fmt.Sprintf("%s_%s", country, source)
		stations, err := fetchCountryStationsFromMirrors(country)
		if err == nil && len(stations) > 0 {
			if bytes, err := json.Marshal(stations); err == nil {
				radioCacheMu.Lock()
				radioCache[cacheKey] = bytes
				radioCacheMu.Unlock()
				log.Printf("[RadioWarmer] Successfully cached %d stations for %s", len(stations), country)
			}
		} else {
			log.Printf("[RadioWarmer] Warning: could not refresh %s (%v), keeping previous cache", country, err)
		}

		// Gentle 5-second pause between countries to avoid rate limits or CPU spikes
		time.Sleep(5 * time.Second)
	}

	log.Println("[RadioWarmer] Weekly radio catalog update complete.")
}

// RadioStationsHandler serves cached radio station catalogs with 7-day client cache headers
func RadioStationsHandler(w http.ResponseWriter, r *http.Request) {
	country := r.URL.Query().Get("country")
	source := r.URL.Query().Get("source")

	data := getOrFetchCountryStations(country, source)

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Cache-Control", "public, max-age=604800, immutable")
	w.WriteHeader(http.StatusOK)
	w.Write(data)
}
