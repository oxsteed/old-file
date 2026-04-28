-- Adds lat/lng to helper_profiles so the helpers API can filter by
-- haversine distance when a user search includes coordinates.
-- Populated at helper profile save time via the /api/geo/suggest response.

ALTER TABLE helper_profiles
  ADD COLUMN IF NOT EXISTS service_lat DECIMAL(9,6),
  ADD COLUMN IF NOT EXISTS service_lng DECIMAL(9,6);

CREATE INDEX IF NOT EXISTS idx_helper_profiles_coords
  ON helper_profiles (service_lat, service_lng)
  WHERE service_lat IS NOT NULL AND service_lng IS NOT NULL;
