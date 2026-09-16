import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRestaurantDiscoveryParams,
  mergeUniqueRestaurants,
} from '../src/pages/food/restaurantDiscovery.js';

test('builds a bounded discovery request with normalized filters', () => {
  assert.deepEqual(
    buildRestaurantDiscoveryParams({
      query: '  Caribbean  ',
      cuisine: 'Caribbean',
      geo: { lat: '39.9242', lng: '-83.8088' },
      sort: 'distance',
      offset: 24,
    }),
    {
      limit: 24,
      offset: 24,
      sort: 'distance',
      q: 'Caribbean',
      cuisine: 'Caribbean',
      lat: 39.9242,
      lng: -83.8088,
    },
  );
});

test('omits empty filters and invalid coordinates', () => {
  assert.deepEqual(
    buildRestaurantDiscoveryParams({
      query: '  ',
      cuisine: '',
      geo: { lat: 'not-a-number', lng: null },
    }),
    {
      limit: 24,
      offset: 0,
      sort: 'recommended',
    },
  );
});

test('merges restaurant pages in order without duplicate or invalid records', () => {
  assert.deepEqual(
    mergeUniqueRestaurants(
      [{ id: 'one', display_name: 'One' }],
      [
        { id: 'one', display_name: 'Duplicate' },
        { id: 'two', display_name: 'Two' },
        null,
        { display_name: 'Missing id' },
        { id: 'three', display_name: 'Three' },
        { id: 'three', display_name: 'Duplicate three' },
      ],
    ),
    [
      { id: 'one', display_name: 'One' },
      { id: 'two', display_name: 'Two' },
      { id: 'three', display_name: 'Three' },
    ],
  );
});
