# OxSteed Credit Requirements Matrix

Updated 2026-09-16. This matrix is the engineering evidence gate for the
code-completion goal. A row marked `environment` is implemented in code but
cannot be called production-ready until the listed isolated or live check has
been run. Human licensing, custody, contracts, and provider approval belong in
the separate launch handoff.

Current evidence: the currently deployed application image reports migration
`516`, while the live Colima PostgreSQL database already contains Direct catalog
migrations `523` through `526`; the source candidate contains migrations `527` and `528`
and remains unpublished. The deployed application container image is
`tdrapz1vvcoftfwsk7fcdq0h_app:a6f91544908600b061fecc74bed5f52f3ea86295`, is
healthy, and its in-container `/health`, `/api/health`, `/ready`, and
`/api/ready` probes all return `200`. The `/ready` payload reports release
`content-ca49f8250bc2b53d` with release, production configuration, database,
migrations, Redis, Credit ledger, Credit rail, realtime, workers, traffic, and
shutdown checks healthy. The read-only `verify-oxsteed-credit` run using the current
verifier source passed against the live database with zero invalid balances,
refunds, settlements, conversions, hashes, or expired holds. A fresh dump from
that database was restored into a temporary database and passed the strengthened
restore verifier with 516 migrations, all 11 Credit tables, and all 5 Credit
integrity triggers. The live production `verify:credit` command still stops at
the prerequisite gate because Sentry monitoring is not configured; that is an
activation/configuration gap, not a reason to weaken the safety gate.
The Credit rail readiness check is healthy but currently disabled as an
emergency activation state; no live value movement was enabled by this pass.
The live browser smoke check redirects unauthenticated `/oxsteed-credit` visits
to the localized `/login` screen; no authenticated customer or operator
workflow was run against production.

Package C isolated evidence is separate from the live database: the clean
Colima fixture applied migrations `522/522` with zero pending, passed the full
accounting drill, and passed the real concurrent race verifier. The race run
proved one terminal outcome for capture/release, expiry/capture, refund/refund,
issuance and conversion caps, settlement overlap, and two-restaurant
permission contention; identical idempotency replay stayed one transaction,
conflicting reuse was rejected, and the final reserved balance was `0` cents.
The latest rebuilt isolated artifact release is `content-88c11f95a2cfbf0e`; its clean
reset now waits for PostgreSQL TCP readiness before migration startup. The
database-backed monitoring recovery verifier forced all 6 configured Credit
workers stale, persisted 6 critical incidents, locally captured 2 monitoring
events, and resolved all 6 incidents after heartbeat recovery.

## Core Accounting

| Requirement | Implementation evidence | Verification evidence | Status / remaining gap |
| --- | --- | --- | --- |
| Central authority ledger and immutable journal | `server/migrations/421_oxsteed_credit_foundation.sql`, `server/services/oxsteedCreditService.js` | current-source non-activating verifier transiently run inside the healthy Colima application container passed with zero invalid balances, entries, chains, or audit hashes; backend Credit tests | implemented; activation remains gated by production monitoring and redeployment of the patched verifier source |
| Independent restaurant payable and reserve ledgers | `server/migrations/514_oxsteed_credit_partner_ledgers.sql`, forward fixes `517` and `518`, `server/services/oxsteedCreditPartnerLedgerService.js` | live non-activating verifier passed with zero invalid partner ledgers/funding records; partner-ledger unit tests; isolated PostgreSQL accounting drill verified reserve balance `1500` and payable/reserve separation; clean runner applied migrations `521/521` | implemented; external funding evidence remains an operator handoff; failure-injection evidence remains |
| Funding and reserve release traceability | `oxsteed_credit_partner_funding_records`, admin ledger UI and routes | funding amount handoff regression; idempotent replay; isolated Colima treasury drill recorded 2 reserve entries and identical replay transaction | implemented; external transfer evidence must be supplied by operators; failure-injection evidence remains |
| Loads, purchases, holds, captures, releases, refunds, transfers, and adjustments | `server/services/oxsteedCreditService.js` and Credit controllers | backend suite plus isolated PostgreSQL/Redis/API smoke on Colima: real login, isolated rail enable, `1000 USD` load, account read, and direct journal verification passed twice from fresh volumes; Package C isolated drill covered load, purchase, hold/capture, refund, transfer, and cross-restaurant denial; real race verifier covered capture/release, expiry/capture, refund/refund, issuance/conversion caps, settlement overlap, and two-restaurant permission contention with zero final reservation | implemented; broader failure-injection and browser workflow evidence remain |
| Settlement, reversal, reconciliation, statements, disputes, and audit | Credit admin service, controllers, UI, and migrations `516_oxsteed_credit_settlement_reversal.sql` and `520_oxsteed_credit_settlement_evidence_trigger_branching.sql` | backend suite, reversal compensating-journal test, clean isolated settlement-overlap race with one committed settlement, current-source live verifier, and strengthened restore script | implemented in source; paid payout reversals require admin reason, recovery reference, idempotency, and append-only compensating journal evidence; failure-injection and end-to-end browser evidence remains; patched verifier source still requires redeployment for artifact-level proof |
| Double-spend, limits, tenant isolation, and replay defense | advisory locks, account guards, idempotency and role middleware | isolated migration-516 `verify:credit-concurrency` passed: one concurrent spend committed, one rolled back, duplicate retry shared one transaction, and insufficient-funds failure left state unchanged; reusable isolated Colima smoke also passed twice with scoped teardown; Package C drill denied customer one at partner two and kept the legacy restaurant wallet separate; clean migration-runner fixture passed `521/521`; real races covered capture/release, expiry/capture, refund/refund, issuance-at-cap, conversion-at-cap, settlement overlap, two-restaurant permission contention, identical replay, and conflicting-key rejection | partial: broader failure-injection and browser evidence remain |

## Product And International Support

