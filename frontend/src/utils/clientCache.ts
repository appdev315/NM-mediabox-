/**
 * Enhanced Client-side Caching Utility for MediaBox
 * Leverages IndexedDB for non-blocking storage of large API payloads
 * and In-Memory Map for instant 0ms synchronous UI reads.
 */

interface CacheEntry<T> {
  data: T;
  expiry: number; // timestamp in ms
  updatedAt?: number; // last write timestamp in ms (drives recency-ordered hydration)
}

const memoryCache = new Map<string, CacheEntry<any>>();
const CACHE_PREFIX = 'mb_cache_';
const DB_NAME = 'mediabox_cache_db';
const STORE_NAME = 'kv_store';
const UPDATED_INDEX = 'by_updated';
const DB_VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        reject(new Error('IndexedDB not supported'));
        return;
      }
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event: any) => {
        const db = event.target.result as IDBDatabase;
        let store: IDBObjectStore;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          store = db.createObjectStore(STORE_NAME);
        } else {
          store = (event.target as any).transaction.objectStore(STORE_NAME);
        }
        if (!store.indexNames.contains(UPDATED_INDEX)) {
          store.createIndex(UPDATED_INDEX, 'updatedAt', { unique: false });
        }
      };
      request.onsuccess = (event: any) => resolve(event.target.result as IDBDatabase);
      request.onerror = (event: any) => reject(event.target.error);
      // Открытие могло навсегда зависнуть (blocked другой вкладкой) или один раз
      // reject'нуться — тогда кэшированный promise навсегда отключал весь IDB-слой.
      request.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
    dbPromise = opening.catch((err: unknown) => {
      // Сбрасываем промис: следующая операция повторит попытку открытия
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

// Request persistent storage from browser so OS/browser won't purge IndexedDB
if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

export const isExpired = (expiry?: number, now: number = Date.now()): boolean => {
  if (!expiry || expiry === 0 || expiry >= Number.MAX_SAFE_INTEGER - 1000) return false;
  return now >= expiry;
};

// Background sync from IndexedDB into memoryCache on startup (hydrates the
// 200 most recently written entries for 0ms sync reads on the first screen)
async function initIndexedDBCache(): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    let request: IDBRequest;
    try {
      request = store.indexNames.contains(UPDATED_INDEX)
        ? store.index(UPDATED_INDEX).openCursor(null, 'prev')
        : store.openCursor();
    } catch (_) {
      request = store.openCursor();
    }
    const now = Date.now();
    let loadedCount = 0;

    request.onsuccess = (event: any) => {
      const cursor = event.target.result as IDBCursorWithValue;
      if (cursor && loadedCount < 200) {
        const key = cursor.key as string;
        const entry = cursor.value as CacheEntry<any>;
        if (entry && !isExpired(entry.expiry, now)) {
          if (!memoryCache.has(key)) {
            memoryCache.set(key, entry);
            loadedCount++;
          }
        }
        cursor.continue();
      }
    };
  } catch (e) {
    console.warn('[ClientCache] IndexedDB init deferred:', e);
  }

  // Migrate legacy localStorage cache to avoid blocking
  try {
    const now = Date.now();
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX)) {
        const stored = localStorage.getItem(key);
        if (stored) {
          try {
            const entry: CacheEntry<any> = JSON.parse(stored);
            if (now < entry.expiry) {
              memoryCache.set(key, entry);
              idbSet(key, entry);
            }
          } catch (e) {}
          keysToRemove.push(key);
        }
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (e) {}
}

async function idbGet<T>(fullKey: string): Promise<CacheEntry<T> | null> {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(fullKey);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (_) {
    return null;
  }
}

async function idbSet(fullKey: string, entry: CacheEntry<any>): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    // tx.onerror обязателен: при QuotaExceededError записи молча терялись
    tx.onerror = () => {
      console.warn('[ClientCache] IDB write failed:', tx.error);
    };
    tx.objectStore(STORE_NAME).put(entry, fullKey);
  } catch (e) {}
}

async function idbRemove(fullKey: string): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.onerror = () => {
      console.warn('[ClientCache] IDB remove failed:', tx.error);
    };
    tx.objectStore(STORE_NAME).delete(fullKey);
  } catch (e) {}
}

