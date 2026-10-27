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

  private getOrigin(): string {
    return typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://media-box.xyz';
  }

  // Формирует канонический URI трека в локальном Cache Storage
  // Использует same-origin для гарантированной совместимости с Safari WebKit (без CORS/origin rejection)
  private getCanonicalUrl(id?: string | number): string {
    const c = this.cleanId(id);
    return c ? `${this.getOrigin()}/offline-audio/track/${encodeURIComponent(c)}` : '';
  }

  // Устаревший канонический URI для сохранения обратной совместимости со старыми записями
  private getLegacyCanonicalUrl(id?: string | number): string {
    const c = this.cleanId(id);
    return c ? `https://offline.mediabox.local/track/${encodeURIComponent(c)}` : '';
  }

  // Отправляет системное событие в window для реактивного обновления счетчиков кэша в UI
  private notifyCacheUpdated(id?: string, action?: 'save' | 'remove' | 'clear'): void {
    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('music-cache-updated', {
          detail: { id, action }
        }));
      } catch (_) {}
    }
  }

  private isSupported(): boolean {
    return typeof window !== 'undefined' && 'caches' in window;
  }

  // Вспомогательный метод для разыменования body-less alias с X-Canonical-Url
  private async resolveMatch(cache: Cache, response: Response | null | undefined): Promise<Response | null> {
    if (!response) return null;
    const canonical = response.headers.get('X-Canonical-Url');
    if (canonical) {
      const canonicalMatch = await cache.match(canonical);
      return canonicalMatch || null;
    }
    return response;
  }

  // Единый поиск трека: canonical -> legacy canonical -> прямой URL с fallback на canonical
  private async matchTrack(cache: Cache, urlOrId?: string, trackId?: string): Promise<Response | null> {
    const targetId = trackId || (urlOrId && !urlOrId.startsWith('http') ? urlOrId : '');
    const canonicalUrl = this.getCanonicalUrl(targetId);
    const legacyCanonicalUrl = this.getLegacyCanonicalUrl(targetId);
    let match = canonicalUrl ? await cache.match(canonicalUrl) : null;
    if (!match && legacyCanonicalUrl) {
      match = await cache.match(legacyCanonicalUrl);
    }
    if (!match && urlOrId && urlOrId.startsWith('http')) {
      const direct = await cache.match(urlOrId);
      match = await this.resolveMatch(cache, direct);
    }
    return match || null;
  }

  // LRU-очистка: если в кэше более 50 треков, удаляем самые старые
  private async enforceLruLimit(cache: Cache): Promise<void> {
    try {
      const keys = await cache.keys();
      const origin = this.getOrigin();
      const canonicalPrefix = `${origin}/offline-audio/track/`;
      const legacyPrefix = 'https://offline.mediabox.local/track/';
      const canonicalRequests = keys.filter(req =>
        req.url.startsWith(canonicalPrefix) || req.url.startsWith(legacyPrefix)
      );

      if (canonicalRequests.length <= 50) return;

      const items: { req: Request; savedAt: number; sourceUrl?: string }[] = [];
      for (const req of canonicalRequests) {
        try {
          const res = await cache.match(req);
          if (res) {
            const savedAt = Number(res.headers.get('X-Audio-Saved-At')) || 0;
            const sourceUrl = res.headers.get('X-Audio-Source-Url') || undefined;
            items.push({ req, savedAt, sourceUrl });
          }
        } catch (_) {}
      }

      items.sort((a, b) => a.savedAt - b.savedAt);
      const toRemove = items.slice(0, items.length - 50);

      for (const item of toRemove) {
        await cache.delete(item.req).catch(() => {});
        if (item.sourceUrl) {
          await cache.delete(item.sourceUrl).catch(() => {});
        }
      }
    } catch (_) {}
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
      const legacyCanonicalUrl = this.getLegacyCanonicalUrl(id);
      const rawCanonicalUrl = id && id.startsWith('saavn_') ? `${this.getOrigin()}/offline-audio/track/${encodeURIComponent(id)}` : '';
      const legacyRawCanonicalUrl = id && id.startsWith('saavn_') ? `https://offline.mediabox.local/track/${encodeURIComponent(id)}` : '';

      const isLow = quality === 'low' || /_96\.|_48\./.test(audioUrl);

      // Если файл уже есть в кэше и это не апгрейд качества, сохраняем существующий
      const existing = await this.matchTrack(cache, audioUrl, id);

      if (existing) {
        const existingQuality = existing.headers.get('X-Audio-Quality');
        // Если уже сохранён high-поток или новый тоже low — не тратим трафик на повторный запрос
        if (existingQuality === 'high' || isLow) {
          this.notifyCacheUpdated(id, 'save');
          return true;
        }
      }

      // Pre-check квоты хранилища перед скачиванием
      if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
        try {
          const estimate = await navigator.storage.estimate();
          const free = (estimate.quota || 0) - (estimate.usage || 0);
          if (estimate.quota && free < 5 * 1024 * 1024) {
            console.warn(`[AudioOffline] Storage quota exceeded before download: ${free} bytes free`);
            return false;
          }
        } catch (_) {}
      }

      const response = await fetchWithTimeout(audioUrl, 90000);
      if (!response.ok) return false;

      // Проверка размера по Content-Length перед считыванием Blob
      const contentLength = Number(response.headers.get('Content-Length')) || 0;
      if (contentLength > 0 && typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
        try {
          const estimate = await navigator.storage.estimate();
          const free = (estimate.quota || 0) - (estimate.usage || 0);
          if (estimate.quota && free < contentLength + 1024 * 1024) {
            console.warn(`[AudioOffline] Storage quota exceeded for content-length ${contentLength}: ${free} bytes free`);
            return false;
          }
        } catch (_) {}
      }

      const blob = await response.blob();
      const headers = new Headers();
      headers.set('Content-Type', response.headers.get('Content-Type') || 'audio/mp4');
      headers.set('X-Audio-Quality', isLow ? 'low' : 'high');
      headers.set('X-Audio-Source-Url', audioUrl);
      headers.set('X-Audio-File-Size', String(blob.size));
      headers.set('Content-Length', String(blob.size));
      headers.set('X-Audio-Saved-At', String(Date.now()));

      const responseToCache = new Response(blob, { headers });

      // Удаляем старый файл для этого id перед сохранением апгрейда
      if (canonicalUrl) {
        await cache.delete(canonicalUrl).catch(() => {});
      }
      if (legacyCanonicalUrl) {
        await cache.delete(legacyCanonicalUrl).catch(() => {});
      }
      if (rawCanonicalUrl) {
        await cache.delete(rawCanonicalUrl).catch(() => {});
      }
      if (legacyRawCanonicalUrl) {
        await cache.delete(legacyRawCanonicalUrl).catch(() => {});
      }
      await cache.delete(audioUrl).catch(() => {});

      // Сохраняем полный Blob ОДИН раз под каноническим URL
      if (canonicalUrl) {
        await cache.put(canonicalUrl, responseToCache);
      }

      // Прямой audioUrl сохраняем как body-less lookup-алиас
      if (canonicalUrl) {
        const aliasHeaders = new Headers();
        aliasHeaders.set('X-Canonical-Url', canonicalUrl);
        aliasHeaders.set('X-Audio-Target-Id', this.cleanId(id));
        aliasHeaders.set('X-Audio-Saved-At', String(Date.now()));
        const aliasResponse = new Response(null, { headers: aliasHeaders });
        await cache.put(audioUrl, aliasResponse);
      }

      // Применяем LRU-лимит (не более 50 треков)
      await this.enforceLruLimit(cache);

      this.notifyCacheUpdated(id, 'save');
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
      const match = await this.matchTrack(cache, url, trackId);
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
      const match = await this.matchTrack(cache, urlOrId, trackId);
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
      const match = await this.matchTrack(cache, urlOrId, trackId);
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
      const legacyCanonicalUrl = this.getLegacyCanonicalUrl(targetId);

      let sourceUrlToDelete = urlOrId && urlOrId.startsWith('http') ? urlOrId : '';
      if (!sourceUrlToDelete && canonicalUrl) {
        const match = await cache.match(canonicalUrl);
        if (match) {
          sourceUrlToDelete = match.headers.get('X-Audio-Source-Url') || '';
        }
      }

      if (sourceUrlToDelete) {
        const aliasMatch = await cache.match(sourceUrlToDelete);
        const refCanonical = aliasMatch?.headers?.get('X-Canonical-Url');
        await cache.delete(sourceUrlToDelete).catch(() => {});
        if (refCanonical) {
          await cache.delete(refCanonical).catch(() => {});
        }
      }
      if (canonicalUrl) {
        await cache.delete(canonicalUrl).catch(() => {});
      }
      if (legacyCanonicalUrl) {
        await cache.delete(legacyCanonicalUrl).catch(() => {});
      }
      this.notifyCacheUpdated(targetId, 'remove');
    } catch (_) {}
  }

  /**
   * Clears the entire offline audio cache
   */
  async clearAudioCache(): Promise<boolean> {
    if (!this.isSupported()) return false;

    try {
      const deleted = await caches.delete(CACHE_NAME);
      if (deleted) {
        this.notifyCacheUpdated(undefined, 'clear');
      }
      return deleted;
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

      const origin = this.getOrigin();
      const canonicalPrefix = `${origin}/offline-audio/track/`;
      const legacyPrefix = 'https://offline.mediabox.local/track/';

      // Считаем канонические ключи (same-origin + legacy fallback) для исключения дублирования
      const canonicalKeys = keys.filter(req => req.url.startsWith(canonicalPrefix) || req.url.startsWith(legacyPrefix));
      const effectiveKeys = canonicalKeys.length > 0 ? canonicalKeys : keys;

      for (const req of effectiveKeys) {
        try {
          const res = await cache.match(req);
          if (res) {
            // Быстрое считывание размера из заголовка без перегрузки RAM вычитом blob
            const sizeHeader = res.headers.get('X-Audio-File-Size') || res.headers.get('Content-Length');
            if (sizeHeader) {
              totalBytes += Number(sizeHeader) || 0;
            } else {
              const blob = await res.blob();
              totalBytes += blob.size;
            }
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
        const match = await this.matchTrack(cache, audioUrl, trackId);
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
