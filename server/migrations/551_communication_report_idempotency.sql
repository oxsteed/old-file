-- Migration 551: make user-facing reports safe to retry after transport failures.

ALTER TABLE job_user_reports
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_user_reports_reporter_request
  ON job_user_reports (reporter_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

ALTER TABLE review_reports
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_review_reports_reporter_request
  ON review_reports (reported_by, client_request_id)
  WHERE client_request_id IS NOT NULL;

ALTER TABLE content_reports
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_reports_reporter_request
  ON content_reports (reporter_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
