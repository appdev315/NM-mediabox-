import { Hono, Context } from "hono";
import type { AppEnv, Bindings } from "../types";
import { safeWaitUntil, normString, getTmdbKey, edgeCacheKey } from "../utils/helpers";

export const moviesRouter = new Hono<AppEnv>();

function cleanWords(s: string): string[] {
  const norm = s.toLowerCase().replace(/ё/g, 'е').replace(/Ё/g, 'е');
  const matches = norm.match(/[a-zа-я0-9]+/g);
  return matches ? Array.from(matches) : [];
}

// Стемминг окончаний для русских прилагательных и падежей:
// Предотвращает коллизии при различии в окончаниях тайтлов («итхэвонский» ↔ «итхэвон», «семейная» ↔ «семейн»)
function stemToken(w: string): string {
  if (w.length <= 4) return w;
  // Снятие распространенных окончаний прилагательных и причастий (основа не менее 4 символов)
  const stemmed = w.replace(/(овский|евский|инский|ский|ская|ское|ские|ского|скому|ских|скими|ная|ное|ные|ный|ного|ному|ных|ными|того|тому|тая|тое|тые)$/, '');
  return stemmed.length >= 4 ? stemmed : w;
}

// Коэффициент сходства Дайса (Dice similarity) для мультимножеств токенов с поддержкой стемминга
function calculateTokenDice(itemWords: string[], candWords: string[]): number {
  if (itemWords.length === 0 || candWords.length === 0) return 0;
  let matches = 0;
  const itemFreq = new Map<string, number>();
  for (const w of itemWords) {
    const sw = stemToken(w);
    itemFreq.set(sw, (itemFreq.get(sw) || 0) + 1);
  }
  for (const w of candWords) {
    const sw = stemToken(w);
    const count = itemFreq.get(sw) || 0;
    if (count > 0) {
      matches++;
      itemFreq.set(sw, count - 1);
    }
  }
  return (2 * matches) / (itemWords.length + candWords.length);
}

// Оценка релевантности кандидата донора относительно запрошенного тайтла (0–110 баллов)
function calculateMatchScore(
  item: { name: string; origin_name?: string; year?: number },
  candidate: string,
  targetYear: number,
  relaxedYear = false
): { score: number; isExact: boolean } {
  const cn = normString(candidate);
  if (!cn) return { score: 0, isExact: false };

  const nameLower = normString(item.name || '');
  const origLower = normString(item.origin_name || '');
  const itemWords = cleanWords(item.name || '');
  const origWords = cleanWords(item.origin_name || '');
  const candWords = cleanWords(candidate);

  let isExact = false;
  let baseScore = 0;

  // 1. Абсолютное совпадение полного названия или сегмента через слэш
  if (nameLower === cn || origLower === cn) {
    isExact = true;
    baseScore = 100;
  } else {
    for (const part of (item.name || '').split('/')) {
      if (normString(part) === cn) {
        isExact = true;
        baseScore = 100;
        break;
      }
    }
    if (!isExact && item.origin_name) {
      for (const part of item.origin_name.split('/')) {
        if (normString(part) === cn) {
          isExact = true;
          baseScore = 100;
          break;
        }
      }
    }
  }

  // 2. Нечёткое совпадение по токенам (если нет 100% точного совпадения строки)
  if (!isExact && candWords.length > 0) {
    if (candWords.length === 1) {
      const cw = candWords[0];
      // Одиночные короткие слова ("Оно", "It") допускаются ТОЛЬКО если и тайтл донора состоит
      // не более чем из 2 слов ("Оно", "Оно 2"). Одиночное слово в длинном тайтле (например,
      // слово "плейлист" в "Экстраординарный плейлист Зои") строго отбрасывается для защиты от коллизий.
      const matchInShortTitle = (itemWords.includes(cw) && itemWords.length <= 2) || 
                                (origWords.includes(cw) && origWords.length <= 2);
      if (matchInShortTitle) {
        baseScore = 75;
      }
    } else {
      // Для многословных кандидатов считаем коэффициент Дайса по русскому и оригинальному названиям
      const diceName = calculateTokenDice(itemWords, candWords);
      const diceOrig = calculateTokenDice(origWords, candWords);
      const bestDice = Math.max(diceName, diceOrig);

      // Порог отсечения 0.70 гарантирует, что частичные пересечения (например, 1 слово из 3) бракуются
      if (bestDice >= 0.70) {
        baseScore = Math.round(bestDice * 90);
      }
    }
  }

  if (baseScore === 0) return { score: 0, isExact: false };

  // 3. Валидация года выпуска: строгая дельта +/- 2 года
  const itemYear = item.year || 0;
  const yearDelta = (targetYear > 0 && itemYear > 0) ? Math.abs(itemYear - targetYear) : 0;

  let yearBonus = 0;
  if (targetYear === 0 || itemYear === 0) {
    yearBonus = 0;
  } else if (yearDelta === 0) {
    yearBonus = 10; // Бонус за идентичный год премьеры
  } else if (yearDelta === 1) {
    yearBonus = 5;
  } else if (yearDelta === 2) {
    yearBonus = 0;
  } else if (relaxedYear && isExact && yearDelta <= 10) {
    yearBonus = -25; // Автоматическое восстановление сериалов с задержкой веб-релиза (до 10 лет)
  } else {
    // Выход за пределы допустимой разницы лет дисквалифицирует совпадение
    return { score: 0, isExact: false };
  }

  return { score: baseScore + yearBonus, isExact };
}

