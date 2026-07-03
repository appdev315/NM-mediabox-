import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { tgAuthMiddleware } from './middleware/auth';

type Bindings = {
  DB: D1Database;
  CACHE: KVNamespace;
  BALANCER_API_TOKEN: string;
  TELEGRAM_BOT_TOKEN: string;
  HF_BACKEND_URL: string; // e.g. "https://evro90-nm6.hf.space"
};

type Variables = {
  tgUser: { id: number; first_name: string; username?: string };
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use('/api/*', cors());

// --- HELPER: KV Cache Wrapper ---

async function withKVCache<T>(
  kv: KVNamespace,
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  // Try to get from KV cache first
  const cached = await kv.get(key, 'json');
  if (cached !== null) {
    return cached as T;
  }

  // Fetch fresh data
  const data = await fetcher();

  // Store in KV cache (non-blocking)
  const ctx = { waitUntil: (p: Promise<any>) => p }; // Fallback if no ctx
  kv.put(key, JSON.stringify(data), { expirationTtl: ttlSeconds }).catch(() => {});

  return data;
}

// --- ОБРАТНЫЙ ПРОКСИ ---

app.get('/api/search', async (c) => {
  const query = c.req.query('q') || 'matrix';
  const token = c.env.BALANCER_API_TOKEN || 'demo_token';
  const cacheKey = `search_${query}`;

  try {
    const result = await withKVCache(c.env.CACHE, cacheKey, 3600, async () => {
      const response = await fetch(`https://kodikapi.com/search?token=${token}&title=${query}`);
      if (!response.ok) throw new Error('API Error');
      const data: any = await response.json();

      return (data.results || []).map((item: any) => ({
        id: item.id,
        title: item.title,
        year: item.year,
        poster: item.material_data?.poster_url || 'https://via.placeholder.com/300x450?text=No+Poster'
      }));
    });

    return c.json({ results: result });
  } catch (error) {
    return c.json({ results: [{ id: 'demo1', title: 'Demo Movie', year: 2024, poster: 'https://via.placeholder.com/300x450?text=Demo' }] });
  }
});

app.get('/api/movie/:id', async (c) => {
  const movieId = c.req.param('id');
  const token = c.env.BALANCER_API_TOKEN || 'demo_token';
  const cacheKey = `movie_${movieId}`;

  try {
    const result = await withKVCache(c.env.CACHE, cacheKey, 3600, async () => {
      const response = await fetch(`https://kodikapi.com/search?token=${token}&id=${movieId}`);
      const data: any = await response.json();
      const movie = data.results?.[0];

      if (!movie) return null;

      return {
        id: movie.id,
        title: movie.title,
        description: movie.material_data?.description || 'No description available',
        iframe_url: movie.link
      };
    });

    if (!result) return c.json({ error: 'Not found' }, 404);
    return c.json(result);
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

// --- ADULT API PROXY WITH KV CACHE ---
// Scraping stays on HF Spaces (cheerio needs more than 10ms CPU).
// Worker caches responses in KV so repeated requests are instant.

app.get('/api/adult/search', async (c) => {
  const q = c.req.query('q') || '';
  const page = c.req.query('page') || '0';
  const hfUrl = c.env.HF_BACKEND_URL || 'https://evro90-nm6.hf.space';

  // Cache key includes query and page
  const cacheKey = `adult_search_${q}_${page}`;

  try {
    const result = await withKVCache(c.env.CACHE, cacheKey, 300, async () => {
      // Forward auth header to HF backend
      const authHeader = c.req.header('Authorization') || '';
      const res = await fetch(
        `${hfUrl}/api/adult/search?q=${encodeURIComponent(q)}&page=${page}`,
        { headers: { 'Authorization': authHeader } }
      );
      if (!res.ok) throw new Error(`HF Backend error: ${res.status}`);
      return await res.json();
    });

    return c.json(result);
  } catch (error: any) {
    return c.json({ error: error.message || 'Failed to fetch adult content' }, 500);
  }
});

app.get('/api/adult/stream', async (c) => {
  const id = c.req.query('id') || '';
  const hfUrl = c.env.HF_BACKEND_URL || 'https://evro90-nm6.hf.space';

  if (!id) return c.json({ error: 'Missing id' }, 400);

  // Cache stream URLs for 1 hour
  const cacheKey = `adult_stream_${id}`;

  try {
    const result = await withKVCache(c.env.CACHE, cacheKey, 3600, async () => {
      const authHeader = c.req.header('Authorization') || '';
      const res = await fetch(
        `${hfUrl}/api/adult/stream?id=${encodeURIComponent(id)}`,
        { headers: { 'Authorization': authHeader } }
      );
      if (!res.ok) throw new Error(`HF Backend error: ${res.status}`);
      return await res.json();
    });

    return c.json(result);
  } catch (error: any) {
    return c.json({ error: error.message || 'Failed to fetch stream' }, 500);
  }
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
