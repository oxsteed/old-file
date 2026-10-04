# Checkout CI regression repair - October 4, 2026

## Failure evidence and repairs

- Run `37201993106` at `628e2841` failed in the restaurant browser
  regression because the fixture lacked five newly imported checkout and
  restaurant-credit API functions. The fixture now exports them with fail-fast
  stubs: this read-only test must not initiate payments or top-ups.
- Once the fixture compiled, it reproduced a real restaurant-page exception:
  `Cannot access 'cardPaymentsReady' before initialization`. The readiness
  calculation now precedes the effect dependency array that reads it, including
  on initial loading and restaurant changes. Stripe eligibility is unchanged.
- Run `37201930794` at `8174621c` failed because a visibility test counted
  exactly seven SQL fragments. The new card-payment endpoint added an eighth.
  Assertions now cover each of nine discovery/payment handlers by name,
  including the directory's dynamically assembled filters. A request-level
  test also confirms an unavailable restaurant returns 404 without calling
  Stripe, and that its lookup contains the admin visibility predicate.
- Local macOS production builds exposed an ambiguous extensionless import:
  `SharedCartCard.jsx` was resolved to the similarly named `sharedCartCard.js`
  utility on a case-insensitive filesystem. The component import is now
  explicit, with a regression check. No file renames or product behavior changes
  were required.

## Verification

- Focused server tests: 2 suites, 36 tests passed.
- All client smoke tests: 325 tests passed.
- Client browser checks: 3 passed; 2 authenticated checks skipped because no
  isolated authenticated test environment was configured locally.
- `npm run build:ci`: passed, including localization, TypeScript, production
  bundling and validation of 696 emitted assets.
- Server regression after `npm ci`: 372 suites / 4,017 tests passed, with
  3 existing suites / 46 tests skipped. The local command excluded the video
  suite (`--testPathIgnorePatterns=restaurantMediaVideo.test.js`) because it
  requires Linux `/usr/bin/ffmpeg`. The existing GitHub workflow installs that
  dependency and still runs the complete suite; no CI tests were disabled.

The unrelated audit sources, PDF reports and temporary files are deliberately
excluded from this repair. CI success does not certify authenticated production
flows, payment activation, or deployment health.
