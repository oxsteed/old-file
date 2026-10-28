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
must use a one-second interval/timeout. Another check reproduced a cancelled
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

## Prepared production resource

`sqbntzhvwhbbywhs9prfhw51` (`OxSteed Web`) is prepared with automatic and preview
deployments disabled and a private `.invalid` candidate hostname. It has not
been deployed and does not own public traffic. The original Compose app and
its automatic deployment setting are unchanged at this point.

The native Coolify clone copies encrypted environment settings internally.
Runtime key names are checked against the running app; build-time variables
are restricted to declared public/release arguments. New role/readiness
settings are explicit. No credential value is returned to the agent.

The clone's database/Redis/scanner mount associations are removed without
altering the source associations or underlying data. Its three mounts are the
existing uploads bind, existing retained-asset volume, and a separate read-only
release metadata volume. It uses the inspected shared network. Before public
promotion, verify actual mounts, role, dependencies, release identity, compatible
session/ledger configuration and real read-only behavior. Then hold the old
Compose push trigger, publish only after all four CI jobs pass, install the
reviewed host observer, and sample the actual transition and subsequent rollout.

The eight-improvement goal is not complete. Workspace operational priorities,
cross-tab account isolation, remaining design alignment and live acceptance
remain in the parent matrix.
