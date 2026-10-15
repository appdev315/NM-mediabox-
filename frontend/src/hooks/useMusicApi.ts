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
}

const SAAVN_API_BASE = 'https://jiosaavn-api-amber.vercel.app/api';

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

const extractAudioUrl = (downloadUrls?: Array<{ quality: string; url: string }>): string => {
  if (!downloadUrls || downloadUrls.length === 0) return '';
  const best = downloadUrls.find(u => u.quality === '320kbps') ||
               downloadUrls.find(u => u.quality === '160kbps') ||
               downloadUrls[downloadUrls.length - 1];
  return best?.url || '';
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

const mapSaavnSongToTrack = (song: any, index: number): MusicTrack | null => {
  const audioUrl = extractAudioUrl(song.downloadUrl);
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
    genre: song.language || 'Music'
  };
};

export function useMusicApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTopCharts = useCallback(async (countryCode = 'us', limit = 50): Promise<MusicTrack[]> => {
    const code = countryCode.toLowerCase();
    const cacheKey = `cache_music_top_saavn_${code}_${limit}`;
    
    // Check RAM / LocalStorage cache first
    const cached = clientCache.get<MusicTrack[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return cached;
    }

    setLoading(true);
    setError(null);

    try {
      let tracks: MusicTrack[] = [];

      // If US/GB or global, attempt curated English Hit Songs playlist first
      if (code === 'us' || code === 'gb') {
        try {
          const playlistRes = await fetchWithRetry(`${SAAVN_API_BASE}/playlists?id=1081991857`, { maxRetries: 1 });
          if (playlistRes && playlistRes.ok) {
            const playlistJson = await playlistRes.json();
            const songs = playlistJson?.data?.songs || [];
            tracks = songs
              .map(mapSaavnSongToTrack)
              .filter((t: MusicTrack | null): t is MusicTrack => t !== null);
          }
        } catch (_) {}
      }

      // If playlist had no tracks or for other regions, query top chart search
      if (tracks.length === 0) {
        let chartQuery = 'Top Hits 2026';
        if (code === 'ru' || code === 'kz' || code === 'by') {
          chartQuery = 'Русские Хиты';
        } else if (code === 'de') {
          chartQuery = 'Top Hits Germany';
        } else if (code === 'fr') {
          chartQuery = 'Top Hits France';
        } else if (code === 'es') {
          chartQuery = 'Top Hits Spain';
        }

        const url = `${SAAVN_API_BASE}/search/songs?query=${encodeURIComponent(chartQuery)}&limit=${limit}`;
        const res = await fetchWithRetry(url, { maxRetries: 2 });
        if (res && res.ok) {
          const json = await res.json();
          const results = json?.data?.results || [];
          tracks = results
            .map(mapSaavnSongToTrack)
            .filter((t: MusicTrack | null): t is MusicTrack => t !== null);
        }
      }

      if (tracks.length > 0) {
        // Cache charts for 6 hours
        clientCache.set(cacheKey, tracks, 21600);
      }

      setLoading(false);
      return tracks;
    } catch (err: any) {
      console.warn('[MusicApi] Top charts fetch failed:', err);
      setError(err?.message || 'Error fetching charts');
      setLoading(false);
      return [];
    }
  }, []);

  const searchMusic = useCallback(async (query: string, limit = 35): Promise<MusicTrack[]> => {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const cacheKey = `cache_music_search_saavn_${trimmed.toLowerCase()}_${limit}`;
    const cached = clientCache.get<MusicTrack[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return cached;
    }

    setLoading(true);
    setError(null);

    try {
      const url = `${SAAVN_API_BASE}/search/songs?query=${encodeURIComponent(trimmed)}&limit=${limit}`;
      const res = await fetchWithRetry(url, { maxRetries: 2 });
      
      if (!res || !res.ok) {
        throw new Error(`Search failed with status: ${res?.status}`);
      }

      const json = await res.json();
      const results = json?.data?.results || [];

      const tracks: MusicTrack[] = results
        .map(mapSaavnSongToTrack)
        .filter((t: MusicTrack | null): t is MusicTrack => t !== null);

      if (tracks.length > 0) {
        // Cache search results for 2 hours
        clientCache.set(cacheKey, tracks, 7200);
      }

      setLoading(false);
      return tracks;
    } catch (err: any) {
      console.warn('[MusicApi] Search query failed:', err);
      setError(err?.message || 'Error searching tracks');
      setLoading(false);
      return [];
    }
  }, []);

  return {
    loading,
    error,
    fetchTopCharts,
    searchMusic
  };
}
