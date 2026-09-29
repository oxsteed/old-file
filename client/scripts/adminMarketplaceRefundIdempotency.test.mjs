import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = fs.readFileSync(
  path.resolve('src/admin/components/OrderDetailModal.jsx'),
  'utf8',
);

test('admin marketplace refunds send a stable idempotency key and clear it only after success', () => {
  assert.match(source, /createStableIdempotencyKeyStore/);
  assert.match(source, /get\('marketplace-refund', keyPayload\)/);
  assert.match(source, /['"]Idempotency-Key['"]:\s*idempotencyKey/);
  assert.match(source, /clear\('marketplace-refund', variables\.keyPayload\)/);
  assert.match(source, /refundMutation\.mutate\(\{ reason: refundReason, amountCents: refundAmount \}\)/);
});
