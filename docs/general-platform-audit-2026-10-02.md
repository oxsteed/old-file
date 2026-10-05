# OxSteed General Platform Audit

**Audit date:** 2026-10-02
**Repository:** oxsteed/old-file
**Branch:** old-files-claude
**Audited revision:** d437c56df671a8d86600c526abd3b3369062e560
**Production release observed:** content-5bd7670aab394fb7
**Scope:** current web/API source, CI, deployment topology, readiness endpoints, backup evidence, security configuration, administration surfaces, and existing audit/hardening records.

## Executive conclusion

OxSteed is materially stronger than the earlier audit snapshots. The current branch is clean and synchronized with GitHub, the latest CI run is green, the server suite passes, client production checks pass, the migration rehearsal passes, the live application is healthy, all expected migrations are applied, and the admin route/role matrix reports no phantom or unprotected manifest routes.

This is not sufficient evidence to certify a worldwide production platform for 3,500 employees and six million users. No P0 application outage or confirmed authorization bypass was found in this pass, but several P1 controls are either missing in production or not evidenced at the required scale. The main risks are operational rather than a single broken page: one physical failure domain, missing release provenance, disabled repository security gates, unresolved translation fallbacks, process-local state that needs a documented scaling contract, and incomplete live/provider/restore/load evidence.

The release decision is:

> **Application release candidate: pass. Enterprise-scale production certification: not yet proven.**

Remaining work is separated into:
1. **Code backlog:** changes that can be implemented and tested in this repository.
2. **Deployment/configuration:** Coolify, GitHub, Cloudflare, provider, or environment work.
3. **Live evidence:** tests against populated data, restored backups, real providers, real accounts, and scale conditions.

## Evidence collected

### Repository and CI

- git status is clean and the branch is synchronized with origin/old-files-claude.
- Latest commit d437c56d is the current client security lockfile refresh.
- GitHub Actions run 37054146624 for d437c56d completed successfully.
- Server verification: 334 suites passed, 3 skipped; 3,524 tests passed, 46 skipped.
- PostgreSQL migration rehearsal passed after applying every migration twice.
- Client localization, type, and production build checks passed.
- node scripts/admin-route-matrix.cjs passed for 136 admin routes and reported no credential or manifest violations.
- GitHub Dependabot reports zero open alerts and both npm audits report zero known vulnerabilities.

### Live application

- /health returned HTTP 200 with status ok.
- /ready returned HTTP 200 with status ready.
- Live migrations: 652 expected and 652 applied; pending and unexpected counts are zero. This is the file count, not the highest migration number; numbered migrations 653 and 654 are included because the numbering contains historical gaps.
- Database, Redis, credit ledger, credit rail, realtime, workers, traffic, and shutdown readiness checks report healthy.
- /api/health/deep returned HTTP 200 with database and Redis checks passing.
- /sitemap.xml returned HTTP 200 and valid XML.
- Release metadata contains a content release string but gitSha, imageDigest, and deploymentId are all null.
- Live capabilities report SMS OTP, background checks, and geocoding as unavailable or unconfigured; AI support is available.

### Host and deployment

- Docker is using the intended colima context.
- The application, ClamAV, PostgreSQL/PostGIS, Redis, Coolify, Coolify DB, Coolify Redis, realtime, proxy, and sentinel containers are healthy.
- Current production topology has one application host, one application database, one Redis, and local upload storage. This is a working deployment, not a highly available or independently failed architecture.
- Local backup monitoring reports state=OK for snapshot 20261002T204053Z; timestamped snapshots are present and checksum validation is part of the monitor contract.
- Repository backup scripts support an optional separate mirror and Coolify documentation describes a Cloudflare R2 destination, but this audit did not verify a current R2 object or restore a current snapshot into an independent environment.

## Findings by priority

### P1 - Must close before enterprise-scale certification

#### P1.1 Production release provenance is incomplete

**Evidence:** /ready reports release=content-5bd7670aab394fb7, but releaseMetadata.gitSha, imageDigest, and deploymentId are null.

**Risk:** Operators cannot prove exactly which source revision and image serve traffic during an incident, rollback, security investigation, or customer-impacting data event.

**Classification:** Deployment configuration and release process. The code already exposes the fields.

