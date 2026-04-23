// CSVXpressSmart 2026 + Trasporti — Service Worker v1.0.0
const CACHE = 'csvxpress-tran-v1.0.0';
const ASSETS = [
  './', './index.html', './css/style.css', './js/app.js', './manifest.json',
  './data/pallet_rates_by_region.json', './data/groupage_rates.json', './data/geo_provinces.json', './data/articles.json',
  './icon/icon-192.png', './icon/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.3.2/papaparse.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const url of ASSETS) {
      try { const res = await fetch(new Request(url,{cache:'reload'})); if(res.ok) await cache.put(url,res); } catch(_) {}
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request; if(req.method!=='GET') return;
  const url = new URL(req.url);
  if(req.mode==='navigate'){ e.respondWith(networkFirst(new Request('./index.html'))); return; }
  if(url.pathname.endsWith('.json')){ e.respondWith(networkFirst(req)); return; }
  if(url.origin===self.location.origin){ e.respondWith(networkFirst(req)); return; }
  e.respondWith(cacheFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try { const res=await fetch(req,{cache:'no-store'}); await cache.put(req,res.clone()); return res; }
  catch { return (await cache.match(req,{ignoreSearch:true})) || Response.error(); }
}
async function cacheFirst(req) {
  const cached = await caches.match(req,{ignoreSearch:true}); if(cached) return cached;
  const res = await fetch(req); const cache=await caches.open(CACHE); await cache.put(req,res.clone()); return res;
}
self.addEventListener('message', e => { if(e.data?.type==='SKIP_WAITING') self.skipWaiting(); });
