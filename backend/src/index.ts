import { Hono, Context } from 'hono';
import { cors } from 'hono/cors';
import { tgAuthMiddleware } from './middleware/auth';

type Bindings = {
  DB: D1Database;
  CACHE?: KVNamespace;
  TELEGRAM_BOT_TOKEN: string;
  BOT_TOKEN_MAIN?: string;
  BOT_TOKEN?: string;
  ALLOWED_ORIGIN?: string;
};

type Variables = {
  tgUser: { id: number; first_name: string; username?: string };
  country: string;
  sessionId: string;
};

interface AnalyticsEvent {
  event_type: string;
  country?: string;
  user_id?: number | null;
  session_id?: string;
  item_type?: string;
  item_title?: string;
  item_id?: string;
  meta?: string;
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use('/api/*', cors({
  origin: (origin: string) => {
    if (!origin) return '*';
    const allowed = ['https://web.telegram.org', 'https://media-box.xyz', 'https://www.media-box.xyz', 'https://moviemaniak5555.xyz'];
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    if (allowed.includes(origin) || isLocalhost) {
      return origin;
    }
    return origin;
  },
  allowHeaders: ['Content-Type', 'Authorization', 'X-Session-Id', 'Origin', 'Accept'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'],
}));

app.onError((err: Error, c: Context) => {
  console.error('Unhandled Error:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

// --- БАЗА ДАННЫХ D1 ---

app.use('/api/*', async (c: Context, next) => {
  c.set('country', c.req.header('CF-IPCountry') || c.req.header('X-Country-Code') || 'XX');
  let sessionId = c.req.header('X-Session-Id') || '';
  if (!sessionId) {
    sessionId = crypto.randomUUID();
  }
  c.set('sessionId', sessionId);
  await next();
});

app.use('/api/user/*', tgAuthMiddleware);

app.post('/api/analytics/track', async (c: Context) => {
  if (!c.env.DB) {
    return c.json({ error: 'Database not available' }, 500);
  }
  const body = await c.req.json().catch(() => ({}));
  const events: AnalyticsEvent[] = Array.isArray(body?.events) ? body.events : body?.events ? [body.events] : [];
  if (events.length === 0) {
    return c.json({ ok: true, count: 0 });
  }

  const country = c.get('country');
  const sessionId = body.session_id || c.get('sessionId') || '';
  const tgUser = c.get('tgUser');
  const bodyUserId = body.user_id != null ? Number(body.user_id) : undefined;

  try {
    const stmt = c.env.DB.prepare(
      `INSERT INTO analytics_events (event_type, country, user_id, session_id, item_type, item_title, item_id, meta, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    );
    const batch = events.map((e) =>
      stmt.bind(
        e.event_type,
        e.country || country,
        e.user_id != null ? e.user_id : (bodyUserId ?? tgUser?.id ?? null),
        e.session_id || sessionId,
        e.item_type || null,
        e.item_title || null,
        e.item_id || null,
        e.meta ? JSON.stringify(e.meta) : null
      )
    );
    await c.env.DB.batch(batch);
    return c.json({ ok: true, count: batch.length });
  } catch (e) {
    console.error('D1 error on analytics track:', e);
    return c.json({ ok: false, count: 0 }, 500);
  }
});

app.get('/api/analytics/stats', async (c: Context) => {
  if (!c.env.DB) {
    return c.json({ error: 'Database not available' }, 500);
  }

  // No Bearer auth on this endpoint: it returns only aggregated, anonymous
  // product statistics (countries, session counts, content titles) for the
  // 3-hour report and is safe to read from the GitHub Actions workflow.
  const since = c.req.query('windowHours') ? Number(c.req.query('windowHours')) : 3;

  try {
    const windowSec = since * 3600;
    const activeUsers = await c.env.DB.prepare(
      `SELECT COUNT(DISTINCT user_id) as users, COUNT(DISTINCT session_id) as sessions, COUNT(*) as events
       FROM analytics_events WHERE ts >= datetime('now', ?)`
    ).bind(`-${since} hours`).first();

    const newUsers = await c.env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM users WHERE created_at >= datetime('now', ?)`
    ).bind(`-${since} hours`).first();

    const byCountry = await c.env.DB.prepare(
      `SELECT country, COUNT(DISTINCT session_id) as users FROM analytics_events
       WHERE event_type = 'visit' AND ts >= datetime('now', ?)
       GROUP BY country ORDER BY users DESC LIMIT 8`
    ).bind(`-${since} hours`).all();

    const topContent = await c.env.DB.prepare(
      `SELECT item_title, item_type, COUNT(*) as opens FROM analytics_events
       WHERE event_type = 'open' AND item_title IS NOT NULL AND item_title != '' AND ts >= datetime('now', ?)
       GROUP BY item_title, item_type ORDER BY opens DESC LIMIT 8`
    ).bind(`-${since} hours`).all();

    const byType = await c.env.DB.prepare(
      `SELECT item_type, COUNT(*) as cnt FROM analytics_events
       WHERE event_type = 'open' AND ts >= datetime('now', ?)
       GROUP BY item_type ORDER BY cnt DESC`
    ).bind(`-${since} hours`).all();

const COUNTRY_NAMES: Record<string, string> = {
  RU: '🇷🇺 Россия',
  KZ: '🇰🇿 Казахстан',
  BY: '🇧🇾 Беларусь',
  UA: '🇺🇦 Украина',
  UZ: '🇺🇿 Узбекистан',
  ID: '🇮🇩 Индонезия',
  DE: '🇩🇪 Германия',
  US: '🇺🇸 США',
  TR: '🇹🇷 Турция',
  TH: '🇹🇭 Таиланд',
  VN: '🇻🇳 Вьетнам',
  GE: '🇬🇪 Грузия',
  AM: '🇦🇲 Армения',
  AZ: '🇦🇿 Азербайджан',
  KG: '🇰🇬 Кыргызстан',
  TJ: '🇹🇯 Таджикистан',
  MD: '🇲🇩 Молдова',
  IL: '🇮🇱 Израиль',
  PL: '🇵🇱 Польша',
  FR: '🇫🇷 Франция',
  GB: '🇬🇧 Великобритания',
  ES: '🇪🇸 Испания',
  IT: '🇮🇹 Италия',
  NL: '🇳🇱 Нидерланды',
  AE: '🇦🇪 ОАЭ',
  CY: '🇨🇾 Кипр',
  RS: '🇷🇸 Сербия',
  ME: '🇲🇪 Черногория',
  BG: '🇧🇬 Болгария',
  FI: '🇫🇮 Финляндия',
  SE: '🇸🇪 Швеция',
  LV: '🇱🇻 Латвия',
  LT: '🇱🇹 Литва',
  EE: '🇪🇪 Эстония',
};

function formatCountry(code?: string): string {
  if (!code || code === 'XX' || code === 'T1') return '🌐 Не определена';
  const upper = code.toUpperCase();
  if (COUNTRY_NAMES[upper]) return COUNTRY_NAMES[upper];
  if (upper.length === 2 && /^[A-Z]{2}$/.test(upper)) {
    const flag = String.fromCodePoint(...upper.split('').map(c => 127397 + c.charCodeAt(0)));
    return `${flag} ${upper}`;
  }
  return upper;
}

    return c.json({
      windowHours: since,
      active: {
        users: activeUsers?.users || 0,
        sessions: activeUsers?.sessions || 0,
        events: activeUsers?.events || 0
      },
      newUsers: newUsers?.cnt || 0,
      byCountry: (byCountry.results || []).map((r: any) => ({
        country: r.country,
        countryName: formatCountry(r.country),
        users: r.users
      })),
      topContent: (topContent.results || []).map((r: any) => ({ title: r.item_title, type: r.item_type, opens: r.opens })),
      byType: (byType.results || []).map((r: any) => ({ type: r.item_type, count: r.cnt }))
    });
  } catch (e) {
    console.error('D1 error on analytics stats:', e);
    return c.json({ error: 'Failed to get analytics stats' }, 500);
  }
});

app.post('/api/user/favorites', async (c: Context) => {
  const user = c.get('tgUser');
  if (!user) {
    return c.json({ error: 'Unauthorized: user not found' }, 401);
  }
  const body = await c.req.json();
  const itemId = String(body.id || body.movieId || body.item_id);
  const type = String(body.type || 'movie');
  const title = body.title || '';
  const poster = body.poster || body.coverUrl || '';
  const year = body.year || '';
  const dataJson = JSON.stringify(body);

  if (!c.env.DB) {
    return c.json({ error: 'Database not available' }, 500);
  }
  if (!itemId) {
    return c.json({ error: 'Item ID is required' }, 400);
  }
  
  try {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO users (telegram_id, first_name) VALUES (?, ?)`
    ).bind(user.id, user.first_name || 'User').run();

    await c.env.DB.prepare(`
      INSERT INTO favorites (telegram_id, item_id, type, title, poster, year, data_json, added_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(telegram_id, item_id, type)
      DO UPDATE SET title = excluded.title, poster = excluded.poster, data_json = excluded.data_json, added_at = CURRENT_TIMESTAMP
    `).bind(user.id, itemId, type, title, poster, year, dataJson).run();
    return c.json({ success: true });
  } catch (e) {
    console.error('D1 error on save favorite:', e);
    return c.json({ error: 'Failed to save favorite' }, 500);
  }
});

app.delete('/api/user/favorites', async (c: Context) => {
  const user = c.get('tgUser');
  if (!user) {
    return c.json({ error: 'Unauthorized: user not found' }, 401);
  }
  const body = await c.req.json();
  const itemId = String(body.id || body.movieId || body.item_id);
  const type = String(body.type || 'movie');

  if (!c.env.DB) {
    return c.json({ error: 'Database not available' }, 500);
  }
  if (!itemId) {
    return c.json({ error: 'Item ID is required' }, 400);
  }

  try {
    await c.env.DB.prepare(
      `DELETE FROM favorites WHERE telegram_id = ? AND item_id = ? AND type = ?`
    ).bind(user.id, itemId, type).run();
    return c.json({ success: true });
  } catch (e) {
    console.error('D1 error on delete favorite:', e);
    return c.json({ error: 'Failed to delete favorite' }, 500);
  }
});

app.get('/api/user/favorites', async (c: Context) => {
  const user = c.get('tgUser');
  if (!user) {
    return c.json({ error: 'Unauthorized: user not found' }, 401);
  }

  if (!c.env.DB) {
    return c.json({ error: 'Database not available' }, 500);
  }

  try {
    const { results } = await c.env.DB.prepare(
      `SELECT item_id as id, type, title, poster, year, data_json FROM favorites WHERE telegram_id = ? ORDER BY added_at DESC`
    ).bind(user.id).all();

    const items = (results || []).map((row: any) => {
      if (row.data_json) {
        try { return JSON.parse(row.data_json); } catch (_) {}
      }
      return row;
    });

    return c.json({ favorites: items });
  } catch (e) {
    console.error('D1 error on get favorites:', e);
    return c.json({ error: 'Failed to get favorites' }, 500);
  }
});

app.post('/api/user/history', async (c: Context) => {
  const user = c.get('tgUser');
  if (!user) {
    return c.json({ error: 'Unauthorized: user not found' }, 401);
  }
  const { itemId, type = 'movie', timecode } = await c.req.json();

  if (!c.env.DB) {
    return c.json({ error: 'Database not available' }, 500);
  }
  if (!itemId) {
    return c.json({ error: 'Item ID is required' }, 400);
  }

  try {
    await c.env.DB.prepare(`
      INSERT INTO history (telegram_id, item_id, type, timecode, updated_at) 
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(telegram_id, item_id, type) 
      DO UPDATE SET timecode = excluded.timecode, updated_at = CURRENT_TIMESTAMP
    `).bind(user.id, String(itemId), type, timecode).run();
    return c.json({ success: true });
  } catch (e) {
    console.error('D1 error on history:', e);
    return c.json({ error: 'Failed to save history' }, 500);
  }
});

// --- RESILIENT LIFTW VIDEO STREAM PROXY ---
function normString(s: string): string {
  return s.toLowerCase().trim().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
}

function cleanWords(s: string): string[] {
  const norm = s.toLowerCase().replace(/ё/g, 'е').replace(/Ё/g, 'е');
  const matches = norm.match(/[a-zа-я0-9]+/g);
  return matches ? Array.from(matches) : [];
}

function matchesWords(itemWords: string[], candWords: string[]): boolean {
  if (candWords.length === 0 || itemWords.length === 0) return false;
  if (candWords.length === 1) {
    const cw = candWords[0];
    if (cw.length < 4) return false;
    return itemWords.includes(cw);
  }
  for (let i = 0; i <= itemWords.length - candWords.length; i++) {
    let match = true;
    for (let j = 0; j < candWords.length; j++) {
      if (itemWords[i + j] !== candWords[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

const LIFTW_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': 'https://liftw.ws/',
  'Origin': 'https://liftw.ws',
};

const DEFAULT_TMDB_API_KEY = 'cd5b69242e715dc87d65957d7460eba2';

app.get('/api/liftw', async (c: Context) => {
  const title = c.req.query('title') || '';
  const yearStr = c.req.query('year') || '';
  const vType = c.req.query('type') || 'movie';
  const tmdb = c.req.query('tmdb') || '';
  const titleRu = c.req.query('title_ru') || '';
  const originalTitle = c.req.query('original_title') || '';
  const bypassCache = c.req.query('bypass_cache') === 'true';

  if (!title) {
    return c.json({ error: 'Title is required' }, 400);
  }

  const cacheKey = `liftw_v3_${normString(title)}_${yearStr}_${vType}_${tmdb}_${normString(titleRu)}`;
  if (!bypassCache && c.env.CACHE) {
    try {
      const cached = await c.env.CACHE.get(cacheKey, 'json');
      if (cached) {
        return c.json(cached);
      }
    } catch (_) {}
  }

  const isSeries = vType === 'tv' || vType === 'series';
  const validTypes = isSeries ? [3, 4, 5, 7] : [1, 2, 6];
  const targetYear = parseInt(yearStr, 10) || 0;

  const rawCandidates = [title, titleRu, originalTitle].map(s => s.trim()).filter(Boolean);
  const candidates = Array.from(new Set(rawCandidates));

  const searchCandidates = async (candList: string[]): Promise<{ id: number; type: number; name: string; origin_name: string; year: number } | null> => {
    for (const cand of candList.slice(0, 6)) {
      try {
        const searchRes = await fetch(`https://api.liftw.ws/search?q=${encodeURIComponent(cand)}`, {
          headers: LIFTW_HEADERS,
          signal: AbortSignal.timeout(5000),
        });
        if (!searchRes.ok) continue;
        const searchData = await searchRes.json() as { items?: any[] };
        const items = searchData.items || [];

        for (const item of items) {
          if (!validTypes.includes(item.type)) continue;

          const nameLower = normString(item.name || '');
          const origLower = normString(item.origin_name || '');
          const itemWords = cleanWords(item.name || '');
          const origWords = cleanWords(item.origin_name || '');
          let isMatch = false;

          for (const c of candList) {
            const cn = normString(c);
            if (!cn) continue;
            // 1. Full string match
            if (nameLower === cn || origLower === cn) {
              isMatch = true;
              break;
            }
            // 2. Slash-separated part match
            for (const part of (item.name || '').split('/')) {
              if (normString(part) === cn) {
                isMatch = true;
                break;
              }
            }
            if (isMatch) break;

            // 3. Sub-sequence word match (e.g. "Ричер" inside "Джек Ричер")
            const cWords = cleanWords(c);
            if (matchesWords(itemWords, cWords) || matchesWords(origWords, cWords)) {
              isMatch = true;
              break;
            }
          }

          if (isMatch) {
            if (targetYear === 0 || (item.year >= targetYear - 1 && item.year <= targetYear + 1)) {
              return item;
            }
          }
        }
      } catch (_) {}
    }
    return null;
  };

  // Step 1: Search direct candidates
  let matchedItem = await searchCandidates(candidates);

  // Step 2: Fallback to TMDB Alternative Titles & Translations
  if (!matchedItem && tmdb) {
    try {
      const tmdbType = isSeries ? 'tv' : 'movie';
      const tmdbUrl = `https://api.themoviedb.org/3/${tmdbType}/${tmdb}?api_key=${DEFAULT_TMDB_API_KEY}&append_to_response=alternative_titles,translations`;
      const tmdbRes = await fetch(tmdbUrl, { signal: AbortSignal.timeout(4000) });
      if (tmdbRes.ok) {
        const tData = await tmdbRes.json() as any;
        const moreCands: string[] = [];
        for (const field of ['title', 'name', 'original_title', 'original_name']) {
          if (tData[field] && typeof tData[field] === 'string') {
            moreCands.push(tData[field].trim());
          }
        }
        for (const r of (tData.alternative_titles?.results || [])) {
          if (r.title && typeof r.title === 'string') moreCands.push(r.title.trim());
        }
        for (const r of (tData.alternative_titles?.titles || [])) {
          if (r.title && typeof r.title === 'string') moreCands.push(r.title.trim());
        }
        for (const tr of (tData.translations?.translations || [])) {
          if (tr.data?.name) moreCands.push(tr.data.name.trim());
          if (tr.data?.title) moreCands.push(tr.data.title.trim());
        }

        const cyr = moreCands.filter(s => /[а-яёА-ЯЁ]/.test(s));
        const lat = moreCands.filter(s => !/[а-яёА-ЯЁ]/.test(s));
        const uniqueMore = Array.from(new Set([...cyr, ...lat])).filter(s => !candidates.includes(s));

        matchedItem = await searchCandidates(uniqueMore);
      }
    } catch (_) {}
  }

  if (!matchedItem) {
    return c.json({ error: 'exact match not found on liftw' }, 404);
  }

  try {
    const infoRes = await fetch(`https://api.liftw.ws/info/${matchedItem.id}`, {
      headers: LIFTW_HEADERS,
      signal: AbortSignal.timeout(7000),
    });
    if (!infoRes.ok) {
      return c.json({ error: 'failed to fetch liftw stream info' }, 502);
    }
    const info = await infoRes.json() as { id: number; type: number; name: string; iframe_uri: string; episodes?: any };
    
    const result: Record<string, any> = {
      liftwId: info.id,
      liftwType: info.type,
      name: info.name,
      iframe: info.iframe_uri,
    };
    if (info.episodes) {
      result.episodes = info.episodes;
    }

    if (c.env.CACHE) {
      try {
        await c.env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 10800 }); // 3 hours
      } catch (_) {}
    }

    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err?.message || 'failed to resolve stream' }, 500);
  }
});

export default app;