| Requirement | Implementation evidence | Verification evidence | Status / remaining gap |
| --- | --- | --- | --- |
| Customer, restaurant, and Super Admin workflows | `client/src/pages/food/OxsteedCreditPage.jsx`, `client/src/pages/food/OxsteedCreditPartnerManager.jsx`, `client/src/admin/pages/super/OxsteedCreditAdmin.jsx`, and the read-only Customer 360 detail panel; Customer 360 now keeps eligibility lookup failure distinct from an empty result, and profile/partner-ledger responses are request-scoped through the shared request guard | `client` typecheck/build, API/controller tests, stable admin and legacy restaurant-wallet mutation-key regressions, request-guard `3/3`, deployment wiring `21/21`, live unauthenticated route guard, rebuilt isolated browser customer journey: login, JPY balance/eligibility, `7` JPY authorization, release, receipt/history, and Arabic RTL rendering; guarded `CREDIT_TEST_ADMIN_MODE=true ... node scripts/verify-credit-admin-api.js` completed password-plus-TOTP authentication and all 11 Credit read surfaces with rail disabled; same-origin CUA browser completed synthetic Super Admin password-plus-TOTP login, dashboard navigation, and Credit console rendering on release `content-f48453f6de2348d9` with no warning/error console logs; rebuilt isolated fixture smoke passed after the loopback CORS safeguard; synthetic restaurant-owner browser journey rendered the Store tab and `restaurant-credit:901:USD` ledger with no customer identity, while a second owner with a tampered `business=901` query saw only restaurant `902` and `restaurant-credit:902:USD`; fresh operator tab had no warning/error console logs; continuation artifact `content-88c11f95a2cfbf0e` rendered the full Admin Credit console with the rail suspended; customer and Admin pages had no horizontal overflow at `390x844`, `768x1024`, or `1440x900`, and keyboard traversal reached the relevant Credit controls without warning/error logs | partial: 200% zoom, locale/timezone matrix, deeper operator mutation workflow, and failure-path browser evidence remain |
| Direct catalog expansion, safe requestability, and tool coverage | `server/migrations/523_direct_catalog_expansion.sql` through `527_direct_catalog_tool_category_fk.sql`, repeatable generators, `server/services/directCatalogService.js`, public/admin catalog UI, and guarded catalog verifiers; exactly 1,000 additional services are distributed 200 per category, with 40 categorized supporting tools, five-locale metadata, quote-based USD pricing, availability, live/operational/non-bookable safeguards, unique slugs, conflict-safe inserts, review flags, and bounded public pagination/search; catalog cards carry a stable service slug into the quote form, and the server validates linked slugs against requestable catalog records before insertion; CI verifies the database inventory before publication, while the deployment workflow runs the bounded performance gate only with explicit live-target authorization | focused server catalog suite `29/29`; deployment-wiring, database-verifier, public-payload, and linked-request suites `65/65`; latest full backend `161/161` suites and `1,163/1,163` tests; client `build:ci`; fresh rebuilt Colima artifacts reached `527/527` with `unexpectedCount=0`, passed the real database verifier including exact 200-services/8-tools-per-category checks and the five-locale public API verifier, and passed isolated Arabic pagination/search/browser checks; bounded performance verifier passed 20 requests across all five categories and multiple offsets at concurrency 4 with p50 `71.24ms`, p95 `751.95ms`, max `804.42ms`, and `0` errors; a custom-format dump from a migration-527 artifact passed the restore verifier with all five catalog migrations, 1,000 services, 40 tools, the tool-category foreign key, complete locale/safety checks, and Credit integrity checks; five-locale i18n verification and the full client production build passed after the request-flow hardening | partial: current live image still reports `516/516`, omits `categorySlug` and `servicePagination`, and the source candidate is uncommitted; publish through the approved path, then repeat live API/browser/request-metadata/restore checks |
Stable request-flow follow-up (2026-09-16): catalog cards now pass both `service` and validated `serviceSlug` query parameters; the quote form preserves the stable slug and readable name in request metadata and renders a localized selected-service status in all five catalogs. The public quote endpoint now verifies a supplied slug against active, published, live, operational catalog data inside the request transaction, canonicalizes the stored service name, rolls back unavailable links, rejects malformed and overlong slugs before database access, and preserves legacy requests without a slug. `directQuoteCatalogLink.test.js` passed `5/5`; the focused request/wiring suite passed `37/37`; the full backend regression passed `161/161` suites and `1,164/1,164` tests; `npm run verify:i18n` passed, `git diff --check` passed, and the full client `npm run build:ci` exited `0`. This remains source-only until publication and a live browser/API metadata recheck.
Direct catalog coverage follow-up (2026-09-16): migration `528_direct_catalog_service_coverage.sql` fills only blank coverage fields for the generated services and published tools, using conservative guidance while leaving exact location eligibility to `direct_service_areas` and the quote flow. The generator and artifact regression now also fail closed on category skew, requiring exactly 200 generated services in each of the five categories. The final focused catalog/release suite passed `80/80` across 8 suites; the full backend passed `161/161` suites and `1,165/1,165` tests; client `build:ci`, locale verification, syntax checks, and `git diff --check` passed. Fresh Colima artifact `oxsteed-credit-test-20260916t05461789537604z-15063` reached `528/528`, passed database verification (`1000` services, `40` tools, `5` categories), public verification in all five locales (`1020/40` each, bounded page `229ms`), bounded performance (`20` requests, p50 `52.96ms`, p95 `134.51ms`, max `143.84ms`, zero errors), and the strengthened restore drill (`6` catalog migrations, coverage, FK, 11 Credit tables, 5 integrity triggers). The source remains unpublished; live API, browser, and post-publication restore checks remain required.
| Accessible loading, empty, failure, retry, and emergency controls | Credit page states, admin controls, rail status gates, visible admin retry path, and focused in-app dialogs for destructive/status actions; Customer 360 explicitly announces unavailable eligibility and offers retry instead of claiming no access; the customer Credit page now exits loading into a localized retryable alert and preserves previously loaded data during refresh failures | live localized login boundary and client build; source-level stale/failure guards are present; deployment wiring/focus contract passed `21/21`, including dialog keyboard containment, Escape close, focus restoration, selected-locale timestamp formatting, and enforced `:focus-visible` styling; rebuilt isolated authenticated browser stopped PostgreSQL, observed the Credit page's `role=alert` with `Retry` while its prior balance/limits remained visible, restored PostgreSQL, re-authenticated the synthetic customer, and observed normal Credit recovery with no alert | partial: 200% zoom inspection and deeper operator/admin failure-path browser evidence remain |
| Currency precision and currency-isolated reporting | explicit minor-unit map and currency checks in `oxsteedCreditService.js`; exact client amount parser is used by OxSteed Credit and the preserved restaurant-wallet page; entitlement UI/API currency contract and locked-row mixed-currency guard | `node --test scripts/creditCurrency.test.mjs` passed 5/5; `oxsteedCreditAdminService.test.js` passed 41/41 including mixed-currency rejection; deployment wiring contract passed `21/21`, including the legacy-wallet exact-parser guard; server currency tests and verifier | implemented in source; authenticated browser form and per-market funding/settlement drill remain |
| Cross-currency conversion safety | `server/migrations/515_oxsteed_credit_currency_conversions.sql`, `server/services/oxsteedCreditCurrencyConversionService.js`, quote/conversion API routes; customer quote reads expose terms only while Super Admin reads retain provider/audit fields | conversion unit tests, exact-rate idempotency regression test, customer quote redaction regression, isolated PostgreSQL quote-to-ledger drill, daily-cap advisory-lock regression test, and verifier | implemented; live migration and provider-backed sandbox drill remain |
| Localization, time zones, and regional policy enforcement | localized customer/operator UI plus Credit admin entitlement, partner-ledger, action-dialog, Customer 360 entry/recovery states, and the preserved restaurant-wallet payment/transfer/request dialogs; `RestaurantCreditPage.jsx` uses the dedicated `restaurantWallet` namespace for visible labels, validation, recovery notices, and accessibility labels; shared `client/src/lib/creditDateTime.js` formats Credit timestamps using the selected app language while preserving the runtime timezone; shared `client/src/lib/creditStatus.js` prevents known lifecycle codes, including revocation, from leaking as raw UI text; injectable dev proxy supports repeatable isolated browser origins; non-production CORS accepts only loopback origins for dynamic isolated ports; same-origin realtime follows the published loopback origin when no explicit API URL is configured; server policy validation and ISO currency configuration | `445` Credit-key parity and surface checks across en/es/fr/ht/ar, including the restaurant-wallet and Super Admin entitlement pages; shared status contract `2/2` including revocation and unknown-state fallbacks, server localization checks, regional API tests, locale formatter `2/2`, client `build:ci` (Credit tests, i18n verifier, typecheck, and Vite bundle), deployment wiring `21/21`, `client` realtime URL regression `2/2`, and rebuilt isolated browser Arabic RTL Credit journey with localized controls/history/support; English operator Store journey rendered at a dynamic loopback port with a clean browser console | partial: complete browser locale, timezone/DST, long-string, and responsive matrix remains |

