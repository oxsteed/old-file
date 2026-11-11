-- Product pricing scopes may target either a product UUID or a product
-- category label. The original UUID-only column made category rules fail at
-- insert time and prevented the shared evaluator from applying them.

BEGIN;

ALTER TABLE product_pricing_rules
  ALTER COLUMN applies_to_id TYPE TEXT
  USING applies_to_id::text;

COMMIT;
