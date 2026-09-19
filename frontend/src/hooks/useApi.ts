import { useState, useCallback } from 'react';
import { WebApp } from '../telegram';
import { useLanguage } from '../context/LanguageContext';
import { clientCache } from '../utils/clientCache';
import { deduplicateMediaList } from '../utils/mediaUtils';

export const CF_API_BASE = import.meta.env.VITE_CF_API_BASE || 'https://api.media-box.xyz/api';
export const EXPRESS_API_BASE = import.meta.env.VITE_EXPRESS_API_BASE || 'https://evro90-nm6.hf.space/api';

// In-flight request deduplication map to prevent redundant parallel network calls
const inFlightRequests = new Map<string, Promise<any>>();

// TMDB Image helper (routed through Cloudflare Edge image proxy with 30d CDN cache & anti-blocking)
export const getTmdbImageUrl = (path: string | null | undefined, size: 'w185' | 'w342' | 'w780' = 'w342') => {
  if (!path) return '';
  const cleanPath = path.startsWith('/') ? path : '/' + path;
  return `${CF_API_BASE}/image?path=/t/p/${size}${cleanPath}`;
};

interface TMDBMovie {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  title_ru?: string;
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

  // Safeguard numbers-as-titles (e.g. "1917", "2012")
  if (/^\d{4}$/.test(normalized)) {
    return { title: normalized };
  }

  // 1. Year at the end: "title 2019", "title (2019)", "title [2019]", "title - 2019", "title 2019 года"
  const endYearMatch = normalized.match(/^(.*?)(?:[\s,/–-]+[\(\[\{]?(19\d\d|20\d\d)[\)\]\}]?(?:\s*(?:года|год|г\.|г))?)$/i);
  if (endYearMatch && endYearMatch[1].trim().length > 0) {
    const parsedYear = parseInt(endYearMatch[2], 10);
    if (parsedYear >= 1900 && parsedYear <= maxReleaseYear) {
      return { title: endYearMatch[1].trim(), year: String(parsedYear) };
    }
  }

  // 2. Year at the beginning: "2019 title"
  const startYearMatch = normalized.match(/^[\(\[\{]?(19\d\d|20\d\d)[\)\]\}]?[\s,/–-]+(.*?)$/);
  if (startYearMatch && startYearMatch[2].trim().length > 0) {
    const parsedYear = parseInt(startYearMatch[1], 10);
    if (parsedYear >= 1900 && parsedYear <= maxReleaseYear) {
      return { title: startYearMatch[2].trim(), year: String(parsedYear) };
    }
  }