Continuation browser evidence (2026-09-15): the isolated English operator
Store/Credit page had no horizontal overflow at `390x844`, `768x1024`, or
`1440x900`. Keyboard traversal reached the restaurant selector, Store controls,
Credit report/refresh controls, and settlement filter. Pausing the synthetic
restaurant succeeded; re-publishing was blocked by the existing menu-readiness
safeguard and opened setup guidance. The latest rebuilt fixture release was
`content-9106be7e300be978`, and the fresh operator browser had no warning or
error console logs after the realtime-origin fix. 200% zoom, full focus styling,
and deeper failure-path browser checks remain open.

Super Admin browser evidence (2026-09-15): the fresh isolated artifact release
`content-88c11f95a2cfbf0e` authenticated through the real password-plus-TOTP
boundary and rendered `/admin/super/oxsteed-credit` with the rail suspended.
At `390x844`, `768x1024`, and `1440x900`, the console reported no horizontal
overflow. Keyboard traversal reached Credit audit and movement filters, wallet
actions, partner lookup/enrollment, agreement, and operating-ledger controls;
the browser recorded no warning or error logs. The in-app browser has no
supported zoom control and its key shortcut did not change the measured zoom,
so 200% remains explicitly unverified.

International time-boundary evidence (2026-09-15):
`server/__tests__/oxsteedCreditReconciliation.test.js` passed `9/9`, including
spring-forward and fall-back boundary cases proving reconciliation periods stay
on complete UTC-day boundaries. This strengthens server scheduling evidence but
does not replace the remaining browser locale, timezone-display, or DST journey.

Authenticated Credit failure/retry evidence (2026-09-15): the rebuilt isolated
artifact served the synthetic customer Credit page at loopback. With the prior
JPY balance and guardrails already rendered, PostgreSQL was stopped and the
customer clicked Refresh. The page left its loading state, exposed a localized
`role=alert` with `Retry`, and retained the last usable balance/limits instead of
showing a blank or falsely spendable state. PostgreSQL was restarted, readiness
returned `200`, the synthetic customer re-authenticated, and the page recovered
to the paused-rail balance, limits, and empty partner/activity states without an
error alert. This is isolated failure-path evidence only; production was not
modified and live monitoring/provider checks remain open.

Agreement optional-limit parity evidence (2026-09-15): the main Super Admin
agreement form now uses the shared exact currency parser for transaction, daily,
and lifetime caps. Blank optional fields intentionally remain `null`; malformed
nonblank values, including excess precision or nonnumeric text, produce a
localized validation error and return before `adminApi` sends a mutation. The
client currency regression suite passed `5/5`, the corrected deployment wiring
suite passed `22/22`, and `client npm run build:ci` passed. This is source and
contract evidence; authenticated browser submission for each market currency
remains open.

Operator error-surface hardening evidence (2026-09-15): added
`client/src/lib/creditErrors.js` and applied it to customer Credit loading,
customer mutations, the preserved restaurant wallet, Super Admin Credit
mutations, partner ledger funding, profile/detail actions, and CSV exports.
Concise API validation messages remain actionable, while transport status text,
database/authentication details, oversized messages, and other technical error
shapes fall back to stable user-facing messages. The same guard now blocks an
invalid partner-ledger amount before POST. The focused `creditErrors` regression
suite passed `3/3`, client TypeScript passed, and the source no longer reads raw
error messages in these Credit surfaces. A rebuilt browser outage run verified
the retry alert and retained data before this centralization; the sanitized
fallback itself has source and unit-test evidence, not a second rebuilt outage
run.

Verification refresh (2026-09-15): after the error-surface wiring, the full
backend regression passed `156/156` suites and `1120/1120` tests, the focused
deployment wiring contract passed `22/22`, and `client npm run build:ci`
passed currency, date-time, idempotency, request-guard, status, error-policy,
realtime, five-locale parity/surface checks, TypeScript, and the production
bundle. Earlier rows retain their historical evidence details; these totals
are the latest source state. No production container, wallet, database, or
Credit activation setting was changed.

## Security, Integrations, And Operations