**Acceptance:** Coolify injects GIT_SHA, IMAGE_DIGEST, and COOLIFY_DEPLOYMENT_ID; /ready returns non-null values; values match the deployed image and deployment record.

#### P1.2 Single-host failure domain

**Evidence:** Current Docker topology places application, database, Redis, uploads, and deployment control on the same MacBook/Colima host.

**Risk:** Host, disk, Colima, accidental shutdown, or network failure can remove application availability and impair database, queue, realtime, and local-upload recovery. Six million users cannot be served reliably from this topology without a documented degraded mode and recovery objective.

**Classification:** Infrastructure architecture, not a safe application-only fix.

**Acceptance:** Define and test RTO/RPO; place database, queue, uploads, and application behind independent failure domains or document a staged availability plan; execute a restore/failover drill; monitor from outside the host.

#### P1.3 Backup presence is not recovery proof

**Evidence:** Local backup monitor is currently OK and timestamped local snapshots exist. Scripts validate dump structure and checksums. This audit did not verify a current Cloudflare R2 object, restore a current snapshot into an independent database, or complete full application recovery.

**Risk:** A backup can be fresh but unusable, incomplete, inaccessible, or coupled to the failed host. R2 copy and restoration are separate controls.

**Classification:** Live infrastructure/evidence.

**Acceptance:** Record a current R2 object and checksum, restore the latest backup into isolated PostgreSQL with network access disabled, apply migrations, start the artifact, verify /ready and representative records, and record measured RTO/RPO.

#### P1.4 Repository security gates are incomplete

**Evidence:** GitHub API reports code scanning disabled, secret scanning disabled, the branch is not protected, Actions permissions allow write by default, and SHA pinning is not required.

**Risk:** Dependency scanning alone does not detect committed secrets, code-level regressions, unsafe workflow changes, or unreviewed direct pushes. Green CI is not equivalent to a protected release pipeline.

**Classification:** GitHub configuration plus CI hardening.

**Acceptance:** Enable CodeQL or equivalent code scanning, secret scanning and push protection, branch protection with required CI/review, least-privilege workflow permissions, pinned third-party actions, and production environment approval.

#### P1.5 Localization has passing parity but visible fallback debt

**Evidence:** npm run verify:i18n passes parity but reports 325 static t() references without catalog keys across 49 files: 46 render raw keys and 279 use English defaultValue fallbacks. Latest CI includes examples such as common.failedSave and adminNav.searchDesktop.

**Risk:** A passing parity check can hide untranslated labels, raw key names, different wording by route, and broken RTL/admin experiences. This is a functional and trust issue for all five supported locales.

**Classification:** Code backlog.

**Acceptance:** Zero raw translation keys rendered to users; all new user-facing keys exist in all five catalogs or are explicitly non-user-facing; CI fails on new missing keys; Arabic layout and assistive labels are checked on the same routes as English.

#### P1.6 Process-local state needs a scale contract

**Evidence:** Realtime broadcast uses the Redis adapter and cross-process presence support exists, but several services still maintain process-local Maps for connection tracking, socket viewers, online state, delivery idempotency fast paths, or customer-location throttling.

**Risk:** With multiple application processes, restart or load-balancer movement can lose local state. Effects can include stale presence, missing disconnect cleanup, duplicate events, or inconsistent throttling. The database is authoritative for some flows, but this guarantee is not uniform across every Map.

**Classification:** Code and architecture backlog.

**Acceptance:** Document each process-local structure as cache-only, connection-local, or authoritative. Ownership, lease, throttle, idempotency, and delivery decisions must use PostgreSQL/Redis with TTL and fencing. Add a two-process reconnect, duplicate, delayed-event, and worker-ownership test.

#### P1.7 Provider availability lacks a complete operating model

**Evidence:** Live capabilities report SMS OTP, background checks, and geocoding as unavailable/config missing.

**Risk:** A page can appear available while a critical action is impossible, or a fallback can silently change verification, address, pricing, or scheduling behavior.

**Classification:** Configuration plus code/UX contract.

**Acceptance:** Every provider-backed feature has capability state, owner, alert, fallback, and customer-facing explanation. Critical flows are disabled or queued safely when the provider is unavailable. Admin shows status without exposing secrets.

#### P1.8 Enterprise-scale load evidence is missing

