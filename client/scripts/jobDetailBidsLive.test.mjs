// Live bids on the job detail page (PR #809, D-445): the hook joins the job
// room, merges bid:created / bid:updated / bid:withdrawn events into the
// list in place, and re-fetches quietly on resume. The Retry button stays
// for real errors only (non-quiet loads).
//
// Run: node --test scripts/jobDetailBidsLive.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

function loadHook() {
  const stateCell = { current: null };
  const cleanups = [];
  const resume = { callback: null, enabled: null };
  const socketHandlers = new Map();
  const socket = {
    on: (event, fn) => {
      if (!socketHandlers.has(event)) socketHandlers.set(event, new Set());
      socketHandlers.get(event).add(fn);
    },
    off: (event, fn) => socketHandlers.get(event)?.delete(fn),
    emit: (event, payload) => {
      for (const fn of [...(socketHandlers.get(event) || [])]) fn(payload);
    },
  };
  const joins = [];
  const leaves = [];
  const react = {
    useState: (init) => {
      stateCell.current = init;
      const set = (next) => {
        stateCell.current = typeof next === 'function' ? next(stateCell.current) : next;
      };
      return [init, set];
    },
    useEffect: (fn) => {
      const cleanup = fn();
      if (typeof cleanup === 'function') cleanups.push(cleanup);
    },
    useRef: (init) => ({ current: init }),
    useCallback: (fn) => fn,
  };
  const loaded = new Map();
  function load(file) {
    if (loaded.has(file)) return loaded.get(file);
    const module = { exports: {} };
    const code = transformSync(fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), {
      format: 'cjs',
      define: { 'import.meta.env': '{}' },
    }).code;
    const require = (name) => {
      if (name === 'react') return react;
      if (name === './useAppResume') return { __esModule: true, default: (cb, enabled) => { resume.callback = cb; resume.enabled = enabled; } };
      if (name === './useSocket') return { __esModule: true, useSocket: () => ({ socket, joinJobRoom: (id) => joins.push(id), leaveJobRoom: (id) => leaves.push(id) }) };
      if (name === '../utils/jobDetailModel') return load('utils/jobDetailModel.js');
      if (name === '../lib/realtime') return load('lib/realtime.js');
      throw Error(`Unexpected fixture dependency ${name}`);
    };
    vm.runInNewContext(code, { module, exports: module.exports, require });
    loaded.set(file, module.exports);
    return module.exports;
  }
  const hook = load('hooks/useJobDetailBids.js');
  return {
    ...hook,
    stateCell,
    resume,
    socket,
    joins,
    leaves,
    unmount: () => { while (cleanups.length) cleanups.pop()(); },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// Bid rows cross the vm realm boundary, so prototype-sensitive deepEqual
// fails on identical structure; compare serialized form instead.
const sameBids = (actual, expected, message) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);

const BID_A = { id: 'b1', helper_id: 'h1', amount_cents: 5000, message: 'First', status: 'pending' };
const BID_B = { id: 'b2', helper_id: 'h2', amount_cents: 7000, message: 'Second', status: 'pending' };

async function mountedHook({ bids = [BID_A], fail = false } = {}) {
  const app = loadHook();
  let calls = 0;
  const getJobBids = async () => {
    calls += 1;
    if (fail) throw new Error('boom');
    return bids;
  };
  const result = app.useJobDetailBids('job-1', 'user-9', getJobBids);
  await settle();
  await settle();
  return { ...app, result, getJobBids, calls: () => calls };
}

