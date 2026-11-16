-- Private case files for Business Launch advising. The object key is never
-- exposed through the case list. Every download is authorized against the
-- current case audience before a short-lived signed URL is minted.
CREATE TABLE IF NOT EXISTS business_launch_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES consulting_requests(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  storage_key TEXT NOT NULL UNIQUE,
  original_name VARCHAR(255) NOT NULL,
  content_type VARCHAR(160) NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256 CHAR(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  visibility VARCHAR(20) NOT NULL DEFAULT 'shared'
    CHECK (visibility IN ('shared', 'applicant_only', 'consultant_only', 'internal')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS business_launch_attachments_request_idx
  ON business_launch_attachments (request_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;
