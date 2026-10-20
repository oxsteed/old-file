# Growth Insights implementation

This implements the supplied design in `design-spec.md`. Its original "design only" header is historical; the subsequent owner request authorizes implementation. Collection, partner offers, campaign delivery and policy-notice delivery remain disabled. No policy notice or offer has been sent by this work. No production database, Redis, uploads, deployment or Credit activation setting has been changed.

The engine uses the `growthInsights` UI namespace. The existing `growth` copy and wholesale/financing routes remain separate. Current `/privacy` remains current during the notice period; the upcoming text is a generated draft in twenty languages, requiring professional translation review and legal approval. It must not be represented as approved copy.

Developer continuation instructions: [HANDOFF-2026-10-20.md](HANDOFF-2026-10-20.md). The checkpoint's remaining software work was completed on 2026-10-20 in five parallel tracks integrated back into this branch (see the completion notes below); the engine remains default-off everywhere and no production deployment or activation has occurred. This continuation adds the classification review workflow and migration 954. What remains open is acceptance work outside the codebase: legal/DPIA review, professional translation, the human-labelled evaluation dataset, infrastructure provisioning and rehearsal, partner agreements, and the companion-app update.

Completion tracks (2026-10-20, integrated into `codex/demand-sales-engine`):

- **Track 2 (ingestion):** domain hooks for every family with a clean transaction seam (about 30 emit sites across jobs, bookings, appointments, Direct quotes, food, commerce, subscriptions, account roles/tiers), guarded by `server/__tests__/growthDomainHooks.test.js` (`REQUIRED_HOOKS` fails if a hook is removed). Server event IDs are UUIDv7; the writer batches job-projection and centroid lookups (query count independent of batch size); the client tracker persists its session with 30-minute idle rotation; CI now enforces the instrumentation check. Documented as not yet hooked, because the underlying flows have no transaction to join and spec 5.3 requires same-transaction emission: `account.verified`, the main customer signup, `booking.requested`/`booking.cancelled` primary paths, `marketplace.order_paid`, `marketplace.cart_shared`, `planned_need.created`, `saved_search.created`, `food.menu_item_added`. `job.published` has no distinct transition (publish is create; `job.posted` covers it) and `job.unfilled_expired` has no transition or status; its two consumers (spec 10.1 weight, spec 21.1 unfilled rate) are computed by the rollup collector from the jobs table.
- **Track 3 (taxonomy and geography):** draft taxonomy seeding from the real category/skill/catalog/kit sources (1,429 merged nodes, 46 sensitive, always `status='draft'`); classifier parent inheritance, closed Ollama candidate lists (no best guess means no model call), source-language detection and guarded regex rules (migration 955 extends the taxonomy kind check); evaluation harness with the spec 8.5 gates, shipped with synthetic smoke fixtures only, the reviewed gold dataset (300 per vertical per language) remains an external human dependency and no quality-bar pass is claimed; GeoNames cities and admin1 imports with normalized postal matching; cluster finder rewritten (per-postal aggregation, one ST_DWithin pass, incremental greedy selection proven equivalent to brute force by a 300-trial property test) with stable persisted cluster IDs in migration 937; classification review queue read/action routes, transactional admin overrides, optional keyword/regex learning, audit logging and the localized admin queue UI are covered by migrations 954-955 and `growthClassificationReview.test.js`. The reviewed gold dataset remains open.
- **Track 5 (partners and campaigns):** SSRF-safe feed fetching (HTTPS, allowlist, public-DNS pinning) with CSV/JSON/XML/Google Merchant adapters and a fenced import job (migration 940); two consecutive absent runs mark a feed item unavailable; feed product images are deliberately not fetched or hot-linked (fetch/scan/self-host is a documented follow-up). Postbacks support partial adjustments and reversals, helper-assisted attribution that is never double-counted, and fraud holds; conversion money columns and CSV export are finance-gated with a fail-closed audit row. Campaign editing forces re-approval on content change; scheduling, review preview and results with holdout lift are built; quiet hours reschedule held pushes to 08:00 recipient-local plus jitter; global caps count legacy re-engagement and Discover digest sends via `marketing_contact_log`; auto-pause fires above 1% opt-outs with a 100-delivered floor (spec 21.3 names no floor; the floor was ratified by the owner on 2026-10-20 and recorded in the spec). In-app offer cards (impression only after 1s visible), the push opt-in prompt with the 90-day rule, and partner/campaign admin pages are built; offer email remains structurally disabled.
- **Integration (2026-10-20):** the batch geo resolver was unified with the place-centroid and admin1-alias fallbacks so batch and single resolution agree; `growth_clusters` exists once, canonically in migration 937 (deterministic `cluster_key`), and the suggestion producer and cluster route upsert by that key and pin the returned row id in segment definitions; the schema verifier fixture range now covers migrations 916-940; the eight governed metrics were completed in the evidence projections, the threshold-alert evaluator and the NL parser vocabulary (their coverage contracts are exact, and the full suite caught the omissions).

