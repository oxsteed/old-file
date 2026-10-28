# OxSteed eight improvements goal

User authorization: complete all eight improvements proposed in this chat.
Started 2026-10-27. The Codex goal remains active until all outcomes below are
implemented and verified. Earlier changes are starting evidence, not completion
of the broader requirements. Preserve unrelated work and all accounting,
authorization, privacy, deployment-secret, and production-data safeguards.

## Requirements and acceptance matrix

| # | Improvement and required outcome | Evidence required for completion | Current state / next action |
| --- | --- | --- | --- |
| 1 | Deploy without interrupting users: keep the current app serving until its replacement is ready; retain a working release when a candidate fails. | Isolated successful and failed promotions; production transition sampled for HTML, readiness, and representative reads; correct release identity; storage, session, realtime, shutdown, and worker continuity. | In progress. Package 5 makes six post-listen workers drain through the shared runtime before dependencies close. Compose still stops the old app before replacement; cron callback ownership, safe worker isolation/handoff, mounted release metadata and candidate routing/rehearsals remain required. |
| 2 | Smoother navigation: retain usable navigation while route content loads, avoid downloading unrelated screens and large inactive workspace panels, and measure real transitions. | Bundle comparison, cold/warm route timing, delayed-chunk/recovery checks, correct mode/authorization behavior, and representative live navigation. | Partial: dashboard modes are split, ordinary route loading keeps navigation, and providers avoid customer discovery downloads. Six workspace editors now load on demand, reducing additional static JavaScript from 263,445 to 171,809 bytes. Built-app desktop/mobile RTL checks cover delayed profile navigation, cancelable dialogs and team editor gating. See `reviews/workspace-navigation-2026-10-28.md`. Next: green PR CI, publication and real production cold/warm timing; complete chunk-failure recovery and wider navigation audit. |
| 3 | Homepage follows the active mode: business activity for owners, work for helpers, discovery/bookings for customers. | Customer, Helper, Business Owner, and supported team-mode browser checks; logged-out discovery remains useful; authorized destinations; five-language parity. | Implemented in package 2: operational home uses the existing mode dashboard behind the existing verification/error boundaries, while customers/visitors retain discovery and customers get a bookings shortcut. Fourteen built-app role/viewport cases pass, including Arabic and active navigation. Await publication and cross-check transient authentication recovery under item 7 before final acceptance. |
| 4 | Consistent design across Food, Direct, Messages, and business workspaces: headers, spacing, buttons, forms, and loading states. | Shared component/token adoption and desktop/mobile, light/dark, keyboard, and Arabic rendering across all four surfaces. | Partial: restaurant alignment and shared ordinary-route loading are implemented. Shared font URLs now resolve to real fingerprinted assets in public/admin builds; ten desktop/mobile RTL cases across Food, Direct, Messages and workspace pass. See `reviews/font-assets-2026-10-28.md`. Next: green PR CI and publication; consolidate remaining headers/forms/spacing/theme use and audit keyboard/landmarks. |
| 5 | Clear restaurant discovery: location, opening hours, ordering options, and a useful small-inventory layout without repeated restaurant shelves. | Real-data contract checks, location/filter and empty-state behavior, accurate hours/fulfillment labels, pagination and no-duplicate shelf checks, and live directory verification. | Implemented and live verified in package 4: one grid, compact small-result layout, real featured badges, localized server hours and configured public ordering modes. Near me sorts by distance; clearing location retains search/cuisine. Five-language functional/visual checks and live API/card comparison pass. The CI browser fixture's typeahead/result-request race is corrected; remote recheck is pending. |
| 6 | Business workspaces lead with today's bookings, unanswered messages, overdue invoices, and required tasks; detailed analytics are secondary. | Ownership/team-permission scenarios, authoritative counts, task destinations, empty/error/loading states, and responsive browser checks. | Not complete. Inspect workspace overview data and existing attention services; retain financial/account/currency separation. |
| 7 | Reliable sessions and unfinished work: investigate unexpected sign-outs and preserve work during transient outages, reconnects, and updates. | Expired versus transient refresh cases; resume/update/navigation/reload with drafts; account-switch isolation; concurrent-tab behavior; no stale private data or financial replay. | Package 3 fixes temporary bootstrap/refresh failures being treated as sign-out. Unverified sessions retain the destination with a localized retry; verified forms remain mounted. Nine browser checks cover expiry, two tabs, text/photos, stale verification and no financial replay. Next: published recovery checks and remaining cross-tab expiry/account-change races, including the Axios expiration event boundary. |
| 8 | Less persistent screen clutter: connection, AI support, update notices, and cookie controls do not compete with primary actions. | Online/offline/reconnecting and recovery checks; checkout/dirty-work update deferral; support/cookie/update combinations; mobile keyboard and desktop/RTL clearance; accessible recovery controls. | Package 2 implements critical-work/edited-form/cart deferral, modal/cookie priority, launcher/action-bar clearance, and offline/keyboard launcher suppression. Browser geometry and real draft-update/reconnect checks pass. Await published runtime verification; retain the wider unfinished-work/session audit under item 7. |

