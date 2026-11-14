import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// M1 (HIGH) + M2: push notification behaviour in the real service worker.
// Loads client/public/sw.js in a vm with mocked self/clients/registration,
// the same pattern as pwaShell.test.mjs. sw.js is served raw from
// client/public, so this executes the shipped file, not a copy of its logic.

const root = new URL('../', import.meta.url);
const source = fs.readFileSync(new URL('public/sw.js', root), 'utf8');

function makeClient(url) {
  const client = {
    url,
    focused: false,
    navigated: null,
    focus: async () => { client.focused = true; },
    navigate: async (target) => { client.navigated = target; },
  };
  return client;
}

function loadWorker({ clients = [], fetchImpl = async () => new Response('ok') } = {}) {
  const listeners = {};
  const notifications = [];
  const openedWindows = [];
  const fetches = [];
  const context = vm.createContext({
    URL,
    Request,
    Response,
    Headers,
    Promise,
    Date,
    console,
    crypto: { randomUUID: () => 'test-uuid-1' },
    fetch: async (...args) => { fetches.push(args); return fetchImpl(...args); },
    caches: {
      open: async () => ({
        match: async () => undefined,
        put: async () => {},
        add: async () => {},
        addAll: async () => {},
        keys: async () => [],
        delete: async () => {},
      }),
      match: async () => undefined,
      keys: async () => [],
    },
    self: {
      location: {
        origin: 'https://oxsteed.test',
        href: 'https://oxsteed.test/sw.js?v=1',
      },
      addEventListener: (name, fn) => { (listeners[name] ||= []).push(fn); },
      clients: {
        matchAll: async () => clients,
        openWindow: async (url) => { openedWindows.push(url); return { url }; },
        claim: async () => {},
      },
      registration: {
        showNotification: async (title, options) => { notifications.push({ title, options }); },
        navigationPreload: undefined,
        pushManager: { getSubscription: async () => null },
      },
      navigator: {},
      skipWaiting: async () => {},
    },
  });
  vm.runInContext(source, context);
  return { listeners, notifications, openedWindows, fetches, context };
}

async function clickNotification(worker, data) {
  const promises = [];
  const event = {
    notification: { close: () => {}, data },
    waitUntil: (p) => { promises.push(p); },
  };
  for (const fn of worker.listeners.notificationclick || []) fn(event);
  await Promise.all(promises);
}

async function push(worker, payload) {
  const promises = [];
  (worker.listeners.push || []).forEach((fn) => fn({
    data: { json: () => payload, text: () => '' },
    waitUntil: (p) => { promises.push(p); },
  }));
  await Promise.all(promises);
}

// ── M1: a push tap must never hijack a tab on an update-sensitive path ──

test('M1: a push tap navigates a safe tab, never the checkout tab', async () => {
  const checkout = makeClient('https://oxsteed.test/checkout');
  const orders = makeClient('https://oxsteed.test/orders');
  const worker = loadWorker({ clients: [checkout, orders] });
  await clickNotification(worker, { action_url: '/orders/123' });
  assert.equal(checkout.focused, false, 'checkout tab must not be focused');
  assert.equal(checkout.navigated, null, 'checkout tab must not be navigated away');
  assert.equal(orders.focused, true);
  assert.equal(orders.navigated, '/orders/123');
});

test('M1: when every open tab is mid-flow, the push opens a new tab', async () => {
  const checkout = makeClient('https://oxsteed.test/checkout');
  const wallet = makeClient('https://oxsteed.test/wallet/topup');
  const worker = loadWorker({ clients: [checkout, wallet] });
  await clickNotification(worker, { action_url: '/orders/123' });
  assert.equal(checkout.navigated, null);
  assert.equal(wallet.navigated, null);
  assert.deepEqual(worker.openedWindows, ['/orders/123']);
});

test('M1: a tab already on the target is only focused, never re-navigated', async () => {
  const target = makeClient('https://oxsteed.test/orders/123');
  const other = makeClient('https://oxsteed.test/orders');
  const worker = loadWorker({ clients: [other, target] });
  await clickNotification(worker, { action_url: '/orders/123' });
  assert.equal(target.focused, true);
  assert.equal(target.navigated, null, 'already on target: no navigation');
  assert.equal(other.navigated, null);
});

test('M1: update-sensitive paths (POS, kitchen, invoice, booking) are never navigated', async () => {
  for (const path of [
    '/cart',
    '/post-job',
    '/pay/abc',
    '/qr-payments',
    '/agreements/42',
    '/helpers/42/book',
    '/restaurants/kitchen/7',
    '/restaurants/pos/7',
    '/food/kiosk/3',
    '/invoice/p/abc',
    '/logistics/orders/42/checkout',
  ]) {
    const sensitive = makeClient(`https://oxsteed.test${path}`);
    const safe = makeClient('https://oxsteed.test/');
    const worker = loadWorker({ clients: [sensitive, safe] });
    await clickNotification(worker, { action_url: '/orders/123' });
    assert.equal(sensitive.navigated, null, `${path} must not be navigated`);
    assert.equal(safe.navigated, '/orders/123', `${path}: safe tab takes the navigation`);
  }
});

test('M1: with no open tab, the push opens a new window as before', async () => {
  const worker = loadWorker({ clients: [] });
  await clickNotification(worker, { action_url: '/orders/123' });
  assert.deepEqual(worker.openedWindows, ['/orders/123']);
});

// ── M2: notifications are tagged by notification id, not by type ──

test('M2: two alerts of the same type keep separate tags when their ids differ', async () => {
  const worker = loadWorker();
  await push(worker, { id: 'notif-1', type: 'food_order', title: 'Order 1', body: 'Ready' });
  await push(worker, { id: 'notif-2', type: 'food_order', title: 'Order 2', body: 'Ready' });
  assert.equal(worker.notifications.length, 2);
  assert.equal(worker.notifications[0].options.tag, 'notif-1');
  assert.equal(worker.notifications[1].options.tag, 'notif-2');
});

test('M2: a growth offer without a top-level id tags by its delivery id', async () => {
  const worker = loadWorker();
  await push(worker, {
    type: 'growth_offer',
    title: 'Offer',
    body: '50% off',
    data: { delivery_id: '42', action_url: '/offers' },
  });
  assert.equal(worker.notifications[0].options.tag, '42');
});

test('M2: a payload with no id at all still falls back to its type', async () => {
  const worker = loadWorker();
  await push(worker, { type: 'job_matched', title: 'Match', body: 'A job matches you' });
  assert.equal(worker.notifications[0].options.tag, 'job_matched');
});
