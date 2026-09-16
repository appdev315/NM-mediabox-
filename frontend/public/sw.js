const CACHE_NAME = 'mediabox-v18';
const IMG_CACHE_NAME = 'mediabox-img-v1';
const MAX_CACHED_IMAGES = 80;
const OFFLINE_FALLBACK = '/index.html';
const PROXY_IMAGE_BASE = 'https://api.media-box.xyz/api/image';

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
          if (key !== CACHE_NAME && key !== IMG_CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

async function trimCache(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      const itemsToDelete = keys.slice(0, keys.length - maxItems);
      await Promise.all(itemsToDelete.map((key) => cache.delete(key)));
    }
  } catch (_) {}
}

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

  // 2. Dedicated Image Caching: Direct-First with Proxy Fallback on Failure
  if (
    url.hostname === 'image.tmdb.org' ||
    url.pathname.includes('/api/image') ||
    event.request.destination === 'image'
  ) {
    event.respondWith(
      caches.open(IMG_CACHE_NAME).then(async (imgCache) => {
        // A. Check device CacheStorage (0ms disk hit, 0 Worker requests)
        const cached = await imgCache.match(event.request);
        if (cached) {
          return cached;
        }

        // B. Direct-First with Proxy Fallback on network failure
        let response = null;

        if (url.hostname === 'image.tmdb.org') {
          try {
            // Direct CDN attempt
            const directRes = await fetch(event.request);
            if (directRes && (directRes.ok || directRes.type === 'opaque')) {
              response = directRes;
            }
          } catch (_) {}

          // Fallback to Edge Proxy if direct attempt failed
          if (!response) {
            try {
              const proxyUrl = `${PROXY_IMAGE_BASE}?path=${encodeURIComponent(url.pathname)}`;
              const proxyRes = await fetch(proxyUrl);
              if (proxyRes && (proxyRes.ok || proxyRes.type === 'opaque')) {
                response = proxyRes;
              }
            } catch (_) {}
          }
        } else {
          // Direct fetch for /api/image or other image assets
          try {
            const res = await fetch(event.request);
            if (res && (res.ok || res.type === 'opaque')) {
              response = res;
            }
          } catch (_) {}
        }

        if (response && (response.ok || response.type === 'opaque')) {
          const clone = response.clone();
          imgCache.put(event.request, clone).then(() => {
            trimCache(IMG_CACHE_NAME, MAX_CACHED_IMAGES);
          }).catch(() => {});
          return response;
        }

        // Final fallback if both failed
        return response || fetch(event.request);
      })
    );
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
