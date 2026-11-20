-- Group 9 Slice F (items 488-495): driver tracking and review.
--
-- 493 Payout adjustments: the payout lifecycle (accrue -> approve ->
-- paid, deliveryDriverPayoutService) accepted an ops note on each
-- transition but never persisted a reason for an amount change, so a
-- driver whose payout changed had no explanation anywhere. Adjustments
-- are now first-class rows: previous/new amounts, a required reason,
-- and the operator who made the change. The payout row itself is only
-- ever rewritten by the adjustment service, inside the same
-- transaction as the adjustment row, so the two can never disagree.
-- 494 Driver disputes: a dispute is distinct from a generic issue
-- (delivery_issues) — it is a driver filing on a completed assignment
-- about the payout amount, the assignment facts, or a rating, with its
-- own status (open -> under_review -> resolved) and its own linked
-- support ticket. One open dispute per (job, driver, subject): a
-- second filing on the same subject stays a duplicate, not a second
-- ticket. The issue + support-ticket plumbing is reused, not forked.
-- 495 Weekly work reports: one row per driver per Monday-Sunday week
-- (in the driver's timezone), generated only for weeks with activity.
-- The payload JSONB is the report itself (per-job rows included); the
-- scalar columns are the queryable rollup. No report is generated for
-- an idle week.
BEGIN;

CREATE TABLE IF NOT EXISTS delivery_payout_adjustments (
  id BIGSERIAL PRIMARY KEY,
  payout_id BIGINT NOT NULL REFERENCES delivery_driver_payouts(id) ON DELETE CASCADE,
  previous_payout_cents INTEGER NOT NULL CHECK (previous_payout_cents >= 0),
  new_payout_cents INTEGER NOT NULL CHECK (new_payout_cents > 0),
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  adjusted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_payout_adjustments_payout
  ON delivery_payout_adjustments(payout_id, created_at DESC);

CREATE TABLE IF NOT EXISTS delivery_driver_disputes (
  id BIGSERIAL PRIMARY KEY,
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  payout_id BIGINT REFERENCES delivery_driver_payouts(id) ON DELETE SET NULL,
  driver_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject VARCHAR(32) NOT NULL
    CHECK (subject IN ('payout_amount', 'assignment_facts', 'rating')),
  description TEXT NOT NULL CHECK (btrim(description) <> ''),
  status VARCHAR(24) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'under_review', 'resolved')),
  support_ticket_id UUID REFERENCES support_tickets(id) ON DELETE SET NULL,
  resolution TEXT,
  resolved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_driver_disputes_driver
  ON delivery_driver_disputes(driver_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_driver_disputes_job
  ON delivery_driver_disputes(delivery_job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_driver_disputes_status
  ON delivery_driver_disputes(status, created_at DESC);

-- One open dispute per (job, driver, subject). A resolved dispute frees
-- the subject for a fresh filing; an open/under_review one does not.
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_driver_disputes_open_unique
  ON delivery_driver_disputes(delivery_job_id, driver_user_id, subject)
  WHERE status IN ('open', 'under_review');

CREATE TABLE IF NOT EXISTS delivery_driver_weekly_reports (
  id BIGSERIAL PRIMARY KEY,
  driver_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  jobs_completed INTEGER NOT NULL DEFAULT 0 CHECK (jobs_completed >= 0),
  jobs_cancelled INTEGER NOT NULL DEFAULT 0 CHECK (jobs_cancelled >= 0),
  distance_miles NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (distance_miles >= 0),
  pieces INTEGER NOT NULL DEFAULT 0 CHECK (pieces >= 0),
  earnings_accrued_cents INTEGER NOT NULL DEFAULT 0 CHECK (earnings_accrued_cents >= 0),
  earnings_paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (earnings_paid_cents >= 0),
  adjustments_count INTEGER NOT NULL DEFAULT 0 CHECK (adjustments_count >= 0),
  exceptions_count INTEGER NOT NULL DEFAULT 0 CHECK (exceptions_count >= 0),
  worked_minutes INTEGER NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT delivery_driver_weekly_reports_week_ck CHECK (week_end >= week_start),
  CONSTRAINT delivery_driver_weekly_reports_driver_week_uq UNIQUE (driver_user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_delivery_driver_weekly_reports_driver
  ON delivery_driver_weekly_reports(driver_user_id, week_start DESC);

COMMIT;
