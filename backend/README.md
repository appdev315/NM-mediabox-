---
title: NM Parser
emoji: 🎬
colorFrom: blue
colorTo: indigo
sdk: docker
pinned: false
app_port: 7860
---

# NM Parser

Бэкенд-парсер для извлечения видеопотоков с помощью Playwright на базе Hugging Face Spaces (Docker).

## Configuration & Environment Variables

### TMDB_API_KEY Resolution Priority
- **Cloudflare Worker (`backend/src/index.ts:getTmdbKey`)**: `c.env.TMDB_API_KEY` (from Cloudflare Worker secrets / `wrangler.jsonc`) takes primary precedence, falling back to `process.env.TMDB_API_KEY` (from `.env`).
- **Go Scraper (`streamer/tmdb.go`)**: Reads `os.Getenv("TMDB_API_KEY")` with fallback to default key.
- When rotating keys, update both `wrangler.jsonc` / Worker secrets and `.env` to prevent desync.

### Liftw Donor Proxy
- **`LIFTW_PROXY_URL`**: Optional HTTP proxy URL for Liftw donor requests (`backend/go-scraper/streamer/liftw.go`). Leave empty for direct donor connection.
