import { Hono, Context } from 'hono';
import { cors } from 'hono/cors';
import { tgAuthMiddleware } from './middleware/auth';

type Bindings = {
  DB: D1Database;
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

export default app;
