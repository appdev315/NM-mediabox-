import { clientCache } from './clientCache';
import { fetchWithRetry } from './fetchWithRetry';
import { CF_API_BASE } from '../hooks/useApi';

// --- ИНФОРМАЦИЯ О СКОРОСТИ СЕТИ И РЕЖИМЕ ЭКОНОМИИ ТРАФИКА ---

export interface NetworkSpeedInfo {
  isSlow: boolean;
  effectiveType?: string;
  saveData?: boolean;
}

export const getNetworkSpeed = (): NetworkSpeedInfo => {
  if (typeof navigator === 'undefined') return { isSlow: false };
  const nav = navigator as any;
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
  if (!conn) return { isSlow: false };
  const effectiveType = conn.effectiveType;
  const saveData = Boolean(conn.saveData);
  const isSlow = saveData || effectiveType === 'slow-2g' || effectiveType === '2g' || effectiveType === '3g';
  return { isSlow, effectiveType, saveData };
};

const MUSIC_DATA_SAVER_KEY = 'mb_music_data_saver';

/** Пользовательский тумблер «Экономия трафика»: низкий битрейт и отказ от фоновых предзагрузок */
export const isMusicDataSaverEnabled = (): boolean => {
  try {
    return localStorage.getItem(MUSIC_DATA_SAVER_KEY) === '1';
  } catch (_) {
    return false;
  }
};

export const setMusicDataSaver = (enabled: boolean): void => {
  try {
    if (enabled) localStorage.setItem(MUSIC_DATA_SAVER_KEY, '1');
    else localStorage.removeItem(MUSIC_DATA_SAVER_KEY);
  } catch (_) {}
};

// --- РЕЗЕРВНЫЕ АПСТРИМЫ JIOSAAVN ---
export const SAAVN_FALLBACK_BASES = [
  'https://saavn-api-delta.vercel.app/api',
];

export const saavnApiFetch = async (relativePath: string, signal?: AbortSignal): Promise<Response | null> => {
  // 1. Приоритетный запрос через Cloudflare Edge Worker с распределенным кешированием
  try {
    const proxied = await fetchWithRetry(`${CF_API_BASE}/music/saavn/${relativePath}`, { maxRetries: 0, signal });
    if (proxied && proxied.ok) return proxied;
  } catch (_) {}

  // 2. Отказоустойчивый fallback на прямой апстрим при недоступности воркера
  for (const base of SAAVN_FALLBACK_BASES) {
    try {
      const direct = await fetchWithRetry(`${base}/${relativePath}`, { maxRetries: 0, signal });
      if (direct && direct.ok) return direct;
    } catch (_) {}
  }
  return null;
};

// --- ПУЛ ИНСТАНСОВ INVIDIOUS И СКОРИНГ ДОСТУПНОСТИ ---

export const INVIDIOUS_SEED_INSTANCES = [
  'https://invidious.schenkel.eti.br',
  'https://yt.chocolatemoo53.com',
  'https://inv.nadeko.net',
  'https://yewtu.be',
  'https://invidious.nerdvpn.de',
  'https://invidious.private.coffee',
  'https://invidious.jing.rocks',
  'https://yt.omada.cafe',
  'https://invidious.kemonomimi.nl',
];

const INV_HEALTH_KEY = 'inv_health_v2';
const INV_DISCOVERY_KEY = 'inv_instances_v2';
/** Инстанс с 403/429/таймаутом отправляется в кулдаун на 30 минут */
const INV_COOLDOWN_MS = 30 * 60 * 1000;

export interface InvHealthEntry { ok: number; fail: number; cooldownUntil: number }
export type InvHealth = Record<string, InvHealthEntry>;

export const getInvHealth = (): InvHealth => {
  try {
    return clientCache.get<InvHealth>(INV_HEALTH_KEY) || {};
  } catch (_) {
    return {};
  }
};

export const recordInvidiousOutcome = (base: string, ok: boolean): void => {
  try {
    const health = getInvHealth();
    const entry = health[base] || { ok: 0, fail: 0, cooldownUntil: 0 };
    if (ok) {
      entry.ok += 1;
      entry.cooldownUntil = 0;
    } else {
      entry.fail += 1;
      entry.cooldownUntil = Date.now() + INV_COOLDOWN_MS;
    }
    if (entry.ok > 500) entry.ok = 500;
    if (entry.fail > 500) entry.fail = 500;
    health[base] = entry;
    clientCache.set(INV_HEALTH_KEY, health, 30 * 24 * 3600);
  } catch (_) {}
};

