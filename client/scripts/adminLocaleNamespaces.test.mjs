import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const languages = ['en', 'es', 'fr', 'ht', 'ar'];
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const catalogs = Object.fromEntries(languages.map((language) => [
  language, JSON.parse(read(`src/locales/${language}.json`)),
]));
const get = (object, key) => key.split('.').reduce((value, part) => value?.[part], object);
const leaves = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => {
  const dotted = prefix ? `${prefix}.${key}` : key;
  return typeof value === 'string' ? [dotted] : leaves(value, dotted);
});

// Use the actual build splitter and bootstrap module, with real i18next.
// Node needs a JSON module hook because Vite's imports omit import attributes.
execFileSync(process.execPath, [path.join(root, 'scripts/splitLocaleCatalogs.mjs')]);
let scenario = 0;
async function bootstrap(language, unavailable = () => false) {
  scenario += 1;
  const currentScenario = scenario;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => language },
  });
  const imports = [];
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      if (resolved.url.startsWith(pathToFileURL(path.join(root, 'src')).href)
        && resolved.url.endsWith('.json')) {
        return { ...resolved, url: `${resolved.url}?locale-test=${currentScenario}` };
      }
      return resolved;
    },
    load(url, context, nextLoad) {
      if (url.endsWith(`.json?locale-test=${currentScenario}`)) {
        const relativePath = path.relative(root, fileURLToPath(url)).replaceAll('\\', '/');
        imports.push(relativePath);
        if (unavailable(relativePath)) throw new Error(`Unavailable test asset: ${relativePath}`);
        return {
          format: 'module',
          source: `export default ${fs.readFileSync(fileURLToPath(url), 'utf8')}`,
          shortCircuit: true,
        };
      }
      return nextLoad(url, context);
    },
  });
  const cleanup = () => {
    hook.deregister();
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete globalThis.localStorage;
  };
  let module;
  try {
    module = await import(`${pathToFileURL(path.join(root, 'src/i18n/index.js')).href}?locale-test=${currentScenario}`);
  } catch (error) {
    cleanup();
    throw error;
  }
  return {
    ...module,
    imports,
    cleanup,
  };
}

function assertAdminTranslations(i18n, language) {
  for (const namespace of ['support', 'adminQuoteRequests']) {
    assert.ok(i18n.hasResourceBundle(language, namespace), `${language}: ${namespace} bundle`);
    assert.deepEqual(i18n.getResourceBundle(language, namespace), catalogs[language][namespace]);
    const keys = namespace === 'support'
      ? leaves(catalogs[language].support.workspace, 'workspace')
      : leaves(catalogs[language].adminQuoteRequests);
    const namespaceT = i18n.getFixedT(language, namespace);
    for (const key of keys) {
      const options = {
        lng: language, fallbackLng: false, count: 3, name: 'Avery', email: 'avery@example.test',
        channel: 'SMS', provider: 'Example', page: 2, total: 7, id: 42, date: '2026-09-30',
      };
      const expected = get(catalogs[language][namespace], key)
        .replace(/{{\s*([^}]+?)\s*}}/g, (_, name) => String(options[name]));
      assert.equal(i18n.t(`${namespace}.${key}`, options), expected, `${language}: dotted ${namespace}.${key}`);
      assert.equal(i18n.t(`${namespace}:${key}`, options), expected, `${language}: explicit ${namespace}:${key}`);
      assert.equal(namespaceT(key, options), expected, `${language}: fixed namespace ${namespace}:${key}`);
    }
  }
}

