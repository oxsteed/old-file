-- 850_repair_dispute_evidence_trigger.sql
-- P3-11-F19 regression: migration 813 dropped dispute_evidence_audit as a
-- dead table, but migration 805's hash_dispute_evidence() trigger still
-- INSERTs into it whenever evidence is finalized (is_final flips to TRUE).
-- disputeAdminController sets is_final=TRUE both when a dispute enters
-- review and at resolution, so after 813 every review/resolution fails with
-- "relation dispute_evidence_audit does not exist" and the dispute
-- transaction rolls back. The table stays dropped (the finding's intent);
-- the trigger is rewritten without the audit INSERT. The evidentiary trail
-- is preserved on the row itself (content_hash, submitted_at) and by the
-- disputes row (resolved_by, resolved_at); the trigger never knew the actor
-- (modified_by was always NULL), so nothing attributable is lost.

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
    -- P3-11-F19: the dispute_evidence_audit INSERT from migration 805 was
    -- removed here. Migration 813 dropped that table; keeping the INSERT
    -- broke dispute review and resolution after the drop.
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Dispute evidence is immutable after finalization';
END;
$$ LANGUAGE plpgsql;