**Evidence:** CI covers unit, integration, browser, and fresh migration checks, but no current evidence demonstrates six-million-user data volume, 3,500-employee concurrency, geographic latency, queue saturation, websocket fanout, large tenant exports, or provider throttling.

**Risk:** Pagination and database budgets reduce risk but do not prove capacity. Large tenants and incidents may expose locks, unbounded fanout, slow reporting, or noisy-neighbor failures.

**Classification:** Live evidence and performance engineering.

**Acceptance:** Build anonymized scale fixtures; test read/write, admin, realtime, search, delivery, food, credit, messaging, and upload loads; set SLOs/budgets; test regional latency and degraded providers; document limits and scaling triggers.

### P2 - Important code and operating gaps

#### P2.1 One Truth investigation coverage is bounded, not complete

The existing cap prevents unbounded requests, but the current audit record states suspect discovery is capped at 5,000 users. At global scale this needs an indexed, versioned background job with persisted progress, coverage boundaries, case assignment, reviewer access grants, deduplication, and resumable exports.

#### P2.2 Careers side effects need a durable workflow

Core hiring mutations are transactional, but external email, push, calendar, and provider notifications need a durable outbox, retry policy, deduplication, failure queue, and operator replay controls. A successful application or offer must not be confused with successfully delivered notification.

#### P2.3 Worldwide workforce governance is incomplete

For 3,500 employees, add country/region ownership, legal-entity and timezone scope, reviewer assignment, conflict-of-interest controls, effective-dated permissions, access recertification, break-glass access, emergency revocation, separation-of-duties reports, and offboarding SLAs.

#### P2.4 Browser token storage remains a security tradeoff

The web client and chat widget read bearer tokens from localStorage. This is convenient for the existing SPA and mobile-style flows, but an XSS issue can exfiltrate the token. Long-term web posture should move browser sessions to secure HttpOnly SameSite cookies with CSRF protection and a scoped short-lived access-token strategy. This requires coordinated SPA, API, realtime, connector, and mobile compatibility work.

#### P2.5 Operations need a unified exception inbox

The platform has audit, payment, credit, support, delivery, and operations pages. At scale, operators need one queue for failed webhooks, stuck outbox entries, provider outages, refund mismatches, payout holds, delivery exceptions, support escalations, backup failures, and authorization anomalies, with correlation ID, owner, SLA, severity, replay safety, and resolution evidence.

#### P2.6 Degraded states need a shared design contract

The code has feature-specific loading and unavailable states, but the platform needs a shared contract for not configured, temporarily degraded, pending provider confirmation, requires human review, and retry safe. Each state must show the next action and must not imply that a quote, payment, booking, or delivery is confirmed when it is not.

#### P2.7 Search and reporting need retention and privacy boundaries

Global admin search, exports, visitors, messages, and audit pages need explicit retention, tenant filtering, purpose limitation, export-size limits, redaction, asynchronous jobs, and legal-hold behavior. Verify that support agents can search only records granted for the current case or business.

## Administration and business operations review

The current admin navigation exposes expected operational and super-admin areas, and the route matrix confirms route/grant consistency. The following controls should be first-class operations rather than spread across individual tabs:

- release provenance and rollback status;
- queue/outbox age and dead-letter replay;
- provider capability and webhook health;
- tenant, business, region ownership and transfer;
- workforce onboarding, certification, scheduling, leave, and offboarding;
- fraud, sanctions, chargeback, refund, and payout exception queues;
- backup freshness, R2 copy status, restore-test history, and recovery drill status;
- rate-limit, bot, abuse, and account-takeover incidents;
- data export, deletion, retention, legal-hold, and privacy-request status;
- operational SLOs, capacity, noisy-neighbor alerts, and customer-impact scope;
- feature-flag rollout, approval, cohort, expiry, and rollback controls;
- dependency/provider inventory with owner and credential rotation date.

Individual tabs can remain, but the overview must connect them by correlation ID, work context, business, tenant, customer, order/job/delivery, payment, and support case. A link between records must never grant access.

## Design and accessibility review

### Strengths observed

- Existing pages use responsive layouts and shared components in many areas.
- The project has explicit English, Spanish, French, Haitian Creole, and Arabic locale support.
- The admin route model and permissions are centralized enough to test with a matrix script.
- Loading, retry, empty, and reduced-motion patterns exist in several major workflows.

### Improvements required

