-- Migration 854: exclude admin_id from the admin audit hash chain.
--
-- Regression from migration 853: the scheduled-deletion sentinel reassignment
-- (admin_audit_log.admin_id -> '00000000-0000-0000-0000-000000000000') is a
-- legitimate, trigger-sanctioned transition, but entry_hash was sealed over the
-- full row payload INCLUDING admin_id. verify_admin_audit_hash_chain()
-- recomputes entry hashes from current row values, so the first hard-delete of
-- a user with audit rows breaks the chain and the daily verification job
-- records a critical integrity incident for a legitimate transition (false
-- positive).
--
-- Fix: admin_id is excluded from the hashed payload in both the write trigger
-- (set_admin_audit_hash_chain) and the verifier. The sentinel reassignment is
-- the ONLY legal mutation of any admin_audit_log column, enforced by
-- prevent_admin_audit_update()'s narrow 853 carve-out (every other UPDATE
-- still raises), so excluding admin_id loses no tamper-evidence: every other
-- field of every row stays fully hash-bound, and chain linkage
-- (previous_hash) is preserved.
--
-- All existing rows are re-sealed with the new formula in chronological order
-- inside this migration's implicit transaction (the immutability trigger is
-- disabled only for the re-seal, same pattern as migration 760, and the
-- 406 advisory lock serializes concurrent inserts until commit). The re-seal
-- is deterministic, so re-running it is a no-op. Sealed evidence is
-- re-derived from (previous_hash, id, created_at, payload); no row content
-- changes and no special-case is left in the verifier.

-- 1. Write trigger: hash the payload without admin_id.
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
      -- P3-11-F03 regression (migration 854): admin_id is excluded so the
      -- scheduled-deletion sentinel reassignment does not break the chain.
      (to_jsonb(NEW) - 'previous_hash' - 'entry_hash' - 'admin_id')::text,
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END;
$$;

-- 2. Verifier: same exclusion, keeping migration 610's target_key awareness.
CREATE OR REPLACE FUNCTION verify_admin_audit_hash_chain()
RETURNS TABLE (
  valid BOOLEAN,
  checked_count BIGINT,
  broken_count BIGINT,
  first_broken_id TEXT,
  first_broken_sequence BIGINT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ordered AS (
    SELECT
      a.*,
      ROW_NUMBER() OVER (ORDER BY a.created_at ASC, a.id ASC) AS sequence_number,
      LAG(a.entry_hash) OVER (ORDER BY a.created_at ASC, a.id ASC) AS expected_previous_hash,
      TO_JSONB(a) AS audit_payload
    FROM admin_audit_log a
  ), checks AS (
    SELECT
      id,
      sequence_number,
      previous_hash,
      expected_previous_hash,
      entry_hash,
      -- Rows sealed after migration 591: payload includes target_key.
      ENCODE(
        DIGEST(
          COALESCE(expected_previous_hash, '') || ':' || id::TEXT || ':' ||
          COALESCE(created_at, CURRENT_TIMESTAMP)::TEXT || ':' ||
          (audit_payload - 'previous_hash' - 'entry_hash' - 'admin_id')::TEXT,
          'sha256'
        ),
        'hex'
      ) AS expected_entry_hash,
      -- Rows sealed before migration 591: target_key did not exist yet.
      ENCODE(
        DIGEST(
          COALESCE(expected_previous_hash, '') || ':' || id::TEXT || ':' ||
          COALESCE(created_at, CURRENT_TIMESTAMP)::TEXT || ':' ||
          (audit_payload - 'previous_hash' - 'entry_hash' - 'target_key' - 'admin_id')::TEXT,
          'sha256'
        ),
        'hex'
      ) AS expected_entry_hash_pre_591
    FROM ordered
  ), broken AS (
    SELECT *
    FROM checks
    WHERE previous_hash IS DISTINCT FROM expected_previous_hash
       OR (entry_hash IS DISTINCT FROM expected_entry_hash
           AND entry_hash IS DISTINCT FROM expected_entry_hash_pre_591)
  )
  SELECT
    COUNT(*) = 0 AS valid,
    (SELECT COUNT(*) FROM checks) AS checked_count,
    COUNT(*) AS broken_count,
    (ARRAY_AGG(id::TEXT ORDER BY sequence_number))[1] AS first_broken_id,
    (ARRAY_AGG(sequence_number ORDER BY sequence_number))[1] AS first_broken_sequence
  FROM broken;
$$;

REVOKE ALL ON FUNCTION verify_admin_audit_hash_chain() FROM PUBLIC;

-- 3. Re-seal every existing row with the new formula, preserving chain order
-- and linkage. The immutability trigger is disabled only for this re-seal
-- (migration 760 pattern); the whole file runs in one implicit transaction.
ALTER TABLE admin_audit_log DISABLE TRIGGER trg_admin_audit_immutable;

DO $$
DECLARE
  audit_row RECORD;
  prior_hash VARCHAR(64);
  current_hash VARCHAR(64);
BEGIN
  -- Serialize with concurrent audit inserts until this transaction commits,
  -- so no row is sealed under the old formula after the re-seal passes it.
  PERFORM pg_advisory_xact_lock(406, 1);

  FOR audit_row IN
    SELECT *
    FROM admin_audit_log
    ORDER BY created_at ASC, id ASC
  LOOP
    current_hash := encode(
        digest(
          COALESCE(prior_hash, '') || ':' || audit_row.id::text || ':' ||
          COALESCE(audit_row.created_at, CURRENT_TIMESTAMP)::text || ':' ||
          (to_jsonb(audit_row) - 'previous_hash' - 'entry_hash' - 'admin_id')::text,
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

ALTER TABLE admin_audit_log ENABLE TRIGGER trg_admin_audit_immutable;
