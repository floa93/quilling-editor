// Service worker: lets the installed app open offline.
// Network-first: online users always get the latest deployment; the cache is only a fallback.
const CACHE = 'quilling-editor-v1';
const CORE = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'icons/icon.svg',
  'src/app.js', 'src/geometry.js', 'src/history.js', 'src/icons.js', 'src/model.js',
  'src/renderer.js', 'src/storage.js', 'src/svg.js', 'src/templates.js', 'src/xml.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(CORE.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      }),
  );
});
