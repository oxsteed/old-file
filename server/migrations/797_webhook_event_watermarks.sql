BEGIN;

-- P3-5-F08 / P3-5-F10: per-session/per-check webhook watermarks.
--
-- Both the Checkr and Stripe Identity webhooks dedupe on (provider, event_id),
-- but a provider can deliver two DIFFERENT events for the same session out of
-- order (or re-issue an event under a fresh envelope id). Without a watermark,
-- an older event processed later would regress a newer terminal state
-- (e.g. Checkr report.completed for an older report flipping a user's
-- background_check_status back, or Stripe requires_input overwriting verified).
--
-- The watermark records the newest provider event creation time applied to the
-- row; the handlers only apply an event whose created time is >= the watermark.

ALTER TABLE identity_verifications
  ADD COLUMN IF NOT EXISTS last_event_created_at TIMESTAMPTZ;

ALTER TABLE background_checks
  ADD COLUMN IF NOT EXISTS last_report_event_created_at TIMESTAMPTZ;

COMMIT;
