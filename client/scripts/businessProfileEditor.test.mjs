import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DESCRIPTION_MAX,
  HEADLINE_MAX,
  buildProfileChecks,
  displayToMiles,
  displayWebsite,
  formatPreviewPlace,
  hoursAreSet,
  isListedBusiness,
  milesToDisplay,
  normalizeWebsite,
  serializeProfileState,
  usesMiles,
} from '../src/utils/businessProfileEditor.js';

test('uses miles only for US, Liberia, and Myanmar', () => {
  assert.equal(usesMiles('US'), true);
  assert.equal(usesMiles('lr'), true);
  assert.equal(usesMiles('CA'), false);
  assert.equal(usesMiles('HT'), false);
  assert.equal(usesMiles('FR'), false);
});

test('converts service radius without dropping below one mile', () => {
  assert.equal(milesToDisplay(25, 'US'), '25');
  assert.equal(milesToDisplay(25, 'FR'), '40');
  assert.equal(displayToMiles('25', 'US'), 25);
  assert.equal(displayToMiles('40', 'FR'), 25);
  assert.equal(displayToMiles('1', 'HT'), 1);
  assert.equal(displayToMiles('', 'CA'), '');
});

test('normalizes websites and preview URLs', () => {
  assert.equal(normalizeWebsite('oxsteed.com'), 'https://oxsteed.com');
  assert.equal(normalizeWebsite('https://oxsteed.com/path'), 'https://oxsteed.com/path');
  assert.equal(normalizeWebsite('not a url'), 'not a url');
  assert.equal(displayWebsite('https://oxsteed.com/'), 'oxsteed.com');
});

test('listing checks match live customer-facing fields', () => {
  const incomplete = buildProfileChecks({ form: {} });
  assert.equal(incomplete.listing.every((row) => row.done), false);
  assert.equal(incomplete.customer.find((row) => row.id === 'hours').tab, 'calendar');

  const ready = buildProfileChecks({
    form: {
      business_name: 'Atelier Midi',
      business_type: 'Cleaning',
      address_city: 'Paris',
      description: 'Home cleaning',
      phone: '+331234',
    },
    logoPreview: 'blob:logo',
    serviceCount: 2,
    hoursReady: true,
  });
  assert.equal(ready.listing.every((row) => row.done), true);
  assert.equal(ready.customer.every((row) => row.done), true);
});

test('restaurant listing uses profile and menu instead of services', () => {
  const checks = buildProfileChecks({
    form: { business_name: 'Cafe', business_type: 'Other', address_city: 'Port-au-Prince' },
    isRestaurant: true,
    restaurantReady: true,
    menuCount: 0,
  });
  assert.equal(checks.listing.some((row) => row.id === 'service'), false);
  assert.equal(checks.listing.find((row) => row.id === 'menu').done, false);
  assert.equal(checks.listing.find((row) => row.id === 'restaurant_profile').tab, 'restaurant');
});

test('null form does not crash listing checks or place formatting', () => {
  const checks = buildProfileChecks({ form: null });
  assert.equal(checks.listing[0].done, false);
  assert.equal(checks.customer.length, 3);
  assert.equal(formatPreviewPlace(null), '');
  assert.equal(serializeProfileState(null, null, null).includes('"form":{}'), true);
});

test('hours, listing status, and unsaved snapshots', () => {
  assert.equal(hoursAreSet([{ is_closed: false, start_time: '09:00' }]), true);
  assert.equal(hoursAreSet([{ is_closed: true, start_time: '09:00' }]), false);
  assert.equal(isListedBusiness({ setup_status: 'active', is_listed: true }), true);
  assert.equal(isListedBusiness({ setup_status: 'draft' }), false);

  const form = { business_name: 'A' };
  const a = serializeProfileState(form, '/logo.png', '');
  const b = serializeProfileState(form, 'blob:123', '');
  assert.notEqual(a, b);
  assert.equal(formatPreviewPlace({ address_city: 'Austin', address_state: 'TX' }), 'Austin, TX');
  assert.equal(HEADLINE_MAX, 120);
  assert.equal(DESCRIPTION_MAX, 500);
});
