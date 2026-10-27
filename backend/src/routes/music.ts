import { Hono, Context } from "hono";
import type { AppEnv } from "../types";
import { safeWaitUntil, edgeCacheKey } from "../utils/helpers";

export const musicRouter = new Hono<AppEnv>();

// --- SAAVN MIRROR PROXY & POOL CONFIGURATION ---
// Пул живых апстримов Saavn: исключен удаленный jiosaavn-api-amber (404 Deployment Not Found)
const SAAVN_DEFAULT_BASES = [
  'https://saavn-api-delta.vercel.app/api',
];

const saavnUpstreamBases = (c: Context): string[] => {
  const raw = (c.env as any)?.SAAVN_API_BASES;
  const configured = raw
    ? String(raw).split(',').map((s: string) => s.trim().replace(/\/+$/, '')).filter(Boolean)
    : [];
  return configured.length > 0 ? configured : SAAVN_DEFAULT_BASES;
};

// --- MUSIC PROXY & SEARCH (7-DAY EDGE CACHE, 100% FULL STREAMS, 0% 30S CUTS) ---
const handleMusicSearch = async (c: Context) => {
  const query = (c.req.query('q') || '').trim();
  // По умолчанию выдаём по 20 треков на страницу для быстрой первой отрисовки и плавной бесконечной ленты
  const page = Math.max(Number(c.req.query('page')) || 1, 1);
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 20, 10), 50);

  if (!query) {
    return c.json([], 200);
  }

  const edgeCache = (caches as any).default;
  const cacheReq = edgeCacheKey(c);
  try {
    const cached = await edgeCache.match(cacheReq);
    if (cached) return cached;
  } catch (_) {}

  try {
    const encoded = encodeURIComponent(query);
    const bases = saavnUpstreamBases(c);

    // Отказоустойчивый опрос пула зеркал JioSaavn с автоматическим перебором при сбое/таймауте
    const fetchFromSaavnPool = async (path: string, timeoutMs = 6000): Promise<Response | null> => {
      for (const base of bases) {
        try {
          const res = await fetch(`${base}${path}`, {
            headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (res.ok) return res;
        } catch (_) {}
      }
      return null;
    };

    // На первых 3-х страницах параллельно ищем совпадение по имени исполнителя (например, Rammstein -> id: 610801):
    // на 1-й странице подтягиваем verified Top Songs, а на 2-й и 3-й — дискографию альбомов/песен артиста (/artists/:id/songs?page=N)
    const artistSearchPromise = page <= 3
      ? fetchFromSaavnPool(`/search/artists?query=${encoded}&limit=3`, 5000)
      : Promise.resolve(null);

    // Запрашиваем оверсэмплинг у апстрима (40 треков), чтобы после отсечения дублей и сборников гарантированно отдать полные 20 уникальных треков
    const saavnLimit = Math.max(limit * 2, 40);
    const [saavnRes, ytRes, artistRes] = await Promise.allSettled([
      fetchFromSaavnPool(`/search/songs?query=${encoded}&page=${page}&limit=${saavnLimit}`, 6000),
      fetch(`https://api.ytify.workers.dev/search?q=${encoded}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(6000),
      }),
      artistSearchPromise
    ]);

    const rawTracks: any[] = [];
    const seenTitles = new Set<string>();
    const hasJapanese = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;

    // Регулярное выражение для отсечения немузыкального контента (шоу, стендапы, подкасты, интервью)
    const NON_MUSIC_REGEX = /\b(?:стендап|подкаст|podcast|standup|интервью|импров|шоу|выпуск|livestream|live\s*stream)\b/i;

    const addTrack = (t: any) => {
      if (!t || !t.id || !t.title) return;
      const dur = typeof t.duration === 'number' ? t.duration : (parseInt(t.duration, 10) || 0);
      // Порог длительности треков: максимум 10 минут (600 сек) и минимум 20 сек (отсекаем видео/подкасты и превью)
      if (dur > 600 || (dur > 0 && dur < 20)) return;

      const title = String(t.title || '').trim();
      let artist = String(t.artist || '').trim();
      // Отсеиваем видео-контент и разговорные шоу из музыкального раздела
      if (NON_MUSIC_REGEX.test(title) || NON_MUSIC_REGEX.test(artist) || NON_MUSIC_REGEX.test(String(t.album || ''))) return;

      if (!artist || artist.toLowerCase() === 'unknown artist') {
        artist = query.replace(/\b\w/g, (char) => char.toUpperCase());
        t.artist = artist;
      } else if (
        hasJapanese.test(artist) &&
        // Затираем запросом только полностью CJK-имена без единого латинского символа:
        // реальные артисты вида «RADWIMPS (ラッドウインプス)», «LiSA» или «久石譲 Joe Hisaishi»
        // не должны подменяться текстом поискового запроса.
        !/[a-z]/i.test(artist) &&
        !hasJapanese.test(query)
      ) {
        artist = query.replace(/\b\w/g, (char) => char.toUpperCase());
        t.artist = artist;
      }
      const normKey = `${artist.toLowerCase()} - ${title.toLowerCase().replace(/\([^)]*\)/g, '').trim()}`;
      if (!seenTitles.has(normKey)) {
        seenTitles.add(normKey);
        rawTracks.push(t);
      }
    };

// Словарь распространенных псевдонимов и транслитераций для точного поиска
const MUSIC_SEARCH_ALIASES: Record<string, string> = {
  'нагано': 'ноггано',
  'nagano': 'ноггано',
  'noggano': 'ноггано',
  'basta': 'баста',
};

// Интеллектуальный разбор метаданных YouTube Music: вычленение исполнителя и названия («Ноггано - Зять»)
const parseYtTrackInfo = (rawTitle: string, rawAuthor: string) => {
  let title = rawTitle;
  let artist = (rawAuthor || 'Unknown Artist').replace(/ - Topic$/i, '').trim();
  const splitMatch = rawTitle.match(/^([^\-–—]+)\s*[\-–—]\s*(.+)$/);
  if (splitMatch) {
    const candArtist = splitMatch[1].trim();
    const candTitle = splitMatch[2].trim();
    if (candArtist.length > 0 && candTitle.length > 0) {
      artist = candArtist;
      title = candTitle;
    }
  }
  return { title, artist };
};

    // 1. Топ-песни артиста (если запрос — это имя известного исполнителя)
    if (artistRes.status === 'fulfilled' && artistRes.value && artistRes.value.ok) {
      try {
        const aData = await artistRes.value.json() as any;
        const normQ = query.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
        const aliasNormQ = MUSIC_SEARCH_ALIASES[normQ] || normQ;
        const normArtistOf = (s: any) => String(s || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
        const artistCandidates: any[] = aData?.data?.results || [];
        // Строгое сопоставление артиста: полное совпадение имени или псевдонима (защита от «Наганов Александр»)
        const matchedArtist = artistCandidates.find((r: any) => {
          const na = normArtistOf(r?.name);
          return na === normQ || na === aliasNormQ;
        });

        if (matchedArtist?.id) {
          const songsPath = page === 1 ? `/artists?id=${matchedArtist.id}` : `/artists/${matchedArtist.id}/songs?page=${page}`;
          const songsRes = await fetchFromSaavnPool(songsPath, 5000);

          if (songsRes && songsRes.ok) {
            const songsData = await songsRes.json() as any;
            const topSongs = (page === 1 ? songsData?.data?.topSongs : songsData?.data?.songs) || songsData?.data?.topSongs || [];
            for (const s of topSongs) {
              const downloadUrls = s.downloadUrl || [];
              const downloadUrl = downloadUrls.find((u: any) => u.quality === '320kbps') || downloadUrls[downloadUrls.length - 1];
              const lowDownloadUrl = downloadUrls.find((u: any) => u.quality === '96kbps') || downloadUrls.find((u: any) => u.quality === '48kbps') || downloadUrl;
              const audioUrl = downloadUrl?.url || '';
              if (audioUrl) {
                const img = (s.image || []).find((i: any) => i.quality === '150x150') || (s.image || [])[0];
                addTrack({
                  id: `saavn_${s.id}`,
                  title: s.name || s.title || '',
                  artist: matchedArtist.name || 'Unknown Artist',
                  album: s.album?.name || '',
                  artworkUrl: img?.url || '',
                  audioUrl,
                  audioUrlLow: lowDownloadUrl?.url || '',
                  duration: typeof s.duration === 'number' ? s.duration : (parseInt(s.duration, 10) || 0),
                  genre: s.language || 'Music',
                  isResolved: true,
                  isOfficialArtistTop: true
                });
              }
            }
          }
        }
      } catch (_) {}
    }

    // 2. Результаты поиска JioSaavn (с защитой от null при падении всех зеркал пула)
    if (saavnRes.status === 'fulfilled' && saavnRes.value && saavnRes.value.ok) {
      try {
        const sData = await saavnRes.value.json() as any;
        for (const s of (sData?.data?.results || [])) {
          const downloadUrls = s.downloadUrl || [];
          const downloadUrl = downloadUrls.find((u: any) => u.quality === '320kbps') || downloadUrls[downloadUrls.length - 1];
          const lowDownloadUrl = downloadUrls.find((u: any) => u.quality === '96kbps') ||
                      downloadUrls.find((u: any) => u.quality === '48kbps') ||
                      downloadUrls.find((u: any) => u.quality === '160kbps') ||
                      downloadUrl;
          const audioUrl = downloadUrl?.url || '';
          if (audioUrl) {
            const img = (s.image || []).find((i: any) => i.quality === '150x150') ||
                        (s.image || []).find((i: any) => i.quality === '50x50') ||
                        (s.image || [])[0];
            const rawArtist = (s.artists?.primary || []).map((a: any) => a.name).filter(Boolean).join(', ') ||
                              (s.artists?.all || []).map((a: any) => a.name).filter(Boolean).join(', ') ||
                              s.primaryArtists || s.singers || '';
            addTrack({
              id: `saavn_${s.id}`,
              title: s.name || s.title || '',
              artist: rawArtist || 'Unknown Artist',
              album: s.album?.name || '',
              artworkUrl: img?.url || '',
              audioUrl,
              audioUrlLow: lowDownloadUrl?.url || '',
              duration: typeof s.duration === 'number' ? s.duration : (parseInt(s.duration, 10) || 0),
              genre: s.language || 'Music',
              isResolved: true,
            });
          }
        }
      } catch (_) {}
    }

    // 3. Результаты YouTube Music (с отделением исполнителя от названия)
    if (ytRes.status === 'fulfilled' && ytRes.value.ok) {
      try {
        const ytList = await ytRes.value.json() as any[];
        if (Array.isArray(ytList)) {
          const startIndex = (page - 1) * 15;
          const pageYt = ytList.slice(startIndex, startIndex + 25);
          for (const item of pageYt) {
            let dur = 0;
            if (typeof item.duration === 'string') {
              const parts = item.duration.split(':').map(Number);
              if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) dur = parts[0] * 60 + parts[1];
              else if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) dur = parts[0] * 3600 + parts[1] * 60 + parts[2];
            } else if (typeof item.lengthSeconds === 'number') {
              dur = item.lengthSeconds;
            }
            // Отсекаем немузыкальные ролики > 10 минут (600 сек) и короткие превью (< 20 сек)
            if (dur > 600 || (dur > 0 && dur < 20)) continue;
            if (NON_MUSIC_REGEX.test(item.title || '') || NON_MUSIC_REGEX.test(item.author || '')) continue;
            const cleanTitle = (item.title || '')
              .replace(/\s*\([^)]*(?:official|video|audio|lyric|remaster|explicit|edit|version)[^)]*\)/gi, '')
              .replace(/\s*\[[^\]]*(?:official|video|audio|lyric|remaster|explicit|edit|version)[^\]]*\]/gi, '')
              .trim();
            const parsedYt = parseYtTrackInfo(cleanTitle || item.title || '', item.author || '');
            addTrack({
              id: `yt_${item.id}`,
              title: parsedYt.title,
              artist: parsedYt.artist,
              album: 'YouTube Music',
              artworkUrl: `https://i.ytimg.com/vi/${item.id}/default.jpg`,
              audioUrl: '',
              duration: dur,
              genre: 'Music',
              isResolved: false,
            });
          }
        }
      } catch (_) {}
    }

    // --- УМНОЕ РАНЖИРОВАНИЕ РЕЛЕВАНТНОСТИ (Smart Relevance Scoring) ---
    // Исключает ситуацию, когда случайные каверы или сторонние альбомы вытесняют реального артиста
    const normQ = query.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
    const aliasNormQ = MUSIC_SEARCH_ALIASES[normQ] || normQ;
    const junkRe = /\b(?:8-bit|16-bit|emulation|tribute|karaoke|ringtone|remix|cover)\b/i;

    const scoredTracks = rawTracks.map(t => {
      let score = 0;
      const tArtist = (t.artist || '').toLowerCase();
      const normA = tArtist.replace(/[^a-z0-9а-яё]/gi, '');
      const tTitle = (t.title || '').toLowerCase();
      const normT = tTitle.replace(/[^a-z0-9а-яё]/gi, '');
      const tAlbum = (t.album || '').toLowerCase();
      const normAlb = tAlbum.replace(/[^a-z0-9а-яё]/gi, '');

      const isMatchArtist = (normA === normQ || normA === aliasNormQ);
      const isPartialArtist = (normA.startsWith(normQ) || normA.includes(normQ) ||
                               normA.startsWith(aliasNormQ) || normA.includes(aliasNormQ));

      if (t.isOfficialArtistTop) {
        score += 150; // Официальные хиты подтверждённого исполнителя всегда в самом верху
      }
      // Составные запросы «Артист + Трек» (например, "Rammstein Sonne"):
      const normBoth = `${normA}${normT}`;
      const normBothRev = `${normT}${normA}`;
      if (isMatchArtist) {
        score += 120; // Точное совпадение артиста (или псевдонима): приоритет над чужой песней с таким же названием
      } else if (isPartialArtist) {
        score += 80;
      }

      if (normT === normQ || normT === aliasNormQ) {
        score += 50; // Точное совпадение названия трека (понижено с 70, чтобы не перебивать треки автора)
      } else if (normT.startsWith(normQ) || normT.includes(normQ) || normT.startsWith(aliasNormQ) || normT.includes(aliasNormQ)) {
        score += 30;
      }

      if (normBoth && (normBoth === normQ || normBothRev === normQ || normBoth === aliasNormQ || normBothRev === aliasNormQ)) {
        score += 140; // Точное совпадение Артист + Трек
      } else if (normBoth && (normBoth.includes(normQ) || normQ.includes(normBoth) || normBoth.includes(aliasNormQ) || aliasNormQ.includes(normBoth))) {
        score += 70; // Частичное совпадение составного запроса
      } else if (normAlb === normQ || normAlb === aliasNormQ) {
        // Совпадение только по альбому (например, Monte Pons с альбомом "Rammstein")
        score += 10;
      }

      // Штраф за мусорные эмуляции, 8-битки и караоке
      if (junkRe.test(tTitle) || junkRe.test(tAlbum)) {
        score -= 40;
      }

      return { track: t, score };
    });

    // Сортировка по убыванию релевантности и отсечение по лимиту (20 треков на страницу)
    scoredTracks.sort((a, b) => b.score - a.score);
    const finalTracks = scoredTracks.slice(0, limit).map(item => item.track);

    const response = c.json(finalTracks, 200, {
      'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
      'Access-Control-Allow-Origin': '*',
    });

    if (finalTracks.length > 0) {
      try {
        safeWaitUntil(c, edgeCache.put(cacheReq, response.clone()));
      } catch (_) {}
    }

    return response;
  } catch (_) {
    return c.json([], 200);
  }
};

