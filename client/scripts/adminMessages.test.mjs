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

test('admin message sends keep a stable retry identity and failed draft', () => {
  assert.match(source, /createMessageRequestId/);
  assert.match(source, /'Idempotency-Key': clientMessageId/);
  assert.match(source, /data:\s*\{ content, clientMessageId \}/);
  assert.match(source, /pendingSendRef\.current/);
  assert.match(source, /setMessage\(current => current \|\| content\)/);
  assert.match(source, /send_error/);
  assert.doesNotMatch(source, /setThread\(prev => prev\.filter\(m => m\.id === optimisticId\)\)/);
});
