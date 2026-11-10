const CACHE = "aisb-v2-offline-16";

const SHELL = [
  "./",
  "./index.html",
  "./app.js?v=15",
  "./style.css",
  "./data/repertoire.json",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

const pad2 = n => String(n).padStart(2, "0");
const SHORT_SCORES = Array.from({ length: 50 }, (_, i) => `./partitions/Suite_${pad2(i + 1)}.png`);
const FULL_SCORES = Array.from({ length: 50 }, (_, i) => `./partitions-full/Suite_${pad2(i + 1)}.png`);
const OFFLINE_ASSETS = [...SHELL, ...SHORT_SCORES, ...FULL_SCORES];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(async cache => {
      for (const url of OFFLINE_ASSETS) {
        try {
          const response = await fetch(url, { cache: "reload" });
          if (response.ok) await cache.put(url, response);
        } catch (_) {
          // One missing asset must not prevent the service worker from installing.
        }
      }
    })
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    ])
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Recordings remain online-only and are never cached by this service worker.
  if (url.pathname.toLowerCase().endsWith(".mp3")) return;

  if (url.origin !== self.location.origin) return;

  const isScore = url.pathname.includes("/partitions/") || url.pathname.includes("/partitions-full/");

  if (isScore) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }
        return response;
      }))
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
