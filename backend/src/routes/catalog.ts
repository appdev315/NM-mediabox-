import { Hono, Context } from "hono";
import type { AppEnv, Bindings } from "../types";
import { safeWaitUntil, getTmdbKey, edgeCacheKey } from "../utils/helpers";
import { LIFTW_HEADERS, mapLiftwItem, isRussianOrigin, isNonRussianLang } from "./movies";

export const catalogRouter = new Hono<AppEnv>();

catalogRouter.get('/api/tmdb/*', async (c: Context) => {
  const url = new URL(c.req.url);
  // Extract endpoint path after /api/tmdb
  const endpoint = url.pathname.replace(/^\/api\/tmdb/, '');
  if (!endpoint || endpoint === '/') {
    return c.json({ error: 'Endpoint required' }, 400);
  }

  // Whitelist public read-only TMDB endpoints to prevent quota abuse
  const allowedPrefixes = ['/movie/', '/tv/', '/search/', '/genre/', '/trending/', '/person/', '/collection/', '/discover/', '/configuration'];
  const isAllowed = endpoint === '/configuration' || allowedPrefixes.some((p) => endpoint === p || endpoint.startsWith(p));
  if (!isAllowed) {
    return c.json({ error: 'Endpoint not allowed' }, 403);
  }

  // Защита от перегрузки URL (RFC 7230 / защита Edge от 414 URI Too Long)
  if (url.search.length > 2048) {
    return c.json({ error: 'Query too long' }, 400);
  }

  // Обрезка слишком длинных поисковых запросов до лимита TMDB (150 символов)
  const searchQuery = url.searchParams.get('query');
  if (searchQuery && searchQuery.length > 150) {
    url.searchParams.set('query', searchQuery.slice(0, 150));
  }

  // Check Cloudflare Edge Cache API for instant response
  const cache = (caches as any).default;
  const cacheKey = new Request(c.req.url, { method: 'GET' });
  let cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) {
    return cachedResponse;
  }

  const TMDB_KEY = getTmdbKey(c);
  const tmdbUrl = new URL(`https://api.themoviedb.org/3${endpoint}`);
  url.searchParams.forEach((val, key) => {
    if (key !== 'api_key') {
      tmdbUrl.searchParams.set(key, val);
    }
  });
  tmdbUrl.searchParams.set('api_key', TMDB_KEY);

  try {
    const res = await fetch(tmdbUrl.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'MediaBox-Edge/1.0',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return c.json({ error: `TMDB API error: ${res.status}` }, res.status as any);
    }

    const data = await res.json();
    const ttl = endpoint.includes('/trending/') ? 1800 : 7200;
    const response = new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${ttl}, s-maxage=${ttl * 2}`,
        'Access-Control-Allow-Origin': '*',
      },
    });

    safeWaitUntil(c, cache.put(cacheKey, response.clone()));
    return response;
  } catch (err: any) {
    return c.json({ error: err?.message || 'Failed to fetch from TMDB' }, 502);
  }
});

// --- HIGH-PERFORMANCE LIFTW CATALOG & HOME FEED ---
const GENRE_ID_TO_LIFTW: Record<string, string> = {
  '28': 'Боевик',
  '12': 'Приключения',
  '16': 'Мультфильм',
  '35': 'Комедия',
  '80': 'Криминал',
  '99': 'Документальный',
  '18': 'Драма',
  '10751': 'Семейный',
  '14': 'Фэнтези',
  '36': 'История',
  '27': 'Ужасы',
  '10402': 'Музыка',
  '9648': 'Детектив',
  '10749': 'Мелодрама',
  '878': 'Фантастика',
  '10770': 'Телефильм',
  '53': 'Триллер',
  '10752': 'Военный',
  '37': 'Вестерн',
  '10759': 'Боевик',
  '10762': 'Детский',
  '10763': 'Новости',
  '10764': 'Реалити-шоу',
  '10765': 'Фантастика',
  '10766': 'Мыльная опера',
  '10767': 'Ток-шоу',
  '10768': 'Военный',
};

// --- AGGREGATED TRAILER FEED (replaces 23 client-side TMDB requests with 1 server-side batch) ---
catalogRouter.get('/api/feed/trailers', async (c: Context) => {
  const lang = c.req.query('lang') || 'ru-RU';
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);

  const edgeCache = (caches as any).default;
  const cacheReq = edgeCacheKey(c);

  try {
    const cachedResponse = await edgeCache.match(cacheReq);
    if (cachedResponse) return cachedResponse;
  } catch (_) {}

  const TMDB_KEY = getTmdbKey(c);
  if (!TMDB_KEY) {
    return c.json({ error: 'TMDB API key not configured' }, 500);
  }

  const langCode = lang.split('-')[0].toLowerCase();

  try {
    // 1. Fetch trending + genre lists in parallel (2 TMDB requests)
    const [trendingData, movieGenres, tvGenres] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/trending/all/day?api_key=${TMDB_KEY}&language=${encodeURIComponent(lang)}&page=${page}`, {
        signal: AbortSignal.timeout(6000),
        cf: { cacheTtl: 1800, cacheEverything: true },
      } as any).then(r => r.ok ? r.json() as Promise<any> : { results: [] }).catch(() => ({ results: [] })),
      fetch(`https://api.themoviedb.org/3/genre/movie/list?api_key=${TMDB_KEY}&language=${encodeURIComponent(lang)}`, {
        signal: AbortSignal.timeout(4000),
        cf: { cacheTtl: 86400, cacheEverything: true },
      } as any).then(r => r.ok ? r.json() as Promise<any> : { genres: [] }).catch(() => ({ genres: [] })),
      fetch(`https://api.themoviedb.org/3/genre/tv/list?api_key=${TMDB_KEY}&language=${encodeURIComponent(lang)}`, {
        signal: AbortSignal.timeout(4000),
        cf: { cacheTtl: 86400, cacheEverything: true },
      } as any).then(r => r.ok ? r.json() as Promise<any> : { genres: [] }).catch(() => ({ genres: [] })),
    ]);

    const genreMap = new Map<number, string>();
    for (const g of (movieGenres.genres || [])) genreMap.set(g.id, g.name);
    for (const g of (tvGenres.genres || [])) genreMap.set(g.id, g.name);

    const rawItems = ((trendingData.results || []) as any[]).filter(
      (item: any) => item.media_type === 'movie' || item.media_type === 'tv'
    );

    // 2. Batch fetch video keys for all items in parallel (~20 TMDB requests, but server-side and cached)
    const videoPromises = rawItems.map(async (item: any) => {
      try {
        const type = item.media_type === 'tv' ? 'tv' : 'movie';
        const vRes = await fetch(
          `https://api.themoviedb.org/3/${type}/${item.id}/videos?api_key=${TMDB_KEY}&include_video_language=${langCode},en,null`,
          {
            signal: AbortSignal.timeout(5000),
            cf: { cacheTtl: 86400, cacheEverything: true },
          } as any
        );
        if (!vRes.ok) return null;
        const vData = await vRes.json() as any;
        const videos = (vData?.results || []) as any[];
        const BLOCKED_YOUTUBE_KEYS = new Set(['m5keZCmBdtI']);
        const ytVideos = videos.filter((v: any) => v.site === 'YouTube' && v.key && !BLOCKED_YOUTUBE_KEYS.has(v.key));
        if (!ytVideos.length) return null;

        // Language-first trailer selection
        const trailer =
          ytVideos.find((v: any) => v.official && v.type === 'Trailer' && v.iso_639_1 === langCode) ||
          ytVideos.find((v: any) => v.type === 'Trailer' && v.iso_639_1 === langCode) ||
          ytVideos.find((v: any) => v.official && v.type === 'Teaser' && v.iso_639_1 === langCode) ||
          ytVideos.find((v: any) => v.type === 'Teaser' && v.iso_639_1 === langCode) ||
          ytVideos.find((v: any) => v.iso_639_1 === langCode) ||
          ytVideos.find((v: any) => v.official && v.type === 'Trailer') ||
          ytVideos.find((v: any) => v.type === 'Trailer') ||
          ytVideos.find((v: any) => v.official && v.type === 'Teaser') ||
          ytVideos.find((v: any) => v.type === 'Teaser') ||
          ytVideos[0];

        if (!trailer?.key) return null;

        const genres = (item.genre_ids || [])
          .map((gid: number) => genreMap.get(gid))
          .filter(Boolean)
          .slice(0, 3);

        const dateStr = item.release_date || item.first_air_date || '';
        const year = dateStr ? dateStr.split('-')[0] : '';

        const imgProxy = new URL(c.req.url).origin + '/api/image?path=';
        return {
          id: item.id,
          mediaType: type,
          title: item.title || item.name || item.original_title || item.original_name || 'Без названия',
          originalTitle: item.original_title || item.original_name || '',
          original_language: item.original_language || '',
          year,
          rating: Number((item.vote_average || 0).toFixed(1)),
          genreNames: genres,
          overview: item.overview || '',
          poster: item.poster_path ? `${imgProxy}/t/p/w342${item.poster_path}` : '',
          backdrop: item.backdrop_path ? `${imgProxy}/t/p/w780${item.backdrop_path}` : (item.poster_path ? `${imgProxy}/t/p/w342${item.poster_path}` : ''),
          trailerKey: trailer.key,
        };
      } catch (_) {
        return null;
      }
    });

    const settled = await Promise.all(videoPromises);
    const result = settled
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .filter((item) => !isNonRussianLang(lang) || !isRussianOrigin({ ...item, original_title: item.originalTitle }));

    const response = c.json(result, 200, {
      'Cache-Control': 'public, max-age=3600, s-maxage=7200',
      'Access-Control-Allow-Origin': '*',
    });

    try {
      safeWaitUntil(c, edgeCache.put(cacheReq, response.clone()));
    } catch (_) {}

    return response;
  } catch (err: any) {
    return c.json({ error: err?.message || 'Failed to build trailer feed' }, 500);
  }
});