| Requirement | Implementation evidence | Verification evidence | Status / remaining gap |
| --- | --- | --- | --- |
| Secrets, HMAC ledger integrity, authorization, and audit | Credit service secret validation, HMAC entries, role middleware, audit events | live non-activating verifier and deployed secret replacement/restart passed; backend security tests | implemented; Sentry monitoring is still required before activation |
| Provider adapters, webhooks, reconciliation, and outage handling | provider-specific adapters and webhook handlers in `server/`; payment worker claims jobs with visibility leases, atomically reclaims stale jobs after worker crashes, acknowledges already-completed duplicate claims, dead-letters unprocessable queue jobs, propagates Redis acknowledgment failures into retry/dead-letter handling, fails unmatched Stripe payment updates for retry/dead-letter handling, delegates notification delivery to the real fan-out service, uses `mobile_push_tokens` for current native-token cleanup, and moves exhausted provider jobs to a queue-specific dead-letter list with an atomic operator requeue command | contract fixtures, webhook receipt replay protection, worker notification success/failure tests, notification SQL regression, optional Stripe payload handling, unmatched-payment regression, duplicate-claim acknowledgment regression, unknown-processor dead-letter regression, acknowledgment-failure regression, queue failure-path tests, expired-lease reclamation, dead-letter preservation/requeue coverage, and guarded `server/scripts/verify-payment-queue-recovery.js` run against real Colima Redis with atomic enqueue, lease recovery, delayed retry, dead-letter replay, and duplicate suppression; rebuilt isolated app reclaimed 7 stale Credit notifications and marked 7 sent; live Stripe credentials are deployed; disposable Colima outage harness passed Redis and PostgreSQL stop/degrade/restart/readiness recovery without touching production | partial: provider sandbox/event-delivery and end-to-end outage runs remain |
| Workers, diagnostics, health, and readiness | worker config, `/ready`, `/health`, verifier scripts; claimed duplicate jobs are acknowledged when their completion marker already exists, unknown claimed jobs are preserved for operator recovery, notification completion uses explicit PostgreSQL parameter types, and `workerMain` stops polling before graceful drain | worker lifecycle fake-timer regression, broader Credit backend checkpoint `7` suites/`186` tests, duplicate-claim acknowledgment regression, unknown-processor dead-letter regression, worker failure/retry contracts, notification/outbox tests `9/9`, readiness checks, real Redis queue recovery with stale lease reclamation and dead-letter replay, rebuilt artifact notification recovery, rebuilt-artifact local monitoring capture `ok=true`, `flushed=true`, and guarded `MONITORING_RECOVERY_TEST_MODE=true ... node scripts/verify-credit-monitoring-recovery.js` with 6 stale and 6 recovered incidents plus 2 local monitoring events; disposable Colima `bash scripts/credit-isolated-env.sh failures` passed expected `503 not_ready` dependency degradation and clean `200 ready` recovery for Redis and PostgreSQL | partial: live worker recovery observation and genuine production monitoring configuration remain |
| Reproducible build, migration upgrade, and release identification | Dockerfile, compose deployment, migration runner, deterministic image release metadata, and production release readiness gate | client `build:ci`, latest rebuilt isolated artifact release `content-88c11f95a2cfbf0e` with migration startup at `522/522` and zero pending, current-source live non-activating verifier; source generates a shared `content-<hash>` release when Coolify does not inject commit metadata | partial: deploy the patched verifier source and rerun the production-gated Credit verification after Sentry monitoring is configured; explicit `SENTRY_RELEASE`, `COMMIT_SHA`, or `SOURCE_COMMIT` remains preferred for incident correlation |
| Automated backup and tested restoration | complete Coolify snapshot runner `scripts/backup-coolify-production.sh`, manifest/checksum monitor, launchd templates, `scripts/install-production-backup-launchagents.sh`, and `scripts/verify-production-restore.sh`; runner pins the Colima context before health checks, supplies launchd-safe paths, and prevents overlapping runs with an atomic lock; monitor accepts only timestamp-shaped published snapshots, so orphaned `.incomplete.*` manifests cannot mask a valid backup; installer stages reviewed scripts outside macOS Documents privacy scope | runner syntax/plist/deployment wiring verified; hermetic `bash scripts/verify-local-backup-scheduler.sh` passed successful snapshot, monitor success, orphaned manifest, overlap lock, stale lock replacement, failed dump, corrupt checksum, retention, stale snapshot, and disk-space failure; installer successfully bootstrapped both current labels; loaded `com.oxsteed.production-backup` uses Colima and a 21600-second interval; a launchd `kickstart` completed with `runs=1`, `last exit code=0`, and published local snapshot `20260915T191849Z`; `bash scripts/check-production-backup.sh` passed for that snapshot and all five artifacts passed SHA-256 verification; the installed monitor returned `state=OK`; that snapshot was restored into a temporary Colima PostgreSQL database and `npm --prefix server run verify:restore` passed with 516 migrations, 11 Credit tables, 5 Credit integrity triggers, zero disabled required triggers, and the mutation probe; temporary performance state removed | partial: observe at least one unattended six-hour interval after the current install and configure the approved off-device copy when available |
| Performance and resource targets | bounded page sizes, transaction and export limits, retry controls, bounded PostgreSQL pool, single-connection fixture transactions, and explicit bounded-concurrency workload controls (`CREDIT_PERFORMANCE_READ_SAMPLES`, `CREDIT_PERFORMANCE_PURCHASES`, `CREDIT_PERFORMANCE_CONCURRENCY`, `CREDIT_PERFORMANCE_DURATION_MS`, `CREDIT_PERFORMANCE_PARTNERS`) | deployment wiring test passed `21/21`, covering fixture connection ownership, workload controls, partner routing, error-rate fields, duration controls, and process/container resource fields; fresh rebuilt Colima artifact `content-88c11f95a2cfbf0e` with migrations `522/522` and Redis `PONG` ran two isolated restaurant partners for 30-second read phases: `5960` account reads p95 `75.16ms`/`3000ms`, `1670` transaction reads p95 `222.44ms`/`2500ms`, and `1350` eligibility reads p95 `267.76ms`/`2000ms`; `48/48` purchases across two independent payable accounts p95 `4397.33ms`/`10000ms` at max concurrency `10`; every workload reported `0%` errors; all eight wallets ended at `9940` cents with zero reservations and both partner-payable ledgers ended at `240` cents with zero reservations; measured Node max-RSS delta was `12.5 MB`, container cgroup memory-current delta was `-34.59 MB`, peak delta `5.66 MB`, and CPU delta `14.92 s`; disposable project and volumes were removed after verification | partial: a live production-duration observation remains unavailable while the Credit rail is intentionally disabled; the isolated artifact-duration requirement is satisfied |

Provider ordering evidence (2026-09-15): Stripe webhook receipts now retain
the provider object and event timestamp, while `webhook_event_watermarks` rejects
older deliveries for the same payment object and permits retries of the same
failed event. `server/__tests__/webhook.test.js` passed `18/18`, including
stale-event and same-failed-event retry regressions; migration `522` applied in
the fresh isolated artifact.

Worker lease evidence (2026-09-15): `paymentQueue.js` now renews an active
claimed payload through an atomic `LPOS`-guarded Redis script, and `workerMain.js`
renews the lease during slow provider/notification handlers and clears the
renewal after completion. Queue reliability and worker tests passed `10/10` and
`4/4`; the deployment wiring suite passed `22/22`; the fresh disposable Colima
artifact returned `PONG` and the real queue verifier passed
`activeLeaseRenewed=true` and `reclaimedLeaseNotRevived=true` alongside the
existing enqueue, retry, dead-letter, and replay checks. The isolated project
and volumes were removed afterward.

Restaurant-wallet localization evidence (2026-09-15): the preserved
`client/src/pages/food/RestaurantCreditPage.jsx` now uses the `credit` namespace
for its page, wallet activity, payment QR, transfer, and proof-request surfaces;
the five catalogs contain the same `restaurantWallet` key contract with localized
values; known wallet, transfer, and request status codes are also rendered
through the Credit status catalog instead of leaking raw codes. `npm run
verify:i18n` passed with `445` keys across en/es/fr/ht/ar and explicitly
included the restaurant-wallet and Super Admin entitlement sources; the shared
Credit status contract passed `2/2`; the full `npm run build:ci` passed the
Credit regressions, locale parity/surface checks, typecheck, and production
bundle. This closes the code-side raw-English localization gap for the
preserved wallet, entitlement surface, and known lifecycle badges;
authenticated browser locale/timezone/zoom and failure-path evidence remains
open.

Restaurant-wallet locale reactivity evidence (2026-09-15): the preserved
wallet now reloads translated failure text when the selected language changes,
and every wallet, transfer, request, hold, and payment-QR timestamp passes the
selected language to the shared formatter with a localized unavailable
fallback. `npm run test:credit-date-time` passed `3/3`, `npm run typecheck`
passed, and the subsequent `npm run build:ci` passed the full Credit test,
five-locale verifier, typecheck, and production bundle. This is code-level
evidence; authenticated browser locale, timezone/DST, zoom, and failure-path
journeys remain open.

