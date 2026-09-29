-- 584_direct_audit_indexes.sql
-- OxSteed Direct security audit fixes (findings #29, #30, #31, #33, #57).
-- Additive-only migration: existing rows are untouched, no constraints are
-- added that could fail on legacy data, and only one redundant duplicate index
-- is dropped (never the index backing a UNIQUE constraint).

-- Finding #29: server/migrations/376_direct_public_quote_lookup.sql declared
-- challenge_token as VARCHAR(120) NOT NULL UNIQUE (line 35), and PostgreSQL
-- automatically builds a unique btree index to back that constraint. The extra
-- CREATE INDEX idx_direct_quote_lookup_challenges_token (lines 49-50) on the
-- same column is a redundant duplicate. Drop only the duplicate; the UNIQUE
-- constraint and its backing index remain intact.
DROP INDEX IF EXISTS idx_direct_quote_lookup_challenges_token;

-- Finding #30: speed up direct catalog audit lookups by entity.
-- NOTE: no FOREIGN KEY is added on direct_catalog_audit_events(entity_id) on
-- purpose. The column is nullable and may hold orphan rows referencing deleted
-- catalog entities; an FK could fail to apply and could block legitimate audit
-- writes. Index only.
CREATE INDEX IF NOT EXISTS idx_direct_catalog_audit_events_entity_created
  ON direct_catalog_audit_events (entity_id, created_at);

-- Finding #31: speed up catalog status-history lookups by item and by actor.
-- NOTE: no FOREIGN KEY is added on catalog_status_history(item_id) on purpose.
-- item_id is a UUID that may hold orphan rows after catalog entities were
-- removed; an FK could fail to apply. (changed_by already references
-- users(id) ON DELETE SET NULL.) Indexes only.
CREATE INDEX IF NOT EXISTS idx_catalog_status_history_item_changed
  ON catalog_status_history (item_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_catalog_status_history_changed_by
  ON catalog_status_history (changed_by);

-- Finding #33: documented, no change. Migration 418
-- (418_direct_calendar_audit_history.sql) deliberately uses ON DELETE SET NULL
-- on its audit rows (request_id, block_id, actor_id), preserving history when
-- referenced records are removed. This migration does not alter that semantic.

-- Finding #57: deliberately NOT adding a CHECK constraint on
-- quote_requests.quote_currency_code enforcing an ISO 4217 3-letter uppercase
-- format. The column was created in migration 375 as VARCHAR(3) NOT NULL
-- DEFAULT 'USD', and existing rows may have been written by older code paths
-- or backfills; their values cannot be proven to comply without querying
-- production data, so a retroactive check could fail the deploy and block
-- startup. New values are normalized server-side (trimmed, uppercased,
-- 3-letter, defaulting to 'USD') in quoteRequestsController.createQuoteRequest.
-- Finding #56 (attempts-default off-by-one) is cosmetic; no migration.
