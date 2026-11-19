import test from 'node:test';
import assert from 'node:assert/strict';
import { PERSONA_NAVIGATION_CATALOG, deriveAdaptiveNavigation } from '../src/utils/personaNavigation.js';

const projection = (personal = ['customer'], organizations = [], extra = {}) => ({
  flags: { accessProjection: true },
  access: { personal, organizations, ...extra },
});

const destinations = (nav) => [...nav.primary, ...nav.account].map((item) => item.to);

test('the adaptive catalog covers all 18 persona families and every shared surface', () => {
  assert.equal(PERSONA_NAVIGATION_CATALOG.length, 18);
  for (const family of PERSONA_NAVIGATION_CATALOG) {
    assert.ok(family.id && family.variants.length, family.id);
    assert.ok(family.scope, family.id);
    assert.ok(Array.isArray(family.setup), family.id);
    const expectedSurfaces = family.id === 'device-service-account' ? [] : ['desktop', 'mobile', 'installed', 'bottom'];
    assert.deepEqual(family.surfaces, expectedSurfaces, family.id);
  }
});

test('customer baseline is shared and remains available beside every approved relationship', () => {
  const nav = deriveAdaptiveNavigation(projection());
  assert.equal(nav.mode, 'customer');
  assert.ok(destinations(nav).includes('/dashboard'));
  assert.ok(destinations(nav).includes('/post-job'));
  assert.deepEqual(nav.surfaces, ['desktop', 'mobile', 'installed', 'bottom']);
});

test('active helper sees Opportunities and My Bids without a persona switch', () => {
  const nav = deriveAdaptiveNavigation(projection(['customer', 'helper.offer_services']));
  assert.equal(nav.mode, 'customer');
  assert.ok(destinations(nav).includes('/jobs'));
  assert.ok(destinations(nav).includes('/helper-dashboard'));
});

test('approved but incomplete activation exposes setup, not a protected helper workspace', () => {
  const nav = deriveAdaptiveNavigation(projection(['customer', 'helper.offer_services'], [], { activation: { 'helper.offer_services': 'needs_setup' } }));
  assert.ok(destinations(nav).includes('/settings/applications'));
  assert.ok(!destinations(nav).includes('/helper-dashboard'));
});

test('restaurant tools are limited to explicit assigned-location shortcuts', () => {
  const nav = deriveAdaptiveNavigation(projection(['customer'], [{ type: 'business', id: 42, name: 'Restaurant business' }], {
    locations: [
      { type: 'restaurant_location', id: 7, businessId: 42, name: 'Downtown', role: 'staff', shortcuts: [{ id: 'orders', to: '/restaurants/locations/7/orders', labelKey: 'nav.foodOrders' }] },
      { type: 'restaurant_location', id: 8, businessId: 42, name: 'Uptown', role: 'staff', shortcuts: [] },
    ],
  }));
  const paths = destinations(nav);
  assert.ok(paths.includes('/restaurants/locations/7/orders'));
  assert.ok(!paths.includes('/restaurants/locations/8/orders'));
  assert.deepEqual(paths.filter((path) => /^\/business\//.test(path)), ['/business/42/workspace']);
});

test('a restaurant location alone never exposes a business workspace', () => {
  const nav = deriveAdaptiveNavigation(projection(['customer'], [], {
    locations: [{ type: 'restaurant_location', id: 7, businessId: 42, shortcuts: [{ id: 'orders', to: '/restaurants/locations/7/orders' }] }],
  }));
  assert.equal(nav.showBusinessSwitcher, false);
  assert.ok(destinations(nav).includes('/restaurants/locations/7/orders'));
  assert.ok(!destinations(nav).some((path) => path.startsWith('/business')));
});

test('overlapping helper and restaurant access revokes one location only', () => {
  const organizations = [{ type: 'business', id: 42, name: 'Restaurant business' }];
  const locations = [7, 8].map((id) => ({
    type: 'restaurant_location', id, businessId: 42,
    shortcuts: [{ id: 'orders', to: `/restaurants/locations/${id}/orders`, labelKey: 'nav.foodOrders' }],
  }));
  const personal = ['customer', 'helper.offer_services'];
  const before = deriveAdaptiveNavigation(projection(personal, organizations, { locations }));
  const after = deriveAdaptiveNavigation(projection(personal, organizations, { locations: locations.slice(1) }));
  assert.ok(destinations(before).includes('/helper-dashboard'));
  assert.ok(destinations(before).includes('/restaurants/locations/7/orders'));
  assert.ok(!destinations(after).includes('/restaurants/locations/7/orders'));
  assert.ok(destinations(after).includes('/restaurants/locations/8/orders'));
  assert.ok(destinations(after).includes('/business/42/workspace'));
  assert.ok(destinations(after).includes('/post-job'));
  assert.ok(destinations(after).includes('/helper-dashboard'));
});

test('staff enters a separate shell while retaining Personal Home', () => {
  const nav = deriveAdaptiveNavigation(projection(['customer', 'staff.support']));
  assert.ok(destinations(nav).includes('/support/agent'));
  assert.ok(destinations(nav).includes('/dashboard'));
  assert.equal(nav.account.find((item) => item.id === 'support').staffShell, true);
});

test('investor reporting is read-only and never exposes investment participation', () => {
  const nav = deriveAdaptiveNavigation(projection(['customer', 'investor.reporting'], [], {
    investorAudience: { audienceKey: 'entity', datasets: ['kpis'] },
  }));
  assert.ok(destinations(nav).includes('/investments'));
  assert.ok(!destinations(nav).some((path) => /commit|participat/i.test(path)));
});

test('planned, unverified, and nonhuman actors fail closed', () => {
  const planned = deriveAdaptiveNavigation(projection(['customer', 'credit.participate'], [], { activation: { 'credit.participate': 'needs_setup' } }));
  assert.ok(!destinations(planned).some((path) => path.includes('credit')));
  const nonhuman = deriveAdaptiveNavigation(projection([], [], { actorType: 'nonhuman' }));
  assert.deepEqual(nonhuman.primary, []);
  assert.deepEqual(nonhuman.account, []);
});

test('projection failure never restores protected persona links', () => {
  const nav = deriveAdaptiveNavigation({ flags: {}, access: { personal: ['helper.offer_services'] } });
  assert.ok(destinations(nav).includes('/post-job'));
  assert.ok(!destinations(nav).includes('/helper-dashboard'));
});

test('business and restaurant setup links point at the real launch status page', () => {
  const business = deriveAdaptiveNavigation(projection(['customer', 'business.own'], [], { activation: { 'business.own': 'needs_setup' } }));
  assert.ok(destinations(business).includes('/business-launch-status'));
  const restaurant = deriveAdaptiveNavigation(projection(['customer', 'restaurant.own'], [], { activation: { 'restaurant.own': 'needs_setup' } }));
  assert.ok(destinations(restaurant).includes('/business-launch-status'));
  for (const nav of [business, restaurant]) {
    assert.ok(!destinations(nav).includes('/business-launch/status'), 'the misspelled setup path must not ship');
  }
  // The catalog is the source for those links: both setup entries name the
  // real route.
  for (const family of PERSONA_NAVIGATION_CATALOG.filter((entry) => ['business-owner', 'restaurant-owner'].includes(entry.id))) {
    assert.deepEqual(family.setup, ['/business-launch-status'], family.id);
  }
});
