import { useState, useCallback } from 'react';
import { WebApp } from '../telegram';
import { useLanguage } from '../context/LanguageContext';

export const API_BASE = 'https://backend.app-dev315.workers.dev/api'; // В проде заменить на Cloudflare URL
const TMDB_API_KEY = 'cd5b69242e715dc87d65957d7460eba2';

export interface TMDBMovie {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  poster_path?: string;
  overview?: string;
  release_date?: string;
  first_air_date?: string;
  media_type?: 'movie' | 'tv' | 'person' | string;
  seasons?: any[];
}

export interface Genre {
  id: number;
  name: string;
}

export function useApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { language } = useLanguage();

  const request = useCallback(async (endpoint: string, options: RequestInit = {}) => {
    setLoading(true);
    setError(null);
    try {
      const initData = WebApp.initData; 
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${initData}`,
        ...options.headers,
      };
      const response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
      if (!response.ok) throw new Error(`Ошибка: ${response.status}`);
      return await response.json();
    } catch (err: any) {
      console.error('TMDB API Error:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const tmdbFetch = async (endpoint: string, params: Record<string, string | number> = {}) => {
    const url = new URL(`https://api.themoviedb.org/3${endpoint}`);
    url.searchParams.append('api_key', TMDB_API_KEY);
    url.searchParams.append('language', language);
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== '') {
        url.searchParams.append(key, String(val));
      }
    });

    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`Ошибка TMDB: ${response.status}`);
    return await response.json();
  };

  const mapTMDB = (item: any, forceType?: 'movie' | 'series') => ({
    id: item.id,
    title: item.title || item.name || item.original_title || 'Без названия',
    poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://placehold.co/300x450/242f3d/ffffff?text=No+Poster',
    description: item.overview || '',
    year: item.release_date ? item.release_date.split('-')[0] : (item.first_air_date ? item.first_air_date.split('-')[0] : ''),
    type: forceType || (item.media_type === 'tv' ? 'series' : 'movie') || (item.name ? 'series' : 'movie'),
    country: item.production_countries?.[0]?.name || '',
    genre: item.genres?.map((g: any) => g.name).join(', ') || '',
    seasons: item.seasons || [],
    imdb_id: item.imdb_id || item.external_ids?.imdb_id || ''
  });

  const fetchTrending = useCallback(async (type: 'movie' | 'tv') => {
    setLoading(true);
    setError(null);
    try {
      const data = await tmdbFetch(`/trending/${type}/day`);
      return data.results.map((item: TMDBMovie) => mapTMDB(item, type === 'tv' ? 'series' : 'movie'));
    } catch (err: any) {
      console.error('TMDB API Error:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [language]);

  const searchContent = useCallback(async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await tmdbFetch('/search/multi', { query });
      return data.results
        .filter((i: TMDBMovie) => i.media_type !== 'person')
        .map((item: TMDBMovie) => mapTMDB(item, item.media_type === 'tv' ? 'series' : 'movie'));
    } catch (err: any) {
      console.error('TMDB API Error:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [language]);

  const fetchMovies = useCallback(async (page: number = 1, genreId?: string | number) => {
    setLoading(true);
    setError(null);
    try {
      const params: any = { page };
      if (genreId) params.with_genres = genreId;
      const data = await tmdbFetch('/discover/movie', params);
      return data.results.map((item: TMDBMovie) => mapTMDB(item, 'movie'));
    } catch (err: any) {
      console.error('TMDB API Error:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [language]);

  const fetchSeries = useCallback(async (page: number = 1, genreId?: string | number) => {
    setLoading(true);
    setError(null);
    try {
      const params: any = { page };
      if (genreId) params.with_genres = genreId;
      const data = await tmdbFetch('/discover/tv', params);
      return data.results.map((item: TMDBMovie) => mapTMDB(item, 'series'));
    } catch (err: any) {
      console.error('TMDB API Error:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [language]);

  const fetchGenres = useCallback(async (type: 'movie' | 'tv'): Promise<Genre[]> => {
    try {
      const data = await tmdbFetch(`/genre/${type}/list`);
      return data.genres || [];
    } catch (err: any) {
      console.error('TMDB API Error:', err);
      return [];
    }
  }, [language]);

  const fetchMovieDetails = useCallback(async (id: string | number, type: 'movie' | 'tv') => {
    setLoading(true);
    setError(null);
    try {
      const data = await tmdbFetch(`/${type}/${id}`, { append_to_response: 'external_ids' });
      return mapTMDB(data, type === 'tv' ? 'series' : 'movie');
    } catch (err: any) {
      console.error('TMDB API Error:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [language]);
  
  const fetchSeasonDetails = useCallback(async (id: string | number, seasonNumber: number) => {
    try {
      const data = await tmdbFetch(`/tv/${id}/season/${seasonNumber}`);
      return data;
    } catch (err: any) {
      console.error('TMDB API Error:', err);
      return null;
    }
  }, [language]);

  const fetchRecommendations = useCallback(async (id: string | number, type: 'movie' | 'tv') => {
    try {
      const data = await tmdbFetch(`/${type}/${id}/recommendations`);
      return data.results.map((item: TMDBMovie) => mapTMDB(item, type === 'tv' ? 'series' : 'movie'));
    } catch (err: any) {
      console.error('TMDB API Error:', err);
      return [];
    }
  }, [language]);



  return { request, fetchTrending, searchContent, fetchMovies, fetchSeries, fetchGenres, fetchMovieDetails, fetchSeasonDetails, fetchRecommendations, loading, error };
}
