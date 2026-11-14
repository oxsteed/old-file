// Domain 7 #8: paid settlements past the first six have no reverse button
// anywhere — the recovery section slices to 6 and the main settlements
// table offers no reverse action for paid rows. The main table must render
// the reverse action on the paid row itself, reusing the existing
// reversal flow (reason + recovery reference + step-up).
//
// Run: node --test scripts/domain7SettlementReversal.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(
  path.join(root, 'src', 'admin', 'pages', 'super', 'oxsteedCredit', 'SettlementsPage.jsx'),
  'utf8',
);

function settlementControlsBody(src) {
  const start = src.indexOf('function SettlementControls(');
  assert.notEqual(start, -1, 'SettlementControls not found');
  const end = src.indexOf('function SettlementEvidence(', start);
  assert.notEqual(end, -1, 'SettlementEvidence not found');
  return src.slice(start, end);
}

test('main settlements table offers reverse on paid rows with a positive net', () => {
  const body = settlementControlsBody(page);
  assert.match(body, /reverseSettlement/, 'SettlementControls never calls reverseSettlement');
  assert.match(
    body,
    /settlement\.status === 'paid'[\s\S]{0,200}reverseSettlement\(settlement\)/,
    'no reverse action gated on a paid row in the main table',
  );
  assert.match(
    body,
    /Number\(settlement\.netCents \|\| 0\) > 0[\s\S]{0,200}reverseSettlement\(settlement\)/,
    'paid-row reverse must be limited to a positive net, like the recovery section',
  );
});

test('parent page wires the existing reversal flow into the table', () => {
  assert.match(page, /reverseSettlement=\{reverseSettlement\}/, 'SettlementControls is not given reverseSettlement');
});

test('recovery section keeps its slice (evidence only, untouched)', () => {
  assert.match(
    page,
    /filter\(\(settlement\) => settlement\.status === 'paid' && Number\(settlement\.netCents \|\| 0\) > 0\)\.slice\(0, 6\)/,
    'recovery section slice changed unexpectedly',
  );
});
