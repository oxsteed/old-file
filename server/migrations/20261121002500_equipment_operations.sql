ALTER TABLE tool_rentals ADD COLUMN accessories JSONB NOT NULL DEFAULT '[]';
ALTER TABLE tool_rentals ADD COLUMN condition_checklist JSONB NOT NULL DEFAULT '[]';
ALTER TABLE tool_rentals ADD COLUMN equipment_version INTEGER NOT NULL DEFAULT 1;
CREATE FUNCTION equipment_policy_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.equipment_version:=OLD.equipment_version+1;RETURN NEW;END $$;
CREATE TRIGGER equipment_policy_version BEFORE UPDATE OF accessories,condition_checklist,owner_rules ON tool_rentals FOR EACH ROW EXECUTE FUNCTION equipment_policy_version();
ALTER TABLE tool_rentals_bookings ADD COLUMN equipment_snapshot JSONB;
CREATE FUNCTION equipment_booking_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 SELECT jsonb_build_object('accessories',accessories,'checklist',condition_checklist,'rules',COALESCE(owner_rules,''),'version',equipment_version)
 INTO NEW.equipment_snapshot FROM tool_rentals WHERE id=NEW.tool_id;
 RETURN NEW;
END $$;
CREATE TRIGGER equipment_booking_snapshot BEFORE INSERT ON tool_rentals_bookings FOR EACH ROW EXECUTE FUNCTION equipment_booking_snapshot();
CREATE FUNCTION equipment_booking_calendar_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status NOT IN ('pending','confirmed','invoice_sent','payment_confirmed') THEN RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(hashtext('tool-rental:'||NEW.tool_id::text));
 IF EXISTS(SELECT 1 FROM tool_rentals_bookings b WHERE b.tool_id=NEW.tool_id AND b.id<>NEW.id
  AND b.status IN ('pending','confirmed','invoice_sent','payment_confirmed') AND b.start_date<=NEW.end_date AND b.end_date>=NEW.start_date) THEN
  RAISE EXCEPTION 'Equipment dates conflict' USING ERRCODE='23514',CONSTRAINT='equipment_calendar_conflict';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER equipment_booking_calendar_guard BEFORE INSERT OR UPDATE OF start_date,end_date,status ON tool_rentals_bookings FOR EACH ROW EXECUTE FUNCTION equipment_booking_calendar_guard();
CREATE TABLE equipment_reports (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 booking_id BIGINT NOT NULL REFERENCES tool_rentals_bookings(id) ON DELETE CASCADE,
 actor_id UUID NOT NULL REFERENCES users(id),
 phase TEXT NOT NULL CHECK(phase IN ('pickup','return')),
 version INTEGER NOT NULL,
 counts JSONB NOT NULL,
 checklist JSONB NOT NULL,
 notes TEXT NOT NULL CHECK(length(notes) BETWEEN 1 AND 2000),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(booking_id,actor_id,phase,version)
);
CREATE TABLE equipment_missing_accessories (
 report_id UUID PRIMARY KEY REFERENCES equipment_reports(id) ON DELETE CASCADE,
 items JSONB NOT NULL,
 resolved_at TIMESTAMPTZ,
 resolution TEXT,
 version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE equipment_extensions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 booking_id BIGINT NOT NULL REFERENCES tool_rentals_bookings(id) ON DELETE CASCADE,
 requested_by UUID NOT NULL REFERENCES users(id),
 old_end DATE NOT NULL,
 requested_end DATE NOT NULL CHECK(requested_end>old_end),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','declined','cancelled')),
 request_id UUID NOT NULL UNIQUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 decided_at TIMESTAMPTZ,
 decided_by UUID REFERENCES users(id)
);
CREATE UNIQUE INDEX equipment_one_pending_extension ON equipment_extensions(booking_id) WHERE status='pending';
CREATE TABLE equipment_records (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tool_id BIGINT NOT NULL REFERENCES tool_rentals(id) ON DELETE CASCADE,
 booking_id BIGINT REFERENCES tool_rentals_bookings(id) ON DELETE CASCADE,
 actor_id UUID NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN ('repair','late_return_followup')),
 notes TEXT NOT NULL CHECK(length(notes) BETWEEN 1 AND 2000),
 occurred_on DATE NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
