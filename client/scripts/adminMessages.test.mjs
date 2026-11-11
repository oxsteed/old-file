import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve('src/admin/pages/AdminMessages.jsx'),
  'utf8',
);

test('admin messages uses localized and accessible controls', () => {
  assert.match(source, /useTranslation\(\)/);
  // The search runs through the shared SuggestDropdown combobox; the page
  // must pass it the localized accessible label (the component renders
  // aria-label on its input).
  assert.match(source, /ariaLabel=\{t\('adminMessages\.searchPlaceholder'\)\}/);
  assert.match(source, /role="dialog" aria-modal="true"/);
  assert.match(source, /role="status"/);
  assert.doesNotMatch(source, />Admin Messages</);
  assert.doesNotMatch(source, /placeholder="Search by name or email/);
});

test('super-admin conversation rows preserve conversation identity when opening threads', () => {
  assert.match(source, /loadThread\(conv\.user_id, conv\.id\)/);
  assert.match(source, /conversationId=\$\{encodeURIComponent\(conversationId\)\}/);
  assert.match(source, /selected\.conversation_id/);
});

test('conversation inbox exposes server pagination instead of silently capping at 100 rows', () => {
  assert.match(source, /limit=100&offset=\$\{listOffset\}/);
  assert.match(source, /total: Number\(data\.total \|\| 0\)/);
  assert.match(source, /offset: Number\(data\.offset \|\| 0\)/);
  assert.match(source, /setListOffset\(\(offset\) => offset \+ listPageSize\)/);
  assert.match(source, /adminMessages\.loadMore/);
  assert.match(source, /adminMessages\.showingCount/);
  assert.match(source, /new Map\(previous\.map/);
});