Track 1 continuation (2026-10-20, branch `growth-finish-t1`): the privacy foundation items from handoff section 1 are implemented and covered by `server/__tests__/growthPrivacyFoundation.test.js` (mocked stores only; no live Postgres/Redis/ClickHouse rehearsal). The consent ledger records IP-HMAC evidence (migration 936), export and ClickHouse result caps fail explicitly, and English upcoming-policy sections 2/3/4/6/7/8 now match spec 4.1. The fifteen notice-banner locales that lacked their own copy (bn, de, hi, id, it, ja, ko, pt, ru, sw, th, tr, ur, vi, zh) now carry **machine-draft** banner labels (`growthInsights` policy/changedOn/changesOn/dismiss) in both catalog trees. These drafts are pending professional translation review and must not be represented as reviewed copy.

## Working requirements matrix

| Area | Current source | Required next verification / implementation |
| --- | --- | --- |
| Rollout and controls | Additive Postgres schema; reviewed jurisdiction rules, server consent ledger (with IP-HMAC evidence since migration 936), default-off switches; effective date is max(last accepted send + 14 days, date quoted in notices) | Legal/DPIA/LIA and jurisdiction review, adult eligibility evidence; finish launch acceptance checks before enabling |
| Notices | Immutable batch payloads and idempotency keys; twenty-language draft copy; notices require an explicit scheduled/start action and review references | Production quota and deliverability review; professional translations |
| Tracking | Versioned schemas, signed-in eligible subjects only, route/key allowlists, bounded client queue, delegated capture; private controls excluded | Native client implementation, end-to-end load and privacy audit |
| Event store | Redis Streams, transactional domain outbox, fenced relay/writer, official ClickHouse client, replicated table migrations, aggregate distinct states | Two replicas / three Keeper members, dedicated Redis persistence and replica, backup/restore and load rehearsal |
| Domain events | About 30 hooks across 9 families inside existing transactions, guarded by a required-hooks test; UUIDv7 server event IDs; batched writer projections | Hooks for the flows that still lack a transaction seam (booking lifecycle primaries, marketplace order paid, account verified, main customer signup, planned need, saved search, menu item) require transaction wrapping in those flows first |
| Understanding | Rules-first classifier with parent inheritance, closed candidate lists and source-language detection; guarded regex rules; 1,429 draft taxonomy nodes seeded from real sources; evaluation harness with spec 8.5 gates (synthetic fixtures only); GeoNames place/admin1 imports; optimized cluster finder with stable persisted IDs; transactional classification review queue overrides, optional keyword/regex learning, audit logging and localized admin workflow (migrations 954-955, `growthClassificationReview.test.js`) | Reviewed gold evaluation data (external, human-labelled) |
| Insights | Job-event nightly rollup path; k-suppressed demand table; profile-based clusters; validated segment rules and immutable versions; statistical primitives | Complete (Track 4, branch growth-finish-t4, 2026-10-20): domain rollups for food/bookings/marketplace/Direct with spec 10.1 weights and profile-postal supply attribution; exact distinct 28-day vs prior-28-day windows from daily subject sets (migration 939) with trend, empirical-Bayes gap and spec 19 anomaly flags; propensity v1 transparent scorecards with top-3 reasons and decile calibration reports; full segment DSL (reviewed fact templates, lifecycle/verified, propensity clause, admin-region and persisted-cluster areas, exclusions, version N+1 editing, preview overlap, fail-closed audited member access); suggestion producer with Beta-Binomial scoring and aggregate-only Ollama re-rank stored as pending_review, rejection penalty for 30 days; 8 governed metrics (spec 21.1) with region anchors; demand heatmap with accessible table, freshness and attribution in the admin UI. Still open: cuisine/menu taxonomy nodes depend on Track 3 seeding; propensity outcomes are documented proxies; Direct free-text details are deliberately never classified |
| Campaigns | Five-language copy validation, explicit review/approval/queue, fresh TOTP, creator may approve, current grants/territory checked, frozen recipients, deterministic holdout, delivery leases and send-time checks; editing with forced re-approval, scheduling, review preview, results with holdout lift; precise quiet hours; global caps counting legacy sends; partner/campaign admin pages | End-to-end workflow verification and browser QA |
| Partners | Partner/offer create and activate APIs, signed links, domain allowlist, HMAC postbacks and replay ledger, exact minor-unit amounts by currency; SSRF-safe feed adapters (CSV/JSON/XML/Google Merchant) with fenced idempotent import; assisted attribution and fraud holds; finance-gated conversions list/export; partner admin UI | Partner sandbox rehearsal against real agreements; feed image fetch/scan/self-host follow-up |
| Rights | Tracking consent export, interest and offer export, queue erasure plus synchronous ClickHouse mutations; no forced terms re-acceptance; export/ClickHouse result caps fail explicitly (EXPORT_RESULT_LIMIT_EXCEEDED) and deletion cleanup is regression-covered against financial retention | Verify the added existing-analytics, segment and propensity exports and cleanup against populated predecessor stores; finish streaming, erasure audit counts, all deletion paths and backup rehearsal |
| Deferred by design | Offer email, owned catalog, propensity v2 | Phases 6-8 and their explicit entry criteria |

