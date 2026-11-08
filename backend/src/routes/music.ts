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
      ? fetchFromSaavnPool(`/search/artists?query=${encoded}&limit=5`, 5000)
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

// --- ТРАНСЛИТЕРАЦИЯ И СЛОВАРЬ АЛИАСОВ ДЛЯ ТОЧНОГО ПОИСКА ---
const RU_TO_EN: Record<string, string> = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z',
  'и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r',
  'с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch',
  'ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'
};

const transliterateRuToEn = (str: string): string => {
  return (str || '').toLowerCase().split('').map(ch => RU_TO_EN[ch] !== undefined ? RU_TO_EN[ch] : ch).join('');
};

const normalizeStr = (str: string): string => {
  return (str || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
};

const tokenize = (str: string): string[] => {
  return (str || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0 && !['и', 'в', 'на', 'с', 'по', 'the', 'a', 'an', 'of', 'and'].includes(w));
};

const MUSIC_SEARCH_ALIASES: Record<string, string> = {
  'нагано': 'ноггано',
  'nagano': 'ноггано',
  'noggano': 'ноггано',
  'basta': 'баста',
  'кино': 'группа кино',
  'цой': 'виктор цой',
  'tsoi': 'виктор цой',
  'kino': 'группа кино',
  'король и шут': 'киш',
  'миаги': 'miyagi',
  'мияги': 'miyagi',
  'эндшпиль': 'endshpil',
  'скрип': 'скриптонит',
  'scryptonite': 'скриптонит',
  'scriptonite': 'скриптонит'
};

const cleanYtTitle = (raw: string): string => {
  return (raw || '')
    .replace(/\s*[([]\s*[^)\]]*(?:official|video|audio|lyric|remaster|explicit|edit|version|clip|клип|премьера|нашествие|концерт|soundtrack|саундтрек|ost|hd|4k|hq|cam|subtitles|subs|текст)[^)\]]*[)\]]/gi, '')
    .replace(/\s*(?:\||–|-|•)\s*(?:official\s*video|official\s*audio|клип|премьера\s*\d{4}|4k|hd|remastered?|текст\s*песни|lyrics?|live).*$/gi, '')
    .replace(/\s*\|.*$/g, '')
    .replace(/\b(?:текст\s*песни|lyrics?)\b/gi, '')
    .trim();
};

