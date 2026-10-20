import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  uuidv7,
  routeTemplate,
  appendBounded,
  takeBatch,
  scrubQuery,
  safeProps,
  readSession,
  touchSession,
  SESSION_STORAGE_KEY,
  SESSION_IDLE_MS,
} from '../src/growth/tracker.mjs';
test('routes expose templates and never identifiers or private routes', () => {
  const routes = JSON.parse(
    fs.readFileSync(new URL('../src/growth/routes.json', import.meta.url)),
  );
  assert.equal(routeTemplate('/jobs/123', routes), '/jobs/:id');
  assert.equal(routeTemplate('/wallet', routes), null);
  assert.equal(routeTemplate('/jobs/123?email=private', routes), '/jobs/:id');
});
test('UUIDv7 ids are unique and encode their timestamp', () => {
  const id = uuidv7(123456789);
  assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab]/);
  assert.equal(parseInt(id.replaceAll('-', '').slice(0, 12), 16), 123456789);
  assert.notEqual(id, uuidv7(123456789));
});
test('queue sheds interactions first and bounds encoded bytes', () => {
  let queue = Array.from({ length: 200 }, (_, i) => ({
    name: i === 0 ? 'offer.click' : 'ui.click',
    i,
  }));
  queue = appendBounded(queue, { name: 'search.performed' });
  assert.equal(queue.length, 200);
  assert.equal(queue[0].name, 'offer.click');
  const batch = takeBatch(
    Array.from({ length: 30 }, () => ({
      name: 'ui.click',
      props: { key: 'ع'.repeat(3000) },
    })),
    {},
  );
  assert.ok(
    new TextEncoder().encode(JSON.stringify({ events: batch })).length <= 64000,
  );
  assert.ok(batch.length <= 20);
});

test('search data is scrubbed before entering the browser queue',()=>{
  assert.equal(scrubQuery('Drain private@example.test +1 (555) 123-4567 123 Main Street https://example.test/private'),'drain');
  assert.equal(scrubQuery('x'.repeat(200)).length,100);
});
test('client props reject unregistered fields, private routes and oversized values',()=>{
  const fields={'ui.click':['route','element_key'],'search.performed':['query_norm']};
  assert.equal(safeProps('ui.click',{route:'/wallet'},fields,['/jobs']),null);
  assert.equal(safeProps('ui.click',{route:'/jobs',email:'private@example.test'},fields,['/jobs']),null);
  assert.equal(safeProps('unknown',{},fields,['/jobs']),null);
  assert.equal(safeProps('ui.click',{element_key:'x'.repeat(5000)},fields,['/jobs']),null);
  assert.deepEqual(safeProps('search.performed',{query_norm:'drain private@example.test'},fields,[]),{query_norm:'drain'});
});
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}
test('session persists in sessionStorage across reloads within the idle window', () => {
  const storage = fakeStorage();
  const t0 = 1700000000000;
  const id = touchSession(storage, t0);
  assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab]/);
  // A reload reads back the same id without creating a new one.
  assert.equal(readSession(storage, t0 + 60000), id);
  assert.equal(touchSession(storage, t0 + 60000), id);
  // Activity inside the window keeps the session alive past 30 minutes
  // from its creation.
  assert.equal(touchSession(storage, t0 + 60000 + SESSION_IDLE_MS - 1), id);
  assert.equal(
    readSession(storage, t0 + 60000 + 2 * SESSION_IDLE_MS - 2),
    id,
  );
});
test('session rotates to a fresh UUIDv7 after 30 minutes idle', () => {
  const storage = fakeStorage();
  const t0 = 1700000000000;
  const id = touchSession(storage, t0);
  assert.equal(readSession(storage, t0 + SESSION_IDLE_MS), id);
  assert.equal(readSession(storage, t0 + SESSION_IDLE_MS + 1), null);
  const rotated = touchSession(storage, t0 + SESSION_IDLE_MS + 1);
  assert.notEqual(rotated, id);
  assert.equal(readSession(storage, t0 + SESSION_IDLE_MS + 2), rotated);
});
test('session helpers never throw on blocked or corrupt storage', () => {
  const throwing = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  assert.equal(readSession(throwing), null);
  assert.match(touchSession(throwing), /^[a-f0-9-]{36}$/);
  assert.equal(readSession(null), null);
  assert.match(touchSession(undefined), /^[a-f0-9-]{36}$/);
  const corrupt = fakeStorage();
  corrupt.setItem(SESSION_STORAGE_KEY, 'not json');
  assert.equal(readSession(corrupt), null);
  const fresh = touchSession(corrupt);
  assert.equal(readSession(corrupt), fresh);
  corrupt.setItem(SESSION_STORAGE_KEY, JSON.stringify({ id: 42, last: 'x' }));
  assert.equal(readSession(corrupt), null);
});
