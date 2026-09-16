import test from 'node:test';
import assert from 'node:assert/strict';
import { safeCreditErrorMessage } from '../src/lib/creditErrors.js';

test('keeps concise API validation messages', () => {
  assert.equal(
    safeCreditErrorMessage({ response: { data: { message: 'A reason is required.' } } }, 'Fallback'),
    'A reason is required.',
  );
});

test('hides transport and infrastructure details', () => {
  assert.equal(
    safeCreditErrorMessage({ message: 'Request failed with status code 500' }, 'Unable to load Credit.'),
    'Unable to load Credit.',
  );
  assert.equal(
    safeCreditErrorMessage({ response: { data: { error: { message: 'password authentication failed for user postgres' } } } }, 'Unable to load Credit.'),
    'Unable to load Credit.',
  );
});

test('uses the fallback for missing, oversized, or non-string messages', () => {
  const fallback = 'Credit action failed.';
  assert.equal(safeCreditErrorMessage({}, fallback), fallback);
  assert.equal(safeCreditErrorMessage({ response: { data: { message: 'x'.repeat(241) } } }, fallback), fallback);
  assert.equal(safeCreditErrorMessage({ response: { data: { message: { detail: 'no' } } } }, fallback), fallback);
});
