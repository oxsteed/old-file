import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/food/OxsteedCreditPage.jsx', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../../server/services/oxsteedCreditService.js', import.meta.url), 'utf8');
const locales = ['en', 'es', 'fr', 'ht', 'ar'].map((lang) => ({
  lang,
  credit: JSON.parse(fs.readFileSync(new URL(`../src/i18n/locales/${lang}/credit.json`, import.meta.url), 'utf8')),
}));

// G13-A5 (D-761): the dispute history shows the resolution text but never
// the resolution date, so a customer cannot match the resolution to the
// credit on their statement. formatDispute already carries resolvedAt;
// the list just never rendered it.
test('the dispute history renders resolvedAt beside the resolution text', () => {
  assert.match(service, /resolvedAt: row\.resolved_at \|\| null/);
  assert.equal(page.includes('dispute.resolvedAt'), true);
  assert.match(page, /t\('resolvedAt', \{ date: dateTime\(dispute\.resolvedAt, t\) \}\)/);
});

test('the resolvedAt key exists in all five locales', () => {
  for (const { lang, credit } of locales) {
    assert.equal(typeof credit.resolvedAt, 'string', lang);
    assert.match(credit.resolvedAt, /\{\{date\}\}/, lang);
  }
});