  // 3. Year embedded anywhere: e.g. "игры с огнем 2019 с джоном синой"
  const embeddedYearMatch = normalized.match(/(?:^|[\s,\(\[\{])(19\d\d|20\d\d)(?:[\)\]\}]|(?:\s*(?:года|год|г\.|г))?(?:[\s,;\)]|$))/i);
  if (embeddedYearMatch) {
    const parsedYear = parseInt(embeddedYearMatch[1], 10);
    if (parsedYear >= 1900 && parsedYear <= maxReleaseYear) {
      const strippedTitle = normalized
        .replace(new RegExp(`(?:[\\(\\[\\{]?\\s*${parsedYear}\\s*[\\)\\]\\}]?(?:\\s*(?:года|год|г\\.|г))?)`, 'gi'), ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (strippedTitle.length > 0) {
        return { title: strippedTitle, year: String(parsedYear) };
      }
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

export function useApi() {
  const [loading, setLoading] = useState(false);
  const { language } = useLanguage();

  const withLoading = useCallback(async <T>(fn: () => Promise<T>): Promise<T> => {
    setLoading(true);
    try {
      return await fn();
    } catch (err: any) {
      console.error('API Error:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const tmdbFetch = useCallback(async (endpoint: string, params: Record<string, string | number> = {}, ttlSeconds: number = 3600, signal?: AbortSignal) => {
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
      let forwardAbort: (() => void) | undefined;
      try {
        if (signal?.aborted) {
          throw new DOMException('Request aborted', 'AbortError');
        }
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
        // Forward external cancellation (e.g. stale live-search) to both proxies
        forwardAbort = () => {
          try { cfCtrl.abort(); } catch (_) {}
          try { hfCtrl.abort(); } catch (_) {}
        };
        signal?.addEventListener('abort', forwardAbort, { once: true });

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

        // Hard ceiling: a blackholed network (no RST, hanging socket) must never
        // hang the UI forever — abort both proxies so this fetch always settles.
        const hardTimeoutId = setTimeout(() => {
          try { cfCtrl.abort(); } catch (_) {}
          try { hfCtrl.abort(); } catch (_) {}
        }, 12000);

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
        } catch (raceErr) {
          // External cancellation must not trigger a fresh network request
          if (signal?.aborted) throw raceErr;
          // Safety fallback with a bounded fresh signal (never hangs forever)
          const fallbackCtrl = new AbortController();
          const fallbackTimeout = setTimeout(() => {
            try { fallbackCtrl.abort(); } catch (_) {}
          }, 12000);
          try {
            data = await fetchViaHFProxy(fallbackCtrl.signal);
          } finally {
            clearTimeout(fallbackTimeout);
          }
        } finally {
          clearTimeout(hardTimeoutId);
        }

        if (forwardAbort) signal?.removeEventListener('abort', forwardAbort);
        if (data && !signal?.aborted) {
          clientCache.set(cacheKey, data, ttlSeconds);
        }
        return data;
      } catch (err) {
        if (forwardAbort) signal?.removeEventListener('abort', forwardAbort);
        if (signal?.aborted || (err as any)?.name === 'AbortError') {
          throw err;
        }
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

    // Resolve Russian title: from TMDB translations or localized title or item.title_ru
    const ruTrans = item.translations?.translations?.find((t: any) => t.iso_639_1 === 'ru');
    const titleRu = ruTrans?.data?.title || ruTrans?.data?.name || item.title_ru || (language === 'ru-RU' ? (item.title || item.name) : '') || '';

    return {
      id: item.id,
      title: item.title || item.name || item.original_title || 'Без названия',
      original_title: item.original_title || item.original_name || '',
      title_ru: titleRu,
      poster: item.poster_path 
        ? getTmdbImageUrl(item.poster_path, 'w342') 
        : (item.poster || 'https://placehold.co/300x450/242f3d/ffffff?text=No+Poster'),
      backdrop: item.backdrop_path ? getTmdbImageUrl(item.backdrop_path, 'w780') : '',
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
      liftw_id: item.liftw_id || null,
      last_episode_to_air: item.last_episode_to_air || null,
      next_episode_to_air: item.next_episode_to_air || null,
      status: item.status || '',
      number_of_episodes: item.number_of_episodes || 0,
      number_of_seasons: item.number_of_seasons || 0,
      isUpcoming
    };
  };

  const searchContent = useCallback(async (rawQuery: string, signal?: AbortSignal) => {
    const { title } = parseSearchQuery(rawQuery);
    const cleanTitle = title.slice(0, 120).trim();
    if (!cleanTitle) return [];
    if (signal?.aborted) return [];

    return withLoading(async () => {
      try {
        const url = `${CF_API_BASE}/search/liftw?q=${encodeURIComponent(cleanTitle)}`;
        const res = await fetch(url, { signal });
        if (!res.ok) return [];
        const data = await res.json() as { results?: any[] };
        const list = data?.results || [];

        if (signal?.aborted) {
          throw new DOMException('Search aborted', 'AbortError');
        }

        return list.map((item: any) => ({
          id: item.id,
          liftw_id: item.liftw_id,
          title: item.title || item.name,
          name: item.name || item.title,
          original_title: item.original_title || item.original_name || '',
          original_name: item.original_name || item.original_title || '',
          poster: item.poster || '',
          poster_path: null,
          year: String(item.year || ''),
          release_date: item.release_date || (item.year ? `${item.year}-01-01` : ''),
          rating: item.rating || 0,
          vote_average: item.vote_average || 0,
          media_type: item.media_type === 'tv' ? 'tv' : 'movie',
          type: item.type === 'series' ? 'series' : 'movie',
        }));
      } catch (err: any) {
        if (signal?.aborted) throw err;
        return [];
      }
    });
  }, [withLoading]);

  const fetchMovies = useCallback(async (page: number = 1, genreId?: string | number, sortBy: string = 'popularity.desc') => {
    return withLoading(async () => {
      const cacheKey = `catalog_list_v7_movie_${page}_${genreId || ''}_${sortBy}`;
      const cached = clientCache.get<any[]>(cacheKey);
      if (cached) return cached;

      try {
        const queryParams = new URLSearchParams({
          type: 'movie',
          page: String(page),
          genre: genreId ? String(genreId) : '',
          sort: sortBy,
        });
        const res = await fetch(`${CF_API_BASE}/catalog/list?${queryParams.toString()}`, {
          signal: AbortSignal.timeout(7000),
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            clientCache.set(cacheKey, data, 86400);
            return data;
          }
        }
      } catch (_) {}
      return [];
    });
  }, [withLoading]);

  const fetchSeries = useCallback(async (page: number = 1, genreId?: string | number, sortBy: string = 'popularity.desc') => {
    return withLoading(async () => {
      const cacheKey = `catalog_list_v7_tv_${page}_${genreId || ''}_${sortBy}`;
      const cached = clientCache.get<any[]>(cacheKey);
      if (cached) return cached;

      try {
        const queryParams = new URLSearchParams({
          type: 'tv',
          page: String(page),
          genre: genreId ? String(genreId) : '',
          sort: sortBy,
        });
        const res = await fetch(`${CF_API_BASE}/catalog/list?${queryParams.toString()}`, {
          signal: AbortSignal.timeout(7000),
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            clientCache.set(cacheKey, data, 86400);
            return data;
          }
        }
      } catch (_) {}
      return [];
    });
  }, [withLoading]);

  const fetchGenres = useCallback(async (type: 'movie' | 'tv'): Promise<Genre[]> => {
    try {
      const data = await tmdbFetch(`/genre/${type}/list`);
      return data.genres || [];
    } catch (err: any) {
      console.error('TMDB API Error:', err);
      return [];
    }
  }, [tmdbFetch]);

  const fetchMovieDetails = useCallback(async (id: string | number, type: 'movie' | 'tv'): Promise<any> => {
    const cacheKey = `movie_details_v2_${type}_${id}_${language}`;
    const cached = clientCache.get(cacheKey);
    if (cached) return cached;

    return withLoading(async () => {
      // 1. If ID is a Liftw ID (prefixed with liftw_)
      if (String(id).startsWith('liftw_')) {
        const liftwId = String(id).replace('liftw_', '');
        try {
          const liftwRes = await fetch(`${CF_API_BASE}/liftw?liftw_id=${encodeURIComponent(liftwId)}&type=${type}`);
          if (liftwRes.ok) {
            const lData = await liftwRes.json() as any;
            if (lData) {
              const cleanOrigin = (lData.origin_name || '').split('/')[0].replace(/\([^)]*\)/g, '').trim();
              const cleanRu = (lData.name || '').split('/')[0].replace(/\([^)]*\)/g, '').trim();
              const query = cleanOrigin || cleanRu;
              const year = lData.year || 0;

              const isTv = (lData.liftwType === 3 || lData.type === 3 || (lData.episodes && Object.keys(lData.episodes).length > 0));
              const resolvedType: 'movie' | 'tv' = isTv ? 'tv' : type;

              if (query) {
                try {
                  const searchRes = await tmdbFetch(`/search/${resolvedType}`, { query, ...(year > 0 ? { year } : {}) });
                  const bestMatch = searchRes?.results?.[0];
                  if (bestMatch?.id) {
                    const tmdbDetails = await fetchMovieDetails(bestMatch.id, resolvedType);
                    return { ...tmdbDetails, liftw_id: liftwId, episodes: lData.episodes || tmdbDetails.episodes };
                  }
                } catch (_) {}
              }

              const liftwTitle = (language !== 'ru-RU' && (lData.origin_name || lData.name))
                ? (lData.origin_name || lData.name)
                : lData.name;

              const liftwDetails = {
                id: `liftw_${liftwId}`,
                title: liftwTitle,
                name: liftwTitle,
                original_title: lData.origin_name || lData.name,
                poster: lData.poster || '',
                year: lData.year || '',
                release_date: lData.year ? `${lData.year}-01-01` : '',
                overview: lData.info?.description || '',
                rating: lData.info?.imdb_rating || lData.info?.kp_rating || 0,
                vote_average: lData.info?.imdb_rating || lData.info?.kp_rating || 0,
                genres: (lData.info?.genre || []).map((g: string, idx: number) => ({ id: idx, name: g })),
                cast: (lData.info?.actors || []).map((a: string, idx: number) => ({ id: idx, name: a })),
                directors: (lData.info?.director || []).map((d: string, idx: number) => ({ id: idx, name: d })),
                type: resolvedType === 'tv' ? 'series' : 'movie',
                isLiftwOnly: true,
                liftw_id: liftwId,
                iframe: lData.iframe,
                episodes: lData.episodes,
              };
              clientCache.set(cacheKey, liftwDetails, 86400);
              return liftwDetails;
            }
          }
        } catch (_) {}
      }

      try {
        const data = await tmdbFetch(`/${type}/${id}`, { append_to_response: 'external_ids,credits,videos,release_dates,content_ratings,translations', include_video_language: 'ru,en,null' });

        const result = mapTMDB(data, type === 'tv' ? 'series' : 'movie');
        clientCache.set(cacheKey, result, 86400); // 24 Hours TTL
        return result;
      } catch (err: any) {
        // Fallback: If 404 with movie type, try tv (series) type, and vice versa
        const altType = type === 'movie' ? 'tv' : 'movie';
        try {
          const altData = await tmdbFetch(`/${altType}/${id}`, { append_to_response: 'external_ids,credits,videos,release_dates,content_ratings,translations', include_video_language: 'ru,en,null' });
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
        profile_path: data.profile_path ? getTmdbImageUrl(data.profile_path, 'w185') : 'https://placehold.co/185x278/242f3d/ffffff?text=No+Photo',
        knownFor
      };
      clientCache.set(cacheKey, result, 86400); // 24 Hours TTL
      return result;
    });
  }, [tmdbFetch, withLoading, language]);

  const fetchSeasonDetails = useCallback(async (id: string | number, seasonNumber: number | string) => {
    // Liftw-native IDs (liftw_*) are invalid for TMDB — skip to avoid 404 waste
    if (String(id).startsWith('liftw_')) return null;
    const cacheKey = `tmdb_season_details_${id}_s${seasonNumber}_${language}`;
    const cached = clientCache.get(cacheKey);
    if (cached) return cached;
    try {
      const data = await tmdbFetch(`/tv/${id}/season/${seasonNumber}`);
      if (data) {
        clientCache.set(cacheKey, data, 86400);
      }
      return data;
    } catch (err: any) {
      console.error('TMDB API Error:', err);
      return null;
    }
  }, [tmdbFetch, language]);

  const fetchRecommendations = useCallback(async (id: string | number, type: 'movie' | 'tv', page: number = 1) => {
    // Liftw-native IDs (liftw_*) are invalid for TMDB — skip to avoid 404 waste
    if (String(id).startsWith('liftw_')) return [];
    try {
      const data = await tmdbFetch(`/${type}/${id}/recommendations`, { page });
      return (data?.results || []).map((item: TMDBMovie) => mapTMDB(item, type === 'tv' ? 'series' : 'movie'));
    } catch (err: any) {
      console.error('TMDB API Error:', err);
      return [];
    }
  }, [tmdbFetch]);

  const fetchCategorizedHome = useCallback(async (type: 'movie' | 'tv', silent = false) => {
    const cacheKey = `categorized_home_v7_${type}_${language}`;
    const cached = clientCache.get(cacheKey);
    if (!silent && cached) {
      return cached;
    }

    const fetcher = async () => {
      try {
        const cfFeedRes = await fetch(`${CF_API_BASE}/feed/home?type=${type}&lang=${encodeURIComponent(language)}&v=4`, {
          signal: AbortSignal.timeout(8000),
        });
        if (cfFeedRes.ok) {
          const feedData = await cfFeedRes.json() as { trending: any[]; genres: { id: string; name: string; genreId: string; rawResults: any[] }[] };
          if (Array.isArray(feedData?.trending) && Array.isArray(feedData?.genres) && feedData.genres.length > 0) {
            const trendingItems = deduplicateMediaList(feedData.trending);
            const genreSections = feedData.genres.map((g) => ({
              id: g.id,
              name: g.name,
              genreId: g.genreId,
              items: deduplicateMediaList(g.rawResults || []),
            }));

            const sections = [
              { id: 'trending', name: language === 'ru-RU' ? 'Популярное' : 'Popular', genreId: '', items: trendingItems },
              ...genreSections.filter(s => s.items.length > 0)
            ];

            clientCache.set(cacheKey, sections, 172800);
            return sections;
          }
        }
      } catch (e) {
        console.warn('[HomeFeed] Cloudflare feed request failed:', e);
      }

      return (cached as any[]) || [];
    };

    if (silent) {
      try {
        return await fetcher();
      } catch (_) {
        return cached || [];
      }
    }

    return withLoading(fetcher);
  }, [language, withLoading]);

  const fetchAdditionalCategories = useCallback(async (type: 'movie' | 'tv', existingGenreIds: string[], count: number = 4) => {
    try {
      const allGenres = await fetchGenres(type);
      if (!Array.isArray(allGenres) || allGenres.length === 0) return [];

      const existingSet = new Set(existingGenreIds.map(String));
      const candidates = allGenres.filter(g => !existingSet.has(String(g.id))).slice(0, count);
      if (candidates.length === 0) return [];

      const results = await Promise.all(
        candidates.map(async (g) => {
          try {
            const queryParams = new URLSearchParams({
              type: type === 'movie' ? 'movie' : 'tv',
              genre: String(g.id),
              page: '1',
              limit: '12',
            });
            const res = await fetch(`${CF_API_BASE}/catalog/list?${queryParams.toString()}`, {
              signal: AbortSignal.timeout(6000),
            });
            if (res.ok) {
              const data = await res.json();
              if (Array.isArray(data) && data.length > 0) {
                const mapped = deduplicateMediaList(data);
                return {
                  id: String(g.id),
                  name: g.name,
                  genreId: String(g.id),
                  items: mapped
                };
              }
            }
            return { id: String(g.id), name: g.name, genreId: String(g.id), items: [] };
          } catch (_) {
            return { id: String(g.id), name: g.name, genreId: String(g.id), items: [] };
          }
        })
      );

      return results.filter(s => s.items && s.items.length > 0);
    } catch (e) {
      console.error('Failed to fetch additional categories:', e);
      return [];
    }
  }, [fetchGenres]);

  const fetchAdultSearch = useCallback(async (query: string, pageNum: number = 0) => {
    const cleanQuery = ((query || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 120)) || 'popular';

    const cacheKey = `adult_search_${cleanQuery}_${pageNum}`;
    const cached = clientCache.get<any[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // 1. Direct fast-path: Query Eporner open CDN API (CORS *, 100% uptime, zero 503)
    try {
      const epUrl = `https://www.eporner.com/api/v2/video/search/?query=${encodeURIComponent(cleanQuery)}&per_page=30&page=${pageNum + 1}&thumbsize=medium&format=json`;
      const epRes = await fetch(epUrl, { signal: AbortSignal.timeout(4500) });
      if (epRes.ok) {
        const epData = await epRes.json() as any;
        if (epData && Array.isArray(epData.videos) && epData.videos.length > 0) {
          const results = epData.videos.map((v: any) => {
            let duration = v.length_min || '';
            if (duration && !duration.includes('min') && !duration.includes(':')) {
              duration += ' min';
            }
            return {
              id: `ep_${v.id}`,
              title: v.title,
              poster: v.default_thumb?.src || (Array.isArray(v.thumbs) && v.thumbs[0]?.src) || '',
              duration,
              type: 'adult',
              isAdult: true,
              href: v.url
            };
          });
          clientCache.set(cacheKey, results, 3600);
          return results;
        }
      }
    } catch (_) {}

    // 2. Secondary fallback: Express / Go backend
    try {
      const initData = WebApp?.initData || '';
      const headers = { 
        'Authorization': `tma ${initData}`,
        'X-App-Client': 'mediabox-app',
        'X-Client-Time': String(Date.now()),
      };
      const res = await fetch(`${EXPRESS_API_BASE}/adult/search?q=${encodeURIComponent(cleanQuery)}&page=${pageNum}`, { 
        headers,
        signal: AbortSignal.timeout(4500)
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          clientCache.set(cacheKey, data, 3600);
          return data;
        }
      }
    } catch (_) {}

    return [];
  }, []);

  const fetchAdultStream = useCallback(async (id: string) => {
    const cacheKey = `adult_stream_${id}`;
    const cached = clientCache.get<any>(cacheKey);
    if (cached) {
      return cached;
    }

    // 1. Direct client embed generation for Eporner (ep_) and Redtube (rt_)
    if (id.startsWith('ep_')) {
      const epID = id.replace('ep_', '');
      const embedUrl = `https://www.eporner.com/embed/${epID}/`;
      const streamData = {
        id,
        iframe: embedUrl,
        mirrors: [embedUrl],
        title: 'Video',
        type: 'adult'
      };
      clientCache.set(cacheKey, streamData, 3600);
      return streamData;
    }

    if (id.startsWith('rt_')) {
      const rtID = id.replace('rt_', '');
      const embedUrl = `https://embed.redtube.com/?id=${rtID}`;
      const streamData = {
        id,
        iframe: embedUrl,
        mirrors: [embedUrl],
        title: 'Video',
        type: 'adult'
      };
      clientCache.set(cacheKey, streamData, 3600);
      return streamData;
    }

    // 2. Secondary fallback: Go backend details API
    try {
      const initData = WebApp?.initData || '';
      const headers = { 
        'Authorization': `tma ${initData}`,
        'X-App-Client': 'mediabox-app',
        'X-Client-Time': String(Date.now()),
      };
      const res = await fetch(`${EXPRESS_API_BASE}/adult/details?id=${encodeURIComponent(id)}`, { 
        headers,
        signal: AbortSignal.timeout(4500)
      });
      if (res.ok) {
        const data = await res.json();
        if (data) {
          clientCache.set(cacheKey, data, 3600);
          return data;
        }
      }
    } catch (_) {}

    return null;
  }, []);

  const fetchTrailerFeed = useCallback(async (page: number = 1): Promise<TrailerFeedItem[]> => {
    return withLoading(async () => {
      const cacheKey = `trailer_feed_v4_${page}_${language}`;
      const cached = clientCache.get(cacheKey) as TrailerFeedItem[] | undefined;
      if (cached && Array.isArray(cached) && cached.length > 0) {
        return cached;
      }

      // Single aggregated request to backend (replaces 23 individual TMDB calls)
      const res = await fetch(
        `${CF_API_BASE}/feed/trailers?page=${page}&lang=${encodeURIComponent(language)}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) {
        console.warn('[TrailerFeed] Backend aggregation failed:', res.status);
        return [];
      }

      const result = (await res.json()) as TrailerFeedItem[];
      if (Array.isArray(result) && result.length > 0) {
        clientCache.set(cacheKey, result, 3600); // 1 hour client cache
      }
      return result;
    });
  }, [language, withLoading]);

  return { searchContent, fetchMovies, fetchSeries, fetchGenres, fetchMovieDetails, fetchPersonDetails, fetchSeasonDetails, fetchRecommendations, fetchCategorizedHome, fetchAdditionalCategories, fetchAdultSearch, fetchAdultStream, fetchTrailerFeed, loading };
}
