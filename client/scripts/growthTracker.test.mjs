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
