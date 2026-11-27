import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PERSONA_NAVIGATION_CATALOG, deriveAdaptiveNavigation, groupAccountItems, primaryRouteForFamily, familyForMode } from '../src/utils/personaNavigation.js';

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

test('G-1 server activation shape holds protected links until requirements are met', () => {
  // The server projection emits { ready, missing } per capability; the
  // branch above must fire for that shape too, not just the 'needs_setup'
  // string the fixture hand-injects.
  const held = deriveAdaptiveNavigation(projection(['customer', 'helper.offer_services'], [], {
    activation: { 'helper.offer_services': { ready: false, missing: ['identity_verified', 'helper_terms', 'payout_setup'] } },
  }));
  assert.ok(destinations(held).includes('/settings/applications'));
  assert.ok(!destinations(held).includes('/helper-dashboard'));
  assert.ok(!destinations(held).includes('/jobs'));
  const ready = deriveAdaptiveNavigation(projection(['customer', 'helper.offer_services'], [], {
    activation: { 'helper.offer_services': { ready: true, missing: [] } },
  }));
  assert.ok(destinations(ready).includes('/helper-dashboard'));
  assert.ok(destinations(ready).includes('/jobs'));
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

test('phantom capabilities grant nothing; credit, partner, and learning are baseline links', () => {
  // G-9: credit.participate, partner.attribute, and workforce.learn do not
  // exist in the capability registry, so the catalog must not reference
  // them. The three pages are reachable from the customer baseline without
  // a grant and promise none.
  for (const family of PERSONA_NAVIGATION_CATALOG) {
    assert.ok(!['credit.participate', 'partner.attribute', 'workforce.learn'].includes(family.capability), family.id);
  }
  const baseline = deriveAdaptiveNavigation(projection());
  assert.ok(destinations(baseline).includes('/oxsteed-credit'));
  assert.ok(destinations(baseline).includes('/affiliate'));
  assert.ok(destinations(baseline).includes('/learn'));
  // A projection that still carries a phantom value gains no persona link
  // for it: the pages stay baseline-only, never protected persona links.
  const planned = deriveAdaptiveNavigation(projection(['customer', 'credit.participate'], [], { activation: { 'credit.participate': 'needs_setup' } }));
  assert.deepEqual(planned.personas, ['customer']);
  assert.ok(!planned.account.some((item) => item.protected && item.to === '/oxsteed-credit'));
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

test('catalog primary resolves to a real route only for access-backed families', () => {
  // G-40: primary used to be a symbolic id with no consumer. The route map
  // makes it load-bearing; capability-less families never gain a target.
  const held = (personal, extra = {}) => ({ flags: { accessProjection: true }, access: { personal, organizations: [], ...extra } });
  assert.equal(primaryRouteForFamily('helper', held(['customer', 'helper.offer_services'])), '/helper-dashboard');
  assert.equal(primaryRouteForFamily('helper', held(['customer'])), null);
  assert.equal(primaryRouteForFamily('business-owner', held(['customer'], { organizations: [{ type: 'business', id: 9, role: 'owner', capabilities: ['business.own'] }] })), '/business-hub');
  // The server projects organizations as { type, id, name, role } with no
  // capabilities array, so the owner role alone must back the primary too.
  assert.equal(primaryRouteForFamily('business-owner', held(['customer'], { organizations: [{ type: 'business', id: 9, role: 'owner' }] })), '/business-hub');
  assert.equal(primaryRouteForFamily('business-owner', held(['customer'], { organizations: [{ type: 'business', id: 9, role: 'manager' }] })), null, 'a manager holds no ownership capability');
  assert.equal(primaryRouteForFamily('investor-reporting', held(['customer', 'investor.reporting'])), null, 'reporting without an audience has no destination');
  assert.equal(primaryRouteForFamily('investor-reporting', held(['customer', 'investor.reporting'], { investorAudience: { audienceKey: 'entity', datasets: ['overview'] } })), '/investments');
  assert.equal(primaryRouteForFamily('customer', held(['customer'])), '/');
  for (const familyId of ['business-team', 'restaurant-team', 'reviewer', 'support-agent', 'operations-staff', 'device-service-account']) {
    assert.equal(primaryRouteForFamily(familyId, held(['customer', 'helper.offer_services'])), null, familyId);
  }
  assert.equal(familyForMode('helper').id, 'helper');
  assert.equal(familyForMode('business_owner').id, 'business-owner');
  assert.equal(familyForMode('investor').id, 'investor-reporting');
  assert.equal(familyForMode('no-such-mode'), null);
});

test('catalog carries no dead shortcuts field and every setup entry is a real path', () => {
  for (const family of PERSONA_NAVIGATION_CATALOG) {
    assert.equal('shortcuts' in family, false, `${family.id} still ships dead shortcuts`);
    assert.ok(Array.isArray(family.setup), family.id);
    for (const entry of family.setup) assert.match(entry, /^\//, `${family.id} setup entry ${entry}`);
  }
  // The activation setup links read the catalog entries, not a hardcoded copy.
  const businessSetup = PERSONA_NAVIGATION_CATALOG.find((entry) => entry.id === 'business-owner').setup;
  const nav = deriveAdaptiveNavigation({ flags: { accessProjection: true }, access: { personal: ['customer', 'business.own'], organizations: [], activation: { 'business.own': 'needs_setup' } } });
  assert.ok(destinations(nav).includes(businessSetup[0]));
});

test('projection loading or failure surfaces a retrying notice instead of silent customer-only nav', () => {
  // G-41: fail-closed stays (customer-only links, no workspace), but the nav
  // now says the workspace links are unavailable and retrying instead of
  // silently dropping them.
  for (const status of ['loading', 'temporary_failure', 'rollback']) {
    const nav = deriveAdaptiveNavigation({ flags: {}, access: null, status });
    assert.equal(nav.projectionNotice, status);
    assert.ok(destinations(nav).includes('/post-job'));
    assert.ok(!destinations(nav).includes('/helper-dashboard'));
  }
  const ready = deriveAdaptiveNavigation(projection(['customer', 'helper.offer_services']));
  assert.equal(ready.projectionNotice, null);
  const signedOut = deriveAdaptiveNavigation({ flags: {}, access: null, status: 'unauthenticated' });
  assert.equal(signedOut.projectionNotice, null);
});

test('account menu groups into labeled sections with owned businesses under Business', async () => {
  const organizations = [{ type: 'business', id: 42, name: 'Restaurant business' }];
  const nav = deriveAdaptiveNavigation(projection(
    ['customer', 'helper.offer_services', 'business.own', 'restaurant.own', 'investor.reporting'],
    organizations,
    { investorAudience: { audienceKey: 'entity', datasets: ['overview'] } },
  ));
  // Mirror the Navbar: applications live in their own disclosure, not here.
  const accountItems = nav.account.filter((item) => item.id !== 'applications');
  const groups = groupAccountItems(accountItems);
  assert.deepEqual(groups.map((group) => group.id), ['lead', 'money', 'ordersWork', 'business', 'learn', 'account']);
  assert.deepEqual(groups[0].items.map((item) => item.id), ['dashboard']);
  const byId = (id) => groups.find((group) => group.id === id).items.map((item) => item.id);
  assert.ok(byId('money').includes('credit'));
  assert.ok(byId('money').includes('wallet'));
  assert.ok(byId('money').includes('statements'));
  assert.ok(byId('money').includes('investments'));
  assert.ok(byId('ordersWork').includes('foodOrders'));
  assert.ok(byId('ordersWork').includes('browseJobs'));
  assert.ok(byId('ordersWork').includes('myWork'));
  // The owned business stays in the menu, grouped under Business with the hub.
  assert.ok(byId('business').includes('workspace'));
  assert.ok(byId('business').includes('workspace-42'));
  assert.ok(byId('business').includes('persona-restaurant-workspace'));
  assert.ok(byId('learn').includes('partner'));
  assert.ok(byId('learn').includes('learning'));
  assert.deepEqual(byId('account'), ['settings', 'help']);
  // Every section label key exists in all five real locales.
  for (const group of groups) {
    if (!group.labelKey) continue;
    const key = group.labelKey.replace(/^nav\./, '');
    for (const language of ['en', 'es', 'fr', 'ht', 'ar']) {
      const legacy = JSON.parse(await readFile(new URL(`../src/locales/${language}.json`, import.meta.url)));
      assert.equal(typeof legacy.nav[key], 'string', `${language}: nav.${key}`);
      assert.ok(legacy.nav[key].trim(), `${language}: nav.${key} is empty`);
    }
  }
});
