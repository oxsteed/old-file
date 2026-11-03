import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyRouteMeta,
  buildDetailMeta,
  hreflangAlternates,
  localizedUrl,
  resolveRouteMeta,
} from './seoMeta.js';

test('public routes resolve to indexable locale keys', () => {
  assert.equal(resolveRouteMeta('/').key, 'home');
  assert.equal(resolveRouteMeta('/').noIndex, false);
  assert.equal(resolveRouteMeta('/about').key, 'about');
  assert.equal(resolveRouteMeta('/restaurants').key, 'restaurants');
  assert.equal(resolveRouteMeta('/jobs').key, 'jobs');
  assert.equal(resolveRouteMeta('/jobs/public/42').key, 'jobPublic');
  assert.equal(resolveRouteMeta('/direct/request-quote').key, 'directRequestQuote');
  assert.equal(resolveRouteMeta('/terms').key, 'terms');
  assert.equal(resolveRouteMeta('/legal/arbitration').key, 'legalArbitration');
  assert.equal(resolveRouteMeta('/logistics/campaigns/7').key, 'campaignDetail');
  assert.equal(resolveRouteMeta('/businesses/public/9').key, 'businessProfile');
  assert.equal(resolveRouteMeta('/b/some-slug').key, 'businessProfile');
});

test('redirect routes never get indexable meta', () => {
  for (const path of ['/discover', '/discover/anything', '/features', '/hire', '/h/abc', '/helpers/public/abc', '/register/customer', '/direct/service-area', '/cart/1', '/checkout/1']) {
    const resolved = resolveRouteMeta(path);
    assert.equal(resolved.noIndex, true, path);
    assert.equal(resolved.redirect, true, path);
  }
});

test('authenticated, transactional, and tokenized routes are noindex', () => {
  for (const path of ['/admin/users', '/login', '/dashboard', '/messages', '/settings', '/jobs/42/edit', '/jobs/42', '/careers/me', '/support/my-tickets/1', '/support/agent', '/restaurants/support/cases', '/invoice/p/token', '/media/compose', '/media/bookmarks', '/media/notifications', '/media/messages', '/direct/admin/dashboard', '/direct/quotes/1', '/direct/book/1', '/direct/jobs/1', '/direct/payments/1', '/direct/history', '/direct/support', '/direct/account', '/saved-searches', '/bids/1', '/t/token', '/pay/code']) {
    assert.equal(resolveRouteMeta(path).noIndex, true, path);
  }
});

test('media public routes follow the media launch flag', () => {
  assert.equal(resolveRouteMeta('/media', { mediaLaunched: true }).key, 'media');
  assert.equal(resolveRouteMeta('/media/post/3', { mediaLaunched: true }).key, 'mediaPost');
  assert.equal(resolveRouteMeta('/media', { mediaLaunched: false }).redirect, true);
  assert.equal(resolveRouteMeta('/media/post/3', { mediaLaunched: false }).noIndex, true);
});

test('legacy food restaurant URLs canonicalize to the restaurants route', () => {
  const resolved = resolveRouteMeta('/food/restaurants/12');
  assert.equal(resolved.key, 'restaurantDetail');
  assert.equal(resolved.canonicalPath, '/restaurants/r/12');
  assert.equal(resolveRouteMeta('/restaurants/r/12').canonicalPath, '/restaurants/r/12');
});

test('how-it-works area slugs humanize without inventing content', () => {
  const resolved = resolveRouteMeta('/how-it-works/plumbing-repair');
  assert.equal(resolved.key, 'howItWorksArea');
  assert.equal(resolved.titleParams.area, 'Plumbing Repair');
});

test('unknown routes are noindex', () => {
  const resolved = resolveRouteMeta('/definitely-not-a-route');
  assert.equal(resolved.noIndex, true);
  assert.equal(resolved.unmatched, true);
});

test('hreflang uses the ?lang= scheme, never path prefixes', () => {
  assert.equal(localizedUrl('/about', 'es'), 'https://oxsteed.com/about?lang=es');
  assert.equal(localizedUrl('/about', 'en'), 'https://oxsteed.com/about');
  assert.equal(localizedUrl('/about?lang=fr', 'es'), 'https://oxsteed.com/about?lang=es');
  const alternates = hreflangAlternates('/about');
  assert.deepEqual(alternates.map((entry) => entry.hreflang), ['en', 'es', 'fr', 'ht', 'ar', 'x-default']);
  assert.ok(!alternates.some((entry) => entry.href.includes('/es/')));
});

test('detail meta uses only supplied data and caps descriptions', () => {
  const meta = buildDetailMeta({ name: 'Maria', city: 'Springfield', category: 'plumbing' });
  assert.equal(meta.title, 'Maria in Springfield | OxSteed');
  assert.ok(meta.description.includes('Maria'));
  assert.ok(!meta.description.includes('$'));
  assert.equal(buildDetailMeta({}), null);
  assert.equal(buildDetailMeta({ name: 'x'.repeat(200) }).description.length <= 160, true);
});

test('applyRouteMeta is a no-op without a document', () => {
  assert.equal(applyRouteMeta({ title: 'Hi', canonicalPath: '/', noIndex: false }), undefined);
  assert.equal(applyRouteMeta({ noIndex: true }), undefined);
});