const MAX_MEMORY_ENTRIES = 200;

function enforceMemoryLRU(): void {
  while (memoryCache.size >= MAX_MEMORY_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) {
      memoryCache.delete(oldestKey);
    } else {
      break;
    }
  }
}

export const clientCache = {
  get<T>(key: string): T | null {
    const fullKey = CACHE_PREFIX + key;
    const now = Date.now();

    // 1. Instant check in memory map (0ms Main Thread overhead)
    if (memoryCache.has(fullKey)) {
      const entry = memoryCache.get(fullKey)!;
      if (!isExpired(entry.expiry, now)) {
        // Re-insert to refresh LRU position
        memoryCache.delete(fullKey);
        memoryCache.set(fullKey, entry);
        return entry.data as T;
      }
      memoryCache.delete(fullKey);
      idbRemove(fullKey);
      try {
        localStorage.removeItem(fullKey);
      } catch (_) {}
    }

    // 2. Synchronous instant fallback for critical home feeds and streams before IndexedDB async cursor finishes
    try {
      const fallbackStored = localStorage.getItem(fullKey);
      if (fallbackStored) {
        const entry: CacheEntry<T> = JSON.parse(fallbackStored);
        if (!isExpired(entry.expiry, now)) {
          memoryCache.set(fullKey, entry);
          enforceMemoryLRU();
          return entry.data as T;
        } else {
          localStorage.removeItem(fullKey);
        }
      }
    } catch (_) {}

    return null;
  },

  async getAsync<T>(key: string): Promise<T | null> {
    const fullKey = CACHE_PREFIX + key;
    const now = Date.now();

    // 1. Instant check in memory map (0ms Main Thread overhead)
    if (memoryCache.has(fullKey)) {
      const entry = memoryCache.get(fullKey)!;
      if (!isExpired(entry.expiry, now)) {
        memoryCache.delete(fullKey);
        memoryCache.set(fullKey, entry);
        return entry.data as T;
      }
      memoryCache.delete(fullKey);
      idbRemove(fullKey);
      try {
        localStorage.removeItem(fullKey);
      } catch (_) {}
      return null;
    }

    // 2. Synchronous fallback from localStorage
    try {
      const fallbackStored = localStorage.getItem(fullKey);
      if (fallbackStored) {
        const entry: CacheEntry<T> = JSON.parse(fallbackStored);
        if (!isExpired(entry.expiry, now)) {
          enforceMemoryLRU();
          memoryCache.set(fullKey, entry);
          return entry.data as T;
        } else {
          localStorage.removeItem(fullKey);
        }
      }
    } catch (_) {}

    // 3. Fast non-blocking read directly from IndexedDB disk (5-30ms)
    try {
      const entry = await idbGet<T>(fullKey);
      if (entry) {
        if (!isExpired(entry.expiry, now)) {
          enforceMemoryLRU();
          memoryCache.set(fullKey, entry);
          return entry.data;
        } else {
          idbRemove(fullKey);
        }
      }
    } catch (_) {}

    return null;
  },

  set<T>(key: string, data: T, ttlSeconds: number = 0): void {
    const fullKey = CACHE_PREFIX + key;
    // ttlSeconds === 0 historically meant permanent; cap it at 7 days so
    // IndexedDB (which has no eviction) cannot grow unbounded.
    const DEFAULT_TTL_SECONDS = 7 * 24 * 3600;
    const effectiveTtl = (ttlSeconds && ttlSeconds > 0) ? ttlSeconds : DEFAULT_TTL_SECONDS;
    const expiry = Date.now() + effectiveTtl * 1000;
    const entry: CacheEntry<T> = { data, expiry, updatedAt: Date.now() };

    // 1. Memory Tier (skip eviction when updating an existing key)
    if (!memoryCache.has(fullKey)) {
      enforceMemoryLRU();
    }
    memoryCache.set(fullKey, entry);

    // 2. Synchronous mirror for critical feeds and compact stream descriptors (instant 0ms hydration on F5)
    if (key.includes('home') || key.includes('genres') || key.includes('trending') || key.includes('feed')) {
      try {
        localStorage.setItem(fullKey, JSON.stringify(entry));
      } catch (_) {}
    } else if (key.startsWith('liftw_stream_') || key.includes('_stream_')) {
      try {
        // Guard against localStorage 5MB quota: mirror compact playback descriptor.
        // episodes tree is kept: it is tiny (season -> [episode] strings, <1KB)
        // and dropping it breaks series UI after F5 (sync get() reads only memory + localStorage).
        const streamData = data as any;
        const compactData = streamData && typeof streamData === 'object' ? {
          iframe: streamData.iframe,
          liftwId: streamData.liftwId,
          liftwType: streamData.liftwType,
          name: streamData.name,
          episodes: streamData.episodes,
        } : data;
        const compactEntry: CacheEntry<any> = { data: compactData, expiry };
        localStorage.setItem(fullKey, JSON.stringify(compactEntry));

        // Enforce max 10 stream entries in localStorage to prevent storage pressure
        const streamKeys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const lk = localStorage.key(i);
          if (lk && lk.startsWith(CACHE_PREFIX) && (lk.includes('liftw_stream_') || lk.includes('_stream_'))) {
            streamKeys.push(lk);
          }
        }
        if (streamKeys.length > 10) {
          for (let i = 0; i < streamKeys.length - 10; i++) {
            localStorage.removeItem(streamKeys[i]);
          }
        }
      } catch (_) {}
    }

    // 3. Persistent IndexedDB Tier (async background write - stores complete object including full episodes tree)
    idbSet(fullKey, entry);
  },

  remove(key: string): void {
    const fullKey = CACHE_PREFIX + key;
    memoryCache.delete(fullKey);
    idbRemove(fullKey);
    try {
      localStorage.removeItem(fullKey);
    } catch (_) {}
  }
};

