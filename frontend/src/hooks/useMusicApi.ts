import { useState, useCallback } from 'react';
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
  duration?: number;
  releaseDate?: string;
  genre?: string;
  isResolved?: boolean;
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

const SAAVN_API_BASE = 'https://jiosaavn-api-amber.vercel.app/api';

const INVIDIOUS_INSTANCES = [
  'https://invidious.schenkel.eti.br',
  'https://yt.omada.cafe',
  'https://invidious.kemonomimi.nl',
  'https://echostreamz.com'
];

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
  const best = images.find(img => img.quality === '500x500') || images[images.length - 1];
  return best?.url || '';
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

  return {
    id: String(song.id || `saavn_${index}_${Date.now()}`),
    title,
    artist: extractArtistName(song),
    album: decodeHtmlEntities(song.album?.name || ''),
    artworkUrl: extractArtwork(song.image),
    audioUrl,
    duration: typeof song.duration === 'number' ? song.duration : parseInt(song.duration || '0', 10) || 180,
    releaseDate: String(song.year || song.releaseDate || ''),
    genre: song.language || 'Music',
    isResolved: true
  };
};



export const resolveFullAudioUrl = async (
  artist: string,
  title: string,
  fallbackUrl: string,
  trackId?: string
): Promise<string> => {
  const cleanArtist = artist.trim();
  const cleanTitle = title.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim();
  const cacheKey = `resolved_audio_v2_${cleanArtist.toLowerCase()}_${cleanTitle.toLowerCase()}`;

  const cached = clientCache.get<string>(cacheKey) || await clientCache.getAsync<string>(cacheKey);
  if (cached) return cached;

  const { isSlow } = getNetworkSpeed();

  // 1. Try JioSaavn CDN (Instant 320k / 160k direct stream for charts/international tracks)
  try {
    const q = `${cleanArtist} ${cleanTitle}`;
    const res = await fetchWithRetry(`${SAAVN_API_BASE}/search/songs?query=${encodeURIComponent(q)}&limit=1`, { maxRetries: 1 });
    if (res && res.ok) {
      const data = await res.json();
      const first = data?.data?.results?.[0];
      if (first) {
        const fullUrl = extractAudioUrl(first.downloadUrl, isSlow);
        if (fullUrl) {
          clientCache.set(cacheKey, fullUrl, 0); // 0 = permanent on device
          return fullUrl;
        }
      }
    }
  } catch (_) {}

  // 2. Try YouTube Music + Invidious direct 206 audio stream (Covers all Russian rap, rock, obscure tracks)
  try {
    let videoId = '';
    if (trackId && trackId.startsWith('yt_')) {
      videoId = trackId.replace('yt_', '');
    } else {
      const ytSearch = await fetchWithRetry(`https://api.ytify.workers.dev/search?q=${encodeURIComponent(cleanArtist + ' ' + cleanTitle)}`, { maxRetries: 1 });
      if (ytSearch && ytSearch.ok) {
        const results = await ytSearch.json();
        if (Array.isArray(results) && results.length > 0) {
          videoId = results[0].id;
        }
      }
    }

    if (videoId) {
      for (const instance of INVIDIOUS_INSTANCES) {
        try {
          const invRes = await fetchWithRetry(`${instance}/api/v1/videos/${videoId}`, { maxRetries: 1 });
          if (invRes && invRes.ok) {
            const data = await invRes.json();
            const streamUrl = extractInvidiousAudio(data.adaptiveFormats, isSlow);
            if (streamUrl) {
              clientCache.set(cacheKey, streamUrl, 0); // 0 = permanent on device
              return streamUrl;
            }
          }
        } catch (_) {
          continue;
        }
      }
    }
  } catch (_) {}

  return fallbackUrl;
};

