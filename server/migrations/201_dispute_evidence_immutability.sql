-- VULN #27 FIX: Make dispute evidence immutable once submitted

ALTER TABLE dispute_evidence ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);
ALTER TABLE dispute_evidence ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP;
ALTER TABLE dispute_evidence ADD COLUMN IF NOT EXISTS is_final BOOLEAN DEFAULT FALSE;

-- Function to hash evidence content
CREATE OR REPLACE FUNCTION hash_dispute_evidence()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_final = FALSE AND OLD.is_final = FALSE THEN
    -- Only allow edits before finalization
    RETURN NEW;
  ELSIF NEW.is_final = TRUE THEN
    -- Calculate hash of content
    NEW.content_hash := encode(
      digest(NEW.description || NEW.file_url || NEW.created_at::TEXT, 'sha256'),
      'hex'
    );
    NEW.submitted_at := NOW();
    RETURN NEW;
  ELSE
    -- Prevent modification of finalized evidence
    RAISE EXCEPTION 'Dispute evidence is immutable after finalization';
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_evidence_immutability ON dispute_evidence;
CREATE TRIGGER trigger_evidence_immutability
  BEFORE INSERT OR UPDATE ON dispute_evidence
  FOR EACH ROW
  EXECUTE FUNCTION hash_dispute_evidence();

-- Audit trail for evidence changes
CREATE TABLE IF NOT EXISTS dispute_evidence_audit (
  id BIGSERIAL PRIMARY KEY,
  evidence_id UUID NOT NULL,
  action VARCHAR(50), -- 'created', 'modified', 'finalized'
  previous_hash VARCHAR(64),
  new_hash VARCHAR(64),
  modified_by UUID,
  modified_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_audit_hash
  ON dispute_evidence_audit(evidence_id, modified_at DESC);