Fresh isolated browser matrix evidence (2026-09-15): rebuilt the current
loopback-only artifact with migrations `522/522` and `railEnabled=false`.
The authenticated customer Credit page rendered Arabic RTL with no horizontal
overflow. The authenticated restaurant operator page had no horizontal
overflow at `390x844`, `768x1024`, or `1440x900`; keyboard traversal reached
the restaurant selector, Credit report/refresh controls, and mutation controls.
The browser probe exposed Retina `devicePixelRatio=2` but no controllable page
zoom value, so 200% zoom remains unverified rather than being treated as a
pass. The isolated project and volumes were removed after the run.

Authenticated isolated runtime evidence (2026-09-15): the rebuilt loopback
artifact accepted the synthetic customer login after the exact registered-name
signature was supplied, loaded `/oxsteed-credit`, and rendered the paused-rail
state, JPY currency selector, guardrails, conversion form, partner eligibility
empty state, statement summary, and support path. The synthetic admin password
login and full seeded TOTP verification also worked once, reaching the admin
dashboard; the dashboard then exposed its own failed-stats recovery state with
`Try again`. A second admin identity was intentionally not retried after the
application enforced its 15-minute MFA lockout following invalid browser
codes. No MFA control was weakened or bypassed. This proves customer
authentication and the admin MFA gate in the disposable environment, but leaves
the authenticated Super Admin Credit console and admin failure-path journey
open. The fixture project, containers, network, and volumes were removed after
the run. Exact next action: localize the next bounded main-console workflow
slice in `client/src/admin/pages/super/OxsteedCreditAdmin.jsx`, then rebuild a
fresh fixture and run the admin browser matrix with a clean synthetic session;
keep the Credit rail disabled.

Super Admin timestamp locale evidence (2026-09-15): the main Credit console's
shared timestamp formatter now reads the selected document language, so worker,
transaction, settlement, notification, account, reconciliation, dispute, and
audit timestamps no longer silently use the browser default locale. The
existing `credit-date-time` regression passed `3/3`, TypeScript passed, and the
subsequent `client npm run build:ci` passed all focused Credit tests, the
five-locale verifier, TypeScript, and the production bundle. Full main-console
text localization and authenticated locale/timezone/zoom coverage remain open.

Super Admin health/readiness localization evidence (2026-09-15): the shared
integrity summary, worker-health panel, and Credit activation-prerequisite
panel now use translated labels, state badges, descriptions, and variable-based
integrity details across `en/es/fr/ht/ar`. The main admin source is now included
in the Credit translation-surface verifier; locale JSON parsing passed, the
verifier passed with `475` keys across all five locales, TypeScript passed, and
`git diff --check` passed. This closes the reusable operator health/readiness
localization slice. The rest of the main console still contains hard-coded
workflow text, and authenticated admin locale/timezone/zoom/failure-path
evidence remains open.

Super Admin transaction-dialog localization evidence (2026-09-15): the
transaction detail modal now translates its labels, journal/entry/audit empty
states, fallback values, and partial/full refund controls without changing its
immutable-refund eligibility or focus-trap behavior. `npm run build:ci` passed
all seven focused Credit suites, the five-locale verifier passed with `507`
keys across `en/es/fr/ht/ar`, TypeScript passed, the Credit locale JSON inputs
parsed, and `git diff --check` passed. The remaining main-console workflow text
and authenticated admin locale/timezone/zoom/failure-path evidence remain open.

Super Admin settlement-evidence localization evidence (2026-09-15): the
read-only payout-evidence panel now translates its settlement trail, fallback
partner labels, approval/payment fields, paid state, and recent-record summary
across `en/es/fr/ht/ar`, without changing settlement transitions or payout
values. `npm run build:ci` passed all seven focused Credit suites, the
five-locale verifier passed with `517` keys, TypeScript passed, the locale JSON
inputs parsed, and `git diff --check` passed. The remaining main-console
workflow text and authenticated admin locale/timezone/zoom/failure-path
evidence remain open.

Super Admin operational-section localization evidence (2026-09-15): the
reusable `Section` renderer now localizes the Credit audit-history, coverage,
notification delivery, ledger activity, and risk guardrail headings, titles,
and explanations in all five catalogs, while preserving the existing filters,
pagination, audit behavior, and financial controls. `npm run build:ci` passed
all seven focused Credit suites, the five-locale verifier passed with `532`
keys across `en/es/fr/ht/ar`, TypeScript passed, and the production Vite bundle
completed successfully. The remaining main-console workflow copy and
authenticated admin locale/timezone/zoom/failure-path evidence remain open.

Authenticated Super Admin Credit-console evidence (2026-09-15): a fresh
loopback-only Colima fixture built from the current source with migrations
`522/522` and `railEnabled=false`. The synthetic Super Admin authentication
journey completed through the password and MFA gates and reached the actual
`/admin/super/oxsteed-credit` route. The browser rendered the suspended-rail
emergency control with `Enable rail` disabled, production prerequisite status,
worker health, customer wallets in multiple currencies, the seeded restaurant
network, agreement/access views, settlement/reconciliation/dispute/audit
sections, and the localized operational-section headings. No financial,
activation, or emergency mutation was performed. This is runtime evidence for
the authenticated Super Admin route and the protected inactive-rail state; it
does not close deeper admin mutation, locale/timezone/DST, 200% zoom, or
failure/retry journey evidence. The disposable project, containers, network,
and volumes were removed afterward. Exact next action: complete the safe
authenticated admin locale/timezone/DST, long-string, keyboard, and
failure-path checks where the UI permits, then implement the next unresolved
software requirement without enabling live Credit.

Super Admin rail-entry localization evidence (2026-09-15): the main Credit
console header, stored-value control label, refresh action, emergency rail
heading and explanation, required audit-reason label, rail-state placeholders,
rail actions, and dashboard retry action now use the Credit namespace across
`en/es/fr/ht/ar`. No rail behavior, activation safeguard, or mutation path was
changed. `client npm run build:ci` passed all seven focused Credit suites, the
five-locale verifier passed with `546` keys across all five catalogs, TypeScript
passed, the production Vite bundle completed, and `git diff --check` passed.
This closes one high-visibility admin localization slice; remaining workflow
copy, authenticated locale/timezone/DST, 200% zoom, and failure-path evidence
remain open. Exact next action: localize the next bounded main-console form or
table slice, then rerun only the affected client checks before the next clean
isolated browser observation.

Super Admin coverage and delivery localization evidence (2026-09-15): the
coverage-watch cards now translate active-partner agreement gaps, expiring
agreements, pending activation, and their safe operator guidance. The
notification-health cards now translate queue/backlog counts, terminal
failures, durable-outbox guidance, retry reason, and requeue actions across
`en/es/fr/ht/ar`. Financial state, retry eligibility, and mutation behavior
were unchanged. `client npm run build:ci` passed all seven focused Credit
suites, five-locale parity and surface verification passed with `567` keys,
TypeScript passed, the production Vite bundle completed, and
`git diff --check` passed. This is a source and regression checkpoint; deeper
admin workflow localization, authenticated locale/timezone/DST, 200% zoom, and
failure-path evidence remain open. Exact next action: localize the next
bounded customer-wallet or partner-form slice, then run its affected checks.

