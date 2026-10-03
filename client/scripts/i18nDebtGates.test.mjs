// Regression tests for audit V2-P1-03 (localization debt).
//
// Guards: (a) the 324 missing static keys / 46 raw-key renders / 278
// fallbacks are resolved in the catalogs, (b) the 703 still-English values
// are translated, (c) the CI gates in verify-i18n.mjs are hard failures so
// new missing keys or untranslated copy break the build.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(read(relativePath));

// Mirrors the flat-first dotted lookup used by verify-i18n.mjs.
function resolveCatalogKey(catalog, dottedKey) {
  let node = catalog;
  let rest = dottedKey;
  while (node !== null && typeof node === 'object') {
    if (Object.prototype.hasOwnProperty.call(node, rest)) return node[rest];
    const dot = rest.indexOf('.');
    if (dot === -1) return undefined;
    const head = rest.slice(0, dot);
    if (!Object.prototype.hasOwnProperty.call(node, head)) return undefined;
    node = node[head];
    rest = rest.slice(dot + 1);
  }
  return undefined;
}

const LANGUAGES = ['en', 'es', 'fr', 'ht', 'ar'];
const legacy = (language) => readJson(`src/locales/${language}.json`);
const commonNs = (language) => readJson(`src/i18n/locales/${language}/common.json`);

// Previously-rendered-raw keys (no defaultValue fallback at the call site):
// before V2-P1-03 these rendered the raw dotted key in production.
const PREVIOUSLY_RAW_KEYS = [
  'common.aria.breadcrumb',
  'common.name',
  'common.price',
  'common.status',
  'common.dismiss',
  'common.failedSave',
  'businessHub.reviews.title',
  'businessHub.reviews.toastLoadFail',
  'businessHub.reviews.filters.needsReply',
  'businessHub.reviews.empty',
  'businessHub.reviews.count',
  'businessHub.businessRecurringBilling.requiredFields',
  'businessHub.businessRecurringBilling.description',
  'food.pos.maxSelect',
  'food.pos.notePlaceholder',
  'food.pos.orderError',
  'food.pos.sentToKitchen',
  'food.pos.soldOut',
  'logistics.complianceWorkspace.tableHeaders.category',
  'footer.callOxSteed',
];

// Previously defaultValue-fallback keys: the fallback masked the missing key.
const PREVIOUSLY_FALLBACK_KEYS = [
  'adminReports.pageOf',
  'messages.blockConfirm',
  'activity.bidDetails',
  'support.caseNumber',
  'logistics.campaigns.joinSuccess',
  'food.merchant.externalPaymentHint',
  'common.confirmDeleteProduct',
  'common.confirmDeleteRule',
];

test('previously raw-rendered keys resolve to real copy in all five locales', () => {
  for (const key of PREVIOUSLY_RAW_KEYS) {
    for (const language of LANGUAGES) {
      const value = resolveCatalogKey(legacy(language), key);
      assert.equal(typeof value, 'string', `${language} ${key} should resolve to a string`);
      assert.ok(value.trim().length > 0, `${language} ${key} should not be empty`);
      assert.notEqual(value, key, `${language} ${key} should not render the raw key`);
    }
  }
  const clearValue = resolveCatalogKey(commonNs('en'), 'actions.clear');
  assert.equal(clearValue, 'Clear');
});

test('previously defaultValue-fallback keys resolve in the catalog', () => {
  const en = legacy('en');
  for (const key of PREVIOUSLY_FALLBACK_KEYS) {
    const value = resolveCatalogKey(en, key);
    assert.equal(typeof value, 'string', `en ${key} should resolve to a string`);
    assert.ok(value.trim().length > 0, `en ${key} should not be empty`);
  }
  // The disambiguated confirm keys carry the call sites' original copy.
  assert.equal(resolveCatalogKey(en, 'common.confirmDeleteProduct'), 'Delete this product?');
  assert.equal(resolveCatalogKey(en, 'common.confirmDeleteRule'), 'Delete this rule?');
});

