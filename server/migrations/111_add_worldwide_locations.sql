-- Expand consulting_requests to support worldwide countries and states/provinces
-- Add operating_country field and expand operating_state for longer state/province/city names

ALTER TABLE consulting_requests
  ADD COLUMN operating_country VARCHAR(100),
  ALTER COLUMN operating_state SET DATA TYPE VARCHAR(100);

-- Create index for country lookups
CREATE INDEX idx_consulting_requests_country ON consulting_requests(operating_country);

-- Add comment for clarity
COMMENT ON COLUMN consulting_requests.operating_country IS 'Country where business will operate (e.g., US, CA, AU, etc.)';
COMMENT ON COLUMN consulting_requests.operating_state IS 'State, province, region, or city name (flexible for worldwide use)';
