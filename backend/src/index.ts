import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { tgAuthMiddleware } from './middleware/auth';

type Bindings = {
  DB: D1Database;
  BALANCER_API_TOKEN: string;
  TELEGRAM_BOT_TOKEN: string;
};

type Variables = {
  tgUser: { id: number; first_name: string; username?: string };
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use('/api/*', cors());

// --- ОБРАТНЫЙ ПРОКСИ ---

app.get('/api/search', async (c) => {
  const query = c.req.query('q') || 'matrix';
  const token = c.env.BALANCER_API_TOKEN || 'demo_token'; // Заглушка, если токен не задан
  
  try {
    const response = await fetch(`https://kodikapi.com/search?token=${token}&title=${query}`);
    if (!response.ok) throw new Error('API Error');
    const data: any = await response.json();
    
    const cleanedResults = (data.results || []).map((item: any) => ({
      id: item.id,
      title: item.title,
      year: item.year,
      poster: item.material_data?.poster_url || 'https://via.placeholder.com/300x450?text=No+Poster'
    }));

    return c.json({ results: cleanedResults });
  } catch (error) {
    // Демонстрационный мок на случай отсутствия ключа от KodikAPI
    return c.json({ results: [{ id: 'demo1', title: 'Demo Movie', year: 2024, poster: 'https://via.placeholder.com/300x450?text=Demo' }] });
  }
});

app.get('/api/movie/:id', async (c) => {
  const movieId = c.req.param('id');
  const token = c.env.BALANCER_API_TOKEN || 'demo_token';
  
  try {
    const response = await fetch(`https://kodikapi.com/search?token=${token}&id=${movieId}`);
    const data: any = await response.json();
    const movie = data.results?.[0];
    
    if (!movie) return c.json({ error: 'Not found' }, 404);

    return c.json({
      id: movie.id,
      title: movie.title,
      description: movie.material_data?.description || 'No description available',
      iframe_url: movie.link
    });
  } catch (error) {
    return c.json({
      id: movieId,
      title: 'Demo Movie',
      description: 'This is a demo description',
      iframe_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ'
    });
  }
});

app.get('/api/recommendations/:id', async (c) => {
  return c.json({ recommendations: [
    { id: 'rec1', title: 'Rec Movie 1', material_data: { poster_url: 'https://via.placeholder.com/150x200?text=R1' } }
  ] });
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
