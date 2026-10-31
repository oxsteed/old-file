-- Add a typed bigint target to the general admin audit log so audit rows
-- for bigint-identified subjects (notably affiliate payouts, whose ids are
-- bigserials) can be found by target instead of only by the free-form
-- target_key string. logAdminAction stores only UUIDs in target_id, so
-- payout rows land with target_id NULL and audit-by-target_id queries
-- miss them.
--
-- No evidence is rewritten: the column is nullable, existing rows keep
-- NULL, and only new rows written with an explicit bigint target carry a
-- value. The UUID target_id / target_key behavior is untouched.
--
-- Hash-chain note (migrations 406/610/854): the seal trigger hashes
-- (to_jsonb(NEW) - 'previous_hash' - 'entry_hash' - 'admin_id'), so
-- rows sealed after this migration serialize WITH target_bigint and verify
-- under the full-payload variant. Rows sealed before it serialize at
-- verify time with "target_bigint": null, which would fail verification
-- even though nothing was tampered with (the migration-591 target_key
-- false-positive class). The verifier below therefore accepts two more
-- variants, following the migration-610 pattern: payload minus
-- target_bigint (rows sealed between 591 and this migration, which have
-- target_key but no target_bigint) and payload minus both target_key and
-- target_bigint (rows sealed before 591, which have neither). The seal
-- trigger and the immutability trigger are intentionally left untouched,
-- and no row's stored hashes are modified.
ALTER TABLE admin_audit_log
  ADD COLUMN IF NOT EXISTS target_bigint BIGINT;

CREATE INDEX IF NOT EXISTS idx_audit_target_bigint
  ON admin_audit_log (target_type, target_bigint)
  WHERE target_bigint IS NOT NULL;

-- Verifier: same exclusions as migration 854, plus target_bigint
-- awareness. All variants exclude admin_id (migration 854).
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
      -- Rows sealed after this migration: payload includes target_bigint.
      ENCODE(
        DIGEST(
          COALESCE(expected_previous_hash, '') || ':' || id::TEXT || ':' ||
          COALESCE(created_at, CURRENT_TIMESTAMP)::TEXT || ':' ||
          (audit_payload - 'previous_hash' - 'entry_hash' - 'admin_id')::TEXT,
          'sha256'
        ),
        'hex'
      ) AS expected_entry_hash,
      -- Rows sealed before this migration: target_bigint did not exist yet.
      ENCODE(
        DIGEST(
          COALESCE(expected_previous_hash, '') || ':' || id::TEXT || ':' ||
          COALESCE(created_at, CURRENT_TIMESTAMP)::TEXT || ':' ||
          (audit_payload - 'previous_hash' - 'entry_hash' - 'target_bigint' - 'admin_id')::TEXT,
          'sha256'
        ),
        'hex'
      ) AS expected_entry_hash_pre_bigint,
      -- Rows sealed before migration 591: target_key did not exist yet
      -- (target_bigint did not either).
      ENCODE(
        DIGEST(
          COALESCE(expected_previous_hash, '') || ':' || id::TEXT || ':' ||
          COALESCE(created_at, CURRENT_TIMESTAMP)::TEXT || ':' ||
          (audit_payload - 'previous_hash' - 'entry_hash' - 'target_key' - 'admin_id')::TEXT,
          'sha256'
        ),
        'hex'
      ) AS expected_entry_hash_pre_591,
      -- Rows sealed before migration 591: neither target_key nor
      -- target_bigint existed yet.
      ENCODE(
        DIGEST(
          COALESCE(expected_previous_hash, '') || ':' || id::TEXT || ':' ||
          COALESCE(created_at, CURRENT_TIMESTAMP)::TEXT || ':' ||
          (audit_payload - 'previous_hash' - 'entry_hash' - 'target_key' - 'target_bigint' - 'admin_id')::TEXT,
          'sha256'
        ),
        'hex'
      ) AS expected_entry_hash_pre_591_bigint
    FROM ordered
  ), broken AS (
    SELECT *
    FROM checks
    WHERE previous_hash IS DISTINCT FROM expected_previous_hash
       OR (entry_hash IS DISTINCT FROM expected_entry_hash
           AND entry_hash IS DISTINCT FROM expected_entry_hash_pre_bigint
           AND entry_hash IS DISTINCT FROM expected_entry_hash_pre_591
           AND entry_hash IS DISTINCT FROM expected_entry_hash_pre_591_bigint)
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
