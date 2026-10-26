# Sunday data-integrity audit follow-up

Source: the owner's pasted 26-finding audit. Claims were checked against the
current default-branch source before changes. No production funds, activation
switches, stored data or table drops were part of this verification. Fixtures
use disposable Colima resources and synthetic subjects.

| # | Disposition | Change or remaining evidence |
| --- | --- | --- |
| 1 | Fixed in source | Scheduled hard deletion checks the shared financial blocker guard inside its transaction, before erasure. Admin deletion applies the same guard without a force override. Food reserves also count as blockers. |
| 2 | Fixed through retention | Zero-balance food-wallet/ledger actors and restaurant/business owners follow retained-identity anonymization. Ledger/account/restaurant links survive; append-only rules and FKs were not dropped. The full-schema test verifies the actual retained relationship. |
| 3 | Fixed for identified references; review path retained | Financial approval and restaurant-payout requesters retain anonymized identity; calendar and AI-draft creators use the existing sentinel. Remaining restricted erasures surface through an operations-protected review API and durable incident/notification dispatch. Unknown blockers still require operator investigation. |
| 4 | Fixed in source | The main dashboard was already registry-backed. Revenue summary and the Money Overview headline now use `metricsRegistry.platformRevenue`; consulting/other ledger activity remain separate breakdowns. |
| 5 | Fixed | Replay only marks a central posting processed when it reports posted or deliberately skipped. A mid-sweep rail shutdown defers the row without consuming attempts. |
| 6 | Fixed | Both chart APIs validate/default a currency, filter the ledger by that currency and return its identity. |
| 7 | Fixed in source | Hourly refresh uses the existing fenced scheduler. Manual refresh shares the service. Historical indexes are non-unique, so unsupported CONCURRENTLY refresh was removed. Customer/helper/bid-summary responses expose timestamp and staleness. A caller-supplied system header is not refresh authorization. |
| 8 | Fixed | Dashboard duplicate statistics use newest-first ordering, matching the suspect queue. |
| 9 | Forward guard added; historical acceptance open | Legacy NULL checksums acquire a logged, explicitly unverified forward baseline. CI rejects changes/removal of existing SQL. No assertion is made that an old applied 99983 matched any intermediate source revision; deployment history must resolve that. |
| 10 | Fixed | A failed propensity pass leaves a retryable partial day instead of complete. |
| 11 | Guarded without reordering history | Historical lexical order is preserved. New migrations need an unused prefix and must sort after the existing tail. Changing historical ordering requires its own full-history transition rehearsal. |
| 12 | Fixed | Pairwise groups above 100 are rejected before pair generation; linear mode still supports 5,000-member groups. |
| 13 | Fixed | Payout transitions lock their row, condition writes on the source status, reject a changed reference on a paid replay and preserve the first completion. The full-schema test races two transactions. |
| 14 | Fixed monitoring; deliberately preserves requests | Erasure remains scheduled while collection and stores are off. A pending queue with no ClickHouse configuration produces a durable incident. Existing scheduler failures also persist incidents. Requests are not discarded on configuration loss because historical rows may still exist. |
| 15 | Owner decision implemented; production apply open | The owner selected 90 days for per-subject summaries. Additive C007 changes `subject_activity_daily`. The CI verifier already applies every C migration twice; it now checks all three TTLs and physically expires synthetic 91-day-old data. Local evidence is one replica, not live deployment or failover. |
| 16 | Strengthened; legacy fixture conversion remains | New deletion/value-retention and payout-race tests require every production PostgreSQL migration. They caught real UUID-cast and NOT NULL country failures absent from mocks. Four stale display fixtures now use actual registry migrations and production device definitions. Reduced legacy statement/export schemas still need systematic conversion or projection/constraint-parity coverage before this finding can be fully closed. |
| 17 | Fixed for access completion | Single and bulk completion require a server-recorded provider-accepted data delivery receipt and content hash. The delivery path produces the data, verifies the destination account, refuses truncated exports, checks provider acceptance and preserves receipts against metadata-update races. Provider acceptance is not proof of inbox receipt. |
| 18 | Fixed | Customer 360's `open_disputes` now counts only open, matching the governed definition. |
| 19 | Fixed | Learn guidance cache TTL is seven days, with a new key version retiring existing year-long entries from reads immediately. |
| 20 | Fixed | Rollup coverage only names job events when that path actually ran. |
| 21 | Inventory and guard added | Current source contains 33 duplicate numeric-prefix groups and 28 gap ranges across 1,007 files. The inventory records 99915 as unexplained; no history was fabricated or renumbered. CI prevents new collisions/backwards additions. |
| 22 | Fixed | Keyset batches drain beyond 50 without repeatedly selecting blocked subjects; the first query reports the uncapped due count. |
| 23 | Already bounded | `geoController` already caps reverse/suggest at 500, nearby at 100 and route/matrix at 250. No cache change was necessary. |
| 24 | Fixed API | Reconciliation audit events accept bounded page size/offset and return hasMore/nextOffset with stable timestamp/id ordering. Financial totals retain their full-range queries. |
| 25 | Fixed | A newly fenced rollup run reaps running records older than the one-hour lease. |
| 26 | Triage only; no drops | At least one claimed abandoned example is live: `restaurant_store_forward_settings` is read/written by Terminal offline services/controllers. `legal_documents` has SQL FK/retention dependencies. Zero literal JS references cannot establish disuse; remaining candidates need owner/reporting/dependency evidence before archival or deletion. |