// --- SAAVN MIRROR PROXY (edge-cached; eliminates the hard SPOF on third-party hobby deployments) ---
musicRouter.get('/api/music/saavn/*', async (c: Context) => {
  const subPath = c.req.path.replace(/^\/api\/music\/saavn\/?/, '');
  // Белый список допустимых путей: только безопасные read-only эндпоинты поиска, альбомов, артистов и треков
  if (!/^(search\/(songs|albums|artists)|albums|artists|songs)(\/[\w-]+(\/songs)?)?$/.test(subPath)) {
    return c.json({ error: 'not allowed' }, 403);
  }

  const upstreamQuery = new URL(c.req.url).search;
  const parsedUrl = new URL(c.req.url);
  const edgeCache = (caches as any).default;
  // Search results are highly repetitive (80% of traffic) — cache 24h at edge; artist/album pages 6h
  const ttl = subPath.startsWith('search') ? 86400 : 21600;
  const cacheReq = edgeCacheKey(c, `${parsedUrl.origin}/api/music/saavn/${subPath}${upstreamQuery}`);
  try {
    const cached = await edgeCache.match(cacheReq);
    if (cached) return cached;
  } catch (_) {}

  for (const base of saavnUpstreamBases(c)) {
    try {
      const res = await fetch(`${base}/${subPath}${upstreamQuery}`, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const response = c.json(data, 200, {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': `public, max-age=1800, s-maxage=${ttl}, stale-while-revalidate=3600`,
      });
      try {
        safeWaitUntil(c, edgeCache.put(cacheReq, response.clone()));
      } catch (_) {}
      return response;
    } catch (_) {
      continue;
    }
  }

  return c.json({ error: 'upstream unavailable' }, 502);
});

// --- INVIDIOUS INSTANCE DISCOVERY (24h edge cache, sourced from the official instance list) ---
musicRouter.get('/api/music/invidious/instances', async (c: Context) => {
  const edgeCache = (caches as any).default;
  const cacheReq = edgeCacheKey(c);
  try {
    const cached = await edgeCache.match(cacheReq);
    if (cached) return cached;
  } catch (_) {}

  let instances: string[] = [];
  try {
    const res = await fetch('https://api.invidious.io/instances.json?sort_by=health', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const list = await res.json();
      instances = (Array.isArray(list) ? list : [])
        .map((row: any) => (Array.isArray(row) ? row[1] : row))
        .filter((i: any) => i && typeof i.type === 'string' && i.type === 'https' && typeof i.uri === 'string' && i.uri.startsWith('https://'))
        .map((i: any) => i.uri.replace(/\/+$/, ''))
        .slice(0, 24);
    }
  } catch (_) {}

  const response = c.json({ instances }, 200, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=900, s-maxage=86400, stale-while-revalidate=3600',
  });
  if (instances.length > 0) {
    try {
      safeWaitUntil(c, edgeCache.put(cacheReq, response.clone()));
    } catch (_) {}
  }
  return response;
});

