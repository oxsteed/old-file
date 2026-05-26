-- Access gate hardening
--
-- Layers an aggressive per-(IP, claimed_name) rate limiter on top of the
-- existing logistics_internal_access_credentials gate (migrations 276 +
-- 277). Adds:
--
--   1. access_gate_attempts — append-only audit log of every verify call,
--      success or fail. Used to compute fail counts inside the sliding
--      24h window AND surfaced in super-admin audit.
--
--   2. access_gate_lockouts — denormalized "currently locked" rows, one
--      per (ip, normalized_name). A row exists iff that pair has hit the
--      fail threshold; locked_until carries the unlock time. Super-admin
--      can lift early.
--
--   3. access_gate_recovery_tokens — one-time email recovery links so a
--      super-admin who has locked themselves out can self-recover via a
--      hardcoded ACCESS_GATE_RECOVERY_EMAILS allowlist.

CREATE TABLE IF NOT EXISTS access_gate_attempts (
  id BIGSERIAL PRIMARY KEY,
  ip VARCHAR(64) NOT NULL,
  user_agent TEXT NULL,
  claimed_name VARCHAR(120) NOT NULL,
  normalized_name VARCHAR(120) NOT NULL,
  scope VARCHAR(32) NOT NULL
    CHECK (scope IN ('operations', 'compliance', 'admin_portal')),
  success BOOLEAN NOT NULL,
  error_code VARCHAR(48) NULL,
  matched_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_access_gate_attempts_window
  ON access_gate_attempts (ip, normalized_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_access_gate_attempts_recent
  ON access_gate_attempts (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_access_gate_attempts_user
  ON access_gate_attempts (matched_user_id, created_at DESC);


CREATE TABLE IF NOT EXISTS access_gate_lockouts (
  id BIGSERIAL PRIMARY KEY,
  ip VARCHAR(64) NOT NULL,
  normalized_name VARCHAR(120) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  fail_count INTEGER NOT NULL DEFAULT 1,
  first_fail_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_fail_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMPTZ NULL,
  -- Lift state:
  lifted_at TIMESTAMPTZ NULL,
  lifted_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  lift_reason TEXT NULL,
  lift_source VARCHAR(24) NULL
    CHECK (lift_source IS NULL OR lift_source IN ('super_admin_ui', 'recovery_email', 'cli', 'auto_window_expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One ACTIVE lockout row per (ip, normalized_name). Lifted rows stay around
-- for audit, so the partial unique index targets only un-lifted rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_gate_lockouts_active_pair
  ON access_gate_lockouts (ip, normalized_name)
  WHERE lifted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_access_gate_lockouts_locked_until
  ON access_gate_lockouts (locked_until)
  WHERE lifted_at IS NULL;


CREATE TABLE IF NOT EXISTS access_gate_recovery_tokens (
  id UUID PRIMARY KEY,
  token_hash TEXT NOT NULL,
  recovery_email VARCHAR(255) NOT NULL,
  -- Optional: scope the recovery so the link only lifts a specific (ip, name)
  scope_ip VARCHAR(64) NULL,
  scope_normalized_name VARCHAR(120) NULL,
  requested_ip VARCHAR(64) NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ NULL,
  used_ip VARCHAR(64) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_access_gate_recovery_tokens_hash
  ON access_gate_recovery_tokens (token_hash);

CREATE INDEX IF NOT EXISTS idx_access_gate_recovery_tokens_email
  ON access_gate_recovery_tokens (recovery_email, created_at DESC);
