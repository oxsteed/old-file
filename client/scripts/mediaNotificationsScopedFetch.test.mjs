import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import test from 'node:test';

// Domain 9 audit #12 follow-up (media undercount): the media tab showed
// media rows among the latest 100 UNSCOPED notifications, filtered
// client-side, so it could undercount whenever more than 100 recent
// notifications preceded an unread media notification. The media scope
// must issue its own scoped fetch (scope=media, its own limit 100) so
// media rows outside the latest-100 unscoped window are visible.
//
// Run: node --test scripts/mediaNotificationsScopedFetch.test.mjs
const source = fs.readFileSync(new URL('../src/hooks/useNotifications.js', import.meta.url), 'utf8');

test('media scope fetches its own scoped list so media rows outside the latest 100 unscoped notifications are visible', async () => {
  const cleanups = [];
  const handlers = new Map();
  const calls = [];
  // 100 recent non-media notifications: the whole unscoped latest-100 window.
  const unscopedRows = Array.from({ length: 100 }, (_, i) => ({ id: 1000 + i, type: 'new_bid', is_read: false }));
  // 5 older media notifications, outside the latest-100 unscoped window.
  const mediaRows = Array.from({ length: 5 }, (_, i) => ({ id: 200 + i, type: 'media_reply', is_read: i === 0 }));
  const socket = { on: (event, fn) => handlers.set(event, fn), off: (event) => handlers.delete(event) };
  const react = { useMemo: fn => fn(), useEffect: fn => cleanups.push(fn()), useSyncExternalStore: (_, get) => get() };
  const getAccountSnapshot = async (_userId, _path, params) => {
    calls.push({ scope: params?.scope ?? null, limit: params?.limit });
    if (params?.scope === 'media') return { data: { notifications: mediaRows, unread_count: 4 } };
    return { data: { notifications: unscopedRows, unread_count: 100 } };
  };
  const mod = { exports: {} };
  const noop = () => {};
  vm.runInNewContext(transformSync(source, { format: 'cjs' }).code, {
    module: mod, exports: mod.exports, console, Map, Set, Date,
    document: { visibilityState: 'visible', addEventListener: noop, removeEventListener: noop },
    window: { addEventListener: noop, removeEventListener: noop },
    require: name => name === 'react' ? react
      : name.endsWith('/axios') ? { default: { get: async () => ({}), put: async () => ({}), delete: async () => ({}) } }
      : name.endsWith('/AuthContext') ? { useAuth: () => ({ user: { id: 'account-a' } }) }
      : name === './useSocket' ? { useSocket: () => ({ socket }) }
      : { getAccountSnapshot, invalidateAccountSnapshots: noop },
  });
  const hook = mod.exports.default;
  hook('media');
  await new Promise(resolve => setImmediate(resolve));
  // The media scope must issue its own scoped fetch with its own limit.
  assert.ok(
    calls.some(call => call.scope === 'media' && call.limit === 100),
    `expected a scoped media fetch, got ${JSON.stringify(calls)}`,
  );
  // ...and the media list must contain the media rows that fall outside
  // the latest-100 unscoped window (4 of the 5 are unread).
  assert.equal(hook('media').notifications.length, 5);
  assert.equal(hook('media').unreadCount, 4);
  for (const cleanup of cleanups) cleanup?.();
  assert.equal(handlers.size, 0);
});