// --- SERVER-SIDE AUDIO RESOLVER (10-12 min edge cache, competitive instance racing with local=true) ---
musicRouter.get('/api/music/resolve', async (c: Context) => {
  const id = (c.req.query('id') || '').trim();
  const artist = (c.req.query('artist') || '').trim();
  const title = (c.req.query('title') || '').trim();

  if (!id && !title) {
    return c.json({ success: false, error: 'missing id or title' }, 400, {
      'Access-Control-Allow-Origin': '*',
    });
  }

  const edgeCache = (caches as any).default;
  const cacheReq = edgeCacheKey(c);
  try {
    const cached = await edgeCache.match(cacheReq);
    if (cached) return cached;
  } catch (_) {}

  let resolvedUrl = '';

  // 1. YouTube track resolution with local=true Invidious race
  if (id.startsWith('yt_')) {
    const videoId = id.replace(/^yt_/, '');
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return c.json({ error: 'invalid id' }, 400);
    }
    const seedInstances = [
      'https://invidious.schenkel.eti.br',
      'https://yt.chocolatemoo53.com',
      'https://inv.nadeko.net',
      'https://yewtu.be',
      'https://invidious.nerdvpn.de',
    ];

    const fetchInstance = async (inst: string): Promise<string> => {
      const res = await fetch(`${inst}/api/v1/videos/${videoId}?local=true`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data: any = await res.json();
      const audioFormats = (data?.adaptiveFormats || []).filter(
        (f: any) => f && typeof f.type === 'string' && f.type.startsWith('audio') && f.url
      );
      if (audioFormats.length === 0) throw new Error('No audio');
      audioFormats.sort((a: any, b: any) => (parseInt(a.bitrate || '0', 10) - parseInt(b.bitrate || '0', 10)));
      const highM4a = audioFormats.filter((f: any) => f.type.includes('mp4') || f.container === 'm4a').pop();
      return highM4a?.url || audioFormats[audioFormats.length - 1]?.url || '';
    };

    try {
      resolvedUrl = await Promise.any(seedInstances.map(fetchInstance));
    } catch (_) {}
  }

  // 2. JioSaavn fallback by title + artist if YT failed or not a YT track
  if (!resolvedUrl && (artist || title)) {
    try {
      const cleanTitle = title.replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim();
      const primaryArtist = artist.split(/(?:feat\.|ft\.|,|&|\/)/i)[0].trim();
      const query = `${primaryArtist} ${cleanTitle}`.trim();
      const bases = saavnUpstreamBases(c);
      for (const base of bases) {
        try {
          const res = await fetch(`${base}/search/songs?query=${encodeURIComponent(query)}&limit=3`, {
            headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
            signal: AbortSignal.timeout(5000),
          });
          if (!res.ok) continue;
          const data: any = await res.json();
          const results = data?.data?.results;
          if (Array.isArray(results) && results.length > 0) {
            const first = results[0];
            const dUrls = first.downloadUrl;
            if (Array.isArray(dUrls) && dUrls.length > 0) {
              const best = dUrls.find((u: any) => u.quality === '320kbps') || dUrls[dUrls.length - 1];
              if (best?.url) {
                resolvedUrl = best.url;
                break;
              }
            }
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  const success = Boolean(resolvedUrl);
  // Edge Cache TTL: 10 минут (600 сек) для успешных потоков во избежание протухания временных токенов
  const response = c.json({ success, url: resolvedUrl, id }, success ? 200 : 404, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': success
      ? 'public, max-age=300, s-maxage=600, stale-while-revalidate=120'
      : 'no-cache, no-store',
  });

  if (success) {
    try {
      safeWaitUntil(c, edgeCache.put(cacheReq, response.clone()));
    } catch (_) {}
  }

  return response;
});

musicRouter.get('/api/music/search', handleMusicSearch);
musicRouter.get('/api/music/v2/search', handleMusicSearch);

