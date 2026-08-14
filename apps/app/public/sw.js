/* Esoko service worker — hand-rolled, dependency-free.
 * Runs in the worker global scope, not the page — ESLint's no-undef
 * doesn't know the worker globals, so it is disabled here.
 *
 * Strategy (matches the connectivity banner + /offline page):
 *   - _next/static/*          → cache-first (immutable, hashed)
 *   - icons, manifest         → stale-while-revalidate
 *   - navigations             → network-first, cached on success, with a
 *                               served-from-cache fallback, then /offline
 *   - everything else         → network only (never cached: RSC payloads,
 *                               documents, anything sensitive)
 *   - anything non-GET        → never intercepted. A signature or
 *                               contribution can never be replayed stale.
 *
 * Version everything through CACHE_VERSION so an app update cleanly
 * replaces the lot on activate.
 */
const CACHE_VERSION = 'esoko-2026-08-14-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const NAV_CACHE = `${CACHE_VERSION}-nav`;
const OFFLINE_URL = '/offline';
/* eslint-disable no-undef */

const CORE = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(CORE))
      .catch(() => {
        /* a failed core fetch must not block activation forever */
      }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, res.clone());
  }
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || refresh;
}

/* Keep the navigation cache small — a few dozen pages is plenty for a
 * record product, and it stops the cache silently eating a low-end
 * phone's storage. */
const MAX_NAV_ENTRIES = 40;

async function trimNavCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_NAV_ENTRIES) return;
  await cache.delete(keys[0]);
  await trimNavCache(cache);
}

async function navigationHandler(request) {
  const cache = await caches.open(NAV_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) {
      cache.put(request, res.clone());
      trimNavCache(cache);
    }
    return res;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(request));
    return;
  }

  if (
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest'
  ) {
    event.respondWith(staleWhileRevalidate(request));
  }
});