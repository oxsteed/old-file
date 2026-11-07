-- Migration 20261107140002: labor borrows may span midnight (design-review item 58).
--
-- The borrows table shipped with CHECK (start_time < end_time), which
-- rejected every overnight borrow at the database. Borrows now use the
-- same convention as shifts (see shiftConflictValidation.shiftInterval):
-- end <= start means the borrow ends the next morning, and end == start
-- is a 24h borrow, so no same-day ordering CHECK can express the rule
-- and the CHECK is dropped, not relaxed. The service still validates
-- that both times are well-formed HH:MM, and the time-only
-- representation bounds any borrow to at most 24h. The conflict check
-- (assertNoConflict) is overnight-aware, so the dropped CHECK cannot
-- admit a double-booking.
--
-- The constraint name is looked up, not assumed: the CHECK was
-- unnamed in the creating migration, so its generated name is not a
-- stable contract across databases.
DO $$
DECLARE
  cname text;
BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'restaurant_labor_borrows'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%start_time < end_time%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE restaurant_labor_borrows DROP CONSTRAINT %I', cname);
  END IF;
END $$;
