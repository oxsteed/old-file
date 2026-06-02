ALTER TABLE helper_profiles
  ADD COLUMN IF NOT EXISTS booking_buffer_minutes INTEGER NOT NULL DEFAULT 0;

ALTER TABLE helper_profiles
  ADD CONSTRAINT helper_profiles_booking_buffer_minutes_range
  CHECK (booking_buffer_minutes BETWEEN 0 AND 240)
  NOT VALID;

ALTER TABLE helper_profiles
  VALIDATE CONSTRAINT helper_profiles_booking_buffer_minutes_range;
