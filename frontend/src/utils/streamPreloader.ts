import { CF_API_BASE, EXPRESS_API_BASE } from '../hooks/useApi';
import { clientCache } from './clientCache';
import { fetchWithRetry } from './fetchWithRetry';

// Map of active in-flight stream promises shared across card clicks and Movie.tsx
export const inFlightStreamMap = new Map<string, Promise<any>>();

export interface StreamItemMeta {
  title?: string;
  name?: string;
  year?: string | number;
  type?: string;
  original_title?: string;
  original_name?: string;
  title_ru?: string;
}

/**
 * Pre-warms video stream upon card click or component mount.
 * Non-blocking, saves result directly to clientCache.
 */
export function prewarmStream(
  id: string | number,
  item: StreamItemMeta,
  language = 'ru-RU'
): Promise<any> {
  if (!id) return Promise.resolve(null);

  const rawType = item.type || 'movie';
  const resolvedType = (rawType === 'series' || rawType === 'tv') ? 'tv' : 'movie';
  const streamCacheKey = `liftw_stream_v2_${id}_${resolvedType}`;

  // 1. Instant check in clientCache
  const cached = clientCache.get<any>(streamCacheKey);
  if (cached && cached.iframe) {
    return Promise.resolve(cached);
  }

  // 2. Reuse active in-flight request if already kicked off
  if (inFlightStreamMap.has(streamCacheKey)) {
    return inFlightStreamMap.get(streamCacheKey)!;
  }

  const title = item.title || item.name || '';
  if (!title) return Promise.resolve(null);

  const orig = item.original_title || item.original_name || '';
  const ru = language === 'ru-RU' ? (item.title_ru || title) : '';

  const bgQuery = new URLSearchParams({
    title,
    year: String(item.year || ''),
    type: resolvedType,
    tmdb: String(id),
    title_ru: ru,
    original_title: orig,
  }).toString();

  const promise = (async () => {
    try {
      // Parallel race between Cloudflare Edge and Express backup
      const cfPromise = fetchWithRetry(`${CF_API_BASE}/liftw?${bgQuery}`, {
        maxRetries: 1,
        baseDelayMs: 200,
        maxDelayMs: 600,
      }).then(r => r.ok ? r.json() : null).catch(() => null);

      const hfPromise = fetchWithRetry(`${EXPRESS_API_BASE}/liftw?${bgQuery}`, {
        maxRetries: 1,
        baseDelayMs: 200,
        maxDelayMs: 600,
      }).then(r => r.ok ? r.json() : null).catch(() => null);

      const data = await Promise.any([
        cfPromise.then(res => (res && res.iframe ? res : Promise.reject())),
        hfPromise.then(res => (res && res.iframe ? res : Promise.reject())),
      ]).catch(async () => {
        return (await cfPromise) || (await hfPromise);
      });

      if (data && data.iframe) {
        clientCache.set(streamCacheKey, data, 7200); // 2 hours TTL
      }
      return data;
    } catch (_) {
      return null;
    } finally {
      inFlightStreamMap.delete(streamCacheKey);
    }
  })();

  inFlightStreamMap.set(streamCacheKey, promise);
  return promise;
}
