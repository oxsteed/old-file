'use strict';

// Signup-only policy. Existing login/reset/change-password rules stay intact.
function isSignupPasswordValid(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) return false;
  return [/[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(rule => rule.test(value)).length >= 2;
}

module.exports = { isSignupPasswordValid };
