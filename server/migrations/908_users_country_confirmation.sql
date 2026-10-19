-- Confirmed-country flag for region-scoped analytics (analytics deferred item).
-- Additive. users.country is NOT NULL DEFAULT 'US' (migration 117), and the
-- registration validators normalize a missing country to 'US', so "US" alone
-- does not prove where a user is. Region scoping now trusts users.country only
-- when country_confirmed is TRUE:
--   * any non-default country (someone chose it)            -> 'non_default'
--   * US with corroborating address evidence: +1 phone, a
--     5-digit ZIP and a US state/territory code              -> 'us_address_evidence'
--   * any later change of users.country                      -> 'changed'
-- The trigger keeps this current on every insert/update; nothing else writes it.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS country_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS country_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS country_confirmation_source TEXT;

CREATE OR REPLACE FUNCTION users_us_address_evidence(p_country TEXT, p_phone TEXT, p_zip TEXT, p_state TEXT)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE AS $$
  SELECT upper(btrim(COALESCE(p_country, ''))) = 'US'
     AND regexp_replace(COALESCE(p_phone, ''), '[^0-9+]', '', 'g') ~ '^\+1[0-9]{10}$'
     AND btrim(COALESCE(p_zip, '')) ~ '^[0-9]{5}(-[0-9]{4})?$'
     AND upper(btrim(COALESCE(p_state, ''))) = ANY (ARRAY[
       'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
       'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD',
       'TN','TX','UT','VT','VA','WA','WV','WI','WY','PR','GU','VI','AS','MP'])
$$;

CREATE OR REPLACE FUNCTION users_country_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.country IS DISTINCT FROM OLD.country THEN
    NEW.country_confirmed := TRUE;
    NEW.country_confirmed_at := NOW();
    NEW.country_confirmation_source := 'changed';
  ELSIF NOT COALESCE(NEW.country_confirmed, FALSE) THEN
    IF upper(btrim(COALESCE(NEW.country, ''))) NOT IN ('', 'US') THEN
      NEW.country_confirmed := TRUE;
      NEW.country_confirmed_at := NOW();
      NEW.country_confirmation_source := 'non_default';
    ELSIF users_us_address_evidence(NEW.country, NEW.phone, NEW.zip_code, NEW.state) THEN
      NEW.country_confirmed := TRUE;
      NEW.country_confirmed_at := NOW();
      NEW.country_confirmation_source := 'us_address_evidence';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_users_country_confirmation ON users;
CREATE TRIGGER trg_users_country_confirmation
  BEFORE INSERT OR UPDATE OF country, phone, zip_code, state ON users
  FOR EACH ROW EXECUTE FUNCTION users_country_confirmation();

-- Backfill existing rows with the same rules (no 'changed' history exists).
UPDATE users
   SET country_confirmed = TRUE,
       country_confirmed_at = NOW(),
       country_confirmation_source = CASE WHEN upper(btrim(country)) <> 'US' THEN 'non_default' ELSE 'us_address_evidence' END
 WHERE country_confirmed = FALSE
   AND (upper(btrim(country)) NOT IN ('', 'US') OR users_us_address_evidence(country, phone, zip_code, state));

-- ZIP centroid lookups for geo_radius regions on user-anchored analytics.
CREATE INDEX IF NOT EXISTS idx_direct_geocode_cache_zip
  ON direct_geocode_cache (zip_code) WHERE zip_code IS NOT NULL AND lat IS NOT NULL AND lng IS NOT NULL;
