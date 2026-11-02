import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRestaurantDiscoveryParams } from './restaurantDiscovery.js';

test('discovery params carry open-now and fulfillment filters', () => {
  const params = buildRestaurantDiscoveryParams({ openNow: true, fulfillment: 'delivery' });
  assert.equal(params.open_now, true);
  assert.equal(params.fulfillment, 'delivery');
});

test('discovery params omit filters when unset and reject unknown fulfillment modes', () => {
  const params = buildRestaurantDiscoveryParams({ fulfillment: 'drone' });
  assert.equal(params.open_now, undefined);
  assert.equal(params.fulfillment, undefined);
});
