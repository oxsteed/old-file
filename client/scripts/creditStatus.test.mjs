import test from 'node:test';
import assert from 'node:assert/strict';
import { creditStatusTranslationKey, localizeCreditStatus } from '../src/lib/creditStatus.js';

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
