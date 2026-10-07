-- Migration 723: allow reissuing revoked Vortex access-code strings.
--
-- business_access_codes.code carried a table-level UNIQUE (migration 245)
-- in addition to the partial unique index idx_bac_code_active
-- (WHERE is_active = TRUE). Revoking a code sets is_active = FALSE
-- (soft-delete), but the table-level constraint still blocked reusing that
-- code string for a new code.
--
-- Drop the table-level constraint; the partial index continues to enforce
-- uniqueness among active codes, which is the invariant the redeem path
-- relies on. The create/rotate collision-retry loop (23505 handling) is
-- unchanged and still guards the residual race.

ALTER TABLE business_access_codes
  DROP CONSTRAINT IF EXISTS business_access_codes_code_key;
