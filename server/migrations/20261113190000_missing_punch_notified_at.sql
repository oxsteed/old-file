-- Domain 8 #11: missing-punch flags starve past 500 per day.
--
-- The missing-punch sweep notifies the oldest 500 shifts per run but
-- leaves no trace on the shift row (dedupe lived only on the
-- notification delivery_key), so on a day with more than 500 missing
-- shifts the same oldest 500 recurred every hourly run and the tail
-- was never flagged. Persist the flag time on the shift row so the
-- sweep can skip already-flagged shifts and work through the backlog.

ALTER TABLE business_staff_shifts
  ADD COLUMN IF NOT EXISTS missing_punch_notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bss_missing_punch_unnotified
  ON business_staff_shifts (business_id, shift_date, id)
  WHERE missing_punch_notified_at IS NULL
    AND published_at IS NOT NULL
    AND cancelled_at IS NULL;
