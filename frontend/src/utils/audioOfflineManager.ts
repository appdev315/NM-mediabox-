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
      if (existing) {
        if (id) {
          await cache.put(`https://offline.mediabox.local/track/${encodeURIComponent(id)}`, existing.clone());
        }
        return true;
      }

      const response = await fetch(audioUrl, { mode: 'cors' });
      if (!response.ok) return false;

      // Store in Cache Storage by audioUrl and by track id
      await cache.put(audioUrl, response.clone());
      if (id) {
        await cache.put(`https://offline.mediabox.local/track/${encodeURIComponent(id)}`, response.clone());
      }
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
  async getTrackAudioUrl(urlOrId: string, trackId?: string): Promise<string | null> {
    if (!this.isSupported() || (!urlOrId && !trackId)) return null;

    try {
      const cache = await caches.open(CACHE_NAME);
      let match = urlOrId ? await cache.match(urlOrId) : null;
      if (!match && trackId) {
        match = await cache.match(`https://offline.mediabox.local/track/${encodeURIComponent(trackId)}`);
      }
      if (!match && urlOrId && !urlOrId.startsWith('http')) {
        match = await cache.match(`https://offline.mediabox.local/track/${encodeURIComponent(urlOrId)}`);
      }
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
   * Checks if an audio URL or track ID is cached in local storage
   */
  async isAudioCached(urlOrId: string, trackId?: string): Promise<boolean> {
    if (!this.isSupported() || (!urlOrId && !trackId)) return false;

    try {
      const cache = await caches.open(CACHE_NAME);
      let match = urlOrId ? await cache.match(urlOrId) : null;
      if (!match && trackId) {
        match = await cache.match(`https://offline.mediabox.local/track/${encodeURIComponent(trackId)}`);
      }
      if (!match && urlOrId && !urlOrId.startsWith('http')) {
        match = await cache.match(`https://offline.mediabox.local/track/${encodeURIComponent(urlOrId)}`);
      }
      return Boolean(match);
    } catch (_) {
      return false;
    }
  }

  /**
   * Removes specific audio URL or track ID from local storage
   */
  async removeTrackAudio(urlOrId: string, trackId?: string): Promise<void> {
    if (!this.isSupported()) return;

    try {
      const cache = await caches.open(CACHE_NAME);
      if (urlOrId) await cache.delete(urlOrId);
      if (trackId) {
        await cache.delete(`https://offline.mediabox.local/track/${encodeURIComponent(trackId)}`);
      }
      if (urlOrId && !urlOrId.startsWith('http')) {
        await cache.delete(`https://offline.mediabox.local/track/${encodeURIComponent(urlOrId)}`);
      }
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
   * Retrieves raw binary audio Blob from cache (or fetches directly if not cached)
   */
  async getTrackBlob(audioUrl: string): Promise<Blob | null> {
    if (!audioUrl) return null;
    if (this.isSupported()) {
      try {
        const cache = await caches.open(CACHE_NAME);
        const match = await cache.match(audioUrl);
        if (match) {
          const blob = await match.blob();
          if (blob && blob.size > 0) return blob;
        }
      } catch (_) {}
    }

    try {
      const response = await fetch(audioUrl, { mode: 'cors' });
      if (response.ok) {
        return await response.blob();
      }
    } catch (err) {
      console.warn('[AudioOffline] Fetch blob failed:', err);
    }
    return null;
  }

  /**
   * Exports a single track to the native device files system.
   * On Desktop (Mac / Windows / Linux): directly downloads MP3/M4A to Downloads folder.
   * On iOS / Mobile: opens native Share Sheet (Save to Files / AirDrop / apps).
   */
  async exportTrack(track: { title: string; artist: string; audioUrl: string; id?: string }): Promise<boolean> {
    if (!track) return false;
    let targetUrl = track.audioUrl;

    // Auto-resolve full stream if track is a preview or unresolved
    if (!targetUrl || targetUrl.includes('preview') || targetUrl.includes('dzcdn') || targetUrl.includes('mzstatic') || targetUrl.includes('itunes')) {
      try {
        const { resolveFullAudioUrl } = await import('../hooks/useMusicApi');
        const resolved = await resolveFullAudioUrl(track.artist, track.title, targetUrl, track.id);
        if (resolved) {
          targetUrl = resolved;
        }
      } catch (_) {}
    }

    if (!targetUrl) return false;
    const blob = await this.getTrackBlob(targetUrl);
    if (!blob) return false;

    const ext = blob.type.includes('mpeg') || blob.type.includes('mp3') ? 'mp3' : 'm4a';
    const mimeType = ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4';
    const safeName = `${track.artist} - ${track.title}`
      .replace(/[/\\?%*:|"<>]/g, '_')
      .replace(/\s+/g, ' ')
      .trim() || 'track';
    const filename = `${safeName}.${ext}`;

    const isMobile = typeof navigator !== 'undefined' && 
      (/iphone|ipad|ipod|android/i.test(navigator.userAgent) || 
      (navigator.maxTouchPoints > 1 && window.innerWidth < 1024));

    // Mobile-only: native share sheet for iOS "Save to Files"
    if (isMobile && typeof navigator.share === 'function') {
      try {
        const file = new File([blob], filename, { type: mimeType });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: `${track.artist} - ${track.title}`
          });
          return true;
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return true;
        console.warn('[AudioOffline] Share failed, falling back to direct download:', err);
      }
    }

    // Desktop (Mac, Windows, Linux) or mobile fallback: direct browser download to Downloads folder
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
    return true;
  }

  /**
   * Exports multiple tracks to device files system
   */
  async exportTracks(tracks: Array<{ title: string; artist: string; audioUrl: string; id?: string }>): Promise<number> {
    if (!tracks || tracks.length === 0) return 0;

    const isMobile = typeof navigator !== 'undefined' && 
      (/iphone|ipad|ipod|android/i.test(navigator.userAgent) || 
      (navigator.maxTouchPoints > 1 && window.innerWidth < 1024));

    const files: File[] = [];
    for (const track of tracks) {
      let targetUrl = track.audioUrl;
      if (!targetUrl || targetUrl.includes('preview') || targetUrl.includes('dzcdn') || targetUrl.includes('mzstatic') || targetUrl.includes('itunes')) {
        try {
          const { resolveFullAudioUrl } = await import('../hooks/useMusicApi');
          const resolved = await resolveFullAudioUrl(track.artist, track.title, targetUrl, track.id);
          if (resolved) {
            targetUrl = resolved;
          }
        } catch (_) {}
      }

      if (!targetUrl) continue;
      const blob = await this.getTrackBlob(targetUrl);
      if (!blob) continue;
      const ext = blob.type.includes('mpeg') || blob.type.includes('mp3') ? 'mp3' : 'm4a';
      const mimeType = ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4';
      const safeName = `${track.artist} - ${track.title}`
        .replace(/[/\\?%*:|"<>]/g, '_')
        .replace(/\s+/g, ' ')
        .trim() || 'track';
      files.push(new File([blob], `${safeName}.${ext}`, { type: mimeType }));
    }

    if (files.length === 0) return 0;

    if (isMobile && typeof navigator.share === 'function') {
      try {
        if (navigator.canShare && navigator.canShare({ files })) {
          await navigator.share({
            files,
            title: 'MediaBox Music'
          });
          return files.length;
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return files.length;
      }
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const objectUrl = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
      if (i < files.length - 1) {
        await new Promise(r => setTimeout(r, 400));
      }
    }
    return files.length;
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