## Verification at the pushed handoff checkpoint (2026-10-20)

- The checkout began at the spec's `82711d2a` on `oxsteed/old-file`; implementation branch: `codex/demand-sales-engine`. The default branch was fetched again and remained at that commit before push.
- **Postgres:** all **20** additive migrations (916-935) passed the disposable predecessor-schema fixture plus assertions for disabled defaults, early activation rejection, append-only consent history and disabled offer email. The fixture's PostgreSQL also verified availability of the SHA-256 function used for existing Promote-account export/deletion matching. Superseded in part at integration (2026-10-20): the complete production migration history, all 916 files through migration 940, was applied cleanly to a fresh local database, and the fixture range now covers 916-940; a populated predecessor-schema export/deletion rehearsal remains fixture-level only.
- **ClickHouse:** loopback 25.8.33.6 fixture, one replica and embedded Keeper. C001-C004 applied twice; raw/aggregate exact-event deduplication, writer/reader denial of raw reads and rights-role physical deletion passed. C004 provides explicit materialized-view definer security so the writer keeps INSERT-only raw privileges. No production replica failover, restore or sustained-load claim follows.
- **Server:** final focused/regression run passed **11 suites, 457 tests**: growthEngine, privacyExport, broadcastTracking, businessMarketing, backgroundWorkers, adminSpaRoutes, auth, authCookies, authMiddlewareSecurity, discover and scheduledDeletionJob. Expected error-path logs are present; the authoritative Jest summary is green. Jest uses the repository's existing `--forceExit` option; this does not prove open-handle absence. The deletion fixture was updated to account for three additional privacy-cleanup queries, without changing its financial-retention assertions.
- **Client tracker:** all **5** Node tests passed, covering UUIDv7, route minimization, queue/byte limits, search scrubbing before queuing and rejected private/oversized props.
- **Instrumentation:** `--check` passed with 875 eligible source files and 2,453/2,453 named controls. This is static scanner coverage, not runtime or human privacy/accessibility acceptance.
- **Policy/locales:** twenty-language draft policy manifest is current. All pre-existing top-level keys in the 40 legacy/namespaced locale catalogs were checked against HEAD and preserved unchanged. New engine copy uses `growthInsights`, preserving the existing `growth` namespace.
- **Classification review:** the admin queue lists bounded pending/history pages; approve/reject transitions lock the queue row, write reviewed metadata, supersede prior intent history, create an audited `admin` intent on approval, and optionally upsert a guarded keyword or regex rule. Invalid decisions, nodes, notes, locales, regexes and pagination are rejected with stable errors. `server/__tests__/growthClassificationReview.test.js` covers listing, approval, rejection and validation paths.
- **Client:** complete `npm --prefix client run build:ci` passed; the distribution verifier checked 1,020 emitted assets. No visual browser QA or human screen-reader pass was performed.
- **Source hygiene:** all 67 changed/new server JavaScript files passed `node --check`; `git diff --check` passed. A narrow scan of newly added text found no AWS/GitHub/live-Stripe/private-key/webhook-secret patterns; this is not a full security audit.
- Remote CI status belongs to the draft PR/current commit and must be checked separately. No production deployment or activation was attempted.

