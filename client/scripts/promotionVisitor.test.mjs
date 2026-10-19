import test from 'node:test';
import assert from 'node:assert/strict';

const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
globalThis.window = { localStorage: store(), sessionStorage: store() };
const { existingPromotionVisitorId, isPromotionConversionRequest, PROMO_VISITOR_KEY } = await import('../src/utils/promotionVisitor.js');

test('only checkout POSTs carry the promo visitor id', () => {
  for (const url of ['/bookings', 'bookings', '/businesses/12/appointments', '/restaurants/abc/orders', '/food/restaurants/9/orders?x=1', '/api/bookings', '/jobs/assign']) {
    assert.equal(isPromotionConversionRequest({ method: 'post', url }), true, url);
  }
  for (const [method, url] of [['get', '/bookings'], ['post', '/bookings/1/accept'], ['post', '/businesses/12/appointments/staff-create'],
    ['post', '/restaurants/abc/devices/d1/orders'], ['post', '/restaurants/abc/display/devices/d1/orders'], ['post', '/admin/orders/1/refund'], ['post', '/jobs/assign/extra'], ['get', '/jobs/assign']]) {
    assert.equal(isPromotionConversionRequest({ method, url }), false, url);
  }
});

test('never creates an id; reads a valid existing one from either store', () => {
  assert.equal(existingPromotionVisitorId(), null);
  window.sessionStorage.setItem(PROMO_VISITOR_KEY, 'junk');
  assert.equal(existingPromotionVisitorId(), null);
  const id = '3f2b1c4d-1111-4222-8333-444455556666';
  window.sessionStorage.setItem(PROMO_VISITOR_KEY, id);
  assert.equal(existingPromotionVisitorId(), id);
});

test('the visit beacon tells the server whether analytics consent was given (decision 3)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/hooks/usePromotionVisitBeacon.js', import.meta.url), 'utf8');
  assert.match(src, /analyticsConsent:\s*hasAnalyticsConsent\(\)/);
});
