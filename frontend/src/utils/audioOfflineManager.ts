/**
 * Audio Offline Cache Manager
 * Uses standard W3C Cache API (supported in iOS Safari, WebKit, Chrome, PWA)
 * to store full 320 kbps audio tracks directly on device storage for offline playback.
 */

const CACHE_NAME = 'mb_offline_tracks_v1';

class AudioOfflineManager {
  private isSupported(): boolean {
    return typeof window !== 'undefined' && 'caches' in window;
  }

  /**
   * Downloads and saves audio file into device Cache Storage as binary Blob
   */
  async saveTrackAudio(id: string, audioUrl: string): Promise<boolean> {
    if (!this.isSupported() || !audioUrl) return false;

    try {
      const cache = await caches.open(CACHE_NAME);
      const existing = await cache.match(audioUrl);
      if (existing) return true; // Already cached

      const response = await fetch(audioUrl, { mode: 'cors' });
      if (!response.ok) return false;

      // Store in Cache Storage
      await cache.put(audioUrl, response.clone());
      return true;
    } catch (err) {
      console.warn(`[AudioOffline] Failed to cache audio ${id}:`, err);
      return false;
    }
  }

  /**
   * Retrieves locally cached audio as a blob Object URL for 0ms offline playback.
   * Returns null if track is not yet cached.
   */
  async getTrackAudioUrl(audioUrl: string): Promise<string | null> {
    if (!this.isSupported() || !audioUrl) return null;

    try {
      const cache = await caches.open(CACHE_NAME);
      const match = await cache.match(audioUrl);
      if (!match) return null;

      const blob = await match.blob();
      if (!blob || blob.size === 0) return null;

      return URL.createObjectURL(blob);
    } catch (err) {
      console.warn('[AudioOffline] Failed to load cached audio:', err);
      return null;
    }
  }

  /**
   * Checks if an audio URL is cached in local storage
   */
  async isAudioCached(audioUrl: string): Promise<boolean> {
    if (!this.isSupported() || !audioUrl) return false;

    try {
      const cache = await caches.open(CACHE_NAME);
      const match = await cache.match(audioUrl);
      return Boolean(match);
    } catch (_) {
      return false;
    }
  }

  /**
   * Removes specific audio URL from local storage
   */
  async removeTrackAudio(audioUrl: string): Promise<void> {
    if (!this.isSupported() || !audioUrl) return;

    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.delete(audioUrl);
    } catch (_) {}
  }

  /**
   * Clears the entire offline audio cache
   */
  async clearAudioCache(): Promise<boolean> {
    if (!this.isSupported()) return false;

    try {
      return await caches.delete(CACHE_NAME);
    } catch (err) {
      console.warn('[AudioOffline] Clear cache failed:', err);
      return false;
    }
  }

  /**
   * Calculates total offline audio cache size and count of saved tracks
   */
  async getAudioCacheStats(): Promise<{ count: number; sizeBytes: number }> {
    if (!this.isSupported()) return { count: 0, sizeBytes: 0 };

    try {
      const cache = await caches.open(CACHE_NAME);
      const keys = await cache.keys();
      let totalBytes = 0;

      for (const req of keys) {
        try {
          const res = await cache.match(req);
          if (res) {
            const blob = await res.blob();
            totalBytes += blob.size;
          }
        } catch (_) {}
      }

      return {
        count: keys.length,
        sizeBytes: totalBytes
      };
    } catch (_) {
      return { count: 0, sizeBytes: 0 };
    }
  }

  /**
   * Helper to format bytes into readable string (e.g. "14.2 МБ")
   */
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 МБ';
    const mb = bytes / (1024 * 1024);
    if (mb < 1) {
      const kb = Math.round(bytes / 1024);
      return `${kb} КБ`;
    }
    return `${mb.toFixed(1)} МБ`;
  }
}

export const audioOfflineManager = new AudioOfflineManager();
