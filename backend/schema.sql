-- Cloudflare D1 Database Schema for MediaBox
CREATE TABLE IF NOT EXISTS users (
  telegram_id INTEGER PRIMARY KEY,
  first_name TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
  ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_analytics_ts ON analytics_events(ts);
CREATE INDEX IF NOT EXISTS idx_analytics_country ON analytics_events(country);
CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type);

CREATE TABLE IF NOT EXISTS favorites (
  telegram_id INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT,
  poster TEXT,
  year TEXT,
  data_json TEXT,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (telegram_id, item_id, type)
);

CREATE TABLE IF NOT EXISTS history (
  telegram_id INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  type TEXT NOT NULL,
  timecode REAL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (telegram_id, item_id, type)
);
