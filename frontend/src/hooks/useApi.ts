import { useState, useCallback } from 'react';
import { WebApp } from '../telegram';
import { useLanguage } from '../context/LanguageContext';
import { clientCache } from '../utils/clientCache';

export const CF_API_BASE = import.meta.env.VITE_CF_API_BASE || 'https://backend.app-dev315.workers.dev/api';
export const EXPRESS_API_BASE = import.meta.env.VITE_EXPRESS_API_BASE || 'https://evro90-nm6.hf.space/api';

// In-flight request deduplication map to prevent redundant parallel network calls
const inFlightRequests = new Map<string, Promise<any>>();

// TMDB Edge Image Proxy helper (bypasses ISP blocks in Russia & caches on Cloudflare Edge)
export const getTmdbImageUrl = (path: string | null | undefined, size: 'w185' | 'w300' | 'w342' | 'w500' | 'w1280' = 'w342') => {
  if (!path) return '';
  return `${CF_API_BASE}/image?path=/t/p/${size}${path.startsWith('/') ? path : '/' + path}`;
};

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
  popularity?: number;
  vote_count?: number;
  vote_average?: number;
}

export interface Genre {
  id: number;
  name: string;
}

export interface TrailerFeedItem {
  id: number;
  mediaType: 'movie' | 'tv';
  title: string;
  originalTitle: string;
  year: string;
  rating: number;
  genreNames: string[];
  overview: string;
  poster: string;
  backdrop: string;
  trailerKey: string;
}

/**
 * Intelligent search query normalizer.
 * Cleans whitespace/newlines, strips copy-pasted release years (1900..currentYear+5),
 * while safeguarding numbers-as-titles (1917, 2012, Blade Runner 2049).
 */
export function parseSearchQuery(raw: string): { title: string; year?: string } {
  if (!raw) return { title: '' };
  const normalized = raw.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  
  const currentYear = new Date().getFullYear();
  const maxReleaseYear = currentYear + 5;

  const yearMatch = normalized.match(/^(.*?)(?:[\s,/–-]+[\(\[\{]?(19\d\d|20\d\d)[\)\]\}]?)$/);
  if (yearMatch && yearMatch[1].trim().length > 0) {
    const parsedYear = parseInt(yearMatch[2], 10);
    if (parsedYear >= 1900 && parsedYear <= maxReleaseYear) {
      return { title: yearMatch[1].trim(), year: String(parsedYear) };
    }
  }

  return { title: normalized };
}

/**
 * Normalizes accidental Latin homoglyphs in predominantly Cyrillic words
 * caused by mobile/desktop keyboard layout switching.
 */
export function fixMixedScript(text: string): string {
  const words = text.split(/\s+/);
  return words.map(w => {
    const cyrCount = (w.match(/[а-яё]/gi) || []).length;
    const latCount = (w.match(/[a-z]/gi) || []).length;
    if (cyrCount > 0 && latCount > 0 && cyrCount >= latCount) {
      return w
        .replace(/a/g, 'а').replace(/A/g, 'А')
        .replace(/c/g, 'с').replace(/C/g, 'С')
        .replace(/e/g, 'е').replace(/E/g, 'Е')
        .replace(/o/g, 'о').replace(/O/g, 'О')
        .replace(/p/g, 'р').replace(/P/g, 'Р')
        .replace(/x/g, 'х').replace(/X/g, 'Х')
        .replace(/y/g, 'у').replace(/Y/g, 'У')
        .replace(/k/g, 'к').replace(/K/g, 'К');
    }
    return w;
  }).join(' ');
}