function expandTitleVariants(titles: string[]): string[] {
  const result = new Set<string>();
  for (const t of titles) {
    const clean = t.trim();
    if (!clean) continue;
    result.add(clean);

    // Hyphenated titles: "Человек-паук" → "Человек паук", "Команда - А" → "Команда А"
    if (clean.includes('-')) {
      result.add(clean.replace(/-/g, ' ').replace(/\s+/g, ' ').trim());
    }
    // Colons: "Терминатор: Тёмные судьбы" → "Терминатор Тёмные судьбы"
    if (clean.includes(':')) {
      result.add(clean.replace(/:/g, '').replace(/\s+/g, ' ').trim());
    }
    // Guillemets & fancy quotes: «А» → А
    if (/[«»\u201E\u201C\u201D\u201F]/.test(clean)) {
      result.add(clean.replace(/[«»\u201E\u201C\u201D\u201F]/g, '').replace(/\s+/g, ' ').trim());
    }

    if (clean.includes('+')) {
      const withPlusRu = clean.replace(/\+/g, ' плюс').replace(/\s+/g, ' ').trim();
      const withPlusEn = clean.replace(/\+/g, ' plus').replace(/\s+/g, ' ').trim();
      if (withPlusRu) result.add(withPlusRu);
      if (withPlusEn) result.add(withPlusEn);
    }
    if (/plus/i.test(clean)) {
      const withRu = clean.replace(/plus/gi, 'плюс').replace(/\s+/g, ' ').trim();
      const withSign = clean.replace(/plus/gi, '+').replace(/\s+/g, ' ').trim();
      if (withRu) result.add(withRu);
      if (withSign) result.add(withSign);
    }
    if (/плюс/i.test(clean)) {
      const withEn = clean.replace(/плюс/gi, 'plus').replace(/\s+/g, ' ').trim();
      const withSign = clean.replace(/плюс/gi, '+').replace(/\s+/g, ' ').trim();
      if (withEn) result.add(withEn);
      if (withSign) result.add(withSign);
    }

    // Взаимная адаптация транслитерации корейских тайтлов (Итэвон ↔ Итхэвон)
    if (/тхэ/i.test(clean)) {
      result.add(clean.replace(/тхэ/gi, 'тэ'));
    }
    if (/тэ/i.test(clean)) {
      result.add(clean.replace(/тэ/gi, 'тхэ'));
    }
  }
  return Array.from(result);
}

export const LIFTW_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': 'https://liftw.ws/',
  'Origin': 'https://liftw.ws',
};


