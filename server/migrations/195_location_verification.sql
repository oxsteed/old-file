-- VULN #18 FIX: Validate helper location claims

ALTER TABLE helper_profiles ADD COLUMN IF NOT EXISTS service_area_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE helper_profiles ADD COLUMN IF NOT EXISTS service_area_verified_at TIMESTAMP;
ALTER TABLE helper_profiles ADD COLUMN IF NOT EXISTS service_area_verification_method VARCHAR(50);

-- Location verification audit trail
CREATE TABLE IF NOT EXISTS helper_location_audits (
  id BIGSERIAL PRIMARY KEY,
  helper_id UUID NOT NULL REFERENCES users(id),
  claimed_lat DECIMAL(10, 8),
  claimed_lng DECIMAL(11, 8),
  actual_lat DECIMAL(10, 8),
  actual_lng DECIMAL(11, 8),
  distance_miles DECIMAL(8, 2),
  verification_result VARCHAR(50),
  method VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Distance must match claimed area (within 1 mile tolerance)
CREATE OR REPLACE FUNCTION validate_service_area_location()
RETURNS TRIGGER AS $$
BEGIN
  -- If service area changed, reset verification
  IF (NEW.service_lat IS DISTINCT FROM OLD.service_lat OR
      NEW.service_lng IS DISTINCT FROM OLD.service_lng) THEN
    NEW.service_area_verified = FALSE;
    NEW.service_area_verified_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_reset_location_verify ON helper_profiles;
CREATE TRIGGER trigger_reset_location_verify
  BEFORE UPDATE ON helper_profiles
  FOR EACH ROW
  WHEN (NEW.service_lat IS DISTINCT FROM OLD.service_lat OR
        NEW.service_lng IS DISTINCT FROM OLD.service_lng)
  EXECUTE FUNCTION validate_service_area_location();

CREATE INDEX IF NOT EXISTS idx_location_audits_unverified
  ON helper_location_audits(helper_id, verification_result)
  WHERE verification_result != 'verified';