const YO_REPLACEMENTS: [RegExp, string][] = [
  [/рублев/gi, 'рублёв'],
  [/зелен/gi, 'зелён'],
  [/черн/gi, 'чёрн'],
  [/темн/gi, 'тёмн'],
  [/елк/gi, 'ёлк'],
  [/крестн/gi, 'крёстн'],
  [/звезд/gi, 'звёзд'],
  [/мертв/gi, 'мёртв'],
  [/слез/gi, 'слёз'],
  [/влюблен/gi, 'влюблён'],
  [/королев/gi, 'королёв'],
  [/потемкин/gi, 'потёмкин'],
  [/вертолет/gi, 'вертолёт'],
  [/самолет/gi, 'самолёт'],
  [/тяжел/gi, 'тяжёл'],
  [/актер/gi, 'актёр'],
  [/боксер/gi, 'боксёр'],
  [/шофер/gi, 'шофёр'],
  [/стажер/gi, 'стажёр'],
  [/режиссер/gi, 'режиссёр'],
  [/дирижер/gi, 'дирижёр'],
  [/шахтер/gi, 'шахтёр'],
  [/\bо чем\b/gi, 'о чём'],
  [/\bчем\b/gi, 'чём'],
  [/\bеще\b/gi, 'ещё'],
  [/\блед\b/gi, 'лёд'],
  [/\bпес\b/gi, 'пёс'],
  [/\bсчет\b/gi, 'счёт'],
  [/\bчерт\b/gi, 'чёрт'],
  [/\bмед\b/gi, 'мёд'],
  [/\bжелт/gi, 'жёлт'],
  [/\bкотел\b/gi, 'котёл'],
  [/\борел\b/gi, 'орёл'],
  [/\bкозел\b/gi, 'козёл'],
  [/\bперекрест/gi, 'перекрёст']
];

function preserveCaseReplace(text: string, re: RegExp, targetWord: string): string {
  return text.replace(re, (match) => {
    if (match[0] === match[0].toUpperCase()) {
      return targetWord[0].toUpperCase() + targetWord.slice(1);
    }
    return targetWord.toLowerCase();
  });
}

/**
 * Generates orthographic search variants to seamlessly bridge E and Ё.
 */
export function generateSearchVariants(text: string): string[] {
  const clean = fixMixedScript(text).trim();
  const variants = new Set<string>([clean]);

  if (/[ёЁ]/.test(clean)) {
    variants.add(clean.replace(/ё/g, 'е').replace(/Ё/g, 'Е'));
  }

  if (/[еЕ]/.test(clean)) {
    let yoText = clean;
    for (const [re, rep] of YO_REPLACEMENTS) {
      yoText = preserveCaseReplace(yoText, re, rep);
    }
    if (yoText !== clean) {
      variants.add(yoText);
    }
  }

  return Array.from(variants);
}

