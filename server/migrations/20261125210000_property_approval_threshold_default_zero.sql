-- Batch G (316, G6-1/G6-6): the per-property spending-approval threshold
-- defaults to $0 (fail closed). A NULL threshold used to mean "no owner
-- approval required"; from here every estimate/conversion above $0 needs
-- owner approval unless the property sets a higher threshold. Existing
-- NULL rows are backfilled to 0 so old properties get the same rule.
-- Additive, idempotent: safe to run twice.
ALTER TABLE properties ALTER COLUMN approval_threshold_cents SET DEFAULT 0;
UPDATE properties SET approval_threshold_cents = 0 WHERE approval_threshold_cents IS NULL;
