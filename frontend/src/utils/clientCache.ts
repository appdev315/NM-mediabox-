/**
 * Client-side Caching Utility for MediaBox
 * Stores API responses (TMDB metadata, trending, details) in localStorage + In-Memory cache
 * to eliminate redundant network requests and provide instant UI rendering on user device.
 */

interface CacheEntry<T> {
  data: T;
  expiry: number; // timestamp in ms
}

const memoryCache = new Map<string, CacheEntry<any>>();
const CACHE_PREFIX = 'mb_cache_';

export const clientCache = {
  get<T>(key: string): T | null {
    const fullKey = CACHE_PREFIX + key;
    const now = Date.now();

    // 1. Check in-memory cache first (fastest)
    if (memoryCache.has(fullKey)) {
      const entry = memoryCache.get(fullKey)!;
      if (now < entry.expiry) {
        return entry.data as T;
      }
      memoryCache.delete(fullKey);
    }

    // 2. Check localStorage
    try {
      const stored = localStorage.getItem(fullKey);
      if (stored) {
        const entry: CacheEntry<T> = JSON.parse(stored);
        if (now < entry.expiry) {
          // Re-populate memory cache
          memoryCache.set(fullKey, entry);
          return entry.data;
        }
        localStorage.removeItem(fullKey);
      }
    } catch (e) {
      console.warn('[ClientCache] Failed to read from localStorage:', e);
    }

    return null;
  },

  set<T>(key: string, data: T, ttlSeconds: number = 3600): void {
    const fullKey = CACHE_PREFIX + key;
    const expiry = Date.now() + ttlSeconds * 1000;
    const entry: CacheEntry<T> = { data, expiry };

    // Save in memory
    memoryCache.set(fullKey, entry);

    // Save in localStorage
    try {
      localStorage.setItem(fullKey, JSON.stringify(entry));
    } catch (e) {
      console.warn('[ClientCache] Failed to save to localStorage:', e);
    }
  },

  remove(key: string): void {
    const fullKey = CACHE_PREFIX + key;
    memoryCache.delete(fullKey);
    try {
      localStorage.removeItem(fullKey);
    } catch (e) {}
  },

  clearExpired(): void {
    const now = Date.now();
    for (const [key, entry] of memoryCache.entries()) {
      if (now >= entry.expiry) {
        memoryCache.delete(key);
      }
    }

    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(CACHE_PREFIX)) {
          const stored = localStorage.getItem(key);
          if (stored) {
            try {
              const entry = JSON.parse(stored);
              if (now >= entry.expiry) {
                keysToRemove.push(key);
              }
            } catch (e) {
              keysToRemove.push(key);
            }
          }
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch (e) {}
  }
};

// Periodically clean up expired items on load
clientCache.clearExpired();
