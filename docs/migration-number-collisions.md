# Migration number collisions (691, 699, 700, and growth-era numbering)

Recorded 2026-10-07. Do NOT renumber these files. Renaming requires a
coordinated production `_migrations` row update on Emile's side.

The migrator (`server/migrate.js`) keys applied migrations on the full
`filename` (VARCHAR(255) UNIQUE), not the numeric prefix. Files are read in
numeric leading-prefix order (`server/migrationOrder.js` sorts by the
numeric value of the leading digits, breaking ties by the full filename).
Colliding numbers are therefore harmless as long as each file's statements
are idempotent and non-overlapping, verified below.

## 691 (two files)
- `691_restaurant_payout_external_state.sql`: widens `restaurant_payouts`
  status CHECK (adds completed/failed/cancelled/reversed), adds provider
  transfer columns. All statements use IF NOT EXISTS / DROP IF EXISTS.
- `691_settlement_issuance_schema.sql`: extends 683/684 issuance schema to
  settlement products (product VARCHAR widen, account_uuid, XOR check,
  settlement_document_id). Additive only.

No overlapping tables or constraints.

## 699 (two files)
- `699_hold_crew_size.sql`: adds hold_group_token/crew_index to
  `direct_slot_holds`, backfills, creates index. Idempotent.
- `699_jobs_moderation_metadata.sql`: adds metadata JSONB to `jobs`,
  partial index on admin_flagged. Idempotent.

No overlapping tables.

## 700 (two files)
- `700_business_launch_archived_status.sql`: widens `consulting_requests`
  status CHECK to include 'archived'.
- `700_direct_audit_indexes.sql`: adds indexes on `quote_requests`
  (flow expression index, clientRequestId unique index).

No overlapping tables or constraints.

## Rule going forward

This section supersedes every earlier forward-looking rule in this file,
including the lexical-order rule, the 999xx band plan, and the letter-band
plan. Those were true before the Q11 runner change and are false now.

1. **The runner sorts numerically.** `server/migrationOrder.js` sorts by
   the numeric value of the leading digits, with the full filename as the
   tiebreak. For every file up to `99994_` that order is identical to the
   old text order, so already-applied names and checksums are untouched
   and a fresh database replays history in exactly the old order.
2. **New files use a 14-digit UTC timestamp prefix:**
   `YYYYMMDDHHMMSS_name.sql`. A timestamp prefix always sorts after
   `99994`, so new files always append after history. The 999xx band is
   closed at `99994`: do not author a `99995_` (or any other numeric
   prefix) file. CI rejects it.
3. **The frozen legacy set is closed.** `server/migrationOrderLegacy.json`
   lists every file that existed at the Q11 change, plus the duplicate
   prefixes that history already contains. Never add to that list, and
   never rename, renumber, or edit an applied migration. The checksum
   guard fails startup if applied bytes change.
4. **Append only, never fill gaps.** Every new file must sort after the
   current last file and use an unused prefix. Gaps (`938`, `943`,
   `99915`) stay gaps. They are recorded, not filled. Two PRs that pick
   the same timestamp must rebase: the second to merge takes a later
   timestamp before merging.
5. **Enforcement is both CI and runtime.** CI runs
   `scripts/check-migration-history.cjs` against the pull request base
   and rejects edits, removals, duplicate prefixes, non-timestamp new
   files, and additions that would run before the historical tail. The
   runtime path enforces the same rule: `server/migrate.js` validates
   every file outside the frozen legacy set with
   `isValidTimestampMigration` and a sorts-after-legacy-tail check, and
   fails startup on violation. A deploy path that runs migrate without
   the CI gate therefore cannot land a mis-ordered migration.
6. **Timestamps must be real UTC times.** The prefix must form a valid
   UTC date and time (year 2026 or later). A 14-digit string that is not
   a real calendar time is rejected by both CI and the runtime.

The [2026-10-25 inventory](migration-prefix-inventory-2026-10-25.json) records
all **33 duplicate numeric-prefix groups** across 1,007 SQL files and the
**28 gap ranges** in the current source. This supersedes the pasted audit's
34-group count; suffix/leading-zero conventions affect such counts. No source
or deployment evidence currently explains 99915. Its absence is recorded,
not treated as permission to manufacture or rename an applied migration.

Rows with a NULL legacy checksum receive the current source checksum on the
next migration run, with an explicit warning that historical applied bytes
remain unverified. That establishes a forward baseline only. Inspect historical
deployment/migration records separately when reconciling previously edited
files such as 99983; this work does not certify their old contents.

## Growth-era numbering note (2026-10-20)

The original Demand & Sales Engine plan reserved `934`–`937` for deferred
catalog and offer-email work. Those numbers were later used by additive growth
migrations (`934_growth_notice_content_digest.sql` through
`937_growth_clusters.sql`), while `938` and `943` remain unused. No applied
migration is renamed or repurposed. The sentence that once followed this
note, prescribing `956_`/`957_` as the next growth numbers, is superseded
by the timestamp rule above: growth changes, like all new changes, use a
14-digit UTC timestamp prefix.
