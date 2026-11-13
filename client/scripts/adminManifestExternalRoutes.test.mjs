import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const manifest = fs.readFileSync(
  new URL('../src/admin/adminRouteManifest.js', import.meta.url),
  'utf8',
);
const productApp = fs.readFileSync(
  new URL('../src/App.jsx', import.meta.url),
  'utf8',
);

// Domain 1 audit 2026-11-10 finding 20: 14 admin routes live in the main
// SPA (App.jsx), outside the admin manifest. Adding them as manifest entries
// would break the manifest contract tests (adminRouteContracts: every
// manifest path must resolve inside AdminApp, and every manifest key must be
// referenced there; defineRoute's `relative` also only strips a leading
// /admin/), and the allowlist only covers /admin paths, so the documented
// split is the fix: the manifest header names these routes and where they
// live instead of pretending the manifest covers them.
const DIRECT_SUB_ROUTES = [
  '/direct/admin/dashboard',
  '/direct/admin/inbox',
  '/direct/admin/quotes/:id',
  '/direct/admin/calendar',
  '/direct/admin/jobs/:id',
  '/direct/admin/payments/:id',
  '/direct/admin/customers/:userId',
  '/direct/admin/settings',
  '/direct/admin/catalog',
  '/direct/admin/reports',
  '/direct/admin/team',
  '/direct/admin/email-test',
];
const LOGISTICS_CONTROL_ROUTES = [
  '/logistics/admin-control/login',
  '/logistics/admin-control',
];

test('manifest documents the main-SPA admin routes it does not cover', () => {
  for (const route of [...DIRECT_SUB_ROUTES, ...LOGISTICS_CONTROL_ROUTES]) {
    assert.ok(
      manifest.includes(route),
      `manifest must document the split for ${route}`,
    );
    assert.doesNotMatch(
      manifest,
      new RegExp(`defineRoute\\('${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\)`),
      `manifest must not define ${route} as an admin-SPA route`,
    );
  }
  assert.match(manifest, /spaFallback/);
});

test('the 14 documented routes exist in the main SPA behind their guards', () => {
  // Each App.jsx <Route> is a single line, so check the guard on the same
  // line as the path.
  const lines = productApp.split('\n');
  const routeLine = (route) => lines.find((line) => line.includes(`path="${route}"`));
  for (const route of DIRECT_SUB_ROUTES) {
    const line = routeLine(route);
    assert.ok(line, `${route} must exist in App.jsx`);
    assert.ok(
      line.includes('DirectAdminRouteGate'),
      `${route} must exist in App.jsx behind DirectAdminRouteGate`,
    );
  }
  for (const route of LOGISTICS_CONTROL_ROUTES) {
    assert.ok(routeLine(route), `${route} must exist in App.jsx`);
  }
  assert.ok(
    routeLine('/logistics/admin-control').includes('LogisticsOperatorGuard'),
    '/logistics/admin-control must exist in App.jsx behind LogisticsOperatorGuard',
  );
});