catalogRouter.get('/api/feed/home', async (c: Context) => {
  const type = (c.req.query('type') === 'tv' ? 'tv' : 'movie');
  const lang = c.req.query('lang') || 'ru-RU';
  const edgeCache = (caches as any).default;
  const cacheReq = edgeCacheKey(c);

  try {
    const cachedResponse = await edgeCache.match(cacheReq);
    if (cachedResponse) {
      return cachedResponse;
    }
  } catch (_) {}

  const isTv = type === 'tv';
  const liftwType = isTv ? 'serial' : 'film';
  const liftwCategory = isTv ? 'series' : 'films';

  const hideDomestic = isNonRussianLang(lang);

  try {
    const dramaTitle = lang.startsWith('id') ? 'Drakor & Drama Asia' : (lang.startsWith('ru') ? 'Дорамы' : 'Asian Dramas');
    const genreCategories: any[] = isTv ? [
      { id: 'dramas', name: dramaTitle, isDrama: true },
      { id: '10759', name: lang.startsWith('ru') ? 'Боевики и Приключения' : 'Action & Adventure', liftwGenre: 'Боевик' },
      { id: '35', name: lang.startsWith('ru') ? 'Комедии' : 'Comedy', liftwGenre: 'Комедия' },
      { id: '18', name: lang.startsWith('ru') ? 'Драмы' : 'Drama', liftwGenre: 'Драма' },
      { id: '53', name: lang.startsWith('ru') ? 'Триллеры' : 'Thriller', liftwGenre: 'Триллер' },
      { id: '10765', name: lang.startsWith('ru') ? 'Фантастика и Фэнтези' : 'Sci-Fi & Fantasy', liftwGenre: 'Фантастика' },
      { id: '16', name: lang.startsWith('ru') ? 'Мультсериалы' : 'Animation', liftwGenre: 'Мультфильм' },
    ] : [
      { id: '28', name: lang.startsWith('ru') ? 'Боевики' : 'Action', liftwGenre: 'Боевик' },
      { id: '35', name: lang.startsWith('ru') ? 'Комедии' : 'Comedy', liftwGenre: 'Комедия' },
      { id: '18', name: lang.startsWith('ru') ? 'Драмы' : 'Drama', liftwGenre: 'Драма' },
      { id: '53', name: lang.startsWith('ru') ? 'Триллеры' : 'Thriller', liftwGenre: 'Триллер' },
      { id: '878', name: lang.startsWith('ru') ? 'Фантастика' : 'Sci-Fi', liftwGenre: 'Фантастика' },
      { id: '16', name: lang.startsWith('ru') ? 'Мультфильмы' : 'Animation', liftwGenre: 'Мультфильм' },
    ];

    const genrePromises = genreCategories.map(async (cat) => {
      try {
        if (cat.isDrama) {
          const tmdbKey = getTmdbKey(c);
          const tmdbLang = lang.startsWith('id') ? 'id-ID' : (lang.startsWith('ru') ? 'ru-RU' : 'en-US');
          const origin = new URL(c.req.url).origin;
          const tmdbRes = await fetch(`https://api.themoviedb.org/3/discover/tv?api_key=${tmdbKey}&with_origin_country=KR|CN|TH&with_genres=18|10749&sort_by=popularity.desc&page=1&language=${tmdbLang}`, {
            signal: AbortSignal.timeout(4500),
          });
          if (tmdbRes.ok) {
            const tData = await tmdbRes.json() as any;
            const items = (tData?.results || []).slice(0, 14).map((it: any) => ({
              id: it.id,
              name: it.name || it.original_name,
              title: it.name || it.original_name,
              original_name: it.original_name || it.name,
              original_title: it.original_name || it.name,
              poster: it.poster_path ? `${origin}/api/image?path=/t/p/w342${it.poster_path}` : '',
              poster_path: it.poster_path,
              backdrop_path: it.backdrop_path,
              rating: Number((it.vote_average || 0).toFixed(1)),
              vote_average: Number((it.vote_average || 0).toFixed(1)),
              release_date: it.first_air_date || '',
              year: it.first_air_date ? it.first_air_date.split('-')[0] : '',
              type: 'series',
              media_type: 'tv',
              isDrama: true,
              origin_country: it.origin_country || ['KR'],
            }));
            return {
              id: cat.id,
              name: cat.name,
              genreId: cat.id,
              rawResults: items,
            };
          }
          return null;
        }

        const res = await fetch(`https://api.liftw.ws/list/categories?category=${liftwCategory}&genre=${encodeURIComponent(cat.liftwGenre)}&page=1&limit=24&sort=popular`, {
          headers: LIFTW_HEADERS,
          signal: AbortSignal.timeout(4500),
        });
        if (!res.ok) return null;
        const data = await res.json() as any[];
        if (!Array.isArray(data) || data.length === 0) return null;
        const items = data
          .map(item => mapLiftwItem(item, isTv))
          .filter(Boolean)
          .filter((it: any) => !hideDomestic || !isRussianOrigin(it))
          .slice(0, 14);
        return {
          id: cat.id,
          name: cat.name,
          genreId: cat.id,
          rawResults: items,
        };
      } catch (_) {
        return null;
      }
    });

    const [trendingRes, ...genreResults] = await Promise.all([
      fetch(`https://api.liftw.ws/list?type=${liftwType}&last=true&limit=${hideDomestic ? 32 : 16}`, {
        headers: LIFTW_HEADERS,
        signal: AbortSignal.timeout(4500),
      }).then(r => r.ok ? r.json() as Promise<any[]> : []).catch(() => []),
      ...genrePromises,
    ]);

    const trendingItems = Array.isArray(trendingRes)
      ? trendingRes
        .map(item => mapLiftwItem(item, isTv))
        .filter(Boolean)
        .filter((it: any) => !hideDomestic || !isRussianOrigin(it))
        .slice(0, 16)
      : [];

    const validGenres = genreResults.filter((g): g is NonNullable<typeof g> => !!g && g.rawResults.length > 0);

    const payload = {
      trending: trendingItems,
      genres: validGenres,
    };

    const isFullPayload = trendingItems.length > 0 && validGenres.length >= 4;

    const response = c.json(payload, 200, {
      'Cache-Control': isFullPayload
        ? 'public, max-age=1800, s-maxage=43200'
        : 'public, max-age=60, s-maxage=120',
    });

    try {
      // Guard: Only cache in Edge if response is full (trending present and >= 4 genres loaded).
      // Degraded/partial payload is never locked into Edge cache for 12 hours.
      if (isFullPayload) {
        safeWaitUntil(c, edgeCache.put(cacheReq, response.clone()));
      }
    } catch (_) {}

    return response;
  } catch (err: any) {
    return c.json({ error: err?.message || 'failed to load home feed' }, 500);
  }
});

