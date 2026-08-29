import { WebApp } from '../telegram';
import { CF_API_BASE } from '../hooks/useApi';

interface AnalyticsPayload {
  event_type: string;
  item_type?: string;
  item_title?: string;
  item_id?: string;
}

const FLUSH_INTERVAL_MS = 3 * 1000;
const MAX_BATCH = 20;

let queue: AnalyticsPayload[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let sessionId = '';

function getSessionId(): string {
  if (sessionId) return sessionId;
  try {
    const stored = window.localStorage.getItem('mb_session_id');
    if (stored) {
      sessionId = stored;
      return sessionId;
    }
    sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    window.localStorage.setItem('mb_session_id', sessionId);
  } catch (e) {
    sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  return sessionId;
}

function getUserId(): number | undefined {
  try {
    const user = WebApp?.initDataUnsafe?.user as any;
    return user?.id;
  } catch (e) {
    return undefined;
  }
}

function flush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (queue.length === 0) return;

  const events = queue;
  queue = [];

  const body = JSON.stringify({
    session_id: getSessionId(),
    user_id: getUserId(),
    events,
  });
  try {
    if (typeof navigator.sendBeacon === 'function') {
      const ok = navigator.sendBeacon(`${CF_API_BASE}/analytics/track`, new Blob([body], { type: 'application/json' }));
      if (ok) return;
    }
    void fetch(`${CF_API_BASE}/analytics/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': getSessionId(),
      },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch (e) {
    /* analytics must never break the app */
  }
}

function scheduleFlush() {
  if (!flushTimer) {
    flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
  }
}

function scheduleBeaconFlush() {
  flush();
}

export function track(event_type: string, payload: Partial<AnalyticsPayload> = {}) {
  queue.push({ event_type, ...payload });
  if (queue.length >= MAX_BATCH) {
    flush();
  } else {
    scheduleFlush();
  }
}

export function trackVisit() {
  track('visit');
}

export function trackOpen(item_type: string, item_title: string, item_id?: string) {
  track('open', { item_type, item_title, item_id });
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => scheduleBeaconFlush());
  window.addEventListener('beforeunload', () => scheduleBeaconFlush());
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      scheduleBeaconFlush();
    }
  });
}