/**
 * Получение ранжированного списка инстансов: живые инстансы с наивысшим скором идут первыми
 */
export const getInvidiousInstances = async (): Promise<string[]> => {
  let discovered = clientCache.get<string[]>(INV_DISCOVERY_KEY) || await clientCache.getAsync<string[]>(INV_DISCOVERY_KEY) || [];
  if (discovered.length === 0) {
    try {
      const res = await fetchWithRetry(`${CF_API_BASE}/music/invidious/instances`, { maxRetries: 0 });
      if (res && res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.instances) && data.instances.length > 0) {
          discovered = data.instances.filter((u: any) => typeof u === 'string' && u.startsWith('https://'));
          clientCache.set(INV_DISCOVERY_KEY, discovered, 86400);
        }
      }
    } catch (_) {}
  }

  const pool = [...new Set([...discovered, ...INVIDIOUS_SEED_INSTANCES])].slice(0, 24);
  const health = getInvHealth();
  const now = Date.now();
  const healthy = pool.filter(base => !health[base] || health[base].cooldownUntil < now);
  const candidates = healthy.length > 0 ? healthy : pool;

  return candidates.sort((a, b) => {
    const scoreA = health[a] ? health[a].ok - health[a].fail : 0;
    const scoreB = health[b] ? health[b].ok - health[b].fail : 0;
    return scoreB - scoreA;
  });
};

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ИЗВЛЕЧЕНИЯ АУДИО И НОРМАЛИЗАЦИИ ---

export const decodeHtmlEntities = (str: string): string => {
  if (!str) return '';
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
};

export const extractArtwork = (images?: Array<{ quality: string; url: string }>): string => {
  if (!images || images.length === 0) return '';
  const minImg = images.find(img => img.quality === '150x150') ||
                 images.find(img => img.quality === '50x50') ||
                 images[0];
  return minImg?.url || '';
};

export const extractAudioUrl = (downloadUrls?: Array<{ quality: string; url: string }>, isSlow = false): string => {
  if (!downloadUrls || downloadUrls.length === 0) return '';
  if (isSlow) {
    const low = downloadUrls.find(u => u.quality === '96kbps') ||
                downloadUrls.find(u => u.quality === '48kbps') ||
                downloadUrls.find(u => u.quality === '160kbps') ||
                downloadUrls[0];
    return low?.url || '';
  }
  const best = downloadUrls.find(u => u.quality === '320kbps') ||
               downloadUrls.find(u => u.quality === '160kbps') ||
               downloadUrls[downloadUrls.length - 1];
  return best?.url || '';
};

export const extractLowAudioUrl = (downloadUrls?: Array<{ quality: string; url: string }>): string => {
  if (!downloadUrls || downloadUrls.length === 0) return '';
  const low = downloadUrls.find(u => u.quality === '96kbps') ||
              downloadUrls.find(u => u.quality === '48kbps') ||
              downloadUrls.find(u => u.quality === '160kbps') ||
              downloadUrls[0];
  return low?.url || '';
};

export const extractInvidiousAudio = (formats: any[], isSlow: boolean): string => {
  if (!Array.isArray(formats)) return '';
  const audioFormats = formats.filter(f => f && typeof f.type === 'string' && f.type.startsWith('audio') && f.url);
  if (audioFormats.length === 0) return '';

  audioFormats.sort((a, b) => (parseInt(a.bitrate || '0', 10) - parseInt(b.bitrate || '0', 10)));

  if (isSlow) {
    return audioFormats[0].url;
  }
  const highM4a = audioFormats.filter(f => f.type.includes('mp4') || f.container === 'm4a').pop();
  return highM4a?.url || audioFormats[audioFormats.length - 1].url;
};

