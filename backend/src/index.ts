import { Hono, Context } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv } from './types';
import { analyticsRouter } from './routes/analytics';
import { userRouter } from './routes/user';
import { moviesRouter } from './routes/movies';
import { catalogRouter } from './routes/catalog';
import { musicRouter } from './routes/music';

const app = new Hono<AppEnv>();

// Глобальный CORS
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

// Централизованный обработчик необработанных ошибок
app.onError((err: Error, c: Context) => {
  console.error('Unhandled Error:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

// Middleware контекста запроса (страна по гео-IP Cloudflare, сквозной идентификатор сессии)
app.use('/api/*', async (c: Context, next) => {
  c.set('country', c.req.header('CF-IPCountry') || c.req.header('X-Country-Code') || 'XX');
  let sessionId = c.req.header('X-Session-Id') || '';
  if (!sessionId) {
    sessionId = crypto.randomUUID();
  }
  c.set('sessionId', sessionId);
  await next();
});

// Монтирование изолированных суб-роутеров
app.route('/api/user', userRouter);
app.route('/', analyticsRouter);
app.route('/', moviesRouter);
app.route('/', catalogRouter);
app.route('/', musicRouter);

export default app;
