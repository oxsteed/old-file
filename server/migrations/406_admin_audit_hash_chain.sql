-- Make the general admin audit trail tamper-evident without changing callers.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE admin_audit_log
  ADD COLUMN IF NOT EXISTS previous_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS entry_hash VARCHAR(64);

-- Backfill in stable chronological order before enabling the write trigger.
DO $$
DECLARE
  audit_row RECORD;
  prior_hash VARCHAR(64);
  current_hash VARCHAR(64);
BEGIN
  FOR audit_row IN
    SELECT *
    FROM admin_audit_log
    ORDER BY created_at ASC, id ASC
  LOOP
    current_hash := encode(
      digest(
        COALESCE(prior_hash, '') || ':' || audit_row.id::text || ':' ||
        COALESCE(audit_row.created_at, CURRENT_TIMESTAMP)::text || ':' ||
        (to_jsonb(audit_row) - 'previous_hash' - 'entry_hash')::text,
        'sha256'
      ),
      'hex'
    );

    UPDATE admin_audit_log
    SET previous_hash = prior_hash,
        entry_hash = current_hash
    WHERE id = audit_row.id;

    prior_hash := current_hash;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION set_admin_audit_hash_chain()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prior_hash VARCHAR(64);
BEGIN
  -- Prevent concurrent inserts from creating two rows with the same predecessor.
  PERFORM pg_advisory_xact_lock(406, 1);

  SELECT entry_hash
  INTO prior_hash
  FROM admin_audit_log
  WHERE entry_hash IS NOT NULL
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  NEW.previous_hash := prior_hash;
  NEW.entry_hash := encode(
    digest(
      COALESCE(prior_hash, '') || ':' || NEW.id::text || ':' ||
      COALESCE(NEW.created_at, CURRENT_TIMESTAMP)::text || ':' ||
      (to_jsonb(NEW) - 'previous_hash' - 'entry_hash')::text,
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_audit_hash_chain ON admin_audit_log;
CREATE TRIGGER trg_admin_audit_hash_chain
BEFORE INSERT ON admin_audit_log
FOR EACH ROW
EXECUTE FUNCTION set_admin_audit_hash_chain();

CREATE OR REPLACE FUNCTION prevent_admin_audit_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Admin audit log entries are immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_audit_immutable ON admin_audit_log;
CREATE TRIGGER trg_admin_audit_immutable
BEFORE UPDATE ON admin_audit_log
FOR EACH ROW
EXECUTE FUNCTION prevent_admin_audit_update();

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_audit_entry_hash
  ON admin_audit_log (entry_hash)
  WHERE entry_hash IS NOT NULL;