export const parseYtDuration = (item: any): number => {
  if (typeof item.duration === 'string') {
    const parts = item.duration.split(':').map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return parts[0] * 60 + parts[1];
    if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (typeof item.lengthSeconds === 'number' && item.lengthSeconds > 0) return item.lengthSeconds;
  return 0;
};

export const parseYtTrackInfo = (rawTitle: string, rawAuthor: string) => {
  let title = rawTitle;
  let artist = (rawAuthor || 'Unknown Artist').replace(/ - Topic$/i, '').trim();
  const splitMatch = rawTitle.match(/^([^\-–—]+)\s*[\-–—]\s*(.+)$/);
  if (splitMatch) {
    const candArtist = splitMatch[1].trim();
    const candTitle = splitMatch[2].trim();
    if (candArtist.length > 0 && candTitle.length > 0) {
      artist = candArtist;
      title = candTitle;
    }
  }
  return { title, artist };
};

// --- ОЧИСТКА И ФОРМИРОВАНИЕ СТРОГИХ КЛЮЧЕЙ КЭША ---

export const cleanTrackTitle = (title: string): string =>
  (title || '')
    .replace(/\s*\([^)]*(?:official|video|lyric|remaster|explicit|edit|version)[^)]*\)/gi, '')
    .replace(/\s*\[[^\]]*(?:official|video|lyric|remaster|explicit|edit|version)[^\]]*\]/gi, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .trim();

export const cleanPrimaryArtist = (artist: string): string => {
  const clean = (artist || '').trim();
  return clean.split(/(?:feat\.|ft\.|,|&|\/)/i)[0].trim();
};

export interface ResolveCacheKeys {
  cacheKey: string;
  negCacheKey: string;
  flightKey: string;
  videoId?: string;
  saavnId?: string;
  isYt: boolean;
}

/**
 * Формирование изолированных ключей кэша:
 * Для YouTube — строгий префикс по videoId (исключает коллизии названий треков)
 * Для Saavn — префикс по числовому ID
 * Для метаданных — v4 префикс по нормализованным артисту и названию
 */
export const buildResolveCacheKey = (
  artist: string,
  title: string,
  trackId?: string
): ResolveCacheKeys => {
  const isYt = Boolean(trackId && trackId.startsWith('yt_'));
  const isSaavn = Boolean(trackId && trackId.startsWith('saavn_'));

  if (isYt) {
    const videoId = String(trackId).replace(/^yt_/, '');
    return {
      cacheKey: `resolved_audio_v4_yt_${videoId}`,
      negCacheKey: `neg_resolved_audio_v4_yt_${videoId}`,
      flightKey: `yt_${videoId}`,
      videoId,
      isYt: true,
    };
  }

  if (isSaavn) {
    const saavnId = String(trackId).replace(/^saavn_/, '');
    return {
      cacheKey: `resolved_audio_v4_saavn_${saavnId}`,
      negCacheKey: `neg_resolved_audio_v4_saavn_${saavnId}`,
      flightKey: `saavn_${saavnId}`,
      saavnId,
      isYt: false,
    };
  }

  const primary = cleanPrimaryArtist(artist).toLowerCase();
  const clean = cleanTrackTitle(title).toLowerCase();
  const slug = `${primary}_${clean}`;
  return {
    cacheKey: `resolved_audio_v4_${slug}`,
    negCacheKey: `neg_resolved_audio_v4_${slug}`,
    flightKey: `meta_${slug}`,
    isYt: false,
  };
};

// --- SINGLE-FLIGHT DEDUPLICATION MAP ---
// Гарантирует, что одновременные запросы одного трека делят общий Promise (O(1) HTTP вместо N)
const inFlightResolves = new Map<string, Promise<string>>();

/**
 * Конкурентная гонка (Promise.any) по пулу из 3-4 лучших Invidious инстансов с local=true:
 * local=true критичен — проксирует аудио через инстанс, снимая привязку googlevideo к IP клиента.
 */
export const raceInvidiousInstances = async (videoId: string, isSlow: boolean): Promise<string> => {
  const allInstances = await getInvidiousInstances();
  if (allInstances.length === 0) return '';

  const candidates = allInstances.slice(0, 4);

  const attemptInstance = async (instance: string): Promise<string> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetchWithRetry(`${instance}/api/v1/videos/${videoId}?local=true`, {
        maxRetries: 0,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res || !res.ok) {
        throw new Error(`Instance ${instance} returned status ${res?.status}`);
      }
      const data = await res.json();
      const streamUrl = extractInvidiousAudio(data?.adaptiveFormats, isSlow);
      if (!streamUrl) {
        throw new Error(`No audio format from ${instance}`);
      }
      recordInvidiousOutcome(instance, true);
      return streamUrl;
    } catch (err) {
      clearTimeout(timeoutId);
      recordInvidiousOutcome(instance, false);
      throw err;
    }
  };

  try {
    return await Promise.any(candidates.map(attemptInstance));
  } catch (_) {
    // Если топ-4 инстанса отклонили запрос — пробуем запасные следующие 2 инстанса последовательно
    const fallbacks = allInstances.slice(4, 6);
    for (const inst of fallbacks) {
      try {
        const url = await attemptInstance(inst);
        if (url) return url;
      } catch (_) {}
    }
    return '';
  }
};

