# Restaurant operations desk

The operations page at `/restaurants/merchant?tab=operations` now puts floor
tools first, separates low-stock and corrective-action alerts from the tool
catalog, and supports searching tool names, descriptions, and groups. Counts
remain visible alongside descriptions rather than replacing them.

An open tool has grouped desktop navigation and a mobile tool selector. The
existing `ops` query, restaurant selection, and permission filtering remain
authoritative. Keyboard focus moves into the selected workspace and returns to
the catalog when choosing All tools.

Screens, host stand, HQ, brand HQ, accounting, store hub, and reports mount on
first visit, then remain mounted to preserve local state while switching tools.
The five panels that supply overview statistics still load on entry. Previously
visited tools can continue background activity; this change does not suspend
their polling or reduce the JavaScript bundle. Draft retention covers tool
switching within this mounted restaurant workspace, not refreshes or sign-outs.

## Verification

- `npm run build:ci` passes, including localization, type checking, production
  compilation, and verification of 1,124 emitted assets.
- `node --test scripts/merchantOperationsDesk.test.mjs scripts/merchantOperationsDesk.browser-check.cjs`
  passes all three tests, including the browser journey: search and empty state,
  direct navigation, inventory draft retention, deferred report date retention,
  mobile switching, focus return, role-restricted deep links, refresh, restaurant
  switching, and Arabic mobile layout. The fixture verifies that unopened screen,
  report, accounting, and HQ endpoints receive no requests.
- `node scripts/growthInstrumentation.mjs --check` passes with complete control
  coverage and matching client/server registries.
- All twelve new strings match between legacy and namespaced catalogs for
  English, Spanish, French, Haitian Creole, and Arabic.
- Desktop light/dark, mobile, and Arabic screenshots were visually reviewed.
  Browser evidence uses synthetic restaurant data, not production accounts.

The browser test accepts `ARTIFACT_DIR`; its default is a writable operating
system temporary directory. A successful build and local browser checks do not
establish production deployment or real-world navigation timings.