test('previously still-English long strings are translated in every locale', () => {
  const samples = [
    'booking.tryAnotherDate',
    'businessHub.beautyOps.intakePipelineSubtitle',
    'qrGenerator.operations.subtitle',
    'homePage.consulting.subcopy',
    'accessGateRecovery.errors.failed',
    'accountTermination.dataDeletionNote',
  ];
  const en = legacy('en');
  for (const key of samples) {
    const englishValue = resolveCatalogKey(en, key);
    assert.ok(englishValue && englishValue.length >= 25, `en ${key} should be a long string`);
    for (const language of LANGUAGES.filter((entry) => entry !== 'en')) {
      const translated = resolveCatalogKey(legacy(language), key);
      assert.equal(typeof translated, 'string', `${language} ${key} should resolve`);
      assert.notEqual(translated, englishValue, `${language} ${key} should be translated, not English`);
    }
  }
});

test('new keys keep interpolation placeholders in every locale', () => {
  const placeholders = (value) =>
    [...String(value).matchAll(/{{\s*([A-Za-z0-9_.-]+)\s*}}/g)].map((match) => match[1]).sort().join('|');
  const samples = [
    'adminReports.pageOf',
    'businessHub.reviews.count',
    'food.pos.maxSelect',
    'footer.callOxSteed',
    'logistics.campaigns.joinSuccess',
    'booking.autoPostSummary',
  ];
  const en = legacy('en');
  for (const key of samples) {
    const expected = placeholders(resolveCatalogKey(en, key));
    for (const language of LANGUAGES.filter((entry) => entry !== 'en')) {
      const actual = placeholders(resolveCatalogKey(legacy(language), key));
      assert.equal(actual, expected, `${language} ${key} placeholder parity`);
    }
  }
});

test('verify-i18n.mjs fails the build on missing static keys (V2-P1-03 gate)', () => {
  const source = read('scripts/verify-i18n.mjs');
  assert.match(source, /Static t\(\) key references missing from the catalog/);
  assert.doesNotMatch(source, /not failing the build/);
  assert.doesNotMatch(source, /Reported as warnings, not failures/);
});

test('verify-i18n.mjs fails the build on still-English values (V2-P1-03 gate)', () => {
  const source = read('scripts/verify-i18n.mjs');
  assert.match(source, /untranslated copy breaks the build/);
  assert.match(source, /STILL_ENGLISH_ALLOWLIST/);
  // The allowlist stays minimal and documented; it must not become a parking
  // lot for untranslated copy.
  const allowlistBody = source.slice(source.indexOf('STILL_ENGLISH_ALLOWLIST = new Set(['));
  const entries = [...allowlistBody.matchAll(/^\s*'([^']+)',?\s*$/gm)].map((match) => match[1]);
  assert.ok(entries.length > 0 && entries.length <= 12, `allowlist has ${entries.length} entries, expected 1-12`);
});

test('call sites use catalog keys with proper interpolation', () => {
  const footer = read('src/components/Footer.jsx');
  assert.match(footer, /t\('footer\.callOxSteed', \{ defaultValue: 'Call OxSteed at \{\{phone\}\}', phone: OXSTEED_MAIN_PHONE \}\)/);
  assert.doesNotMatch(footer, /\$\{OXSTEED_MAIN_PHONE\}/);
  const productManagement = read('src/components/businessHub/ProductManagement.jsx');
  assert.match(productManagement, /t\('common\.confirmDeleteProduct'/);
  const pricingManager = read('src/components/businessHub/ProductPricingManager.jsx');
  assert.match(pricingManager, /t\('common\.confirmDeleteRule'/);
  for (const source of [productManagement, pricingManager]) {
    assert.doesNotMatch(source, /t\('common\.confirmDelete',/);
  }
});
