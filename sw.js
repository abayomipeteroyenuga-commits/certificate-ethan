const CACHE_NAME = 'ethan-certificate-v2.0.2-session-recovery';
const APP_SHELL = [
  '/', '/index.html', '/styles.css', '/app.js', '/config.js', '/manifest.webmanifest',
  '/assets/icon-192.png', '/assets/icon-512.png', '/assets/ethan-certificate-logo.png', '/assets/ethan-digital-academy-logo.png', '/assets/certificate-seal.svg'
];
const NETWORK_FIRST_PATHS = new Set(['/index.html', '/app.js', '/config.js', '/styles.css']);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/')) return;

  // Always try the newest application shell first. Fall back to the current
  // cache only when the network is unavailable, preventing stale JS from
  // surviving a production hotfix.
  if (NETWORK_FIRST_PATHS.has(url.pathname)) {
    event.respondWith(
      fetch(req)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          }
          return response;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
      }
      return response;
    }))
  );
});
