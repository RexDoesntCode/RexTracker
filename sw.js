// Rex Tracker — Service Worker
// Strategy:
//  - HTML/navigation: network-first with cache fallback (offline).
//  - Same-origin static: stale-while-revalidate.
//  - Cross-origin CDN (Tailwind/fonts/etc.): stale-while-revalidate.
//  - Supabase requests: pass straight through to network, untouched.
//    (No respondWith() call = browser fetches exactly as if no SW existed.)
//    We simply don't cache API responses, so sync sees fresh data.
// Bump CACHE_VERSION on each deploy to force refresh.

const CACHE_VERSION = 'rex-tracker-v3.9';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon-48.png',
  './app-icon-192.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache =>
      Promise.all(APP_SHELL.map(url =>
        cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
      ))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isNavigation(req) {
  return req.mode === 'navigate' ||
    (req.method === 'GET' && (req.headers.get('accept') || '').includes('text/html'));
}

// Supabase API endpoints (*.supabase.co) — auth, REST, storage, realtime.
// We intentionally do NOT cache these. But we also do NOT block them.
// Returning without respondWith() means: "browser, handle this normally".
function isSupabaseApi(url) {
  return url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' && !isSupabaseApi(new URL(req.url))) return;

  const url = new URL(req.url);

  // ── Supabase: network-only, no caching, no interception ──
  // This is the line that keeps cloud sync working correctly.
  // The request reaches Supabase exactly as the app sent it.
  if (isSupabaseApi(url)) return;

  // ── HTML navigation: network-first, cache fallback for offline ──
  if (isNavigation(req)) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then(c => c.put('./index.html', copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  // ── Everything else (static + CDN): stale-while-revalidate ──
  event.respondWith(
    caches.match(req).then(cached => {
      const fetchPromise = fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
