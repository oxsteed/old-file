// Contract tests for the OxSteed Credit licence-readiness UI (customer panels
// and the super-admin licence controls page). They read source files and
// check them against the server routes, the oversight executors and the
// locale catalogs, so a renamed route, an unregistered two-admin action or a
// missing translation fails CI before it reaches a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverRoot = path.resolve(clientRoot, '../server');
const read = (p) => fs.readFileSync(p, 'utf8');
const readClient = (rel) => read(path.join(clientRoot, rel));
const readJson = (p) => JSON.parse(read(p));

const helperFiles = [
  'CreditCashoutPanel.jsx', 'CreditPayoutDestinations.jsx', 'CreditWageConsentPanel.jsx',
  'CreditDisclosuresPanel.jsx', 'CreditWindDownBanner.jsx', 'CreditErasurePanel.jsx', 'creditLicenceClient.js',
  'CreditWindDownDestinations.jsx',
].map((f) => `src/components/paymentLayers/${f}`);
const licenceDir = 'src/admin/pages/super/oxsteedCredit/licence';
const adminFiles = ['src/admin/pages/super/oxsteedCredit/LicencePage.jsx',
  ...fs.readdirSync(path.join(clientRoot, licenceDir)).map((f) => `${licenceDir}/${f}`)];
const LEGACY_LANGS = ['en', 'es', 'fr', 'ht', 'ar', 'zh', 'ko', 'sw', 'pt', 'hi', 'vi', 'ru', 'ja', 'de', 'id', 'ur', 'bn', 'it', 'tr', 'th'];
const CORE_LANGS = ['en', 'es', 'fr', 'ht', 'ar'];

function routePatterns(file, prefix) {
  const src = read(path.join(serverRoot, file));
  return [...src.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)].map(([, method, p]) => ({
    method,
    path: p,
    regex: new RegExp(`^${(prefix + p).replace(/:[A-Za-z]+/g, '[^/]+')}$`),
  }));
}
const normalizeClientPath = (p) => p.replace(/\$\{[^}]+\}/g, 'X').replace(/\?.*$/, '');
const resolveKey = (obj, key) => key.split('.').reduce((v, part) => (v == null ? undefined : v[part]), obj);

test('every customer API path used by the Credit panels exists on the server', () => {
  const routes = routePatterns('routes/paymentLayers.js', '/payment-layers');
  for (const rel of helperFiles) {
    const src = readClient(rel);
    for (const [, raw] of src.matchAll(/['`](\/payment-layers\/[^'`]+)['`]/g)) {
      const p = normalizeClientPath(raw);
      assert.ok(routes.some((r) => r.regex.test(p)), `${rel}: no server route for ${raw}`);
    }
  }
});

test('every admin licence API path used by the page exists on the server', () => {
  const routes = routePatterns('routes/creditLicenceAdmin.js', '');
  const shared = readClient(`${licenceDir}/licenceShared.jsx`);
  assert.match(shared, /'\/admin\/super\/credit-licence'/);
  for (const rel of adminFiles) {
    const src = readClient(rel);
    for (const [, raw] of src.matchAll(/(?:useLicenceGet|downloadLicenceFile)\(\s*['`](\/[^'`]+)['`]/g)) {
      const p = normalizeClientPath(raw);
      assert.ok(routes.some((r) => r.method === 'get' && r.regex.test(p)), `${rel}: no GET route for ${raw}`);
    }
  }
});

test('every two-admin action the UI requests has a registered oversight executor', () => {
  const registered = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        for (const [, type] of read(full).matchAll(/register\(\s*'(credit_[a-z_]+)'/g)) registered.add(type);
      }
    }
  };
  walk(path.join(serverRoot, 'services'));
  const requested = new Set();
  for (const rel of adminFiles) {
    for (const [, type] of readClient(rel).matchAll(/requestOversight\(\s*'(credit_[a-z_]+)'/g)) requested.add(type);
  }
  for (const [, type] of readClient(`${licenceDir}/oversightTemplates.js`).matchAll(/'(credit_[a-z_]+)'/g)) requested.add(type);
  assert.ok(requested.size >= 10, 'expected the UI to request the licence oversight actions');
  for (const type of requested) assert.ok(registered.has(type), `${type} has no server executor`);
  for (const type of ['credit_wind_down_start', 'credit_wind_down_cancel', 'credit_escheat_execute',
    'credit_cashout_release', 'credit_access_review_complete', 'credit_sar_approve']) {
    assert.ok(requested.has(type), `UI never requests ${type}`);
  }
});

