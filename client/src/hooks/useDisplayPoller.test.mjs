// Unit tests for useDisplayPoller (client/src/hooks/useDisplayPoller.js).
//
// The hook is exercised through a minimal React dispatcher harness (no DOM
// needed: the hook never touches document/window) with node's fake timers,
// so we can unmount mid-flight, advance the clock, and assert no further
// load runs on the dead component.
//
// Run: node --import ./src/register-test-loader.mjs --test src/hooks/useDisplayPoller.test.mjs
// (the loader resolves the extensionless relative imports the Vite/esbuild
// bundler accepts).
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { useDisplayPoller } from './useDisplayPoller.js';

const internals =
  React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;

function sameDeps(a, b) {
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  return a.every((v, i) => Object.is(v, b[i]));
}

function createHarness() {
  const hooks = [];
  let index = 0;
  let effectsQueue = [];
  let mounted = false;
  let renderFn = null;

  const dispatcher = {
    useState(initial) {
      const i = index++;
      if (hooks[i] === undefined) {
        hooks[i] = {
          state: typeof initial === 'function' ? initial() : initial,
        };
      }
      const setState = (next) => {
        const value =
          typeof next === 'function' ? next(hooks[i].state) : next;
        if (Object.is(value, hooks[i].state)) return;
        hooks[i].state = value;
        if (mounted) rerender();
      };
      return [hooks[i].state, setState];
    },
    useRef(initial) {
      const i = index++;
      if (hooks[i] === undefined) hooks[i] = { current: initial };
      return hooks[i];
    },
    useCallback(fn, deps) {
      const i = index++;
      if (hooks[i] === undefined || !sameDeps(hooks[i].deps, deps)) {
        hooks[i] = { fn, deps };
      }
      return hooks[i].fn;
    },
    useMemo(fn, deps) {
      const i = index++;
      if (hooks[i] === undefined || !sameDeps(hooks[i].deps, deps)) {
        hooks[i] = { value: fn(), deps };
      }
      return hooks[i].value;
    },
    useEffect(cb, deps) {
      const i = index++;
      const prev = hooks[i];
      if (prev === undefined || !sameDeps(prev.deps, deps)) {
        hooks[i] = { deps, pending: cb, cleanup: prev?.cleanup ?? null };
        effectsQueue.push(i);
      }
    },
  };

  function runEffects() {
    for (const i of effectsQueue) {
      const slot = hooks[i];
      const cb = slot.pending;
      slot.pending = null;
      if (typeof cb === 'function') {
        const cleanup = cb();
        slot.cleanup = typeof cleanup === 'function' ? cleanup : null;
      }
    }
    effectsQueue = [];
  }

  function rerender() {
    index = 0;
    effectsQueue = [];
    internals.ReactCurrentDispatcher.current = dispatcher;
    try {
      renderFn();
    } finally {
      internals.ReactCurrentDispatcher.current = null;
    }
    runEffects();
  }

  return {
    mount(fn) {
      renderFn = fn;
      mounted = true;
      rerender();
    },
    unmount() {
      mounted = false;
      for (let i = hooks.length - 1; i >= 0; i--) {
        const slot = hooks[i];
        if (slot && typeof slot.cleanup === 'function') {
          slot.cleanup();
          slot.cleanup = null;
        }
      }
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

// Node 21+ ships a global `navigator` (userAgent only, no onLine), which the
// hook reads as "offline". Stub it online for these tests.
function stubOnlineNavigator() {
  const prev = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true },
    configurable: true,
    writable: true,
  });
  return () => {
    if (prev === undefined) delete globalThis.navigator;
    else globalThis.navigator = prev;
  };
}

test('steady poll: load re-runs on each interval while mounted', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const restoreNavigator = stubOnlineNavigator();
  try {
    let calls = 0;
    const harness = createHarness();
    harness.mount(() =>
      useDisplayPoller(() => {
        calls++;
        return Promise.resolve();
      }, { intervalMs: 5000 }),
    );
    await flush();
    assert.equal(calls, 1, 'initial run');
    t.mock.timers.tick(5000);
    await flush();
    assert.equal(calls, 2, 'second run after interval');
    t.mock.timers.tick(5000);
    await flush();
    assert.equal(calls, 3, 'third run after interval');
    harness.unmount();
  } finally {
    restoreNavigator();
    t.mock.timers.reset();
  }
});

test('unmount mid-flight: a late load resolution schedules no further run', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const restoreNavigator = stubOnlineNavigator();
  try {
    let calls = 0;
    let resolveLoad;
    const harness = createHarness();
    harness.mount(() =>
      useDisplayPoller(() => {
        calls++;
        return new Promise((resolve) => {
          resolveLoad = resolve;
        });
      }, { intervalMs: 5000 }),
    );
    assert.equal(calls, 1, 'load starts on mount');
    harness.unmount();
    resolveLoad(); // the in-flight load resolves after unmount
    await flush();
    t.mock.timers.tick(60000); // well past the poll interval
    await flush();
    assert.equal(
      calls,
      1,
      'load must not be called again after unmount',
    );
  } finally {
    restoreNavigator();
    t.mock.timers.reset();
  }
});

test('unmount while a retry is scheduled: the timer never fires', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const restoreNavigator = stubOnlineNavigator();
  try {
    let calls = 0;
    const harness = createHarness();
    harness.mount(() =>
      useDisplayPoller(() => {
        calls++;
        return Promise.reject(new Error('boom'));
      }, { intervalMs: 5000 }),
    );
    await flush();
    assert.equal(calls, 1, 'failed load runs once');
    harness.unmount();
    t.mock.timers.tick(60000); // past the backoff delay
    await flush();
    assert.equal(calls, 1, 'no retry fires after unmount');
  } finally {
    restoreNavigator();
    t.mock.timers.reset();
  }
});

test('failure backs off and retries while still mounted', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const restoreNavigator = stubOnlineNavigator();
  try {
    let calls = 0;
    const harness = createHarness();
    harness.mount(() =>
      useDisplayPoller(() => {
        calls++;
        return calls === 1
          ? Promise.reject(new Error('boom'))
          : Promise.resolve();
      }, { intervalMs: 5000 }),
    );
    await flush();
    assert.equal(calls, 1);
    t.mock.timers.tick(1999); // first backoff is baseMs (2000)
    await flush();
    assert.equal(calls, 1, 'no retry before the backoff elapses');
    t.mock.timers.tick(1);
    await flush();
    assert.equal(calls, 2, 'retry runs once the backoff elapses');
    t.mock.timers.tick(5000); // success reschedules the steady interval
    await flush();
    assert.equal(calls, 3, 'steady polling resumes after recovery');
    harness.unmount();
  } finally {
    restoreNavigator();
    t.mock.timers.reset();
  }
});
