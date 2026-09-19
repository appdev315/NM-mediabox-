import { Hono, Context } from 'hono';
import { cors } from 'hono/cors';
import { tgAuthMiddleware } from './middleware/auth';

type Bindings = {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  BOT_TOKEN_MAIN?: string;
  BOT_TOKEN?: string;
  ALLOWED_ORIGIN?: string;
  TMDB_API_KEY?: string;
  HF_BACKEND_URL?: string;
  ADMIN_API_KEY?: string;
};

const verifyAdminAuth = (c: Context): boolean => {
  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const secret = (c.env as Bindings).ADMIN_API_KEY || 'mb_admin_sec_2026';
  return Boolean(token && token === secret);
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
    return null;
  },
  allowHeaders: ['Content-Type', 'Authorization', 'X-Session-Id', 'Origin', 'Accept', 'X-App-Client', 'X-Client-Time', 'Range'],
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
  const rawEvents: AnalyticsEvent[] = Array.isArray(body?.events) ? body.events : body?.events ? [body.events] : [];
  const events = rawEvents.slice(0, 100);
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
  const rawSince = Number(c.req.query('windowHours')) || 3;
  const since = Math.min(Math.max(1, Math.floor(rawSince)), 168);

  try {
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

    const donorRow = await c.env.DB.prepare(
      `SELECT 
         COUNT(*) as total,
         SUM(CASE WHEN meta = 'liftw_ok' THEN 1 ELSE 0 END) as ok,
         SUM(CASE WHEN meta = 'liftw_fail' THEN 1 ELSE 0 END) as fail
       FROM analytics_events 
       WHERE event_type = 'donor_hit' AND ts >= datetime('now', ?)`
    ).bind(`-${since} hours`).first() as { total?: number; ok?: number; fail?: number } | null;

    const donorTotal = donorRow?.total || 0;
    const donorOk = donorRow?.ok || 0;
    const donorFail = donorRow?.fail || 0;
    const donorRate = donorTotal > 0 ? Number(((donorOk / donorTotal) * 100).toFixed(1)) : 100.0;

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

    // D1 Auto-Retention Policy: Clean up rows older than 30 days asynchronously in background
    if (c.env.DB && c.executionCtx?.waitUntil) {
      c.executionCtx.waitUntil((async () => {
        try {
          await c.env.DB.batch([
            c.env.DB.prepare("DELETE FROM analytics_events WHERE ts < datetime('now', '-30 days')"),
            c.env.DB.prepare("DELETE FROM parsing_incidents WHERE ts < datetime('now', '-30 days')")
          ]);
        } catch (_) {}
      })());
    }

    return c.json({
      windowHours: since,
      active: {
        users: activeUsers?.users || 0,
        sessions: activeUsers?.sessions || 0,
        events: activeUsers?.events || 0
      },
      newUsers: newUsers?.cnt || 0,
      donorStats: {
        liftw: {
          requests: donorTotal,
          success: donorOk,
          fails: donorFail,
          rate: donorRate
        }
      },
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

// --- AUTONOMOUS SYSADMIN & DIAGNOSTICS ---
app.get('/api/admin/incidents', async (c: Context) => {
  if (!verifyAdminAuth(c)) {
    return c.json({ error: 'Unauthorized: valid Bearer ADMIN_API_KEY required' }, 401);
  }
  if (!c.env.DB) {
    return c.json({ error: 'Database not available' }, 500);
  }

  const rawSince = Number(c.req.query('windowHours')) || 3;
  const since = Math.min(Math.max(1, Math.floor(rawSince)), 168);

  try {
    const totalRow = (await c.env.DB.prepare(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN status = 'auto_fixed' THEN 1 ELSE 0 END) as auto_fixed,
              SUM(CASE WHEN status = 'unresolved' THEN 1 ELSE 0 END) as unresolved,
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
       FROM parsing_incidents WHERE ts >= datetime('now', ?)`
    ).bind(`-${since} hours`).first()) as { total?: number; auto_fixed?: number; unresolved?: number; pending?: number } | null;

    const total = totalRow?.total || 0;
    const autoFixed = totalRow?.auto_fixed || 0;
    const unresolved = totalRow?.unresolved || 0;
    const pending = totalRow?.pending || 0;
    const fixRate = total > 0 ? Number(((autoFixed / total) * 100).toFixed(1)) : 100.0;

    const topUnresolved = (await c.env.DB.prepare(
      `SELECT title, content_type, fail_type, heal_note, COUNT(*) as cnt
       FROM parsing_incidents
       WHERE ts >= datetime('now', ?) AND status = 'unresolved'
       GROUP BY title, content_type, fail_type
       ORDER BY cnt DESC LIMIT 5`
    ).bind(`-${since} hours`).all()) as { results?: { title: string; content_type: string; fail_type: string; heal_note: string; cnt: number }[] };

    return c.json({
      windowHours: since,
      total,
      autoFixed,
      unresolved,
      pending,
      fixRate,
      topUnresolved: topUnresolved.results || []
    }, 200, {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    });
  } catch (err: any) {
    console.error('[Sysadmin] Failed to fetch incidents stats:', err);
    return c.json({ error: 'Failed to fetch incidents stats' }, 500);
  }
});

// --- ADMIN CACHE PURGE & HF SYNC ---
app.post('/api/cache/purge', async (c: Context) => {
  if (!verifyAdminAuth(c)) {
    return c.json({ error: 'Unauthorized: valid Bearer ADMIN_API_KEY required' }, 401);
  }

  let body: any = {};
  try {
    body = await c.req.json();
  } catch (_) {}

  const tmdb = String(body.tmdb || c.req.query('tmdb') || '');
  const type = String(body.type || c.req.query('type') || 'movie');
  const title = String(body.title || c.req.query('title') || '');
  const year = String(body.year || c.req.query('year') || '');

  if (!tmdb && !title) {
    return c.json({ error: 'tmdb or title is required for cache purge' }, 400);
  }

  const canonicalType = (type === 'tv' || type === 'series') ? 'tv' : 'movie';
  const edgeCache = (caches as any).default;
  const parsedUrl = new URL(c.req.url);

  const purgedUrls: string[] = [];

  // 1. Purge canonical Edge cache
  if (tmdb) {
    const canonicalUrl = `${parsedUrl.origin}/api/liftw?tmdb=${encodeURIComponent(tmdb)}&type=${canonicalType}`;
    try {
      await edgeCache.delete(new Request(canonicalUrl, { method: 'GET' }));
      purgedUrls.push(canonicalUrl);
    } catch (_) {}
  }

  // 2. Purge title-based legacy Edge cache if title provided
  if (title) {
    const titleUrl = `${parsedUrl.origin}/api/liftw?title=${encodeURIComponent(normString(title))}&year=${encodeURIComponent(year)}&type=${canonicalType}`;
    try {
      await edgeCache.delete(new Request(titleUrl, { method: 'GET' }));
      purgedUrls.push(titleUrl);
    } catch (_) {}
  }

  // 3. Ping HuggingFace microservice to purge its in-memory Go cache
  const hfBase = (c.env as Bindings).HF_BACKEND_URL || 'https://evro90-nm6.hf.space';
  const hfParams = new URLSearchParams({
    tmdb: tmdb || '',
    type: canonicalType,
    title: title || '',
    year: year || '',
    bypass_cache: 'true'
  });
  c.executionCtx.waitUntil((async () => {
    try {
      await fetch(`${hfBase}/liftw?${hfParams.toString()}`, {
        signal: AbortSignal.timeout(4000)
      });
    } catch (_) {}
  })());

  return c.json({
    success: true,
    purgedUrls,
    message: 'Edge cache invalidated and HF microservice sync triggered'
  }, 200, {
    'Cache-Control': 'no-store, no-cache, must-revalidate'
  });
});

app.post('/api/user/favorites', async (c: Context) => {
  const user = c.get('tgUser');
  if (!user) {
    return c.json({ error: 'Unauthorized: user not found' }, 401);
  }
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Invalid JSON payload' }, 400);
  }
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
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Invalid JSON payload' }, 400);
  }
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
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Invalid JSON payload' }, 400);
  }
  const { itemId, type = 'movie', timecode } = body;

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
    if (cw.length < 2) return false;
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
  }
  return Array.from(result);
}

const LIFTW_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': 'https://liftw.ws/',
  'Origin': 'https://liftw.ws',
};

const getTmdbKey = (c: Context): string => {
  return (c.env as any)?.TMDB_API_KEY || ((globalThis as any).process?.env?.TMDB_API_KEY as string) || '';
};

app.get('/api/liftw', async (c: Context) => {
  const title = c.req.query('title') || '';
  const yearStr = c.req.query('year') || '';
  const vType = c.req.query('type') || 'movie';
  const tmdb = c.req.query('tmdb') || '';
  const titleRu = c.req.query('title_ru') || '';
  const originalTitle = c.req.query('original_title') || '';
  const bypassCache = c.req.query('bypass_cache') === 'true';
  const rawLiftwId = c.req.query('liftw_id') || c.req.query('liftwId') || '';
  const liftwIdParam = rawLiftwId ? rawLiftwId.replace(/^liftw_/, '') : '';

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

  const cacheReq = new Request(canonicalUrl, { method: 'GET' });
  const edgeCache = (caches as any).default;

  // Donor metric recorder: tracks real Liftw stream resolutions for the 3-hour report
  const recordDonorMetric = (status: 'liftw_ok' | 'liftw_fail') => {
    if (!c.env.DB || !c.executionCtx?.waitUntil) return;
    c.executionCtx.waitUntil((async () => {
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
      // Dual check legacy key during migration period
      if (canonicalUrl !== legacyKeyUrl) {
        const legacyCached = await edgeCache.match(new Request(legacyKeyUrl, { method: 'GET' }));
        if (legacyCached) {
          return legacyCached;
        }
      }
    } catch (_) {}
  } else {
    // Dual delete on cache bypass
    try {
      c.executionCtx.waitUntil(edgeCache.delete(cacheReq));
      if (canonicalUrl !== legacyKeyUrl) {
        c.executionCtx.waitUntil(edgeCache.delete(new Request(legacyKeyUrl, { method: 'GET' })));
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
          const directCacheTtl = canonicalType === 'tv' ? 1800 : 2592000; // 30m for TV (rapid ongoing episode pickup), 30d for Movies
          const directHeaders: Record<string, string> = {
            'Cache-Control': `public, max-age=${directCacheTtl}, s-maxage=${directCacheTtl}`,
            'Access-Control-Allow-Origin': '*',
          };
          const directResponse = c.json(directResult, 200, directHeaders);
          try {
            c.executionCtx.waitUntil(edgeCache.put(cacheReq, directResponse.clone()));
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

  const searchCandidates = async (candList: string[], strictType = true): Promise<{ id: number; type: number; name: string; origin_name: string; year: number } | null> => {
    const list = candList.slice(0, 8);
    if (list.length === 0) return null;

    // Parallel fetch across all candidate queries for instant sub-second matching
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

    for (const item of allItems) {
      if (strictType && !validTypes.includes(item.type)) continue;

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
        // Flexible +/- 2 year allowance for international festival & documentary release disparities
        if (targetYear === 0 || (item.year >= targetYear - 2 && item.year <= targetYear + 2)) {
          return item;
        }
      }
    }
    return null;
  };

  // Step 1: Search direct candidates (strict type)
  let matchedItem = await searchCandidates(candidates, true);
  let healNote = '';

  // Step 2: Fallback to TMDB Alternative Titles & Translations
  if (!matchedItem && tmdb) {
    try {
      const tmdbType = canonicalType === 'tv' ? 'tv' : 'movie';
      const tmdbKey = getTmdbKey(c);
      const tmdbUrl = `https://api.themoviedb.org/3/${tmdbType}/${tmdb}?api_key=${tmdbKey}&append_to_response=alternative_titles,translations`;
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
        const uniqueMore = expandTitleVariants(Array.from(new Set([...cyr, ...lat])).filter(s => !candidates.includes(s)));

        matchedItem = await searchCandidates(uniqueMore, true);
        if (matchedItem) {
          healNote = 'TMDB alt titles (strict)';
        } else {
          // If still not matched with strict types, try relaxed types for alternative titles
          matchedItem = await searchCandidates(uniqueMore, false);
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

  // Autonomous Sysadmin Incident logger (non-blocking via executionCtx)
  const recordIncident = (failType: string, status: string, note?: string) => {
    if (!c.env.DB) return;
    // Guard: Only record incidents for verified cinema catalog items with numeric TMDB or numeric Liftw ID.
    // Arbitrary user search terms, adult keywords (ep_*, rt_*), or non-catalog items must NEVER pollute parsing_incidents.
    const isNumericTmdb = Boolean(tmdb && /^\d+$/.test(tmdb));
    const isNumericLiftw = Boolean(liftwIdParam && /^\d+$/.test(liftwIdParam));
    if (!isNumericTmdb && !isNumericLiftw) return;
    if (vType === 'adult' || tmdb.startsWith('ep_') || tmdb.startsWith('rt_')) return;
    c.executionCtx.waitUntil((async () => {
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
      c.executionCtx.waitUntil((async () => {
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
      c.executionCtx.waitUntil(edgeCache.put(cacheReq, response.clone()));
    } catch (_) {}

    return response;
  } catch (err: any) {
    recordIncident('timeout', 'unresolved', err?.message || 'stream resolve error');
    return c.json({ error: err?.message || 'failed to resolve stream' }, 500, {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    });
  }
});

const mapLiftwItem = (item: any, isTv?: boolean, searchScore?: number) => {
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
  if (item.original_language === 'ru') return true;
  const oc = item.origin_country;
  if (Array.isArray(oc) && (oc.includes('RU') || oc.includes('SU'))) return true;
  const pc = item.production_countries;
  if (Array.isArray(pc) && pc.some((cc: any) => cc?.iso_3166_1 === 'RU' || cc?.iso_3166_1 === 'SU')) return true;
  const countries = item.country || item.countries;
  if (Array.isArray(countries) && countries.some((cc: any) => /^(Россия|СССР|Russia|Soviet Union)$/i.test(String(cc).trim()))) return true;
  const origin = (item.original_name || item.original_title || item.origin_name || '').trim();
  const title = (item.title || item.name || '').trim();
  if (/[а-яё]/i.test(title) && !/[a-z]/i.test(origin)) return true;
  return false;
}

export function isNonRussianLang(lang: string): boolean {
  return !String(lang || '').toLowerCase().startsWith('ru');
}

// --- DIRECT LIFTW CATALOG SEARCH ---
app.get('/api/search/liftw', async (c: Context) => {
  const query = (c.req.query('q') || c.req.query('query') || '').trim();
  const vType = c.req.query('type') || '';
  const lang = c.req.query('lang') || 'ru-RU';
  if (!query) {
    return c.json({ results: [] });
  }

  const edgeCache = (caches as any).default;
  const parsedUrl = new URL(c.req.url);
  const cacheKeyUrl = `${parsedUrl.origin}/api/search/liftw?q=${encodeURIComponent(query.toLowerCase())}&type=${encodeURIComponent(vType)}&lang=${encodeURIComponent(lang)}`;
  const cacheReq = new Request(cacheKeyUrl, { method: 'GET' });

  try {
    const cached = await edgeCache.match(cacheReq);
    if (cached) return cached;
  } catch (_) {}

  try {
    const res = await fetch(`https://api.liftw.ws/search?q=${encodeURIComponent(query)}`, {
      headers: LIFTW_HEADERS,
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return c.json({ results: [] });
    }

    const data = await res.json() as { items?: any[] };
    const items = data.items || [];

    // Filter by type if provided (Movies: [1, 2, 6], Series: [3, 4, 5, 7])
    let filtered = items;
    if (vType === 'movie') {
      filtered = items.filter(it => [1, 2, 6].includes(it.type));
    } else if (vType === 'tv' || vType === 'series') {
      filtered = items.filter(it => [3, 4, 5, 7].includes(it.type));
    }

    const results = filtered
      .map(it => mapLiftwItem(it, undefined, it.search_score ?? 0))
      .filter(Boolean)
      .filter((it: any) => !isNonRussianLang(lang) || !isRussianOrigin(it));

    const response = c.json({ results }, 200, {
      'Cache-Control': 'public, max-age=1800, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
    });

    try {
      c.executionCtx.waitUntil(edgeCache.put(cacheReq, response.clone()));
    } catch (_) {}

    return response;
  } catch (err: any) {
    return c.json({ results: [], error: err?.message }, 500);
  }
});

// --- TMDB EDGE IMAGE PROXY (Global CDN & anti-blocking) ---
app.get('/api/image', async (c: Context) => {
  const path = c.req.query('path');
  if (!path || !path.startsWith('/') || path.includes('..') || !/^\/t\/p\/(w\d+|original)\/[\w\-./]+$/i.test(path)) {
    return c.text('Invalid path', 400);
  }

  const tmdbImageUrl = `https://image.tmdb.org${path}`;

  // Check Cloudflare Cache API for instant 0ms edge response
  const cache = (caches as any).default;
  const cacheKey = new Request(c.req.url, c.req.raw);
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

    c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err: any) {
    return c.text(`Image proxy error: ${err?.message || 'unknown'}`, 502);
  }
});

// --- TMDB EDGE API PROXY (Edge Caching & Global Fallback) ---
app.get('/api/tmdb/*', async (c: Context) => {
  const url = new URL(c.req.url);
  // Extract endpoint path after /api/tmdb
  const endpoint = url.pathname.replace(/^\/api\/tmdb/, '');
  if (!endpoint || endpoint === '/') {
    return c.json({ error: 'Endpoint required' }, 400);
  }

  // Guard against oversized search queries (prevents HTTP 414 from TMDB)
  const searchQuery = url.searchParams.get('query');
  if ((searchQuery && searchQuery.length > 150) || url.search.length > 2048) {
    return c.json({ page: 1, results: [], total_pages: 0, total_results: 0 });
  }

  // Check Cloudflare Edge Cache API for instant response
  const cache = (caches as any).default;
  const cacheKey = new Request(c.req.url, c.req.raw);
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

    c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
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
app.get('/api/feed/trailers', async (c: Context) => {
  const lang = c.req.query('lang') || 'ru-RU';
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);

  const edgeCache = (caches as any).default;
  const cacheReq = new Request(c.req.url, { method: 'GET' });

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
        const ytVideos = videos.filter((v: any) => v.site === 'YouTube' && v.key);
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
      c.executionCtx.waitUntil(edgeCache.put(cacheReq, response.clone()));
    } catch (_) {}

    return response;
  } catch (err: any) {
    return c.json({ error: err?.message || 'Failed to build trailer feed' }, 500);
  }
});

app.get('/api/feed/home', async (c: Context) => {
  const type = (c.req.query('type') === 'tv' ? 'tv' : 'movie');
  const lang = c.req.query('lang') || 'ru-RU';
  const edgeCache = (caches as any).default;
  const cacheReq = new Request(c.req.url, { method: 'GET' });

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
    const genreCategories = isTv ? [
      { id: '10759', name: lang.startsWith('ru') ? 'Боевики и Приключения' : 'Action & Adventure', liftwGenre: 'Боевик' },
      { id: '35', name: lang.startsWith('ru') ? 'Комедии' : 'Comedy', liftwGenre: 'Комедия' },
      { id: '18', name: lang.startsWith('ru') ? 'Драмы' : 'Drama', liftwGenre: 'Драма' },
      { id: '53', name: lang.startsWith('ru') ? 'Триллеры' : 'Thriller', liftwGenre: 'Триллер' },
      { id: '10765', name: lang.startsWith('ru') ? 'Фантастика и Фэнтези' : 'Sci-Fi & Fantasy', liftwGenre: 'Фантастика' },
      { id: '9648', name: lang.startsWith('ru') ? 'Детективы' : 'Mystery', liftwGenre: 'Детектив' },
      { id: '16', name: lang.startsWith('ru') ? 'Мультсериалы' : 'Animation', liftwGenre: 'Мультфильм' },
      { id: '80', name: lang.startsWith('ru') ? 'Криминал' : 'Crime', liftwGenre: 'Криминал' },
      { id: '10751', name: lang.startsWith('ru') ? 'Семейные' : 'Family', liftwGenre: 'Семейный' },
    ] : [
      { id: '28', name: lang.startsWith('ru') ? 'Боевики' : 'Action', liftwGenre: 'Боевик' },
      { id: '35', name: lang.startsWith('ru') ? 'Комедии' : 'Comedy', liftwGenre: 'Комедия' },
      { id: '18', name: lang.startsWith('ru') ? 'Драмы' : 'Drama', liftwGenre: 'Драма' },
      { id: '53', name: lang.startsWith('ru') ? 'Триллеры' : 'Thriller', liftwGenre: 'Триллер' },
      { id: '878', name: lang.startsWith('ru') ? 'Фантастика' : 'Sci-Fi', liftwGenre: 'Фантастика' },
      { id: '9648', name: lang.startsWith('ru') ? 'Детективы' : 'Mystery', liftwGenre: 'Детектив' },
      { id: '12', name: lang.startsWith('ru') ? 'Приключения' : 'Adventure', liftwGenre: 'Приключения' },
      { id: '16', name: lang.startsWith('ru') ? 'Мультфильмы' : 'Animation', liftwGenre: 'Мультфильм' },
      { id: '80', name: lang.startsWith('ru') ? 'Криминал' : 'Crime', liftwGenre: 'Криминал' },
      { id: '27', name: lang.startsWith('ru') ? 'Ужасы' : 'Horror', liftwGenre: 'Ужасы' },
      { id: '10751', name: lang.startsWith('ru') ? 'Семейные' : 'Family', liftwGenre: 'Семейный' },
      { id: '10749', name: lang.startsWith('ru') ? 'Мелодрамы' : 'Romance', liftwGenre: 'Мелодрама' },
    ];

    const genrePromises = genreCategories.map(async (cat) => {
      try {
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

    const response = c.json(payload, 200, {
      'Cache-Control': 'public, max-age=1800, s-maxage=43200',
    });

    try {
      c.executionCtx.waitUntil(edgeCache.put(cacheReq, response.clone()));
    } catch (_) {}

    return response;
  } catch (err: any) {
    return c.json({ error: err?.message || 'failed to load home feed' }, 500);
  }
});

// --- PURE LIFTW CATALOG LIST (PAGINATION, GENRES, IN-STOCK ONLY) ---
app.get('/api/catalog/list', async (c: Context) => {
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
  const cacheReq = new Request(c.req.url, { method: 'GET' });

  try {
    const cachedResponse = await edgeCache.match(cacheReq);
    if (cachedResponse) return cachedResponse;
  } catch (_) {}

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
      c.executionCtx.waitUntil(edgeCache.put(cacheReq, response.clone()));
    } catch (_) {}

    return response;
  } catch (_) {
    return c.json([], 200);
  }
});

export default app;
