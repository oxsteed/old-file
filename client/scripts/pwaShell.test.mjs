import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root = new URL('../', import.meta.url),
  source = fs.readFileSync(new URL('public/sw.js', root), 'utf8');
function worker(fetch = async () => new Response('asset')) {
  const listeners = {},
    stored = new Map(),
    writes = [];
  let skips = 0;
  const bucket = {
    match: async (req) => stored.get(req.url)?.clone(),
    put: async (req, res) => {
      writes.push(req);
      stored.set(req.url, res.clone());
    },
    keys: async () => [...stored.keys()].map(url=>new Request(url)),
    delete: async req => stored.delete(req.url),
    addAll: async (urls) => assert.deepEqual([...urls], ['/offline.html']),
  };
  const metadata = new Map();
  const metaBucket = { match: async req=>metadata.get(req.url)?.clone(), put: async(req,res)=>metadata.set(req.url,res.clone()), keys: async()=>[...metadata.keys()].map(url=>new Request(url)), delete:async req=>metadata.delete(req.url) };
  const context = vm.createContext({
    URL,
    Request,
    Response,
    Headers,
    Promise,
    Date,
    fetch,
    caches: { open: async name => name === 'oxsteed-assets-v2' || name.startsWith('oxsteed-static-') ? bucket : metaBucket, match: async () => undefined },
    self: {
      location: {
        origin: 'https://oxsteed.test',
        href: 'https://oxsteed.test/sw.js?v=1',
      },
      addEventListener: (name, fn) => (listeners[name] = fn),
      skipWaiting: async () => {
        skips++;
      },
    },
  });
  vm.runInContext(source, context);
  return {
    listeners,
    context,
    stored,
    writes,
    get skips() {
      return skips;
    },
  };
}
test('hashed assets reuse cached bytes without touching the network', async () => {
  let requests = 0;
  const w = worker(async () => {
    requests++;
    return new Response('immutable');
  });
  const req = new Request('https://oxsteed.test/assets/main-ABcd1234.js');
  let result;
  const event = { request: req, respondWith: (p) => (result = p) };
  w.listeners.fetch(event);
  assert.equal(await (await result).text(), 'immutable');
  w.listeners.fetch(event);
  assert.equal(await (await result).text(), 'immutable');
  assert.equal(requests, 1);
});
test('idle precache stores successful same-origin public assets only', async () => {
  const requests = [];
  const w = worker(async (req) => {
    requests.push(req);
    return new Response('css');
  });
  let complete;
  w.listeners.message({
    data: {
      type: 'precache',
      urls: [
        '/assets/main-ABcd1234.css',
        '/api/private.jpg',
        '/uploads/private.jpg',
        'https://elsewhere.test/assets/x.js',
      ],
    },
    waitUntil: (p) => (complete = p),
  });
  await complete;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].mode, 'same-origin');
  assert.equal(w.writes.length, 1);
});
test('precache rejects opaque, failed, private and no-store responses', async () => {
  for (const response of [
    Response.error(),
    new Response('', { status: 404 }),
    new Response('', { headers: { 'Cache-Control': 'private' } }),
    new Response('', { headers: { 'Cache-Control': 'no-store' } }),
    { ok: true, type: 'opaque' },
  ]) {
    const w = worker(async () => response);
    let complete;
    w.listeners.message({
      data: { type: 'precache', urls: ['/assets/a-ABcd1234.js'] },
      waitUntil: (p) => (complete = p),
    });
    await complete;
    assert.equal(w.writes.length, 0);
  }
});
test('installation waits for an explicit page update message', async () => {
  const w = worker();
  let complete;
  w.listeners.install({ waitUntil: (p) => (complete = p) });
  await complete;
  assert.equal(w.skips, 0);
  w.listeners.message({
    data: { type: 'SKIP_WAITING' },
    waitUntil: (p) => (complete = p),
  });
  await complete;
  assert.equal(w.skips, 1);
});
test('API remains network-only and private uploads remain unintercepted', async () => {
  const w = worker(async () => {
    throw Error('offline');
  });
  let result;
  w.listeners.fetch({
    request: new Request('https://oxsteed.test/api/orders'),
    respondWith: (p) => (result = p),
  });
  assert.equal((await result).status, 503);
  assert.equal(w.writes.length, 0);
  for (const path of ['/uploads/proof.png', '/socket.io/?transport=polling']) {
    let intercepted = false;
    w.listeners.fetch({
      request: new Request('https://oxsteed.test' + path),
      respondWith: () => (intercepted = true),
    });
    assert.equal(intercepted, false);
  }
});
test('install images have distinct maskable icons and wide/narrow screenshots', () => {
  const m = JSON.parse(fs.readFileSync(new URL('public/manifest.json', root)));
  assert.equal(m.orientation, 'any');
  assert.deepEqual(m.display_override, ['standalone', 'minimal-ui']);
  assert.equal(m.screenshots.length, 4);
  const regular = m.icons.filter((i) => i.purpose === 'any').map((i) => i.src);
  for (const icon of m.icons.filter((i) => i.purpose === 'maskable'))
    assert.ok(!regular.includes(icon.src));
  for (const shot of m.screenshots) {
    const png = fs.readFileSync(new URL('public' + shot.src, root));
    const dims = [png.readUInt32BE(16), png.readUInt32BE(20)];
    assert.equal(dims.join('x'), shot.sizes);
    assert.equal(shot.form_factor, dims[0] > dims[1] ? 'wide' : 'narrow');
  }
  assert.equal(m.share_target.method, 'POST');
  assert.equal(m.share_target.enctype, 'multipart/form-data');
});
test('shell uses local fonts and standalone metadata', () => {
  const html = fs.readFileSync(new URL('index.html', root), 'utf8'),
    css = fs.readFileSync(new URL('src/index.css', root), 'utf8'),
    fonts = fs.readFileSync(new URL('src/styles/fonts.css', root), 'utf8');
  assert.doesNotMatch(
    html + css + fonts,
    /fonts\.googleapis\.com|fonts\.gstatic\.com/,
  );
  for (const tag of [
    'mobile-web-app-capable',
    'apple-mobile-web-app-capable',
    'apple-mobile-web-app-title',
    'apple-mobile-web-app-status-bar-style',
  ])
    assert.ok(html.includes(tag));
  for (const name of ['Inter', 'Instrument Serif', 'Work Sans'])
    assert.ok(fonts.includes(`font-family: '${name}'`));
  for (const match of fonts.matchAll(/url\(([^)]+)\)/g))
    assert.ok(fs.existsSync(new URL('src/styles/' + match[1], root)));
});
test('badge API rejections are contained and invalid counts clear', async () => {
  const code = fs.readFileSync(new URL('src/utils/appBadge.js', root), 'utf8');
  const badge = await import(
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  );
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
    calls = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      setAppBadge: (n) => {
        calls.push(n);
        return Promise.reject(Error('denied'));
      },
      clearAppBadge: () => {
        calls.push('clear');
        return Promise.reject(Error('denied'));
      },
    },
  });
  try {
    badge.setAppBadge(3.9);
    badge.setAppBadge(Infinity);
    badge.clearAppBadge();
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(calls, [3, 'clear', 'clear']);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  }
});

