import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve('src/admin/pages/DisputeResolve.jsx'),
  'utf8',
);

test('admin dispute resolution uses localized and locale-aware copy', () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /adminDisputeResolve\.confirmMessage/);
  assert.match(source, /adminDate\(/);
});

test('admin dispute resolution catalog is complete in every supported locale', () => {
  const required = [
    'title', 'loading', 'amountAtStake', 'evidence', 'noEvidence',
    'selectResolution', 'fullRefund', 'partialRefund', 'releaseToHelper',
    'dismiss', 'refundAmount', 'notes', 'processing', 'confirmTitle',
    'confirmMessage', 'resolve', 'resolutionRequired', 'notesRequired',
  ];
  for (const locale of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(fs.readFileSync(path.resolve(`src/locales/${locale}.json`), 'utf8'));
    for (const key of required) assert.ok(catalog.adminDisputeResolve?.[key], `${locale} missing adminDisputeResolve.${key}`);
  }
});