## Verification for Track 4 completion (2026-10-20, branch growth-finish-t4, not pushed)

- **Server tests:** new `growthInsightsCompletion.test.js` 18/18; `growthEngine.test.js` 26/26; analytics suites green (analyticsGovernance, analyticsQueryBuilder with the builder golden extended to 26 metrics, metricsService, regionAuthFailClosed, businessAnalytics, performanceAnalytics, slaMetrics; analyticsNlParse remains env-skipped as on the base commit).
- **Real-database checks:** migration 939 applied cleanly to a disposable database cloned from the migrated test schema. `metricSnapshots.db.test.js` 6/6 and `analyticsRegionScope.db.test.js` passed against it. Every new SQL surface was executed against the migrated schema (propensity facts/outcome SQL for all 5 models, full-feature segment compiles including admin-region and cluster areas, insights computeCells, the domain collector's 14 sources, ratesFor, the nightly rollup run, and the suggestion producer's default-off skip). This caught and fixed two defects the string-level unit tests could not: the canonical role expression compared `u.role` to enum values that do not exist (`business_owner`), and the CTR builder referenced `offer_clicks.id` instead of `click_id`.
- **Client:** `npm --prefix client run build:ci` passed on the final tree. New `growthInsights` strings were added to en/es/fr/ht/ar in both the legacy and namespaced catalogs with key parity verified; sharded catalogs regenerate at build time. No visual browser QA or human screen-reader pass was performed; the heatmap ships with the accessible table view as the equivalent path.
- Everything remains default-off: the nightly rollups, the suggestion producer and the metrics serve only inside the existing rollout and permission gates.

## Verification at integration (2026-10-20, `codex/demand-sales-engine`, not pushed)

- **Migration history:** all 916 migration files through 940 applied cleanly to a fresh local PostgreSQL 16 + PostGIS database (the complete production history, not a predecessor fixture). The local test database was rebuilt from the same history after track work polluted it.
- **Server:** the full Jest suite on the integrated tree passed **8,631 tests, 0 failed** (99 skipped, environment-gated), including all six growth suites (278 tests) and the database-backed evidence, threshold-alert, region-scope and statement suites against the migrated test database. The first integrated run failed 13 tests in 5 suites, all traced to the governed metrics being registered without evidence projections, alert-evaluator entries and NL vocabulary, plus one meta count; fixed and re-verified (see the integration commit history).
- **Reviews:** two independent passes over the integrated diff. Spec compliance (pass B): handoff sections 1-5 complete except the items named in the completion notes above; no deferred phase was built or half-enabled; all switches default-off. Correctness (pass A): one medium defect (the governed commission metric counted assisted conversions) and three low defects (batch resolver candidate priority, unsuppressed campaign preview counts, silent export truncation) plus small items, all fixed in the follow-up commit and re-tested.
- **Client:** `npm --prefix client run build:ci` passed on the final tree (1,022 emitted assets verified); tracker tests 8/8; instrumentation check at 100% (2,453 of 2,453 named controls, 878 eligible files).
- No visual browser QA or human screen-reader pass was performed; no production deployment or activation was attempted.

## Rehearsal commands

Use the existing disposable Compose harness, with distinct `oxsteed-growth-*` project/volume names, for Postgres and Redis. Do not target production or use the legacy production-placeholder Compose file. `verifyGrowthSchema.js` refuses container names outside the dedicated growth test naming pattern and creates/drops only its own randomly named database.

