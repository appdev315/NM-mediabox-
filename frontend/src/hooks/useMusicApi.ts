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

export interface MusicPlaylist {
  id: string;
  title: string;
  trackCount: number;
  coverUrl: string;
  creator?: string;
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
    genre: song.language || 'Music',
    isResolved: true
  };
};

const mapAppleEntryToTrack = (entry: any, index: number): MusicTrack | null => {
  const title = decodeHtmlEntities(entry['im:name']?.label || entry.title?.label || '');
  const artist = decodeHtmlEntities(entry['im:artist']?.label || 'Unknown Artist');
  if (!title) return null;

  let previewUrl = '';
  if (Array.isArray(entry.link)) {
    const enclosure = entry.link.find((l: any) => l.attributes?.rel === 'enclosure');
    if (enclosure?.attributes?.href) {
      previewUrl = enclosure.attributes.href;
    }
  }

  let rawImg = '';
  if (Array.isArray(entry['im:image']) && entry['im:image'].length > 0) {
    rawImg = entry['im:image'][entry['im:image'].length - 1]?.label || '';
  }
  const artworkUrl = rawImg ? rawImg.replace(/\/\d+x\d+bb\./, '/600x600bb.') : '';

  const id = String(entry.id?.attributes?.['im:id'] || `apple_${index}_${Date.now()}`);

  return {
    id,
    title,
    artist,
    album: decodeHtmlEntities(entry['im:collection']?.['im:name']?.label || ''),
    artworkUrl,
    audioUrl: previewUrl,
    duration: 180,
    releaseDate: entry['im:releaseDate']?.label || '',
    genre: entry.category?.attributes?.label || 'Music',
    isResolved: false
  };
};

export const COLLECTIONS = [
  { id: 'hits', title: 'Суперхиты', icon: '🔥', feedUrl: 'https://itunes.apple.com/us/rss/topsongs/limit=100/json' },
  { id: 'russian', title: 'Русские хиты', icon: '🇷🇺', feedUrl: 'https://itunes.apple.com/ru/rss/topsongs/limit=100/json' },
  { id: 'rock', title: 'Рок', icon: '🎸', feedUrl: 'https://itunes.apple.com/us/rss/topsongs/limit=100/genre=21/json' },
  { id: 'electronic', title: 'Электроника', icon: '🎧', feedUrl: 'https://itunes.apple.com/us/rss/topsongs/limit=100/genre=17/json' },
  { id: 'hiphop', title: 'Хип-Хоп', icon: '🎤', feedUrl: 'https://itunes.apple.com/us/rss/topsongs/limit=100/genre=18/json' },
  { id: 'chill', title: 'Chillout', icon: '🌙', feedUrl: 'https://itunes.apple.com/us/rss/topsongs/limit=100/genre=20/json' }
] as const;

export type CollectionId = typeof COLLECTIONS[number]['id'];

export const resolveFullAudioUrl = async (artist: string, title: string, fallbackUrl: string): Promise<string> => {
  const cleanArtist = artist.trim();
  const cleanTitle = title.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim();
  const cacheKey = `resolved_audio_${cleanArtist.toLowerCase()}_${cleanTitle.toLowerCase()}`;

  const cached = clientCache.get<string>(cacheKey);
  if (cached) return cached;

  try {
    const q = `${cleanArtist} ${cleanTitle}`;
    const res = await fetchWithRetry(`${SAAVN_API_BASE}/search/songs?query=${encodeURIComponent(q)}&limit=1`, { maxRetries: 1 });
    if (res && res.ok) {
      const data = await res.json();
      const first = data?.data?.results?.[0];
      if (first) {
        const fullUrl = extractAudioUrl(first.downloadUrl);
        if (fullUrl) {
          clientCache.set(cacheKey, fullUrl, 86400); // Cache 24 hours
          return fullUrl;
        }
      }
    }
  } catch (err) {
    console.warn('[MusicApi] Failed to resolve 320k stream, using fallback:', err);
  }

  return fallbackUrl;
};

