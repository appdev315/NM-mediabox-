import { Hono } from 'hono';
import type { AppEnv, AnalyticsEvent } from '../types';
import { safeWaitUntil, verifyAdminAuth, normString } from '../utils/helpers';

export const analyticsRouter = new Hono<AppEnv>();

// Жёсткое ограничение длины полей аналитики для защиты от write-амплификации D1
const clampStr = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.slice(0, max);
  return s.length > 0 ? s : null;
};

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

// Трекинг пользовательских событий (до 100 событий в пакете)
analyticsRouter.post('/analytics/track', async (c) => {
  if (!c.env.DB) {
    return c.json({ error: 'Database not available' }, 500);
  }
  const body = await c.req.json().catch(() => ({}));
  const rawEvents: AnalyticsEvent[] = Array.isArray(body?.events) ? body.events : body?.events ? [body.events] : [];
  const events = rawEvents.slice(0, 100);
  if (events.length === 0) {
    return c.json({ ok: true, count: 0 });
  }

  const country = clampStr(c.get('country'), 8);
  const sessionId = clampStr(body.session_id || c.get('sessionId') || '', 100) || '';
  const tgUser = c.get('tgUser');
  const bodyUserId = body.user_id != null ? Number(body.user_id) : undefined;

  try {
    const stmt = c.env.DB.prepare(
      `INSERT INTO analytics_events (event_type, country, user_id, session_id, item_type, item_title, item_id, meta, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    );
    const batch = events.map((e) =>
      stmt.bind(
        clampStr(e.event_type, 40) || 'unknown',
        e.country ? clampStr(e.country, 8) : country,
        e.user_id != null ? e.user_id : (bodyUserId ?? tgUser?.id ?? null),
        e.session_id ? clampStr(e.session_id, 100) : sessionId,
        clampStr(e.item_type, 20),
        clampStr(e.item_title, 300),
        clampStr(e.item_id, 120),
        clampStr(typeof e.meta === 'string' ? e.meta : e.meta ? JSON.stringify(e.meta) : '', 2000)
      )
    );
    await c.env.DB.batch(batch);
    return c.json({ ok: true, count: batch.length });
  } catch (e) {
    console.error('D1 error on analytics track:', e);
    return c.json({ ok: false, count: 0 }, 500);
  }
});

// Агрегированная статистика для мониторинга
analyticsRouter.get('/analytics/stats', async (c) => {
  if (!c.env.DB) {
    return c.json({ error: 'Database not available' }, 500);
  }

  const rawSince = Number(c.req.query('windowHours')) || 3;
  const since = Math.min(Math.max(1, Math.floor(rawSince)), 168);

  try {
    const activeUsers = await c.env.DB.prepare(
      `SELECT COUNT(DISTINCT user_id) as users, COUNT(DISTINCT session_id) as sessions, COUNT(*) as events
       FROM analytics_events WHERE ts >= datetime('now', ?)`
    ).bind(`-${since} hours`).first() as { users?: number; sessions?: number; events?: number } | null;

    const newUsers = await c.env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM users WHERE created_at >= datetime('now', ?)`
    ).bind(`-${since} hours`).first() as { cnt?: number } | null;

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
    const donorRate: number | null = donorTotal > 0 ? Number(((donorOk / donorTotal) * 100).toFixed(1)) : null;

    const playbackErrTotalRow = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM analytics_events
       WHERE event_type = 'error' AND item_type IN ('movie', 'tv') AND ts >= datetime('now', ?)`
    ).bind(`-${since} hours`).first() as { total?: number } | null;

    const playbackErrTop = await c.env.DB.prepare(
      `SELECT item_title, item_type, meta, COUNT(*) as cnt FROM analytics_events
       WHERE event_type = 'error' AND item_type IN ('movie', 'tv') AND ts >= datetime('now', ?)
       GROUP BY item_title, item_type, meta ORDER BY cnt DESC LIMIT 5`
    ).bind(`-${since} hours`).all();

    const radioErrTotalRow = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM analytics_events
       WHERE event_type = 'error' AND item_type = 'radio' AND ts >= datetime('now', ?)`
    ).bind(`-${since} hours`).first() as { total?: number } | null;

    const radioErrTop = await c.env.DB.prepare(
      `SELECT item_title, meta, COUNT(*) as cnt FROM analytics_events
       WHERE event_type = 'error' AND item_type = 'radio' AND ts >= datetime('now', ?)
       GROUP BY item_title, meta ORDER BY cnt DESC LIMIT 5`
    ).bind(`-${since} hours`).all();

    const musicErrTotalRow = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM analytics_events
       WHERE event_type = 'error' AND item_type = 'music' AND ts >= datetime('now', ?)`
    ).bind(`-${since} hours`).first() as { total?: number } | null;

    const musicErrTop = await c.env.DB.prepare(
      `SELECT item_title, meta, COUNT(*) as cnt FROM analytics_events
       WHERE event_type = 'error' AND item_type = 'music' AND ts >= datetime('now', ?)
       GROUP BY item_title, meta ORDER BY cnt DESC LIMIT 5`
    ).bind(`-${since} hours`).all();

    // D1 Auto-Retention: очистка записей старше 30 дней строго по Bearer токену администратора
    if (c.env.DB && verifyAdminAuth(c)) {
      safeWaitUntil(c, (async () => {
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
      playbackErrors: {
        total: playbackErrTotalRow?.total || 0,
        top: (playbackErrTop.results || []).map((r: any) => ({ title: r.item_title, type: r.item_type, reason: r.meta, count: r.cnt }))
      },
      radioErrors: {
        total: radioErrTotalRow?.total || 0,
        top: (radioErrTop.results || []).map((r: any) => ({ title: r.item_title, reason: r.meta, count: r.cnt }))
      },
      musicErrors: {
        total: musicErrTotalRow?.total || 0,
        top: (musicErrTop.results || []).map((r: any) => ({ title: r.item_title, reason: r.meta, count: r.cnt }))
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

// Диагностика инцидентов парсинга (требует ADMIN_API_KEY)
analyticsRouter.get('/admin/incidents', async (c) => {
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
    const fixRate: number | null = total > 0 ? Number(((autoFixed / total) * 100).toFixed(1)) : null;

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

// Инвалидация Edge Cache и синхронизация кэша микросервиса HuggingFace
analyticsRouter.post('/cache/purge', async (c) => {
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
  const rawLiftwId = String(body.liftw_id || body.liftwId || c.req.query('liftw_id') || c.req.query('liftwId') || '');
  const liftwId = rawLiftwId ? rawLiftwId.replace(/^liftw_/, '') : '';

  if (!tmdb && !title && !liftwId) {
    return c.json({ error: 'tmdb, title or liftw_id is required for cache purge' }, 400);
  }

  const canonicalType = (type === 'tv' || type === 'series') ? 'tv' : 'movie';
  const edgeCache = (caches as any).default;
  const parsedUrl = new URL(c.req.url);

  const purgedUrls: string[] = [];
  const origins = Array.from(new Set([parsedUrl.origin, 'https://media-box.xyz', 'https://www.media-box.xyz']));

  for (const orig of origins) {
    if (liftwId) {
      const liftwUrl = `${orig}/api/liftw?liftw_id=${encodeURIComponent(liftwId)}`;
      try {
        await edgeCache.delete(new Request(liftwUrl, { method: 'GET' }));
        if (!purgedUrls.includes(liftwUrl)) purgedUrls.push(liftwUrl);
      } catch (_) {}
    }
    if (tmdb) {
      const canonicalUrl = `${orig}/api/liftw?tmdb=${encodeURIComponent(tmdb)}&type=${canonicalType}`;
      try {
        await edgeCache.delete(new Request(canonicalUrl, { method: 'GET' }));
        if (!purgedUrls.includes(canonicalUrl)) purgedUrls.push(canonicalUrl);
      } catch (_) {}
    }
    if (title) {
      const titleUrl = `${orig}/api/liftw?title=${encodeURIComponent(normString(title))}&year=${encodeURIComponent(year)}&type=${canonicalType}`;
      try {
        await edgeCache.delete(new Request(titleUrl, { method: 'GET' }));
        if (!purgedUrls.includes(titleUrl)) purgedUrls.push(titleUrl);
      } catch (_) {}
    }
  }

  const hfBase = c.env.HF_BACKEND_URL || 'https://evro90-nm6.hf.space';
  const hfParams = new URLSearchParams({
    tmdb: tmdb || '',
    type: canonicalType,
    title: title || '',
    year: year || '',
    bypass_cache: 'true'
  });
  safeWaitUntil(c, (async () => {
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
