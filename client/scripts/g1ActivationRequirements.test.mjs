import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// G-1: an approved-but-incomplete helper must see the missing payout_setup
// step on Settings -> Applications instead of hitting a bare 403. The page
// renders every code in activation[capability].missing through
// progressiveAccess.activationRequirements.<code>, so the label must exist
// in all five locales. No new string was needed: the key already exists;
// this test pins it so a locale edit cannot silently drop the step.

const root = path.resolve(import.meta.dirname, '..');
const languages = ['en', 'es', 'fr', 'ht', 'ar'];

test('payout_setup has a label in every locale', () => {
  for (const language of languages) {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(root, 'src/i18n/locales', language, 'common.json'), 'utf8'),
    );
    const label = catalog?.progressiveAccess?.activationRequirements?.payout_setup;
    assert.equal(typeof label, 'string', `${language}: payout_setup label missing`);
    assert.ok(label.trim().length > 0, `${language}: payout_setup label empty`);
  }
});

test('ApplicationsPage renders missing requirements generically', () => {
  const page = fs.readFileSync(
    path.join(root, 'src/pages/Settings/ApplicationsPage.jsx'),
    'utf8',
  );
  assert.match(
    page,
    /activation\[c\]\.missing.*\n.*t\(`progressiveAccess\.activationRequirements\.\$\{req\}`/s,
    'ApplicationsPage must map each missing code through activationRequirements',
  );
});
