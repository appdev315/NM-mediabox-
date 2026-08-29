-- Таблица пользователей
CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    language_code TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Таблица избранного
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

-- Таблица истории просмотров
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

-- Индексы
CREATE INDEX IF NOT EXISTS idx_favorites_telegram_id ON favorites(telegram_id);
CREATE INDEX IF NOT EXISTS idx_history_telegram_id ON history(telegram_id);

-- Аналитика событий (visit / open) для трёхчасового отчёта
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
