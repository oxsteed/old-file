// Nov 10 #3 (STILL LIVE, PARTIAL): the transfer panel renders on
// accountStatus === 'active' only; only the limits row is gated on
// transfers.enabled. The whole transfer panel must be gated on
// transfers.enabled, so a disabled transfer rail never shows a transfer form.
//
// Run: node --test scripts/creditTransferGate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => readFile(join(root, rel), 'utf8');

test('the transfer panel renders only when transfers are enabled', async () => {
  const page = await src('src/pages/food/OxsteedCreditPage.jsx');
  assert.match(
    page,
    /accountStatus === 'active' && limitSummary\?\.transfers\.enabled && <section className="ox-credit-panel ox-credit-transfer-panel"/,
    'transfer panel is gated on transfers.enabled',
  );
  // No ungated render of the transfer panel left anywhere.
  assert.doesNotMatch(
    page,
    /\{accountStatus === 'active' && <section className="ox-credit-panel ox-credit-transfer-panel"/,
  );
});

test('the limits row stays gated on transfers.enabled', async () => {
  const page = await src('src/pages/food/OxsteedCreditPage.jsx');
  assert.match(page, /\{limitSummary\.transfers\.enabled && <><div><span>\{t\('transferAmountRemaining'\)\}/);
});
