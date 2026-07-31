-- Cloudflare D1 Database Schema for MediaBox
CREATE TABLE IF NOT EXISTS users (
  telegram_id INTEGER PRIMARY KEY,
  first_name TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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
