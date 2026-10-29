# Web replacements and update navigation - 2026-10-28

Requirements 1, 2, 7 and 8 of the eight-improvement matrix. These are separate
source, disposable-controller and local-browser observations; production
acceptance is still pending.

## Runtime and controller checks

- Nine focused server suites pass 47 tests: application lifecycle, delegated
  worker readiness, background workers, readiness payload/control plane,
  realtime integration/adapter/presence, and the real web entry point.
- The web entry starts no cron, statement-export or auxiliary consumer. Its
  local Credit-rule refresh remains active and owned by shutdown. The empty
  synthetic rule fixture logs a fail-closed error, not a failed test.
- The deployment/provenance/host/installer Node command in `ci.yml` passes 53
  tests. It checks immutable identity, dedicated read-only metadata, candidate
  rejection decisions, matching healthy fallback routes, concurrent cleanup,
  and fixed-path installation without modifying the actual host installation.
- The final disposable Coolify/proxy rehearsal passes slow promotion (105
  traffic samples), failed readiness (165) and cancelled startup (50), with
  zero failed samples and one running release after every case. Its synthetic
  app, containers and network are removed. No production environment, database,
  upload or volume is cloned into the rehearsal.

An earlier repeat exposed a request timeout while an old container stopped.
The web runtime now withdraws readiness, remains available for a five-second
proxy drain, then closes its local connections. Active proxy readiness checks
use a one-second interval; the later latency rehearsal below supersedes the
original one-second timeout with three seconds. Another check reproduced a cancelled
startup container left behind by Coolify 4.5.3; the host guard follows the
controller's rejection and removes only a pinned candidate with a verified
healthy fallback. These prerequisites do not prove an actual production rollout.

## Update/navigation regression

PR #638's first CI run, `40772790027`, passed Media and ClickHouse. Server/Client
verification failed the iPad WebKit installed recovery case: after accepting a
worker update, a late import failure navigated to `/?chunk-retry=auto` while
the browser was opening `/post-job`. PostgreSQL rehearsal was skipped by that
failure. That run is not a green release gate.

Chunk recovery now respects document departure, the route that started the
import, explicit reload transitions, offline state and existing workflow
guards. Reload attempts require a writable durable marker, and lazy/global
errors share a per-document limit. A successful anonymous sibling cannot erase
the failed-route marker and allow a loop. Pending imports own and release
their unload observer. Explicit update/retry controls remain available; no new
user-visible strings are introduced. Failure diagnostics no longer add the
full page URL, including private query parameters, as an extra field.

- The nine new regressions run against the previous lazy implementation: eight
  fail and one passes, with no cancelled cases. The current implementation
  passes all nine.
- Lazy recovery, route reliability and service-worker version checks pass 34
  tests together.
- `npm run build:ci` passes, validating 1,124 emitted assets.
- The built installed-mode matrix passes desktop Chromium, Android-sized
  Chromium and iPad-sized WebKit. It restores draft text/photos after an
  explicit update, preserves checkout notes through offline/reconnect, and
  clears private drafts after genuine account expiry.

## Production rollout and latency correction (2026-10-29 UTC)

PR #638 merged as `c454fc81840bd529e9fd8c846b6e56a94e1055f7`. All four
required jobs passed on both the PR and merged commit. The merged commit also
has an unrelated failed Dependabot check; this is not an all-checks-green claim.

The original Compose application's automatic push trigger is disabled. Its
healthy combined runtime remains running at `1e584da3`, owning the workers,
existing storage and a public fallback route. `OxSteed Web`, resource
`sqbntzhvwhbbywhs9prfhw51`, now serves the four public domains at `c454fc818`.
Its automatic trigger remains disabled while acceptance is completed. There is
no Actions deployment path in the current workflows.

The private candidate passed page/API/readiness/scanner probes. Actual Docker
mounts are the existing upload bind, retained-asset volume, and separate
read-only metadata volume. A value-opaque comparison of 116 runtime settings
found no differences outside explicitly excluded release/controller/role
metadata; session, encryption, origin, database and Redis settings match. No
credential values were returned. The dedicated five-second host observer is
installed beside the original backup/metadata observer. Public readiness
reports the inspected image/container/deployment identity. All four public
hosts returned the new identity with workers and realtime ready.

The first public transition is **not** a zero-error acceptance: the continuous
probe caught a brief root 503 and non-JSON readiness response. A subsequent
ordinary web-to-web rollout finished without sampled errors. A deliberately
invalid background-readiness candidate was rejected and the healthy release
remained running, but two additional probe cycles saw root/readiness 503s.
The rejected candidate is gone and the normal background setting is restored.
The old `1e584da3` browser document navigated to Food after promotion without a
full reload or chunk retry; its old main asset continued returning 200.

The one-second active proxy timeout was too short for representative readiness
latency. With a synthetic healthy app taking 1.2 seconds to answer readiness,
the controller's three-second Docker health check succeeds, but the proxy with
a one-second timeout returns 503 on all 30 recorded baseline requests. With a
three-second proxy timeout, the same native controller/proxy rehearsal passes
100 slow-promotion, 190 rejected-readiness and 55 cancelled-startup requests:
345 requests, zero failures, one running release after each case, and complete
synthetic-resource cleanup. This is stronger than the earlier fast-readiness
fixture. The fixture now records its latency and timeout parameters.

The live proxy uses a one-second interval and three-second timeout. Versioned
router/service names (`health3`) avoid conflicting definitions while changing
proxy settings. Deployment `kvp326ytx9pk9pgwk24porg3` finished with correct
provenance and a healthy replacement; its transition/build window is retained
in the second continuous report, including failures before the corrected
candidate became active. A new failed-startup check is in progress. The
background observation timeout source change from 1.5 to five seconds still
requires CI and publication; it continues rejecting explicit non-ready worker
responses and remains bounded. Its new regression accepts a responsive
1.8-second observation that the previous timeout rejected. Four lifecycle and
readiness suites pass 22 tests.

Anonymous live navigation produced variable timings: one first Food transition
took 2.3 seconds, a repeat took 392 ms, and warm transitions in that repeat took
70–141 ms. The pre-rollout document consistently requested three missing font
URLs. The new document requested no missing assets. The first post-rollout
cold sample overlapped controller work, so it does not prove a navigation speed
improvement. Repeat measurements on an idle host remain necessary.

Evidence is retained under the chat's `verification-2026-10-28-web-continuity`
artifact directory. Initial deployment, subsequent rolling release, rejection,
latency baseline, corrected rehearsal, and corrected live samples must remain
distinct. Do not overwrite the failed observations with a passing report.

The eight-improvement goal is not complete. Live acceptance and automatic
source/release configuration, workspace operational priorities, cross-tab
account isolation and remaining design alignment are still being completed.
