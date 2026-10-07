-- 714: Finish fixing session-chain columns (follow-up to 703)
--
-- Migrations 191 and 200 added parent_session_id and
-- regenerated_from_session_id to the sessions table as BIGSERIAL (NOT NULL,
-- DEFAULT nextval(...), each backed by its own sequence). The columns are
-- meant to be nullable foreign keys to sessions(id).
--
-- Migration 703 dropped the defaults, made the columns nullable BIGINT, and
-- added FK constraints, but left three problems:
--   1. the two orphan BIGSERIAL sequences still exist,
--   2. existing rows still hold junk nextval() values (the application never
--      writes these columns, so every non-null value is a bogus sequence
--      artifact, not a real session link),
--   3. the FK constraints lack ON DELETE SET NULL.
--
-- This migration completes the fix. It is idempotent: every step is guarded
-- (IF EXISTS / information_schema checks), so it is safe to run whether or
-- not 703 was previously applied.

-- Step 1: defensive column shape. Strip any leftover BIGSERIAL default,
-- ensure BIGINT, ensure nullable. All no-ops when 703 already applied.
DO $$
DECLARE
  v_type text;
BEGIN
  SELECT data_type INTO v_type
  FROM information_schema.columns
  WHERE table_name = 'sessions' AND column_name = 'parent_session_id';

  IF v_type IS NOT NULL THEN
    ALTER TABLE sessions ALTER COLUMN parent_session_id DROP DEFAULT;
    IF v_type <> 'bigint' THEN
      ALTER TABLE sessions ALTER COLUMN parent_session_id TYPE BIGINT
        USING parent_session_id::bigint;
    END IF;
    ALTER TABLE sessions ALTER COLUMN parent_session_id DROP NOT NULL;
  END IF;

  SELECT data_type INTO v_type
  FROM information_schema.columns
  WHERE table_name = 'sessions' AND column_name = 'regenerated_from_session_id';

  IF v_type IS NOT NULL THEN
    ALTER TABLE sessions ALTER COLUMN regenerated_from_session_id DROP DEFAULT;
    IF v_type <> 'bigint' THEN
      ALTER TABLE sessions ALTER COLUMN regenerated_from_session_id TYPE BIGINT
        USING regenerated_from_session_id::bigint;
    END IF;
    ALTER TABLE sessions ALTER COLUMN regenerated_from_session_id DROP NOT NULL;
  END IF;
END
$$;

-- Step 2: drop the orphan sequences left behind by BIGSERIAL. PostgreSQL
-- names them <table>_<column>_seq at creation time.
DROP SEQUENCE IF EXISTS sessions_parent_session_id_seq;
DROP SEQUENCE IF EXISTS sessions_regenerated_from_session_id_seq;

-- Step 3: null out junk values. The application never writes these columns,
-- so every non-null value is a leftover sequence artifact.
UPDATE sessions SET parent_session_id = NULL WHERE parent_session_id IS NOT NULL;
UPDATE sessions SET regenerated_from_session_id = NULL WHERE regenerated_from_session_id IS NOT NULL;

-- Step 4: replace the FK constraints with ON DELETE SET NULL variants.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sessions' AND column_name = 'parent_session_id'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'fk_sessions_parent_session'
    ) THEN
      ALTER TABLE sessions DROP CONSTRAINT fk_sessions_parent_session;
    END IF;
    ALTER TABLE sessions
      ADD CONSTRAINT fk_sessions_parent_session
      FOREIGN KEY (parent_session_id)
      REFERENCES sessions(id)
      ON DELETE SET NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sessions' AND column_name = 'regenerated_from_session_id'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'fk_sessions_regenerated_from'
    ) THEN
      ALTER TABLE sessions DROP CONSTRAINT fk_sessions_regenerated_from;
    END IF;
    ALTER TABLE sessions
      ADD CONSTRAINT fk_sessions_regenerated_from
      FOREIGN KEY (regenerated_from_session_id)
      REFERENCES sessions(id)
      ON DELETE SET NULL;
  END IF;
END
$$;
