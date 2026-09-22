import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve('.');
const surfaces = [
  'src/pages/food/OxsteedCreditCardsPage.jsx',
  'src/admin/pages/super/OxsteedCreditCards.jsx',
];

function flatten(value, prefix = '') {
  return Object.entries(value).flatMap(([key, child]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === 'object' ? flatten(child, next) : [next];
  });
}

test('customer and admin card surfaces use the shared Credit namespace', () => {
  for (const relativePath of surfaces) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.match(source, /useTranslation\('credit'\)/, `${relativePath} is not localized`);
    assert.doesNotMatch(source, /not yet part of the credit\s+i18n contract/, `${relativePath} retains a deferred localization marker`);
  }
});

test('all supported locales contain the complete card translation surface', () => {
  const locales = ['en', 'es', 'fr', 'ht', 'ar'];
  const localeKeys = locales.map((locale) => {
    const file = path.join(root, 'src/i18n/locales', locale, 'credit.json');
    return { locale, keys: new Set(flatten(JSON.parse(fs.readFileSync(file, 'utf8')))) };
  });
  const expected = localeKeys[0].keys;
  const cardKeys = [...expected].filter((key) => key.startsWith('cards.'));
  assert.ok(cardKeys.length >= 100, `expected a complete card surface, found ${cardKeys.length} keys`);
  for (const { locale, keys } of localeKeys.slice(1)) {
    assert.deepEqual([...keys].sort(), [...expected].sort(), `${locale} credit keys drifted from en`);
  }
});

