const CACHE_NAME = 'mediabox-v5';
const OFFLINE_FALLBACK = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(['/favicon.svg', OFFLINE_FALLBACK]);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Single-Instance Window Focus Support for PWA launches
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'FOCUS_OR_OPEN') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow('/');
        }
      })
    );
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 1. Bypass Service Worker caching for Media Streams (Video/Audio) and Range HTTP Requests
  if (
    url.pathname.endsWith('.m3u8') ||
    url.pathname.endsWith('.ts') ||
    url.pathname.endsWith('.mp4') ||
    url.pathname.endsWith('.m4s') ||
    url.pathname.endsWith('.mp3') ||
    url.pathname.endsWith('.aac') ||
    url.pathname.endsWith('.ogg') ||
    url.pathname.endsWith('.wav') ||
    event.request.destination === 'audio' ||
    event.request.destination === 'video' ||
    event.request.headers.has('range')
  ) {
    return; // Direct network pass-through
  }

  // 2. Bypass heavy image binary blobs from CacheStorage
  if (
    url.hostname === 'image.tmdb.org' ||
    url.pathname.includes('/image') ||
    event.request.destination === 'image'
  ) {
    return;
  }

  // 3. Navigation Requests (HTML / Page Loads) -> Strictly Network-First!
  // This guarantees new Vite chunk hashes are loaded immediately on deploy,
  // while falling back to cached index.html only when completely offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => cached || caches.match(OFFLINE_FALLBACK));
        })
    );
    return;
  }

  // 4. Stale-While-Revalidate for local JS/CSS hashed assets
  if (url.origin === location.origin && (url.pathname.startsWith('/assets/') || url.pathname.endsWith('.js') || url.pathname.endsWith('.css'))) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        }).catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
  }
});
