import { useState, useCallback, useRef, useEffect } from 'react';
import { clientCache } from '../utils/clientCache';
import { fetchWithRetry } from '../utils/fetchWithRetry';
import { CF_API_BASE } from './useApi';

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artworkUrl: string;
  audioUrl: string;
  /** Low-bitrate stream (<=160 kbps) for the Data saver mode */
  audioUrlLow?: string;
  duration?: number;
  releaseDate?: string;
  genre?: string;
  isResolved?: boolean;
}

export interface MusicAlbum {
  id: string;
  title: string;
  artist: string;
  year?: string;
  artworkUrl: string;
  songCount?: number;
}

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

/** User-facing "Traffic saver" toggle: low bitrate streams, no background downloads */
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

/**
 * Third-party hobby deployment of the Saavn API. Kept only as the last-resort
 * fallback — primary access goes through the own edge-cached Worker mirror
 * (`/api/music/saavn/*`) so a single Vercel instance is no longer a hard SPOF.
 */
const SAAVN_FALLBACK_BASE = 'https://jiosaavn-api-amber.vercel.app/api';

const saavnApiFetch = async (relativePath: string, signal?: AbortSignal): Promise<Response | null> => {
  try {
    const proxied = await fetchWithRetry(`${CF_API_BASE}/music/saavn/${relativePath}`, { maxRetries: 0, signal });
    if (proxied && proxied.ok) return proxied;
  } catch (_) {}
  try {
    const direct = await fetchWithRetry(`${SAAVN_FALLBACK_BASE}/${relativePath}`, { maxRetries: 0, signal });
    return direct && direct.ok ? direct : null;
  } catch (_) {}
  return null;
};

export const PLACEHOLDER_ARTWORK = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24" fill="%238E8E93"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';

// --- INVIDIOUS POOL: official discovery + known seed list + client-side health scoring ---
const INVIDIOUS_SEED_INSTANCES = [
  'https://inv.nadeko.net',
  'https://yewtu.be',
  'https://invidious.nerdvpn.de',
  'https://invidious.private.coffee',
  'https://invidious.jing.rocks',
  'https://invidious.schenkel.eti.br',
  'https://yt.omada.cafe',
  'https://invidious.kemonomimi.nl',
];

const INV_HEALTH_KEY = 'inv_health_v2';
const INV_DISCOVERY_KEY = 'inv_instances_v2';
/** Instance that failed with 403/429/timeout goes to cooldown for 30 minutes */
const INV_COOLDOWN_MS = 30 * 60 * 1000;

interface InvHealthEntry { ok: number; fail: number; cooldownUntil: number }
type InvHealth = Record<string, InvHealthEntry>;

const getInvHealth = (): InvHealth => {
  try {
    return clientCache.get<InvHealth>(INV_HEALTH_KEY) || {};
  } catch (_) {
    return {};
  }
};

