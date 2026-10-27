# OxSteed eight improvements goal

User authorization: complete all eight improvements proposed in this chat.
Started 2026-10-27. The Codex goal remains active until all outcomes below are
implemented and verified. Earlier changes are starting evidence, not completion
of the broader requirements. Preserve unrelated work and all accounting,
authorization, privacy, deployment-secret, and production-data safeguards.

## Requirements and acceptance matrix

| # | Improvement and required outcome | Evidence required for completion | Current state / next action |
| --- | --- | --- | --- |
| 1 | Deploy without interrupting users: keep the current app serving until its replacement is ready; retain a working release when a candidate fails. | Isolated successful and failed promotions; production transition sampled for HTML, readiness, and representative reads; correct release identity; storage, session, realtime, shutdown, and worker continuity. | In progress. Earlier deploys returned 503. Current Coolify target uses Docker Compose, which lacks application rolling replacement. Inspect persistent mounts, configuration, proxy routing, and worker overlap safety; prepare and rehearse the deployment change before applying it. |
| 2 | Smoother navigation: retain usable navigation while route content loads, avoid downloading unrelated screens and large inactive workspace panels, and measure real transitions. | Bundle comparison, cold/warm route timing, delayed-chunk/recovery checks, correct mode/authorization behavior, and representative live navigation. | Partial: `11518817` split dashboard modes and prefetched primary links. The shared loading fallback now keeps navigation available; a held real route chunk was tested. Provider home routes avoid downloading customer discovery. Next: split inactive workspace panels and measure representative cold/warm transitions without competing browser suites. |
| 3 | Homepage follows the active mode: business activity for owners, work for helpers, discovery/bookings for customers. | Customer, Helper, Business Owner, and supported team-mode browser checks; logged-out discovery remains useful; authorized destinations; five-language parity. | Implemented in package 2: operational home uses the existing mode dashboard behind the existing verification/error boundaries, while customers/visitors retain discovery and customers get a bookings shortcut. Fourteen built-app role/viewport cases pass, including Arabic and active navigation. Await publication and cross-check transient authentication recovery under item 7 before final acceptance. |
| 4 | Consistent design across Food, Direct, Messages, and business workspaces: headers, spacing, buttons, forms, and loading states. | Shared component/token adoption and desktop/mobile, light/dark, keyboard, and Arabic rendering across all four surfaces. | Partial: restaurant directory alignment shipped in `51f7e04e`; package 2 adds one localized, themed loading state for ordinary routes and preserves immersive operation layouts. Next: audit and consolidate headers/forms/spacing across Direct, Messages, and business workspaces, including main-landmark semantics. |
| 5 | Clear restaurant discovery: location, opening hours, ordering options, and a useful small-inventory layout without repeated restaurant shelves. | Real-data contract checks, location/filter and empty-state behavior, accurate hours/fulfillment labels, pagination and no-duplicate shelf checks, and live directory verification. | Not complete. Inspect current restaurant response contracts and visible controls; avoid invented availability or unsupported ordering options. |
| 6 | Business workspaces lead with today's bookings, unanswered messages, overdue invoices, and required tasks; detailed analytics are secondary. | Ownership/team-permission scenarios, authoritative counts, task destinations, empty/error/loading states, and responsive browser checks. | Not complete. Inspect workspace overview data and existing attention services; retain financial/account/currency separation. |
| 7 | Reliable sessions and unfinished work: investigate unexpected sign-outs and preserve work during transient outages, reconnects, and updates. | Expired versus transient refresh cases; resume/update/navigation/reload with drafts; account-switch isolation; concurrent-tab behavior; no stale private data or financial replay. | Package 3 fixes temporary bootstrap/refresh failures being treated as sign-out. Unverified sessions retain the destination with a localized retry; verified forms remain mounted. Nine browser checks cover expiry, two tabs, text/photos, stale verification and no financial replay. Next: published recovery checks and remaining cross-tab expiry/account-change races, including the Axios expiration event boundary. |
| 8 | Less persistent screen clutter: connection, AI support, update notices, and cookie controls do not compete with primary actions. | Online/offline/reconnecting and recovery checks; checkout/dirty-work update deferral; support/cookie/update combinations; mobile keyboard and desktop/RTL clearance; accessible recovery controls. | Package 2 implements critical-work/edited-form/cart deferral, modal/cookie priority, launcher/action-bar clearance, and offline/keyboard launcher suppression. Browser geometry and real draft-update/reconnect checks pass. Await published runtime verification; retain the wider unfinished-work/session audit under item 7. |

## Execution and evidence rules

1. Work in coherent packages, keep all eight requirements intact, and record
   source, test, browser, CI, and live evidence separately.
2. Use the actual default branch and preserve unrelated local work. Commit and
   push completed packages; group changes to avoid needless production restarts.
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
