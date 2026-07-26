package middleware

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
)

type AuthData struct {
	User       map[string]interface{} `json:"user"`
	BotToken   string                 `json:"botToken"`
	IsAdultBot bool                   `json:"isAdultBot"`
}

func ValidateTelegramWebAppData(initDataStr string, botToken string) bool {
	if botToken == "" || initDataStr == "" {
		return false
	}

	values, err := url.ParseQuery(initDataStr)
	if err != nil {
		return false
	}

	hash := values.Get("hash")
	if hash == "" {
		return false
	}
	values.Del("hash")

	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var checkPairs []string
	for _, k := range keys {
		checkPairs = append(checkPairs, fmt.Sprintf("%s=%s", k, values.Get(k)))
	}
	dataCheckString := strings.Join(checkPairs, "\n")

	// secretKey = HMAC-SHA256("WebAppData", botToken)
	macSecret := hmac.New(sha256.New, []byte("WebAppData"))
	macSecret.Write([]byte(botToken))
	secretKey := macSecret.Sum(nil)

	// hmac = HMAC-SHA256(secretKey, dataCheckString)
	mac := hmac.New(sha256.New, secretKey)
	mac.Write([]byte(dataCheckString))
	expectedHash := hex.EncodeToString(mac.Sum(nil))

	return hmac.Equal([]byte(expectedHash), []byte(hash))
}

func VerifyTelegramWebAppData(initData string) *AuthData {
	botTokenMain := os.Getenv("BOT_TOKEN_MAIN")
	if botTokenMain == "" {
		botTokenMain = os.Getenv("BOT_TOKEN")
	}
	botTokenAdult := os.Getenv("BOT_TOKEN_ADULT")

	var matchedToken string
	isAdultBot := false

	if ValidateTelegramWebAppData(initData, botTokenMain) {
		matchedToken = botTokenMain
	} else if ValidateTelegramWebAppData(initData, botTokenAdult) {
		matchedToken = botTokenAdult
		isAdultBot = true
	}

	if matchedToken == "" {
		return nil
	}

	values, _ := url.ParseQuery(initData)
	userJson := values.Get("user")
	var user map[string]interface{}
	if userJson != "" {
		_ = json.Unmarshal([]byte(userJson), &user)
	}

	return &AuthData{
		User:       user,
		BotToken:   matchedToken,
		IsAdultBot: isAdultBot,
	}
}

func RequireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "tma ") {
			http.Error(w, `{"error":"Unauthorized: Missing or invalid token"}`, http.StatusUnauthorized)
			return
		}

		initData := strings.TrimPrefix(authHeader, "tma ")
		authData := VerifyTelegramWebAppData(initData)
		if authData == nil {
			http.Error(w, `{"error":"Unauthorized: Invalid signature"}`, http.StatusUnauthorized)
			return
		}

		next(w, r)
	}
}

func CheckAdultAccess(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// App is completely free, pass through
		next(w, r)
	}
}
