-- Group 9 Slice D (items 467/468/470/475): driver pickup and delivery
-- confirmation.
--
-- 467 Package count confirmation: the driver confirms the piece count at
-- pickup. delivery_jobs carries the confirmed count, the mismatch flag,
-- and who/when confirmed it; the origin pickup stop in
-- delivery_job_stops carries the same confirmation, so the stop sequence
-- and the job never disagree. No backfill: a confirmation that never
-- happened is not fabricated for jobs already picked up; those jobs read
-- with a NULL confirmed count.
-- 468 Condition acknowledgment: one acknowledgment per job (not per
-- item), a checkbox plus an optional note, stored on the job and on the
-- origin pickup stop. There is no per-item condition model to hang a
-- per-item acknowledgment on; the customer-uploaded item photos stay the
-- condition evidence the driver acknowledges against.
-- 470/475 Structured issue metadata: delivery_issues.metadata holds the
-- wrong-item pair (received/expected) and the recipient-unavailable
-- reason, so dispatch and the shipper see the structure instead of
-- parsing free text. Existing issues get an empty object.
BEGIN;

ALTER TABLE delivery_jobs
  ADD COLUMN IF NOT EXISTS pickup_confirmed_pieces INTEGER,
  ADD COLUMN IF NOT EXISTS pickup_pieces_mismatch BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pickup_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pickup_confirmed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pickup_condition_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pickup_condition_acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pickup_condition_acknowledged_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pickup_condition_note TEXT;

ALTER TABLE delivery_job_stops
  ADD COLUMN IF NOT EXISTS confirmed_pieces INTEGER,
  ADD COLUMN IF NOT EXISTS pieces_mismatch BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS condition_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS condition_note TEXT,
  ADD COLUMN IF NOT EXISTS condition_acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS condition_acknowledged_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE delivery_issues
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
