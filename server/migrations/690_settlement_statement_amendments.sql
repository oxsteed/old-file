-- Migration 690: settlement statement amendments (follow-up to workstream 8).
--
-- The amendment workflow's proposal/version tables (686/687) FK'd only to
-- credit_statement_documents. This migration links them to the settlement
-- archive (settlement_statement_documents, migration 688) so approved
-- amendments to restaurant_settlement, helper_earnings, and business
-- statements produce new immutable versions there too.
--
-- Scope rules (unchanged, extended):
-- - Customer stored value and merchant/helper/business money stay in their
--   separate archive tables. A proposal names EXACTLY ONE original, in
--   exactly one archive (CHECK below); versions likewise.
-- - Issued originals stay immutable: this migration only ADDS columns,
--   widens product codes, and adds constraints. No existing row is modified.
--
-- Schema notes:
-- - product widens VARCHAR(20) -> VARCHAR(32): 'restaurant_settlement' is
--   21 characters. Widening only; no data changes.
-- - account_id relaxes to nullable and account_uuid is added: helper_earnings
--   scopes are user UUIDs, not integers. Existing rows keep account_id set,
--   so the XOR scope check holds for them.
-- - statement_amendment_versions gets a partial UNIQUE
--   (settlement_original_document_id, revision_number) so the ordered v1, v2,
--   ... chain is enforced per settlement original exactly as 687 does for
--   credit originals (NULL original_document_id rows never collide).
-- - Continuity across periods for settlement amendments records the next
--   period's settlement document in settlement_next_period_document_id; the
--   next period's issued row is never edited (same rule as 687).

-- ── proposals: link to the settlement archive, widen product, UUID scopes ──
ALTER TABLE statement_amendment_proposals
  ALTER COLUMN product TYPE VARCHAR(32);
ALTER TABLE statement_amendment_proposals
  DROP CONSTRAINT IF EXISTS statement_amendment_proposals_product_check;
ALTER TABLE statement_amendment_proposals
  ADD CONSTRAINT statement_amendment_proposals_product_check
  CHECK (product IN ('oxsteed', 'restaurant', 'restaurant_settlement', 'helper_earnings', 'business'));

ALTER TABLE statement_amendment_proposals
  ADD COLUMN IF NOT EXISTS settlement_document_id UUID NULL
    REFERENCES settlement_statement_documents(id) ON DELETE RESTRICT;
ALTER TABLE statement_amendment_proposals
  ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE statement_amendment_proposals
  ADD COLUMN IF NOT EXISTS account_uuid UUID NULL;

-- At most one original archive per proposal (scope separation), and exactly
-- one account scope shape. "At most one" (not XOR) for the document pair:
-- legacy proposals created before the document link was mandatory may name
-- no original; the service requires exactly one for new proposals and
-- finalization fails closed without one.
ALTER TABLE statement_amendment_proposals
  DROP CONSTRAINT IF EXISTS statement_amendment_proposals_settlement_scope_check;
ALTER TABLE statement_amendment_proposals
  ADD CONSTRAINT statement_amendment_proposals_settlement_scope_check CHECK (
    NOT (document_id IS NOT NULL AND settlement_document_id IS NOT NULL)
    AND (account_id IS NULL) <> (account_uuid IS NULL)
  );

CREATE INDEX IF NOT EXISTS statement_amendment_proposals_settlement_document_idx
  ON statement_amendment_proposals(settlement_document_id);

COMMENT ON COLUMN statement_amendment_proposals.settlement_document_id IS
  'Issued original in settlement_statement_documents (migration 688) this proposal corrects. Exactly one of document_id / settlement_document_id is set; scopes never mix.';
COMMENT ON COLUMN statement_amendment_proposals.account_uuid IS
  'Account scope for UUID-keyed products (helper_earnings). Exactly one of account_id / account_uuid is set.';

-- ── versions: link to the settlement archive ───────────────────────────────
ALTER TABLE statement_amendment_versions
  ALTER COLUMN original_document_id DROP NOT NULL;
ALTER TABLE statement_amendment_versions
  ADD COLUMN IF NOT EXISTS settlement_original_document_id UUID NULL
    REFERENCES settlement_statement_documents(id) ON DELETE RESTRICT;
ALTER TABLE statement_amendment_versions
  ADD COLUMN IF NOT EXISTS settlement_next_period_document_id UUID NULL
    REFERENCES settlement_statement_documents(id) ON DELETE RESTRICT;

ALTER TABLE statement_amendment_versions
  DROP CONSTRAINT IF EXISTS statement_amendment_versions_settlement_scope_check;
ALTER TABLE statement_amendment_versions
  ADD CONSTRAINT statement_amendment_versions_settlement_scope_check CHECK (
    (original_document_id IS NULL) <> (settlement_original_document_id IS NULL)
  );

-- Ordered chain per settlement original, mirroring 687's UNIQUE
-- (original_document_id, revision_number). Partial: NULL credit-side rows
-- never collide.
CREATE UNIQUE INDEX IF NOT EXISTS uq_statement_amendment_versions_settlement
  ON statement_amendment_versions (settlement_original_document_id, revision_number)
  WHERE settlement_original_document_id IS NOT NULL;

-- Continuity: restated_forward must name the next period's document in the
-- SAME archive as the original; continuous names none.
ALTER TABLE statement_amendment_versions
  DROP CONSTRAINT IF EXISTS statement_amendment_version_continuity;
ALTER TABLE statement_amendment_versions
  ADD CONSTRAINT statement_amendment_version_continuity CHECK (
    (continuity_status = 'continuous'
      AND next_period_document_id IS NULL
      AND settlement_next_period_document_id IS NULL)
    OR (continuity_status = 'restated_forward'
      AND ((next_period_document_id IS NULL) <> (settlement_next_period_document_id IS NULL)))
  );

CREATE INDEX IF NOT EXISTS statement_amendment_versions_settlement_original_idx
  ON statement_amendment_versions(settlement_original_document_id, revision_number);

COMMENT ON COLUMN statement_amendment_versions.settlement_original_document_id IS
  'Issued original in settlement_statement_documents this version corrects. Exactly one of original_document_id / settlement_original_document_id is set.';
