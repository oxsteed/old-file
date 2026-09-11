-- Expose a read-only integrity check for the tamper-evident admin audit chain.
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
      ENCODE(
        DIGEST(
          COALESCE(expected_previous_hash, '') || ':' || id::TEXT || ':' ||
          COALESCE(created_at, CURRENT_TIMESTAMP)::TEXT || ':' ||
          (audit_payload - 'previous_hash' - 'entry_hash')::TEXT,
          'sha256'
        ),
        'hex'
      ) AS expected_entry_hash
    FROM ordered
  ), broken AS (
    SELECT *
    FROM checks
    WHERE previous_hash IS DISTINCT FROM expected_previous_hash
       OR entry_hash IS DISTINCT FROM expected_entry_hash
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
