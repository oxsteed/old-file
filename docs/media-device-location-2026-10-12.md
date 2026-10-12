# Media device location recovery

## Cause and change

The public reverse lookup returned an empty city/state for synthetic Springfield
coordinates even though browser location permission was allowed. A saved custom
location containing only coordinates also skipped every startup lookup, leaving
desktop and mobile on a permanent generic label.

- Keep configured AWS/Google geocoding first. Empty results, provider failures,
  and unavailable configuration fall back to bundled city data, not a new remote
  service or paid account.
- Use `city-timezones` 1.3.4 (MIT), by Kevin Roberts:
  https://github.com/kevinroberts/city-timezones . The server-only dataset has
  7,329 city records. Ignore invalid zero-coordinate records and only return a
  city center within 25 km. It is not an administrative boundary lookup.
- Offline results include `approximate: true` and render as **Near city, region**.
  They never claim an exact address. Areas outside coverage remain unresolved;
  manual selection and profile selection remain available.
- Repair coordinate-only saved locations once on mount. Do not request browser
  permission again for that repair, and do not overwrite later user choices.
- Preserve approximation across reload and URL synchronization. Both navbar
  sizes and the neighborhood card continue using the shared location context.
- A manual device lookup with no city result keeps the dialog open, preserves
  the prior selection, and explains retry/manual entry. Browser permission,
  timeout, and unavailable-position errors remain distinct.
- No profile addresses, post location rules, deployment settings, credentials,
  or production data were changed. Coordinates remain rounded to three decimals
  in the Media client. The offline fallback sends no coordinates to a third party.

## Verification

- Focused geo controller and offline-city Jest suites: 18 tests passed.
- Device helper, Media discovery and location browser suites: 8 tests passed,
  including 390px/1366px coordinate-only recovery, reload, retry, failure messages,
  and delayed-result cancellation.
- Client `npm run build:ci`: passed, including typecheck, locale validation,
  production build and verification of 771 emitted assets.
- Deployment and real OS geolocation accuracy are not established by synthetic
  browser tests. The live endpoint must return a named location after deployment.
