# Media reference layouts, 2026-10-10

## Scope

The signed-in and guest Media landing pages follow the supplied phone and
desktop references. They use the real OxSteed logo, warm cream surfaces,
orange actions, responsive navigation, neighborhood discovery, and separate
guest/signed-in layouts. Decorative neighborhood, storefront, and community
SVGs are new repository-native illustrations, not identical source artwork.
Profile photos and suggested Spaces come from real account/API data; no
reference photograph, fabricated Space, profile-completion percentage, or
engagement count is substituted for missing production data.

## Functional controls

- One shared location picker supports city/ZIP lookup, device location,
  profile location, and all locations. It persists the selected neighborhood,
  handles lookup errors, and supports Escape, focus restoration, and Tab trapping.
- Desktop search opens the real Media search route and submits its query.
  Late responses cannot replace newer results or a cleared search route.
- Home/Following/Nearby/My posts use the existing feed API. The new
  `GET /api/media/feed?tab=nearby` requires a location, filters geographically,
  preserves public-visibility/block/safety checks, and does not fall back to
  a global feed when geographic queries fail. Distant Space membership alone
  does not make a post Nearby.
- Saved, verification, compose, Spaces, creator marketplace, notifications,
  Inbox, account actions, theme/language preferences, and Ask AI use existing
  routes/services. Suggested Spaces join through the real membership API.
- Local businesses opens `/discover?type=business` with the selected city/state
  or device coordinates. Discovery and popular discovery accept additive type
  filters; business city/state filtering uses business service/address fields
  with the existing helper-profile location as a fallback. Filtering happens
  before result limits/pagination.
- Copy is present in English, Spanish, French, Haitian Creole, and Arabic in
  both legacy and namespaced catalogs. Existing dark-theme preferences remain.

Real PostgreSQL checks also exposed and fixed SQL token separation in the
shared business/restaurant visibility predicates, an absent helper-owner join
in locality ranking, and an enum/text comparison in discovery job search.

## Verification and boundaries

Local results: full client `build:ci` passed; 69 Media client checks passed;
the focused server run passed 33 tests; the broader Media server run passed
395 tests (125 opt-in database checks skipped); the explicit migrated PostgreSQL
discovery run passed all 26 checks. The Chromium suite covers 13 scenarios.

Verification commands are run from `client/` or `server/` as appropriate:

```sh
npm run build:ci
node --test scripts/mediaShell.browser-check.cjs
node --test scripts/media*.test.mjs scripts/restaurantMedia*.test.mjs
npx jest __tests__/mediaEntityVisibility.test.js __tests__/mediaFeedRanking.test.js __tests__/mediaFeedContext.test.js __tests__/discover.test.js --runInBand --forceExit
npx jest media --runInBand --forceExit
```

The real-database suite additionally requires an explicit
`MEDIA_DISCOVERY_TEST_DATABASE_URL` targeting an isolated migrated
`credit_statement_test` database. It exercises Nearby exclusions, local
business discovery without a helper profile, Spaces membership, feed cursors,
public profiles/search/linked cards, and existing safety behavior. No production
database is used. The temporary PostgreSQL container is removed after testing.

Browser checks render the actual React components in Chromium with synthetic
API responses: signed-in phone (434x1246), guest phone (390x668), and both desktop
variants (1312x816), plus five-language phone/desktop overflow checks. They check
location lookup/error recovery/reload, My posts/Following/Nearby, joining, search,
theme and language controls, and opening/closing Ask AI. This is interaction
evidence, not proof of real AI provider delivery or a human screen-reader pass.

The full Media server suite needs both FFmpeg and FFprobe paths on macOS.
Its initial Linux-default `/usr/bin/ffmpeg` run is not a valid local video
verification. Use `FFMPEG_PATH` and `FFPROBE_PATH` pointing to actual binaries;
do not weaken the dimension assertions or substitute a synthetic probe.

Deployment, real authenticated production journeys, live AI provider output,
and production uploads/publication remain separate live checks. This change
does not enable payouts or change Credit, Stripe, moderation decisions, or
production data.