/**
 * Серверный резолвер Cloudflare Worker:
 * Проксирует запрос через край сети с edge-кэшем на 10-12 минут
 */
export const resolveViaWorker = async (trackId?: string, artist?: string, title?: string): Promise<string> => {
  if (!trackId && !title) return '';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const params = new URLSearchParams();
    if (trackId) params.set('id', trackId);
    if (artist) params.set('artist', artist);
    if (title) params.set('title', title);

    const res = await fetchWithRetry(`${CF_API_BASE}/music/resolve?${params.toString()}`, {
      maxRetries: 0,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (res && res.ok) {
      const data = await res.json();
      if (data && data.success && typeof data.url === 'string' && data.url.length > 0) {
        return data.url;
      }
    }
    return '';
  } catch (_) {
    clearTimeout(timeoutId);
    return '';
  }
};

/**
 * Основная функция разрешения прямого аудиопотока:
 * 1. Single-Flight дедупликация
 * 2. Чтение кэша v4 (LRU память + localStorage + IndexedDB) с валидацией битрейта
 * 3. Серверный резолв через Cloudflare Worker Edge
 * 4. Конкурентная гонка инстансов Invidious (для YouTube) с local=true
 * 5. Мульти-проходной поиск JioSaavn CDN (320k)
 * 6. Защита от отравления кэша (короткий 30-секундный негативный кэш)
 */
export const resolveFullAudioUrl = async (
  artist: string,
  title: string,
  _fallbackUrl: string,
  trackId?: string,
  bypassCache: boolean = false
): Promise<string> => {
  const keys = buildResolveCacheKey(artist, title, trackId);

  // Single-flight: если трек прямо сейчас резолвится другим компонентом очереди — возвращаем единый Promise
  if (inFlightResolves.has(keys.flightKey)) {
    return inFlightResolves.get(keys.flightKey)!;
  }

  const resolvePromise = (async (): Promise<string> => {
    const saving = getNetworkSpeed().isSlow || isMusicDataSaverEnabled();

    // 1. Проверка локального кэша клиента
    if (!bypassCache) {
      const cached = clientCache.get<string>(keys.cacheKey) || await clientCache.getAsync<string>(keys.cacheKey);
      if (cached) {
        // Динамический апгрейд/даунгрейд битрейта при изменении сетевых условий
        const isHighBitrateSaavn = saving && cached.includes('aac.saavncdn.com') && !/_96\.|_48\./.test(cached);
        const isStaleLowBitrate = !saving && /_96\.|_48\./.test(cached);
        if (!isHighBitrateSaavn && !isStaleLowBitrate) return cached;
      }

      // Троттлинг негативного кэша (30 сек): предотвращает бесконечные сетевые запросы к битым источникам
      const negative = clientCache.get<string>(keys.negCacheKey) || await clientCache.getAsync<string>(keys.negCacheKey);
      if (negative) {
        if (_fallbackUrl && !_fallbackUrl.includes('preview') && !_fallbackUrl.includes('dzcdn')) {
          return _fallbackUrl;
        }
        return '';
      }
    }

    // 2. Для YouTube-треков: приоритетное разрешение через серверный Worker или конкурентную гонку инстансов
    if (keys.isYt && keys.videoId) {
      // 2a. Пробуем серверный воркер
      const workerUrl = await resolveViaWorker(trackId, artist, title);
      if (workerUrl) {
        clientCache.set(keys.cacheKey, workerUrl, 900); // 15 мин TTL
        clientCache.remove(keys.negCacheKey);
        return workerUrl;
      }

      // 2b. Клиентская гонка инстансов Invidious с local=true
      const directYtStream = await raceInvidiousInstances(keys.videoId, saving);
      if (directYtStream) {
        clientCache.set(keys.cacheKey, directYtStream, 900); // 15 мин TTL
        clientCache.remove(keys.negCacheKey);
        return directYtStream;
      }
    }

    // 3. Поиск по каталогу JioSaavn CDN (мгновенный прямой 320k/160k поток)
    const cleanTitle = cleanTrackTitle(title);
    const primaryArtist = cleanPrimaryArtist(artist);

    try {
      const queries = [
        `${primaryArtist} ${cleanTitle}`,
        primaryArtist !== artist ? `${artist} ${cleanTitle}` : '',
        cleanTitle.length >= 4 ? cleanTitle : ''
      ].filter(Boolean);

      for (const q of queries) {
        try {
          const res = await saavnApiFetch(`search/songs?query=${encodeURIComponent(q)}&limit=3`);
          if (res && res.ok) {
            const data = await res.json();
            const results = data?.data?.results;
            if (Array.isArray(results) && results.length > 0) {
              const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
              const normQueryTitle = norm(cleanTitle);
              const normArtist = norm(primaryArtist);

              const candidates = results
                .map((r: any) => ({ r, url: extractAudioUrl(r.downloadUrl, saving) }))
                .filter((c: any) => c.url)
                .map((c: any) => {
                  const dur = typeof c.r.duration === 'number' ? c.r.duration : parseInt(c.r.duration || '0', 10) || 0;
                  const rTitle = norm(c.r.name || c.r.title || '');
                  const rArtists = norm(
                    (c.r.primaryArtists || c.r.artists?.primary?.map((a: any) => a.name).join(', ') || '') +
                    (c.r.singers || '')
                  );
                  return { ...c, dur, rTitle, rArtists };
                })
                .filter((c: any) => c.dur === 0 || c.dur >= 20);

              const titleAndArtist = candidates.find((c: any) =>
                (c.rTitle === normQueryTitle || c.rTitle.includes(normQueryTitle) || normQueryTitle.includes(c.rTitle)) &&
                c.rTitle.length > 0 &&
                (c.rArtists.includes(normArtist) || normArtist.includes(c.rArtists))
              );

              const exactTitle = !keys.isYt
                ? candidates.find((c: any) => c.rTitle === normQueryTitle && (c.rArtists.includes(normArtist) || normArtist.includes(c.rArtists) || candidates.length === 1))
                : null;

              const match = titleAndArtist || exactTitle;

              if (match) {
                clientCache.set(keys.cacheKey, match.url, 14400); // 4 часа TTL
                clientCache.remove(keys.negCacheKey);
                return match.url;
              }
            }
          }
        } catch (_) {}
      }
    } catch (_) {}

    // 4. Поиск в YouTube Music, если исходно это был обычный трек, не найденный в Saavn
    if (!keys.isYt) {
      try {
        const ytQuery = `${primaryArtist} ${cleanTitle} audio`;
        const ytSearch = await fetchWithRetry(`https://api.ytify.workers.dev/search?q=${encodeURIComponent(ytQuery)}`, { maxRetries: 1 });
        if (ytSearch && ytSearch.ok) {
          const results = await ytSearch.json();
          if (Array.isArray(results) && results.length > 0) {
            const sane = results.find((x: any) => { const d = parseYtDuration(x); return d > 0 && d <= 900; });
            const resolvedVid = (sane || results[0])?.id;
            if (resolvedVid) {
              const streamUrl = await raceInvidiousInstances(resolvedVid, saving);
              if (streamUrl) {
                clientCache.set(keys.cacheKey, streamUrl, 900);
                clientCache.remove(keys.negCacheKey);
                return streamUrl;
              }
            }
          }
        }
      } catch (_) {}
    }

    // 5. Fallback на переданный поток, если он валиден
    if (_fallbackUrl && !_fallbackUrl.includes('preview') && !_fallbackUrl.includes('dzcdn')) {
      clientCache.remove(keys.negCacheKey);
      return _fallbackUrl;
    }

    // 6. Негативный кэш на 30 сек во избежание флуда
    clientCache.set(keys.negCacheKey, '1', 30);
    return '';
  })();

  inFlightResolves.set(keys.flightKey, resolvePromise);
  try {
    return await resolvePromise;
  } finally {
    inFlightResolves.delete(keys.flightKey);
  }
};
