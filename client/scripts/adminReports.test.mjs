import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve('src/admin/pages/ReportsList.jsx'),
  'utf8',
);

test('admin reports uses localized status, action, and error copy', () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /adminReports\.status/);
  assert.match(source, /adminReports\.action/);
  assert.match(source, /adminReports\.loadFailedMessage/);
});

test('admin reports catalog is complete in every supported locale', () => {
  const required = ['count', 'status', 'action', 'actionShort', 'actionSuccess', 'actionFailed', 'loadFailedTitle', 'loadFailedMessage', 'empty', 'noDescription', 'reportedBy', 'anonymous', 'actionTaken', 'by'];
  for (const locale of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(fs.readFileSync(path.resolve(`src/locales/${locale}.json`), 'utf8'));
    for (const key of required) assert.ok(catalog.adminReports?.[key], `${locale} missing adminReports.${key}`);
  }
});