moviesRouter.get('/api/liftw', async (c: Context) => {
  const title = c.req.query('title') || '';
  const yearStr = c.req.query('year') || '';
  const vType = c.req.query('type') || 'movie';
  const tmdb = c.req.query('tmdb') || '';
  const titleRu = c.req.query('title_ru') || '';
  const originalTitle = c.req.query('original_title') || '';
  const rawLiftwId = c.req.query('liftw_id') || c.req.query('liftwId') || '';
  const liftwIdParam = rawLiftwId ? rawLiftwId.replace(/^liftw_/, '') : '';

  // bypass_cache запускает полный каскад (~30 upstream-запросов) в обход edge-кэша.
  // Грубый in-isolate лимит на IP закрывает самый дешёвый DoS-вектор; для обычных
  // пользователей это просто «не чаще раза в 30 секунд», кэш-промахи не затронуты.
  const bypassLimiter = (globalThis as any).__liftwBypassLimiter as Map<string, number> ||
    ((globalThis as any).__liftwBypassLimiter = new Map<string, number>());
  const BYPASS_WINDOW_MS = 30_000;
  let bypassCache = c.req.query('bypass_cache') === 'true';
  if (bypassCache) {
    const ip = c.req.header('CF-Connecting-IP') || 'unknown';
    const now = Date.now();
    const last = bypassLimiter.get(ip) || 0;
    if (now - last < BYPASS_WINDOW_MS) {
      bypassCache = false; // деградация до обычного запроса вместо 429
    } else {
      bypassLimiter.set(ip, now);
      if (bypassLimiter.size > 10_000) {
        for (const [k, ts] of bypassLimiter) {
          if (now - ts > BYPASS_WINDOW_MS) bypassLimiter.delete(k);
        }
      }
    }
  }

  if (!title && !liftwIdParam) {
    return c.json({ error: 'Title or liftw_id is required' }, 400);
  }

  // Fast reject non-cinema / adult queries from hitting liftw movie donor
  if (
    vType === 'adult' || 
    tmdb.startsWith('ep_') || 
    tmdb.startsWith('rt_') ||
    (liftwIdParam && (liftwIdParam.startsWith('ep_') || liftwIdParam.startsWith('rt_')))
  ) {
    return c.json({ error: 'Adult streams not supported on liftw cinema donor' }, 404);
  }

  const canonicalType = (vType === 'tv' || vType === 'series') ? 'tv' : 'movie';
  const parsedUrl = new URL(c.req.url);

  // 1. Canonical Edge Cache Key (language-agnostic: strictly liftw_id or tmdb + canonicalType when present)
  const canonicalUrl = liftwIdParam
    ? `${parsedUrl.origin}/api/liftw?liftw_id=${encodeURIComponent(liftwIdParam)}`
    : (tmdb 
        ? `${parsedUrl.origin}/api/liftw?tmdb=${encodeURIComponent(tmdb)}&type=${canonicalType}`
        : `${parsedUrl.origin}/api/liftw?title=${encodeURIComponent(normString(title))}&year=${encodeURIComponent(yearStr)}&type=${canonicalType}`);

  const legacyCacheParams = new URLSearchParams();
  if (liftwIdParam) legacyCacheParams.set('liftw_id', liftwIdParam);
  if (tmdb) legacyCacheParams.set('tmdb', tmdb);
  if (title) legacyCacheParams.set('title', normString(title));
  if (yearStr) legacyCacheParams.set('year', yearStr);
  legacyCacheParams.set('type', vType);
  if (titleRu) legacyCacheParams.set('title_ru', normString(titleRu));
  legacyCacheParams.sort();
  const legacyKeyUrl = `${parsedUrl.origin}/api/liftw?${legacyCacheParams.toString()}`;

  // Канонический версионированный ключ Cloudflare Edge Cache (cv=cv8)
  const cacheReq = edgeCacheKey(c, canonicalUrl);
  const edgeCache = (caches as any).default;

  // Donor metric recorder: tracks real Liftw stream resolutions for the 3-hour report
  const recordDonorMetric = (status: 'liftw_ok' | 'liftw_fail') => {
    if (!c.env.DB) return;
    safeWaitUntil(c, (async () => {
      try {
        await c.env.DB.prepare(
          `INSERT INTO analytics_events (event_type, country, item_type, item_title, item_id, meta)
           VALUES ('donor_hit', ?, ?, ?, ?, ?)`
        ).bind(c.get('country') || null, canonicalType, title || null, tmdb || liftwIdParam || null, status).run();
      } catch (_) {}
    })());
  };

  if (!bypassCache) {
    try {
      const cachedResponse = await edgeCache.match(cacheReq);
      if (cachedResponse) {
        return cachedResponse;
      }
    } catch (_) {}
  } else {
    // Инвалидация принудительного обновления: удаляем версионированный и старый неверсионированный ключи
    try {
      safeWaitUntil(c, edgeCache.delete(cacheReq));
      safeWaitUntil(c, edgeCache.delete(new Request(canonicalUrl, { method: 'GET' })));
      if (canonicalUrl !== legacyKeyUrl) {
        safeWaitUntil(c, edgeCache.delete(new Request(legacyKeyUrl, { method: 'GET' })));
      }
    } catch (_) {}
  }

  // Direct fast-path when liftw_id is known (0ms search, 100% success)
  if (liftwIdParam) {
    try {
      const infoRes = await fetch(`https://api.liftw.ws/info/${encodeURIComponent(liftwIdParam)}`, {
        headers: LIFTW_HEADERS,
        signal: AbortSignal.timeout(5000),
      });
      if (infoRes.ok) {
        const info = await infoRes.json() as any;
        if (info && info.iframe_uri) {
          const directResult: Record<string, any> = {
            liftwId: info.id,
            liftwType: info.type,
            name: info.name,
            origin_name: info.origin_name || '',
            year: info.year || '',
            poster: info.poster || '',
            iframe: info.iframe_uri,
            info: info.info || null,
          };
          if (info.episodes) directResult.episodes = info.episodes;
          const directCacheTtl = canonicalType === 'tv' ? 1800 : 3600; // 30m TV, 1h Movies — donor poster URLs are short-lived signed links, long edge TTL would serve rotten posters
          const directHeaders: Record<string, string> = {
            'Cache-Control': `public, max-age=${directCacheTtl}, s-maxage=${directCacheTtl}`,
            'Access-Control-Allow-Origin': '*',
          };
          const directResponse = c.json(directResult, 200, directHeaders);
          try {
            safeWaitUntil(c, edgeCache.put(cacheReq, directResponse.clone()));
          } catch (_) {}
          recordDonorMetric('liftw_ok');
          return directResponse;
        }
      }
    } catch (_) {}
  }

  const isSeries = vType === 'tv' || vType === 'series';
  const validTypes = isSeries ? [3, 4, 5, 7] : [1, 2, 6];
  const targetYear = parseInt(yearStr, 10) || 0;

  const rawCandidates = [title, titleRu, originalTitle].map(s => s.trim()).filter(Boolean);
  const candidates = expandTitleVariants(Array.from(new Set(rawCandidates)));

  const searchCandidates = async (candList: string[], strictType = true, relaxedYear = false): Promise<{ id: number; type: number; name: string; origin_name: string; year: number } | null> => {
    const list = candList.slice(0, 8);
    if (list.length === 0) return null;

    // Параллельный опрос донора по топ-8 кандидатам для минимизации задержки
    const searchPromises = list.map(async (cand) => {
      try {
        const searchRes = await fetch(`https://api.liftw.ws/search?q=${encodeURIComponent(cand)}`, {
          headers: LIFTW_HEADERS,
          signal: AbortSignal.timeout(4500),
        });
        if (!searchRes.ok) return [];
        const searchData = await searchRes.json() as { items?: any[] };
        return searchData.items || [];
      } catch (_) {
        return [];
      }
    });

    const results = await Promise.all(searchPromises);
    const seenIds = new Set<number>();
    const allItems: any[] = [];
    for (const items of results) {
      for (const item of items) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          allItems.push(item);
        }
      }
    }

    // Выбор лучшего совпадения (Best-Match) по максимальному скорингу вместо жадного первого совпадения
    let bestItem: { id: number; type: number; name: string; origin_name: string; year: number } | null = null;
    let highestScore = 0;

    for (const item of allItems) {
      if (strictType && !validTypes.includes(item.type)) continue;

      for (const c of candList) {
        const { score } = calculateMatchScore(item, c, targetYear, relaxedYear);
        if (score >= 70 && score > highestScore) {
          highestScore = score;
          bestItem = item;
          // Ранний выход при максимальном балле: точное название + совпадение года премьеры
          if (highestScore >= 110) break;
        }
      }
      if (highestScore >= 110) break;
    }

    return bestItem;
  };

  // Step 1: Search direct candidates (strict type)
  let matchedItem = await searchCandidates(candidates, true);
  let healNote = '';
  let tmdbAltCandidates: string[] = [];

  // Step 2: Fallback to TMDB Alternative Titles & Translations
  if (!matchedItem && tmdb) {
    try {
      const tmdbType = canonicalType === 'tv' ? 'tv' : 'movie';
      const tmdbKey = getTmdbKey(c);
      // encodeURIComponent нейтрализует path-инъекцию пользовательского tmdb в URL
      const tmdbUrl = `https://api.themoviedb.org/3/${tmdbType}/${encodeURIComponent(tmdb)}?api_key=${tmdbKey}&append_to_response=alternative_titles,translations`;
      const tmdbRes = await fetch(tmdbUrl, {
        signal: AbortSignal.timeout(4000),
        cf: {
          cacheTtl: 2592000,
          cacheEverything: true,
        },
      } as any);
      if (tmdbRes.ok) {
        const tData = await tmdbRes.json() as any;
        const moreCands: string[] = [];
        // Фильтр алфавитов: донор Liftw поддерживает только кириллицу и латиницу.
        // Иноязычные алфавиты (греческий, иврит, арабский, иероглифы) отсекаются,
        // чтобы не порождать паразитные англоязычные огрызки при токенизации.
        const validScriptRegex = /^[a-zA-Zа-яА-ЯёЁ0-9\s\-–—_:.,'\"!?+&()/\\]+$/;
        for (const field of ['title', 'name', 'original_title', 'original_name']) {
          if (tData[field] && typeof tData[field] === 'string' && validScriptRegex.test(tData[field])) {
            moreCands.push(tData[field].trim());
          }
        }
        for (const r of (tData.alternative_titles?.results || [])) {
          if (r.title && typeof r.title === 'string' && validScriptRegex.test(r.title)) {
            moreCands.push(r.title.trim());
          }
        }
        for (const r of (tData.alternative_titles?.titles || [])) {
          if (r.title && typeof r.title === 'string' && validScriptRegex.test(r.title)) {
            moreCands.push(r.title.trim());
          }
        }
        for (const tr of (tData.translations?.translations || [])) {
          // Разрешаем только переводы на языки с кириллицей и латиницей
          const iso = tr.iso_639_1;
          if (['ru', 'en', 'uk', 'be'].includes(iso)) {
            if (tr.data?.name && typeof tr.data.name === 'string' && validScriptRegex.test(tr.data.name)) {
              moreCands.push(tr.data.name.trim());
            }
            if (tr.data?.title && typeof tr.data.title === 'string' && validScriptRegex.test(tr.data.title)) {
              moreCands.push(tr.data.title.trim());
            }
          }
        }

        const cyr = moreCands.filter(s => /[а-яёА-ЯЁ]/.test(s));
        const lat = moreCands.filter(s => !/[а-яёА-ЯЁ]/.test(s));
        tmdbAltCandidates = expandTitleVariants(Array.from(new Set([...cyr, ...lat])).filter(s => !candidates.includes(s)));

        matchedItem = await searchCandidates(tmdbAltCandidates, true);
        if (matchedItem) {
          healNote = 'TMDB alt titles (strict)';
        } else {
          // If still not matched with strict types, try relaxed types for alternative titles
          matchedItem = await searchCandidates(tmdbAltCandidates, false);
          if (matchedItem) {
            healNote = 'TMDB alt titles (relaxed)';
          }
        }
      }
    } catch (_) {}
  }

  // Step 3: Fallback across all content types (e.g. movie classified as docu-series/show on Liftw)
  if (!matchedItem) {
    matchedItem = await searchCandidates(candidates, false);
    if (matchedItem) {
      healNote = 'Content type relaxed fallback';
    }
  }

  // Step 4: Auto-Heal for series with web-vs-broadcast syndication year disparity (exact title match, relaxed year)
  if (!matchedItem && isSeries) {
    const allCands = Array.from(new Set([...candidates, ...tmdbAltCandidates]));
    matchedItem = await searchCandidates(allCands, true, true);
    if (!matchedItem) {
      matchedItem = await searchCandidates(allCands, false, true);
    }
    if (matchedItem) {
      healNote = 'Exact title match (relaxed year for TV)';
    }
  }

  // Autonomous Sysadmin Incident logger (non-blocking via executionCtx)
  const recordIncident = (failType: string, status: string, note?: string) => {
    if (!c.env.DB) return;
    // Guard: Only record incidents for verified cinema catalog items with numeric TMDB or numeric Liftw ID.
    // Arbitrary user search terms, adult keywords (ep_*, rt_*), or non-catalog items must NEVER pollute parsing_incidents.
    const isNumericTmdb = Boolean(tmdb && /^\d+$/.test(tmdb));
    const isNumericLiftw = Boolean(liftwIdParam && /^\d+$/.test(liftwIdParam));
    if (!isNumericTmdb && !isNumericLiftw) return;
    if (vType === 'adult' || tmdb.startsWith('ep_') || tmdb.startsWith('rt_')) return;
    safeWaitUntil(c, (async () => {
      try {
        await c.env.DB.prepare(
          `INSERT INTO parsing_incidents (tmdb_id, title, year, content_type, donor, fail_type, status, heal_note)
           VALUES (?, ?, ?, ?, 'liftw', ?, ?, ?)`
        ).bind(tmdb || null, title, yearStr || null, canonicalType, failType, status, note || null).run();
      } catch (e) {
        console.error('[Sysadmin] Failed to record incident:', e);
      }
    })());
  };

  if (!matchedItem) {
    recordDonorMetric('liftw_fail');
    recordIncident('not_found', 'unresolved', 'Exhausted direct, alt titles, and relaxed search');
    return c.json({ error: 'exact match not found on liftw' }, 404, {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    });
  }

  try {
    const infoRes = await fetch(`https://api.liftw.ws/info/${matchedItem.id}`, {
      headers: LIFTW_HEADERS,
      signal: AbortSignal.timeout(7000),
    });
    if (!infoRes.ok) {
      recordDonorMetric('liftw_fail');
      recordIncident('http_502', 'unresolved', `Liftw info HTTP ${infoRes.status}`);
      return c.json({ error: 'failed to fetch liftw stream info' }, 502, {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Access-Control-Allow-Origin': '*',
      });
    }
    const info = await infoRes.json() as { id: number; type: number; name: string; iframe_uri: string; episodes?: any };
    
    if (!info.iframe_uri) {
      recordDonorMetric('liftw_fail');
      recordIncident('empty_iframe', 'unresolved', 'Liftw returned empty iframe_uri');
      return c.json({ error: 'liftw stream has no active player' }, 404, {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Access-Control-Allow-Origin': '*',
      });
    }

    const result: Record<string, any> = {
      liftwId: info.id,
      liftwType: info.type,
      name: info.name,
      iframe: info.iframe_uri,
    };
    if (info.episodes) {
      result.episodes = info.episodes;
    }

    recordDonorMetric('liftw_ok');

    // If stream was recovered via fallback cascade, record auto_fixed incident
    if (healNote) {
      recordIncident('fallback_recovery', 'auto_fixed', healNote);
    }

    // Auto-heal resolution: If previously marked as unresolved, mark prior incidents for this tmdb_id as auto_fixed
    if (c.env.DB && tmdb) {
      safeWaitUntil(c, (async () => {
        try {
          await c.env.DB.prepare(
            `UPDATE parsing_incidents 
             SET status = 'auto_fixed', heal_note = ? 
             WHERE tmdb_id = ? AND status = 'unresolved'`
          ).bind(healNote || 'Stream live on donor', tmdb).run();
        } catch (e) {
          console.error('[Sysadmin] Failed to auto-fix prior incidents:', e);
        }
      })());
    }

    const isTv = canonicalType === 'tv';
    const cacheTtl = isTv ? 1800 : 2592000; // 30m for TV (rapid ongoing episode pickup), 30 days for Movies (no immutable)

    const resHeaders: Record<string, string> = {
      'Cache-Control': `public, max-age=${cacheTtl}, s-maxage=${cacheTtl}`,
      'Access-Control-Allow-Origin': '*',
    };

    const response = c.json(result, 200, resHeaders);

    // Only cache verified valid streams on Cloudflare Edge
    try {
      safeWaitUntil(c, edgeCache.put(cacheReq, response.clone()));
    } catch (_) {}

    return response;
  } catch (err: any) {
    recordDonorMetric('liftw_fail');
    recordIncident('timeout', 'unresolved', err?.message || 'stream resolve error');
    return c.json({ error: err?.message || 'failed to resolve stream' }, 500, {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    });
  }
});

