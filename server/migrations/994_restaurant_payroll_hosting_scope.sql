-- Explicit store attribution for payroll inputs and waitlist notification leases.
-- Ambiguous legacy payroll rows remain unassigned and are excluded from scoped reports.
ALTER TABLE business_staff_shifts ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES restaurant_locations(id);
ALTER TABLE business_time_entries ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES restaurant_locations(id);
ALTER TABLE restaurant_declared_cash_tips ADD COLUMN IF NOT EXISTS location_id BIGINT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cash_tips_restaurant_location_fk') THEN
    ALTER TABLE restaurant_declared_cash_tips ADD CONSTRAINT cash_tips_restaurant_location_fk
      FOREIGN KEY (restaurant_id, location_id) REFERENCES restaurant_locations(restaurant_id, id);
  END IF;
END $$;
ALTER TABLE restaurant_waitlist_entries ADD COLUMN IF NOT EXISTS notification_claimed_at TIMESTAMPTZ;
ALTER TABLE restaurant_waitlist_entries ADD COLUMN IF NOT EXISTS notification_claim_token UUID;
CREATE INDEX IF NOT EXISTS idx_staff_shifts_store_date ON business_staff_shifts(location_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_time_entries_store_date ON business_time_entries(location_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_cash_tips_store_date ON restaurant_declared_cash_tips(location_id, business_date);

-- Payroll management is an explicit grant. Existing view-only grants stay read-only.
INSERT INTO team_permissions(code, group_key, description)
VALUES ('payroll.manage', 'finance', 'Manage restaurant labor policies, tip pools and cash-tip declarations.')
ON CONFLICT(code) DO NOTHING;

CREATE OR REPLACE FUNCTION restaurant_payroll_business_location() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE location_business BIGINT; location_restaurant BIGINT; candidate BIGINT;
BEGIN
  IF NEW.location_id IS NULL AND TG_OP='INSERT' THEN
    SELECT MIN(l.id) INTO candidate FROM restaurant_locations l
      JOIN food_restaurants r ON r.id=l.restaurant_id
      WHERE r.business_id=NEW.business_id AND l.status <> 'archived'
      HAVING COUNT(*)=1;
    NEW.location_id := candidate;
  END IF;
  IF NEW.location_id IS NOT NULL THEN
    SELECT r.business_id, r.id INTO location_business, location_restaurant
      FROM restaurant_locations l JOIN food_restaurants r ON r.id=l.restaurant_id
      WHERE l.id=NEW.location_id;
    IF location_business IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'Payroll store must belong to the business' USING ERRCODE='23514';
    END IF;
    IF TG_TABLE_NAME='business_staff_shifts' THEN
      IF NEW.restaurant_id IS NOT NULL AND NEW.restaurant_id <> location_restaurant THEN
        RAISE EXCEPTION 'Schedule store must belong to the restaurant' USING ERRCODE='23514';
      END IF;
      NEW.restaurant_id := location_restaurant;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_schedule_business_location ON business_staff_shifts;
CREATE TRIGGER trg_schedule_business_location BEFORE INSERT OR UPDATE ON business_staff_shifts
FOR EACH ROW EXECUTE FUNCTION restaurant_payroll_business_location();
DROP TRIGGER IF EXISTS trg_time_entry_business_location ON business_time_entries;
CREATE TRIGGER trg_time_entry_business_location BEFORE INSERT OR UPDATE ON business_time_entries
FOR EACH ROW EXECUTE FUNCTION restaurant_payroll_business_location();

-- Backfill only when the business/restaurant has exactly one possible store.
WITH single_store AS (
 SELECT r.business_id, MIN(l.id) AS location_id FROM restaurant_locations l
 JOIN food_restaurants r ON r.id=l.restaurant_id
 GROUP BY r.business_id HAVING COUNT(*)=1
)
UPDATE business_staff_shifts s SET location_id=l.location_id FROM single_store l
WHERE s.business_id=l.business_id AND s.location_id IS NULL;
WITH single_store AS (
 SELECT r.business_id, MIN(l.id) AS location_id FROM restaurant_locations l
 JOIN food_restaurants r ON r.id=l.restaurant_id
 GROUP BY r.business_id HAVING COUNT(*)=1
)
UPDATE business_time_entries t SET location_id=l.location_id FROM single_store l
WHERE t.business_id=l.business_id AND t.location_id IS NULL;
WITH single_store AS (
 SELECT restaurant_id, MIN(id) AS location_id FROM restaurant_locations
 GROUP BY restaurant_id HAVING COUNT(*)=1
)
UPDATE restaurant_declared_cash_tips t SET location_id=l.location_id FROM single_store l
WHERE t.restaurant_id=l.restaurant_id AND t.location_id IS NULL;