/**
 * Неблокирующая фоновая сборка мусора (Garbage Collection):
 * Удаляет просроченные записи из дисковой IndexedDB, предотвращая переполнение квоты диска на мобильных устройствах.
 * Запускается отложено через requestIdleCallback / setTimeout с низким приоритетом, чтобы не влиять на рендер UI.
 */
async function purgeExpiredIndexedDB(): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.openCursor();
    const now = Date.now();
    let purgedCount = 0;

    request.onsuccess = (event: any) => {
      const cursor = event.target.result as IDBCursorWithValue;
      if (cursor) {
        const entry = cursor.value as CacheEntry<any>;
        if (entry && isExpired(entry.expiry, now)) {
          cursor.delete();
          purgedCount++;
        }
        // Лимитируем порцию за один проход (500 удалений), но НЕ останавливаем
        // обход: после порции продолжаем без delete — иначе записи после 500-й
        // дожидались бы следующего запуска приложения.
        if (purgedCount < 500 || !(entry && isExpired(entry.expiry, now))) {
          cursor.continue();
        }
      }
    };
  } catch (_) {}
}

declare const __APP_BUILD_TIME__: string;

// Автоматическая инвалидация устаревшего кэша при развертывании нового билда:
// Гарантирует, что при обновлении кода зрители мгновенно получают свежие видеопотоки без старых 404
function checkBuildVersionAndPurge(): void {
  if (typeof window === 'undefined') return;
  const BUILD_VERSION_KEY = 'mb_build_timestamp';
  const currentBuild = typeof __APP_BUILD_TIME__ !== 'undefined' ? __APP_BUILD_TIME__ : 'dev';
  const lastBuild = localStorage.getItem(BUILD_VERSION_KEY);

  if (lastBuild && lastBuild !== currentBuild) {
    memoryCache.clear();
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(CACHE_PREFIX)) {
          localStorage.removeItem(k);
        }
      }
    } catch (_) {}

    getDB().then((db) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
    }).catch(() => {});
  }

  try {
    localStorage.setItem(BUILD_VERSION_KEY, currentBuild);
  } catch (_) {}
}

// Initialize IndexedDB hydration in background
if (typeof window !== 'undefined') {
  checkBuildVersionAndPurge();
  initIndexedDBCache();
  // Отложенный запуск GC через 4 секунды после старта приложения
  setTimeout(() => {
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => purgeExpiredIndexedDB());
    } else {
      setTimeout(purgeExpiredIndexedDB, 1000);
    }
  }, 4000);
}


