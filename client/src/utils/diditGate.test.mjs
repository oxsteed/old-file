// Domain 6 B3 (2026-11-17): client diditGateSatisfied must mirror the
// server's 2-year freshness rule (server/utils/diditGate.js). A 'verified'
// status with a stale, missing or malformed didit_verified_at does NOT
// satisfy the gate; the server 403s those users, so the client must
// redirect them to /verify-identity instead of rendering a dead page.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIDIT_VERIFICATION_TTL_YEARS,
  diditGateSatisfied,
  isDiditVerificationFresh,
} from './diditGate.js';

const NOW = new Date('2026-11-17T12:00:00.000Z');
const freshAt = new Date('2026-06-01T00:00:00.000Z').toISOString();
const staleAt = new Date('2024-01-01T00:00:00.000Z').toISOString();

function user(overrides = {}) {
  return {
    email_verified: true,
    didit_status: 'verified',
    didit_verified_at: freshAt,
    didit_enforcement_required: false,
    ...overrides,
  };
}

test('TTL is two years', () => {
  assert.equal(DIDIT_VERIFICATION_TTL_YEARS, 2);
});

test('fresh verification is fresh, stale is not', () => {
  assert.equal(isDiditVerificationFresh(freshAt, NOW), true);
  assert.equal(isDiditVerificationFresh(staleAt, NOW), false);
});

test('exactly at the two-year cutoff is not fresh (fail closed)', () => {
  assert.equal(isDiditVerificationFresh('2024-11-17T12:00:00.000Z', NOW), false);
  assert.equal(isDiditVerificationFresh('2024-11-17T12:00:01.000Z', NOW), true);
});

test('missing and malformed timestamps fail closed', () => {
  assert.equal(isDiditVerificationFresh(null, NOW), false);
  assert.equal(isDiditVerificationFresh(undefined, NOW), false);
  assert.equal(isDiditVerificationFresh('not-a-date', NOW), false);
});

test('fresh verified satisfies the gate', () => {
  assert.equal(diditGateSatisfied(user()), true);
});

test('stale verified does NOT satisfy the gate', () => {
  assert.equal(diditGateSatisfied(user({ didit_verified_at: staleAt })), false);
});

test('verified with a missing or malformed timestamp does NOT satisfy the gate', () => {
  assert.equal(diditGateSatisfied(user({ didit_verified_at: null })), false);
  assert.equal(diditGateSatisfied(user({ didit_verified_at: 'not-a-date' })), false);
});

test('stale verified does NOT satisfy the gate under enforcement either', () => {
  assert.equal(
    diditGateSatisfied(user({ didit_verified_at: staleAt, didit_enforcement_required: true })),
    false,
  );
  assert.equal(
    diditGateSatisfied(user({ didit_enforcement_required: true })),
    true,
  );
});

test('skipped satisfies the gate unless enforcement is required', () => {
  assert.equal(diditGateSatisfied(user({ didit_status: 'skipped' })), true);
  assert.equal(
    diditGateSatisfied(user({ didit_status: 'skipped', didit_enforcement_required: true })),
    false,
  );
});

test('pending never satisfies the gate', () => {
  assert.equal(diditGateSatisfied(user({ didit_status: 'pending' })), false);
});

test('email-unverified users pass the Didit check (the email gate handles them)', () => {
  assert.equal(diditGateSatisfied(user({ email_verified: false, didit_status: 'pending' })), true);
});