test('mergeBidEvent: created appends, updated merges in place, withdrawn keeps the row', () => {
  const { mergeBidEvent } = loadHook();
  sameBids(mergeBidEvent([], { type: 'bid:created', bid: BID_A }), [BID_A]);
  sameBids(
    mergeBidEvent([{ ...BID_A, helper_name: 'Ana' }], { type: 'bid:updated', bid: { id: 'b1', amount_cents: 6000 } }),
    [{ ...BID_A, helper_name: 'Ana', amount_cents: 6000 }],
  );
  sameBids(
    mergeBidEvent([BID_A, BID_B], { type: 'bid:withdrawn', bidId: 'b1', bid: { id: 'b1', withdrawn_at: '2026-11-25T00:00:00Z' } }),
    [{ ...BID_A, status: 'withdrawn', withdrawn_at: '2026-11-25T00:00:00Z' }, BID_B],
  );
  assert.equal(mergeBidEvent([BID_A], { type: 'bid:created', bid: { id: 'b1', amount_cents: 9999 } })[0].amount_cents, 9999);
  sameBids(mergeBidEvent([BID_A], { type: 'bid:withdrawn', bidId: 'missing' }), [BID_A]);
  sameBids(mergeBidEvent([BID_A], { type: 'bid:updated' }), [BID_A]);
  sameBids(mergeBidEvent(null, { type: 'bid:created', bid: BID_A }), [BID_A]);
});

test('hook: mounts, joins the job room, merges live events in place', async () => {
  const app = await mountedHook({ bids: [BID_A] });
  assert.equal(app.stateCell.current.status, 'success');
  assert.deepEqual(app.joins, ['job-1']);
  app.socket.emit('bid:created', { bid: BID_B });
  sameBids(app.stateCell.current.bids, [BID_A, BID_B]);
  app.socket.emit('bid:updated', { bid: { id: 'b1', amount_cents: 5500 } });
  assert.equal(app.stateCell.current.bids[0].amount_cents, 5500);
  assert.equal(app.stateCell.current.bids[0].message, 'First', 'fields the event lacks survive the merge');
  app.socket.emit('bid:withdrawn', { bidId: 'b2', bid: { id: 'b2', withdrawn_at: '2026-11-25T00:00:00Z' } });
  assert.equal(app.stateCell.current.bids[1].status, 'withdrawn');
  assert.equal(app.stateCell.current.bids.length, 2, 'withdrawn bids stay listed, like a re-fetch');
  app.unmount();
  assert.deepEqual(app.leaves, ['job-1']);
});

test('hook: re-joins on reconnect and re-fetches quietly on resume', async () => {
  const app = await mountedHook({ bids: [BID_A] });
  const before = app.calls();
  app.socket.emit('connect');
  assert.deepEqual(app.joins, ['job-1', 'job-1']);
  assert.equal(app.resume.enabled, true);
  app.resume.callback();
  await settle();
  await settle();
  assert.equal(app.calls(), before + 1, 'resume re-fetches the bid list');
  assert.equal(app.stateCell.current.status, 'success');
  sameBids(app.stateCell.current.bids, [BID_A]);
});

test('hook: a failed quiet re-fetch keeps the list and shows no Retry; a failed manual load errors', async () => {
  // The fetcher succeeds once, then fails: the resume (quiet) re-fetch must
  // keep the last good list instead of flipping to error.
  const app = loadHook();
  let calls = 0;
  const getJobBids = async () => {
    calls += 1;
    if (calls > 1) throw new Error('boom');
    return [BID_A];
  };
  app.useJobDetailBids('job-1', 'user-9', getJobBids);
  await settle();
  await settle();
  assert.equal(app.stateCell.current.status, 'success');
  app.resume.callback();
  await settle();
  await settle();
  assert.equal(calls, 2);
  assert.equal(app.stateCell.current.status, 'success', 'a failed quiet refresh keeps the list; no Retry appears');
  sameBids(app.stateCell.current.bids, [BID_A]);

  // The initial (non-quiet) load errors, so Retry shows for a real error.
  const failing = loadHook();
  const failingFetch = async () => { throw new Error('boom'); };
  failing.useJobDetailBids('job-1', 'user-9', failingFetch);
  await settle();
  await settle();
  assert.equal(failing.stateCell.current.status, 'error');
  sameBids(failing.stateCell.current.bids, []);
});
