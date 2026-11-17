import test from 'node:test';
import assert from 'node:assert/strict';
import { PERSONA_CATALOG as catalog, PERSONA_FAMILIES as families, PERSONA_CLASSIFICATIONS as classifications, INVESTOR_PRODUCT_INTENT, getPersona, searchPersonas } from './personaCatalog.js';

test('18 initial families have unique IDs and references', () => {
  assert.equal(families.length, 18);
  assert.equal(new Set(catalog.map(x => x.id)).size, catalog.length);
  assert.deepEqual(new Set(catalog.map(x => x.family)), new Set(families));
});
test('entries have descriptive scope, evidence and translation keys', () => {
  for (const entry of catalog) {
    assert.match(entry.id, /^[a-z][a-z0-9-]*$/);
    assert.equal(entry.actorKind, 'human');
    assert.ok(classifications.includes(entry.classification));
    assert.ok(entry.scope);
    assert.ok(entry.evidence.length);
    for (const path of entry.evidence) assert.match(path, /^server\/[a-zA-Z0-9_./-]+$/);
    assert.match(entry.labelKey, /^personaExplorer\.entries\.\w+\.label$/);
    assert.match(entry.purposeKey, /^personaExplorer\.entries\.\w+\.purpose$/);
  }
});
test('catalog and nested evidence are immutable', () => {
  assert.throws(() => catalog.push({}), TypeError);
  assert.throws(() => catalog[0].evidence.push('forged'), TypeError);
  assert.throws(() => { catalog[0].classification = 'approved'; }, TypeError);
});
test('unknown and inherited-property lookups fail closed', () => {
  for (const id of ['unknown', '__proto__', 'constructor', '', null, {}, 7]) assert.equal(getPersona(id), null);
  assert.equal(getPersona('helper').id, 'helper');
});
test('search returns a separate array without mutating catalog', () => {
  const results = searchPersonas();
  assert.notEqual(results, catalog);
  results.pop();
  assert.equal(searchPersonas().length, catalog.length);
});
test('localized search ignores case and diacritics and requires all tokens', () => {
  const translate = key => key === getPersona('helper').labelKey ? 'Prestataire indépendant' : '';
  assert.deepEqual(searchPersonas({ query: 'PRESTATAIRE independant', translate }).map(x => x.id), ['helper']);
  assert.equal(searchPersonas({ query: 'prestataire restaurant', translate }).length, 0);
});
test('family and classification filters intersect', () => {
  assert.deepEqual(searchPersonas({ family: 'helper', classification: 'code-backed' }).map(x => x.id), ['helper']);
  assert.equal(searchPersonas({ family: 'helper', classification: 'planned' }).length, 0);
  assert.equal(searchPersonas({ family: 'unknown' }).length, 0);
  assert.equal(searchPersonas({ classification: 'approved' }).length, 0);
});
test('metadata schema has no authority or current-user approval fields', () => {
  const fields = ['id', 'family', 'actorKind', 'classification', 'scope', 'labelKey', 'purposeKey', 'evidence'].sort();
  for (const entry of catalog) assert.deepEqual(Object.keys(entry).sort(), fields);
});
test('investors target entities with Credit only, never OxSteed itself', () => {
  assert.deepEqual(INVESTOR_PRODUCT_INTENT, { target: 'eligible-entities-on-oxsteed', contributionMethod: 'oxsteed-credit-only', investsInOxsteed: false });
  assert.equal(getPersona('platform-investor'), null);
  assert.equal(getPersona('entity-investor').classification, 'needs-verification');
});
test('states, tiers and nonhuman actors are not primary persona families', () => {
  for (const id of ['approved', 'pending', 'suspended', 'pro', 'credit-kiosk', 'ai-agent']) assert.equal(getPersona(id), null);
});
