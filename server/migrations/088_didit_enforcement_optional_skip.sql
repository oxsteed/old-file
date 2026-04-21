-- Per-user Didit enforcement: when true, only verified (not skipped) satisfies the gate.
-- Admins can set this later to require identity verification case-by-case.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS didit_enforcement_required BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.didit_enforcement_required IS
  'When true, user must complete Didit (didit_status=verified); skipped is not sufficient.';

CREATE INDEX IF NOT EXISTS idx_users_didit_enforcement
  ON users (didit_enforcement_required)
  WHERE didit_enforcement_required = TRUE;
