import { Hono, Context } from 'hono';
import { cors } from 'hono/cors';
import { tgAuthMiddleware } from './middleware/auth';

type Bindings = {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  ALLOWED_ORIGIN?: string;
};

type Variables = {
  tgUser: { id: number; first_name: string; username?: string };
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use('/api/*', cors({
  origin: (origin: string) => {
    // Only allow web.telegram.org or your frontend
    const allowed = ['https://web.telegram.org', 'https://media-box.xyz', 'https://www.media-box.xyz'];
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    if (origin && (allowed.includes(origin) || isLocalhost)) {
        return origin;
    }
    return 'https://web.telegram.org';
  },
}));

app.onError((err: Error, c: Context) => {
  console.error('Unhandled Error:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

// --- БАЗА ДАННЫХ D1 ---

app.use('/api/user/*', tgAuthMiddleware);

app.post('/api/user/favorites', async (c: Context) => {
  const user = c.get('tgUser') || { id: 1, first_name: 'Guest' };
  const body = await c.req.json();
  const itemId = String(body.id || body.movieId || body.item_id);
  const type = String(body.type || 'movie');
  const title = body.title || '';
  const poster = body.poster || body.coverUrl || '';
  const year = body.year || '';
  const dataJson = JSON.stringify(body);

  if (c.env.DB && itemId) {
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
    } catch (e) {
      console.error('D1 error on save favorite:', e);
    }
  }

  return c.json({ success: true });
});

app.delete('/api/user/favorites', async (c: Context) => {
  const user = c.get('tgUser') || { id: 1 };
  const body = await c.req.json();
  const itemId = String(body.id || body.movieId || body.item_id);
  const type = String(body.type || 'movie');

  if (c.env.DB && itemId) {
    try {
      await c.env.DB.prepare(
        `DELETE FROM favorites WHERE telegram_id = ? AND item_id = ? AND type = ?`
      ).bind(user.id, itemId, type).run();
    } catch (e) {
      console.error('D1 error on delete favorite:', e);
    }
  }

  return c.json({ success: true });
});

app.get('/api/user/favorites', async (c: Context) => {
  const user = c.get('tgUser') || { id: 1 };

  if (c.env.DB) {
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
    }
  }

  return c.json({ favorites: [] });
});

app.post('/api/user/history', async (c: Context) => {
  const user = c.get('tgUser') || { id: 1 };
  const { itemId, type = 'movie', timecode } = await c.req.json();

  if (c.env.DB && itemId) {
    try {
      await c.env.DB.prepare(`
        INSERT INTO history (telegram_id, item_id, type, timecode, updated_at) 
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(telegram_id, item_id, type) 
        DO UPDATE SET timecode = excluded.timecode, updated_at = CURRENT_TIMESTAMP
      `).bind(user.id, String(itemId), type, timecode).run();
    } catch (e) {
      console.error('D1 error on history:', e);
    }
  }

  return c.json({ success: true });
});

export default app;
