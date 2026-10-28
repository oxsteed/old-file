import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildRestaurantDiscoveryParams,
  mergeUniqueRestaurants,
  isFeaturedRestaurant,
  restaurantHoursLabel,
  restaurantFulfillmentLabels,
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

test('requires explicit, bounded coordinates while preserving a valid zero location', () => {
  for (const geo of [{lat:null,lng:null},{lat:'',lng:''},{lat:91,lng:0},{lat:0,lng:181}]) {
    assert.equal('lat' in buildRestaurantDiscoveryParams({geo}), false);
  }
  assert.equal(buildRestaurantDiscoveryParams({geo:{lat:0,lng:0}}).lat, 0);
});

const catalog = JSON.parse(readFileSync(new URL('../src/locales/en.json', import.meta.url)));
const t = (key, params = {}) => {
  const text = key.split('.').reduce((value, part) => value?.[part], catalog);
  assert.equal(typeof text, 'string', key);
  return text.replace(/\{\{(\w+)\}\}/g, (_, name) => params[name] ?? '');
};

test('discovery uses server hours without inventing a schedule or converting the restaurant clock', () => {
  const open = {is_open:true,hours_message_code:'open_until',hours_message_params:{closesAt:'6:00 PM'}};
  assert.equal(restaurantHoursLabel(open,t,'en-US'),'Open until 6:00 PM');
  assert.equal(restaurantHoursLabel({...open,is_accepting_orders_now:false},t),'Orders paused');
  assert.equal(restaurantHoursLabel({...open,is_accepting_orders_now:false,hours_message_code:'temporarily_closed'},t),'Temporarily closed');
  assert.equal(restaurantHoursLabel({is_open:true},t),'Hours not listed');
  assert.equal(restaurantHoursLabel({...open,hours_message_params:{closesAt:'bad time'}},t),'Hours not listed');
  assert.equal(restaurantHoursLabel({hours_message_code:'opens_day_at',hours_message_params:{opensAt:'10:15 AM',opensDay:'fri'}},t),'Opens Fri at 10:15 AM');
  assert.equal(restaurantHoursLabel({hours_message_code:'opens_day_at',hours_message_params:{opensAt:'10:15 AM',opensDay:'unknown'}},t),'Hours not listed');
});

test('only known configured fulfillment modes and active featured placements are advertised', () => {
  assert.deepEqual(restaurantFulfillmentLabels({fulfillment_modes:['pickup','unknown','delivery','pickup','dine_in','kiosk']},t),['Takeout','Delivery','Dine in']);
  assert.deepEqual(restaurantFulfillmentLabels({},t),[]);
  assert.equal(isFeaturedRestaurant({avg_rating:5}),false);
  assert.equal(isFeaturedRestaurant({is_featured:true,featured_until:'2026-01-01'},Date.parse('2026-10-27')),false);
  assert.equal(isFeaturedRestaurant({is_featured:true,featured_until:'bad'}),false);
  assert.equal(isFeaturedRestaurant({is_featured:true}),true);
});

test('new discovery copy has matching keys and text in both catalogs for all five required languages', () => {
  for (const lang of ['en','es','fr','ht','ar']) {
    const legacy = JSON.parse(readFileSync(new URL(`../src/locales/${lang}.json`,import.meta.url))).food.home.discovery;
    const namespaced = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${lang}/common.json`,import.meta.url))).food.home.discovery;
    assert.deepEqual(Object.keys(legacy).sort(),Object.keys(catalog.food.home.discovery).sort());
    assert.deepEqual(namespaced,legacy);
    assert.ok(Object.values(legacy).every(value=>typeof value==='string'&&value.trim()));
  }
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