## Execution and evidence rules

1. Work in coherent packages, keep all eight requirements intact, and record
   source, test, browser, CI, and live evidence separately.
2. Use the actual default branch and preserve unrelated local work. Commit and
   push completed packages through PRs, require all four CI jobs to pass, and
   use merge commits as required by `deployment-ci.md`. Group changes to avoid
   needless production restarts.
3. Run relevant behavioral tests. Browser changes require `client/`'s
   `npm run build:ci`; deployment scripts use the repository's Node tests.
4. Rehearse infrastructure changes with disposable resources. Preserve the
   existing database, Redis, uploads, backups, persistent asset store, and
   deployment provenance. Do not expose or copy secrets into output.
5. A production health check, a passing test, or a local bundle improvement alone
   does not prove the entire requirement. Missing live or authenticated evidence
   remains explicitly incomplete.
6. Update this matrix with evidence and the next exact action as work proceeds.

## Starting observations

- Current checkout on 2026-10-27: `cc9b612b`, clean `old-files-claude` tracking
  `origin/old-files-claude`; repository identity verified with `gh repo view`.
- Live app and ClamAV containers are healthy in Docker context `colima`.
- Coolify application UUID: `tdrapz1vvcoftfwsk7fcdq0h`. The latest completed
  deployment reports source commit `cc9b612b12d4700a0a04f29c461185a66bf1dcff`.
- Coolify documents that Compose applications do not use its rolling replacement
  path: <https://coolify.io/docs/applications/deployments/rolling-updates>.
  Converting the build type alone is insufficient: replacement readiness,
  compatible migrations, shared state, and worker overlap must be verified.

No item is marked complete at goal creation.

## Package 1 - goal setup and quiet healthy connections

- Added this full acceptance matrix and `deployment-continuity-plan.md`, with
  verified live configuration, storage names, worker-overlap concerns, and the
  exact remaining migration/rehearsal sequence. Production configuration has
  not been changed.
- `PwaRuntime` no longer renders or reserves bottom space for a healthy
  connection. Offline/reconnecting status and retry remain visible; dependency
  observation, account refresh, resume coalescing, and draft recovery remain
  active. Display routes retain their dedicated connectivity UI.
- Updated installed-mode recovery assertions to require the healthy overlay to
  disappear, and added the focused browser regression to `test:pwa:browser`.
- Reinstalled the locked client dependencies with `npm ci`; local Vite was
  6.4.3 despite the lockfile's 8.3.5. Verification below uses locked Vite 8.3.5.
- `node --test scripts/connectionNotice.browser-check.cjs scripts/pwaContinuity.test.mjs`:
  7 passed, including retry, unchanged typed notes, and restored layout space.
- `npm run test:pwa:browser`: 4 passed.
- `node --test --test-name-pattern='desktop Chromium|Android-sized Chromium' scripts/pwaInstalledMatrix.installed-check.cjs`:
  2 passed against the built app, including draft/photos, offline/reconnect,
  checkout notes, sharing, and session recovery. WebKit was not run in this
  selected check.
- `npm run build:ci`: passed, including localization, TypeScript, production
  compilation, and validation of 1,098 emitted assets.

This package is partial progress. None of the eight broad requirements is yet
accepted as complete; live publication/CI evidence is separate from these checks.

## Package 2 - mode homepages, loading, and overlay coordination

