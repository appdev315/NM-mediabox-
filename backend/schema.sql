-- Cloudflare D1 Database Schema for MediaBox
-- КАНОНИЧЕСКИЙ файл: соответствует продовой базе (сверено с sqlite_master 2026-10-20).
-- Прежний дубликат backend/src/db/schema.sql удалён — расходящиеся схемы приводили
-- к тому, что таблицы favorites/history годами не совпадали с кодом воркера.

CREATE TABLE IF NOT EXISTS users (
  telegram_id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  language_code TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Analytics events (visit / open) used by the 3-hour server report
CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  country TEXT,
  user_id INTEGER,
  session_id TEXT,
  item_type TEXT,
  item_title TEXT,
  item_id TEXT,
  meta TEXT,
  ts DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_analytics_ts ON analytics_events(ts);
CREATE INDEX IF NOT EXISTS idx_analytics_country ON analytics_events(country);
CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type);

-- Избранное: конфликт-таргет ON CONFLICT(telegram_id, item_id, type) в коде воркера
-- требует UNIQUE(telegram_id, item_id, type)
CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'movie',
  title TEXT,
  poster TEXT,
  year TEXT,
  data_json TEXT,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id) ON DELETE CASCADE,
  UNIQUE(telegram_id, item_id, type)
);
CREATE INDEX IF NOT EXISTS idx_favorites_telegram_id ON favorites(telegram_id);

CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'movie',
  timecode INTEGER DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id) ON DELETE CASCADE,
  UNIQUE(telegram_id, item_id, type)
);
CREATE INDEX IF NOT EXISTS idx_history_telegram_id ON history(telegram_id);

-- Parsing Incidents tracked by Autonomous Sysadmin
CREATE TABLE IF NOT EXISTS parsing_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tmdb_id TEXT,
  title TEXT NOT NULL,
  year TEXT,
  content_type TEXT DEFAULT 'movie',
  donor TEXT DEFAULT 'liftw',
  fail_type TEXT NOT NULL, -- 'not_found', 'timeout', 'empty_iframe', 'http_502'
  status TEXT DEFAULT 'pending', -- 'pending', 'auto_fixed', 'unresolved'
  heal_note TEXT,
  ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_incidents_ts ON parsing_incidents(ts);
CREATE INDEX IF NOT EXISTS idx_incidents_tmdb ON parsing_incidents(tmdb_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON parsing_incidents(status);
