# Restaurant checkout CI repair - 2026-10-05

## Observed failure

GitHub CI run [37293929719](https://github.com/oxsteed/old-file/actions/runs/37293929719),
at revision `e81f3a34bad9505769e369730216d9ad542e199e`, failed at
Client browser regression tests. The two preceding runs had the same error:
the restaurant page imports `listSavedPaymentMethods`, but its browser-test
API fixture did not export that newly added function. The real food API does.

The original restaurant browser test reproduced that bundling failure locally.
Broader local verification also identified an undefined `t` in
`CheckoutCardForm`, reachable once saved payment methods load.

## Scoped correction

- Add `listSavedPaymentMethods` to the existing read-only restaurant API fixture.
- Initialize `useTranslation()` inside the actual checkout card component.
- Add a browser regression extracting the real component, verifying saved-card
  loading, selection, switching back to a new card, express-control rendering,
  and graceful recovery when saved-card retrieval fails.

The new saved-card regression failed before the hook correction and passed
afterward. It uses synthetic data and inert Stripe controls; no live payment,
account, API write, price, entitlement, or payment authorization is changed.

## Local verification

- Existing browser-check batch: 5 passed, 2 existing authenticated checks skipped
  because their environment was not configured.
- Client smoke batch: all 342 tests passed.
- New saved-card regression and existing restaurant browser regression: both passed.
- `npm run build:ci`: passed, including localization, type checking, production
  build, and emitted-asset validation. The local workspace also contains pending
  unrelated fixes, so the fresh GitHub run is the authoritative clean-revision check.
- `git diff --check`: passed.
- Full local server suite: 379 suites passed, 3 suites skipped, 1 suite failed;
  4098 tests passed, 46 skipped, 3 failed. All failures were in the existing
  video tests requiring `/usr/bin/ffmpeg`, which is absent on this Mac. GitHub
  CI already explicitly installs FFmpeg before running those tests. No video
  tests were weakened or skipped to accommodate this local dependency gap.

Migration rehearsal and production deployment are not inferred from local
frontend test results. Existing pending audit files and business/consulting
changes are not included in this repair.
