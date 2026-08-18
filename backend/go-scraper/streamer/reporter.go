package streamer

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

type ReportMissingRequest struct {
	Title         string   `json:"title"`
	Year          string   `json:"year"`
	Type          string   `json:"type"`
	TMDBID        string   `json:"tmdb_id"`
	SourcesFailed []string `json:"sources_failed"`
	Platform      string   `json:"platform"`
}

func ReportMissingHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req ReportMissingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"Invalid request payload"}`, http.StatusBadRequest)
		return
	}

	if req.Title == "" && req.TMDBID == "" {
		http.Error(w, `{"error":"Title or TMDB ID required"}`, http.StatusBadRequest)
		return
	}

	// Resolve Bot Token and Admin Chat ID from environment
	botToken := os.Getenv("BOT_TOKEN_MAIN")
	if botToken == "" {
		botToken = os.Getenv("BOT_TOKEN")
	}
	if botToken == "" {
		log.Println("[Reporter] Warning: Telegram bot token not configured in environment (BOT_TOKEN_MAIN)")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":      true,
			"message": "Report received",
		})
		return
	}

	chatID := os.Getenv("ADMIN_CHAT_ID")
	if chatID == "" {
		chatID = os.Getenv("TG_CHAT_ID")
	}
	if chatID == "" {
		chatID = "484803732"
	}

	mediaTypeRu := "Фильм"
	if req.Type == "tv" || req.Type == "series" {
		mediaTypeRu = "Сериал"
	}

	yearStr := ""
	if req.Year != "" {
		yearStr = fmt.Sprintf(" (%s)", req.Year)
	}

	tmdbLink := ""
	if req.TMDBID != "" {
		tmdbType := "movie"
		if req.Type == "tv" || req.Type == "series" {
			tmdbType = "tv"
		}
		tmdbLink = fmt.Sprintf("https://www.themoviedb.org/%s/%s", tmdbType, req.TMDBID)
	} else {
		tmdbLink = "N/A"
	}

	failedSourcesStr := "Liftw (404), Anwap (404)"
	if len(req.SourcesFailed) > 0 {
		failedSourcesStr = strings.Join(req.SourcesFailed, ", ")
	}

	platformStr := req.Platform
	if platformStr == "" {
		platformStr = "Web / Browser"
	}

	locTime := time.Now().UTC().Format("15:04:05 02.01.2006 UTC")

	textMsg := fmt.Sprintf(
		"⚠️ <b>Отсутствует релиз в MediaBox!</b>\n\n"+
			"🎬 <b>Название:</b> %s%s\n"+
			"🏷 <b>Тип:</b> %s\n"+
			"🆔 <b>TMDB ID:</b> %s\n"+
			"🔗 <b>TMDB:</b> <a href=\"%s\">%s</a>\n"+
			"📡 <b>Сбой источников:</b> %s\n"+
			"📱 <b>Платформа:</b> %s\n"+
			"⏰ <b>Время:</b> %s",
		escapeHTML(req.Title),
		yearStr,
		mediaTypeRu,
		req.TMDBID,
		tmdbLink,
		tmdbLink,
		escapeHTML(failedSourcesStr),
		escapeHTML(platformStr),
		locTime,
	)

	go func(token, targetChat, message string) {
		tgURL := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", token)
		payload := map[string]interface{}{
			"chat_id":                  targetChat,
			"text":                     message,
			"parse_mode":               "HTML",
			"disable_web_page_preview": false,
		}
		bodyBytes, err := json.Marshal(payload)
		if err != nil {
			log.Printf("[Reporter] Error marshaling telegram payload: %v", err)
			return
		}

		client := &http.Client{Timeout: 10 * time.Second}
		resp, err := client.Post(tgURL, "application/json", bytes.NewReader(bodyBytes))
		if err != nil {
			log.Printf("[Reporter] Error sending report to telegram: %v", err)
			return
		}
		defer resp.Body.Close()
		respBytes, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK {
			log.Printf("[Reporter] Warning: Telegram API returned HTTP %d: %s", resp.StatusCode, string(respBytes))
		} else {
			log.Printf("[Reporter] Telegram missing report sent successfully to chat %s", targetChat)
		}
	}(botToken, chatID, textMsg)

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":      true,
		"message": "Report submitted successfully",
	})
}

func escapeHTML(s string) string {
	r := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		"\"", "&quot;",
	)
	return r.Replace(s)
}