Authenticated Super Admin database outage evidence and refresh resilience
(2026-09-15): a fresh loopback-only Colima fixture at `127.0.0.1:32941`
authenticated the synthetic Super Admin and rendered the real
`/admin/super/oxsteed-credit` console from the patched artifact with migrations
`522/522` and `railEnabled=false`. Stopping only the disposable PostgreSQL
container made the read-only dashboard refresh expose an accessible alert,
`Unable to load OxSteed Credit administration.`, with `Retry dashboard`; no
financial, rail, or emergency mutation was attempted. After PostgreSQL
recovery and a healthy `/ready` response, `Retry dashboard` restored the
console in place without re-authentication. The browser diagnostic check
returned no error or warning entries. The fixture was then torn down with the
isolated-environment script and no production container or wallet was touched.
The client preserves stored credentials for transient refresh failures (`408`,
`429`, `5xx`, or network failure) and clears only for definitive
authentication failures. `client/scripts/authRefreshPolicy.test.mjs` passed
`2/2`; the prior `client npm run build:ci` passed the focused client checks,
five-locale verification, TypeScript, and the production bundle. This closes
the patched runtime auth-refresh outage gap; authenticated locale/timezone,
responsive, deeper failure-path, provider, backup, and live production
evidence remain open. Exact next action: continue the next unresolved Package G
evidence gap with Credit disabled.

Customer-wallet localization evidence (2026-09-15): the authenticated Customer
360 detail now localizes spend permissions, restaurant assignments, effective
eligibility guidance, reserved funds, holds, risk-limit summaries, disputes,
wallet transactions, audit history, and all transaction-type labels across
`en/es/fr/ht/ar`. Currency formatting, read-only controls, eligibility
decisions, and financial mutation behavior were unchanged. `client npm run
verify:i18n` passed with `629` Credit keys and all Credit/admin surfaces,
`client npm run typecheck` passed, the full `client npm run build:ci` completed
with exit `0` including all configured focused regressions and the production
Vite bundle, and `git diff --check` passed. The bundle retained only the
existing chunk-size warning. Authenticated locale/timezone/DST, responsive,
keyboard, and deeper failure-path evidence remain open. Exact next action:
continue the next unresolved Package G evidence gap with Credit disabled.

Partner-ledger loading safety evidence (2026-09-15): partner ledger requests
now scope their loading cleanup to the current request, allow an operator to
switch partners while a prior read is pending, invalidate the old response,
and disable every funding control while the selected ledger is loading. Funding
submission also exits before parsing or posting when a load or save is active.
The deployment wiring regression passed `23/23`, client typecheck passed, and
`git diff --check` passed. Ledger data, idempotency keys, currency parsing,
and external funding semantics were unchanged. Exact next action: continue
the next unresolved Package G workflow or failure-path evidence with Credit
disabled.

Credit rail stale-operator protection evidence (2026-09-15): the Super Admin
rail mutation now sends the state it observed with its requested target. The
controller validates that optional precondition as a strict boolean, and the
service checks it after acquiring the existing transaction lock. A stale tab
therefore receives public `409 credit_rail_state_conflict` before any feature
flag update or audit write; the shared error handler intentionally omits
internal conflict details. `server/__tests__/oxsteedCredit.test.js` and
`server/__tests__/deploymentReleaseWiring.test.js` passed together at
`144/144`, client TypeScript passed, and `git diff --check` passed. Production
activation prerequisites and the disabled rail safeguard were unchanged.
Exact next action: continue the next unresolved Package G workflow or
failure-path requirement with Credit disabled.

Super Admin partner workflow localization evidence (2026-09-15): the main
partner enrollment and directory workflow now uses the Credit namespace for
enrollment guidance, restaurant and currency fields, accessible search/filter
labels, status options, CSV action, empty states, pagination, and partner
controls. The five catalogs share the complete `687`-key Credit contract;
`client npm run verify:i18n` passed all namespace and surface checks, the full
`client npm run build:ci` passed with exit `0`, the focused deployment wiring
suite passed `24/24`, client TypeScript passed, and `git diff --check` passed.
Existing enrollment validation, status transitions, and activation safeguards
were unchanged. Exact next action: localize the next bounded agreement or
settlement operator slice, then run its affected checks with Credit disabled.

Agreement lifecycle localization evidence (2026-09-15): the Super Admin
agreement lifecycle table now uses the Credit namespace for its CSV action,
empty state, lifecycle headings, coverage and limit fallbacks, partner/date
values, and submit/approve/suspend/reactivate actions across `en/es/fr/ht/ar`.
Agreement validation, approval prerequisites, lifecycle transitions, and
activation safeguards were unchanged. `client npm run verify:i18n` passed with
`702` Credit keys and all surface checks, `client npm run typecheck` passed,
the full `client npm run build:ci` passed with exit `0`, the focused deployment
wiring suite passed `24/24`, and `git diff --check` passed. The build retained
only the existing dynamic-import and chunk-size warnings. Exact next action:
localize the next bounded settlement/operator slice, then run its affected
checks with Credit disabled.

Settlement queue localization evidence (2026-09-15): the Super Admin
settlement queue now localizes its queue heading, filtering description,
partner/status filter labels, accessible filter names, status options, CSV
export, and pagination action across `en/es/fr/ht/ar`. The underlying snapshot,
payment, reconciliation, and settlement controls were unchanged.
`client npm run verify:i18n` passed with `714` Credit keys and all surface
checks, `client npm run typecheck` passed, the focused deployment wiring suite
passed `24/24`, and `git diff --check` passed. The compressed snapshot form and
deeper settlement failure-path browser coverage remain open. Exact next action:
continue the bounded settlement form localization and operator failure-path
coverage with Credit disabled.

Settlement stale-transition protection evidence (2026-09-15): settlement
status mutations now accept an optional observed status in camel- or
snake-case. After the existing row lock, the service rejects a stale view with
`409 credit_settlement_state_conflict` and structured current/expected fields
before payment, settlement updates, or audit writes; the client sends the
observed status on every transition. The admin service and deployment wiring
suites passed `67/67`, client TypeScript and five-locale verification passed,
and `git diff --check` passed. Existing transition rules, payment-reference
requirements, reversal controls, and Credit-disabled activation safeguards were
unchanged. Exact next action: continue the next unresolved Package G
failure-path/browser requirement with Credit disabled.

Credit lifecycle stale-state protection evidence (2026-09-15): partner,
agreement, and settlement status mutations now accept strict optional observed
states and compare them after their existing row locks. A stale operator view
receives a resource-specific `409` before lifecycle updates or audit writes;
the Super Admin client sends the observed state for each transition. The admin
service and deployment wiring suites passed `69/69`, client TypeScript and
five-locale verification passed at `714` keys, and `git diff --check` passed.
Existing lifecycle transition rules, approval prerequisites, payment and
reversal controls, and Credit-disabled activation safeguards were unchanged.
Exact next action: continue the next unresolved Package G provider/outage or
deployment verification requirement using isolated environments.

