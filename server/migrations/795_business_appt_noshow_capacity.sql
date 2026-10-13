-- Migration 795: no_show appointments free capacity at the DB level (audit P3-8-F03).
--
-- Every app-level guard (enforceBookingRules BLOCKING list, the controller's
-- assertAppointmentWindowFree, bookingSlotEngine SLOT_STATUSES_BLOCKING,
-- checkBusinessSlotFree) treats no_show as non-blocking: a no-showed
-- appointment consumes no capacity and blocks no staff time. But the
-- ba_no_staff_double_booking exclusion backstop (migration 626) still
-- counted no_show rows as blocking their staff member's time range, so a
-- no-showed appointment "phantom blocked" the staff member at the DB level
-- even though all app guards considered the window free: a rebook into that
-- window could pass every check and then die on the 23P01 exclusion.
--
-- The new predicate is strictly weaker than the old one (it excludes a
-- superset of rows), so re-adding it over a database that satisfied the old
-- constraint cannot fail. The inner EXCEPTION guard keeps the migration
-- deploy-safe on legacy databases where migration 626 itself was skipped,
-- mirroring 626's pattern. Do not edit migration 626 (checksum-guarded).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ba_no_staff_double_booking') THEN
    ALTER TABLE business_appointments DROP CONSTRAINT ba_no_staff_double_booking;
  END IF;
  BEGIN
    ALTER TABLE business_appointments
      ADD CONSTRAINT ba_no_staff_double_booking
      EXCLUDE USING gist (
        staff_id WITH =,
        tstzrange(start_time, end_time) WITH &&
      )
      WHERE (staff_id IS NOT NULL AND status NOT IN ('cancelled', 'no_show'));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'migration 795: ba_no_staff_double_booking re-add skipped: %', SQLERRM;
  END;
END
$$;
