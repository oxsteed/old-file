# Migration number collisions (691, 699, 700, and growth-era numbering)

Recorded 2026-10-07. Do NOT renumber these files — renaming requires a
coordinated production `_migrations` row update on Emile's side.

The migrator (`server/migrate.js`) keys applied migrations on the full
`filename` (VARCHAR(255) UNIQUE), not the numeric prefix. Files are read in
lexical order. Colliding numbers are therefore harmless as long as each
file's statements are idempotent and non-overlapping — verified below.

## 691 (two files)
- `691_restaurant_payout_external_state.sql` — widens `restaurant_payouts`
  status CHECK (adds completed/failed/cancelled/reversed), adds provider
  transfer columns. All statements use IF NOT EXISTS / DROP IF EXISTS.
- `691_settlement_issuance_schema.sql` — extends 683/684 issuance schema to
  settlement products (product VARCHAR widen, account_uuid, XOR check,
  settlement_document_id). Additive only.

No overlapping tables or constraints.

## 699 (two files)
- `699_hold_crew_size.sql` — adds hold_group_token/crew_index to
  `direct_slot_holds`, backfills, creates index. Idempotent.
- `699_jobs_moderation_metadata.sql` — adds metadata JSONB to `jobs`,
  partial index on admin_flagged. Idempotent.

No overlapping tables.

## 700 (two files)
- `700_business_launch_archived_status.sql` — widens `consulting_requests`
  status CHECK to include 'archived'.
- `700_direct_audit_indexes.sql` — adds indexes on `quote_requests`
  (flow expression index, clientRequestId unique index).

No overlapping tables or constraints.

## Rule going forward
New migrations must use an unused prefix **and sort after the current last
filename**. Do not fill historical gaps: the runner preserves lexical order.
CI runs `scripts/check-migration-history.cjs` against the pull request base or
previous push and rejects edits/removals, new duplicate prefixes and additions
that would run before the historical tail. The next PostgreSQL prefix is
currently 99988. Changing to numeric sorting requires a full-history rehearsal;
existing 1551/610b-style ordering must not silently change on fresh installs.

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
migration is renamed or repurposed. The next growth changes use the first free
numbers after the current tail: `956_growth_jurisdiction_optout_rules.sql`
and `957_growth_campaign_personalization.sql`.
