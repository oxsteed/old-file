-- Make audit-chain verification schema-evolution aware (target_key, migration 591).
--
-- Migrations 406/407 hashed (to_jsonb(row) - 'previous_hash' - 'entry_hash').
-- Migration 591 later added the target_key column to admin_audit_log, so rows
-- sealed before 591 now serialize with an extra "target_key": null key and
-- fail verification even though nothing was tampered with. This is a
-- verification-time false positive, not evidence of tampering.
--
-- The replacement function accepts a row when its stored entry_hash matches
-- the expected hash computed EITHER with target_key included (rows sealed by
-- the post-591 trigger, which serializes NEW with the column present) OR with
-- target_key excluded (rows sealed before migration 591 ran). Both variants
-- are deterministic; the chain linkage (previous_hash) check is unchanged.
--
-- This rewrites no evidence: no row's stored hashes are modified. The insert
-- trigger and the immutability trigger are intentionally left untouched.
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
          (audit_payload - 'previous_hash' - 'entry_hash')::TEXT,
          'sha256'
        ),
        'hex'
      ) AS expected_entry_hash,
      -- Rows sealed before migration 591: target_key did not exist yet.
      ENCODE(
        DIGEST(
          COALESCE(expected_previous_hash, '') || ':' || id::TEXT || ':' ||
          COALESCE(created_at, CURRENT_TIMESTAMP)::TEXT || ':' ||
          (audit_payload - 'previous_hash' - 'entry_hash' - 'target_key')::TEXT,
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
