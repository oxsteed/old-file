// Audit item 15 UI track — admin Affiliate Payouts page contract.
//
// Run: node --test scripts/adminAffiliatePayouts.test.mjs
//
// The contract:
//   1. The admin route manifest registers /admin/super/affiliate-payouts
//      with the view_financials grant (the same grant the process route
//      enforces), and AdminApp mounts it behind a GrantGuard.
//   2. The server document manifest (adminSpaRoutes) covers the path, or
//      direct loads 404.
//   3. The page lists from GET /affiliate/payouts and processes a pending
//      payout by issuing a step-up from
//      POST /affiliate/:payoutId/stepup-challenges and then posting to
//      POST /affiliate/:payoutId/process with the challenge id + code,
//      showing the queued-for-second-approval outcome distinctly.
//   4. Every new user-visible string exists in all five locales with key
//      parity, and is referenced via t('ns.key') with no defaultValue.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverRoot = path.resolve(root, '..', 'server');
const read = (p) => fs.readFileSync(p, 'utf8');

const page = read(path.join(root, 'src', 'admin', 'pages', 'super', 'AffiliatePayouts.jsx'));
const manifest = read(path.join(root, 'src', 'admin', 'adminRouteManifest.js'));
const app = read(path.join(root, 'src', 'admin', 'AdminApp.jsx'));
const spaRoutes = read(path.join(serverRoot, 'utils', 'adminSpaRoutes.js'));

const PAGE_PATH = '/admin/super/affiliate-payouts';

test('manifest registers the affiliate payouts route with the view_financials grant', () => {
  assert.match(
    manifest,
    /affiliatePayouts: defineRoute\('\/admin\/super\/affiliate-payouts', \{ grant: 'view_financials' \}\)/,
  );
});

test('AdminApp mounts the page behind a GrantGuard', () => {
  assert.match(app, /const AffiliatePayouts = lazyWithRetry\(\(\) => import\('\.\/pages\/super\/AffiliatePayouts'\)\);/);
  assert.match(
    app,
    /path=\{adminRoute\('affiliatePayouts'\)\.relative\}\s+element=\{\s*<GrantGuard grant=\{adminRoute\('affiliatePayouts'\)\.grant\}><AffiliatePayouts \/><\/GrantGuard>/s,
  );
});

test('server document manifest covers the page path for direct loads', () => {
  assert.ok(spaRoutes.includes(`'${PAGE_PATH}'`), 'adminSpaRoutes must list the page path');
});

test('page lists payouts from the admin list endpoint with a status filter', () => {
  assert.ok(page.includes("adminApi.get('/affiliate/payouts'"), 'page must list from GET /affiliate/payouts');
  assert.ok(page.includes('status: tab'), 'page must pass the active tab as the status filter');
  assert.ok(page.includes("p.status === 'pending'"), 'Process action must be offered only on pending rows');
});

test('page processes via the issue endpoint then the newer process route', () => {
  assert.ok(
    page.includes('`/affiliate/${payout.id}/stepup-challenges`'),
    'page must issue the step-up from the dedicated affiliate endpoint',
  );
  assert.ok(
    page.includes('`/affiliate/${payout.id}/process`'),
    'page must post to the newer process route',
  );
  assert.ok(page.includes('stepupChallengeId'), 'process post must carry the challenge id');
  assert.ok(page.includes('stepupCode'), 'process post must carry the entered code');
  assert.ok(
    page.includes("body?.code === 'money_movement_pending_approval'"),
    'page must distinguish the queued-for-second-approval outcome',
  );
  assert.ok(page.includes('affiliatePayouts.queuedNotice'), 'queued outcome must show the queued notice');
  assert.ok(page.includes('affiliatePayouts.processedNotice'), 'processed outcome must show the processed notice');
});

test('page uses no defaultValue fallbacks', () => {
  assert.doesNotMatch(page, /defaultValue/, 'new page strings must use t() with no defaultValue');
});

test('affiliatePayouts keys have parity across all five locales', () => {
  const locales = ['en', 'es', 'fr', 'ht', 'ar'].map(
    (loc) => JSON.parse(read(path.join(root, 'src', 'locales', `${loc}.json`))).affiliatePayouts,
  );
  for (const ns of locales) assert.ok(ns, 'affiliatePayouts namespace must exist in every locale');
  const leaves = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) =>
    (v && typeof v === 'object' ? leaves(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
  const base = leaves(locales[0]).sort();
  assert.ok(base.length >= 25, `expected at least 25 leaf keys, got ${base.length}`);
  for (const ns of locales.slice(1)) assert.deepEqual(leaves(ns).sort(), base);
  // The dynamic tab/status keys the page builds at runtime must all exist.
  for (const key of ['all', 'pending', 'processing', 'completed', 'failed', 'reversed']) {
    for (const ns of locales) assert.equal(typeof ns.tab[key], 'string', `tab.${key} must exist`);
  }
  for (const key of ['pending', 'processing', 'completed', 'failed', 'reversed']) {
    for (const ns of locales) assert.equal(typeof ns.status[key], 'string', `status.${key} must exist`);
  }
});
