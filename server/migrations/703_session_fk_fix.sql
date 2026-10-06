-- 703: Fix BIGSERIAL session chain columns
-- parent_session_id (191) and regenerated_from_session_id (200) were created
-- as BIGSERIAL (NOT NULL + auto-increment sequence), but they should be
-- nullable foreign keys to sessions(id). The app never sets them; the
-- sequence just wastes values and the NOT NULL is wrong.

-- Drop the auto-increment default first, then change type
ALTER TABLE sessions ALTER COLUMN parent_session_id DROP DEFAULT;
ALTER TABLE sessions ALTER COLUMN parent_session_id DROP NOT NULL;
ALTER TABLE sessions ALTER COLUMN parent_session_id TYPE BIGINT;

ALTER TABLE sessions ALTER COLUMN regenerated_from_session_id DROP DEFAULT;
ALTER TABLE sessions ALTER COLUMN regenerated_from_session_id DROP NOT NULL;
ALTER TABLE sessions ALTER COLUMN regenerated_from_session_id TYPE BIGINT;

-- Add foreign key constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_sessions_parent_session'
  ) THEN
    ALTER TABLE sessions
      ADD CONSTRAINT fk_sessions_parent_session
      FOREIGN KEY (parent_session_id) REFERENCES sessions(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_sessions_regenerated_from'
  ) THEN
    ALTER TABLE sessions
      ADD CONSTRAINT fk_sessions_regenerated_from
      FOREIGN KEY (regenerated_from_session_id) REFERENCES sessions(id);
  END IF;
END $$;
