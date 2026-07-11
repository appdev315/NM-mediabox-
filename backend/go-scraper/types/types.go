package types

type Video struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Poster   string `json:"poster"`
	Duration string `json:"duration"`
	Type     string `json:"type"`
	Href     string `json:"href"`
}

type VideoDetails struct {
	Iframe string  `json:"iframe"`
	Mp4    *string `json:"mp4"`
}

type StreamSource struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type StreamResponse struct {
	Iframe  string         `json:"iframe"`
	Sources []StreamSource `json:"sources"`
}