const recordInvidiousOutcome = (base: string, ok: boolean): void => {
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
 * Ordered instance pool: freshly discovered instances first, then the seed
 * list; entries penalized by recent failures are pushed to the back (or removed
 * while in cooldown). If everything is in cooldown the full pool is returned
 * anyway — a degraded fallback beats no fallback.
 */
const getInvidiousInstances = async (): Promise<string[]> => {
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

  const pool = [...new Set([...discovered, ...INVIDIOUS_SEED_INSTANCES])].slice(0, 20);
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

const decodeHtmlEntities = (str: string): string => {
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

const extractArtwork = (images?: Array<{ quality: string; url: string }>): string => {
  if (!images || images.length === 0) return '';
  // Minimal resolution for mobile performance & ultra-fast loading (150x150 or 50x50)
  const minImg = images.find(img => img.quality === '150x150') ||
                 images.find(img => img.quality === '50x50') ||
                 images[0];
  return minImg?.url || '';
};

const extractAudioUrl = (downloadUrls?: Array<{ quality: string; url: string }>, isSlow = false): string => {
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

const extractLowAudioUrl = (downloadUrls?: Array<{ quality: string; url: string }>): string => {
  if (!downloadUrls || downloadUrls.length === 0) return '';
  const low = downloadUrls.find(u => u.quality === '96kbps') ||
              downloadUrls.find(u => u.quality === '48kbps') ||
              downloadUrls.find(u => u.quality === '160kbps') ||
              downloadUrls[0];
  return low?.url || '';
};

const extractInvidiousAudio = (formats: any[], isSlow: boolean): string => {
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

const extractArtistName = (item: any): string => {
  if (item.artists?.primary && item.artists.primary.length > 0) {
    return decodeHtmlEntities(item.artists.primary.map((a: any) => a.name).join(', '));
  }
  if (item.primaryArtists) {
    return decodeHtmlEntities(item.primaryArtists);
  }
  if (item.artists?.all && item.artists.all.length > 0) {
    return decodeHtmlEntities(item.artists.all.map((a: any) => a.name).join(', '));
  }
  return 'Unknown Artist';
};

const mapSaavnSongToTrack = (song: any, index: number, isSlow = false): MusicTrack | null => {
  const audioUrl = extractAudioUrl(song.downloadUrl, isSlow);
  const title = decodeHtmlEntities(song.name || song.title || '');
  if (!audioUrl || !title) return null;

  const rawArtist = extractArtistName(song);
  const stableId = song.id
    ? String(song.id)
    : `saavn_${title.toLowerCase().replace(/[^a-z0-9]/g, '')}_${rawArtist.toLowerCase().replace(/[^a-z0-9]/g, '') || index}`;
  const dur = typeof song.duration === 'number' ? song.duration : parseInt(song.duration || '0', 10);

  return {
    id: stableId,
    title,
    artist: rawArtist,
    album: decodeHtmlEntities(song.album?.name || ''),
    artworkUrl: extractArtwork(song.image),
    audioUrl,
    audioUrlLow: extractLowAudioUrl(song.downloadUrl) || audioUrl,
    duration: dur > 0 ? dur : undefined, // no fake 3:00 badge for unknown durations
    releaseDate: String(song.year || song.releaseDate || ''),
    genre: song.language || 'Music',
    isResolved: true
  };
};



export const resolveFullAudioUrl = async (
  artist: string,
  title: string,
  _fallbackUrl: string,
  trackId?: string,
  bypassCache: boolean = false
): Promise<string> => {
  // Strip junk video / remaster / remix annotations to maximize catalog hits
  const cleanTitle = title
    .replace(/\s*\([^)]*(?:official|video|lyric|remaster|explicit|edit|version)[^)]*\)/gi, '')
    .replace(/\s*\[[^\]]*(?:official|video|lyric|remaster|explicit|edit|version)[^\]]*\]/gi, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .trim();

  const cleanArtist = artist.trim();
  const primaryArtist = cleanArtist.split(/(?:feat\.|ft\.|,|&|\/)/i)[0].trim();
  const cacheKey = `resolved_audio_v3_${primaryArtist.toLowerCase()}_${cleanTitle.toLowerCase()}`;
  const negCacheKey = `neg_${cacheKey}`;

  const saving = getNetworkSpeed().isSlow || isMusicDataSaverEnabled();

  if (!bypassCache) {
    const cached = clientCache.get<string>(cacheKey) || await clientCache.getAsync<string>(cacheKey);
    if (cached) {
      // Если включена экономия трафика или медленная сеть — сбрасываем 320k кэш в пользу 96k
      const isHighBitrateSaavn = saving &&
        cached.includes('aac.saavncdn.com') && !/_96\.|_48\./.test(cached);
      // Если же связь снова быстрая (не saving), а в кэше лежал низкий битрейт (96k/48k), сбрасываем его для апгрейда до 320k
      const isStaleLowBitrate = !saving && /_96\.|_48\./.test(cached);
      if (!isHighBitrateSaavn && !isStaleLowBitrate) return cached;
    }
    // Negative cache (60 min): a track that just failed to resolve must not
    // hammer Saavn/Invidious on every replay. bypassCache force-bypasses it.
    const negative = clientCache.get<string>(negCacheKey) || await clientCache.getAsync<string>(negCacheKey);
    if (negative) return '';
  }

  // 1. Try JioSaavn CDN (Instant 320k / 160k direct stream) — Multi-pass search
  // Для YouTube-треков (trackId начинается с yt_) используем JioSaavn CDN исключительно при
  // строгом совпадении названия и исполнителя, чтобы предотвратить подмену оригинального трека.
  const isYtTrack = Boolean(trackId && trackId.startsWith('yt_'));
  // Маркер временного сбоя (сеть/инстансы лежат): трек не должен блокироваться
  // часовым негативным кэшем из-за транзиентной ошибки.
  let transientFailure = false;
  try {
    const queries = [
      `${primaryArtist} ${cleanTitle}`,
      cleanArtist !== primaryArtist ? `${cleanArtist} ${cleanTitle}` : '',
      cleanTitle.length >= 4 ? cleanTitle : ''
    ].filter(Boolean);

    for (const q of queries) {
      try {
        const res = await saavnApiFetch(`search/songs?query=${encodeURIComponent(q)}&limit=3`);
        if (res && res.ok) {
          const data = await res.json();
          const results = data?.data?.results;
          if (Array.isArray(results) && results.length > 0) {
            // Строгое сопоставление: исключаем подмену чужой песней через слепой выбор candidates[0]
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
              .filter((c: any) => c.dur === 0 || c.dur >= 20); // отсекаем 0с заглушки

            // Строгие условия совпадения:
            // 1. И название, и артист пересекаются с запросом
            const titleAndArtist = candidates.find((c: any) =>
              (c.rTitle === normQueryTitle || c.rTitle.includes(normQueryTitle) || normQueryTitle.includes(c.rTitle)) &&
              c.rTitle.length > 0 &&
              (c.rArtists.includes(normArtist) || normArtist.includes(c.rArtists))
            );
            // 2. Точное совпадение названия трека (допустимо для обычных треков при подтверждении артиста)
            const exactTitle = !isYtTrack
              ? candidates.find((c: any) => c.rTitle === normQueryTitle && (c.rArtists.includes(normArtist) || normArtist.includes(c.rArtists) || candidates.length === 1))
              : null;

            const match = titleAndArtist || exactTitle;

            if (match) {
              clientCache.set(cacheKey, match.url, 14400); // 4 hours TTL
              clientCache.remove(negCacheKey);
              return match.url;
            }
          }
        }
      } catch (_) {}
    }
  } catch (_) {
    // JioSaavn полностью недоступен — сбой, а не отсутствие трека
    transientFailure = true;
  }

  // 2. Try YouTube Music + Invidious direct 206 audio stream (Covers Russian rap, rock, obscure tracks)
  try {
    let videoId = '';
    if (trackId && trackId.startsWith('yt_')) {
      videoId = trackId.replace('yt_', '');
    } else {
      const ytQuery = `${primaryArtist} ${cleanTitle} audio`;
      const ytSearch = await fetchWithRetry(`https://api.ytify.workers.dev/search?q=${encodeURIComponent(ytQuery)}`, { maxRetries: 1 });
      if (ytSearch && ytSearch.ok) {
        const results = await ytSearch.json();
        if (Array.isArray(results) && results.length > 0) {
          // Avoid hour-long mixes: pick the first result with a sane track length (< 15 min),
          // fall back to the first result only if none report duration
          const sane = results.find((x: any) => { const d = parseYtDuration(x); return d > 0 && d <= 900; });
          videoId = (sane || results[0]).id;
        }
      }
    }

    if (videoId) {
      const instances = await getInvidiousInstances();
      for (const instance of instances) {
        try {
          const invRes = await fetchWithRetry(`${instance}/api/v1/videos/${videoId}`, { maxRetries: 0 });
          if (invRes && invRes.ok) {
            const data = await invRes.json();
            const streamUrl = extractInvidiousAudio(data.adaptiveFormats, saving);
            if (streamUrl) {
              clientCache.set(cacheKey, streamUrl, 900); // 15 min TTL for temporary YouTube stream tokens
              clientCache.remove(negCacheKey);
              recordInvidiousOutcome(instance, true);
              return streamUrl;
            }
            // 200 but unusable payload (blocked/companion-less instance) — penalize too
            recordInvidiousOutcome(instance, false);
          } else {
            // 403/429/companion-vacuum — instance goes to a 30 min cooldown
            recordInvidiousOutcome(instance, false);
          }
        } catch (_) {
          recordInvidiousOutcome(instance, false);
          continue;
        }
      }
    } else {
      // videoId не получен (воркер не ответил или поиск пуст) — считаем транзиентным:
      // 10 минут негативного кэша вместо часа
      transientFailure = true;
    }
  } catch (_) {
    transientFailure = true;
  }

  // Strictly Full Tracks: Never return Deezer 30s preview snippet as a fake full track!
  // При транзиентном сбое (сеть/инстансы лежали) трек блокируется только на 10 минут,
  // а не на час — после восстановления связи повторная попытка происходит быстро.
  clientCache.set(negCacheKey, '1', transientFailure ? 600 : 3600);
  return '';
};

const parseYtDuration = (item: any): number => {
  if (typeof item.duration === 'string') {
    const parts = item.duration.split(':').map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return parts[0] * 60 + parts[1];
    if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (typeof item.lengthSeconds === 'number' && item.lengthSeconds > 0) return item.lengthSeconds;
  return 0; // unknown — UI hides the badge instead of showing a fake 3:00
};

// Словарь распространенных псевдонимов и транслитераций для точного поиска
export const MUSIC_SEARCH_ALIASES: Record<string, string> = {
  'нагано': 'ноггано',
  'nagano': 'ноггано',
  'noggano': 'ноггано',
  'basta': 'баста',
};

// Интеллектуальный разбор метаданных YouTube: вычленение исполнителя и названия («Ноггано - Зять»)
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

// Стоп-слова немузыкального контента (видео, стендап, подкасты, интервью, шоу, стримы)
const NON_MUSIC_REGEX = /\b(?:стендап|подкаст|podcast|standup|интервью|импров|шоу|выпуск|livestream|live\s*stream)\b/i;

const mapYtSongToTrack = (item: any): MusicTrack | null => {
  if (!item || !item.id || !item.title) return null;
  const dur = parseYtDuration(item);
  // Порог длительности треков: максимум 10 минут (600 сек) и минимум 20 сек
  if (dur > 600 || (dur > 0 && dur < 20)) return null;
  const rawTitle = decodeHtmlEntities(item.title);
  const rawAuthor = decodeHtmlEntities(item.author || 'Unknown Artist');
  // Отсекаем немузыкальные разговорные видеоролики и передачи
  if (NON_MUSIC_REGEX.test(rawTitle) || NON_MUSIC_REGEX.test(rawAuthor)) return null;

  const cleanTitle = rawTitle
    .replace(/\s*\([^)]*(?:official|video|audio|lyric|remaster|explicit|edit|version)[^)]*\)/gi, '')
    .replace(/\s*\[[^\]]*(?:official|video|audio|lyric|remaster|explicit|edit|version)[^\]]*\]/gi, '')
    .trim();
  const parsed = parseYtTrackInfo(cleanTitle || rawTitle, rawAuthor);

  return {
    id: `yt_${item.id}`,
    title: parsed.title,
    artist: parsed.artist,
    album: 'YouTube Music',
    artworkUrl: `https://i.ytimg.com/vi/${item.id}/default.jpg`,
    audioUrl: '', // Resolves direct stream on click
    duration: dur > 0 ? dur : undefined,
    genre: 'Music',
    isResolved: false
  };
};

