// PWA silent updates (D-446): the socket never gives up reconnecting, and
// after a reconnect the app re-fetches its active queries instead of showing
// the pre-drop snapshot. Reconnect listeners run on `connect` only after a
// prior `disconnect`, never on the initial connect.
//
// Run: node --test scripts/socketReconnect.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function loadHook() {
  const stateCells = [];
  const cleanups = [];
  const socketHandlers = new Map();
  const managerHandlers = new Map();
  let createdSocket = null;
  let createOptions = null;
  let createUrl = null;

  const fakeSocket = {
    connected: false,
    active: false,
    auth: {},
    on: (event, fn) => {
      if (!socketHandlers.has(event)) socketHandlers.set(event, new Set());
      socketHandlers.get(event).add(fn);
    },
    off: (event, fn) => socketHandlers.get(event)?.delete(fn),
    emit: () => {},
    connect: () => {},
    disconnect: () => {},
    io: {
      on: (event, fn) => {
        if (!managerHandlers.has(event)) managerHandlers.set(event, new Set());
        managerHandlers.get(event).add(fn);
      },
    },
  };
  const fakeIo = (url, options) => {
    createUrl = url;
    createOptions = options;
    createdSocket = fakeSocket;
    return fakeSocket;
  };

  const react = {
    useState: (init) => {
      const cell = { current: typeof init === 'function' ? init() : init };
      stateCells.push(cell);
      const set = (next) => {
        cell.current = typeof next === 'function' ? next(cell.current) : next;
      };
      return [cell.current, set];
    },
    useEffect: (fn) => {
      const cleanup = fn();
      if (typeof cleanup === 'function') cleanups.push(cleanup);
    },
    useRef: (init) => ({ current: init }),
    useCallback: (fn) => fn,
  };

  const location = {
    href: 'https://app.invalid/discover',
    get origin() { return 'https://app.invalid'; },
    get hostname() { return 'app.invalid'; },
    get pathname() { return new URL(this.href).pathname; },
    replace: () => {},
  };
  const win = new EventTarget();
  win.location = location;
  win.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  win.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  win.navigator = { onLine: true };

  const loaded = new Map();
  function load(file) {
    if (loaded.has(file)) return loaded.get(file);
    const module = { exports: {} };
    let source = fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    // The hook lazy-loads socket.io-client with a native dynamic import(),
    // which cannot resolve inside this vm context. Shim it to the same
    // require() the rest of the harness already fakes; the fake `io` below
    // stands in for the real client.
    if (file === 'hooks/useSocket.js') {
      source = source.replace(
        "import('socket.io-client')",
        "Promise.resolve().then(() => require('socket.io-client'))",
      );
    }
    const code = transformSync(source, {
      format: 'cjs',
      define: { 'import.meta.env': '{}' },
    }).code;
    const require = (name) => {
      if (name === 'react') return react;
      if (name === './useAppResume') return { __esModule: true, default: () => {} };
      if (name === './useAuth') return { __esModule: true, useAuth: () => ({ user: { id: 'user-1' } }) };
      if (name === '../utils/sessionStorage') return { __esModule: true, readSessionStorage: () => null };
      if (name === 'socket.io-client') return { __esModule: true, io: fakeIo };
      if (name === '../lib/realtime') return load('lib/realtime.js');
      throw Error(`Unexpected fixture dependency ${name}`);
    };
    const quietConsole = { log: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    vm.runInNewContext(code, {
      module, exports: module.exports, require,
      window: win, document: new EventTarget(), navigator: win.navigator,
      location, console: quietConsole, URL, Date, Event,
      setTimeout, clearTimeout,
    });
    loaded.set(file, module.exports);
    return module.exports;
  }

  const hook = load('hooks/useSocket.js');
  return {
    ...hook,
    stateCells,
    get createdSocket() { return createdSocket; },
    get createOptions() { return createOptions; },
    get createUrl() { return createUrl; },
    fire: (event, payload) => {
      for (const fn of [...(socketHandlers.get(event) || [])]) fn(payload);
    },
    unmount: () => { while (cleanups.length) cleanups.pop()(); },
  };
}

test('socket reconnects forever and re-fetches only after a reconnect', async () => {
  const app = loadHook();
  const refetches = [];
  const unsubscribe = app.subscribeSocketReconnect(() => refetches.push('refetch'));
  app.useSocket();
  await settle();
  await settle();
  assert.ok(app.createdSocket, 'the hook creates the socket');
  assert.equal(app.createUrl, 'https://app.invalid/chat');
  assert.equal(app.createOptions.reconnectionAttempts, Infinity, 'reconnects never give up');
  assert.equal(app.createOptions.reconnectionDelay, 2000, 'the 2s delay floor is unchanged');
  assert.equal(app.createOptions.reconnectionDelayMax, 30000, 'the 30s cap is unchanged');

  // Initial connect: state flips to connected, no re-fetch.
  app.createdSocket.connected = true;
  app.fire('connect');
  assert.equal(app.stateCells[0].current, true);
  assert.deepEqual(refetches, []);

  // Drop and reconnect: the re-fetch runs once.
  app.createdSocket.connected = false;
  app.fire('disconnect');
  assert.equal(app.stateCells[0].current, false);
  app.createdSocket.connected = true;
  app.fire('connect');
  assert.deepEqual(refetches, ['refetch']);

  // A second drop/reconnect re-fetches again.
  app.fire('disconnect');
  app.fire('connect');
  assert.deepEqual(refetches, ['refetch', 'refetch']);

  // Unsubscribed listeners stop being called.
  unsubscribe();
  app.fire('disconnect');
  app.fire('connect');
  assert.deepEqual(refetches, ['refetch', 'refetch']);
});
