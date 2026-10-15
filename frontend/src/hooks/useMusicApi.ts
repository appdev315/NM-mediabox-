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

const REGION_MAP: Record<string, string> = {
  'ru': 'ru',
  'us': 'us',
  'gb': 'gb',
  'de': 'de',
  'fr': 'fr',
  'es': 'es',
  'it': 'it',
  'jp': 'jp',
  'kr': 'kr',
  'br': 'br',
  'in': 'in',
  'kz': 'kz',
  'by': 'by'
};

export function useMusicApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatArtwork = (url: string, size = 600): string => {
    if (!url) return '';
    return url
      .replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`)
      .replace(/\/\d+x\d+-\d+\./, `/${size}x${size}-100.`)
      .replace(/\/100x100bb\.jpg/, `/${size}x${size}bb.jpg`)
      .replace(/\/170x170bb\.png/, `/${size}x${size}bb.png`);
  };

  const fetchTopCharts = useCallback(async (countryCode = 'us', limit = 50): Promise<MusicTrack[]> => {
    const region = REGION_MAP[countryCode.toLowerCase()] || 'us';
    const cacheKey = `cache_music_top_${region}_${limit}`;
    
    // Check RAM / LocalStorage cache first
    const cached = clientCache.get<MusicTrack[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return cached;
    }

    setLoading(true);
    setError(null);

    try {
      const url = `https://itunes.apple.com/${region}/rss/topsongs/limit=${limit}/json`;
      const res = await fetchWithRetry(url, { maxRetries: 2 });
      
      if (!res || !res.ok) {
        throw new Error(`Failed to load Top Songs: ${res?.status || 'network error'}`);
      }

      const json = await res.json();
      const entries = json?.feed?.entry || [];
      
      const tracks: MusicTrack[] = entries.map((e: any, index: number) => {
        const id = e.id?.attributes?.['im:id'] || `track_${index}`;
        const title = e['im:name']?.label || 'Unknown Track';
        const artist = e['im:artist']?.label || 'Unknown Artist';
        const album = e['im:collection']?.['im:name']?.label || '';
        const rawArtwork = e['im:image']?.[e['im:image'].length - 1]?.label || e['im:image']?.[0]?.label || '';
        const artworkUrl = formatArtwork(rawArtwork);
        
        // Find audio preview
        const audioLink = e.link?.find((l: any) => 
          l.attributes?.['im:assetType'] === 'preview' || 
          l.attributes?.type?.includes('audio')
        );
        const audioUrl = audioLink?.attributes?.href || e.link?.[1]?.attributes?.href || '';
        const releaseDate = e['im:releaseDate']?.attributes?.label || '';
        const genre = e.category?.attributes?.label || '';

        return {
          id,
          title,
          artist,
          album,
          artworkUrl,
          audioUrl,
          releaseDate,
          genre
        };
      }).filter((t: MusicTrack) => t.audioUrl && t.title);

      if (tracks.length > 0) {
        // Cache charts for 12 hours
        clientCache.set(cacheKey, tracks, 43200);
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

    const cacheKey = `cache_music_search_${trimmed.toLowerCase()}_${limit}`;
    const cached = clientCache.get<MusicTrack[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return cached;
    }

    setLoading(true);
    setError(null);

    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(trimmed)}&entity=song&limit=${limit}`;
      const res = await fetchWithRetry(url, { maxRetries: 2 });
      
      if (!res || !res.ok) {
        throw new Error(`Search failed with status: ${res?.status}`);
      }

      const json = await res.json();
      const results = json?.results || [];

      const tracks: MusicTrack[] = results.map((item: any) => ({
        id: String(item.trackId || item.collectionId || Math.random().toString(36).substring(7)),
        title: item.trackName || item.trackCensoredName || 'Unknown Title',
        artist: item.artistName || 'Unknown Artist',
        album: item.collectionName || item.collectionCensoredName || '',
        artworkUrl: formatArtwork(item.artworkUrl100 || item.artworkUrl60 || ''),
        audioUrl: item.previewUrl || '',
        duration: item.trackTimeMillis,
        releaseDate: item.releaseDate ? item.releaseDate.substring(0, 4) : '',
        genre: item.primaryGenreName || ''
      })).filter((t: MusicTrack) => t.audioUrl && t.title);

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
    searchMusic,
    formatArtwork
  };
}
