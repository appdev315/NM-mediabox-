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

export const COLLECTIONS = [
  { id: 'hits', title: 'Суперхиты', icon: '🔥', query: 'Top Hits 2026', playlistId: '1081991857' },
  { id: 'russian', title: 'Русские хиты', icon: '🇷🇺', query: 'Русские Хиты' },
  { id: 'rock', title: 'Рок', icon: '🎸', query: 'Rock Classics Hits' },
  { id: 'electronic', title: 'Электроника', icon: '🎧', query: 'Dance EDM Hits' },
  { id: 'hiphop', title: 'Хип-Хоп', icon: '🎤', query: 'Hip Hop Rap Hits' },
  { id: 'chill', title: 'Chillout', icon: '🌙', query: 'Chillout Relax Lo-Fi' }
] as const;

export type CollectionId = typeof COLLECTIONS[number]['id'];

export function useMusicApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCollection = useCallback(async (collectionId: string = 'hits', limit = 50): Promise<MusicTrack[]> => {
    const col = COLLECTIONS.find(c => c.id === collectionId) || COLLECTIONS[0];
    const cacheKey = `cache_music_collection_${col.id}_${limit}`;
    
    // Check RAM / LocalStorage cache first
    const cached = clientCache.get<MusicTrack[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return cached;
    }

    setLoading(true);
    setError(null);

    try {
      let tracks: MusicTrack[] = [];

      // If playlistId exists, try curated playlist first
      if ('playlistId' in col && col.playlistId) {
        try {
          const playlistRes = await fetchWithRetry(`${SAAVN_API_BASE}/playlists?id=${col.playlistId}`, { maxRetries: 1 });
          if (playlistRes && playlistRes.ok) {
            const playlistJson = await playlistRes.json();
            const songs = playlistJson?.data?.songs || [];
            tracks = songs
              .map(mapSaavnSongToTrack)
              .filter((t: MusicTrack | null): t is MusicTrack => t !== null);
          }
        } catch (_) {}
      }

      // Query collection search
      if (tracks.length === 0) {
        const url = `${SAAVN_API_BASE}/search/songs?query=${encodeURIComponent(col.query)}&limit=${limit}`;
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
        // Cache collections for 6 hours
        clientCache.set(cacheKey, tracks, 21600);
      }

      setLoading(false);
      return tracks;
    } catch (err: any) {
      console.warn('[MusicApi] Collection fetch failed:', err);
      setError(err?.message || 'Error fetching collection');
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
      // 1. Parallel requests: Artist search + Song search
      const [artistRes, songRes] = await Promise.allSettled([
        fetchWithRetry(`${SAAVN_API_BASE}/search/artists?query=${encodeURIComponent(trimmed)}&limit=3`, { maxRetries: 1 }),
        fetchWithRetry(`${SAAVN_API_BASE}/search/songs?query=${encodeURIComponent(trimmed)}&limit=${limit}`, { maxRetries: 2 })
      ]);

      let artistTracks: MusicTrack[] = [];
      if (artistRes.status === 'fulfilled' && artistRes.value && artistRes.value.ok) {
        try {
          const artistJson = await artistRes.value.json();
          const topArtist = artistJson?.data?.results?.[0];
          if (topArtist && topArtist.id) {
            // Fetch top songs by this artist (prioritized discography)
            const songsByArtistRes = await fetchWithRetry(`${SAAVN_API_BASE}/artists?id=${topArtist.id}&songCount=30`, { maxRetries: 1 });
            if (songsByArtistRes && songsByArtistRes.ok) {
              const songsJson = await songsByArtistRes.json();
              const topSongs = songsJson?.data?.topSongs || [];
              artistTracks = topSongs
                .map(mapSaavnSongToTrack)
                .filter((t: MusicTrack | null): t is MusicTrack => t !== null);
            }
          }
        } catch (_) {}
      }

      let songTracks: MusicTrack[] = [];
      if (songRes.status === 'fulfilled' && songRes.value && songRes.value.ok) {
        try {
          const json = await songRes.value.json();
          const results = json?.data?.results || [];
          songTracks = results
            .map(mapSaavnSongToTrack)
            .filter((t: MusicTrack | null): t is MusicTrack => t !== null);
        } catch (_) {}
      }

      // 2. Merge: Artist top songs come FIRST, followed by song matches, with deduplication
      const seenIds = new Set<string>();
      const seenTitles = new Set<string>();
      const merged: MusicTrack[] = [];

      for (const t of [...artistTracks, ...songTracks]) {
        const titleKey = `${t.artist.toLowerCase()} - ${t.title.toLowerCase()}`;
        if (!seenIds.has(t.id) && !seenTitles.has(titleKey)) {
          seenIds.add(t.id);
          seenTitles.add(titleKey);
          merged.push(t);
        }
      }

      if (merged.length > 0) {
        // Cache search results for 2 hours
        clientCache.set(cacheKey, merged, 7200);
      }

      setLoading(false);
      return merged;
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
    fetchCollection,
    fetchTopCharts: fetchCollection,
    searchMusic
  };
}
