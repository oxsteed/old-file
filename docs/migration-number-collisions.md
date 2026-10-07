# Migration number collisions (691, 699, 700)

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
New migrations must use the next free number (711+ at time of writing).
`docs/` checks or CI filename-uniqueness lint would catch repeats early.
