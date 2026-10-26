-- F-15: retire the hard-coded platform POS discount codes.
-- WELCOME10 / LUNCH15 / VIP20 used to be accepted by every restaurant's POS
-- from server code. Restaurants that actually used one keep it, now as
-- their own editable discount definition (same percentage); nobody else
-- gets them. ON CONFLICT keeps any definition the restaurant already made
-- with the same code.
INSERT INTO restaurant_discount_definitions
  (restaurant_id, code, name, kind, value, requires_approval, is_active)
SELECT used.restaurant_id, legacy.code, legacy.name, 'percent', legacy.pct, FALSE, TRUE
  FROM (VALUES ('WELCOME10', 'Welcome 10%', 10),
               ('LUNCH15', 'Lunch 15%', 15),
               ('VIP20', 'VIP 20%', 20)) AS legacy(code, name, pct)
  JOIN LATERAL (
    SELECT DISTINCT o.restaurant_id
      FROM food_orders o
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(o.metadata -> 'posDiscounts') = 'array'
             THEN o.metadata -> 'posDiscounts' ELSE '[]'::jsonb END
      ) AS d(line)
     WHERE upper(d.line ->> 'code') = legacy.code
       AND o.restaurant_id IS NOT NULL
  ) AS used ON TRUE
ON CONFLICT (restaurant_id, code) DO NOTHING;

-- S-04 / F-22: business-local work dates for restaurant time clock entries
-- are computed by the server from the business timezone; index the
-- employee's own entries for the "My time" view.
CREATE INDEX IF NOT EXISTS business_time_entries_user_date_idx
  ON business_time_entries (business_id, user_id, entry_date DESC, id DESC);