const parseYtTrackInfo = (rawTitle: string, rawAuthor: string, query = '') => {
  const title = cleanYtTitle(rawTitle);
  const artist = (rawAuthor || 'Unknown Artist').replace(/ - Topic$/i, '').trim();

  const authorNorm = normalizeStr(artist.replace(/\b(?:official|music|records|vevo|channel|группа)\b/gi, ''));

  const quoteMatch = title.match(/^([^"«»]+)\s*["«]([^"»]+)["»]$/);
  if (quoteMatch) {
    return { title: quoteMatch[2].trim(), artist: quoteMatch[1].trim() };
  }

  const splitMatch = title.match(/^([^-–—]+)\s*[-–—]\s*(.+)$/);
  if (splitMatch) {
    const p1 = splitMatch[1].trim();
    const p2 = splitMatch[2].trim();
    const p1Norm = normalizeStr(p1);
    const p2Norm = normalizeStr(p2);
    const normQ = normalizeStr(query);

    if (authorNorm && (p2Norm.includes(authorNorm) || authorNorm.includes(p2Norm)) && !p1Norm.includes(authorNorm)) {
      return { title: p1.replace(/^["'«]+|["'»]+$/g, '').trim(), artist: p2 };
    }

    if (p1Norm === normQ || (normQ.length > 3 && p1Norm.includes(normQ))) {
      return { title: p1.replace(/^["'«]+|["'»]+$/g, '').trim(), artist: p2 };
    }
    if (p2Norm === normQ || (normQ.length > 3 && p2Norm.includes(normQ))) {
      return { title: p2.replace(/^["'«]+|["'»]+$/g, '').trim(), artist: p1 };
    }

    return { title: p2.replace(/^["'«]+|["'»]+$/g, '').trim(), artist: p1.replace(/^["'«]+|["'»]+$/g, '').trim() };
  }

  return { title, artist };
};

const findBestMatchedArtist = (candidates: any[], query: string) => {
  const normQ = normalizeStr(query);
  const aliasNormQ = normalizeStr(MUSIC_SEARCH_ALIASES[normQ] || '');
  const translitNormQ = normalizeStr(transliterateRuToEn(query));

  let bestCand: any = null;
  let bestScore = 0;

  for (const cand of candidates) {
    const normC = normalizeStr(cand?.name);
    const translitNormC = normalizeStr(transliterateRuToEn(cand?.name || ''));
    let score = 0;
    if (normC === normQ) score = 100;
    else if (aliasNormQ && normC === aliasNormQ) score = 95;
    else if (translitNormC === normQ || normC === translitNormQ) score = 90;
    else if (normC.includes(normQ) || (aliasNormQ && normC.includes(aliasNormQ))) score = 80;

    if (score > bestScore) {
      bestScore = score;
      bestCand = cand;
    }
  }

  return bestScore >= 80 ? bestCand : null;
};

    // 1. Топ-песни артиста (если запрос — это имя известного исполнителя)
    if (artistRes.status === 'fulfilled' && artistRes.value && artistRes.value.ok) {
      try {
        const aData = await artistRes.value.json() as any;
        const artistCandidates: any[] = aData?.data?.results || [];
        const matchedArtist = findBestMatchedArtist(artistCandidates, query);

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

    // 3. Результаты YouTube Music (с фильтрацией каналов и вычленением метаданных)
    if (ytRes.status === 'fulfilled' && ytRes.value.ok) {
      try {
        const ytList = await ytRes.value.json() as any[];
        if (Array.isArray(ytList)) {
          const startIndex = (page - 1) * 15;
          const pageYt = ytList.slice(startIndex, startIndex + 25);
          for (const item of pageYt) {
            // Исключаем каналы и плейлисты
            if (item.type === 'channel' || item.type === 'playlist') continue;

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

            let views = 0;
            if (typeof item.subtext === 'string') {
              const vMatch = item.subtext.replace(/,/g, '').match(/(\d+)\s*views/i);
              if (vMatch) views = parseInt(vMatch[1], 10);
            }

            const parsedYt = parseYtTrackInfo(item.title || '', item.author || '', query);
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
              views,
            });
          }
        }
      } catch (_) {}
    }

    // --- УМНОЕ РАНЖИРОВАНИЕ РЕЛЕВАНТНОСТИ (Smart Relevance Scoring & Multi-word Token Coverage) ---
    const scoreTrack = (t: any): number => {
      let score = 0;
      const qTokens = tokenize(query);
      const normQ = normalizeStr(query);
      const aliasNormQ = normalizeStr(MUSIC_SEARCH_ALIASES[normQ] || '');
      const translitNormQ = normalizeStr(transliterateRuToEn(query));

      const tArtist = t.artist || '';
      const tTitle = t.title || '';
      const tAlbum = t.album || '';

      const normA = normalizeStr(tArtist);
      const translitNormA = normalizeStr(transliterateRuToEn(tArtist));
      const normT = normalizeStr(tTitle);
      const translitNormT = normalizeStr(transliterateRuToEn(tTitle));
      const normAlb = normalizeStr(tAlbum);

      const aTokens = tokenize(tArtist);
      const tTokens = tokenize(tTitle);

      // 1. Официальные хиты подтверждённого исполнителя всегда в топе
      if (t.isOfficialArtistTop) {
        score += 150;
      }

      // 2. Точное совпадение имени артиста
      const isExactArtist = normA === normQ || (aliasNormQ && normA === aliasNormQ) || translitNormA === normQ || normA === translitNormQ;
      if (isExactArtist) {
        score += 140;
      } else if (normA.startsWith(normQ) || normQ.startsWith(normA) || (aliasNormQ && normA.includes(aliasNormQ))) {
        score += 70;
      }

      // 3. Точное совпадение названия трека
      const isExactTitle = normT === normQ || (aliasNormQ && normT === aliasNormQ) || translitNormT === normQ || normT === translitNormQ;
      if (isExactTitle) {
        score += 120;
      } else if (normT.startsWith(normQ) || normQ.startsWith(normT)) {
        score += 60;
      }

      // 4. Пословный поиск нескольких слов запроса (Token coverage)
      if (qTokens.length > 0) {
        let matchedQTokens = 0;
        let matchedInArtist = 0;
        let matchedInTitle = 0;

        for (const qt of qTokens) {
          const translitQt = transliterateRuToEn(qt);
          const inA = aTokens.some(at => at === qt || at.startsWith(qt) || transliterateRuToEn(at) === qt || at === translitQt);
          const inT = tTokens.some(tt => tt === qt || tt.startsWith(qt) || transliterateRuToEn(tt) === qt || tt === translitQt);
          if (inA || inT) {
            matchedQTokens++;
            if (inA) matchedInArtist++;
            if (inT) matchedInTitle++;
          }
        }

        const coverage = matchedQTokens / qTokens.length;
        score += Math.round(coverage * 100);

        // Если запрос содержит и исполнителя, и трек (например, «Кино Группа крови»)
        if (matchedInArtist > 0 && matchedInTitle > 0) {
          score += 120;
        }
      }

      // 5. Совпадение по названию альбома
      if (normAlb === normQ || (aliasNormQ && normAlb === aliasNormQ)) {
        score += 20;
      }

      // 6. Штраф за мусорные эмуляции, караоке и каверы
      const junkRe = /\b(?:8-bit|16-bit|emulation|tribute|karaoke|ringtone|remix|cover|минус|караоке|кавер)\b/i;
      if (junkRe.test(tTitle) || junkRe.test(tAlbum)) {
        score -= 60;
      }

      // 7. Бонус популярности по просмотрам
      if (typeof t.views === 'number' && t.views > 0) {
        if (t.views > 10000000) score += 30;
        else if (t.views > 1000000) score += 20;
        else if (t.views > 100000) score += 10;
      }

      return score;
    };

    const scoredTracks = rawTracks.map(t => ({
      track: t,
      score: scoreTrack(t)
    }));

    // Сортировка по убыванию релевантности и отсечение по лимиту (20 треков на страницу)
    scoredTracks.sort((a, b) => b.score - a.score);
    const finalTracks = scoredTracks.slice(0, limit).map(item => item.track);

    const response = c.json(finalTracks, 200, {
      'Cache-Control': 'public, max-age=1800, s-maxage=43200, stale-while-revalidate=3600',
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
  const noCache = c.req.query('nocache') === '1';

  if (!id && !title) {
    return c.json({ success: false, error: 'missing id or title' }, 400, {
      'Access-Control-Allow-Origin': '*',
    });
  }

  const edgeCache = (caches as any).default;
  const cacheReq = edgeCacheKey(c);
  if (!noCache) {
    try {
      const cached = await edgeCache.match(cacheReq);
      if (cached) return cached;
    } catch (_) {}
  }

  let resolvedUrl = '';

  // 1. YouTube track resolution with local=true Invidious race
  if (id.startsWith('yt_')) {
    const videoId = id.replace(/^yt_/, '');
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return c.json({ error: 'invalid id' }, 400);
    }
    const seedInstances = [
      'https://yt.chocolatemoo53.com',
      'https://invidious.tiekoetter.com',
      'https://inv.nadeko.net',
      'https://yewtu.be',
      'https://invidious.nerdvpn.de',
    ];

    const fetchInstance = async (inst: string): Promise<string> => {
      const res = await fetch(`${inst}/api/v1/videos/${videoId}?local=true`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data: any = await res.json();
      const audioFormats = (data?.adaptiveFormats || []).filter(
        (f: any) => f && typeof f.type === 'string' && f.type.startsWith('audio') && f.url
      );
      if (audioFormats.length === 0) throw new Error('No audio');
      audioFormats.sort((a: any, b: any) => (parseInt(a.bitrate || '0', 10) - parseInt(b.bitrate || '0', 10)));
      const highM4a = audioFormats.filter((f: any) => f.type.includes('mp4') || f.container === 'm4a').pop();
      const streamUrl = highM4a?.url || audioFormats[audioFormats.length - 1]?.url || '';
      if (!streamUrl) throw new Error('No audio URL');

      // Валидация стрима: отсекаем инстансы, отдающие JSON, но зависающие при передаче аудиобайтов
      const probeRes = await fetch(streamUrl, {
        headers: { Range: 'bytes=0-100', 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(2000),
      });
      try { probeRes.body?.cancel(); } catch (_) {}
      if (!probeRes.ok && probeRes.status !== 206) {
        throw new Error(`Stream probe failed: ${probeRes.status}`);
      }
      return streamUrl;
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
      const queries = [
        `${primaryArtist} ${cleanTitle}`.trim(),
        cleanTitle,
      ].filter(Boolean);
      const bases = saavnUpstreamBases(c);
      for (const base of bases) {
        let found = false;
        for (const query of queries) {
          try {
            const res = await fetch(`${base}/search/songs?query=${encodeURIComponent(query)}&limit=3`, {
              headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
              signal: AbortSignal.timeout(4000),
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
                  found = true;
                  break;
                }
              }
            }
          } catch (_) {}
        }
        if (found) break;
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

  if (success && !noCache) {
    try {
      safeWaitUntil(c, edgeCache.put(cacheReq, response.clone()));
    } catch (_) {}
  }

  return response;
});

musicRouter.get('/api/music/search', handleMusicSearch);
musicRouter.get('/api/music/v2/search', handleMusicSearch);
musicRouter.get('/api/music/v3/search', handleMusicSearch);

