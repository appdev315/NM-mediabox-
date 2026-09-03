/**
 * Enhanced Client-side Caching Utility for MediaBox
 * Leverages IndexedDB for non-blocking storage of large API payloads
 * and In-Memory Map for instant 0ms synchronous UI reads.
 */

interface CacheEntry<T> {
  data: T;
  expiry: number; // timestamp in ms
}

const memoryCache = new Map<string, CacheEntry<any>>();
const CACHE_PREFIX = 'mb_cache_';
const DB_NAME = 'mediabox_cache_db';
const STORE_NAME = 'kv_store';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        reject(new Error('IndexedDB not supported'));
        return;
      }
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event: any) => {
        const db = event.target.result as IDBDatabase;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = (event: any) => resolve(event.target.result as IDBDatabase);
      request.onerror = (event: any) => reject(event.target.error);
    });
  }
  return dbPromise;
}

// Background sync from IndexedDB into memoryCache on startup
async function initIndexedDBCache(): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.openCursor();
    const now = Date.now();

    request.onsuccess = (event: any) => {
      const cursor = event.target.result as IDBCursorWithValue;
      if (cursor) {
        const key = cursor.key as string;
        const entry = cursor.value as CacheEntry<any>;
        if (entry && entry.expiry && now < entry.expiry) {
          if (!memoryCache.has(key)) {
            memoryCache.set(key, entry);
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

async function idbSet(fullKey: string, entry: CacheEntry<any>): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(entry, fullKey);
  } catch (e) {}
}

async function idbRemove(fullKey: string): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(fullKey);
  } catch (e) {}
}

const MAX_MEMORY_ENTRIES = 500;

function enforceMemoryLRU(): void {
  if (memoryCache.size > MAX_MEMORY_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) {
      memoryCache.delete(oldestKey);
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
      if (now < entry.expiry) {
        // Re-insert to refresh LRU position
        memoryCache.delete(fullKey);
        memoryCache.set(fullKey, entry);
        return entry.data as T;
      }
      memoryCache.delete(fullKey);
      idbRemove(fullKey);
    }

    // 2. Synchronous instant fallback for critical home feeds before IndexedDB async cursor finishes
    try {
      const fallbackStored = localStorage.getItem(fullKey);
      if (fallbackStored) {
        const entry: CacheEntry<T> = JSON.parse(fallbackStored);
        if (now < entry.expiry) {
          memoryCache.set(fullKey, entry);
          return entry.data as T;
        } else {
          localStorage.removeItem(fullKey);
        }
      }
    } catch (_) {}

    return null;
  },

  set<T>(key: string, data: T, ttlSeconds: number = 172800): void {
    const fullKey = CACHE_PREFIX + key;
    const expiry = Date.now() + ttlSeconds * 1000;
    const entry: CacheEntry<T> = { data, expiry };

    // 1. Memory Tier
    enforceMemoryLRU();
    memoryCache.set(fullKey, entry);

    // 2. Synchronous mirror for critical home feeds (instant 0ms hydration on F5)
    if (key.includes('home') || key.includes('genres') || key.includes('trending') || key.includes('feed')) {
      try {
        localStorage.setItem(fullKey, JSON.stringify(entry));
      } catch (_) {}
    }

    // 3. Persistent IndexedDB Tier (async background write)
    idbSet(fullKey, entry);
  },

  remove(key: string): void {
    const fullKey = CACHE_PREFIX + key;
    memoryCache.delete(fullKey);
    idbRemove(fullKey);
  },

  clearExpired(): void {
    const now = Date.now();
    for (const [key, entry] of memoryCache.entries()) {
      if (now >= entry.expiry) {
        memoryCache.delete(key);
        idbRemove(key);
      }
    }
  }
};

// Initialize IndexedDB hydration in background
if (typeof window !== 'undefined') {
  initIndexedDBCache();
}

