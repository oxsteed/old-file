-- ═══════════════════════════════════════════════════════════════
-- Migration 169: Bid available_times + appointment reschedule requests
--
-- 1. bids.available_times JSONB  — helper attaches 3-5 proposed slots
--    when submitting a bid; customer sees these on the bid card.
--    Format: [{"date":"2026-05-10","start":"09:00","end":"12:00"}, ...]
--
-- 2. bids.availability_note TEXT — short free-text note from helper
--    e.g. "I'm also flexible evenings after 6pm"
--
-- 3. appointment_reschedule_requests — either party can propose a new
--    time after an appointment is confirmed; the other party accepts
--    or declines.
--
-- 4. appointments.reminder_sent_24h / reminder_sent_2h — prevents the
--    reminder cron job from sending duplicate emails.
--
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- 1-2. Bid availability fields
DO $$ BEGIN
  ALTER TABLE bids ADD COLUMN available_times JSONB;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE bids ADD COLUMN availability_note TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- 3. Reschedule requests
CREATE TABLE IF NOT EXISTS appointment_reschedule_requests (
  id                SERIAL PRIMARY KEY,
  appointment_id    INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  requested_by      UUID NOT NULL REFERENCES users(id),
  requested_by_role VARCHAR(20) NOT NULL CHECK (requested_by_role IN ('customer','helper')),
  proposed_start    TIMESTAMPTZ NOT NULL,
  proposed_end      TIMESTAMPTZ NOT NULL,
  message           TEXT,
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','accepted','declined','expired','cancelled')),
  responded_at      TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '48 hours'),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_arr_time_order CHECK (proposed_end > proposed_start)
);

CREATE INDEX IF NOT EXISTS idx_arr_appointment
  ON appointment_reschedule_requests (appointment_id);

CREATE INDEX IF NOT EXISTS idx_arr_pending
  ON appointment_reschedule_requests (status, expires_at)
  WHERE status = 'pending';

-- 4. Reminder flags on appointments
DO $$ BEGIN
  ALTER TABLE appointments ADD COLUMN reminder_sent_24h BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE appointments ADD COLUMN reminder_sent_2h BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════
-- END OF MIGRATION 169
-- ═══════════════════════════════════════════════════════════════
