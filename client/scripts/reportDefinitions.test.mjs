import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { REPORT_DEFINITIONS } from '../src/lib/reportDefinitions.js';

// Slice 5e, item 723 (D-749): report definitions. Every definition names a
// report surface that already exists: its route must be a registered App.jsx
// route, and its copy must exist in the credit namespace in all five locales.

const appJsx = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');

function catalog(language) {
  return readFile(
    new URL(`../src/i18n/locales/${language}/credit.json`, import.meta.url), 'utf8',
  ).then((text) => JSON.parse(text));
}

test('definitions are unique, shaped, and cover ten reports', () => {
  const ids = REPORT_DEFINITIONS.map((definition) => definition.id);
  assert.equal(new Set(ids).size, ids.length, 'definition ids must be unique');
  assert.equal(REPORT_DEFINITIONS.length, 10);
  for (const definition of REPORT_DEFINITIONS) {
    for (const field of ['id', 'route', 'titleKey', 'containsKey', 'sourceKey', 'columnsKey']) {
      assert.equal(typeof definition[field], 'string', `${definition.id} ${field} must be a string`);
      assert.notEqual(definition[field], '', `${definition.id} ${field} must not be empty`);
    }
    assert.match(definition.route, /^\//, `${definition.id} route must be absolute`);
    for (const field of ['titleKey', 'containsKey', 'sourceKey', 'columnsKey']) {
      assert.equal(
        definition[field],
        `statements.definitions.${definition.id}.${field.replace('Key', '')}`,
        `${definition.id} ${field} must follow the definitions key layout`,
      );
    }
  }
});

test('every definition route is a registered App.jsx route', () => {
  for (const definition of REPORT_DEFINITIONS) {
    // Parameterized routes match their literal pattern (e.g. :restaurantId).
    assert.ok(
      appJsx.includes(`path="${definition.route}"`),
      `${definition.id} route ${definition.route} must be registered in App.jsx`,
    );
  }
});

test('every definition key exists in all five credit catalogs', async () => {
  const catalogs = {};
  for (const language of ['en', 'es', 'fr', 'ht', 'ar']) {
    catalogs[language] = await catalog(language);
  }
  for (const language of ['en', 'es', 'fr', 'ht', 'ar']) {
    const definitions = catalogs[language].statements.definitions;
    assert.equal(typeof definitions, 'object', `${language} must have statements.definitions`);
    for (const label of ['containsLabel', 'sourceLabel', 'columnsLabel']) {
      assert.equal(typeof definitions[label], 'string', `${language} definitions.${label} must be a string`);
    }
    for (const definition of REPORT_DEFINITIONS) {
      const entry = definitions[definition.id];
      assert.equal(typeof entry, 'object', `${language} definitions.${definition.id} must exist`);
      for (const field of ['title', 'contains', 'source', 'columns']) {
        assert.equal(typeof entry[field], 'string', `${language} ${definition.id}.${field} must be a string`);
        assert.notEqual(entry[field], '', `${language} ${definition.id}.${field} must not be empty`);
      }
    }
    assert.equal(typeof catalogs[language].statements.center.definitionsHeading, 'string');
    assert.equal(typeof catalogs[language].statements.center.definitionsDescription, 'string');
  }
});

test('the center page renders the definitions section from the module', async () => {
  const center = await readFile(
    new URL('../src/pages/food/StatementCenterPage.jsx', import.meta.url), 'utf8');
  assert.match(center, /REPORT_DEFINITIONS\.map/);
  assert.match(center, /statement-center-definitions/);
  assert.match(center, /definitionsHeading/);
  // A parameterized route renders its title without a link; a plain route links.
  assert.match(center, /definition\.route\.includes\(':'\)/);
});
