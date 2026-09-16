import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beginCreditRequest,
  invalidateCreditRequest,
  isCurrentCreditRequest,
} from '../src/admin/pages/super/creditRequestGuards.js';

test('only the newest Customer 360 request may update state', () => {
  const ref = { current: 0 };
  const first = beginCreditRequest(ref);
  const second = beginCreditRequest(ref);

  assert.equal(isCurrentCreditRequest(ref, first), false);
  assert.equal(isCurrentCreditRequest(ref, second), true);
});

test('navigation invalidates an in-flight Credit request', () => {
  const ref = { current: 0 };
  const requestId = beginCreditRequest(ref);

  invalidateCreditRequest(ref);

  assert.equal(isCurrentCreditRequest(ref, requestId), false);
});

test('independent request refs do not cross-apply partner ledger results', () => {
  const customerRef = { current: 0 };
  const partnerRef = { current: 0 };
  const customerRequest = beginCreditRequest(customerRef);
  beginCreditRequest(partnerRef);
  const partnerRequest = beginCreditRequest(partnerRef);

  assert.equal(isCurrentCreditRequest(customerRef, partnerRequest), false);
  assert.equal(isCurrentCreditRequest(partnerRef, customerRequest), false);
  assert.equal(isCurrentCreditRequest(customerRef, customerRequest), true);
  assert.equal(isCurrentCreditRequest(partnerRef, partnerRequest), true);
});
