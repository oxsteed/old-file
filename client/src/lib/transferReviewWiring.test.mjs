// Wiring regression test for admin-ops audit items 3, 4, and 11: the guard
// predicates in transferReviewGuards.js are only effective if the pages
// actually use them. These assertions read the page sources and fail if a
// future edit reintroduces a blind confirm, a bare-UUID review, or a
// submittable transfer with no fee quote. (Verified during development by
// running this file against the pre-fix page sources, where all three
// tests fail.)
//
// Run: node --test client/src/lib/transferReviewWiring.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, '..');
const clawbackPage = readFileSync(join(clientRoot, 'admin/pages/super/RestaurantTopupApprovals.jsx'), 'utf8');
const transferPage = readFileSync(join(clientRoot, 'pages/food/OxsteedCreditPage.jsx'), 'utf8');

test('item 3: clawback dialog cannot confirm without a preview for the exact id', () => {
  assert.ok(clawbackPage.includes('/admin/restaurant-topups/topups/'), 'clawback page must call the top-up lookup endpoint');
  assert.ok(clawbackPage.includes('clawbackPreviewAmount'), 'dialog must render the previewed amount');
  assert.ok(clawbackPage.includes('clawbackPreviewRestaurant'), 'dialog must render the previewed restaurant');
  assert.ok(clawbackPage.includes('clawbackPreviewStatus'), 'dialog must render the previewed status');
  assert.ok(
    clawbackPage.includes('modal.topupPreview && String(modal.topupPreview.id)'),
    'confirm button must require a preview for the entered id',
  );
  assert.ok(
    clawbackPage.includes('String(preview.id) !== topupId'),
    'confirmDecision must refuse to issue a step-up without a matching preview',
  );
});

test('item 4: transfer review shows a resolved name, not a bare UUID', () => {
  assert.ok(transferPage.includes('getOxsteedCreditTransferRecipient'), 'page must look up the recipient');
  assert.ok(
    transferPage.includes('transferRecipient?.displayName'),
    'review copy must use the resolved display name as the recipient',
  );
  assert.ok(
    transferPage.includes('disabled={transferSubmitting || transferConfirmBlocked}'),
    'confirm button must stay disabled until the name resolves',
  );
  assert.ok(
    transferPage.includes('disabled={transferSubmitting || transferReviewBlocked}'),
    'review button must stay disabled until the name resolves',
  );
});

test('item 11: fee-quote failure shows a retry note and keeps review/confirm disabled', () => {
  assert.ok(transferPage.includes('transferFeeQuoteFailed'), 'page must render a fee-could-not-load note');
  assert.ok(
    transferPage.includes('refreshTransferFeeQuote(transferAmount, { immediate: true })'),
    'fee note must offer a retry that reloads the quote',
  );
  assert.ok(
    transferPage.includes('transferFeeQuoteError'),
    'review/confirm gating must observe the quote error state',
  );
});
