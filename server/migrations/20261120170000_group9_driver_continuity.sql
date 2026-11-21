-- Group 9 Slice G (item 500): driver shifts and shift closeout.
--
-- There was no shift concept anywhere in delivery code (zero "shift"
-- hits in delivery services/controllers/pages). A shift is the
-- driver's availability window: start shift / end shift, with a
-- closeout summary recorded at close. The closeout aggregates from
-- the existing rows — delivered jobs (distance, pieces, worked
-- minutes from pickup to delivery), payouts accrued in the window,
-- exceptions raised in the window — the same rollup shape as the
-- weekly report (deliveryWeeklyReportService), but scoped to the
-- shift window instead of a calendar week, and stored as its own
-- record (closeout_summary JSONB), not a weekly report.
--
-- A driver has at most one open shift (D-93): the partial unique
-- index enforces it, so a second start 409s instead of silently
-- opening a parallel shift. Closeout refuses while the driver still
-- has an active in-progress job (D-94); completed jobs are fine.
-- Closing a shift never deletes or moves history, payouts, or
-- receipts — the closeout is a summary row, not a purge.
BEGIN;

CREATE TABLE IF NOT EXISTS delivery_driver_shifts (
  id BIGSERIAL PRIMARY KEY,
  driver_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(24) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  closeout_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT delivery_driver_shifts_closed_ck
    CHECK (status = 'open' OR ended_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_delivery_driver_shifts_driver
  ON delivery_driver_shifts(driver_user_id, started_at DESC);

-- One open shift per driver (D-93). A closed shift frees the driver
-- to start the next one; an open one does not.
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_driver_shifts_open_unique
  ON delivery_driver_shifts(driver_user_id)
  WHERE status = 'open';

COMMIT;