- `ModeHomeRoute` chooses a mode before importing its page. Providers reuse the
  existing role dashboard and its authorization/verification/error boundaries;
  customer discovery code and location effects do not run for those routes.
  Customer mode remains discovery even with an older helper role value.
- Customer discovery links directly to bookings. Existing translated strings
  are reused; no untranslated production copy was introduced.
- Operational homepages highlight Dashboard/My Work in desktop and mobile
  navigation. The shared localized loading state keeps ordinary navigation
  available, respects reduced motion and theme tokens, and leaves immersive
  display/media routes with their dedicated layout.
- Waiting updates remain available without interrupting critical routes, active
  restaurant carts, edited/focused fields, cookie controls, or modal workflows.
  Guards contain no field values. Explicit updates recheck protection before
  activation; restored carts and critical paths also block silent startup
  activation.
- Healthy browsing remains quiet. Recovery controls take priority over the AI
  launcher; cookie banners and floating restaurant-cart actions publish enough
  space for notices. Coordinate observers run only when notices need them.
- Registration/safety, route/mode, and navigation unit checks pass. The full
  client `npm run build:ci` passes with 1,099 emitted assets.
- `npm run test:pwa:unit`: 35 passed.
- `npm run test:pwa:browser`: 5 passed after serializing browser files with
  `--test-concurrency=1`. A prior parallel run had two 30-second test timeouts;
  the serial run keeps the same assertions and timeout limits and passes in
  about 20 seconds.
- `npm run test:home-mode-browser`: passed 14 real built-app mode/viewport
  combinations, including Arabic mobile customer/helper/owner views, correct
  active navigation, no viewport overflow, and no customer HomePage download for
  provider modes. A delayed discovery chunk retained navigation and one main
  landmark. Logged cold times are synthetic functional-run diagnostics under
  concurrent host load, not production performance or a before/after benchmark.
- Installed-mode recovery checks passed desktop and Android-sized Chromium and
  iPad-sized WebKit. The update test now proves deferral while editing, activation after
  leaving the workflow, then restoration of draft text and photos; reconnect,
  checkout notes, sharing, and real-expiry account isolation remain covered.
- Package 1 remote CI (`40592469444`, commit `79e21933`) passed client build,
  browser and installed-mode checks. The overall run failed one server source
  scan: `p2-session-direct-schema.test.js` reports the existing
  `services/creditCompliance/amlRules.js` sessions query. It had 911 passing
  server suites and one failure. This is separate from package 2 validation;
  no server source changed in either experience package.

Remaining work: requirements 1, 2, 4, 5, 6, and 7 still require implementation
and acceptance evidence. Requirements 3 and 8 require publication verification
and their final cross-cutting recovery audit. The overall goal remains active.

## Publication of package 2

- Pushed `1c48a170` to the verified default branch. Coolify deployment
  `qjuvphuzxjxe1ifvv1a5pazl` reports that exact commit finished; public `/ready`
  returned ready with all checks passing.
- A fresh public Chrome tab loaded `/assets/main-D6FRd8pm.js`; after accepting
  the waiting update on the safe homepage, it showed one main landmark, no
  company card, no healthy connection badge, and no repeated update prompt.
  Navigation to the restaurant directory succeeded. This public check does
  not replace the synthetic authenticated mode matrix with live account proof.
- CI `40597490276` stopped at the instrumentation registry check. Its route
  scanner omitted `HomePage` when supplied as `DiscoveryPage={HomePage}` rather
  than a JSX tag. Package 3 fixes that graph traversal and retains the existing
  key registry; no tracking keys or telemetry payloads were added.

## Package 3 - temporary session failure recovery

- Bootstrap no longer treats a timeout, throttling, or unavailable identity API
  as a signed-out session. The current destination remains behind verification,
  with a retry screen translated in both catalogs for all five required
  languages. A browser-stored profile is never used as authentication proof.
- A verified user keeps their mounted form when an explicit session refresh
  fails temporarily. Real authentication rejection still clears account state.
  Verification failures carry the existing account epoch so an older request
  cannot clear a newer verified identity in the provider.
- Resume/retry rechecks an unverified session as well as an authenticated one.
  The full-page recovery action suppresses the duplicate connection badge;
  update safety and the shared connection lifecycle remain active.
