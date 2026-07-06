import { Hono } from 'hono';
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
  origin: (origin) => {
    // Only allow web.telegram.org or your frontend
    const allowed = ['https://web.telegram.org', 'https://media-box.xyz', 'https://www.media-box.xyz'];
    if (origin && (allowed.includes(origin) || origin.includes('localhost'))) {
        return origin;
    }
    return 'https://web.telegram.org';
  },
}));

app.onError((err, c) => {
  console.error('Unhandled Error:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

// --- БАЗА ДАННЫХ D1 ---

app.use('/api/user/*', tgAuthMiddleware);

app.post('/api/user/favorites', async (c) => {
  const user = c.get('tgUser') || { id: 1, first_name: 'DemoUser' };
  const { movieId } = await c.req.json();
  
  if (c.env.DB) {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO users (telegram_id, first_name) VALUES (?, ?)`
    ).bind(user.id, user.first_name).run();

    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO favorites (telegram_id, movie_id) VALUES (?, ?)`
    ).bind(user.id, movieId).run();
  }
  
  return c.json({ success: true });
});

app.get('/api/user/favorites', async (c) => {
  const user = c.get('tgUser') || { id: 1 };
  
  if (c.env.DB) {
    const { results } = await c.env.DB.prepare(
      `SELECT movie_id FROM favorites WHERE telegram_id = ? ORDER BY added_at DESC`
    ).bind(user.id).all();
    return c.json({ favorites: results });
  }
  
  return c.json({ favorites: [] });
});

app.post('/api/user/history', async (c) => {
  const user = c.get('tgUser') || { id: 1 };
  const { movieId, timecode } = await c.req.json();
  
  if (c.env.DB) {
    await c.env.DB.prepare(`
      INSERT INTO history (telegram_id, movie_id, timecode, updated_at) 
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(telegram_id, movie_id) 
      DO UPDATE SET timecode = excluded.timecode, updated_at = CURRENT_TIMESTAMP
    `).bind(user.id, movieId, timecode).run();
  }
  
  return c.json({ success: true });
});

export default app;
