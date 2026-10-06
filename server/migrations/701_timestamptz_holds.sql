-- Audit fix: calendar/holds used TIMESTAMP (no timezone), risking DST and
-- timezone drift. Convert to TIMESTAMPTZ. Existing values are interpreted
-- in the database's current timezone setting.

ALTER TABLE direct_slot_holds
  ALTER COLUMN starts_at TYPE TIMESTAMPTZ USING starts_at AT TIME ZONE 'UTC',
  ALTER COLUMN ends_at TYPE TIMESTAMPTZ USING ends_at AT TIME ZONE 'UTC',
  ALTER COLUMN expires_at TYPE TIMESTAMPTZ USING expires_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
