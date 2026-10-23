import type { Context } from 'hono';
import type { AppEnv } from '../types';

/**
 * Безопасная постановка фоновой задачи через waitUntil.
 * В Hono 4.x геттер c.executionCtx бросает исключение вне Workers-рантайма,
 * поэтому опциональная цепочка c.executionCtx?.waitUntil от него не спасает —
 * доступ к executionCtx оборачиваем в try/catch. В production Workers контекст
 * есть всегда, helper страхует только нестандартные рантаймы (тесты, node).
 */
export const safeWaitUntil = (c: Context, promise: Promise<unknown>): void => {
  try {
    c.executionCtx.waitUntil(promise);
  } catch (_) {}
};

/**
 * Constant-time сравнение строк: устраняет timing-атаку на админ-ключ.
 * В workerd доступен crypto.subtle.timingSafeEqual; fallback — ручной XOR-цикл.
 */
export const timingSafeEqualStr = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  try {
    const subtleAny = (crypto.subtle as any);
    if (typeof subtleAny?.timingSafeEqual === 'function') {
      const enc = new TextEncoder();
      return subtleAny.timingSafeEqual(enc.encode(a), enc.encode(b));
    }
  } catch (_) {}
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/**
 * Валидация Bearer токена администратора против ADMIN_API_KEY в безопасном режиме
 */
export const verifyAdminAuth = (c: Context<AppEnv>): boolean => {
  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const secret = c.env.ADMIN_API_KEY || '';
  if (!secret || !token) return false;
  return timingSafeEqualStr(token, secret);
};

/**
 * Нормализация поисковых строк для сопоставления фильмов и треков
 */
export function normString(s: string): string {
  return s.toLowerCase().trim().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
}

/**
 * Извлечение API-ключа TMDB из окружения Cloudflare Workers или process.env
 */
export const getTmdbKey = (c: Context<AppEnv>): string => {
  return c.env?.TMDB_API_KEY || ((globalThis as any).process?.env?.TMDB_API_KEY as string) || '';
};

// Edge-cache namespace. Bump to instantly orphan stale pre-deploy entries
// cv8: Ranked Best-Match scoring, alphabet sanitization and cache purge for substituted series
const EDGE_CACHE_NS = 'cv8';

/**
 * Формирование канонического ключа Cloudflare Edge Cache с версионированием пространства
 */
export function edgeCacheKey(c: Context, url?: string): Request {
  const raw = url || c.req.url;
  const sep = raw.includes('?') ? '&' : '?';
  return new Request(`${raw}${sep}cv=${EDGE_CACHE_NS}`, { method: 'GET' });
}
