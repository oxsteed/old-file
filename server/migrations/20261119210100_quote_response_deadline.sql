-- Group 1 (Customer, items 8 and 10): quote response deadline + expiry notice.
--
-- A customer can set a response deadline when requesting a quote
-- (response_deadline). The deadline is advisory to providers and shown
-- on the customer's quote list; it never auto-closes or auto-declines
-- the request. deadline_notice_sent_at marks the one-time expiry notice
-- the quote-deadline sweeper sends when the deadline passes with the
-- request still unquoted, so the customer is told once, not on every run.
--
-- No CHECK constrains response_deadline against created_at: a deadline
-- legitimately passes after creation, and the stored row must be able
-- to hold that state. The bounds (future, within 30 days) are enforced
-- in the controller at creation time.
ALTER TABLE quote_requests
  ADD COLUMN IF NOT EXISTS response_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deadline_notice_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_quote_requests_deadline_notice
  ON quote_requests (response_deadline)
  WHERE response_deadline IS NOT NULL AND deadline_notice_sent_at IS NULL;
