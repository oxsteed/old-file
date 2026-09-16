# OxSteed Restaurants Discovery Modernization

## Scope

Modernize `/restaurants` without changing existing restaurant ownership,
authentication, ordering, credit, or payment safeguards. The discovery page
must remain truthful to live restaurant data and must not advertise restaurants,
menus, prices, or fulfillment guarantees that are not present in the API.

## Current Checkpoint

The first discovery package is implemented in the source worktree:

- `GET /api/food/restaurants` now returns bounded pagination metadata with
  `total`, `hasMore`, and `nextOffset`, while retaining the existing array and
  `/food` compatibility helpers.
- Discovery supports allowlisted `recommended`, `rating`, `fastest`, and
  location-aware `distance` ordering.
- The page sends cuisine, search, location, sort, and offset filters to the
  server instead of filtering only the first client response.
- The page prevents stale requests from replacing newer results, deduplicates
  appended cards, and exposes loading, retry, empty, count, and end-of-results
  states.
- The discovery toolbar is keyboard accessible, exposes pressed category
  buttons, provides a sort select, and includes localized controls in English,
  Spanish, French, Haitian Creole, and Arabic.
- The request-building and page-merging logic is isolated in a pure client
  module so pagination behavior can be regression-tested without a browser.

## Evidence

- `server/__tests__/foodController.test.js` and
  `server/__tests__/restaurantPublicVisibility.test.js`: `46/46` passed,
  including pagination, sort, legacy-schema fallback, visibility, and
  credential-safety coverage.
- `client npm run test:restaurant-discovery`: `3/3` passed for normalized
  filters, invalid-filter omission, and duplicate-safe page merging.
- `client npm run test:restaurant-accessibility`: `1/1` passed for the
  discovery page’s keyboard and screen-reader semantic contract.
- `client npm run build:ci`: passed, including five-locale parity and page
  surface checks, all client regression suites, TypeScript, and the Vite
  production bundle. Existing chunk size and dynamic-import warnings remain.
- JavaScript syntax checks, locale JSON parsing, and `git diff --check` passed.
- Disposable Colima verification passed readiness `529/529`; isolated API
  checks confirmed bounded pagination, allowlisted rating sort, cuisine
  filtering, and removal of the internal `total_count` field. The isolated
  project and volumes were torn down after verification.
- Browser harness verification confirmed live count updates, cuisine filtering,
  search, sort selection, load-more from `24/33` to `33/33`, end-of-results
  messaging, and no browser diagnostics on the isolated page.
- Responsive browser checks at `390x844`, `768x1024`, and `1440x900` found no
  horizontal overflow; the grid rendered as mobile cards, two tablet columns,
  and five desktop columns. Keyboard verification covered mobile navigation,
  focus progression, and the sort control; the page exposed skip navigation,
  live regions, labeled controls, and the map disclosure state.
- A read-only isolated API probe completed `20` requests at concurrency `4`
  with bounded responses and a `410.15 ms` p95 (`702.78 ms` maximum) on the
  emulated local stack. Existing restaurant ordering, hours, visibility, and
  controller tests passed `57/57`.
- No production container, restaurant data, wallet, ordering state, or Credit
  activation setting was modified.
- Commit `b51fe89a` was pushed to `old-files-claude` through authenticated
  GitHub Desktop. GitHub Actions run `35082673547` then failed before deploy:
  the clean checkout did not contain ignored `client/dist/index.html`, so the
  server prerender suite reported `7` failures even though the focused suite
  and the complete local server suite passed. The deployment job was correctly
  skipped by that failure.
- The CI workflow was repaired to build the client before server tests, which
  supplies the prerender shell in clean checkouts without changing production
  runtime behavior. The deployment-wiring regression passed `32/32`, the
  workflow YAML parsed successfully, and `git diff --check` passed.

## Remaining Gates

1. Publish the CI-order repair and confirm the new Actions verification job
   passes, allowing the existing Coolify deploy gate to run.
2. Repeat read-only live API/browser checks after deployment and record the
   deployed release identity; production currently remains on the prior
   `content-ca49f8250bc2b53d` release.
