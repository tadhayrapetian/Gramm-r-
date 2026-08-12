// Offline support. Everything the app needs is a handful of static files and no API,
// so the whole thing is cached on install and served cache-first.

const CACHE = 'grammar-ink-v1';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/app.css',
  './icons/icon.svg',
  './icons/icon-maskable.svg',
  './src/main.js',
  './src/state.js',
  './src/i18n.js',
  './src/data/lessons.js',
  './src/data/lexicon.js',
  './src/data/icons.js',
  './src/ink/geometry.js',
  './src/ink/alphabet.js',
  './src/ink/recognizer.js',
  './src/ink/segment.js',
  './src/ink/decode.js',
  './src/ink/surface.js',
  './src/ui/dom.js',
  './src/ui/home.js',
  './src/ui/lesson.js',
  './src/ui/calibrate.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(
      (hit) =>
        hit ||
        fetch(event.request)
          .then((response) => {
            // Keep the cache fresh for anything fetched after install.
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
            return response;
          })
          .catch(() => caches.match('./index.html')),
    ),
  );
});