```sh
node server/scripts/verifyGrowthSchema.js
node scripts/growth-policy-manifest.cjs --check
node --test client/scripts/growthTracker.test.mjs
node client/scripts/growthInstrumentation.mjs --check
npm --prefix server test -- --runTestsByPath __tests__/growthEngine.test.js
npm --prefix client run build:ci
```

`verifyGrowthClickhouse.js` additionally requires `NODE_ENV=test`, a loopback HTTP endpoint and the `test-01` replica macro. Its synthetic fixture credentials are deliberately non-production. Runtime application credentials must be supplied through the deployment secret store. Follow the installed AWS Secrets Manager skill and use runtime dynamic references with `asm-exec` for AWS-managed secrets; never print secret values.

## Activation boundaries

No automatic production activation is part of implementation. Do not set rollout review flags merely to populate the dashboard. The existing settings change-request workflow owns the tracking switch, caps and approved jurisdiction JSON. Campaign approval remains one authorized admin with fresh authentication and an audit trail; it does not change any money or settings separation rule.

Before collection: finish the source requirements and checks above, approve the DPIA/LIA and translations, verify adult eligibility, provision and rehearse the event stores and rights path, send the reviewed legal notice through an explicitly started plan, wait for its computed effective date, then use the existing settings approval flow. Native push-open measurement remains partial until the companion app updates are adopted. `ANALYTICS_NL_MODEL_ENABLED` and Credit activation controls are unchanged.

## Disposable fixture setup and cleanup

The temporary fixtures were created only for this task. The final handoff removes their containers and dedicated volumes after verification. Test credentials below are deliberately synthetic; do not copy them into production configuration.

From the repository root, recreate the Postgres/Redis fixture with the existing isolated harness. The local PostGIS image was already available on this Mac; use an appropriate test PostGIS image on another machine rather than assuming that local tag exists.

```sh
CREDIT_TEST_PROJECT=oxsteed-growth-isolated-test \
CREDIT_TEST_POSTGRES_VOLUME=oxsteed-growth-isolated-test-postgres \
CREDIT_TEST_REDIS_VOLUME=oxsteed-growth-isolated-test-redis \
CREDIT_TEST_DB_PASSWORD=synthetic-growth-tests-only \
CREDIT_TEST_POSTGRES_IMAGE=oxsteed/postgis:16-arm64 \
docker --context colima compose --project-name oxsteed-growth-isolated-test \
  -f docker-compose.credit-test.yml up -d postgres redis
node server/scripts/verifyGrowthSchema.js
```

The ClickHouse fixture used this pinned image, private test network and config. Set the bind-mount source to this checkout's absolute path. Wait for the test HTTP endpoint to be ready before running its verifier.

```sh
docker --context colima run -d --name oxsteed-growth-clickhouse-test --memory 2g \
  --network oxsteed-growth-isolated-test_credit_test -p 127.0.0.1:32768:8123 \
  -e CLICKHOUSE_USER=default -e CLICKHOUSE_PASSWORD=synthetic-growth-only \
  -e CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 \
  -v "$PWD/server/growth/testing/clickhouse.xml:/etc/clickhouse-server/config.d/growth-test.xml:ro" \
  clickhouse/clickhouse-server@sha256:0152dd511befe6a2c2ef53e930726179669b08116da78500b37c51c96ff5ee77
(cd server && NODE_ENV=test GROWTH_CLICKHOUSE_URL=http://127.0.0.1:32768 \
  GROWTH_CLICKHOUSE_ADMIN_USER=default GROWTH_CLICKHOUSE_ADMIN_PASSWORD=synthetic-growth-only \
  node scripts/verifyGrowthClickhouse.js)
```

Remove only the dedicated test resources after use:

```sh
docker --context colima rm -fv oxsteed-growth-clickhouse-test
CREDIT_TEST_PROJECT=oxsteed-growth-isolated-test \
CREDIT_TEST_POSTGRES_VOLUME=oxsteed-growth-isolated-test-postgres \
CREDIT_TEST_REDIS_VOLUME=oxsteed-growth-isolated-test-redis \
CREDIT_TEST_DB_PASSWORD=synthetic-growth-tests-only \
CREDIT_TEST_POSTGRES_IMAGE=oxsteed/postgis:16-arm64 \
docker --context colima compose --project-name oxsteed-growth-isolated-test \
  -f docker-compose.credit-test.yml down -v
```
