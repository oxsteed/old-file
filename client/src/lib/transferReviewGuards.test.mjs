import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canConfirmClawback,
  canConfirmTransfer,
  canEnterTransferReview,
  isValidTransferRecipientId,
} from './transferReviewGuards.js';

const recipient = { customerId: '11111111-1111-4111-8111-111111111111', displayName: 'Ada Example' };
const feeQuote = { feeCents: 25, currencyCode: 'USD' };
const baseTransfer = {
  amountCents: 1000,
  recipient,
  recipientId: '11111111-1111-4111-8111-111111111111',
  feeQuote,
  feeQuoteError: null,
};

test('transfer review opens and confirms only with a resolved name and a loaded fee quote', () => {
  assert.equal(canEnterTransferReview(baseTransfer), true);
  assert.equal(canConfirmTransfer(baseTransfer), true);
});

test('transfer review stays closed when the recipient name was never resolved', () => {
  assert.equal(canEnterTransferReview({ ...baseTransfer, recipient: null }), false);
  assert.equal(canConfirmTransfer({ ...baseTransfer, recipient: null }), false);
});

test('transfer review stays closed when the resolved row has no display name', () => {
  assert.equal(canEnterTransferReview({ ...baseTransfer, recipient: { customerId: recipient.customerId, displayName: null } }), false);
});

test('transfer review stays closed when the resolved name belongs to a different id', () => {
  assert.equal(canEnterTransferReview({
    ...baseTransfer,
    recipientId: '22222222-2222-4222-8222-222222222222',
  }), false);
});

test('transfer review stays closed when the fee quote failed or never loaded', () => {
  assert.equal(canEnterTransferReview({ ...baseTransfer, feeQuote: null, feeQuoteError: 'Fee service unavailable' }), false);
  assert.equal(canEnterTransferReview({ ...baseTransfer, feeQuote: null, feeQuoteError: null }), false);
  assert.equal(canConfirmTransfer({ ...baseTransfer, feeQuote: null, feeQuoteError: 'Fee service unavailable' }), false);
});

test('transfer review stays closed when the quote is for another currency', () => {
  assert.equal(canEnterTransferReview({ ...baseTransfer, currencyCode: 'EUR' }), false);
  assert.equal(canEnterTransferReview({ ...baseTransfer, currencyCode: 'USD' }), true);
});

test('transfer review stays closed with no amount', () => {
  assert.equal(canEnterTransferReview({ ...baseTransfer, amountCents: 0 }), false);
});

test('clawback confirms only with a preview for the exact id entered', () => {
  const preview = { id: '33333333-3333-4333-8333-333333333333', amountCents: 5000 };
  assert.equal(canConfirmClawback({ topupId: '33333333-3333-4333-8333-333333333333', reason: 'chargeback', preview }), true);
  // Blind confirm: no preview at all.
  assert.equal(canConfirmClawback({ topupId: '33333333-3333-4333-8333-333333333333', reason: 'chargeback', preview: null }), false);
  // Wrong-target confirm: preview is for a different top-up.
  assert.equal(canConfirmClawback({ topupId: '44444444-4444-4444-8444-444444444444', reason: 'chargeback', preview }), false);
  // Missing reason still blocks.
  assert.equal(canConfirmClawback({ topupId: '33333333-3333-4333-8333-333333333333', reason: '  ', preview }), false);
});

test('recipient id format check matches the page rule', () => {
  assert.equal(isValidTransferRecipientId('11111111-1111-4111-8111-111111111111'), true);
  assert.equal(isValidTransferRecipientId('not-a-uuid'), false);
  assert.equal(isValidTransferRecipientId(''), false);
});
