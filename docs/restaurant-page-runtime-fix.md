# Restaurant menu hook-order crash

## Incident and repair (2026-10-03)

Production `/restaurants/r/2?tab=menu` displayed the generic error boundary.
Chrome reported Minified React error #310 in `FoodRestaurantPage-DHZmSQ0z.js`,
through `useMemo`. The dish suggestion memo ran below the loading/not-found
returns, so the loaded render called one more hook than the loading render.

Build the deduplicated suggestions as a plain render-time derivation. This
preserves the existing dish names, category labels, IDs, and search behavior.
The old memo depended on `allItemsFlat`, which is rebuilt every render, so it
provided no caching benefit. All remaining hooks in the main component precede
the loading/not-found returns.

## Regression coverage

`client/scripts/restaurantRender.browser-check.cjs` bundles the real page and
real SuggestDropdown with isolated service/shell dependencies, then runs Chrome
under React StrictMode. Service reads are controlled promises; unexpected writes
throw. Coverage includes:

- loading to a populated menu;
- case-insensitive deduplication across categories and uncategorized dishes;
- selecting a suggestion and searching another dish;
- navigation to loading/not-found, then back to a populated restaurant;
- no uncaught browser errors or error-boundary alerts.

The existing CI browser-test glob includes this regression.

## Verification

- Before the source repair, `node --test scripts/restaurantRender.browser-check.cjs`
  reproduced `Rendered more hooks than during the previous render`.
- After the repair, the same browser regression passed.
- `node --test scripts/restaurantAccessibility.test.mjs
  scripts/restaurantDiscovery.test.mjs scripts/learnRender.test.mjs` passed all
  five tests (the existing Learn SSR test emits expected useLayoutEffect warnings).
- `npm run build:ci` passed its source tests, localization, and TypeScript checks,
  but Vite failed on an existing Windows filename collision: extensionless
  `./SharedCartCard` resolves to `sharedCartCard.js` instead of `SharedCartCard.jsx`.
  This is unrelated to the restaurant repair. Linux CI must verify the complete
  production build after push.
- CI and deployed-page verification are pending at this pre-push checkpoint.
  A successful local test does not prove that production has the repaired asset.
