# Restaurant directory alignment - 2026-10-27

The directory now uses the shared OxSteed surface, text, action, border, and
font tokens in both themes. Navigation, hero copy, search, browse headings,
and results use the same 1,200px container and responsive gutters.

The smaller hero illustration supports the search instead of dominating it.
Location and saved-search actions sit together below the search field. The
independent-restaurant disclosure remains visible below those controls. The
map toggle aligns with the restaurant heading and owner shortcut. Search
suggestions can extend beyond the hero without being clipped.

No strings, APIs, authorization, or location permission behavior changed.

## Verification

- `client/`: `npm run test:restaurant-discovery` passed 3 tests.
- `client/`: `npm run test:restaurant-accessibility` passed its existing
  keyboard/screen-reader markup contract check; this is not a human
  screen-reader acceptance test.
- `client/`: `npm run build:ci` passed, including TypeScript, localization,
  production compilation, and validation of 1,086 emitted assets.
- Repository `git diff --check` passed.
- Inspected the actual app in Chrome against a local synthetic restaurant API.
  Desktop navigation, copy, search, heading, and toolbar all started at x=117px
  in the current viewport. Checked 320px and 390px mobile widths, desktop light,
  mobile dark, and Arabic right-to-left rendering without horizontal overflow.
- Submitted a no-match search and cleared it to restore results. Location
  permission and live ordering were not exercised.

Local preview data is synthetic. Verify the deployed commit, readiness, and
published directory styles separately before claiming the change is live.
