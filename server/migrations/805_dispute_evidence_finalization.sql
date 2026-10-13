-- P3-2-F16: dispute evidence immutability was opt-in and unused. The
-- trigger hashes only when is_final=TRUE, but no application code ever set
-- it, so evidence stayed mutable forever. The mechanics were repaired in
-- migration 554 (TG_OP handling, real column names); this migration adds
-- the missing audit writes so finalization leaves a trail. The application
-- now finalizes evidence when a dispute enters review (startReview) and at
-- resolution (resolveDispute).

CREATE OR REPLACE FUNCTION hash_dispute_evidence()
RETURNS TRIGGER AS $$
DECLARE
  v_old_hash VARCHAR(64);
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
    v_old_hash := OLD.content_hash;
    NEW.content_hash := encode(
      digest(
        COALESCE(NEW.content, '') || COALESCE(NEW.file_url, '') || COALESCE(NEW.created_at::TEXT, ''),
        'sha256'
      ),
      'hex'
    );
    NEW.submitted_at := NOW();
    -- Audit the finalization; the trigger cannot know the actor, so
    -- modified_by stays NULL and the admin action log carries the who.
    INSERT INTO dispute_evidence_audit (evidence_id, action, previous_hash, new_hash, modified_by)
    VALUES (NEW.id, 'finalized', v_old_hash, NEW.content_hash, NULL);
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Dispute evidence is immutable after finalization';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_evidence_immutability ON dispute_evidence;
CREATE TRIGGER trigger_evidence_immutability
  BEFORE INSERT OR UPDATE ON dispute_evidence
  FOR EACH ROW
  EXECUTE FUNCTION hash_dispute_evidence();