test('unavailable HTML uses the reconnect page even when the server responds 503', async () => {
  const w = worker(async () => new Response('', { status: 503 }));
  const response = await w.context.navigationHandler(
    { preloadResponse: Promise.resolve(undefined) },
    new Request('https://oxsteed.test/'),
  );
  assert.equal(response.status, 503);
  assert.match(await response.text(), /reconnect/i);
});

test('a rejected badge update never prevents displaying a push notification', async () => {
  const w = worker();
  let displayed = 0,
    done;
  w.context.self.registration = {
    showNotification: async () => {
      displayed++;
    },
  };
  w.context.self.navigator = {
    setAppBadge: () => {
      throw new Error('Not allowed');
    },
  };
  w.listeners.push({
    data: { json: () => ({ title: 'New order', unread_count: 3 }) },
    waitUntil: (promise) => {
      done = promise;
    },
  });
  await done;
  assert.equal(displayed, 1);
});

test('shortcut attribution records only allowed labels through the existing analytics adapter', async () => {
  const { build } = await import('esbuild');
  const result = await build({
    entryPoints: [new URL('src/utils/pwaInstall.js', root).pathname],
    bundle: true,
    write: false,
    format: 'esm',
  });
  const install = await import(
    'data:text/javascript;base64,' +
      Buffer.from(result.outputFiles[0].text).toString('base64')
  );
  const previous = globalThis.window,
    events = [];
  globalThis.window = {
    location: {
      pathname: '/food',
      search: '?source=app_shortcut&private=ignored',
    },
    addEventListener() {},
    gtag: (...args) => events.push(args),
  };
  try {
    for (const pathname of [
      '/food',
      '/oxsteed-credit',
      '/orders',
      '/post-job',
      '/orders/123',
    ]) {
      window.location.pathname = pathname;
      install.initPwaInstall();
    }
    const shortcuts = events.filter((row) => row[1] === 'pwa_shortcut_open');
    assert.deepEqual(
      shortcuts.map((row) => row[2]),
      [
        { shortcut: 'food' },
        { shortcut: 'top_up' },
        { shortcut: 'track' },
        { shortcut: 'post_job' },
      ],
    );
    delete window.gtag;
    install.initPwaInstall(); // No analytics script before consent is also supported.
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