// --- PURE LIFTW CATALOG LIST (PAGINATION, GENRES, IN-STOCK ONLY) ---
catalogRouter.get('/api/catalog/list', async (c: Context) => {
  const typeParam = c.req.query('type') || 'movie';
  const isTv = typeParam === 'tv' || typeParam === 'series' || typeParam === 'serial';
  const liftwType = isTv ? 'serial' : 'film';
  const liftwCategory = isTv ? 'series' : 'films';
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
  const limit = Math.min(30, Math.max(1, parseInt(c.req.query('limit') || '20', 10) || 20));
  const genreParam = c.req.query('genre') || '';
  const sortBy = c.req.query('sort') || c.req.query('sortBy') || 'popularity.desc';
  const lang = c.req.query('lang') || 'ru-RU';
  const hideDomestic = isNonRussianLang(lang);
  // Overfetch for non-Russian UIs so rows stay full after domestic filtering.
  // Edge cache splits by full URL, so lang-specific responses never mix.
  const fetchLimit = hideDomestic ? Math.min(30, limit * 2) : limit;

  const edgeCache = (caches as any).default;
  const cacheReq = edgeCacheKey(c);

  try {
    const cachedResponse = await edgeCache.match(cacheReq);
    if (cachedResponse) return cachedResponse;
  } catch (_) {}

  if (genreParam === 'dramas' || genreParam === 'kdrama' || genreParam === 'asian_drama') {
    const tmdbKey = getTmdbKey(c);
    const tmdbLang = lang.startsWith('id') ? 'id-ID' : (lang.startsWith('ru') ? 'ru-RU' : 'en-US');
    const origin = new URL(c.req.url).origin;
    try {
      const tmdbRes = await fetch(`https://api.themoviedb.org/3/discover/tv?api_key=${tmdbKey}&with_origin_country=KR|CN|TH&with_genres=18|10749&sort_by=popularity.desc&page=${page}&language=${tmdbLang}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (tmdbRes.ok) {
        const tData = await tmdbRes.json() as any;
        const items = (tData?.results || []).slice(0, limit).map((it: any) => ({
          id: it.id,
          name: it.name || it.original_name,
          title: it.name || it.original_name,
          original_name: it.original_name || it.name,
          original_title: it.original_name || it.name,
          poster: it.poster_path ? `${origin}/api/image?path=/t/p/w342${it.poster_path}` : '',
          poster_path: it.poster_path,
          backdrop_path: it.backdrop_path,
          rating: Number((it.vote_average || 0).toFixed(1)),
          vote_average: Number((it.vote_average || 0).toFixed(1)),
          release_date: it.first_air_date || '',
          year: it.first_air_date ? it.first_air_date.split('-')[0] : '',
          type: 'series',
          media_type: 'tv',
          isDrama: true,
          origin_country: it.origin_country || ['KR'],
        }));
        const response = c.json(items, 200, {
          'Cache-Control': 'public, max-age=1800, s-maxage=43200',
          'Access-Control-Allow-Origin': '*',
        });
        try {
          safeWaitUntil(c, edgeCache.put(cacheReq, response.clone()));
        } catch (_) {}
        return response;
      }
    } catch (_) {}
  }

  let targetGenre = '';
  if (genreParam && genreParam !== 'trending' && genreParam !== 'all') {
    targetGenre = GENRE_ID_TO_LIFTW[genreParam] || genreParam;
  }

  let liftwUrl = '';
  if (targetGenre) {
    liftwUrl = `https://api.liftw.ws/list/categories?category=${liftwCategory}&genre=${encodeURIComponent(targetGenre)}&page=${page}&limit=${fetchLimit}&sort=popular`;
  } else if (sortBy.includes('date') || sortBy.includes('new') || genreParam === 'trending') {
    liftwUrl = `https://api.liftw.ws/list?type=${liftwType}&page=${page}&limit=${fetchLimit}&last=true`;
  } else {
    liftwUrl = `https://api.liftw.ws/list/categories?category=${liftwCategory}&page=${page}&limit=${fetchLimit}&sort=popular`;
  }

  try {
    const res = await fetch(liftwUrl, {
      headers: LIFTW_HEADERS,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return c.json([], 200);
    }
    const data = await res.json() as any[];
    if (!Array.isArray(data)) {
      return c.json([], 200);
    }

    const items = data
      .map(item => mapLiftwItem(item, isTv))
      .filter(Boolean)
      .filter((it: any) => !hideDomestic || !isRussianOrigin(it))
      .slice(0, limit);

    const response = c.json(items, 200, {
      'Cache-Control': 'public, max-age=1800, s-maxage=43200',
      'Access-Control-Allow-Origin': '*',
    });

    try {
      safeWaitUntil(c, edgeCache.put(cacheReq, response.clone()));
    } catch (_) {}

    return response;
  } catch (_) {
    return c.json([], 200);
  }
});

// --- ASIAN DRAMA / KISSKH ENDPOINTS (FMHY CATALOG) ---
catalogRouter.get('/api/dramas/search', async (c: Context) => {
  const query = (c.req.query('q') || '').trim();
  if (!query) return c.json([], 200);

  const edgeCache = (caches as any).default;
  const cacheReq = edgeCacheKey(c);
  try {
    const cached = await edgeCache.match(cacheReq);
    if (cached) return cached;
  } catch (_) {}

  try {
    const res = await fetch(`https://kisskh.co/api/DramaList/Search?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data = await res.json();
      const response = c.json(data, 200, {
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
        'Access-Control-Allow-Origin': '*',
      });
      try {
        safeWaitUntil(c, edgeCache.put(cacheReq, response.clone()));
      } catch (_) {}
      return response;
    }
  } catch (_) {}
  return c.json([], 200);
});
