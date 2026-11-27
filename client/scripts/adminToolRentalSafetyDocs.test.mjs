import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// G11-B5 checkpoint 6 (D-616..D-618): the admin safety-doc view in
// ToolRentalModeration. The page is JSX and cannot be imported under plain
// node --test, so the wiring is pinned by source reads, the same pattern as
// adaptiveNavbar.test.mjs and commandPaletteVisibility.test.mjs.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = await readFile(path.join(root, 'src/admin/pages/ToolRentalModeration.jsx'), 'utf8');

const SAFETY_KEYS = [
  'safetyDocsTitle',
  'safetyDocsSubtitle',
  'safetyDocsButton',
  'safetyDocsSelectPrompt',
  'safetyDocsEmpty',
  'safetyDocsLoadFailedTitle',
  'safetyDocsLoadFailedMessage',
  'safetyDocsOpen',
  'safetyDocsTypePdf',
  'safetyDocsTypeImage',
];

test('the moderation page calls the admin safety-docs endpoint per listing', () => {
  assert.ok(
    page.includes('/tool-rentals/admin/tool-rentals/${tool.id}/safety-documents'),
    'admin safety-docs endpoint is never called',
  );
  assert.ok(page.includes('adminApi.get(`'), 'safety-docs load must go through adminApi');
});

test('the row button shows the per-listing safety-doc count', () => {
  assert.ok(page.includes('safety_documents_count'), 'list rows must carry the count');
  assert.ok(
    page.includes('safetyDocsButtonLabel(Number(t.safety_documents_count || 0))'),
    'row button must render the count',
  );
});

test('the safety-doc panel renders title, type, date and an open link', () => {
  assert.ok(page.includes('doc.title'), 'doc title must render');
  assert.ok(page.includes('safetyDocTypeLabel(doc.mime_type)'), 'doc type must render');
  assert.ok(
    page.includes('new Date(doc.created_at).toLocaleDateString()'),
    'upload date must render',
  );
  assert.ok(page.includes('href={doc.file_url}'), 'open link must point at the file');
  assert.ok(page.includes('target="_blank"'), 'open link must open in a new tab');
});

test('the safety-doc view is read-only: no admin delete of safety documents', () => {
  assert.ok(!page.includes('deleteSafetyDocument'), 'no admin delete of safety docs');
  assert.ok(!page.includes('adminApi.delete'), 'no admin delete call on this page');
});

test('loading, empty and error states use the new keys', () => {
  for (const key of [
    'safetyDocsTitle',
    'safetyDocsSubtitle',
    'safetyDocsSelectPrompt',
    'safetyDocsEmpty',
    'safetyDocsLoadFailedTitle',
    'safetyDocsLoadFailedMessage',
    'safetyDocsOpen',
  ]) {
    assert.ok(page.includes(`adminToolRentalModeration.${key}`), key);
  }
});

test('every safety-doc key exists in all five locale catalogs', async () => {
  for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(
      await readFile(path.join(root, `src/locales/${lang}.json`), 'utf8'),
    );
    const block = catalog.adminToolRentalModeration;
    assert.ok(block, `${lang} adminToolRentalModeration block`);
    for (const key of SAFETY_KEYS) {
      assert.equal(typeof block[key], 'string', `${lang}.${key}`);
      assert.ok(block[key].length > 0, `${lang}.${key}`);
    }
  }
});
