'use strict';

// Review P2-476 / P2-593 / P2-594 / P2-595 / P2-596: one source of truth for
// helper onboarding. Steps are derived from what the helper actually did
// (columns written by real flows and verification webhooks), not from
// users.onboarding_status, whose CHECK constraint allows only four values.
const db = require('../db');

const ONBOARDING_COLUMNS = `id, role, email_verified, profile_completed, contact_completed,
  terms_accepted, terms_accepted_at, terms_version, id_verified, identity_verified,
  didit_status, background_check_status, background_check_passed, onboarding_completed,
  onboarding_status`;

function isIdentityVerified(u = {}) {
  return Boolean(u.id_verified || u.identity_verified || String(u.didit_status || '').toLowerCase() === 'verified');
}

function identitySubmitted(u = {}) {
  return isIdentityVerified(u) || ['pending', 'in_review'].includes(String(u.didit_status || '').toLowerCase());
}

function backgroundState(u = {}) {
  const status = String(u.background_check_status || '').toLowerCase();
  if (u.background_check_passed === true || status === 'passed' || status === 'clear') return 'passed';
  if (status === 'failed' || status === 'consider') return 'failed';
  if (status) return 'submitted';
  return 'none';
}

function deriveHelperOnboarding(u = {}) {
  const steps = {
    email: Boolean(u.email_verified),
    terms: Boolean(u.terms_accepted && u.terms_accepted_at && u.terms_version),
    profile: Boolean(u.profile_completed && u.contact_completed),
    identitySubmitted: identitySubmitted(u),
    identityVerified: isIdentityVerified(u),
    background: backgroundState(u),
  };
  const missing = [];
  if (!steps.email) missing.push('email');
  if (!steps.terms) missing.push('terms');
  if (!steps.profile) missing.push('profile');
  if (!steps.identityVerified) missing.push('identity');
  return {
    steps,
    missing,
    // Listing and paid-tier access need a completed profile, recorded terms
    // consent and verified identity. Background checks are optional extras.
    complete: missing.length === 0,
    canAppearInSearch: missing.length === 0,
  };
}

// Prerequisites for each onboarding endpoint, in flow order.
const STEP_PREREQUISITES = {
  profile: ['email'],
  identity: ['email', 'profile'],
  background: ['email', 'profile', 'identitySubmitted'],
  finalize: ['email', 'terms', 'profile', 'identityVerified'],
};

function missingFor(step, onboarding) {
  return (STEP_PREREQUISITES[step] || []).filter((key) => !onboarding.steps[key]);
}

async function loadHelperOnboarding(userId, client = db) {
  const { rows } = await client.query(`SELECT ${ONBOARDING_COLUMNS} FROM users WHERE id = $1`, [userId]);
  if (!rows[0]) return null;
  return { user: rows[0], ...deriveHelperOnboarding(rows[0]) };
}

module.exports = {
  ONBOARDING_COLUMNS,
  STEP_PREREQUISITES,
  isIdentityVerified,
  deriveHelperOnboarding,
  loadHelperOnboarding,
  missingFor,
};
