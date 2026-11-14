import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Money-flows R8: voiding a pay-run consolidation is two-step, but the
// client had no approve affordance and toasted "voided" after a POST
// /void that now returns 202 with the group still finalized/approved.
// Contract: the panel calls the void-approve API, toasts "requested"
// while a void waits for a second manager, and renders an approve
// button only while a void is pending. Follows the source-contract
// pattern of employeePortalLink.test.mjs (rendering the full Brand HQ
// panel in a unit test is impractical: it mounts live brand workspaces).
//
// Run from client/: node --test scripts/consolidationVoidApprove.test.mjs

const read = (file) => fs.readFileSync(path.resolve(file), 'utf8');

test('panel calls the void-approve API for a pending consolidation void', () => {
  const panel = read('src/pages/food/BrandHQPanel.jsx');
  assert.match(panel, /approveVoidPayRunConsolidation/);
  assert.match(panel, /consolidationAction\(consolidation\.id, 'voidApprove'\)/);
  const api = read('src/api/food.js');
  assert.match(
    api,
    /export const approveVoidPayRunConsolidation[\s\S]*?\/void-approve/
  );
});

test('void toast says requested while a second manager must still approve', () => {
  const panel = read('src/pages/food/BrandHQPanel.jsx');
  assert.match(panel, /updated\?\.voidPending/);
  assert.match(panel, /consolidations\.voidRequested/);
  // The old shape toasted "voided" unconditionally after POST /void.
  assert.doesNotMatch(panel, /if \(action === 'void'\) await voidPayRunConsolidation/);
});

test('approve button renders only while a void is pending', () => {
  const panel = read('src/pages/food/BrandHQPanel.jsx');
  assert.match(panel, /consolidation\.voidPending && \(/);
  assert.match(panel, /consolidations\.voidApprove/);
  assert.match(panel, /consolidations\.voidPending/);
  // The void button must hide while a request waits, or two makers
  // could stack requests on one consolidation.
  assert.match(panel, /!consolidation\.voidPending && \(/);
});

test('the void keys exist in all five locales', () => {
  for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(read(`src/locales/${lang}.json`));
    const block = catalog?.restaurants?.ops?.brandHq?.consolidations;
    for (const key of ['voidRequested', 'voidApprove', 'voidApproved', 'voidPending']) {
      assert.equal(typeof block?.[key], 'string', `${key} missing in ${lang}`);
      assert.notEqual(block[key].length, 0);
    }
  }
});