Fresh current-artifact isolated verification (2026-09-15): the rebuilt
loopback-only Colima project `oxsteed-credit-test-20260915t23051789513551z-72424`
started from the current worktree with migrations `522/522`, Redis `PONG`,
dedicated ledger signing configuration, and `railEnabled=false` by default.
Its synthetic smoke and accounting flows passed; real race checks passed with
one winner for capture/release, expiry/capture, refund/refund, issuance-cap,
conversion-cap, settlement-overlap, and restaurant-permission contention, plus
identical replay suppression and conflicting-key rejection. Queue recovery
passed atomic duplicate suppression, delayed retry, lease renewal, stale-lease
reclamation, dead-letter preservation/replay, and reclaimed-lease fencing.
Redis and PostgreSQL stop/restart probes returned expected `503 not_ready` and
recovered to `200 ready` without touching production. The two-partner
30-second workload passed with `0%` errors for `6650` account reads, `1340`
transaction reads, `1130` eligibility reads, and `48` purchases; p95 values
were `56.09ms`, `330.45ms`, `340.56ms`, and `3428.79ms` respectively, below
all thresholds. Both independent partner payables ended at `240` cents with
zero reservations; process RSS delta was `12.55 MB` and container memory
delta was `15.84 MB`. The isolated containers, network, and volumes were
removed after verification. Exact next action: complete the remaining
authenticated 200%-zoom/locale browser evidence and live-configuration
handoff checks; keep the production Credit rail disabled.

Credit worker localization evidence (2026-09-15): the maintenance-worker
panel now uses stable translated labels for notification outbox, hold expiry,
entitlement expiry, reconciliation, integrity, restaurant-wallet watchdog jobs,
and common result fields across `en/es/fr/ht/ar`. Checkpoint status, failure
detection, result values, and recovery behavior were unchanged. `client npm run
verify:i18n` passed with `645` Credit keys and all Credit/admin surfaces,
`client npm run typecheck` passed, the full `client npm run build:ci` completed
with exit `0`, and `git diff --check` passed. The production bundle retained
only the existing chunk-size warning. Authenticated locale/timezone/DST,
responsive, keyboard, and deeper failure-path evidence remain open. Exact next
action: continue the next unresolved Package G evidence gap with Credit
disabled.

Restaurant-ledger localization evidence (2026-09-15): the Super Admin partner
ledger now localizes funding-table headings, retry and empty-state labels, the
amount placeholder, and the system actor fallback across `en/es/fr/ht/ar`.
Ledger account statuses use the shared Credit status contract and ledger
timestamps use the selected document language. Funding validation, idempotency,
currency selection, and mutation payloads were unchanged. `client npm run
verify:i18n` passed with `573` Credit keys and all Credit/admin surfaces,
`npm run typecheck` passed, `client npm run build:ci` passed all configured
focused tests including auth-refresh `2/2`, and the production Vite bundle
completed with only existing chunk/import warnings. The patched runtime retry
proof is recorded above. Exact next action: continue the next unresolved
Package G evidence gap with Credit disabled.

Status-contract correction evidence (2026-09-15): the shared mapping now covers
`revoked` as a red, localized lifecycle state on both Credit admin surfaces and
uses the unavailable label for unknown values. The focused status suite passed
`2/2`, five-locale parity and surface checks passed at `445` keys, TypeScript
passed, and the post-edit production bundle built successfully; the remaining
browser and live-configuration gaps are unchanged.

Infrastructure recovery evidence (2026-09-15): `server/utils/redis.js` now
retains its configured ioredis client and retries transient disconnects with a
bounded five-second backoff; `server/__tests__/redisLifecycle.test.js` plus
readiness coverage passed `13/13`. The reusable
`bash scripts/credit-isolated-env.sh failures` command rebuilt isolated artifact
`content-3653ce07320d1b0e`, observed real Redis and PostgreSQL outages as
dependency-specific `503 not_ready` responses, restored both services to
`200 ready`, and then passed isolated smoke, accounting, race, and
`queue-recovery` checks. The harness is disposable and loopback-only; no live
production container, wallet, database, or Credit activation setting was used.
This checkpoint supersedes the earlier isolated `521`/older-release references
for infrastructure recovery; production remains intentionally at migrations
`516/516` with Credit disabled.
The full backend regression after this change passed `156/156` suites and
`1120/1120` tests; the logged dependency/provider failures were intentional
failure-path fixtures.

Performance evidence instrumentation (2026-09-15): the workload verifier now
reports `errorRatePct` per read/write workload and bounded process RSS, heap,
external memory, maximum RSS, and CPU before/after/delta snapshots, plus
container cgroup memory and CPU when available. The deployment wiring suite
passed `22/22` with these fields enforced. A fresh rebuilt Colima artifact ran
the sustained two-partner workload with server-container resource capture for
30-second read phases; all read and write phases returned `0%` errors and stayed
under their p95 thresholds, and both independent payable balances were exact
with zero reservations. The remaining production-duration observation cannot
be performed without enabling live Credit, which remains an intentional
activation safeguard; no live value movement was used as a test.

Full backend regression after lifecycle guards (2026-09-15): the complete
server Jest command `npm test -- --silent` passed `156/156` suites and
`1127/1127` tests. The emitted error lines were expected simulated failures
covering validation, unavailable providers, database/Redis outages, queue
failure, webhook rejection, integrity mismatch, and malware-scanner fallback;
none represented an uncaught test failure. This closes the backend regression
checkpoint for the current worktree, but does not close the remaining browser,
provider-sandbox, live-artifact, or production-duration evidence rows. Exact
next action: localize the compressed settlement snapshot/reconciliation form
and settlement table controls, then run the focused client checks with Credit
disabled.

Settlement snapshot and payout-control localization evidence (2026-09-15):
the compressed Super Admin settlement form and payable table are now rendered
through a dedicated localized component. Partner/agreement selection, period
fields, payment and reconciliation reasons, integrity results, payable totals,
provenance, and approve/paid/void controls use the Credit namespace across
`en/es/fr/ht/ar`; observed settlement status is still sent with every guarded
transition. `npm run verify:i18n` passed with `741` Credit keys, TypeScript
passed, the deployment wiring suite passed `27/27`, `npm run build:ci` exited
`0`, and `git diff --check` passed. The old inline block is no longer rendered;
Credit activation safeguards and financial mutation handlers were unchanged.
Exact next action: localize the reconciliation-history and dispute operator
controls, then run the focused client checks with Credit disabled.

Operator evidence-surface localization checkpoint (2026-09-15): reconciliation
history, disputes, audit history, and payout recovery now render through
dedicated components using stable Credit translation keys across
`en/es/fr/ht/ar`. Filters, empty states, immutable evidence labels, resolution
controls, and reversal recovery wording are localized while pagination,
idempotency, observed-state guards, and compensating-journal safeguards remain
unchanged. `npm run verify:i18n` passed with `792` Credit keys, TypeScript
passed, the deployment wiring suite passed `27/27`, `npm run build:ci` exited
`0`, and `git diff --check` passed. Exact next action: authenticated browser
verification at available zoom and locale/timezone combinations, followed by
provider-sandbox and live-artifact handoff checks; keep Credit disabled.

