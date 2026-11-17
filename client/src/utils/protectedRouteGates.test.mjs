// Domain 6 B4 (2026-11-17): the requireOnboarded arm must fire for
// new-model helpers (role=customer with helper access) and read the
// derived helper-onboarding truth, not the legacy role allow-list and the
// summary flag. Legacy helper roles keep the old behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isHelperOnboardingRedirectRequired } from './protectedRouteGates.js';

function args(overrides = {}) {
  return {
    requireOnboarded: true,
    hasHelperAccess: false,
    role: 'customer',
    isHelperOnboardingComplete: false,
    pathname: '/helper/payouts',
    ...overrides,
  };
}

test('new-model helper (role=customer, helper access, incomplete) is redirected', () => {
  assert.equal(
    isHelperOnboardingRedirectRequired(args({ hasHelperAccess: true })),
    true,
  );
});

test('new-model helper with complete onboarding is not redirected', () => {
  assert.equal(
    isHelperOnboardingRedirectRequired(
      args({ hasHelperAccess: true, isHelperOnboardingComplete: true }),
    ),
    false,
  );
});

test('new-model helper on an allowed path is not redirected', () => {
  assert.equal(
    isHelperOnboardingRedirectRequired(
      args({ hasHelperAccess: true, pathname: '/helper-dashboard' }),
    ),
    false,
  );
});

test('pure customer without helper access is not redirected', () => {
  assert.equal(isHelperOnboardingRedirectRequired(args()), false);
});

test('legacy helper role without helper access keeps the old redirect', () => {
  assert.equal(
    isHelperOnboardingRedirectRequired(args({ role: 'helper' })),
    true,
  );
  assert.equal(
    isHelperOnboardingRedirectRequired(args({ role: 'helper_pro' })),
    true,
  );
  assert.equal(
    isHelperOnboardingRedirectRequired(args({ role: 'broker' })),
    true,
  );
});

test('legacy helper with complete onboarding is not redirected', () => {
  assert.equal(
    isHelperOnboardingRedirectRequired(
      args({ role: 'helper', isHelperOnboardingComplete: true }),
    ),
    false,
  );
});

test('no redirect when requireOnboarded is off, even for an incomplete helper', () => {
  assert.equal(
    isHelperOnboardingRedirectRequired(
      args({ requireOnboarded: false, hasHelperAccess: true }),
    ),
    false,
  );
});

test('non-allowed paths redirect only because the route opted in; allowed paths never do', () => {
  // /settings has no requireOnboarded route, so in practice it never hits
  // this arm; the predicate itself only exempts the allowed list.
  assert.equal(
    isHelperOnboardingRedirectRequired(
      args({ hasHelperAccess: true, pathname: '/settings' }),
    ),
    true,
  );
  assert.equal(
    isHelperOnboardingRedirectRequired(
      args({ hasHelperAccess: true, pathname: '/dashboard' }),
    ),
    false,
  );
});