- `npm run test:session-recovery`: 9 passed using real AuthProvider/Axios and
  the built app. Coverage includes cookie rotation/legacy migration, password
  and passkey sign-in, 408/429/503 refresh preservation, real expiry, a stale
  verification rejection, two-tab outage/retry, saved draft text/photos, an
  unsent edit through reconnect, account isolation and no financial-write replay.
  The fault is injected at the synthetic API server so the service worker
  cannot bypass it; an earlier page-interception version did not exercise the
  outage and was corrected.
- The instrumentation scanner now follows capitalized component references
  through route props. Its two regression tests pass, and `--check` reports
  2,665 of 2,665 eligible controls named, zero files needing annotation, and an
  unchanged key registry. The session retry action is explicitly private.
- Final `npm run build:ci`: passed, including the new scanner regressions,
  localization, TypeScript, production compilation and 1,099 emitted assets.
  The final built-app recovery, connection-notice and overlay geometry check
  run passed all three tests serially in about 19 seconds. Publication and
  remote CI evidence remain separate from these local checks.

This package addresses a concrete recovery bug. It does not complete the wider
session/account race audit or the remaining eight-part goal.

## Publication of package 3

- Coolify deployment `oeuzh9meqtmgq5n9fekfykkg` finished at exact commit
  `6a0b8298`. Public readiness returned ready with every check passing. A public
  Chrome tab loaded `/assets/main-CIwYIuDH.js` and the restaurant directory with
  one main landmark and no healthy connection overlay. A real production
  outage was not induced to test the retry screen.
- CI `40598866454` passed client build, browser checks (including homepage and
  session recovery), installed-mode recovery, and the instrumentation registry
  check. Its sole server failure remains the existing session-source scan of
  `services/creditCompliance/amlRules.js`: 911 server suites passed, one failed,
  16 skipped. Overall CI is not green.

## Package 4 - clear restaurant discovery

- Replaced repeated Featured/Nearby shelves with one deduplicated, paginated
  result grid. A genuine active featured placement keeps its badge and click
  tracking; ratings alone no longer create a Featured claim. The redundant
  featured-list request is gone. Small result sets use a compact desktop row.
- Cards display localized server-evaluated opening/next-opening information,
  respect manual pauses/temporary closure, and show configured takeout,
  delivery, and dine-in modes. Missing schedules say hours are not listed;
  internal kiosk mode is not advertised as a public fulfillment option.
  Server ordering/payment validation is unchanged.
- Near me explicitly selects distance order. Clearing location removes device
  coordinates and distance order while preserving the query and cuisine.
  Missing/out-of-range coordinates no longer become an unintended zero point;
  an explicit valid zero coordinate remains supported.
- Recently viewed entries now record `display_name`, omit blank titles and
  omit restaurants already shown. Small markets have no repeated history or
  reorder shelves; prior-order responses cannot repopulate a switched account.
- A visible directory error with its own retry suppresses the competing global
  connection badge; shared connection observation and update protection stay
  active. The new location control has one registry key in both client/server
  catalogs. Five-language new-copy parity is verified.
- Public API/source contract checks confirmed one listed restaurant, configured
  pickup/dine-in/kiosk modes, a valid server hours code and parameters, and
  `is_featured=false`. Before publication, the public UI nevertheless showed
  three links to that same restaurant, including a Featured shelf and a blank
  history entry. See `reviews/restaurant-discovery-2026-10-28.md` for evidence.

Package 4 publication was verified below. Requirements 1, 2, 4, 6,
and the remaining session/overlay acceptance work remain open; the full goal
has not been reduced or completed.

## CI session-reader classification repair

- The repeated CI failure came from treating the historical AML device-linkage
  aggregate as an authorization query. Limiting that evidence to valid/live
  sessions would lose revoked-session history. Runtime AML and authentication
  code were not changed.
- The session scan now names that single audited historical reader explicitly,
  checks that it still has exactly one session read, and retains the dual-flag
  requirement for every other reader. A separate monitoring regression checks
  the 30-day/IP scope, absence of live-session flag predicates, case creation,
  empty results, and absence of session writes.
- Targeted Jest validation: `p2-session-direct-schema.test.js`,
  `amlSessionHistory.test.js`, and `oxsteedCreditCompliance.test.js`: 3 suites,
  40 tests passed. This is a unit/query-contract check, not a new live financial
  exercise or PostgreSQL integration claim. Full remote CI remains pending.

