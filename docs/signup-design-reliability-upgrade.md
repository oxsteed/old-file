# Signup design and reliability upgrade

`/join` and the native Media signup dialog use the same grouped form, followed
by email verification. The standalone desktop page has a benefit introduction;
mobile shortens it, and Media omits it and the nested navigation/footer. The
existing OxSteed SVG logo and launch-mode catalog remain the sources of truth.
No authentication iframe, role redesign, production account changes, or
database migration is introduced.

## Registration policy and compatibility

- **All new registration requests**, including older clients calling
  `/api/auth/register/start`, must send `ageConfirmed: true` as a boolean.
- Signup passwords must be 8–128 characters and contain at least two of
  uppercase letters, digits, and symbols. Passwords are not trimmed.
  Existing login, reset-password, and change-password policies are unchanged.
- Terms/Privacy consent and age consent are separate controls. No age consent
  is inferred from a legacy draft. Draft storage never includes the password.
- Phone formatting, country-aware required regions/postal codes, and limits
  match signup server validation. Code regions uppercase; named regions retain
  their casing through verified account creation.
- Helper verification and Business onboarding destinations are unchanged.
  Selecting a mode grants no new permission or eligibility bypass.
- Email existence is not probed or advertised as available. Submission handles
  duplicate email with a Sign in recovery link.

## Additive API metadata

Existing HTTP statuses and `error`/`fields` remain. Registration endpoints add
distinguishable `code` values: `validation_failed`, `email_registered`,
`registration_failed`, `registration_token_required`, `registration_expired`,
`otp_required`, `otp_invalid`, `otp_expired`, `otp_locked`, `resend_cooldown`,
`otp_send_failed`, and `verification_failed`, as applicable.

Start returns `registrationExpiresAt`. Code send/resend and incorrect-code
responses include `registrationExpiresAt`, `otpExpiresAt`, and
`resendAvailableAt`. Cooldowns include `retryAfterMs`; lockouts include
`lockoutUntil` and `retryAfterMs`. The server remains authoritative. Older
responses still produce localized, safe recovery instructions.

The UI prevents duplicate operations, persists deadlines with the password-free
draft, and supports OTP paste and `one-time-code` autofill. Ordinary edit-details
keeps in-memory input. Expired-registration restart retains contact/address
fields but clears stale registration/code state and requires a fresh password
and age confirmation. Restart renews pending registration expiry but does not
reset an active lockout or resend deadline. Accept-terms can no longer bypass
those protections. No existing accounts are modified.

## Verification

- Focused server: `npm test -- --runInBand __tests__/signupReliability.test.js
  __tests__/authLoginContract.test.js __tests__/auth.test.js`.
- Signup unit/catalog checks: `npm run test:signup-validation` (included in
  `prebuild:ci`).
- Signup Chromium: `node --test scripts/signup.browser-check.cjs`.
- Existing Media Chromium: `node --test scripts/mediaShell.browser-check.cjs`.
- Client gates: `npm run build:ci` including translations, TypeScript, build,
  and emitted asset checks.

Browser services and submitted data are synthetic. Tests cover 320px, 390px,
768px, and 1366px in standalone/dialog layouts and both themes, Arabic/RTL,
200% zoom-equivalent reflow (1366px to 683px), focus restoration, account-mode
presets/referrals/routing, explicit consent, legacy drafts, server field errors,
duplicate email, OTP paste/reload/recovery, lockouts, and single-flight resend.
Screenshots are inspected separately. Automated browser checks do not constitute
a human screen-reader or real-device OTP-autofill session.

Passing local tests does not establish CI completion or production deployment.
Verify the deployed `/join` and Media signup UI without submitting credentials;
report local checks, GitHub CI, and deployment independently.

Local results on 2026-10-11: 68 focused server tests, 4 signup unit/catalog
checks, 3 signup browser scenarios (including the viewport/theme matrix), and
13 existing Media browser tests passed. `npm run build:ci` passed; the final
production rebuild and validation confirmed 768 emitted assets. Actual built
`/join` previews at 390px and 1366px had three account choices, unchecked age
consent, correct Helper URL preset, no auth iframe, no horizontal overflow,
and no browser runtime errors. Light/dark and Arabic screenshots were reviewed.
No production account or real credentials were submitted.
