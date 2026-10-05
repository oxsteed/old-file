# Frontend reference and interaction regression repair

Date: 2026-10-05. Baseline: `e0d1cf3478871ece8b0b5ec0eb87b0fa4e40755b`.

## Scope

- Consulting intake's select-all handler now uses `SETUP_ITEMS_GROUPED_KEYS`,
  the existing stable-ID catalog, instead of an undefined name.
- Business Owner dashboard imports its existing Lucide `TrendingUp` icon.
  The `businessHubGrowthTools` flag remains false; no hidden product is enabled.
- Add a bounded TypeScript binding check for undefined references and direct
  same-scope reads before lexical initialization to `prebuild:ci`.
- Add four unit tests for the check and browser regressions for the actual
  business/consulting components. Existing CI globs automatically execute the
  new `.test.mjs` and `.browser-check.cjs` files.

The check is not full JavaScript type inference or comprehensive hook-order
linting. Deferred captures are allowed. It supplements the existing typecheck,
localization, build, asset, and browser checks rather than replacing them.

## Evidence

Comparison with the fetched GitHub baseline still found the missing icon at
`BusinessOwnerDashboard.jsx:548` and undefined catalog at
`ConsultingIntakePage.jsx:320`. The same scan with the two pending fixes found
neither defect. Previous isolated browser reproduction failed before those
fixes; both regression scenarios passed on recheck on October 5.

Current local validation:

- Client smoke tests: 342 passed, none failed or skipped.
- Browser batch: six passed, none failed, two existing authenticated checks
  skipped for unavailable environment configuration.
- Reference check: 832 source files, zero findings; four checker tests passed.
- `npm run build:ci`: passed, including localization, typecheck, production
  build, and validation of 700 emitted assets.
- Business coverage: service, restaurant, mixed, empty, and failed portfolios
  with both growth branches represented using fixture-only launch settings.
- Consulting coverage: select all, deselect all, partial selection, and advance
  to the package step in English, Spanish, French, Haitian Creole, and Arabic.

Browser tests stub external APIs and do not submit production intakes or modify
production accounts. Permissions, server APIs, financial behavior, prices, and
launch scope are unchanged. Unrelated audit reports, PDFs, screenshots, and
temporary rendering files are excluded from this release.

GitHub verification results must be checked independently; these local results
do not claim authenticated production journeys or a live deployment has
completed.