test('catalogs cover every workspace label, dynamic status, priority, and quote menu option', () => {
  const workspaceSource = read('src/components/support/SupportConversationWorkspace.jsx');
  const quoteSource = read('src/admin/pages/QuoteRequestsInbox.jsx');
  const workspaceKeys = [...workspaceSource.matchAll(/copy\(['"]([^'"]+)['"]/g)].map(([, key]) => key);
  const quoteKeys = [...quoteSource.matchAll(/\bt\(['"](adminQuoteRequests\.[^'"]+)['"]/g)]
    .map(([, key]) => key.replace('adminQuoteRequests.', ''));
  const quoteSuffixes = [...quoteSource.matchAll(/^  [a-z_]+: '([A-Z][a-z]+)',?$/gm)]
    .map(([, suffix]) => `status${suffix}`);
  assert.equal(quoteSuffixes.length, 6);
  const statuses = ['open', 'pending', 'reopened', 'in_progress', 'waiting_for_customer',
    'waiting_for_agent', 'escalated', 'resolved', 'closed', 'merged'];
  const requiredWorkspace = [...workspaceKeys, ...statuses.map((status) => `status.${status}`),
    ...['urgent', 'high', 'normal', 'low'].map((priority) => `priority.${priority}`)];
  for (const language of languages) {
    const workspace = catalogs[language].support.workspace;
    assert.deepEqual(leaves(workspace).sort(), leaves(catalogs.en.support.workspace).sort());
    for (const key of requiredWorkspace) {
      assert.equal(typeof get(workspace, key), 'string', `${language}: support.workspace.${key}`);
      assert.ok(get(workspace, key).trim(), `${language}: empty support.workspace.${key}`);
    }
    for (const key of [...quoteKeys, ...quoteSuffixes]) {
      const label = catalogs[language].adminQuoteRequests[key];
      assert.equal(typeof label, 'string', `${language}: adminQuoteRequests.${key}`);
      assert.ok(label.trim(), `${language}: empty adminQuoteRequests.${key}`);
    }
    for (const key of ['title', 'claimBeforeReply', 'replyPlaceholder']) {
      if (language !== 'en') assert.notEqual(workspace[key], catalogs.en.support.workspace[key]);
    }
    for (const key of quoteSuffixes) {
      if (language !== 'en') assert.notEqual(catalogs[language].adminQuoteRequests[key], catalogs.en.adminQuoteRequests[key]);
    }
  }
});

for (const language of languages) {
  test(`${language}: first bootstrap renders both admin namespaces without English fallback or raw keys`, async () => {
    const app = await bootstrap(language);
    try {
      await app.i18nReady;
      assert.equal(app.default.language, language);
      assertAdminTranslations(app.default, language);
      assertAdminTranslations(app.default, 'en');
      assert.equal(app.default.t('support.workspace.assignedTo', { name: 'Avery' }),
        catalogs[language].support.workspace.assignedTo.replace('{{name}}', 'Avery'));
      assert.ok(!app.imports.some((asset) => /terms|privacy/.test(asset)), 'legal content stays lazy');
      const loadedLanguages = new Set(app.imports.map((asset) => asset.match(/(?:generated\/|locales\/)(en|es|fr|ht|ar)(?:[-/])/)[1]));
      assert.deepEqual([...loadedLanguages].sort(), [...new Set(['en', language])].sort());
    } finally { app.cleanup(); }
  });
}

test('language switching loads complete namespaces and repairs a missing bundle', async () => {
  const app = await bootstrap('en');
  try {
    await app.i18nReady;
    for (const language of ['es', 'fr', 'ht', 'ar', 'en']) {
      await app.ensureLanguageLoaded(language);
      await app.default.changeLanguage(language);
      assertAdminTranslations(app.default, language);
    }
    app.default.removeResourceBundle('es', 'support');
    assert.ok(app.default.hasResourceBundle('es', 'translation'));
    await app.ensureLanguageLoaded('es-MX');
    assertAdminTranslations(app.default, 'es');
    const before = app.imports.length;
    await app.ensureLanguageLoaded('es');
    assert.equal(app.imports.length, before, 'loaded language resources are cached');
  } finally { app.cleanup(); }
});

test('optional assets fail soft without dropping required admin translations', async () => {
  const app = await bootstrap('fr', (asset) => asset.startsWith('src/i18n/locales/fr/'));
  try {
    await app.i18nReady;
    assertAdminTranslations(app.default, 'fr');
    assertAdminTranslations(app.default, 'en');
    assert.equal(app.default.t('actions.cancel', { ns: 'common' }), 'Cancel');
  } finally { app.cleanup(); }
});

test('required locale asset failure rejects bootstrap; English recovery includes every namespace', async () => {
  const app = await bootstrap('es', (asset) => asset === 'src/locales/generated/es-0.json');
  try {
    await assert.rejects(app.i18nReady, /Unavailable test asset/);
    await app.initializeEnglishFallback();
    assert.equal(app.default.language, 'en');
    assertAdminTranslations(app.default, 'en');
    assert.equal(app.default.t('actions.cancel', { ns: 'common' }), 'Cancel');
    assert.ok(app.default.hasResourceBundle('en', 'credit'));
    assert.ok(app.default.hasResourceBundle('en', 'translator'));
  } finally { app.cleanup(); }
});

test('English recovery retains admin catalogs when optional English assets fail', async () => {
  const app = await bootstrap('ar', (asset) => asset === 'src/locales/generated/ar-0.json'
    || asset.startsWith('src/i18n/locales/en/'));
  try {
    await assert.rejects(app.i18nReady, /Unavailable test asset/);
    await app.initializeEnglishFallback();
    assertAdminTranslations(app.default, 'en');
  } finally { app.cleanup(); }
});

test('English recovery rejects when all legacy shards are unavailable', async () => {
  const app = await bootstrap('en', (asset) => asset.startsWith('src/locales/generated/en-'));
  try {
    await assert.rejects(app.i18nReady, /Unavailable test asset/);
    await assert.rejects(app.initializeEnglishFallback(), /English fallback resources unavailable/);
  } finally { app.cleanup(); }
});

for (const namespace of ['support', 'adminQuoteRequests']) {
  test(`English recovery rejects a partial catalog missing ${namespace}`, async () => {
    const shard = [0, 1, 2].find((index) => JSON.parse(read(`src/locales/generated/en-${index}.json`))[namespace]);
    assert.notEqual(shard, undefined);
    const app = await bootstrap('en', (asset) => asset === `src/locales/generated/en-${shard}.json`);
    try {
      await assert.rejects(app.i18nReady, /Unavailable test asset/);
      await assert.rejects(app.initializeEnglishFallback(), /English fallback resources unavailable/);
    } finally { app.cleanup(); }
  });
}
