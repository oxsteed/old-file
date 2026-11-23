-- Group 4 Slice B: bid deadline reminders (item 164).
-- The sweeper in server/jobs/bidDeadlineNotices.js notifies a helper once
-- when a pending bid is within 24 hours of expiry, then marks lapsed bids
-- expired. deadline_notice_sent_at is the once-only stamp, mirroring
-- quote_requests.deadline_notice_sent_at from Group 1 item 10.
ALTER TABLE bids
  ADD COLUMN IF NOT EXISTS deadline_notice_sent_at TIMESTAMPTZ;
