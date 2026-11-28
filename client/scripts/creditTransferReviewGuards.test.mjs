// Credit redesign checkpoint 4 (D-798): the transfer review gate must
// accept a recipient resolved by account number or card number, not only
// a pasted UUID, while still refusing a resolved name for an edited input.
//
// Run: node --test scripts/creditTransferReviewGuards.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canEnterTransferReview,
  canConfirmTransfer,
  isValidTransferRecipientId,
} from '../src/lib/transferReviewGuards.js';

const CUSTOMER_ID = '123e4567-e89b-12d3-a456-426614174000';
const baseArgs = {
  amountCents: 1000,
  feeQuote: { currencyCode: 'USD', feeCents: 0 },
  feeQuoteError: '',
  currencyCode: 'USD',
};

test('a UUID recipient still unlocks review only for the exact id entered', () => {
  const recipient = { customerId: CUSTOMER_ID, displayName: 'Ada Lovelace' };
  assert.equal(canEnterTransferReview({ ...baseArgs, recipient, recipientId: CUSTOMER_ID }), true);
  assert.equal(canEnterTransferReview({ ...baseArgs, recipient, recipientId: '123e4567-e89b-12d3-a456-426614174001' }), false);
  assert.equal(canEnterTransferReview({ ...baseArgs, recipient: null, recipientId: CUSTOMER_ID }), false);
  assert.equal(canEnterTransferReview({ ...baseArgs, recipient: { customerId: CUSTOMER_ID }, recipientId: CUSTOMER_ID }), false);
});

test('an account-number or card-number resolution unlocks review for that input only', () => {
  const recipient = { customerId: CUSTOMER_ID, displayName: 'Ada Lovelace', resolvedFor: '8123456789' };
  assert.equal(canEnterTransferReview({ ...baseArgs, recipient, recipientId: '8123456789' }), true);
  assert.equal(canEnterTransferReview({ ...baseArgs, recipient, recipientId: '8123456788' }), false);
  // The resolved customer's own UUID is the same customer, so it matches
  // on the UUID path too; the gate never unlocks a different customer.
  assert.equal(canEnterTransferReview({ ...baseArgs, recipient, recipientId: CUSTOMER_ID }), true);
  const cardRecipient = { customerId: CUSTOMER_ID, displayName: 'Ada Lovelace', resolvedFor: '9700123456789012' };
  assert.equal(canEnterTransferReview({ ...baseArgs, recipient: cardRecipient, recipientId: '9700123456789012' }), true);
  assert.equal(canConfirmTransfer({ ...baseArgs, recipient: cardRecipient, recipientId: '9700123456789012' }), true);
});

test('a missing or failed fee quote still blocks review even when resolved', () => {
  const recipient = { customerId: CUSTOMER_ID, displayName: 'Ada Lovelace', resolvedFor: '8123456789' };
  assert.equal(canEnterTransferReview({ ...baseArgs, recipient, recipientId: '8123456789', feeQuote: null }), false);
  assert.equal(canEnterTransferReview({ ...baseArgs, recipient, recipientId: '8123456789', feeQuoteError: 'boom' }), false);
});

test('isValidTransferRecipientId still means a UUID only', () => {
  assert.equal(isValidTransferRecipientId(CUSTOMER_ID), true);
  assert.equal(isValidTransferRecipientId('8123456789'), false);
  assert.equal(isValidTransferRecipientId('9700123456789012'), false);
});
