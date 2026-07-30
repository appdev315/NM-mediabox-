import { useState, useCallback } from 'react';
import { WebApp } from '../telegram';
import { useLanguage } from '../context/LanguageContext';
import { clientCache } from '../utils/clientCache';

export const CF_API_BASE = import.meta.env.VITE_CF_API_BASE || 'https://backend.app-dev315.workers.dev/api'; 
export const EXPRESS_API_BASE = import.meta.env.VITE_EXPRESS_API_BASE || 'https://evro90-nm6.hf.space/api'; 

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

  const withLoading = useCallback(async <T>(fn: () => Promise<T>): Promise<T> => {
    setLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (err: any) {
      console.error('API Error:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const request = useCallback(async (endpoint: string, options: RequestInit = {}) => {
    return withLoading(async () => {
      const initData = WebApp.initData; 
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${initData}`,
        ...options.headers,
      };
      // request always goes to CF API BASE for user data
      const response = await fetch(`${CF_API_BASE}${endpoint}`, { ...options, headers });
      if (!response.ok) {
        let msg = `Ошибка: ${response.status}`;
        try {
          const errBody = await response.json();
          if (errBody.error) msg += ` - ${errBody.error}`;
        } catch(e) {}
        throw new Error(msg);
      }
      return await response.json();
    });
  }, [withLoading]);

  const tmdbFetch = useCallback(async (endpoint: string, params: Record<string, string | number> = {}, ttlSeconds: number = 3600) => {
    const searchParams = new URLSearchParams();
    searchParams.append('language', language);
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== '') {
        searchParams.append(key, String(val));
      }
    });

    const cacheKey = `tmdb_${endpoint}_${searchParams.toString()}`;
    const cached = clientCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const url = `${EXPRESS_API_BASE}/tmdb${endpoint}?${searchParams.toString()}`;
    const response = await fetch(url);
    if (!response.ok) {
      let msg = `Ошибка сервера: ${response.status}`;
      try {
        const errBody = await response.json();
        if (errBody.error) msg += ` - ${errBody.error}`;
      } catch(e) {}
      throw new Error(msg);
    }
    const data = await response.json();
    if (data) {
      clientCache.set(cacheKey, data, ttlSeconds);
    }
    return data;
  }, [language]);

  const mapTMDB = (item: any, forceType?: 'movie' | 'series') => ({
    id: item.id,
    title: item.title || item.name || item.original_title || 'Без названия',
    poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : 'https://placehold.co/300x450/242f3d/ffffff?text=No+Poster',
    description: item.overview || '',
    year: item.release_date ? item.release_date.split('-')[0] : (item.first_air_date ? item.first_air_date.split('-')[0] : ''),
    type: forceType || (item.media_type === 'tv' ? 'series' : 'movie') || (item.name ? 'series' : 'movie'),
    country: item.production_countries?.[0]?.name || '',
    genre: item.genres?.map((g: any) => g.name).join(', ') || '',
    seasons: item.seasons || [],
    imdb_id: item.imdb_id || item.external_ids?.imdb_id || '',
    rating: item.vote_average || 0
  });

  const fetchTrending = useCallback(async (type: 'movie' | 'tv') => {
    return withLoading(async () => {
      const data = await tmdbFetch(`/trending/${type}/day`);
      return data.results.map((item: TMDBMovie) => mapTMDB(item, type === 'tv' ? 'series' : 'movie'));
    });
  }, [tmdbFetch, withLoading]);

  const searchContent = useCallback(async (query: string) => {
    return withLoading(async () => {
      const data = await tmdbFetch('/search/multi', { query });
      return data.results
        .filter((i: TMDBMovie) => i.media_type !== 'person')
        .map((item: TMDBMovie) => mapTMDB(item, item.media_type === 'tv' ? 'series' : 'movie'));
    });
  }, [tmdbFetch, withLoading]);

  const fetchMovies = useCallback(async (page: number = 1, genreId?: string | number, countryCode?: string) => {
    return withLoading(async () => {
      const params: any = { page, sort_by: 'popularity.desc' };
      if (genreId) params.with_genres = genreId;
      if (countryCode) {
        params.with_origin_country = countryCode;
        params['vote_count.gte'] = 3;
      }
      const data = await tmdbFetch('/discover/movie', params);
      return (data.results || [])
        .filter((item: TMDBMovie) => !!item.poster_path)
        .map((item: TMDBMovie) => mapTMDB(item, 'movie'));
    });
  }, [tmdbFetch, withLoading]);

  const fetchSeries = useCallback(async (page: number = 1, genreId?: string | number, countryCode?: string) => {
    return withLoading(async () => {
      const params: any = { page, sort_by: 'popularity.desc' };
      if (genreId) params.with_genres = genreId;
      if (countryCode) {
        params.with_origin_country = countryCode;
        params['vote_count.gte'] = 3;
      }
      const data = await tmdbFetch('/discover/tv', params);
      return (data.results || [])
        .filter((item: TMDBMovie) => !!item.poster_path)
        .map((item: TMDBMovie) => mapTMDB(item, 'series'));
    });
  }, [tmdbFetch, withLoading]);

  const fetchGenres = useCallback(async (type: 'movie' | 'tv'): Promise<Genre[]> => {
    try {
      const data = await tmdbFetch(`/genre/${type}/list`);
      return data.genres || [];
    } catch (err: any) {
      console.error('TMDB API Error:', err);
      return [];
    }
  }, [tmdbFetch]);

  const fetchMovieDetails = useCallback(async (id: string | number, type: 'movie' | 'tv') => {
    return withLoading(async () => {
      const data = await tmdbFetch(`/${type}/${id}`, { append_to_response: 'external_ids' });
      return mapTMDB(data, type === 'tv' ? 'series' : 'movie');
    });
  }, [tmdbFetch, withLoading]);
  
  const fetchSeasonDetails = useCallback(async (id: string | number, seasonNumber: number) => {
    try {
      const data = await tmdbFetch(`/tv/${id}/season/${seasonNumber}`);
      return data;
    } catch (err: any) {
      console.error('TMDB API Error:', err);
      return null;
    }
  }, [tmdbFetch]);

  const fetchRecommendations = useCallback(async (id: string | number, type: 'movie' | 'tv') => {
    try {
      const data = await tmdbFetch(`/${type}/${id}/recommendations`);
      return data.results.map((item: TMDBMovie) => mapTMDB(item, type === 'tv' ? 'series' : 'movie'));
    } catch (err: any) {
      console.error('TMDB API Error:', err);
      return [];
    }
  }, [tmdbFetch]);

  const fetchCategorizedHome = useCallback(async (type: 'movie' | 'tv', silent = false) => {
    const cacheKey = `categorized_home_v2_${type}_${language}`;
    const cached = clientCache.get(cacheKey);
    if (!silent && cached) {
      return cached;
    }

    const fetcher = async () => {
      // 1. Trending (12 items)
      const trendingData = await tmdbFetch(`/trending/${type}/day`);
      const trendingItems = (trendingData.results || []).slice(0, 12).map((item: TMDBMovie) => mapTMDB(item, type === 'tv' ? 'series' : 'movie'));

      // Full list of ALL TMDB genres to build rich full home feed
      const genresToFetch = type === 'movie' ? [
        { id: 28, name: language === 'ru-RU' ? '💥 Боевики' : '💥 Action' },
        { id: 12, name: language === 'ru-RU' ? '🧭 Приключения' : '🧭 Adventure' },
        { id: 16, name: language === 'ru-RU' ? '🎨 Мультфильмы' : '🎨 Animation' },
        { id: 35, name: language === 'ru-RU' ? '🎭 Комедии' : '🎭 Comedy' },
        { id: 80, name: language === 'ru-RU' ? '🕵️ Криминал' : '🕵️ Crime' },
        { id: 99, name: language === 'ru-RU' ? '📹 Документальные' : '📹 Documentary' },
        { id: 18, name: language === 'ru-RU' ? '🍿 Драмы' : '🍿 Drama' },
        { id: 10751, name: language === 'ru-RU' ? '👨‍👩‍👧‍👦 Семейные' : '👨‍👩‍👧‍👦 Family' },
        { id: 14, name: language === 'ru-RU' ? '🪄 Фэнтези' : '🪄 Fantasy' },
        { id: 36, name: language === 'ru-RU' ? '📜 Исторические' : '📜 History' },
        { id: 27, name: language === 'ru-RU' ? '😱 Ужасы' : '😱 Horror' },
        { id: 10402, name: language === 'ru-RU' ? '🎵 Музыкальные' : '🎵 Music' },
        { id: 9648, name: language === 'ru-RU' ? '🔍 Детективы' : '🔍 Mystery' },
        { id: 10749, name: language === 'ru-RU' ? '💖 Мелодрамы' : '💖 Romance' },
        { id: 878, name: language === 'ru-RU' ? '🚀 Фантастика' : '🚀 Sci-Fi' },
        { id: 53, name: language === 'ru-RU' ? '🔪 Триллеры' : '🔪 Thriller' },
        { id: 10752, name: language === 'ru-RU' ? '⚔️ Военные' : '⚔️ War' },
        { id: 37, name: language === 'ru-RU' ? '🤠 Вестерны' : '🤠 Western' },
      ] : [
        { id: 10759, name: language === 'ru-RU' ? '💥 Боевики и Приключения' : '💥 Action & Adventure' },
        { id: 16, name: language === 'ru-RU' ? '🎨 Мультсериалы' : '🎨 Animation' },
        { id: 35, name: language === 'ru-RU' ? '🎭 Комедии' : '🎭 Comedy' },
        { id: 80, name: language === 'ru-RU' ? '🕵️ Криминал' : '🕵️ Crime' },
        { id: 99, name: language === 'ru-RU' ? '📹 Документальные' : '📹 Documentary' },
        { id: 18, name: language === 'ru-RU' ? '🍿 Драмы' : '🍿 Drama' },
        { id: 10751, name: language === 'ru-RU' ? '👨‍👩‍👧‍👦 Семейные' : '👨‍👩‍👧‍👦 Family' },
        { id: 10762, name: language === 'ru-RU' ? '👶 Детские' : '👶 Kids' },
        { id: 9648, name: language === 'ru-RU' ? '🔍 Детективы' : '🔍 Mystery' },
        { id: 10765, name: language === 'ru-RU' ? '🚀 Фантастика и Фэнтези' : '🚀 Sci-Fi & Fantasy' },
        { id: 10768, name: language === 'ru-RU' ? '⚔️ Война и Политика' : '⚔️ War & Politics' },
        { id: 37, name: language === 'ru-RU' ? '🤠 Вестерны' : '🤠 Western' },
      ];

      // Fetch genre sections in parallel
      const genreResults = await Promise.all(
        genresToFetch.map(async (g) => {
          try {
            const data = await tmdbFetch(type === 'movie' ? '/discover/movie' : '/discover/tv', { with_genres: g.id, page: 1 });
            const mapped = (data.results || []).slice(0, 12).map((item: TMDBMovie) => mapTMDB(item, type === 'tv' ? 'series' : 'movie'));
            return {
              id: String(g.id),
              name: g.name,
              genreId: String(g.id),
              items: mapped
            };
          } catch (e) {
            return { id: String(g.id), name: g.name, genreId: String(g.id), items: [] };
          }
        })
      );

      const sections = [
        { id: 'trending', name: language === 'ru-RU' ? '🔥 Популярное' : '🔥 Popular', genreId: '', items: trendingItems },
        ...genreResults.filter(s => s.items.length > 0)
      ];

      // Cache categorized sections for 24 HOURS (86400s) as requested by user
      clientCache.set(cacheKey, sections, 86400);

      return sections;
    };

    if (silent) {
      try {
        return await fetcher();
      } catch (e) {
        return cached || [];
      }
    }

    return withLoading(fetcher);
  }, [language, tmdbFetch, withLoading]);

  const fetchAdultSearch = useCallback(async (query: string, pageNum: number = 0) => {
    const cacheKey = `adult_search_${query}_${pageNum}`;
    const cached = clientCache.get<any[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const initData = WebApp?.initData || '';
    const headers = { 'Authorization': `tma ${initData}` };
    const res = await fetch(`${EXPRESS_API_BASE}/adult/search?q=${encodeURIComponent(query)}&page=${pageNum}`, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    if (Array.isArray(data)) {
      clientCache.set(cacheKey, data, 3600);
    }
    return data;
  }, []);

  const fetchAdultStream = useCallback(async (id: string) => {
    const cacheKey = `adult_stream_${id}`;
    const cached = clientCache.get<any>(cacheKey);
    if (cached) {
      return cached;
    }

    const initData = WebApp?.initData || '';
    const headers = { 'Authorization': `tma ${initData}` };
    const res = await fetch(`${EXPRESS_API_BASE}/adult/details?id=${encodeURIComponent(id)}`, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    if (data) {
      clientCache.set(cacheKey, data, 3600);
    }
    return data;
  }, []);

  return { request, fetchTrending, searchContent, fetchMovies, fetchSeries, fetchGenres, fetchMovieDetails, fetchSeasonDetails, fetchRecommendations, fetchCategorizedHome, fetchAdultSearch, fetchAdultStream, loading, error };
}
