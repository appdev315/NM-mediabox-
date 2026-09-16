import { useSyncExternalStore } from 'react';

/**
 * Stream availability registry (player confirmation without extra requests).
 *
 * Outcomes of the already-flying prewarm checks are recorded here as
 * `available | missing` with timestamps. Cards and search read statuses
 * for honest badges/ranking; nothing here performs network requests.
 * `unknown` means "no fresh knowledge" and is never persisted.
 */

export type AvailStatus = 'available' | 'missing' | 'unknown';

interface AvailEntry {
  status: 'available' | 'missing';
  ts: number;
}

const LS_KEY = 'mb_avail_v1';
const MAX_ENTRIES = 150;
const TTL_MS: Record<'available' | 'missing', number> = {
  available: 24 * 3600 * 1000, // 24h — aligns with positive stream cache reads
  missing: 2 * 3600 * 1000, // 2h — short negative cache, manual retry bypasses
};

const mem = new Map<string, AvailEntry>();
const listeners = new Set<() => void>();
let hydrated = false;
let version = 0;

function normType(type?: string): string {
  return type === 'series' || type === 'tv' ? 'tv' : 'movie';
}

function entryKey(type: string | number | undefined, id: string | number): string {
  return `${normType(typeof type === 'string' ? type : 'movie')}:${String(id)}`;
}

function emit(): void {
  version++;
  listeners.forEach((l) => {
    try {
      l();
    } catch (_) {}
  });
}

function persist(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    // Map preserves insertion order — keep the freshest MAX_ENTRIES
    const entries = Array.from(mem.entries()).slice(-MAX_ENTRIES);
    if (mem.size > MAX_ENTRIES) {
      for (const [k] of Array.from(mem.keys()).slice(0, mem.size - MAX_ENTRIES)) {
        mem.delete(k);
      }
    }
    window.localStorage.setItem(LS_KEY, JSON.stringify(entries));
  } catch (_) {}
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return;
    const entries = JSON.parse(raw) as [string, AvailEntry][];
    if (!Array.isArray(entries)) return;
    const now = Date.now();
    for (const [k, e] of entries.slice(-MAX_ENTRIES)) {
      if (!e || (e.status !== 'available' && e.status !== 'missing')) continue;
      if (typeof e.ts !== 'number' || now - e.ts > TTL_MS[e.status]) continue;
      mem.set(k, e);
    }
  } catch (_) {}
}

export function getAvailability(type: string | undefined, id: string | number | undefined): AvailStatus {
  if (id === undefined || id === '') return 'unknown';
  hydrate();
  const k = entryKey(type, id);
  const e = mem.get(k);
  if (!e) return 'unknown';
  if (Date.now() - e.ts > TTL_MS[e.status]) {
    mem.delete(k);
    return 'unknown';
  }
  // Refresh LRU position
  mem.delete(k);
  mem.set(k, e);
  return e.status;
}

export function setAvailability(
  type: string | undefined,
  id: string | number,
  status: 'available' | 'missing'
): void {
  hydrate();
  mem.set(entryKey(type, id), { status, ts: Date.now() });
  persist();
  emit();
}

export function clearAvailability(type: string | undefined, id: string | number): void {
  hydrate();
  if (mem.delete(entryKey(type, id))) {
    persist();
    emit();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Global monotonic counter bumped on every status write. Use to re-sort lists. */
export function useAvailabilityVersion(): number {
  hydrate();
  return useSyncExternalStore(subscribe, () => version);
}

/** Reactive availability status for badges and ranking. Never fetches. */
export function useAvailability(type: string | undefined, id: string | number | undefined): AvailStatus {
  hydrate();
  const k = entryKey(type, id ?? '');
  const status = useSyncExternalStore(subscribe, () => {
    const e = mem.get(k);
    if (!e) return 'unknown' as AvailStatus;
    if (Date.now() - e.ts > TTL_MS[e.status]) return 'unknown' as AvailStatus;
    return e.status as AvailStatus;
  });
  if (id === undefined || id === '') return 'unknown';
  return status;
}