export function useMusicApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCollection = useCallback(async (collectionId: string = 'hits', limit = 50): Promise<MusicTrack[]> => {
    const col = COLLECTIONS.find(c => c.id === collectionId) || COLLECTIONS[0];
    const cacheKey = `cache_music_apple_collection_${col.id}_${limit}`;
    
    // Check RAM / LocalStorage cache first
    const cached = clientCache.get<MusicTrack[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return cached;
    }

    setLoading(true);
    setError(null);

    try {
      let tracks: MusicTrack[] = [];
      const res = await fetchWithRetry(col.feedUrl, { maxRetries: 2 });
      if (res && res.ok) {
        const json = await res.json();
        const entries = json?.feed?.entry || [];
        tracks = entries
          .slice(0, limit)
          .map(mapAppleEntryToTrack)
          .filter((t: MusicTrack | null): t is MusicTrack => t !== null);
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

  const searchPlaylists = useCallback(async (query: string, limit = 20): Promise<MusicPlaylist[]> => {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const cacheKey = `cache_music_playlists_deezer_${trimmed.toLowerCase()}_${limit}`;
    const cached = clientCache.get<MusicPlaylist[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return cached;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetchWithRetry(`https://api.deezer.com/search/playlist?q=${encodeURIComponent(trimmed)}&limit=${limit}`, { maxRetries: 2 });
      if (!res || !res.ok) {
        setLoading(false);
        return [];
      }
      const json = await res.json();
      const raw = json?.data || [];
      const playlists: MusicPlaylist[] = raw.map((p: any) => ({
        id: String(p.id),
        title: decodeHtmlEntities(p.title || 'Playlist'),
        trackCount: typeof p.nb_tracks === 'number' ? p.nb_tracks : 0,
        coverUrl: p.picture_xl || p.picture_big || p.picture_medium || p.picture || '',
        creator: p.user?.name || ''
      }));

      if (playlists.length > 0) {
        clientCache.set(cacheKey, playlists, 7200);
      }

      setLoading(false);
      return playlists;
    } catch (err: any) {
      console.warn('[MusicApi] Search playlists failed:', err);
      setError(err?.message || 'Error searching playlists');
      setLoading(false);
      return [];
    }
  }, []);

  const fetchPlaylistTracks = useCallback(async (playlistId: string): Promise<MusicTrack[]> => {
    const cacheKey = `cache_deezer_playlist_tracks_${playlistId}`;
    const cached = clientCache.get<MusicTrack[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return cached;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetchWithRetry(`https://api.deezer.com/playlist/${playlistId}/tracks?limit=100`, { maxRetries: 2 });
      if (!res || !res.ok) {
        setLoading(false);
        return [];
      }
      const json = await res.json();
      const raw = json?.data || [];
      const tracks: MusicTrack[] = raw
        .filter((t: any) => t && t.title)
        .map((t: any, idx: number) => ({
          id: `dz_${t.id || idx}`,
          title: decodeHtmlEntities(t.title || ''),
          artist: decodeHtmlEntities(t.artist?.name || 'Unknown Artist'),
          album: decodeHtmlEntities(t.album?.title || ''),
          artworkUrl: t.album?.cover_xl || t.album?.cover_big || t.album?.cover_medium || '',
          audioUrl: t.preview || '',
          duration: typeof t.duration === 'number' ? t.duration : 180,
          genre: 'Music',
          isResolved: false
        }));

      if (tracks.length > 0) {
        clientCache.set(cacheKey, tracks, 7200);
      }

      setLoading(false);
      return tracks;
    } catch (err: any) {
      console.warn('[MusicApi] Fetch playlist tracks failed:', err);
      setError(err?.message || 'Error fetching playlist tracks');
      setLoading(false);
      return [];
    }
  }, []);

  return {
    loading,
    error,
    fetchCollection,
    fetchTopCharts: fetchCollection,
    searchMusic,
    searchPlaylists,
    fetchPlaylistTracks,
    resolveFullAudioUrl
  };
}