export const mapLiftwItem = (item: any, isTv?: boolean, searchScore?: number) => {
  if (!item || !item.id) return null;
  const rawRating = item.imdb_rating || item.kp_rating || 0;
  const numRating = typeof rawRating === 'number' ? rawRating : (parseFloat(rawRating) || 0);
  const year = item.year || 0;
  const resolvedIsTv = isTv !== undefined ? isTv : [3, 4, 5, 7].includes(item.type);

  return {
    id: `liftw_${item.id}`,
    liftw_id: item.id,
    name: item.name,
    title: item.name,
    original_name: item.origin_name || item.name,
    original_title: item.origin_name || item.name,
    poster: item.poster || '',
    backdrop_path: null,
    poster_path: null,
    rating: numRating,
    vote_average: numRating,
    release_date: year ? `${year}-01-01` : '',
    year: year ? String(year) : '',
    type: resolvedIsTv ? 'series' : 'movie',
    media_type: resolvedIsTv ? 'tv' : 'movie',
    isLiftwOnly: true,
    quality: item.quality || '',
    serial_status: item.serial_status || '',
    ...(searchScore !== undefined ? { search_score: searchScore } : {}),
  };
};

// Non-Russian UI languages hide domestic titles. Detection is heuristic and
// request-free: foreign catalog entries carry a Latin origin_name, domestic
// ones carry an empty or Cyrillic-only origin with a Cyrillic display title.
export function isRussianOrigin(item: any): boolean {
  if (!item) return false;
  if (item.isDrama) return false;
  if (item.original_language === 'ru') return true;
  if (item.original_language && item.original_language !== 'ru') return false;
  const oc = item.origin_country;
  if (Array.isArray(oc) && (oc.includes('RU') || oc.includes('SU'))) return true;
  if (Array.isArray(oc) && oc.length > 0 && !oc.includes('RU') && !oc.includes('SU')) return false;
  const pc = item.production_countries;
  if (Array.isArray(pc) && pc.some((cc: any) => cc?.iso_3166_1 === 'RU' || cc?.iso_3166_1 === 'SU')) return true;
  const countries = item.country || item.countries;
  if (Array.isArray(countries) && countries.some((cc: any) => /^(Россия|СССР|Russia|Soviet Union)$/i.test(String(cc).trim()))) return true;
  const origin = (item.original_name || item.original_title || item.origin_name || '').trim();
  if (/[\uac00-\ud7af\u4e00-\u9fff\u3040-\u30ff]/i.test(origin)) return false;
  const title = (item.title || item.name || '').trim();
  if (/[а-яё]/i.test(title) && !/[a-z]/i.test(origin)) return true;
  return false;
}