Verifier coverage for webhook ordering migration (2026-09-15): the production
verifier now fails closed unless migration `522_webhook_event_ordering.sql` is
recorded, both `webhook_event_receipts` and `webhook_event_watermarks` exist
with their required ordering fields, and the receipt status and object-order
indexes are present. The focused webhook, Credit verifier, and deployment
wiring suites passed `166/166` tests; the full backend regression passed
`156/156` suites and `1129/1129` tests. `git diff --check` passed. This is
read-only verification hardening and does not change Credit activation or
production data. Exact next action: continue the next unresolved Package G
provider-sandbox/live-artifact evidence gap, keeping Credit disabled.

Fresh-volume concurrency harness correction and artifact evidence (2026-09-16):
the disposable race verifier now enables only its isolated rail before any
bootstrap load, provisions enough bounded synthetic balance for the complete
workload, and counts empty expiry batches as zero transitions instead of
mistaking JavaScript truthy arrays for committed state changes. A fresh rebuilt
Colima project `oxsteed-credit-test-20260916t00021789516959z-79041` applied
migrations `522/522`; the artifact verifier reported `ok=true` with no missing
webhook schema, indexes, or ledger/audit violations. Fresh-volume races passed
one-winner capture/release and expiry/capture, issuance and conversion caps,
settlement overlap, refund/refund, identical replay, conflicting-key rejection,
restaurant isolation, and final reserved balance `0`. Real Redis queue recovery
also passed atomic enqueue, delayed retry, lease renewal/reclamation, dead-letter
preservation/replay, and duplicate suppression. Focused Credit/webhook/deployment
tests passed `168/168`; full backend regression passed `156/156` suites and
`1131/1131` tests; `git diff --check` passed. The disposable project and volumes
were removed. Exact next action: continue provider-sandbox/event-delivery and
live-artifact handoff checks with Credit disabled.

Guarded Stripe test-mode delivery evidence (2026-09-16): the isolated harness
now exercises the actual `/api/webhooks/stripe` HTTP route using the installed
Stripe SDK's synthetic test-mode signature generation. Fresh Colima artifact
`oxsteed-credit-test-20260916t00131789517586z-80038` reached readiness with
migrations `522/522`, then verified valid delivery, duplicate replay
suppression, stale-event suppression, and invalid-signature rejection. The
database contained two processed receipts and the watermark pointed to the
newest event; the disposable project and volumes were removed afterward.
The provider verifier is fail-closed to `NODE_ENV=test`, disposable database
and project names, loopback API, and explicit provider-test mode, so it cannot
be used against production accidentally. Focused wiring/Credit/webhook tests
passed `169/169`; this check does not claim live Stripe Dashboard event
delivery because the Stripe CLI and a shell test secret were unavailable.
Exact next action: run the remaining authenticated browser locale/timezone,
200%-zoom, and failure-path matrix, then document live provider/monitoring
handoff items without enabling Credit.

Isolated startup race hardening evidence (2026-09-16):
`scripts/credit-isolated-env.sh` now waits up to 60 seconds for the disposable
app port to publish before invoking readiness, preventing a normal PostgreSQL
initialization race from being reported as a harness failure. A fresh Colima
project `oxsteed-credit-test-20260916t00221789518121z-81114` built from the
current worktree, reached `200 ready` at migrations `522/522`, passed the
guarded Stripe provider verifier and isolated customer smoke, and was removed
with its network and volumes. The wiring suite passed `28/28`, shell syntax
passed, and production containers, wallets, database, and Credit activation
state were untouched. Exact next action: continue the remaining authenticated
browser locale/timezone, 200%-zoom, and failure-path matrix.

Audit-filter localization evidence (2026-09-16): the Super Admin Credit audit
history filters now use the shared Credit translation namespace for action,
resource, partner, and request-correlation labels, including the all-partners
option and partner fallback. All five catalogs remain in parity at `793` Credit
keys; `client npm run build:ci` passed the configured Credit regressions, date
and idempotency guards, request guards, status/error policies, auth-refresh and
realtime checks, i18n surface verification, TypeScript, and the production
bundle. Existing audit filtering, pagination, and immutable evidence behavior
were unchanged. Exact next action: continue authenticated browser
locale/timezone, 200%-zoom, and failure-path evidence; keep Credit disabled.

Current isolated package checkpoint (2026-09-16): fresh Colima artifact
`oxsteed-credit-test-20260916t00341789518841z-82591` built from the current
worktree, reached `200 ready` with migrations `522/522`, and passed the guarded
Stripe test-mode HTTP verifier, customer smoke, accounting, concurrency,
performance, and Redis/PostgreSQL failure-recovery checks. The synthetic
Super Admin password-plus-TOTP verifier passed all 11 Credit read surfaces with
`railEnabled=false` after the harness now suspends the disposable rail before
and after mutating checks. CUA browser evidence on this artifact showed the
Spanish Credit wallet, Arabic RTL OxSteed Credit page, USD/JPY currency
switching, no horizontal overflow at the available viewport, and keyboard focus
reaching the Credit controls with no warning/error console logs. Focused
backend regressions passed `151/151`, i18n parity and surface checks passed,
shell syntax and `git diff --check` passed. The artifact remains disposable
and production containers, wallets, database, and Credit activation state were
untouched. Exact next action: complete the remaining exact viewport/200%-zoom,
timezone/DST, long-string, and deeper operator failure-path browser evidence;
then validate the patched release artifact and live monitoring/provider
handoffs without enabling Credit.

Responsive tablet defect correction checkpoint (2026-09-16): exact CUA browser
verification found the authenticated Restaurant Credit hero action row
overflowing at `768x1024` (`scrollWidth 815` vs `clientWidth 762`) while
`390x844` and `1440x900` were clean. `client/src/pages/food/RestaurantCreditPage.css`
now stacks that hero at `max-width: 900px`. The rebuilt Docker artifact
`oxsteed-credit-test-20260916t00491789519782z-84412` passed exact authenticated
checks at `390x844`, `768x1024`, and `1440x900` with no horizontal overflow and
no warning/error console logs; `client npm run build:ci` passed. The same
artifact's guarded Stripe test-mode HTTP verifier passed valid delivery,
duplicate and stale suppression, invalid-signature rejection, receipt
persistence, and watermark advancement; the disposable project and volumes
were removed. Browser keyboard and localized/RTL checks remain source-dependent;
exact 200% zoom remains unavailable in the current browser capability. Exact
next action: continue timezone/DST, long-string, 200%-zoom, and deeper operator
failure-path evidence, then validate live provider/monitoring/backup handoffs
without enabling Credit.

## Completion Gate

The code-completion goal is complete only when every `implemented` row has been
run against the intended artifact and database, and every `partial` row has
its listed evidence or an explicitly accepted engineering exception. A live
provider or human launch dependency may remain in the launch handoff, but it
must not be represented as a passing software verification result.
