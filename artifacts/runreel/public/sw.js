const CACHE_VERSION = "runreel-v36";
const ASSET_CACHE = CACHE_VERSION;
const TILE_CACHE = "runreel-tiles-v1";

// ── Install: precache minimal shell ──────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(ASSET_CACHE).then((cache) =>
      cache.addAll(["/manifest.json"]).catch(() => {})
    )
  );
  // Activate immediately — don't wait for old tabs to close
  self.skipWaiting();
});

// ── Activate: delete stale caches ────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== ASSET_CACHE && k !== TILE_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  // Take control of all open pages immediately
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Map tiles (OpenFreeMap / OSM): cache-first, long-lived
  if (
    url.hostname.includes("openfreemap.org") ||
    url.hostname.includes("openstreetmap.org")
  ) {
    event.respondWith(tileFirst(request));
    return;
  }

  // 2. API calls: always network, never cache
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // 3. HTML navigation: ALWAYS network-first
  //    Never serve cached HTML — ensures fresh asset references after deploy
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then((c) => c ?? new Response("Offline", { status: 503 }))
      )
    );
    return;
  }

  // 4. Immutable versioned assets (Vite adds 8+ char hash to filename)
  //    e.g. index-Bx3kLpQr.js  — safe to cache forever
  if (/\.[0-9a-f]{8,}\.(js|css|woff2?)$/i.test(url.pathname)) {
    event.respondWith(immutableAsset(request));
    return;
  }

  // 5. Everything else (images, icons, etc.): network-first, cache as fallback
  event.respondWith(networkFirst(request));
});

// ── Strategies ────────────────────────────────────────────────────────────────

async function tileFirst(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response("", { status: 503 });
  }
}

async function immutableAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(ASSET_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok && request.method === "GET") {
      const cache = await caches.open(ASSET_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached ?? new Response("Offline", { status: 503 });
  }
}
