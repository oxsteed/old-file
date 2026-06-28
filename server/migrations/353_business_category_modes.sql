-- Migration 353: Durable Business Hub category model.
--
-- The iOS Business Hub onboarding chooses a broad category and a subtype.
-- Historically only `business_type` stored the subtype, which meant the
-- backend could not reliably decide which product surface should activate
-- for the business. Keep `business_type` as the user-facing subtype and store
-- the long-term routing values separately.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS industry_category VARCHAR(50),
  ADD COLUMN IF NOT EXISTS business_mode VARCHAR(50);

UPDATE businesses
   SET industry_category = COALESCE(
         industry_category,
         CASE
           WHEN LOWER(COALESCE(business_type, '')) IN (
             'restaurant', 'cafe / coffee shop', 'bakery', 'food truck', 'bar & lounge', 'catering'
           ) THEN 'food'
           WHEN LOWER(COALESCE(business_type, '')) IN (
             'cleaning', 'plumbing', 'electrical', 'carpentry', 'landscaping', 'general repairs'
           ) THEN 'services'
           WHEN LOWER(COALESCE(business_type, '')) IN (
             'clothing & fashion', 'electronics', 'grocery', 'home & decor', 'books & stationery', 'general retail'
           ) THEN 'retail'
           WHEN LOWER(COALESCE(business_type, '')) IN (
             'hair salon', 'nail studio', 'spa & massage', 'barbershop', 'fitness studio', 'wellness coaching'
           ) THEN 'beauty'
           WHEN LOWER(COALESCE(business_type, '')) IN (
             'financial consulting', 'legal services', 'business strategy', 'marketing & pr', 'it & tech', 'life coaching'
           ) THEN 'consulting'
           WHEN LOWER(COALESCE(business_type, '')) IN (
             'medical clinic', 'dental', 'pharmacy', 'mental health', 'physical therapy', 'veterinary'
           ) THEN 'health'
           WHEN LOWER(COALESCE(business_type, '')) IN (
             'auto repair', 'car wash', 'auto sales', 'transportation & logistics', 'driving school', 'towing'
           ) THEN 'auto'
           ELSE NULL
         END
       );

UPDATE businesses
   SET business_mode = COALESCE(
         business_mode,
         CASE
           WHEN industry_category = 'food' THEN 'food'
           WHEN industry_category IN ('services', 'beauty', 'consulting', 'health', 'auto') THEN 'services_marketplace'
           WHEN industry_category = 'retail' THEN 'retail'
           ELSE NULL
         END
       );

CREATE INDEX IF NOT EXISTS idx_businesses_industry_category
  ON businesses(industry_category)
  WHERE industry_category IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_businesses_business_mode
  ON businesses(business_mode)
  WHERE business_mode IS NOT NULL AND deleted_at IS NULL;
