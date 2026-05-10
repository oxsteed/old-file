-- VULN #11 FIX: Race condition in user registration
-- Use database-level uniqueness instead of application-level checks

-- Ensure case-insensitive email uniqueness is enforced at database level
-- Note: PostgreSQL does not support ADD CONSTRAINT UNIQUE with expression columns.
-- A unique index on LOWER(email) provides the same uniqueness guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users(LOWER(email));

-- Add non-unique index for fast email lookups during registration (covered by unique index above)
-- CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email));

-- Create a function to safely register a user (atomic operation)
CREATE OR REPLACE FUNCTION register_user(
  p_email VARCHAR,
  p_password_hash VARCHAR,
  p_first_name VARCHAR,
  p_last_name VARCHAR,
  p_role VARCHAR
)
RETURNS UUID AS $$
DECLARE
  v_user_id UUID;
BEGIN
  INSERT INTO users (email, password_hash, first_name, last_name, role, created_at, updated_at)
  VALUES (p_email, p_password_hash, p_first_name, p_last_name, p_role, NOW(), NOW())
  RETURNING id INTO v_user_id;
  RETURN v_user_id;
EXCEPTION
  WHEN unique_violation THEN
    -- Email already registered - handled by caller
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION register_user IS 'Atomically registers a user with database-enforced email uniqueness';