function normalizeForRelevance(str: string): string {
  return (str || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Ranks combined results ensuring exact/prefix matches and higher popularity appear on top.
 */
export function rankSearchResults(items: TMDBMovie[], query: string): TMDBMovie[] {
  const normQ = normalizeForRelevance(query);
  const qWords = normQ.split(' ').filter(Boolean);

  return [...items].sort((a, b) => {
    const titleA = a.title || a.name || '';
    const titleB = b.title || b.name || '';
    const normA = normalizeForRelevance(titleA);
    const normB = normalizeForRelevance(titleB);

    let scoreA = (a.popularity || 0) + (a.vote_count || 0) * 0.1;
    let scoreB = (b.popularity || 0) + (b.vote_count || 0) * 0.1;

    if (normA === normQ) scoreA += 1000;
    if (normB === normQ) scoreB += 1000;

    if (normA.startsWith(normQ)) scoreA += 500;
    if (normB.startsWith(normQ)) scoreB += 500;

    let matchCountA = 0;
    let matchCountB = 0;
    for (const qw of qWords) {
      if (qw.length > 2) {
        if (normA.includes(qw)) matchCountA++;
        if (normB.includes(qw)) matchCountB++;
      }
    }
    scoreA += matchCountA * 200;
    scoreB += matchCountB * 200;

    return scoreB - scoreA;
  });
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
      const initData = WebApp?.initData || '';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(initData ? { 'Authorization': `Bearer ${initData}` } : {}),
        ...(options.headers as Record<string, string>),
      };
      // request always goes to CF API BASE for user data
      const response = await fetch(`${CF_API_BASE}${endpoint}`, { ...options, headers });
      if (!response.ok) {
        let msg = `Ошибка: ${response.status}`;
        try {
          const errBody = await response.json();
          if (errBody.error) msg += ` - ${errBody.error}`;
        } catch (e) { }
        throw new Error(msg);
      }
      return await response.json();
    });
  }, [withLoading]);

  const tmdbFetch = useCallback(async (endpoint: string, params: Record<string, string | number> = {}, ttlSeconds: number = 3600) => {
    const searchParams = new URLSearchParams();
    const targetLanguage = (params.language as string) || language;
    searchParams.append('language', targetLanguage);

    Object.entries(params).forEach(([key, val]) => {
      if (key !== 'language' && val !== undefined && val !== '') {
        searchParams.append(key, String(val));
      }
    });

    const cacheKey = `tmdb_${endpoint}_${searchParams.toString()}`;
    const cached = clientCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // In-flight deduplication: reuse active pending promise for identical requests
    if (inFlightRequests.has(cacheKey)) {
      return inFlightRequests.get(cacheKey);
    }

    const executeFetch = async (retryCount = 0): Promise<any> => {
      try {
        const fetchViaCFProxy = async (signal?: AbortSignal) => {
          const url = `${CF_API_BASE}/tmdb${endpoint}?${searchParams.toString()}`;
          const response = await fetch(url, { signal });
          if (!response.ok) {
            throw new Error(`CF Proxy error: ${response.status}`);
          }
          return await response.json();
        };

        const fetchViaHFProxy = async (signal?: AbortSignal) => {
          const url = `${EXPRESS_API_BASE}/tmdb${endpoint}?${searchParams.toString()}`;
          const response = await fetch(url, {
            signal,
            headers: {
              'X-App-Client': 'mediabox-app',
              'X-Client-Time': String(Date.now()),
            }
          });
          if (!response.ok) {
            throw new Error(`HF Proxy error: ${response.status}`);
          }
          return await response.json();
        };

        let data;
        const cfCtrl = new AbortController();
        const hfCtrl = new AbortController();

        // Priority 1: Cloudflare Edge proxy (15-30ms latency, zero cold-start, immune to RKN)
        // Instant failover: If CF fails (4xx/5xx/network error), query HF immediately (0ms delay).
        // Speculative parallel race: If CF takes > 1500ms, start HF in parallel so user never waits.
        let hfTimer: ReturnType<typeof setTimeout> | undefined;
        const cfPromise = fetchViaCFProxy(cfCtrl.signal);

        const speculativeHfPromise = new Promise((resolve, reject) => {
          hfTimer = setTimeout(() => {
            fetchViaHFProxy(hfCtrl.signal).then(resolve).catch(reject);
          }, 1500);
        });

        try {
          data = await Promise.race([
            cfPromise.then(res => {
              if (hfTimer) clearTimeout(hfTimer);
              hfCtrl.abort();
              return res;
            }),
            cfPromise.catch(async () => {
              // CF failed immediately! Clear speculative timer and call HF instantly
              if (hfTimer) clearTimeout(hfTimer);
              return await fetchViaHFProxy(hfCtrl.signal);
            }),
            speculativeHfPromise
          ]);
        } catch (_) {
          // Safety fallback with fresh AbortSignal
          data = await fetchViaHFProxy();
        }

        if (data) {
          clientCache.set(cacheKey, data, ttlSeconds);
        }
        return data;
      } catch (err) {
        if (retryCount < 1) {
          await new Promise(r => setTimeout(r, 600));
          return executeFetch(retryCount + 1);
        }
        throw err;
      }
    };

    const promise = executeFetch().finally(() => {
      inFlightRequests.delete(cacheKey);
    });
    inFlightRequests.set(cacheKey, promise);
    return promise;
  }, [language]);

  const extractCertification = (item: any) => {
    if (item.release_dates?.results) {
      const ruDate = item.release_dates.results.find((r: any) => r.iso_3166_1 === 'RU');
      if (ruDate?.release_dates) {
        const cert = ruDate.release_dates.find((d: any) => d.certification)?.certification;
        if (cert) return cert.includes('+') ? cert : `${cert}+`;
      }
      const usDate = item.release_dates.results.find((r: any) => r.iso_3166_1 === 'US');
      if (usDate?.release_dates) {
        const cert = usDate.release_dates.find((d: any) => d.certification)?.certification;
        if (cert) return cert;
      }
    }
    if (item.content_ratings?.results) {
      const ruRating = item.content_ratings.results.find((r: any) => r.iso_3166_1 === 'RU');
      if (ruRating?.rating) return ruRating.rating;
      const usRating = item.content_ratings.results.find((r: any) => r.iso_3166_1 === 'US');
      if (usRating?.rating) return usRating.rating;
    }
    return '';
  };

  const mapTMDB = (item: any, forceType?: 'movie' | 'series') => {
    const rawDate = item.release_date || item.first_air_date || '';
    const releaseTimestamp = rawDate ? new Date(rawDate).getTime() : 0;
    const isUpcoming = Boolean(releaseTimestamp > 0 && releaseTimestamp > Date.now());

    return {
      id: item.id,
      title: item.title || item.name || item.original_title || 'Без названия',
      original_title: item.original_title || item.original_name || '',
      poster: item.poster_path ? getTmdbImageUrl(item.poster_path, 'w342') : 'https://placehold.co/300x450/242f3d/ffffff?text=No+Poster',
      backdrop: item.backdrop_path ? getTmdbImageUrl(item.backdrop_path, 'w1280') : '',
      description: item.overview || '',
      tagline: item.tagline || '',
      runtime: item.runtime || (item.episode_run_time ? item.episode_run_time[0] : 0),
      certification: extractCertification(item),
      year: item.release_date ? item.release_date.split('-')[0] : (item.first_air_date ? item.first_air_date.split('-')[0] : ''),
      type: forceType || (item.media_type === 'tv' ? 'series' : 'movie') || (item.name ? 'series' : 'movie'),
      country: item.production_countries?.[0]?.name || '',
      origin_country: item.origin_country || item.production_countries?.map((c: any) => c.iso_3166_1) || [],
      genre: item.genres?.map((g: any) => g.name).join(', ') || '',
      genres: item.genres || [],
      seasons: item.seasons || [],
      imdb_id: item.imdb_id || item.external_ids?.imdb_id || '',
      rating: item.vote_average || 0,
      release_date: rawDate,
      credits: item.credits || null,
      videos: item.videos || null,
      isUpcoming
    };
  };

  const fetchTrending = useCallback(async (type: 'movie' | 'tv') => {
    return withLoading(async () => {
      const data = await tmdbFetch(`/trending/${type}/day`);
      return (data?.results || []).map((item: TMDBMovie) => mapTMDB(item, type === 'tv' ? 'series' : 'movie'));
    });
  }, [tmdbFetch, withLoading]);

  const searchContent = useCallback(async (rawQuery: string) => {
    const { title, year } = parseSearchQuery(rawQuery);
    const cleanTitle = title.slice(0, 120);
    if (!cleanTitle) return [];

    return withLoading(async () => {
      const searchVariants = generateSearchVariants(cleanTitle);

      const fetchBatch = async (queries: string[], yearFilter?: string) => {
        const promises = queries.map(async (q) => {
          const params: Record<string, string | number> = { query: q };
          if (yearFilter) params.year = yearFilter;
          try {
            const data = await tmdbFetch('/search/multi', params);
            return (data?.results || []).filter((i: TMDBMovie) => i.media_type !== 'person');
          } catch {
            return [];
          }
        });
        const resultsArray = await Promise.all(promises);
        const seen = new Set<number>();
        const merged: TMDBMovie[] = [];
        for (const list of resultsArray) {
          for (const item of list) {
            if (!seen.has(item.id)) {
              seen.add(item.id);
              merged.push(item);
            }
          }
        }
        return merged;
      };

      // 1. Primary search with all orthographic variants (+ year if specified)
      let results = await fetchBatch(searchVariants, year);

      // 2. Fallback: if 0 results and year was attached, retry variants without year restriction
      if (results.length === 0 && year) {
        results = await fetchBatch(searchVariants);
      }

      // 3. Fallback: if 0 results and query had multiple words, try keyword search for typos
      if (results.length === 0) {
        const words = cleanTitle.replace(/[^a-zа-я0-9]/gi, ' ').trim().split(/\s+/).filter(w => w.length >= 4);
        for (const word of words) {
          const wordVariants = generateSearchVariants(word);
          const wordResults = await fetchBatch(wordVariants);
          if (wordResults.length > 0) {
            results = wordResults;
            break;
          }
        }
      }

      // 4. Fallback: if still 0 results and normalized raw differed from cleanTitle, try raw query
      const normalizedRaw = (rawQuery || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120);
      if (results.length === 0 && normalizedRaw !== cleanTitle) {
        const rawResults = await fetchBatch([normalizedRaw]);
        results = rawResults;
      }

      // 5. Intelligent relevance ranking: exact title match > starts-with > popularity & votes
      const ranked = rankSearchResults(results, cleanTitle);

      return ranked.map((item: TMDBMovie) => mapTMDB(item, item.media_type === 'tv' ? 'series' : 'movie'));
    });
  }, [tmdbFetch, withLoading]);

  const fetchMovies = useCallback(async (page: number = 1, genreId?: string | number, countryCode?: string, sortBy: string = 'popularity.desc') => {
    return withLoading(async () => {
      const params: any = { page, sort_by: sortBy };
      if (sortBy === 'vote_average.desc') {
        params['vote_count.gte'] = 300;
      } else if (countryCode) {
        params.with_origin_country = countryCode;
        params['vote_count.gte'] = 3;
      }
      if (genreId) params.with_genres = genreId;
      const data = await tmdbFetch('/discover/movie', params);
      return (data.results || [])
        .filter((item: TMDBMovie) => !!item.poster_path)
        .map((item: TMDBMovie) => mapTMDB(item, 'movie'));
    });
  }, [tmdbFetch, withLoading]);

  const fetchSeries = useCallback(async (page: number = 1, genreId?: string | number, countryCode?: string, sortBy: string = 'popularity.desc') => {
    return withLoading(async () => {
      const params: any = { page, sort_by: sortBy };
      if (sortBy === 'vote_average.desc') {
        params['vote_count.gte'] = 150;
      } else if (countryCode) {
        params.with_origin_country = countryCode;
        params['vote_count.gte'] = 3;
      }
      if (genreId) params.with_genres = genreId;
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
    const cacheKey = `movie_details_v2_${type}_${id}_${language}`;
    const cached = clientCache.get(cacheKey);
    if (cached) return cached;

    return withLoading(async () => {
      try {
        const data = await tmdbFetch(`/${type}/${id}`, { append_to_response: 'external_ids,credits,videos,release_dates,content_ratings', include_video_language: 'ru,en,null' });

        const result = mapTMDB(data, type === 'tv' ? 'series' : 'movie');
        clientCache.set(cacheKey, result, 86400); // 24 Hours TTL
        return result;
      } catch (err: any) {
        // Fallback: If 404 with movie type, try tv (series) type, and vice versa
        const altType = type === 'movie' ? 'tv' : 'movie';
        try {
          const altData = await tmdbFetch(`/${altType}/${id}`, { append_to_response: 'external_ids,credits,videos,release_dates,content_ratings', include_video_language: 'ru,en,null' });
          const altResult = mapTMDB(altData, altType === 'tv' ? 'series' : 'movie');
          const altCacheKey = `movie_details_v2_${altType}_${id}_${language}`;
          clientCache.set(altCacheKey, altResult, 86400);
          return altResult;
        } catch (_) {
          throw err;
        }
      }
    });
  }, [tmdbFetch, withLoading, language]);

  const fetchPersonDetails = useCallback(async (personId: string | number) => {
    const cacheKey = `person_details_v2_${personId}_${language}`;
    const cached = clientCache.get(cacheKey);
    if (cached) return cached;

    return withLoading(async () => {
      const data = await tmdbFetch(`/person/${personId}`, { append_to_response: 'movie_credits,tv_credits,external_ids' });

      const movieCast = data.movie_credits?.cast || [];
      const tvCast = data.tv_credits?.cast || [];
      const sourceList = movieCast.length >= 3 ? movieCast : [...movieCast, ...tvCast];

      const knownFor = sourceList
        .filter((item: any) => !!item.poster_path)
        .sort((a: any, b: any) => (b.vote_count || 0) - (a.vote_count || 0))
        .slice(0, 15)
        .map((item: any) => mapTMDB(item));

      const result = {
        id: data.id,
        name: data.name || '',
        biography: data.biography || '',
        birthday: data.birthday || '',
        place_of_birth: data.place_of_birth || '',
        profile_path: data.profile_path ? getTmdbImageUrl(data.profile_path, 'w300') : 'https://placehold.co/300x450/242f3d/ffffff?text=No+Photo',
        knownFor
      };
      clientCache.set(cacheKey, result, 86400); // 24 Hours TTL
      return result;
    });
  }, [tmdbFetch, withLoading, language]);

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
      return (data?.results || []).map((item: TMDBMovie) => mapTMDB(item, type === 'tv' ? 'series' : 'movie'));
    } catch (err: any) {
      console.error('TMDB API Error:', err);
      return [];
    }
  }, [tmdbFetch]);

  const fetchCategorizedHome = useCallback(async (type: 'movie' | 'tv', silent = false) => {
    const cacheKey = `categorized_home_v3_${type}_${language}`;
    const cached = clientCache.get(cacheKey);
    if (!silent && cached) {
      return cached;
    }

    const fetcher = async () => {
      // 1. High-Performance Primary: Single HTTP call to Cloudflare Edge Feed (cached 12h in KV)
      try {
        const cfFeedRes = await fetch(`${CF_API_BASE}/feed/home?type=${type}&lang=${encodeURIComponent(language)}`, {
          signal: AbortSignal.timeout(6000),
        });
        if (cfFeedRes.ok) {
          const feedData = await cfFeedRes.json() as { trending: any[]; genres: { id: string; name: string; genreId: string; rawResults: any[] }[] };
          if (Array.isArray(feedData?.trending) && Array.isArray(feedData?.genres) && feedData.genres.length > 0) {
            const trendingItems = feedData.trending.map((item: any) => mapTMDB(item, type === 'tv' ? 'series' : 'movie'));
            const genreSections = feedData.genres.map((g) => ({
              id: g.id,
              name: g.name,
              genreId: g.genreId,
              items: (g.rawResults || []).map((item: any) => mapTMDB(item, type === 'tv' ? 'series' : 'movie')),
            }));

            const sections = [
              { id: 'trending', name: language === 'ru-RU' ? 'Популярное' : 'Popular', genreId: '', items: trendingItems },
              ...genreSections.filter(s => s.items.length > 0)
            ];

            // Cache for 48 hours locally
            clientCache.set(cacheKey, sections, 172800);
            return sections;
          }
        }
      } catch (e) {
        console.warn('[HomeFeed] Cloudflare feed fallback triggered:', e);
      }

      // 2. Resilient Fallback: Local parallel assembly if Cloudflare feed is temporarily unavailable
      const trendingData = await tmdbFetch(`/trending/${type}/day`);
      const trendingItems = (trendingData.results || []).slice(0, 12).map((item: TMDBMovie) => mapTMDB(item, type === 'tv' ? 'series' : 'movie'));

      // Full list of ALL TMDB genres to build rich full home feed
      const genresToFetch = type === 'movie' ? [
        { id: 28, name: language === 'ru-RU' ? 'Боевики' : 'Action' },
        { id: 12, name: language === 'ru-RU' ? 'Приключения' : 'Adventure' },
        { id: 16, name: language === 'ru-RU' ? 'Мультфильмы' : 'Animation' },
        { id: 35, name: language === 'ru-RU' ? 'Комедии' : 'Comedy' },
        { id: 80, name: language === 'ru-RU' ? 'Криминал' : 'Crime' },
        { id: 99, name: language === 'ru-RU' ? 'Документальные' : 'Documentary' },
        { id: 18, name: language === 'ru-RU' ? 'Драмы' : 'Drama' },
        { id: 10751, name: language === 'ru-RU' ? 'Семейные' : 'Family' },
        { id: 14, name: language === 'ru-RU' ? 'Фэнтези' : 'Fantasy' },
        { id: 36, name: language === 'ru-RU' ? 'Исторические' : 'History' },
        { id: 27, name: language === 'ru-RU' ? 'Ужасы' : 'Horror' },
        { id: 10402, name: language === 'ru-RU' ? 'Музыкальные' : 'Music' },
        { id: 9648, name: language === 'ru-RU' ? 'Детективы' : 'Mystery' },
        { id: 10749, name: language === 'ru-RU' ? 'Мелодрамы' : 'Romance' },
        { id: 878, name: language === 'ru-RU' ? 'Фантастика' : 'Sci-Fi' },
        { id: 53, name: language === 'ru-RU' ? 'Триллеры' : 'Thriller' },
        { id: 10752, name: language === 'ru-RU' ? 'Военные' : 'War' },
        { id: 37, name: language === 'ru-RU' ? 'Вестерны' : 'Western' },
      ] : [
        { id: 10759, name: language === 'ru-RU' ? 'Боевики и Приключения' : 'Action & Adventure' },
        { id: 16, name: language === 'ru-RU' ? 'Мультсериалы' : 'Animation' },
        { id: 35, name: language === 'ru-RU' ? 'Комедии' : 'Comedy' },
        { id: 80, name: language === 'ru-RU' ? 'Криминал' : 'Crime' },
        { id: 99, name: language === 'ru-RU' ? 'Документальные' : 'Documentary' },
        { id: 18, name: language === 'ru-RU' ? 'Драмы' : 'Drama' },
        { id: 10751, name: language === 'ru-RU' ? 'Семейные' : 'Family' },
        { id: 10762, name: language === 'ru-RU' ? 'Детские' : 'Kids' },
        { id: 9648, name: language === 'ru-RU' ? 'Детективы' : 'Mystery' },
        { id: 10765, name: language === 'ru-RU' ? 'Фантастика и Фэнтези' : 'Sci-Fi & Fantasy' },
        { id: 10768, name: language === 'ru-RU' ? 'Война и Политика' : 'War & Politics' },
        { id: 37, name: language === 'ru-RU' ? 'Вестерны' : 'Western' },
      ];

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
          } catch (_) {
            return { id: String(g.id), name: g.name, genreId: String(g.id), items: [] };
          }
        })
      );

      const sections = [
        { id: 'trending', name: language === 'ru-RU' ? 'Популярное' : 'Popular', genreId: '', items: trendingItems },
        ...genreResults.filter(s => s.items.length > 0)
      ];

      clientCache.set(cacheKey, sections, 172800);
      return sections;
    };

    if (silent) {
      try {
        return await fetcher();
      } catch (_) {
        return cached || [];
      }
    }

    return withLoading(fetcher);
  }, [language, tmdbFetch, withLoading]);

  const fetchAdultSearch = useCallback(async (query: string, pageNum: number = 0) => {
    const cleanQuery = (query || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 120);
    if (!cleanQuery) return [];

    const cacheKey = `adult_search_${cleanQuery}_${pageNum}`;
    const cached = clientCache.get<any[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const initData = WebApp?.initData || '';
    const headers = { 
      'Authorization': `tma ${initData}`,
      'X-App-Client': 'mediabox-app',
      'X-Client-Time': String(Date.now()),
    };
    const res = await fetch(`${EXPRESS_API_BASE}/adult/search?q=${encodeURIComponent(cleanQuery)}&page=${pageNum}`, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
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
    const headers = { 
      'Authorization': `tma ${initData}`,
      'X-App-Client': 'mediabox-app',
      'X-Client-Time': String(Date.now()),
    };
    const res = await fetch(`${EXPRESS_API_BASE}/adult/details?id=${encodeURIComponent(id)}`, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    if (data) {
      clientCache.set(cacheKey, data, 3600);
    }
    return data;
  }, []);

  const fetchTrailerFeed = useCallback(async (page: number = 1): Promise<TrailerFeedItem[]> => {
    return withLoading(async () => {
      const cacheKey = `trailer_feed_v2_${page}_${language}`;
      const cached = clientCache.get(cacheKey) as TrailerFeedItem[] | undefined;
      if (cached && Array.isArray(cached) && cached.length > 0) {
        return cached;
      }

      // 1. Fetch trending items for this page
      const trendingData = await tmdbFetch('/trending/all/day', { page });
      const rawItems = (trendingData.results || []).filter((item: any) => item.media_type === 'movie' || item.media_type === 'tv');

      // 2. Fetch genres to build name dictionary
      const [movieGenres, tvGenres] = await Promise.all([
        fetchGenres('movie').catch(() => []),
        fetchGenres('tv').catch(() => [])
      ]);
      const genreMap = new Map<number, string>();
      movieGenres.forEach(g => genreMap.set(g.id, g.name));
      tvGenres.forEach(g => genreMap.set(g.id, g.name));

      // 3. Batch fetch videos for each item in parallel (Edge cached)
      const langCode = (language || 'ru-RU').split('-')[0].toLowerCase();
      const videoPromises = rawItems.map(async (item: any) => {
        try {
          const type = item.media_type === 'tv' ? 'tv' : 'movie';
          const vData = await tmdbFetch(`/${type}/${item.id}/videos`, {
            include_video_language: `${langCode},en,null`
          }, 86400);
          const videos = vData?.results || [];
          const ytVideos = videos.filter((v: any) => v.site === 'YouTube' && v.key);
          if (!ytVideos.length) return null;

          // Smart prioritization:
          // 1. Official studio trailer in user language (100% embeddable)
          // 2. Official studio trailer in English / original (100% embeddable, no 'watch on youtube' error)
          // 3. Official teaser in user language
          // 4. Official teaser
          // 5. Any official video
          // 6. Unofficial trailer (verified for embeddability via oEmbed)
          const candidates: any[] = [
            ...ytVideos.filter((v: any) => v.official && v.type === 'Trailer' && v.iso_639_1 === langCode),
            ...ytVideos.filter((v: any) => v.official && v.type === 'Trailer'),
            ...ytVideos.filter((v: any) => v.official && v.type === 'Teaser' && v.iso_639_1 === langCode),
            ...ytVideos.filter((v: any) => v.official && v.type === 'Teaser'),
            ...ytVideos.filter((v: any) => v.official),
            ...ytVideos.filter((v: any) => v.type === 'Trailer' && v.iso_639_1 === langCode),
            ...ytVideos.filter((v: any) => v.type === 'Trailer'),
            ...ytVideos
          ];

          // Deduplicate candidates by key while preserving order
          const seenKeys = new Set<string>();
          const uniqueCandidates = candidates.filter((c: any) => {
            if (!c?.key || seenKeys.has(c.key)) return false;
            seenKeys.add(c.key);
            return true;
          });

          let trailer: any = null;
          for (const c of uniqueCandidates) {
            // Official studio trailers from TMDB are guaranteed to allow 3rd party embedding
            if (c.official) {
              trailer = c;
              break;
            }
            // For unofficial fan uploads, verify embeddability to prevent "Watch on YouTube" errors
            try {
              const oe = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${c.key}&format=json`);
              if (oe.status === 200) {
                trailer = c;
                break;
              }
            } catch {
              // Ignore network check failure and continue to next candidate
            }
          }

          if (!trailer && uniqueCandidates.length > 0) {
            trailer = uniqueCandidates[0];
          }

          if (!trailer?.key) return null;

          const genres = (item.genre_ids || [])
            .map((gid: number) => genreMap.get(gid))
            .filter(Boolean)
            .slice(0, 3) as string[];

          const dateStr = item.release_date || item.first_air_date || '';
          const year = dateStr ? dateStr.split('-')[0] : '';

          return {
            id: item.id,
            mediaType: type as 'movie' | 'tv',
            title: item.title || item.name || item.original_title || item.original_name || 'Без названия',
            originalTitle: item.original_title || item.original_name || '',
            year,
            rating: Number((item.vote_average || 0).toFixed(1)),
            genreNames: genres,
            overview: item.overview || '',
            poster: item.poster_path ? getTmdbImageUrl(item.poster_path, 'w500') : '',
            backdrop: item.backdrop_path ? getTmdbImageUrl(item.backdrop_path, 'w1280') : (item.poster_path ? getTmdbImageUrl(item.poster_path, 'w500') : ''),
            trailerKey: trailer.key
          } as TrailerFeedItem;
        } catch {
          return null;
        }
      });

      const settled = await Promise.all(videoPromises);
      const result = settled.filter((item): item is TrailerFeedItem => item !== null);
      if (result.length > 0) {
        clientCache.set(cacheKey, result, 3600); // 1 hour client cache
      }
      return result;
    });
  }, [tmdbFetch, fetchGenres, language, withLoading]);

  return { request, fetchTrending, searchContent, fetchMovies, fetchSeries, fetchGenres, fetchMovieDetails, fetchPersonDetails, fetchSeasonDetails, fetchRecommendations, fetchCategorizedHome, fetchAdultSearch, fetchAdultStream, fetchTrailerFeed, loading, error };
}
