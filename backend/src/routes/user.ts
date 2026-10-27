import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { tgAuthMiddleware } from '../middleware/auth';
import { safeWaitUntil } from '../utils/helpers';

const ALLOWED_TYPES = ['movie', 'series', 'radio', 'music', 'adult'] as const;

function extractValidItemId(body: any): string | null {
  const candidates = [body?.id, body?.movieId, body?.item_id, body?.itemId];
  for (const val of candidates) {
    if (typeof val === 'string' || typeof val === 'number') {
      const s = String(val).trim();
      if (s && s !== 'undefined' && s !== 'null') {
        return s;
      }
    }
  }
  return null;
}

export const userRouter = new Hono<AppEnv>();

// Защита всех роутов пользователя через Telegram WebApp HMAC-SHA256 подпись
userRouter.use('/*', tgAuthMiddleware);

userRouter.post('/favorites', async (c) => {
  const user = c.get('tgUser');
  if (!user) {
    return c.json({ error: 'Unauthorized: user not found' }, 401);
  }
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Invalid JSON payload' }, 400);
  }
  const rawId = extractValidItemId(body);
  if (!rawId) {
    return c.json({ error: 'Item ID is required' }, 400);
  }
  const type = String(body.type || 'movie').trim();
  if (!ALLOWED_TYPES.includes(type as any)) {
    return c.json({ error: 'Invalid type' }, 400);
  }
  // Для музыкальных треков нормализуем id, отсекая префикс saavn_ для единого формата
  const itemId = type === 'music' ? rawId.replace(/^saavn_/, '') : rawId;
  const title = body.title || body.name || '';
  const poster = body.poster || body.artworkUrl || body.coverUrl || body.logo || '';
  const year = body.year || body.releaseDate || '';
  const dataJson = JSON.stringify({ ...body, id: itemId });
  // Ограничение размера JSON-снапшота (512 КБ max) для защиты базы D1
  if (dataJson.length > 512 * 1024) {
    return c.json({ error: 'Payload too large' }, 413);
  }

  if (!c.env.DB) {
    return c.json({ error: 'Database not available' }, 500);
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

userRouter.delete('/favorites', async (c) => {
  const user = c.get('tgUser');
  if (!user) {
    return c.json({ error: 'Unauthorized: user not found' }, 401);
  }
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Invalid JSON payload' }, 400);
  }
  const rawId = extractValidItemId(body);
  if (!rawId) {
    return c.json({ error: 'Item ID is required' }, 400);
  }
  const type = String(body.type || 'movie').trim();
  if (!ALLOWED_TYPES.includes(type as any)) {
    return c.json({ error: 'Invalid type' }, 400);
  }
  const itemId = type === 'music' ? rawId.replace(/^saavn_/, '') : rawId;

  if (!c.env.DB) {
    return c.json({ error: 'Database not available' }, 500);
  }

  try {
    // Удаляем как нормализованный ID, так и возможную старую запись с префиксом saavn_
    await c.env.DB.prepare(
      `DELETE FROM favorites WHERE telegram_id = ? AND (item_id = ? OR item_id = ('saavn_' || ?)) AND type = ?`
    ).bind(user.id, itemId, itemId, type).run();
    return c.json({ success: true });
  } catch (e) {
    console.error('D1 error on delete favorite:', e);
    return c.json({ error: 'Failed to delete favorite' }, 500);
  }
});

userRouter.delete('/favorites/all', async (c) => {
  const user = c.get('tgUser');
  if (!user) {
    return c.json({ error: 'Unauthorized: user not found' }, 401);
  }
  if (!c.env.DB) {
    return c.json({ error: 'Database not available' }, 500);
  }
  const type = c.req.query('type')?.trim();
  if (type && !ALLOWED_TYPES.includes(type as any)) {
    return c.json({ error: 'Invalid type' }, 400);
  }
  try {
    if (type) {
      await c.env.DB.prepare(
        `DELETE FROM favorites WHERE telegram_id = ? AND type = ?`
      ).bind(user.id, type).run();
    } else {
      await c.env.DB.prepare(
        `DELETE FROM favorites WHERE telegram_id = ?`
      ).bind(user.id).run();
    }
    return c.json({ success: true });
  } catch (e) {
    console.error('D1 error on delete all favorites:', e);
    return c.json({ error: 'Failed to clear favorites' }, 500);
  }
});

userRouter.get('/favorites', async (c) => {
  const user = c.get('tgUser');
  if (!user) {
    return c.json({ error: 'Unauthorized: user not found' }, 401);
  }

  if (!c.env.DB) {
    return c.json({ error: 'Database not available' }, 500);
  }
  try {
    const typeFilter = c.req.query('type')?.trim();
    if (typeFilter && !ALLOWED_TYPES.includes(typeFilter as any)) {
      return c.json({ error: 'Invalid type' }, 400);
    }
    // Защита памяти изолята Worker (128 МБ) от OOM при разрастании списка избранного
    const query = typeFilter
      ? `SELECT item_id as id, type, title, poster, year, data_json FROM favorites WHERE telegram_id = ? AND type = ? ORDER BY added_at DESC LIMIT 500`
      : `SELECT item_id as id, type, title, poster, year, data_json FROM favorites WHERE telegram_id = ? ORDER BY added_at DESC LIMIT 500`;

    const stmt = typeFilter
      ? c.env.DB.prepare(query).bind(user.id, typeFilter)
      : c.env.DB.prepare(query).bind(user.id);

    const { results } = await stmt.all();

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

userRouter.post('/history', async (c) => {
  const user = c.get('tgUser');
  if (!user) {
    return c.json({ error: 'Unauthorized: user not found' }, 401);
  }
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Invalid JSON payload' }, 400);
  }
  const itemId = extractValidItemId(body);
  if (!itemId) {
    return c.json({ error: 'Item ID is required' }, 400);
  }
  const type = String(body.type || 'movie').trim();
  if (!ALLOWED_TYPES.includes(type as any)) {
    return c.json({ error: 'Invalid type' }, 400);
  }
  const timecode = typeof body.timecode === 'number' ? body.timecode : 0;

  if (!c.env.DB) {
    return c.json({ error: 'Database not available' }, 500);
  }

  try {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO users (telegram_id, first_name) VALUES (?, ?)`
    ).bind(user.id, user.first_name || 'User').run();

    await c.env.DB.prepare(`
      INSERT INTO history (telegram_id, item_id, type, timecode, updated_at) 
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(telegram_id, item_id, type) 
      DO UPDATE SET timecode = excluded.timecode, updated_at = CURRENT_TIMESTAMP
    `).bind(user.id, itemId, type, timecode).run();

    // Асинхронный trim истории до 100 последних записей пользователя
    safeWaitUntil(c, (async () => {
      try {
        await c.env.DB.prepare(
          `DELETE FROM history WHERE telegram_id = ? AND id NOT IN (SELECT id FROM history WHERE telegram_id = ? ORDER BY updated_at DESC LIMIT 100)`
        ).bind(user.id, user.id).run();
      } catch (err) {
        console.error('D1 trim history error:', err);
      }
    })());

    return c.json({ success: true });
  } catch (e) {
    console.error('D1 error on history:', e);
    return c.json({ error: 'Failed to save history' }, 500);
  }
});

userRouter.get('/history', async (c) => {
  const user = c.get('tgUser');
  if (!user) {
    return c.json({ error: 'Unauthorized: user not found' }, 401);
  }
  if (!c.env.DB) {
    return c.json({ error: 'Database not available' }, 500);
  }
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT item_id, type, timecode, updated_at FROM history WHERE telegram_id = ? ORDER BY updated_at DESC LIMIT 100`
    ).bind(user.id).all();
    return c.json({ history: results || [] });
  } catch (e) {
    console.error('D1 error on get history:', e);
    return c.json({ error: 'Failed to get history' }, 500);
  }
});

userRouter.delete('/history/all', async (c) => {
  const user = c.get('tgUser');
  if (!user) {
    return c.json({ error: 'Unauthorized: user not found' }, 401);
  }
  if (!c.env.DB) {
    return c.json({ error: 'Database not available' }, 500);
  }
  try {
    await c.env.DB.prepare(
      `DELETE FROM history WHERE telegram_id = ?`
    ).bind(user.id).run();
    return c.json({ success: true });
  } catch (e) {
    console.error('D1 error on delete all history:', e);
    return c.json({ error: 'Failed to clear history' }, 500);
  }
});

