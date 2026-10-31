// Helper onboarding truth, mirrored from the server derivation in
// server/services/helperOnboarding.js (deriveHelperOnboarding).
//
// General registration stamps onboarding_completed / onboarding_status
// 'onboarding_complete' for every mode at OTP verification, so those
// summary flags must NOT be used to report helper capability: they claim
// completion before identity verification lands. The auth payload columns
// (formatAuthUser) carry the real facts, so derive from them instead.
//
// Equivalence with the server derivation, for every writer path:
//   - terms: both registration flows write terms_accepted,
//     terms_accepted_at and terms_version together, so terms_accepted
//     alone is exact here.
//   - identity: every identity writer sets id_verified together with
//     identity_verified (Didit webhooks, Stripe Identity webhook,
//     superAdmin verify), so id_verified || didit_status === 'verified'
//     covers the server's id_verified || identity_verified ||
//     didit_status === 'verified'.
export function isHelperOnboardingComplete(user) {
  if (!user) return false;
  return Boolean(
    user.email_verified &&
      user.terms_accepted &&
      user.profile_completed &&
      user.contact_completed &&
      (user.id_verified || user.didit_status === 'verified'),
  );
}
