-- Group 13 Slice 4h (688, D-396): annotations on open/acknowledged
-- reconciliation exceptions, written by the location's participant/cashier
-- or HQ on the location reconciliation surface.
--
-- The resolve-time resolution_notes on the exception are unchanged: an
-- annotation is a standalone note on an exception that is still open, so a
-- difference can be annotated without resolving it. Annotations are
-- append-only and never edited. Scope is derived from the annotated
-- exception at write and read time (the exception must resolve to the
-- caller's location), so this table carries no restaurant_id/location_id
-- columns and needs no store-boundary audit registration. Additive only;
-- safe to run twice.
CREATE TABLE IF NOT EXISTS oxsteed_credit_reconciliation_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_id UUID NOT NULL REFERENCES reconciliation_exceptions(id) ON DELETE CASCADE,
  author_type VARCHAR(16) NOT NULL CHECK (author_type IN ('cashier', 'participant')),
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  author_device_id BIGINT REFERENCES restaurant_app_devices(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (char_length(body) >= 1 AND char_length(body) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (author_type = 'cashier' AND author_device_id IS NOT NULL AND author_user_id IS NULL)
    OR (author_type = 'participant' AND author_user_id IS NOT NULL AND author_device_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_credit_recon_annotations_exception
  ON oxsteed_credit_reconciliation_annotations (exception_id, created_at DESC);