export function useMusicApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Счётчик активных поисков: одиночный булев гасил спиннер, пока параллельный
  // запрос (быстрый набор в поиске) ещё летел.
  const loadingCountRef = useRef(0);
  // Контроллеры незавершённых поисков: на размонтировании обрываем их —
  // не тратим трафик и не гоняем setState в мёртвый компонент.
  const searchAbortsRef = useRef<Set<AbortController>>(new Set());

  useEffect(() => {
    return () => {
      searchAbortsRef.current.forEach((c) => { try { c.abort(); } catch (_) {} });
      searchAbortsRef.current.clear();
      loadingCountRef.current = 0;
    };
  }, []);

  const searchMusic = useCallback(async (query: string, page = 1, limit = 20): Promise<MusicTrack[]> => {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const cacheKey = `cache_music_search_v9_${trimmed.toLowerCase()}_p${page}_l${limit}`;
    const cached = clientCache.get<MusicTrack[]>(cacheKey) || await clientCache.getAsync<MusicTrack[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return cached;
    }

    // При бесконечном скролле (page > 1) активируем loading только для первой страницы,
    // чтобы предотвратить размонтирование DOM-дерева треков и сброс scrollY в 0
    const abortCtrl = new AbortController();
    searchAbortsRef.current.add(abortCtrl);
    const { signal } = abortCtrl;

    const isInitialPage = page === 1;
    if (isInitialPage) {
      loadingCountRef.current += 1;
      setLoading(true);
      setError(null);
    }
    const releaseInitialLoading = () => {
      if (!isInitialPage) return;
      loadingCountRef.current = Math.max(0, loadingCountRef.current - 1);
      if (loadingCountRef.current === 0) {
        setLoading(false);
      }
    };

    const { isSlow } = getNetworkSpeed();

    try {
      const encoded = encodeURIComponent(trimmed);

      // 1. Fast-path: 1 single request via Cloudflare Edge proxy v2 (с поддержкой page и limit)
      try {
        const edgeRes = await fetchWithRetry(`${CF_API_BASE}/music/v2/search?q=${encoded}&page=${page}&limit=${limit}`, { maxRetries: 0, signal });
        if (edgeRes && edgeRes.ok) {
          const edgeTracks = await edgeRes.json();
          if (Array.isArray(edgeTracks) && edgeTracks.length > 0) {
            const hasJapanese = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;
            const normalized = edgeTracks
              // Отсеиваем 30-секундные превью Deezer, треки длиннее 10 минут и немузыкальные видео
              .filter((t: any) => {
                if (t.audioUrl && t.audioUrl.includes('dzcdn')) return false;
                const dur = typeof t.duration === 'number' ? t.duration : (parseInt(t.duration, 10) || 0);
                if (dur > 600 || (dur > 0 && dur < 20)) return false;
                if (NON_MUSIC_REGEX.test(t.title || '') || NON_MUSIC_REGEX.test(t.artist || '')) return false;
                return true;
              })
              .map((t: MusicTrack) => {
                let artist = t.artist || '';
                // Затираем запросом только полностью CJK-имена: реальные артисты вида
                // «RADWIMPS (ラッドウインプス)» или «久石譲 Joe Hisaishi» содержат латиницу
                // и не должны подменяться текстом поискового запроса.
                if (hasJapanese.test(artist) && !/[a-z]/i.test(artist) && !hasJapanese.test(trimmed)) {
                  artist = trimmed.replace(/\b\w/g, (c) => c.toUpperCase());
                }
                return {
                  ...t,
                  id: String(t.id || '').replace(/^saavn_/, ''),
                  artist,
                };
              });

            if (normalized.length > 0) {
              clientCache.set(cacheKey, normalized, 86400); // 24 hours TTL с авто-очисткой
              releaseInitialLoading();
              return normalized;
            }
          }
        }
      } catch (_) {
        // Edge proxy unavailable: fallback seamlessly to direct multi-provider search
      }

      // Multi-provider parallel search:
      // 1. JioSaavn Song Search (320k/160k direct streams с текущей страницей)
      // 2. JioSaavn Artist Search + Top Songs (только на первой странице для экономии запросов)
      // 3. YouTube Music (Ytify) Search (только на первой странице)
      const [saavnSongRes, saavnArtistRes, ytRes] = await Promise.allSettled([
        saavnApiFetch(`search/songs?query=${encoded}&page=${page}&limit=${limit}`, signal),
        page === 1 ? saavnApiFetch(`search/artists?query=${encoded}`, signal) : Promise.resolve(null as any),
        page === 1 ? fetchWithRetry(`https://api.ytify.workers.dev/search?q=${encoded}`, { maxRetries: 1, signal }) : Promise.resolve(null as any)
      ]);

      const seenIds = new Set<string>();
      const seenTitles = new Set<string>();
      const merged: MusicTrack[] = [];

      const addTrack = (t: MusicTrack) => {
        // Порог длительности треков: максимум 10 минут (600 сек) и минимум 20 сек
        const dur = t.duration || 0;
        if (dur > 600 || (dur > 0 && dur < 20)) return;
        if (NON_MUSIC_REGEX.test(t.title) || NON_MUSIC_REGEX.test(t.artist) || NON_MUSIC_REGEX.test(t.album || '')) return;

        const titleKey = `${t.artist.toLowerCase()} - ${t.title.toLowerCase().replace(/\([^)]*\)/g, '').trim()}`;
        if (!seenIds.has(t.id) && !seenTitles.has(titleKey)) {
          seenIds.add(t.id);
          seenTitles.add(titleKey);
          merged.push(t);
        }
      };

      const normQ = trimmed.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
      const aliasNormQ = MUSIC_SEARCH_ALIASES[normQ] || normQ;

      // 1. Топ-песни артиста (если найдено строгое совпадение имени исполнителя или псевдонима)
      if (saavnArtistRes.status === 'fulfilled' && saavnArtistRes.value && saavnArtistRes.value.ok) {
        try {
          const aJson = await saavnArtistRes.value.json();
          const normArtistOf = (s: any) => String(s || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
          const artistCandidates: any[] = aJson?.data?.results || [];
          // Строгая проверка: исключает ложные срабатывания (например, «Наганов Александр» при запросе «нагано»)
          const matchedArtist = artistCandidates.find((r: any) => {
            const na = normArtistOf(r?.name);
            return na === normQ || na === aliasNormQ;
          });
          if (matchedArtist?.id) {
            const [artistSongsRes, artistFullRes] = await Promise.allSettled([
              saavnApiFetch(`artists?id=${matchedArtist.id}`),
              saavnApiFetch(`artists/${matchedArtist.id}/songs?page=1`)
            ]);
            if (artistSongsRes.status === 'fulfilled' && artistSongsRes.value?.ok) {
              const asJson = await artistSongsRes.value.json();
              const topSongs = asJson?.data?.topSongs || [];
              const topTracks = topSongs
                .map((s: any, idx: number) => mapSaavnSongToTrack(s, idx, isSlow))
                .filter((t: MusicTrack | null): t is MusicTrack => t !== null);
              for (const t of topTracks) {
                addTrack(t);
              }
            }
            if (artistFullRes.status === 'fulfilled' && artistFullRes.value?.ok) {
              const afJson = await artistFullRes.value.json();
              const artistSongs = afJson?.data?.songs || [];
              const moreTracks = artistSongs
                .map((s: any, idx: number) => mapSaavnSongToTrack(s, idx, isSlow))
                .filter((t: MusicTrack | null): t is MusicTrack => t !== null);
              for (const t of moreTracks) {
                addTrack(t);
              }
            }
          }
        } catch (_) {}
      }

      // 2. Add JioSaavn Song Search tracks for current page
      if (saavnSongRes.status === 'fulfilled' && saavnSongRes.value && saavnSongRes.value.ok) {
        try {
          const json = await saavnSongRes.value.json();
          const results = json?.data?.results || [];
          const saavnTracks = results
            .map((s: any, idx: number) => mapSaavnSongToTrack(s, idx, isSlow))
            .filter((t: MusicTrack | null): t is MusicTrack => t !== null);
          for (const t of saavnTracks) {
            addTrack(t);
          }
        } catch (_) {}
      }

      // 3. Add YouTube Music tracks (guaranteed full tracks with 0s previews eliminated)
      if (ytRes.status === 'fulfilled' && ytRes.value && ytRes.value.ok) {
        try {
          const ytList = await ytRes.value.json();
          if (Array.isArray(ytList)) {
            for (const item of ytList) {
              const t = mapYtSongToTrack(item);
              if (t) addTrack(t);
            }
          }
        } catch (_) {}
      }

      // Умное ранжирование релевантности для локального поиска
      const junkRe = /\b(?:8-bit|16-bit|emulation|tribute|karaoke|ringtone|remix|cover)\b/i;
      const scoredTracks = merged.map(t => {
        let score = 0;
        const tArtist = (t.artist || '').toLowerCase();
        const normA = tArtist.replace(/[^a-z0-9а-яё]/gi, '');
        const tTitle = (t.title || '').toLowerCase();
        const normT = tTitle.replace(/[^a-z0-9а-яё]/gi, '');

        const isMatchArtist = (normA === normQ || normA === aliasNormQ);
        const isPartialArtist = (normA.startsWith(normQ) || normA.includes(normQ) ||
                                 normA.startsWith(aliasNormQ) || normA.includes(aliasNormQ));

        const normBoth = `${normA}${normT}`;
        const normBothRev = `${normT}${normA}`;
        if (isMatchArtist) {
          score += 120; // Точное совпадение артиста (или псевдонима): приоритет над чужой песней с таким же названием
        } else if (isPartialArtist) {
          score += 80;
        }

        if (normT === normQ || normT === aliasNormQ) {
          score += 50; // Точное совпадение названия трека (понижено, чтобы не перебивать треки автора)
        } else if (normT.startsWith(normQ) || normT.includes(normQ) || normT.startsWith(aliasNormQ) || normT.includes(aliasNormQ)) {
          score += 30;
        }

        if (normBoth && (normBoth === normQ || normBothRev === normQ || normBoth === aliasNormQ || normBothRev === aliasNormQ)) {
          score += 140; // Точное совпадение Артист + Трек
        } else if (normBoth && (normBoth.includes(normQ) || normQ.includes(normBoth) || normBoth.includes(aliasNormQ) || aliasNormQ.includes(normBoth))) {
          score += 70;
        }

        if (junkRe.test(tTitle)) {
          score -= 40;
        }

        return { track: t, score };
      });

      scoredTracks.sort((a, b) => b.score - a.score);
      const sliced = scoredTracks.slice(0, limit).map(item => item.track);
      if (sliced.length > 0) {
        clientCache.set(cacheKey, sliced, 86400); // 24 hours client cache с авто-очисткой
      }

      releaseInitialLoading();
      return sliced;
    } catch (err: any) {
      if (err?.name === 'AbortError' || signal.aborted) {
        // Поиск отменён размонтированием компонента — это не ошибка
        releaseInitialLoading();
        return [];
      }
      console.warn('[MusicApi] Search failed:', err);
      setError(err?.message || 'Error searching tracks');
      releaseInitialLoading();
      return [];
    } finally {
      searchAbortsRef.current.delete(abortCtrl);
    }
  }, []);

  const searchAlbums = useCallback(async (query: string, limit = 12): Promise<MusicAlbum[]> => {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const cacheKey = `cache_music_albums_v1_${trimmed.toLowerCase()}_${limit}`;
    const cached = clientCache.get<MusicAlbum[]>(cacheKey) || await clientCache.getAsync<MusicAlbum[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return cached;
    }

    try {
      const encoded = encodeURIComponent(trimmed);
      const res = await saavnApiFetch(`search/albums?query=${encoded}&limit=${limit}`);
      if (!res || !res.ok) return [];

      const json = await res.json();
      const results = json?.data?.results || [];
      const albums: MusicAlbum[] = [];
      const seenTitles = new Set<string>();

      for (const a of results) {
        const title = decodeHtmlEntities(a.name || a.title || '');
        const artist = extractArtistName(a);
        const normKey = `${artist.toLowerCase()} - ${title.toLowerCase().replace(/\([^)]*\)/g, '').trim()}`;
        if (!title || seenTitles.has(normKey)) continue;
        seenTitles.add(normKey);

        const artworkUrl = extractArtwork(a.image);
        albums.push({
          id: String(a.id),
          title,
          artist,
          year: a.year ? String(a.year) : undefined,
          artworkUrl: artworkUrl || PLACEHOLDER_ARTWORK,
          songCount: typeof a.songCount === 'number' ? a.songCount : undefined
        });
      }

      if (albums.length > 0) {
        clientCache.set(cacheKey, albums, 86400);
      }
      return albums;
    } catch (err) {
      console.warn('[MusicApi] searchAlbums error:', err);
      return [];
    }
  }, []);

  const fetchAlbumTracks = useCallback(async (albumId: string): Promise<MusicTrack[]> => {
    if (!albumId) return [];

    const cacheKey = `cache_album_tracks_v1_${albumId}`;
    const cached = clientCache.get<MusicTrack[]>(cacheKey) || await clientCache.getAsync<MusicTrack[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return cached;
    }

    const { isSlow } = getNetworkSpeed();

    try {
      const res = await saavnApiFetch(`albums?id=${encodeURIComponent(albumId)}`);
      if (!res || !res.ok) return [];

      const json = await res.json();
      const songs = json?.data?.songs || [];
      const tracks: MusicTrack[] = songs
        .map((s: any, idx: number) => mapSaavnSongToTrack(s, idx, isSlow))
        .filter((t: MusicTrack | null): t is MusicTrack => t !== null);

      if (tracks.length > 0) {
        clientCache.set(cacheKey, tracks, 86400);
      }
      return tracks;
    } catch (err) {
      console.warn('[MusicApi] fetchAlbumTracks error:', err);
      return [];
    }
  }, []);

  return {
    loading,
    error,
    searchMusic,
    searchAlbums,
    fetchAlbumTracks,
    resolveFullAudioUrl
  };
}
