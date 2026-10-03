import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const PROVIDER_IDS = ['stripe', 'maps', 'messaging', 'ai', 'scanning', 'storage', 'calendars', 'trackers'];

test('providerHealth route is registered with GrantGuard and manage_operations grant', () => {
  const manifest = read('src/admin/adminRouteManifest.js');
  assert.match(
    manifest,
    /providerHealth:\s*defineRoute\('\/admin\/operations\/providers',\s*\{\s*grant:\s*'manage_operations'\s*\}\)/
  );
  const app = read('src/admin/AdminApp.jsx');
  assert.match(app, /const ProviderHealthPage = lazyWithRetry\(\(\) => import\('\.\/pages\/ProviderHealthPage'\)\)/);
  assert.match(
    app,
    /path=\{adminRoute\('providerHealth'\)\.relative\}\s+element=\{\s*<GrantGuard grant=\{adminRoute\('providerHealth'\)\.grant\}><ProviderHealthPage \/><\/GrantGuard>\s*\}/s
  );
});

test('OperationsOverview links the integrations card to the provider health page', () => {
  const overview = read('src/admin/pages/OperationsOverview.jsx');
  assert.match(overview, /section\.key === 'integrations' && \(/);
  assert.match(overview, /to=\{adminRoute\('providerHealth'\)\.path\}/);
});

test('server route is admin-only with the manage_operations grant and is mounted', () => {
  const route = read('../server/routes/providerHealth.js');
  assert.match(route, /requireAdmin,\s*requirePermission\('manage_operations'\)/);
  assert.match(route, /router\.get\('\/', providerHealthController\.listProviders\)/);
  assert.match(route, /router\.get\('\/:id', providerHealthController\.getProvider\)/);
  assert.match(route, /router\.post\('\/:id\/probe', generalLimiter, providerHealthController\.runProbe\)/);
  assert.match(route, /router\.post\('\/:id\/circuit\/reset', generalLimiter, providerHealthController\.resetCircuit\)/);
  const index = read('../server/index.js');
  assert.match(index, /app\.use\('\/api\/provider-health', providerHealthRoutes\)/);
});

test('page renders every contract field: capability, owner, alert, retry, circuit breaker, budget, rotation, customer-safe state', () => {
  const page = read('src/admin/pages/ProviderHealthPage.jsx');
  for (const key of [
    'adminProviderHealth.fields.owner',
    'adminProviderHealth.fields.alertChannel',
    'adminProviderHealth.fields.capabilities',
    'adminProviderHealth.fields.customerSafe',
    'adminProviderHealth.fields.retryPolicy',
    'adminProviderHealth.fields.circuitBreaker',
    'adminProviderHealth.fields.budget',
    'adminProviderHealth.fields.rotation',
  ]) {
    assert.ok(page.includes(key), `page must render ${key}`);
  }
  assert.match(page, /adminApi\.get\('\/provider-health'/);
  assert.match(page, /adminApi\.post\(`\/provider-health\/\$\{providerId\}\/circuit\/reset`\)/);
});

test('server registry and client locale tree agree on the eight providers', () => {
  const registry = read('../server/services/providerHealthRegistry.js');
  for (const id of PROVIDER_IDS) {
    assert.ok(registry.includes(`id: '${id}'`), `registry must define provider ${id}`);
  }
  for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(read(`src/locales/${lang}.json`));
    const tree = catalog.adminProviderHealth;
    assert.ok(tree, `${lang} must carry adminProviderHealth`);
    for (const id of PROVIDER_IDS) {
      const p = tree.providers[id];
      assert.ok(p && typeof p.name === 'string', `${lang}.providers.${id}.name`);
      assert.ok(typeof p.description === 'string', `${lang}.providers.${id}.description`);
      assert.ok(typeof p.customerSafeSummary === 'string', `${lang}.providers.${id}.customerSafeSummary`);
      assert.ok(typeof p.retryNote === 'string', `${lang}.providers.${id}.retryNote`);
      assert.ok(typeof p.budgetNote === 'string', `${lang}.providers.${id}.budgetNote`);
      assert.ok(typeof p.rotationProcedure === 'string', `${lang}.providers.${id}.rotationProcedure`);
      assert.ok(p.capabilities && Object.keys(p.capabilities).length > 0, `${lang}.providers.${id}.capabilities`);
      for (const [capId, cap] of Object.entries(p.capabilities)) {
        assert.ok(typeof cap.label === 'string', `${lang}.providers.${id}.capabilities.${capId}.label`);
        assert.ok(typeof cap.customerSafe === 'string', `${lang}.providers.${id}.capabilities.${capId}.customerSafe`);
      }
    }
  }
});

test('no em dashes in provider health copy', () => {
  for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
    const raw = read(`src/locales/${lang}.json`);
    const start = raw.indexOf('"adminProviderHealth"');
    const end = raw.indexOf('"adminRegionsMilesUnit"');
    const slice = raw.slice(start, end === -1 ? undefined : end);
    assert.ok(!slice.includes('—'), `${lang} provider health copy must not contain em dashes`);
  }
});