const fetchDeezerJsonp = (url: string): Promise<any> => {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(null);
      return;
    }
    const callbackName = `dz_cb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const script = document.createElement('script');
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 4500);

    const cleanup = () => {
      clearTimeout(timer);
      if (script.parentNode) script.parentNode.removeChild(script);
      delete (window as any)[callbackName];
    };

    (window as any)[callbackName] = (data: any) => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      resolve(null);
    };

    const separator = url.includes('?') ? '&' : '?';
    script.src = `${url}${separator}output=jsonp&callback=${callbackName}`;
    document.body.appendChild(script);
  });
};

const mapDeezerTrack = (t: any): MusicTrack | null => {
  if (!t || !t.id || !t.title) return null;
  return {
    id: `dz_${t.id}`,
    title: String(t.title || '').trim(),
    artist: String(t.artist?.name || 'Unknown Artist').trim(),
    album: t.album?.title || '',
    artworkUrl: t.album?.cover_xl || t.album?.cover_big || t.album?.cover_medium || '',
    audioUrl: t.preview || '',
    duration: typeof t.duration === 'number' ? t.duration : 180,
    genre: 'Music',
    isResolved: false,
  };
};

export function useMusicApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchMusic = useCallback(async (query: string, limit = 60): Promise<MusicTrack[]> => {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const cacheKey = `cache_hybrid_music_search_v4_${trimmed.toLowerCase()}_${limit}`;
    const cached = clientCache.get<MusicTrack[]>(cacheKey) || await clientCache.getAsync<MusicTrack[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return cached;
    }

    setLoading(true);
    setError(null);

    const { isSlow } = getNetworkSpeed();

    try {
      // Step 1: Query in parallel:
      // a) Cloudflare Edge proxy (with 7-day edge cache & no CORS restrictions)
      // b) Direct Deezer JSONP in browser (instant 0ms server overhead, 100+ tracks)
      // c) JioSaavn (320k direct download links)
      const encoded = encodeURIComponent(trimmed);
      const [cfRes, dzDirectRes, saavnRes] = await Promise.allSettled([
        fetchWithRetry(`${CF_API_BASE}/music/search?q=${encoded}&limit=${limit}`, { maxRetries: 1 }),
        fetchDeezerJsonp(`https://api.deezer.com/search?q=${encoded}&limit=100`),
        fetchWithRetry(`${SAAVN_API_BASE}/search/songs?query=${encoded}&limit=${limit}`, { maxRetries: 1 })
      ]);

      const seenIds = new Set<string>();
      const seenTitles = new Set<string>();
      const merged: MusicTrack[] = [];

      const addTrack = (t: MusicTrack) => {
        const titleKey = `${t.artist.toLowerCase()} - ${t.title.toLowerCase().replace(/\([^)]*\)/g, '').trim()}`;
        if (!seenIds.has(t.id) && !seenTitles.has(titleKey)) {
          seenIds.add(t.id);
          seenTitles.add(titleKey);
          merged.push(t);
        }
      };

      // 1. Add Cloudflare Worker / Edge tracks
      if (cfRes.status === 'fulfilled' && cfRes.value && cfRes.value.ok) {
        try {
          const cfTracks = await cfRes.value.json();
          if (Array.isArray(cfTracks)) {
            for (const t of cfTracks) {
              addTrack(t);
            }
          }
        } catch (_) {}
      }

      // 2. Add direct client Deezer JSONP tracks
      if (dzDirectRes.status === 'fulfilled' && dzDirectRes.value?.data) {
        const list = Array.isArray(dzDirectRes.value.data) ? dzDirectRes.value.data : [];
        for (const item of list) {
          const t = mapDeezerTrack(item);
          if (t) addTrack(t);
        }
      }

      // 3. Add JioSaavn tracks (CDNs with 320k direct download links)
      if (saavnRes.status === 'fulfilled' && saavnRes.value && saavnRes.value.ok) {
        try {
          const json = await saavnRes.value.json();
          const results = json?.data?.results || [];
          const saavnTracks = results.map((s: any, idx: number) => mapSaavnSongToTrack(s, idx, isSlow)).filter((t: MusicTrack | null): t is MusicTrack => t !== null);
          for (const t of saavnTracks) {
            addTrack(t);
          }
        } catch (_) {}
      }

      if (merged.length > 0) {
        // Permanent on-device cache until system/user manually clears storage
        clientCache.set(cacheKey, merged, 0);
      }

      setLoading(false);
      return merged;
    } catch (err: any) {
      console.warn('[MusicApi] Hybrid search failed:', err);
      setError(err?.message || 'Error searching tracks');
      setLoading(false);
      return [];
    }
  }, []);


  return {
    loading,
    error,
    searchMusic,
    resolveFullAudioUrl
  };
}
