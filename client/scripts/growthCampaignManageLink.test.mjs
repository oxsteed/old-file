import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const growthInsights = fs.readFileSync(
  new URL('../src/admin/pages/growth/GrowthInsights.jsx', import.meta.url),
  'utf8',
);
const manifest = fs.readFileSync(
  new URL('../src/admin/adminRouteManifest.js', import.meta.url),
  'utf8',
);
const adminApp = fs.readFileSync(
  new URL('../src/admin/AdminApp.jsx', import.meta.url),
  'utf8',
);
const allowlist = fs.readFileSync(
  new URL('../../server/utils/adminSpaRoutes.js', import.meta.url),
  'utf8',
);
const locale = (code) =>
  JSON.parse(
    fs.readFileSync(
      new URL(`../src/locales/${code}.json`, import.meta.url),
      'utf8',
    ),
  );

// Domain 1 audit 2026-11-10 finding 7: /admin/growth/campaigns/:id was
// URL-only; the GrowthInsights campaigns table must link each row to its
// Manage (detail) page.
test('growth campaigns table links each row to its Manage detail page', () => {
  assert.match(
    growthInsights,
    /to=\{`\/admin\/growth\/campaigns\/\$\{row\.id\}`\}/,
    'campaigns table needs a per-row link to /admin/growth/campaigns/${row.id}',
  );
  assert.match(
    growthInsights,
    /label\('manage'\)/,
    'Manage link label must use the growthInsights.manage key (no hardcoded string)',
  );
  // The link lives in the campaigns row actions, not in another section.
  const actions = growthInsights.slice(
    growthInsights.indexOf("{section === 'campaigns' && ("),
    growthInsights.indexOf("{section === 'campaigns' && (") + 3000,
  );
  assert.match(actions, /\/admin\/growth\/campaigns\/\$\{row\.id\}/);
});

test('growth campaign detail route exists in the manifest, AdminApp and allowlist', () => {
  assert.match(
    manifest,
    /growthCampaignDetail: defineRoute\('\/admin\/growth\/campaigns\/:id'/,
  );
  assert.match(adminApp, /adminRoute\('growthCampaignDetail'\)/);
  assert.match(allowlist, /'\/admin\/growth\/campaigns\/:id'/);
});

test('growthInsights.manage is translated in all five locales', () => {
  for (const code of ['en', 'es', 'fr', 'ht', 'ar']) {
    const value = locale(code).growthInsights?.manage;
    assert.equal(typeof value, 'string', `${code} growthInsights.manage`);
    assert.ok(value.trim().length > 0, `${code} growthInsights.manage`);
  }
});