export function isNonRussianLang(lang: string): boolean {
  return !String(lang || '').toLowerCase().startsWith('ru');
}

// Edge-cache namespace. Bump to instantly orphan stale pre-deploy entries
// cv8: Ranked Best-Match scoring, alphabet sanitization and cache purge for substituted series
const EDGE_CACHE_NS = 'cv8';


// --- DIRECT LIFTW CATALOG SEARCH ---
moviesRouter.get('/api/search/liftw', async (c: Context) => {
  const query = (c.req.query('q') || c.req.query('query') || '').trim();
  const vType = c.req.query('type') || '';
  const lang = c.req.query('lang') || 'ru-RU';
  if (!query) {
    return c.json({ results: [] });
  }

  const edgeCache = (caches as any).default;
  const parsedUrl = new URL(c.req.url);
  const cacheKeyUrl = `${parsedUrl.origin}/api/search/liftw?q=${encodeURIComponent(query.toLowerCase())}&type=${encodeURIComponent(vType)}&lang=${encodeURIComponent(lang)}`;
  const cacheReq = edgeCacheKey(c, cacheKeyUrl);

  try {
    const cached = await edgeCache.match(cacheReq);
    if (cached) return cached;
  } catch (_) {}

  try {
    // 1. Формирование пула поисковых кандидатов (исходный запрос + фонемные эвристики)
    const searchCandidates = new Set<string>([query]);

    // Фонемная адаптация частых запросов для дорам и зарубежного кино (Doctor -> Доктор, X -> Икс)
    if (/doctor/i.test(query)) {
      searchCandidates.add(query.replace(/doctor/gi, 'Доктор'));
      if (/\bx\b/i.test(query)) {
        searchCandidates.add(query.replace(/doctor/gi, 'Доктор').replace(/\bx\b/gi, 'Икс'));
      }
    }

    // 2. Интеллектуальное обогащение через TMDB Multi-Search при наличии латиницы в запросе
    const tmdbKey = getTmdbKey(c);
    if (tmdbKey && /[a-zA-Z]/.test(query)) {
      try {
        const tmdbUrl = `https://api.themoviedb.org/3/search/multi?api_key=${tmdbKey}&query=${encodeURIComponent(query)}&language=ru-RU`;
        const tmdbRes = await fetch(tmdbUrl, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(3000),
        });
        if (tmdbRes.ok) {
          const tmdbData = await tmdbRes.json() as { results?: any[] };
          for (const it of (tmdbData.results || []).slice(0, 5)) {
            if (it.media_type === 'person') continue;
            const candTitle = it.title || it.name;
            // Извлекаем только локализованные кириллические названия
            if (candTitle && typeof candTitle === 'string' && /[а-яА-ЯёЁ]/.test(candTitle)) {
              searchCandidates.add(candTitle.trim());
            }
          }
        }
      } catch (_) {
        // Ошибка или таймаут TMDB не ломает поиск: продолжаем по базовым кандидатам
      }
    }

    // 3. Параллельный опрос донора Liftw по топ-4 кандидатам
    const candidateList = Array.from(searchCandidates).slice(0, 4);
    const fetchPromises = candidateList.map(async (cand) => {
      try {
        const res = await fetch(`https://api.liftw.ws/search?q=${encodeURIComponent(cand)}`, {
          headers: LIFTW_HEADERS,
          signal: AbortSignal.timeout(4500),
        });
        if (!res.ok) return [];
        const data = await res.json() as { items?: any[] };
        return data.items || [];
      } catch (_) {
        return [];
      }
    });

    const candidateResults = await Promise.all(fetchPromises);
    const seenIds = new Set<number>();
    const items: any[] = [];
    for (const batch of candidateResults) {
      for (const it of batch) {
        if (it && it.id && !seenIds.has(it.id)) {
          seenIds.add(it.id);
          items.push(it);
        }
      }
    }

    // 4. Фильтрация по типу контента при указании параметра
    let filtered = items;
    if (vType === 'movie') {
      filtered = items.filter(it => [1, 2, 6].includes(it.type));
    } else if (vType === 'tv' || vType === 'series') {
      filtered = items.filter(it => [3, 4, 5, 7].includes(it.type));
    }

    // 5. Умное ранжирование релевантности (подъем точных совпадений на первые позиции)
    const normQ = query.toLowerCase().replace(/[^a-zа-я0-9]/gi, '');
    filtered.sort((a, b) => {
      const aName = (a.name || '').toLowerCase().replace(/[^a-zа-я0-9]/gi, '');
      const bName = (b.name || '').toLowerCase().replace(/[^a-zа-я0-9]/gi, '');
      const aOrig = (a.origin_name || '').toLowerCase().replace(/[^a-zа-я0-9]/gi, '');
      const bOrig = (b.origin_name || '').toLowerCase().replace(/[^a-zа-я0-9]/gi, '');

      // Точные совпадения с запросом или локализацией (например, "Doctor X" <-> "Доктор Икс")
      const aExact = aName === normQ || aOrig === normQ || (normQ === 'doctorx' && aName === 'докторикс');
      const bExact = bName === normQ || bOrig === normQ || (normQ === 'doctorx' && bName === 'докторикс');
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;

      return (a.search_score ?? 0) - (b.search_score ?? 0);
    });

    const results = filtered
      .map(it => mapLiftwItem(it, undefined, it.search_score ?? 0))
      .filter(Boolean)
      .filter((it: any) => !isNonRussianLang(lang) || !isRussianOrigin(it));

    const response = c.json({ results }, 200, {
      'Cache-Control': 'public, max-age=1800, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
    });

    try {
      safeWaitUntil(c, edgeCache.put(cacheReq, response.clone()));
    } catch (_) {}

    return response;
  } catch (err: any) {
    return c.json({ results: [], error: err?.message }, 500);
  }
});

