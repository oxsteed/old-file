import test from 'node:test';
import assert from 'node:assert/strict';
import { withCrossTabRefreshLock } from '../src/api/authRefreshCoordinator.js';
import { isTransientRefreshFailure } from '../src/api/authRefreshPolicy.js';

function globals(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
}
function storage(initial) {
  const records = new Map(initial ? [['oxs:auth-refresh-lock', JSON.stringify(initial)]] : []);
  return { records, getItem: key => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) };
}

test('runs the refresh operation when browser locks are unavailable', async () => {
  const result = await withCrossTabRefreshLock(async () => 'refreshed');
  assert.equal(result, 'refreshed');
});

test('waiting for a busy native lock is bounded without starting a second rotation', async t => {
  let calls = 0;
  globals(t, { navigator: { locks: { request: (_name, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }) } } });
  await assert.rejects(withCrossTabRefreshLock(() => calls++, { waitTimeoutMs: 20 }), error => isTransientRefreshFailure(error));
  assert.equal(calls, 0);
});

test('the native queue deadline does not abort an operation after it acquires the lock', async t => {
  let signal;
  globals(t, { navigator: { locks: { request: async (_name, options, operation) => { signal = options.signal;return operation(); } } } });
  const result = await withCrossTabRefreshLock(async () => {
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(signal.aborted, false);
    return 'complete';
  }, { waitTimeoutMs: 10 });
  assert.equal(result, 'complete');
});

test('a busy storage lock times out without bypassing the current owner', async t => {
  const lock = { owner: 'another-tab', expiresAt: Date.now() + 30000 }, local = storage(lock);
  globals(t, { navigator: {}, localStorage: local });
  let calls = 0;
  await assert.rejects(withCrossTabRefreshLock(() => calls++, { waitTimeoutMs: 20 }), error => error.code === 'AUTH_REFRESH_BUSY' && isTransientRefreshFailure(error));
  assert.equal(calls, 0);
  assert.deepEqual(JSON.parse(local.getItem('oxs:auth-refresh-lock')), lock);
});

test('expired storage locks are reclaimed and released even when the rotation fails', async t => {
  const local = storage({ owner: 'stale-tab', expiresAt: Date.now() - 1 });
  globals(t, { navigator: {}, localStorage: local });
  await assert.rejects(withCrossTabRefreshLock(() => { throw new Error('Synthetic outage'); }), /Synthetic outage/);
  assert.equal(local.records.size, 0);
});

test('finishing an operation cannot remove a replacement storage lock', async t => {
  const local = storage();globals(t, { navigator: {}, localStorage: local });
  await withCrossTabRefreshLock(() => local.setItem('oxs:auth-refresh-lock', JSON.stringify({ owner: 'replacement-tab' })));
  assert.equal(JSON.parse(local.getItem('oxs:auth-refresh-lock')).owner, 'replacement-tab');
});

test('unavailable browser storage retains the in-page refresh path without a long queue wait', async t => {
  globals(t, { navigator: {}, localStorage: { getItem: () => null, setItem: () => { throw new Error('Storage unavailable'); } } });
  let calls = 0;
  assert.equal(await withCrossTabRefreshLock(() => { calls++;return 'complete'; }), 'complete');
  assert.equal(calls, 1);
});
