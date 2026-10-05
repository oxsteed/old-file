/* OxSteed Service Worker */

// The registration query carries the release SHA, so each deployment gets
// isolated caches without a manually maintained version constant.
const CACHE_VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const STATIC_CACHE  = `oxsteed-static-${CACHE_VERSION}`;

// Shell assets to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/offline.html',
];

// ── Install: pre-cache shell ───────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ─────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('oxsteed-') && k !== STATIC_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
    // Navigation preload reclaims the service-worker startup tax on
    // navigations: the browser fetches the document in parallel while
    // the worker boots, instead of waiting for it.
    .then(() => {
      if (self.registration.navigationPreload) {
        return self.registration.navigationPreload.enable();
      }
    })
    .catch(() => { /* preload is a progressive enhancement */ })
  );
});

// ── Precache channel ─────────────────────────────────────────────────────────
// The page posts its current asset URLs on idle so the worker caches them
// proactively: { type: 'precache', urls: [...] }. Only same-origin GET
// asset URLs are accepted; money-route API responses are never cached.
self.addEventListener('message', event => {
  const msg = event.data;
  if (!msg || msg.type !== 'precache' || !Array.isArray(msg.urls)) return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(STATIC_CACHE);
      for (const raw of msg.urls.slice(0, 40)) {
        try {
          const url = new URL(raw, self.location.origin);
          if (url.origin !== self.location.origin) continue;
          if (!/\.(js|css|woff2?|ttf|otf|png|jpg|jpeg|svg|ico|webp)$/.test(url.pathname)) continue;
          if (url.pathname.startsWith('/api/')) continue;
          const req = new Request(url.href, { mode: 'no-cors' });
          const hit = await cache.match(req);
          if (!hit) {
            const res = await fetch(req);
            if (res.ok) await cache.put(req, res.clone());
          }
        } catch { /* one bad URL must not break the batch */ }
      }
    } catch { /* cache failures are non-fatal */ }
  })());
});

// ── Fetch strategy ────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept non-GET, chrome-extension, or cross-origin requests
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js') return;

  // API responses contain account-specific and financial data. Never persist
  // them or replay a previous account's response after a session change.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkOnly(request));
    return;
  }

  // Static assets: network-first so a deployment cannot keep serving a
  // broken or stale module from a long-lived cache. Cached assets remain the
  // offline fallback when the network is unavailable.
  if (
    (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) &&
    url.pathname.match(/\.(js|css|woff2?|ttf|otf|png|jpg|jpeg|svg|ico|webp)$/)
  ) {
    event.respondWith(networkFirst(request, STATIC_CACHE));
    return;
  }

  // Do not turn socket handshakes, uploads, or non-document requests into HTML.
  if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(event, request));
  }
});

// ── Strategy helpers ──────────────────────────────────────────────────────────

async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch {
    return new Response(JSON.stringify({ error: 'You are offline.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok && !request.headers.has('Authorization') &&
        !/no-store|private/i.test(response.headers.get('Cache-Control') || '')) {
      try {
        const cache = await caches.open(cacheName);
        await cache.put(request, response.clone());
      } catch { /* Cache failures must not discard a successful network response. */ }
    }
    return response;
  } catch {
    let cached;
    try { cached = await caches.match(request); } catch { /* Cache unavailable. */ }
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'You are offline.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function navigationHandler(event, request) {
  try {
    // Use the preloaded response when the browser fetched the document in
    // parallel during worker startup; fall back to a live fetch.
    try {
      const preloaded = await event.preloadResponse;
      if (preloaded) return preloaded;
    } catch { /* preload unavailable; fall through to fetch */ }
    return await fetch(request);
  } catch {
    // Keep application HTML network-first so a deployment can publish a new
    // asset manifest without an older route shell masking it.
    let offline;
    try { offline = await caches.match('/offline.html'); } catch { /* Cache unavailable. */ }
    return offline || new Response('Offline. Please reconnect and try again.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}

// ── Web Push (VAPID) ─────────────────────────────────────────────────────────
//
// Payload shape (sent by server/services/webPushService.js):
//   { id, type, title, body, data, action_url }
//
// We always show a notification - Chrome enforces this for push events on
// userVisibleOnly subscriptions. Failing to call showNotification() can cause
// the browser to revoke the subscription.

self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'OxSteed', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'OxSteed';
  const options = {
    body:    payload.body || '',
    icon:    '/icons/icon-192.png',
    badge:   '/icons/icon-192.png',
    tag:     payload.type || 'oxsteed',
    renotify: true,
    data: {
      action_url: payload.action_url || '/',
      type:       payload.type || null,
      id:         payload.id || null,
      ...(payload.data || {}),
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  // Validate action_url is same-origin or a simple path - never javascript: or data: URIs.
  const rawTarget = (event.notification.data && event.notification.data.action_url) || '/';
  let target = '/';
  try {
    const parsed = new URL(rawTarget, self.location.origin);
    if (parsed.origin === self.location.origin) {
      target = parsed.pathname + parsed.search + parsed.hash;
    }
  } catch {
    // rawTarget was already a relative path (URL constructor threw) - use it directly
    // only if it looks safe (starts with /).
    if (typeof rawTarget === 'string' && rawTarget.startsWith('/')) {
      target = rawTarget;
    }
  }

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    // Reuse an existing tab on the same origin.
    for (const client of allClients) {
      try {
        const url = new URL(client.url);
        if (url.origin === self.location.origin) {
          await client.focus();
          if ('navigate' in client) {
            try { await client.navigate(target); } catch { /* same-tab nav blocked */ }
          }
          return;
        }
      } catch { /* invalid url - skip */ }
    }

    // Otherwise open a new tab.
    if (self.clients.openWindow) {
      await self.clients.openWindow(target);
    }
  })());
});

// Some browsers (Safari TP, Edge) fire this when the push subscription
// is invalidated server-side. We attempt a silent re-subscribe from the SW.
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    try {
      const sub = await self.registration.pushManager.getSubscription();
      if (!sub) return;
      // The page-side hook is the source of truth for subscribe payloads
      // (it has the auth token). Just notify open clients to re-sync.
      const allClients = await self.clients.matchAll({ type: 'window' });
      allClients.forEach(c => c.postMessage({ type: 'webpush:resubscribe' }));
    } catch {
      /* swallow - page will re-subscribe on next load */
    }
  })());
});
