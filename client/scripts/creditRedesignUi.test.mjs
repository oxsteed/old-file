// Credit redesign checkpoint 4 (D-801/D-802/D-806): unit tests for the
// pure UI helpers in client/src/lib/creditRedesignUi.js.
//
// Run: node --test scripts/creditRedesignUi.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CREDIT_UI_STORAGE_KEY,
  readCreditUiState,
  writeCreditUiState,
  moneyOutBlockReason,
  classifyRecipientInput,
  formatMaskedCardNumber,
  groupCardNumber,
} from '../src/lib/creditRedesignUi.js';

function memoryStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    _store: store,
  };
}

test('readCreditUiState returns defaults on an empty or broken store', () => {
  assert.deepEqual(readCreditUiState(memoryStorage()), { currency: 'USD', activityTab: 'all' });
  assert.deepEqual(readCreditUiState(memoryStorage({ [CREDIT_UI_STORAGE_KEY]: 'not json{' })), { currency: 'USD', activityTab: 'all' });
  assert.deepEqual(readCreditUiState(memoryStorage({ [CREDIT_UI_STORAGE_KEY]: JSON.stringify({ currency: 'usd', activityTab: 'nope' }) })), { currency: 'USD', activityTab: 'all' });
  assert.deepEqual(readCreditUiState(null), { currency: 'USD', activityTab: 'all' });
});

test('readCreditUiState keeps only a valid currency and a known tab', () => {
  const storage = memoryStorage({ [CREDIT_UI_STORAGE_KEY]: JSON.stringify({ currency: 'EUR', activityTab: 'disputes' }) });
  assert.deepEqual(readCreditUiState(storage), { currency: 'EUR', activityTab: 'disputes' });
});

test('writeCreditUiState round-trips and never throws on a dead store', () => {
  const storage = memoryStorage();
  writeCreditUiState(storage, { currency: 'HTG', activityTab: 'holds' });
  assert.deepEqual(readCreditUiState(storage), { currency: 'HTG', activityTab: 'holds' });
  writeCreditUiState(storage, { currency: 'bad', activityTab: 'bad' });
  assert.deepEqual(readCreditUiState(storage), { currency: 'USD', activityTab: 'all' });
  assert.doesNotThrow(() => writeCreditUiState({ setItem: () => { throw new Error('full'); } }, { currency: 'USD', activityTab: 'all' }));
  assert.doesNotThrow(() => writeCreditUiState(null, { currency: 'USD', activityTab: 'all' }));
});

test('moneyOutBlockReason blocks on a paused rail or a non-active account', () => {
  assert.equal(moneyOutBlockReason({ railEnabled: true, accountStatus: 'active' }), null);
  assert.equal(moneyOutBlockReason({ railEnabled: false, accountStatus: 'active' }), 'railPaused');
  assert.equal(moneyOutBlockReason({ railEnabled: true, accountStatus: 'suspended' }), 'accountNotActive');
  assert.equal(moneyOutBlockReason({ railEnabled: false, accountStatus: 'suspended' }), 'railPaused');
  // Still loading: the rail state is unknown, so nothing is blocked yet.
  assert.equal(moneyOutBlockReason({ railEnabled: null, accountStatus: 'active' }), null);
  assert.equal(moneyOutBlockReason({ railEnabled: undefined, accountStatus: undefined }), null);
  assert.equal(moneyOutBlockReason(), null);
});

test('classifyRecipientInput tells UUID, account number, and card number apart', () => {
  assert.equal(classifyRecipientInput('123e4567-e89b-12d3-a456-426614174000'), 'customerId');
  assert.equal(classifyRecipientInput('8123456789'), 'accountNumber');
  assert.equal(classifyRecipientInput('9700123456789012'), 'cardNumber');
  // A scanned card number may carry spaces or dashes.
  assert.equal(classifyRecipientInput('9700 1234 5678 9012'), 'cardNumber');
  assert.equal(classifyRecipientInput('9700-1234-5678-9012'), 'cardNumber');
  assert.equal(classifyRecipientInput(''), 'unknown');
  assert.equal(classifyRecipientInput('12345'), 'unknown');
  assert.equal(classifyRecipientInput('not-an-id'), 'unknown');
});

test('formatMaskedCardNumber never shows more than the last four', () => {
  assert.equal(formatMaskedCardNumber('9012'), '•••• •••• •••• 9012');
  assert.equal(formatMaskedCardNumber(null), null);
  assert.equal(formatMaskedCardNumber(''), null);
});

test('groupCardNumber groups a 16-digit number in fours', () => {
  assert.equal(groupCardNumber('9700123456789012'), '9700 1234 5678 9012');
  assert.equal(groupCardNumber('9700 1234 5678 9012'), '9700 1234 5678 9012');
  assert.equal(groupCardNumber(''), '');
});
