import test from 'node:test';
import assert from 'node:assert/strict';
import {
  creditOrderTypeTranslationKey,
  creditStatusTranslationKey,
  creditTransactionTypeTranslationKey,
  localizeCreditOrderType,
  localizeCreditOrderTypes,
  localizeCreditStatus,
  localizeCreditTransactionType,
} from '../src/lib/creditStatus.js';

test('maps Credit lifecycle values to stable translation keys', () => {
  assert.equal(creditStatusTranslationKey('pending_approval'), 'statusPending');
  assert.equal(creditStatusTranslationKey('IN_REVIEW'), 'underReviewStatus');
  assert.equal(creditStatusTranslationKey('released'), 'releasedStatus');
  assert.equal(creditStatusTranslationKey('revoked'), 'rejectedStatus');
});

test('uses the unavailable label for unknown or blank values', () => {
  const translate = (key) => `translated:${key}`;
  assert.equal(localizeCreditStatus('future_provider_state', translate), 'translated:statusUnknown');
  assert.equal(localizeCreditStatus('', translate), 'translated:statusUnknown');
});

test('localizes known and unknown order types without exposing machine values', () => {
  const translate = (key) => `translated:${key}`;
  assert.equal(creditOrderTypeTranslationKey('DINE_IN'), 'orderTypeDineIn');
  assert.equal(localizeCreditOrderType('pickup', translate), 'translated:orderTypePickup');
  assert.equal(localizeCreditOrderType('future_order_type', translate), 'translated:statusUnknown');
  assert.equal(localizeCreditOrderTypes(['delivery', 'dine_in'], translate), 'translated:orderTypeDelivery, translated:orderTypeDineIn');
});

test('localizes transaction and partner lifecycle values without raw fallbacks', () => {
  const translate = (key) => `translated:${key}`;
  assert.equal(creditTransactionTypeTranslationKey('CONVERSION_FEE'), 'transactionConversionFee');
  assert.equal(localizeCreditTransactionType('purchase', translate), 'translated:transactionPurchase');
  assert.equal(localizeCreditTransactionType('future_transaction_type', translate), 'translated:transactionUnknown');
  assert.equal(localizeCreditStatus('DISPUTED', translate), 'translated:statusDisputed');
  assert.equal(localizeCreditStatus('reversed', translate), 'translated:statusReversed');
});