## Package 4 publication - 2026-10-28

- Pushed the discovery change (`438354c1`) and CI classification repair together
  at `fb59a317`. Coolify deployment `j3ibtx6ohbq9a0wepzfe7qox` finished at that
  commit. Public readiness reports ready with all checks passing.
- Public Chrome loads `/assets/main-CK_F6due.js`, has one main landmark, one
  compact restaurant card and exactly one link to restaurant 2. The former
  Featured and blank history duplicates are gone. Card copy reads
  `Opens at 8:00 AM` and `Takeout · Dine in`, matching the current public API
  structured hours and configured public modes. A live screenshot was reviewed.
- Release provenance still needs repair under requirement 1: `/ready` reports
  `content-8451b87cccd3f9a4` with null Git SHA/image/deployment metadata. The queue
  commit plus changed live entry/behavior establishes this publication check;
  it is not a claim that runtime commit provenance is complete.
- CI `40663239667` failed one client browser assertion: it sampled the last
  restaurant endpoint request, which can be the unfiltered `limit=10`
  autocomplete call. The test now inspects `limit=24` result-grid requests and
  additionally asserts the active cuisine remains visible. The corrected full
  five-language discovery matrix passes locally. The full remote run stopped
  before server verification, so the server scan repair is not yet remotely
  confirmed.

## Package 5 - owned auxiliary worker drains

- Six post-listen workers now use a drainable poller: restaurant/Media
  transcode, Media cleanup, abandoned recovery, Direct draft cleanup and chat
  payment-request expiry. Stops cancel future/queued ticks synchronously and
  await active work; restart is refused during drain. Batch workers stop taking
  another job after shutdown is requested. Existing enablement, quarantine,
  scheduling intervals and delayed recovery startup remain in place.
- `auxiliaryWorkers` registers each stop handle before starting it. Existing
  `BackgroundWorkers.stop()` invokes all those stops before awaiting them;
  `ApplicationRuntime` keeps the pool/Redis/realtime resources open until they
  settle. Partial startup is owned too. Shutdown still has the existing
  process-level 15-second deadline; this does not establish unlimited graceful
  completion of long transcodes or safe overlapping worker replicas.
- Targeted validation: 9 Jest suites passed, 60 tests passed, one real-FFmpeg
  rendition test excluded from the selected check. Tests cover actual service
  exports, stop/restart/error/delayed-start behavior, dependency drain ordering,
  a real sweeper waiting on its storage pass, and existing media/cleanup gates.
- The excluded rendition test was also run with a temporary copy of the
  unchanged committed worker. It reproduces the same local static-FFmpeg
  mismatch (1280x720 versus expected 960x720); temporary files were removed.
  It remains an explicit local limitation, not a passing test. Default
  `/usr/bin/ffmpeg` is absent on this Mac; the focused run uses the verified
  user-local binary. `node --check server/index.js` and `git diff --check` pass.
- The discovery CI fixture correction is included without changing production
  filter behavior. Runtime worker topology, production configuration and
  financial activation controls have not been changed.

Next on requirement 1: finish cron/in-flight and per-process refresh ownership,
choose and rehearse safe worker/web separation or handoff, repair mounted release
identity, and test candidate promotion/failure before changing live routing.
This remains a prerequisite package; uninterrupted deployment is not complete.

## Package 6 - mounted release identity

- Provision release records into the actual verified read-only metadata volume,
  including Coolify's application prefix. Reject foreign, duplicate, or writable
  mounts. An explicit full container ID supports candidate-specific records;
  automatic discovery still refuses overlapping app containers.
- Include the backup adapter's missing restore-verification profile module in
  the installed host bundle. Portable metadata/reconciliation tests now run in
  the existing deployment-command CI step.
- All 39 related Node tests passed. An opt-in Docker rehearsal passed with two
  disposable containers on a dedicated prefixed volume, proving idempotency,
  ambiguity rejection, and independent records. Fixture resources were removed.
- Production check mode now derives all three identity fields from the current
  app and accepts its actual mount. No live metadata write or host installation
  has been performed yet. Require green PR CI before applying and checking the
  public readiness fields. Deployment topology and routing remain unchanged.
