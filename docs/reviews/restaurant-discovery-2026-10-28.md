# Restaurant discovery - 2026-10-28

The small live directory repeated its only restaurant in Featured and All
restaurants, with an additional blank Recently viewed link. Public API data
reported `is_featured=false`. The frontend created a top-rated fallback shelf
and saved `restaurant.name` even though the public payload uses `display_name`.

## Resulting behavior

- One grid owns discovery results and pagination. Genuine featured placements
  have an inline badge; nearby results use distance order. Both retain the
  existing server sorting/visibility contract.
- One or two results use a compact desktop row; mobile retains a full-width
  card. Opening information, fulfillment options, and the address occupy
  separate readable lines. Theme tokens and RTL remain in use.
- Hours come from `hours_message_code` and `hours_message_params`, localized
  without converting the restaurant's wall clock to the visitor's timezone.
  Missing hours do not inherit the server's permissive default-open behavior
  as a claimed schedule. Manual pause/temporary closure takes precedence.
- Only configured public modes are named: pickup, delivery, dine-in. Explicitly
  disabled online ordering is visible. No unsupported fulfillment method or
  opening schedule is invented, and checkout validation is unchanged.
- Device location is requested only through Near me, which selects distance
  order. Clear location preserves the text/cuisine filter. Invalid coordinates
  are omitted, including nulls that previously converted to zero.
- Return shelves exclude already displayed restaurants; blank history entries
  are hidden and newly recorded restaurant views use the public display name.
- A directory error offers its own retry and suppresses the duplicate floating
  retry notice. The app continues observing the connection and protecting
  unfinished work from updates.

## Local verification

- `node --test scripts/restaurantDiscovery.test.mjs scripts/restaurantAccessibility.test.mjs`:
  8 passed, including hours/paused/unknown states, supported modes, genuine
  featured flags, bounded/zero coordinates and five-language catalog parity.
- `node --test scripts/restaurantRender.browser-check.cjs`: passed real
  restaurant loading/search/not-found recovery and the corrected history title.
- `npm run build:ci`: passed localization, TypeScript, production compilation
  and 1,099 emitted assets.
- The serial built discovery/connection/overlay run passed 3 tests, including
  25-result pagination without duplicate links, query/cuisine/location clearing,
  automatic distance ordering, API retry, empty results, unavailable device
  location, keyboard-focusable cards and separated metadata geometry.
- The discovery matrix covers en, es, fr, ht and ar; desktop/mobile,
  light/dark, and both Arabic viewport sizes. Initial discovery does not load
  MapLibre. Screenshots were visually reviewed and the compact row's inherited
  cover margins were corrected before publication.
- `node scripts/growthInstrumentation.mjs --check`: 2,666/2,666 controls named,
  zero files needing annotation. The added key is the clear-location action;
  no location values are added to telemetry.
- `git diff --check`: passed.

## Publication boundary

The baseline public Chrome check at commit `6a0b8298` loaded
`/assets/main-CIwYIuDH.js`, showed one main landmark and three restaurant links
to `/restaurants/r/2`. Public API fields matched the controller's contract.
Local checks above do not establish publication; exact deployment identity,
readiness and the live card/count must be checked after pushing this package.

The broader navigation work still needs workspace-panel splitting and measured
cold/warm transitions. A pre-existing font URL warning also remains under the
shared-design audit; these discovery checks do not claim it was repaired.
