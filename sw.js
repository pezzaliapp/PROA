// PROA — Service Worker v1.2.0
const CACHE = 'proa-v1.2.0';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './manifest.json',
  './js/main.js',
  './js/modules/state.js',
  './js/modules/utils.js',
  './js/modules/storage.js',
  './js/modules/exports.js',
  './js/modules/ui-tabs.js',
  './js/modules/csv-parser.js',
  './js/modules/preventivo.js',
  './js/modules/trasporto.js',
  './data/pallet_rates_by_region.json',
  './data/groupage_rates.json',
  './data/geo_provinces.json',
  './data/articles.json',
  './icon/icon-192.png',
  './icon/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.3.2/papaparse.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const url of ASSETS) {
        try {
          const res = await fetch(new Request(url, { cache: 'reload' }));
          if (res.ok) await cache.put(url, res);
        } catch (_) {
          // asset non disponibile al primo install: continua
        }
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Navigazione → index.html in networkFirst (per cogliere eventuali nuove versioni subito)
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(new Request('./index.html')));
    return;
  }

  // JSON di tariffe in /data/ → stale-while-revalidate
  // Risposta istantanea dalla cache, aggiornamento in background per il prossimo caricamento.
  if (
    url.origin === self.location.origin &&
    url.pathname.includes('/data/') &&
    url.pathname.endsWith('.json')
  ) {
    e.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Altri file same-origin (JS moduli, CSS, manifest.json) → networkFirst
  // La versione del CACHE garantisce invalidazione ai bump di SW.
  if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(req));
    return;
  }

  // Asset esterni (CDN PapaParse/SheetJS) → cacheFirst (sono immutabili a quel path)
  e.respondWith(cacheFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req, { cache: 'no-store' });
    await cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) || Response.error();
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req, { ignoreSearch: true });
  if (cached) return cached;
  const res = await fetch(req);
  const cache = await caches.open(CACHE);
  await cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  const networkPromise = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  // Se c'è una cache hit, servila subito; il refresh avviene in background.
  // Altrimenti aspetta la network (fallback: errore se offline e niente cache).
  return cached || (await networkPromise) || Response.error();
}

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
