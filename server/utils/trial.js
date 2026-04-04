// server/utils/trial.js

const TRIAL_DURATION_DAYS = 90;

function getEffectiveTier(user) {
  if (!user) return 'free';
  if (user.membership_tier === 'pro') return 'pro';
  if (isTrialActive(user)) return 'pro';
  return user.membership_tier || 'free';
}

function isTrialActive(user) {
  if (!user?.trial_ends_at) return false;
  return new Date(user.trial_ends_at) > new Date();
}

function trialDaysLeft(user) {
  if (!user?.trial_ends_at) return 0;
  const diff = new Date(user.trial_ends_at) - new Date();
  return diff > 0 ? Math.ceil(diff / (1000 * 60 * 60 * 24)) : 0;
}

function trialDefaults() {
  return {
    trial_started_at: new Date(),
    trial_ends_at: new Date(Date.now() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000),
  };
}

module.exports = { TRIAL_DURATION_DAYS, getEffectiveTier, isTrialActive, trialDaysLeft, trialDefaults };
