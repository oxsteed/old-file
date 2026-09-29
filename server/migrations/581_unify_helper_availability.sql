-- ═══════════════════════════════════════════════════════════════════
-- 581_unify_helper_availability.sql
--
-- Unify helper availability on ONE system:
--   helper_availability  — weekly recurring template (canonical schedule)
--   availability_blocks  — dated exceptions (canonical overrides)
--
-- Retired (left in place, no longer written by code after this):
--   helper_profiles.availability_json          → backfilled into helper_availability
--   helper_availability_overrides               → merged into availability_blocks
--
-- Times are wall-clock (local) values: templates store plain TIME, and the
-- application buckets blocks/appointments by local wall-clock date.
-- Override dates are anchored to UTC explicitly here so the merge does not
-- depend on the database session TimeZone.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Backfill weekly template from availability_json ──────────────────────
-- Only for helpers that have JSON but no template rows yet.
-- JSON shape: {"monday": {"start": "09:00", "end": "17:00"} | {"closed": true}, ...}
-- Keys may be lowercase or capitalized; times may be "HH:MM", "H:MM", or "H:MM AM/PM".

INSERT INTO helper_availability (helper_id, day_of_week, start_time, end_time, is_active)
SELECT hp.user_id,
       d.dow,
       CASE
         WHEN s ~ '^\d{1,2}:\d{2}\s*[AaPp][Mm]$'
           THEN to_timestamp(regexp_replace(upper(s), '\s', '', 'g'), 'HH12:MIAM')::time
         ELSE s::time
       END,
       CASE
         WHEN e ~ '^\d{1,2}:\d{2}\s*[AaPp][Mm]$'
           THEN to_timestamp(regexp_replace(upper(e), '\s', '', 'g'), 'HH12:MIAM')::time
         ELSE e::time
       END,
       TRUE
FROM helper_profiles hp
CROSS JOIN LATERAL (
  VALUES ('sunday',0),('monday',1),('tuesday',2),('wednesday',3),
         ('thursday',4),('friday',5),('saturday',6)
) AS d(dayname, dow)
CROSS JOIN LATERAL (
  SELECT COALESCE(
           hp.availability_json -> d.dayname,
           hp.availability_json -> (upper(left(d.dayname,1)) || substring(d.dayname from 2))
         ) AS day_val
) AS j
CROSS JOIN LATERAL (
  SELECT COALESCE(j.day_val ->> 'start', j.day_val ->> 'open') AS s,
         COALESCE(j.day_val ->> 'end',   j.day_val ->> 'close') AS e,
         COALESCE(lower(j.day_val ->> 'closed'), 'false') IN ('true','1','t','yes') AS is_closed
) AS v
WHERE hp.availability_json IS NOT NULL
  AND NOT v.is_closed
  AND v.s IS NOT NULL AND v.e IS NOT NULL
  AND (
        v.s ~ '^\d{1,2}:\d{2}(:\d{2})?$'
        OR v.s ~ '^\d{1,2}:\d{2}\s*[AaPp][Mm]$'
      )
  AND (
        v.e ~ '^\d{1,2}:\d{2}(:\d{2})?$'
        OR v.e ~ '^\d{1,2}:\d{2}\s*[AaPp][Mm]$'
      )
  AND NOT EXISTS (
        SELECT 1 FROM helper_availability ha
        WHERE ha.helper_id = hp.user_id AND ha.is_active = TRUE
      )
ON CONFLICT DO NOTHING;

-- ── 2. Merge helper_availability_overrides into availability_blocks ─────────
--   is_blocked=TRUE  → 'unavailable' block
--   is_blocked=FALSE → 'available' block (special opening)
-- NULL times mean the whole day → 00:00 to 24:00 (next midnight).
--
-- Expression shape: (date + time) AT TIME ZONE 'UTC'.
--   date + time            → timestamp (valid operator)
--   timestamp AT TIME ZONE → timestamptz (matches availability_blocks columns)
-- TIME '24:00' is valid in PostgreSQL and equals midnight, so a whole-day
-- override spans override_date 00:00 → next day 00:00.

INSERT INTO availability_blocks (helper_id, start_time, end_time, type, title, notes)
SELECT o.helper_id,
       ((o.override_date + COALESCE(o.start_time, TIME '00:00')) AT TIME ZONE 'UTC'),
       ((o.override_date + COALESCE(o.end_time,   TIME '24:00')) AT TIME ZONE 'UTC'),
       CASE WHEN o.is_blocked THEN 'unavailable' ELSE 'available' END,
       o.reason,
       o.reason
FROM helper_availability_overrides o
WHERE NOT EXISTS (
  SELECT 1 FROM availability_blocks ab
  WHERE ab.helper_id  = o.helper_id
    AND ab.start_time = ((o.override_date + COALESCE(o.start_time, TIME '00:00')) AT TIME ZONE 'UTC')
    AND ab.end_time   = ((o.override_date + COALESCE(o.end_time,   TIME '24:00')) AT TIME ZONE 'UTC')
    AND ab.type       = CASE WHEN o.is_blocked THEN 'unavailable' ELSE 'available' END
);

-- ═══════════════════════════════════════════════════════════════════
-- END OF MIGRATION 581
-- ═══════════════════════════════════════════════════════════════════
