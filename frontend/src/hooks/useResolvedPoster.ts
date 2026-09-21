import { useEffect, useState } from 'react';
import { CF_API_BASE } from './useApi';
import { clientCache } from '../utils/clientCache';
import { isNonRussianLang } from '../utils/mediaUtils';

const NEGATIVE_MARKER = '__none__';
const CACHE_TTL_SECONDS = 2592000; // 30 days: TMDB posters are immutable

function normalizeKeyPart(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

function cacheKeyFor(title: string, year: string, type: string): string {
  return `poster_en_${normalizeKeyPart(title)}_${year}_${type}`;
}

function isTmdbPoster(poster: unknown): boolean {
  return typeof poster === 'string' && poster.includes('/t/p/');
}

/**
 * Lazily resolves an English TMDB poster for non-Russian locales.
 * Returns the resolved URL or null (caller keeps the donor poster).
 * Never throws, never blocks rendering: donor poster stays until resolved.
 */
export function useResolvedPoster(item: any, language: string): string | null {
  const rawPoster = item?.poster;
  const queryTitle: string = item?.origin_name || item?.original_title || item?.original_name || '';
  const year: string = String(item?.year || '');
  const type: string = item?.type === 'series' || item?.media_type === 'tv' ? 'tv' : 'movie';

  const shouldResolve =
    isNonRussianLang(language) &&
    !isTmdbPoster(rawPoster) &&
    queryTitle.trim().length > 0 &&
    /^\d{4}$/.test(year);

  const cacheKey = shouldResolve ? cacheKeyFor(queryTitle, year, type) : null;
  const [resolved, setResolved] = useState<string | null>(() => {
    if (!cacheKey) return null;
    try {
      const cached = clientCache.get<string>(cacheKey);
      if (!cached || cached === NEGATIVE_MARKER) return null;
      return cached;
    } catch (_) {
      return null;
    }
  });

  useEffect(() => {
    if (!shouldResolve || !cacheKey) return;
    let cancelled = false;
    try {
      const cached = clientCache.get<string>(cacheKey);
      if (cached) {
        if (cached !== NEGATIVE_MARKER && !cancelled) setResolved(cached);
        return;
      }
    } catch (_) {}

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    fetch(
      `${CF_API_BASE}/poster/resolve?title=${encodeURIComponent(queryTitle)}&year=${encodeURIComponent(year)}&type=${encodeURIComponent(type)}`,
      { signal: ctrl.signal }
    )
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: any) => {
        if (cancelled) return;
        if (data?.poster && typeof data.poster === 'string') {
          try {
            clientCache.set(cacheKey, data.poster, CACHE_TTL_SECONDS);
          } catch (_) {}
          setResolved(data.poster);
        } else {
          try {
            clientCache.set(cacheKey, NEGATIVE_MARKER, CACHE_TTL_SECONDS);
          } catch (_) {}
        }
      })
      .catch(() => {
        // Keep donor poster; a later mount (new TTL window) will retry.
        // Deliberately NOT caching failures to allow retry on next view.
      })
      .finally(() => clearTimeout(timer));

    return () => {
      cancelled = true;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [shouldResolve, cacheKey, queryTitle, year, type]);

  return resolved;
}
