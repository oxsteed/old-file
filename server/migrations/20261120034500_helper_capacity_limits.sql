ALTER TABLE helper_profiles ADD COLUMN IF NOT EXISTS daily_job_limit INTEGER CHECK(daily_job_limit BETWEEN 1 AND 30);
ALTER TABLE helper_profiles ADD COLUMN IF NOT EXISTS travel_buffer_minutes INTEGER NOT NULL DEFAULT 0 CHECK(travel_buffer_minutes BETWEEN 0 AND 240);
ALTER TABLE helper_profiles ADD COLUMN IF NOT EXISTS capacity_version INTEGER NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION enforce_helper_capacity_limits() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
 daily_limit INTEGER;
 travel_minutes INTEGER;
 zone TEXT;
 day DATE;
 count_booked INTEGER;
BEGIN
 IF NEW.helper_id IS NULL OR NEW.status NOT IN ('requested','confirmed','in_progress') THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.helper_id IS NOT DISTINCT FROM OLD.helper_id
  AND NEW.scheduled_start_time IS NOT DISTINCT FROM OLD.scheduled_start_time
  AND NEW.scheduled_end_time IS NOT DISTINCT FROM OLD.scheduled_end_time
  AND OLD.status IN ('requested','confirmed','in_progress') THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('appointments:'||NEW.helper_id::text));
 SELECT daily_job_limit,travel_buffer_minutes INTO daily_limit,travel_minutes FROM helper_profiles WHERE user_id=NEW.helper_id;
 IF daily_limit IS NULL AND COALESCE(travel_minutes,0)=0 THEN RETURN NEW; END IF;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=u.timezone) THEN u.timezone ELSE 'UTC' END INTO zone FROM users u WHERE u.id=NEW.helper_id;
 zone:=COALESCE(zone,'UTC');
 IF daily_limit IS NOT NULL THEN
  FOR day IN SELECT generate_series((NEW.scheduled_start_time AT TIME ZONE zone)::date,
    ((NEW.scheduled_end_time-INTERVAL '1 microsecond') AT TIME ZONE zone)::date,INTERVAL '1 day')::date LOOP
   SELECT COUNT(*) INTO count_booked FROM appointments a
    WHERE a.helper_id=NEW.helper_id AND a.id IS DISTINCT FROM NEW.id
     AND (NEW.job_id IS NULL OR a.job_id IS DISTINCT FROM NEW.job_id)
     AND a.status IN ('requested','confirmed','in_progress','completed')
     AND (a.scheduled_start_time AT TIME ZONE zone)<day+1 AND (a.scheduled_end_time AT TIME ZONE zone)>day;
   IF count_booked>=daily_limit THEN
    RAISE EXCEPTION 'helper_daily_capacity' USING ERRCODE='23514',CONSTRAINT='helper_daily_capacity';
   END IF;
  END LOOP;
 END IF;
 IF COALESCE(travel_minutes,0)>0 AND EXISTS(
  SELECT 1 FROM appointments a WHERE a.helper_id=NEW.helper_id AND a.id IS DISTINCT FROM NEW.id
   AND (NEW.job_id IS NULL OR a.job_id IS DISTINCT FROM NEW.job_id)
   AND a.status IN ('requested','confirmed','in_progress')
   AND a.scheduled_start_time<NEW.scheduled_end_time+make_interval(mins=>travel_minutes)
   AND a.scheduled_end_time>NEW.scheduled_start_time-make_interval(mins=>travel_minutes)
 ) THEN
  RAISE EXCEPTION 'helper_travel_conflict' USING ERRCODE='23514',CONSTRAINT='helper_travel_conflict';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_helper_capacity_limits ON appointments;
CREATE TRIGGER trg_helper_capacity_limits BEFORE INSERT OR UPDATE ON appointments
 FOR EACH ROW EXECUTE FUNCTION enforce_helper_capacity_limits();