// --- TMDB POSTER RESOLVER (English covers for non-RU locales, Liftw inventory untouched) ---
// Strips multi-word creator/director possessive prefixes ("Guy Ritchie's The Covenant" -> "The Covenant")
// Single-word possessives like "Schindler's List", "Rosemary's Baby" are preserved.
function stripCreatorPrefix(s: string): string {
  if (!s) return '';
  return s.replace(/^(?:marvel['’]s|disney['’]s|(?:[\p{L}\d.'’\-]+\s+){1,3}[\p{L}\d.'’\-]+['’]s)\s+/iu, '').trim();
}

function stripLeadingArticle(s: string): string {
  if (!s) return '';
  return s.replace(/^(?:the|a|an)\s+/iu, '').trim();
}

function stripSubtitle(s: string): string {
  if (!s) return '';
  return s.split(/[:\-–—]/)[0].trim();
}

// Strict match with tiered scoring: Tier 1 (exact / creator-stripped) > Tier 2 (article/subtitle).
// Inside equal tier, popularity + vote_count acts as tiebreaker. Year match is strict (===).
moviesRouter.get('/api/poster/resolve', async (c: Context) => {
  const title = (c.req.query('title') || '').trim();
  const yearStr = (c.req.query('year') || '').trim();
  const vType = c.req.query('type') || 'movie';
  if (!title) {
    return c.json({ error: 'Title is required' }, 400);
  }
  if (!/^\d{4}$/.test(yearStr)) {
    return c.json({ error: 'Year (YYYY) is required' }, 400);
  }
  const tmdbType = (vType === 'tv' || vType === 'series' || vType === 'serial') ? 'tv' : 'movie';
  const targetYear = parseInt(yearStr, 10);

  const edgeCache = (caches as any).default;
  const cacheReq = edgeCacheKey(c);
  try {
    const cached = await edgeCache.match(cacheReq);
    if (cached) return cached;
  } catch (_) {}

  const noMatch = () => c.json({ error: 'no matching poster' }, 404, {
    // Short negative TTL: donor catalog grows, a later retry may match.
    // (Edge caches 404s too, so keep it brief.)
    'Cache-Control': 'public, max-age=300, s-maxage=900',
    'Access-Control-Allow-Origin': '*',
  });

  try {
    const tmdbKey = getTmdbKey(c);
    if (!tmdbKey) {
      return c.json({ error: 'TMDB API key not configured' }, 500);
    }
    const searchUrl = `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${encodeURIComponent(tmdbKey)}&query=${encodeURIComponent(title)}&year=${targetYear}&language=en-US&include_adult=false&page=1`;
    const res = await fetch(searchUrl, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'MediaBox-Edge/1.0' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return noMatch();
    const data = await res.json() as { results?: any[] };
    const normQuery = normString(title);
    const normQueryNoArt = normString(stripLeadingArticle(title));
    const normQueryNoSub = normString(stripSubtitle(title));

    interface ScoredCandidate {
      r: any;
      tier: number;
    }

    const scored: ScoredCandidate[] = [];

    for (const r of (data.results || [])) {
      if (!r?.poster_path || typeof r.poster_path !== 'string') continue;
      const rYear = parseInt(String(r.release_date || r.first_air_date || '').slice(0, 4), 10);
      if (rYear !== targetYear) continue; // Strict release year match

      const candStrings = [r.title, r.name, r.original_title, r.original_name]
        .filter((s): s is string => typeof s === 'string' && s.length > 0);

      let itemTier = 0;

      // Tier 1: exact full-query match OR exact creator-stripped match
      for (const cs of candStrings) {
        if (normString(cs) === normQuery) {
          itemTier = 1;
          break;
        }
        const noCreator = stripCreatorPrefix(cs);
        if (noCreator && normString(noCreator) === normQuery) {
          itemTier = 1;
          break;
        }
      }

      // Tier 2: variant without leading article or subtitle
      if (itemTier === 0) {
        for (const cs of candStrings) {
          const noArt = stripLeadingArticle(cs);
          const noSub = stripSubtitle(cs);
          const noCreator = stripCreatorPrefix(cs);
          const noCreatorNoArt = stripLeadingArticle(noCreator);
          const noCreatorNoSub = stripSubtitle(noCreator);

          const variants = [noArt, noSub, noCreatorNoArt, noCreatorNoSub]
            .map(normString)
            .filter(v => v.length >= 2);

          if (variants.includes(normQuery) || variants.includes(normQueryNoArt) || variants.includes(normQueryNoSub)) {
            itemTier = 2;
            break;
          }
        }
      }

      if (itemTier > 0) {
        scored.push({ r, tier: itemTier });
      }
    }

    if (scored.length === 0) return noMatch();

    // 1. Tier 1 (exact/creator-stripped) beats Tier 2 (article/subtitle)
    // 2. Tiebreaker inside equal tier: popularity + min(vote_count, 5000) * 0.1
    scored.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      const popA = (Number(a.r.popularity) || 0) + Math.min(Number(a.r.vote_count) || 0, 5000) * 0.1;
      const popB = (Number(b.r.popularity) || 0) + Math.min(Number(b.r.vote_count) || 0, 5000) * 0.1;
      return popB - popA;
    });

    const match = scored[0].r;

    if (!match) return noMatch();

    const imgProxy = new URL(c.req.url).origin + '/api/image?path=';
    const response = c.json({ poster: `${imgProxy}/t/p/w342${match.poster_path}` }, 200, {
      'Cache-Control': 'public, max-age=2592000, s-maxage=2592000',
      'Access-Control-Allow-Origin': '*',
    });
    try {
      safeWaitUntil(c, edgeCache.put(cacheReq, response.clone()));
    } catch (_) {}
    return response;
  } catch (_) {
    return noMatch();
  }
});

// --- TMDB EDGE IMAGE PROXY (Global CDN & anti-blocking) ---
moviesRouter.get('/api/image', async (c: Context) => {
  const path = c.req.query('path');
  if (!path || !path.startsWith('/') || path.includes('..') || !/^\/t\/p\/(w\d+|original)\/[\w\-./]+$/i.test(path)) {
    return c.text('Invalid path', 400);
  }

  const tmdbImageUrl = `https://image.tmdb.org${path}`;

  // Check Cloudflare Cache API for instant 0ms edge response
  const cache = (caches as any).default;
  const cacheKey = new Request(c.req.url, { method: 'GET' });
  let cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const res = await fetch(tmdbImageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      if (res.status === 404) {
        return c.text('Not found', 404);
      }
      return c.text(`Image fetch error: ${res.status}`, 502);
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const response = new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=604800, s-maxage=2592000, immutable',
        'Access-Control-Allow-Origin': '*',
      },
    });

    safeWaitUntil(c, cache.put(cacheKey, response.clone()));
    return response;
  } catch (err: any) {
    return c.text(`Image proxy error: ${err?.message || 'unknown'}`, 502);
  }
});