test('oversight decisions go through step-up and a reason, never a direct mutation', () => {
  const src = readClient(`${licenceDir}/OversightSection.jsx`);
  assert.match(src, /\/admin\/super\/oxsteed-credit\/stepup-challenges/);
  assert.match(src, /pending_action_approve/);
  assert.match(src, /stepupChallengeId/);
  assert.match(src, /\/decision/);
  const shared = readClient(`${licenceDir}/licenceShared.jsx`);
  assert.match(shared, /Idempotency-Key/);
});

test('cash-out panel uses a verified destination, step-up and idempotency keys', () => {
  const src = readClient('src/components/paymentLayers/CreditCashoutPanel.jsx');
  assert.match(src, /destination_id/);
  assert.match(src, /\/payment-layers\/cashout\/stepup-challenges/);
  assert.match(src, /newIdempotencyKey\(\)/);
  assert.match(src, /\/cancel/);
  assert.match(src, /\/dispute/);
  const client = readClient('src/components/paymentLayers/creditLicenceClient.js');
  assert.match(client, /export function newIdempotencyKey/);
});

test('licence page is a super-only admin route reachable from the credit nav', () => {
  const manifest = readClient('src/admin/adminRouteManifest.js');
  assert.match(manifest, /oxsteedCreditLicence:\s*defineRoute\('\/admin\/super\/oxsteed-credit\/licence',\s*\{\s*superOnly:\s*true/);
  const app = readClient('src/admin/AdminApp.jsx');
  assert.match(app, /oxsteedCredit\/LicencePage/);
  assert.match(readClient('src/admin/pages/super/oxsteedCredit/shared.jsx'), /routeKey:\s*'oxsteedCreditLicence'/);
  assert.match(readClient('src/admin/layouts/AdminLayout.jsx'), /adminNav\.oxsteedCreditLicence/);
});

test('customer panels are mounted on the wallet and Credit pages', () => {
  const wallet = readClient('src/pages/food/WalletPage.jsx');
  for (const name of ['CreditWindDownBanner', 'CreditDisclosuresPanel', 'CreditCashoutPanel', 'CreditErasurePanel']) {
    assert.match(wallet, new RegExp(`<${name}\\b`), `WalletPage must render ${name}`);
  }
  const credit = readClient('src/pages/food/OxsteedCreditPage.jsx');
  assert.match(credit, /<CreditWindDownBanner\b/);
  assert.match(credit, /<CreditDisclosuresPanel\b/);
});

test('customer copy keys exist in all 20 legacy locale catalogs', () => {
  const keys = new Set();
  for (const rel of helperFiles) {
    for (const [, key] of readClient(rel).matchAll(/\bt\(\s*['"](paymentRail\.[A-Za-z0-9_.]+)['"]/g)) keys.add(key);
  }
  assert.ok(keys.size > 50, `expected many paymentRail keys, found ${keys.size}`);
  for (const lang of LEGACY_LANGS) {
    const catalog = readJson(path.join(clientRoot, `src/locales/${lang}.json`));
    for (const key of keys) {
      assert.equal(typeof resolveKey(catalog, key), 'string', `${lang}: missing ${key}`);
    }
    assert.equal(typeof resolveKey(catalog, 'adminNav.oxsteedCreditLicence'), 'string', `${lang}: missing nav label`);
  }
});

test('admin copy keys exist in the credit namespace for en/es/fr/ht/ar with matching placeholders', () => {
  const keys = new Set();
  for (const rel of adminFiles) {
    for (const [, key] of readClient(rel).matchAll(/\bt\(\s*['"](adminLicence\.[A-Za-z0-9_.]+)['"]/g)) keys.add(key);
  }
  assert.ok(keys.size > 50);
  const placeholders = (s) => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort().join(',');
  const en = readJson(path.join(clientRoot, 'src/i18n/locales/en/credit.json'));
  for (const lang of CORE_LANGS) {
    const catalog = readJson(path.join(clientRoot, `src/i18n/locales/${lang}/credit.json`));
    for (const key of keys) {
      const value = resolveKey(catalog, key);
      assert.equal(typeof value, 'string', `${lang}: missing ${key}`);
      assert.equal(placeholders(value), placeholders(resolveKey(en, key)), `${lang}: placeholder mismatch in ${key}`);
    }
  }
});

test('licence panel styles are RTL-safe (logical properties only)', () => {
  const css = readClient('src/components/paymentLayers/CreditLicencePanels.css');
  assert.doesNotMatch(css, /\b(margin|padding|border)-(left|right)\b|\b(left|right)\s*:|text-align:\s*(left|right)/);
  for (const rel of [...helperFiles, ...adminFiles]) {
    assert.doesNotMatch(readClient(rel), /\b(?:ml|mr|pl|pr|left|right)-\d/, `${rel} uses physical Tailwind spacing`);
  }
});

test('gap fill 1: wind-down holders can manage payout accounts while cash-out is off', () => {
  const wallet = readClient('src/pages/food/WalletPage.jsx');
  assert.match(wallet, /<CreditWindDownDestinations\b/);
  const section = readClient('src/components/paymentLayers/CreditWindDownDestinations.jsx');
  assert.match(section, /\/payment-layers\/credit\/wind-down\/mine/);
  assert.match(section, /<CreditPayoutDestinations\b/);
  assert.match(section, /CREDIT_CASHOUT/);
  assert.match(section, /destinations_allowed/);
  const banner = readClient('src/components/paymentLayers/CreditWindDownBanner.jsx');
  assert.match(banner, /\/wallet#\$\{PAYOUT_DESTINATIONS_ANCHOR\}/);
  assert.match(banner, /\/payment-layers\/credit\/wind-down\/mine/);
  const server = read(path.join(serverRoot, 'controllers/paymentLayersController.js'));
  for (const fn of ['listPayoutDestinations', 'addPayoutDestination', 'verifyPayoutDestination', 'removePayoutDestination']) {
    const body = server.split(`exports.${fn} =`)[1].split('exports.')[0];
    assert.match(body, /await requireDestinationAccess\(req\)/, `${fn} must allow wind-down holders`);
    assert.doesNotMatch(body, /requireFlag\('CREDIT_CASHOUT'\)/, `${fn} must not be hidden behind cash-out alone`);
  }
});

test('gap fill 2: the wage consent panel stands on its own, outside the cash-out panel', () => {
  const wallet = readClient('src/pages/food/WalletPage.jsx');
  assert.match(wallet, /<CreditWageConsentPanel\s+standalone\b/);
  const cashout = readClient('src/components/paymentLayers/CreditCashoutPanel.jsx');
  assert.doesNotMatch(cashout, /CreditWageConsentPanel/);
  const panel = readClient('src/components/paymentLayers/CreditWageConsentPanel.jsx');
  assert.match(panel, /state\.relevant === false/);
  assert.match(panel, /paymentRail\.wage\.requiredNote/);
  const service = read(path.join(serverRoot, 'services/creditCompliance/wageConsentService.js'));
  assert.match(service, /relevant,/);
});
