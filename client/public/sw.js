/* OxSteed Service Worker */

// The registration query carries the release SHA, so each deployment gets
// isolated caches without a manually maintained version constant.
const CACHE_VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const STATIC_CACHE  = `oxsteed-static-${CACHE_VERSION}`;
const API_CACHE     = `oxsteed-api-${CACHE_VERSION}`;

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
          .filter(k => k !== STATIC_CACHE && k !== API_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch strategy ────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept non-GET, chrome-extension, or cross-origin requests
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js') return;

  // API calls: network-first, cache fallback for safe GETs
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // Static assets (JS/CSS/fonts/images): cache-first
  if (
    url.pathname.match(/\.(js|css|woff2?|ttf|otf|png|jpg|jpeg|svg|ico|webp)$/)
  ) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // HTML navigation: network-first, fall back to cached '/' or offline page
  event.respondWith(navigationHandler(request));
});

// ── Strategy helpers ──────────────────────────────────────────────────────────

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'You are offline.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function navigationHandler(request) {
  try {
    return await fetch(request);
  } catch {
    // Keep application HTML network-first so a deployment can publish a new
    // asset manifest without an older route shell masking it.
    return caches.match('/offline.html');
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