Additional full-schema corrections: privacy Promote export/erase queries now
cast their UUID comparison explicitly, and retained-user anonymization uses
unconfirmed `ZZ` instead of NULL for the required country field. Financial
identity retention does not grant permission to retain unrelated personal data.

CI continuation: the previously failing marketplace rollback test now supplies
an actual store identity. The four failing display suites apply the actual
canonical-registry migrations in their isolated schemas, and the franchise
fixture closes its database pool. The statement-investigation fixture now
honors its opted-in URL rather than forcing port 5432; Customer 360 accepts the
shared disposable database opt-in as well.

The daypart/scheduled-order fixture now uses a fixed midday clock. Its former
"always available" window ended at 23:59 and failed during that final UTC minute.
The activity-log fixture also honors the shared disposable database opt-in.

## Verification and remaining work

- Complete PostgreSQL history: **1,007 migrations** applied to a fresh PostGIS
  fixture. New full-schema deletion/retention/payout tests and rollup tests:
  **5 tests passed**.
- Focused initial server regression group: **16 suites / 161 tests passed**.
  The separate migration/erasure-config/access-delivery group passed
  **4 suites / 29 tests**. These overlap; do not sum them as a unique total.
- Previously failing CI group: **5 suites / 71 tests passed** against the
  migrated disposable database.
- ClickHouse C001–C007 applied twice; 90-day definitions, expired raw/hourly/
  subject rows, role denial, deduplication and physical erasure passed on one
  isolated replica. Production application is unverified.
- Migration-history script tests and `git diff --check` passed. The broader
  server run and final focused checks are recorded after completion below.

The broader server run reached **9,521 passing tests**, with 396 skipped and
28 failures across five suites. Those failures were traced to missing ffprobe,
fixtures forcing local port 5432 instead of the opted-in database, and the
23:59 daypart boundary. All five suites passed targeted reruns after correcting
the environment/fixtures. This was not a clean full-suite run; do not present
it as one. Final consolidated regression coverage is recorded separately.

Final consolidated run: **31 suites / 347 tests passed**, with `--runInBand
--detectOpenHandles`, the migrated loopback database and explicit ffmpeg/
ffprobe paths. It covers all changed test files plus related deletion, wallet,
Growth privacy, migration-recovery and worker-lifecycle suites. No browser
interfaces changed, so the client build was not repeated for this follow-up.
Remote CI and live deployment must be checked on the resulting commit.

Open acceptance: historical migration/deployment reconciliation; the remaining
legacy fixture conversion in #16; and production/reporting/dependency review
for #26. No table is approved for removal by this audit. Legal review, native
app adoption, provider acceptance and production Growth infrastructure remain
in the separate [Growth acceptance checklist](../growth/LAUNCH-ACCEPTANCE.md).