- Remove raw translation keys and English fallback copy from live surfaces.
- Standardize status semantics across quote, booking, delivery, order, credit, invoice, support, and provider states.
- Make every destructive or financial action show authority, amount, scope, side effects, retry behavior, and recovery path.
- Keep table filters and pagination synchronized to the URL so refresh and browser navigation preserve operator context.
- Provide accessible error summaries and field-level recovery; do not rely on toast messages alone.
- Test Arabic RTL with long labels, tables, dialogs, charts, and keyboard focus; catalog parity does not validate layout.
- Add mobile tests for dense admin tables, dispatch, food queues, payment review, and support conversations.
- Keep customer-facing fulfillment and routing source-neutral while giving authorized operators enough detail to act.

## Verification matrix

| Area | Current result | Certification state | Required next proof |
| --- | --- | --- | --- |
| Server unit/integration | 334 suites and 3,524 tests passed | Pass for current source | Keep required in protected CI |
| Client type/build/smoke | Passed | Pass for current source | Add strict missing-key gate |
| Migration rehearsal | Fresh PostgreSQL, twice-applied run passed | Pass for clean schema | Run populated upgrade rehearsal |
| Admin route/grant matrix | 136 routes, no violations | Pass for route contract | Authenticated behavior matrix for high-risk actions |
| Live health/readiness | Healthy, 652/652 migrations | Pass at observed moment | Alert and retain history; verify provenance |
| Backup freshness | Local monitor OK | Partial | R2 object and independent restore evidence |
| Realtime | Redis adapter and readiness healthy | Partial | Two-process reconnect/fanout/lease test |
| Providers | Several optional providers unavailable | Partial | Capability ownership, alerts, and safe fallbacks |
| Localization | Parity pass with 325 unresolved static references | Partial | Resolve raw keys/default fallbacks and RTL browser checks |
| Repository security | Dependabot clean; code/secret scanning disabled | Partial | Enable security gates and branch protection |
| Scale | No six-million-user evidence | Not proven | Load, soak, regional, and failure testing |
| Recovery | Scripts and snapshots exist | Not proven | Current restore drill with measured RTO/RPO |

## Ordered implementation backlog

### Track A - Safe code changes

1. Make missing translation keys a CI failure for new and changed files, then eliminate the existing raw-key and fallback inventory.
2. Add a shared capability-state contract and admin/provider health projection.
3. Replace process-local authoritative throttles, leases, and ownership with Redis/PostgreSQL primitives and add two-process tests.
4. Build the unified exception inbox for outbox, webhooks, payments, payouts, delivery, support, backups, and provider incidents.
5. Build the resumable One Truth investigation job and Careers external-side-effect outbox.
6. Add retention, redaction, asynchronous export, and legal-hold contracts for admin search/reporting.
7. Migrate browser authentication toward secure cookie sessions after a compatibility design covering SPA, websocket, connector, and mobile flows.

### Track B - Deployment and repository controls

1. Populate and verify release metadata in Coolify.
2. Enable GitHub branch protection, CodeQL/code scanning, secret scanning with push protection, least-privilege Actions permissions, and action SHA pinning.
3. Add external monitoring for /ready, queue age, backup age, R2 copy status, disk, database, Redis, provider webhooks, and certificate/domain health.
4. Define the staged move from the current single-host topology to independent database, queue, storage, and application failure domains.

### Track C - Live evidence and operations

1. Restore the latest backup into an isolated environment and record RTO/RPO.
2. Verify the current R2 backup object and perform a delete/restore simulation without touching production data.
3. Run authenticated browser journeys for each admin role and each high-risk financial, access, delivery, support, credit, and profile-visibility action.
4. Run provider sandbox/live-like webhook, outage, replay, refund, payout, SMS, background-check, AI, geocoding, and storage tests.
5. Run scale fixtures and a soak test representing global tenants, employees, realtime connections, queues, uploads, search, exports, and payments.
6. Re-run the audit against the deployed image and attach release metadata, logs, dashboards, restore record, and browser evidence.

## Final disposition

The current revision should remain deployable: no immediate rollback is indicated by the evidence collected. It should not be described as fully enterprise-ready until the P1 evidence and controls above are closed. The highest-value next actions are release provenance, repository security gates, independent backup restoration, single-host resilience planning, and translation debt removal. Track these to completion rather than rediscovering them in future audits.
