-- Make dispute evidence a durable communication surface.
ALTER TABLE dispute_evidence
  ADD COLUMN IF NOT EXISTS client_request_id UUID,
  ADD COLUMN IF NOT EXISTS submission_part VARCHAR(80) NOT NULL DEFAULT 'text';

CREATE UNIQUE INDEX IF NOT EXISTS uq_dispute_evidence_submission_part
  ON dispute_evidence (dispute_id, submitted_by, client_request_id, submission_part)
  WHERE client_request_id IS NOT NULL;

-- The original evidence trigger referenced OLD during INSERT and a column that
-- does not exist. Keep drafts mutable and hash only when evidence is finalized.
CREATE OR REPLACE FUNCTION hash_dispute_evidence()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.is_final, FALSE) THEN
      NEW.content_hash := encode(
        digest(
          COALESCE(NEW.content, '') || COALESCE(NEW.file_url, '') || COALESCE(NEW.created_at::TEXT, ''),
          'sha256'
        ),
        'hex'
      );
      NEW.submitted_at := NOW();
    END IF;
    RETURN NEW;
  END IF;

  IF NOT COALESCE(OLD.is_final, FALSE) AND NOT COALESCE(NEW.is_final, FALSE) THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_final, FALSE) AND NOT COALESCE(OLD.is_final, FALSE) THEN
    NEW.content_hash := encode(
      digest(
        COALESCE(NEW.content, '') || COALESCE(NEW.file_url, '') || COALESCE(NEW.created_at::TEXT, ''),
        'sha256'
      ),
      'hex'
    );
    NEW.submitted_at := NOW();
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Dispute evidence is immutable after finalization';
END;
$$ LANGUAGE plpgsql;
