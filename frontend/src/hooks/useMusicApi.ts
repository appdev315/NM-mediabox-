import { useState, useCallback } from 'react';
import { clientCache } from '../utils/clientCache';
import { fetchWithRetry } from '../utils/fetchWithRetry';

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

const mapDeezerTrack = (t: any): MusicTrack | null => {
  if (!t || !t.title) return null;
  return {
    id: `dz_${t.id}`,
    title: decodeHtmlEntities(t.title || ''),
    artist: decodeHtmlEntities(t.artist?.name || 'Unknown Artist'),
    album: decodeHtmlEntities(t.album?.title || ''),
    artworkUrl: t.album?.cover_xl || t.album?.cover_big || t.album?.cover_medium || '',
    audioUrl: t.preview || '',
    duration: typeof t.duration === 'number' ? t.duration : 180,
    genre: 'Music',
    isResolved: false
  };
};

const parseDurationSeconds = (dur: string): number => {
  if (!dur) return 180;
  const parts = dur.split(':').map(p => parseInt(p, 10));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 180;
};

const mapYtTrack = (v: any): MusicTrack | null => {
  if (!v || !v.id || !v.title) return null;
  return {
    id: `yt_${v.id}`,
    title: decodeHtmlEntities(v.title || ''),
    artist: decodeHtmlEntities(v.author || 'YouTube Music'),
    artworkUrl: `https://img.youtube.com/vi/${v.id}/hqdefault.jpg`,
    audioUrl: `https://invidious.schenkel.eti.br/api/v1/videos/${v.id}`,
    duration: parseDurationSeconds(v.duration),
    genre: 'Music',
    isResolved: false
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

  const cached = clientCache.get<string>(cacheKey);
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
          clientCache.set(cacheKey, fullUrl, 86400);
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
              clientCache.set(cacheKey, streamUrl, 21600);
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

export function useMusicApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchMusic = useCallback(async (query: string, limit = 50): Promise<MusicTrack[]> => {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const cacheKey = `cache_hybrid_music_search_v2_${trimmed.toLowerCase()}_${limit}`;
    const cached = clientCache.get<MusicTrack[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return cached;
    }

    setLoading(true);
    setError(null);

    const { isSlow } = getNetworkSpeed();

    try {
      // Step 1: Query Deezer Artist Search, Deezer Track Search, and YouTube Music in parallel
      const [artistRes, dzTrackRes, ytRes, saavnRes] = await Promise.allSettled([
        fetchWithRetry(`https://api.deezer.com/search/artist?q=${encodeURIComponent(trimmed)}&limit=3`, { maxRetries: 1 }),
        fetchWithRetry(`https://api.deezer.com/search?q=${encodeURIComponent(trimmed)}&limit=100`, { maxRetries: 2 }),
        fetchWithRetry(`https://api.ytify.workers.dev/search?q=${encodeURIComponent(trimmed)}`, { maxRetries: 1 }),
        fetchWithRetry(`${SAAVN_API_BASE}/search/songs?query=${encodeURIComponent(trimmed)}&limit=${limit}`, { maxRetries: 1 })
      ]);

      let artistTracks: MusicTrack[] = [];
      let matchedArtistName = '';

      // If artist matches, fetch their full discography & top hits
      if (artistRes.status === 'fulfilled' && artistRes.value && artistRes.value.ok) {
        try {
          const artistJson = await artistRes.value.json();
          const topArtist = artistJson?.data?.[0];
          if (topArtist && topArtist.id) {
            matchedArtistName = topArtist.name || '';
            const [topSongsRes, albumsRes] = await Promise.allSettled([
              fetchWithRetry(`https://api.deezer.com/artist/${topArtist.id}/top?limit=100`, { maxRetries: 1 }),
              fetchWithRetry(`https://api.deezer.com/artist/${topArtist.id}/albums?limit=15`, { maxRetries: 1 })
            ]);

            if (topSongsRes.status === 'fulfilled' && topSongsRes.value && topSongsRes.value.ok) {
              const topSongsJson = await topSongsRes.value.json();
              const rawTop = topSongsJson?.data || [];
              const mapped = rawTop.map(mapDeezerTrack).filter((t: MusicTrack | null): t is MusicTrack => t !== null);
              artistTracks.push(...mapped);
            }

            // Fetch tracklists for top albums to cover all discography songs
            if (albumsRes.status === 'fulfilled' && albumsRes.value && albumsRes.value.ok) {
              try {
                const albumsJson = await albumsRes.value.json();
                const albums = (albumsJson?.data || []).slice(0, 5);
                const albumTrackPromises = albums.map((alb: any) =>
                  fetchWithRetry(`https://api.deezer.com/album/${alb.id}/tracks?limit=50`, { maxRetries: 1 })
                    .then(r => r && r.ok ? r.json() : null)
                    .catch(() => null)
                );
                const albumTrackResults = await Promise.allSettled(albumTrackPromises);
                for (const res of albumTrackResults) {
                  if (res.status === 'fulfilled' && res.value?.data) {
                    const mapped = res.value.data.map(mapDeezerTrack).filter((t: MusicTrack | null): t is MusicTrack => t !== null);
                    artistTracks.push(...mapped);
                  }
                }
              } catch (_) {}
            }
          }
        } catch (_) {}
      }

      // Step 2: Parse general Deezer track results
      let dzTracks: MusicTrack[] = [];
      if (dzTrackRes.status === 'fulfilled' && dzTrackRes.value && dzTrackRes.value.ok) {
        try {
          const json = await dzTrackRes.value.json();
          const raw = json?.data || [];
          dzTracks = raw.map(mapDeezerTrack).filter((t: MusicTrack | null): t is MusicTrack => t !== null);
        } catch (_) {}
      }

      // Step 3: Parse YouTube Music results (captures underground Russian rap, live sets, remixes)
      let ytTracks: MusicTrack[] = [];
      if (ytRes.status === 'fulfilled' && ytRes.value && ytRes.value.ok) {
        try {
          const rawYt = await ytRes.value.json();
          if (Array.isArray(rawYt)) {
            ytTracks = rawYt.map(mapYtTrack).filter((t: MusicTrack | null): t is MusicTrack => t !== null);
          }
        } catch (_) {}
      }

      // Step 4: Parse Saavn tracks (high bitrate international pop/rock/indie)
      let saavnTracks: MusicTrack[] = [];
      if (saavnRes.status === 'fulfilled' && saavnRes.value && saavnRes.value.ok) {
        try {
          const json = await saavnRes.value.json();
          const results = json?.data?.results || [];
          saavnTracks = results.map((s: any, idx: number) => mapSaavnSongToTrack(s, idx, isSlow)).filter((t: MusicTrack | null): t is MusicTrack => t !== null);
        } catch (_) {}
      }

      // Step 5: Merge with Artist Priority
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

      // 1. Artist discography tracks first
      for (const t of artistTracks) {
        addTrack(t);
      }

      // 2. Tracks where artist directly matches query
      if (matchedArtistName) {
        const lowerMatched = matchedArtistName.toLowerCase();
        for (const t of [...dzTracks, ...saavnTracks, ...ytTracks]) {
          if (t.artist.toLowerCase().includes(lowerMatched)) {
            addTrack(t);
          }
        }
      }

      // 3. General query matches across all sources
      for (const t of [...dzTracks, ...saavnTracks, ...ytTracks]) {
        addTrack(t);
      }

      if (merged.length > 0) {
        clientCache.set(cacheKey, merged, 7200);
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
