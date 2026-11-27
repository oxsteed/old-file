-- G11-B4 (D-611): the calendar guard also blocks a new booking while an
-- earlier live booking for the same tool is overdue and unreturned. The
-- overdue check runs on INSERT only: a status/date change to an existing
-- booking (approval, payment confirmation, return) must never be stranded
-- by a rental that went overdue after the booking was created; createBooking
-- is the enforcement point for new bookings and this guard is the backstop
-- for direct inserts. A booking ending today is not overdue yet.
CREATE OR REPLACE FUNCTION equipment_booking_calendar_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status NOT IN ('pending','confirmed','invoice_sent','payment_confirmed') THEN RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(hashtext('tool-rental:'||NEW.tool_id::text));
 IF EXISTS(SELECT 1 FROM tool_rentals_bookings b WHERE b.tool_id=NEW.tool_id AND b.id<>NEW.id
  AND b.status IN ('pending','confirmed','invoice_sent','payment_confirmed') AND b.start_date<=NEW.end_date AND b.end_date>=NEW.start_date) THEN
  RAISE EXCEPTION 'Equipment dates conflict' USING ERRCODE='23514',CONSTRAINT='equipment_calendar_conflict';
 END IF;
 IF TG_OP = 'INSERT' AND EXISTS(SELECT 1 FROM tool_rentals_bookings b WHERE b.tool_id=NEW.tool_id AND b.id<>NEW.id
  AND b.status='payment_confirmed' AND b.end_date < CURRENT_DATE) THEN
  RAISE EXCEPTION 'Previous rental overdue and unreturned' USING ERRCODE='23514',CONSTRAINT='equipment_previous_rental_overdue';
 END IF;
 RETURN NEW;
END $$;
