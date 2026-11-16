-- An applicant can explicitly link advisory intake to their ownership application.
-- The link gives neither the adviser nor the applicant any new authority.
ALTER TABLE consulting_requests
  ADD COLUMN IF NOT EXISTS access_request_id BIGINT REFERENCES access_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS consulting_requests_access_request_idx
  ON consulting_requests (access_request_id, created_at DESC, id DESC) WHERE access_request_id IS NOT NULL;
