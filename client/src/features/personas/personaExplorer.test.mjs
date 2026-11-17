import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PERSONA_CATALOG, PERSONA_CLASSIFICATIONS, searchPersonas } from './personaCatalog.js';
import { PERSONA_COPY } from './personaExplorerCopy.js';
import { PERSONA_LANGUAGES, personaLanguage, personaResources, installPersonaResources, personaLocalKey } from './personaExplorerResources.js';
const get = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
const leafKeys = (value, prefix = '') => Object.entries(value).flatMap(([key, child]) => typeof child === 'object' ? leafKeys(child, `${prefix}${key}.`) : [`${prefix}${key}`]).sort();

test('five required languages share all leaf keys and complete catalog coverage', () => {
  assert.deepEqual(PERSONA_LANGUAGES, ['en', 'es', 'fr', 'ht', 'ar']);
  const expected = leafKeys(personaResources('en'));
  for (const language of PERSONA_LANGUAGES) {
    const resources = personaResources(language);
    assert.deepEqual(leafKeys(resources), expected);
    assert.equal(Object.keys(resources.entries).length, PERSONA_CATALOG.length);
    assert.equal(PERSONA_COPY[language].rows.length, PERSONA_CATALOG.length);
    for (const key of expected) assert.ok(get(resources, key).trim());
    for (const entry of PERSONA_CATALOG) {
      assert.ok(get(resources, personaLocalKey(entry.labelKey)));
      assert.ok(get(resources, personaLocalKey(entry.purposeKey)));
    }
    for (const value of PERSONA_CLASSIFICATIONS) assert.ok(resources.classifications[value]);
  }
});
test('regional and unsupported language codes resolve deterministically', () => {
  for (const [input, output] of [['fr-CA','fr'], [' AR_eg ','ar'], ['es-MX','es'], ['de','en'], [null,'en'], ['__proto__','en']]) assert.equal(personaLanguage(input), output);
});
test('result placeholders have parity across all languages', () => {
  for (const language of PERSONA_LANGUAGES) {
    assert.deepEqual(personaResources(language).count.match(/\{\{\w+\}\}/g).sort(), ['{{matched}}', '{{total}}']);
  }
});
test('legacy and explicit namespace values are equal and independently cloned', () => {
  const values = new Map();
  const i18n = { addResourceBundle(language, namespace, value, deep, overwrite) {
    assert.equal(deep, true); assert.equal(overwrite, false);
    values.set(`${language}:${namespace}`, value);
  } };
  installPersonaResources(i18n);
  for (const language of PERSONA_LANGUAGES) {
    const legacy = values.get(`${language}:translation`).personaExplorer;
    const namespace = values.get(`${language}:personaExplorer`);
    assert.deepEqual(legacy, namespace);
    assert.notEqual(legacy, namespace);
    legacy.entries.customer.label = 'mutated';
    assert.notEqual(namespace.entries.customer.label, 'mutated');
    assert.notEqual(personaResources(language).entries.customer.label, 'mutated');
  }
});
test('installation can be repeated without changing canonical resources', () => {
  const before = JSON.stringify(PERSONA_COPY);
  const calls = [];
  const i18n = { addResourceBundle: (...args) => calls.push(args) };
  installPersonaResources(i18n); installPersonaResources(i18n);
  assert.equal(calls.length, 20);
  assert.equal(JSON.stringify(PERSONA_COPY), before);
});
test('every translated persona label can find its own entry', () => {
  for (const language of PERSONA_LANGUAGES) {
    const resources = personaResources(language);
    const translate = key => get(resources, personaLocalKey(key));
    for (const entry of PERSONA_CATALOG) {
      const query = translate(entry.labelKey);
      assert.ok(searchPersonas({ query, translate }).some(result => result.id === entry.id));
    }
  }
});
test('translated labels combine correctly with family and evidence filters', () => {
  const resources = personaResources('fr');
  const translate = key => get(resources, personaLocalKey(key));
  assert.deepEqual(searchPersonas({ query: 'prestataire', family: 'helper', classification: 'code-backed', translate }).map(entry => entry.id), ['helper']);
  assert.equal(searchPersonas({ query: 'prestataire', family: 'helper', classification: 'planned', translate }).length, 0);
});
test('component source contract has native labels, unique IDs and announcements', () => {
  const source = readFileSync(new URL('./PersonaExplorer.jsx', import.meta.url), 'utf8');
  assert.match(source, /useId\(/);
  assert.equal((source.match(/<label htmlFor=/g) || []).length, 3);
  assert.match(source, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(source, /searchRef\.current\?\.focus\(/);
  assert.match(source, /dir=\{language === 'ar' \? 'rtl' : 'ltr'\}/);
  assert.doesNotMatch(source, /<a\b|<Link\b|localStorage|useAuth|fetch\(|api\./);
});
test('host source contract limits mounting to the guide hub within main', () => {
  const source = readFileSync(new URL('../../components/PageShell.jsx', import.meta.url), 'utf8');
  assert.match(source, /pathname\.replace\(\/\\\/\+\$\/, ''\) === '\/how-it-works'/);
  const main = source.slice(source.indexOf('<main '), source.indexOf('</main>'));
  assert.match(main, /showPersonaExplorer && <PersonaExplorer \/>/);
});
