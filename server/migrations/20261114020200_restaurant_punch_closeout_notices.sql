-- Money-flows W9: punch-closeout manager alerts were unrecorded
-- best-effort. Each entry closed in its own transaction, then
-- notifyManagers ran with no idempotency key and no record of the
-- outcome beyond in-memory counters, so a crash between the close
-- commit and the notify lost the alert permanently and invisibly:
-- the next nightly run skips the entry (no longer open) and there
-- was no ledger to reconcile against.
--
-- This table records one row per (closed entry, manager): the
-- delivery key, the outcome (sent / failed / skipped when the
-- recipient suppressed the type), and the last error. The delivery
-- key is unique, so a retry re-sends under the same key and the
-- notifications table dedupes the in-app row instead of notifying
-- twice. A retry pass over failed/skipped rows runs at the start of
-- every closeout sweep.
CREATE TABLE IF NOT EXISTS restaurant_punch_closeout_notices (
  id BIGSERIAL PRIMARY KEY,
  entry_id BIGINT NOT NULL REFERENCES business_time_entries(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  manager_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivery_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (delivery_key)
);
CREATE INDEX IF NOT EXISTS idx_closeout_notices_entry
  ON restaurant_punch_closeout_notices(entry_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_closeout_notices_retry
  ON restaurant_punch_closeout_notices(business_id, status, attempted_at)
  WHERE status IN ('failed', 'skipped');
