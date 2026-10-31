// Registration fake-progression: helper capability reporting must use the
// server-derived truth, not the summary flags general registration stamps
// for every mode at OTP verification.
//
// Run: node --test scripts/helperOnboardingTruth.test.mjs
//
// The contract:
//   1. isHelperOnboardingComplete (client/src/utils/helperOnboarding.js)
//      mirrors server/services/helperOnboarding.js deriveHelperOnboarding:
//      email + terms + profile + contact + verified identity, all from
//      auth-payload columns. A general-flow helper who only verified OTP
//      (summary flags true, identity pending) is NOT complete.
//   2. HelperOnboardingChecklist hides only on the server-derived
//      onboarding_step 'active', never on the raw onboarding_completed
//      flag, so the checklist still shows while helper steps are owed.
//   3. AuthContext wires the helper capability flags (needsOnboarding,
//      canApplyToJobs) from the derivation, and the job-detail model maps
//      that pair to the 'onboarding' action (which routes to /dashboard,
//      where the checklist now shows).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isHelperOnboardingComplete } from '../src/utils/helperOnboarding.js';
import { jobDetailView } from '../src/utils/jobDetailModel.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(p, 'utf8');

const verifiedHelper = {
  email_verified: true,
  terms_accepted: true,
  profile_completed: true,
  contact_completed: true,
  id_verified: false,
  didit_status: 'verified',
};

test('general-flow helper with summary flags but pending identity is NOT complete', () => {
  // Exactly what verifyRegistrationOTP stamps at signup: every summary
  // flag true, identity untouched.
  const freshSignup = {
    email_verified: true,
    terms_accepted: true,
    profile_completed: true,
    contact_completed: true,
    onboarding_completed: true,
    onboarding_status: 'onboarding_complete',
    onboarding_step: 'active',
    id_verified: false,
    didit_status: 'pending',
  };
  assert.equal(isHelperOnboardingComplete(freshSignup), false);
});

test('verified identity completes, via Didit or via the id_verified column', () => {
  assert.equal(isHelperOnboardingComplete(verifiedHelper), true);
  assert.equal(isHelperOnboardingComplete({ ...verifiedHelper, didit_status: 'pending', id_verified: true }), true);
});

test('each missing step blocks completion', () => {
  for (const key of ['email_verified', 'terms_accepted', 'profile_completed', 'contact_completed']) {
    assert.equal(isHelperOnboardingComplete({ ...verifiedHelper, [key]: false }), false, key);
  }
  assert.equal(isHelperOnboardingComplete(null), false);
  assert.equal(isHelperOnboardingComplete({}), false);
});

test('checklist hides only on the derived active step, never the raw flag', () => {
  const checklist = read(path.join(root, 'src', 'components', 'HelperOnboardingChecklist.jsx'));
  assert.ok(
    checklist.includes("status.onboarding_step === 'active'") && checklist.includes('return null'),
    'checklist must hide on onboarding_step active',
  );
  assert.ok(
    !checklist.includes('status.onboarding_completed) return null'),
    'checklist must not hide on the raw onboarding_completed flag',
  );
});

test('AuthContext wires helper flags from the derivation', () => {
  const ctx = read(path.join(root, 'src', 'context', 'AuthContext.jsx'));
  assert.ok(ctx.includes("import { isHelperOnboardingComplete } from '../utils/helperOnboarding'"));
  assert.ok(ctx.includes('helperOnboardingComplete = isHelper ? isHelperOnboardingComplete(user) : onboardingComplete'));
  assert.ok(ctx.includes('needsOnboarding = isHelper && !helperOnboardingComplete'));
  assert.ok(ctx.includes('canApplyToJobs = canBid') && ctx.includes('canBid = isHelper && helperOnboardingComplete'));
});

test('unverified helper gets the onboarding action, not the bid action', () => {
  const job = { id: 'job-one', client_id: '1', assigned_helper_id: '2', status: 'published', bid_count: 0 };
  const helper = { id: 2, role: 'helper' };
  const state = jobDetailView({ job, user: helper, bidsStatus: 'success', canApplyToJobs: false, needsOnboarding: true });
  assert.equal(state.action, 'onboarding');
  assert.equal(state.canSubmitBid, false);
});
