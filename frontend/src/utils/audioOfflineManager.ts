/**
 * Audio Offline Cache Manager
 * Uses standard W3C Cache API (supported in iOS Safari, WebKit, Chrome, PWA)
 * to store full 320 kbps audio tracks directly on device storage for offline playback.
 */

const CACHE_NAME = 'mb_offline_tracks_v1';

// Fetch с жёстким таймаутом: зависшее соединение не должно оставлять вечнозависший промис
// и блокировать повторные попытки. AbortController поддерживается шире, чем AbortSignal.timeout.
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { mode: 'cors', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

class AudioOfflineManager {
  // Нормализуем ID трека, отсекая префикс saavn_ для единого формата канонического ключа
  private cleanId(id?: string | number): string {
    return String(id || '').replace(/^saavn_/, '').trim();
  }

  // Формирует канонический URI трека в локальном Cache Storage
  private getCanonicalUrl(id?: string | number): string {
    const c = this.cleanId(id);
    return c ? `https://offline.mediabox.local/track/${encodeURIComponent(c)}` : '';
  }

  private isSupported(): boolean {
    return typeof window !== 'undefined' && 'caches' in window;
  }

  /**
   * Downloads and saves audio file into device Cache Storage as binary Blob.
   * Сохраняет метаданные качества ('X-Audio-Quality': 'low' | 'high'),
   * позволяя при подключении к быстрой сети автоматически обновить трек до 320 kbps.
   */
  async saveTrackAudio(id: string, audioUrl: string, quality?: 'low' | 'high'): Promise<boolean> {
    if (!this.isSupported() || !audioUrl) return false;

    try {
      const cache = await caches.open(CACHE_NAME);
      const canonicalUrl = this.getCanonicalUrl(id);
      const rawCanonicalUrl = id && id.startsWith('saavn_') ? `https://offline.mediabox.local/track/${encodeURIComponent(id)}` : '';

      const isLow = quality === 'low' || /_96\.|_48\./.test(audioUrl);

      // Если файл уже есть в кэше и это не апгрейд качества, сохраняем существующий
      let existing = canonicalUrl ? await cache.match(canonicalUrl) : null;
      if (!existing && rawCanonicalUrl) {
        existing = await cache.match(rawCanonicalUrl);
      }
      if (!existing) {
        existing = await cache.match(audioUrl);
      }

      if (existing) {
        const existingQuality = existing.headers.get('X-Audio-Quality');
        // Если уже сохранён high-поток или новый тоже low — не тратим трафик на повторный запрос
        if (existingQuality === 'high' || isLow) {
          if (canonicalUrl) {
            await cache.put(canonicalUrl, existing.clone());
          }
          await cache.put(audioUrl, existing.clone());
          return true;
        }
      }

      const response = await fetchWithTimeout(audioUrl, 90000);
      if (!response.ok) return false;

      const blob = await response.blob();
      const headers = new Headers();
      headers.set('Content-Type', response.headers.get('Content-Type') || 'audio/mp4');
      headers.set('X-Audio-Quality', isLow ? 'low' : 'high');
      headers.set('X-Audio-Source-Url', audioUrl);

      const responseToCache = new Response(blob, { headers });

      // Удаляем старый файл для этого id перед сохранением апгрейда
      if (canonicalUrl) {
        await cache.delete(canonicalUrl).catch(() => {});
      }
      if (rawCanonicalUrl) {
        await cache.delete(rawCanonicalUrl).catch(() => {});
      }

      // Сохраняем в Cache Storage по аудио-URL и каноническому id
      await cache.put(audioUrl, responseToCache.clone());
      if (canonicalUrl) {
        await cache.put(canonicalUrl, responseToCache.clone());
      }

      return true;
    } catch (err) {
      console.warn(`[AudioOffline] Failed to cache audio ${id}:`, err);
      return false;
    }
  }

  /**
   * Проверяет, был ли трек сохранён в пониженном качестве (96k / 48k).
   * Используется для автоматического докачивания 320 kbps версии при входе в хорошую сеть.
   */
  async isTrackCachedLowQuality(trackId?: string, url?: string): Promise<boolean> {
    if (!this.isSupported() || (!trackId && !url)) return false;
    try {
      const cache = await caches.open(CACHE_NAME);
      const canonicalUrl = this.getCanonicalUrl(trackId);
      let match = canonicalUrl ? await cache.match(canonicalUrl) : null;
      if (!match && trackId) {
        match = await cache.match(`https://offline.mediabox.local/track/${encodeURIComponent(trackId)}`);
      }
      if (!match && url) {
        match = await cache.match(url);
      }
      if (!match) return false;
      const quality = match.headers.get('X-Audio-Quality');
      if (quality === 'low') return true;
      const sourceUrl = match.headers.get('X-Audio-Source-Url') || '';
      return /_96\.|_48\./.test(sourceUrl);
    } catch (_) {
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
      const targetId = trackId || (!urlOrId.startsWith('http') ? urlOrId : '');
      const canonicalUrl = this.getCanonicalUrl(targetId);
      let match = canonicalUrl ? await cache.match(canonicalUrl) : null;
      if (!match && targetId) {
        match = await cache.match(`https://offline.mediabox.local/track/${encodeURIComponent(targetId)}`);
      }
      if (!match && urlOrId && urlOrId.startsWith('http')) {
        match = await cache.match(urlOrId);
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
      const targetId = trackId || (!urlOrId.startsWith('http') ? urlOrId : '');
      const canonicalUrl = this.getCanonicalUrl(targetId);
      let match = canonicalUrl ? await cache.match(canonicalUrl) : null;
      if (!match && targetId) {
        match = await cache.match(`https://offline.mediabox.local/track/${encodeURIComponent(targetId)}`);
      }
      if (!match && urlOrId && urlOrId.startsWith('http')) {
        match = await cache.match(urlOrId);
      }
      return Boolean(match);
    } catch (_) {
      return false;
    }
  }

  /**
   * Removes specific audio URL or track ID from local storage.
   * Гарантирует удаление как канонического ключа, так и оригинального сетевого URL,
   * предотвращая накопление висячих (orphan) блобов в памяти.
   */
  async removeTrackAudio(urlOrId: string, trackId?: string): Promise<void> {
    if (!this.isSupported()) return;

    try {
      const cache = await caches.open(CACHE_NAME);
      const targetId = trackId || (!urlOrId.startsWith('http') ? urlOrId : '');
      const canonicalUrl = this.getCanonicalUrl(targetId);

      // Считываем X-Audio-Source-Url из канонической записи, чтобы удалить и бинарный блоб
      let sourceUrlToDelete = urlOrId && urlOrId.startsWith('http') ? urlOrId : '';
      if (!sourceUrlToDelete && canonicalUrl) {
        const match = await cache.match(canonicalUrl);
        if (match) {
          sourceUrlToDelete = match.headers.get('X-Audio-Source-Url') || '';
        }
      }

      if (sourceUrlToDelete) {
        await cache.delete(sourceUrlToDelete);
      }
      if (canonicalUrl) {
        await cache.delete(canonicalUrl);
      }
      if (targetId) {
        await cache.delete(`https://offline.mediabox.local/track/${encodeURIComponent(targetId)}`);
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
      let count = 0;

      // Count only canonical track keys to eliminate double-counting with audioUrl
      const canonicalKeys = keys.filter(req => req.url.startsWith('https://offline.mediabox.local/track/'));
      const effectiveKeys = canonicalKeys.length > 0 ? canonicalKeys : keys;

      for (const req of effectiveKeys) {
        try {
          const res = await cache.match(req);
          if (res) {
            const blob = await res.blob();
            totalBytes += blob.size;
            count++;
          }
        } catch (_) {}
      }

      return {
        count,
        sizeBytes: totalBytes
      };
    } catch (_) {
      return { count: 0, sizeBytes: 0 };
    }
  }

  /**
   * Retrieves raw binary audio Blob from cache (or fetches directly if not cached)
   */
  async getTrackBlob(audioUrl: string, trackId?: string): Promise<Blob | null> {
    if (!audioUrl && !trackId) return null;
    if (this.isSupported()) {
      try {
        const cache = await caches.open(CACHE_NAME);
        const targetId = trackId || (!audioUrl.startsWith('http') ? audioUrl : '');
        const canonicalUrl = this.getCanonicalUrl(targetId);
        let match = canonicalUrl ? await cache.match(canonicalUrl) : null;
        if (!match && targetId) {
          match = await cache.match(`https://offline.mediabox.local/track/${encodeURIComponent(targetId)}`);
        }
        if (!match && audioUrl && audioUrl.startsWith('http')) {
          match = await cache.match(audioUrl);
        }
        if (match) {
          const blob = await match.blob();
          if (blob && blob.size > 0) return blob;
        }
      } catch (_) {}
    }

    if (!audioUrl) return null;
    try {
      const response = await fetchWithTimeout(audioUrl, 90000);
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

    if (!targetUrl || targetUrl.includes('preview') || targetUrl.includes('dzcdn') || targetUrl.includes('mzstatic') || targetUrl.includes('itunes')) return false;
    const blob = await this.getTrackBlob(targetUrl, track.id);
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
   * Exports multiple tracks to device files system.
   * Обрабатывает пачку БАТЧАМИ по 5 треков: в памяти одновременно держим 3-5 файлов,
   * а не всю пачку (десятки треков по 5-10 МБ иначе занимали сотни МБ RAM).
   * На мобильных share-лист открывается на каждую партию.
   */
  async exportTracks(tracks: Array<{ title: string; artist: string; audioUrl: string; id?: string }>): Promise<number> {
    if (!tracks || tracks.length === 0) return 0;

    const isMobile = typeof navigator !== 'undefined' && 
      (/iphone|ipad|ipod|android/i.test(navigator.userAgent) || 
      (navigator.maxTouchPoints > 1 && window.innerWidth < 1024));

    const BATCH_SIZE = 5;
    let exported = 0;

    for (let batchStart = 0; batchStart < tracks.length; batchStart += BATCH_SIZE) {
      const batch = tracks.slice(batchStart, batchStart + BATCH_SIZE);
      const files: File[] = [];

      for (const track of batch) {
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

        if (!targetUrl || targetUrl.includes('preview') || targetUrl.includes('dzcdn')) continue;
        const blob = await this.getTrackBlob(targetUrl, track.id);
        if (!blob) continue;
        const ext = blob.type.includes('mpeg') || blob.type.includes('mp3') ? 'mp3' : 'm4a';
        const mimeType = ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4';
        const safeName = `${track.artist} - ${track.title}`
          .replace(/[/\\?%*:|"<>]/g, '_')
          .replace(/\s+/g, ' ')
          .trim() || 'track';
        files.push(new File([blob], `${safeName}.${ext}`, { type: mimeType }));
      }
      // blob-объекты партии освобождаются при выходе из этой итерации

      if (files.length === 0) continue;

      if (isMobile && typeof navigator.share === 'function') {
        try {
          if (navigator.canShare && navigator.canShare({ files })) {
            await navigator.share({
              files,
              title: 'MediaBox Music'
            });
            exported += files.length;
            continue;
          }
        } catch (err: any) {
          if (err?.name === 'AbortError') {
            exported += files.length;
            continue;
          }
          // Иная ошибка share — откатываемся на прямое скачивание этой партии
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
        exported++;
        if (i < files.length - 1) {
          await new Promise(r => setTimeout(r, 400));
        }
      }
    }
    return exported;
  }

  /**
   * Helper to format bytes into a readable string with locale-aware units
   * (ru: "14.2 МБ", others: "14.2 MB")
   */
  formatBytes(bytes: number, language?: string): string {
    const ru = typeof language === 'string' && language.startsWith('ru');
    const mbUnit = ru ? 'МБ' : 'MB';
    const kbUnit = ru ? 'КБ' : 'KB';
    if (bytes === 0) return `0 ${mbUnit}`;
    const mb = bytes / (1024 * 1024);
    if (mb < 1) {
      const kb = Math.round(bytes / 1024);
      return `${kb} ${kbUnit}`;
    }
    return `${mb.toFixed(1)} ${mbUnit}`;
  }
}

export const audioOfflineManager = new AudioOfflineManager();
