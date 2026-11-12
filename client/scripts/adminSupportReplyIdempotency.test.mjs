import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/admin/pages/SupportTickets.jsx', import.meta.url), 'utf8');

test('admin support replies send a stable client id for retries', () => {
  assert.match(source, /const pendingReplyRef = useRef\(null\)/);
  assert.match(source, /crypto\.randomUUID\(\)/);
  assert.match(source, /client_message_id: clientMessageId/);
  assert.match(source, /pending\.clientMessageId/);
});
