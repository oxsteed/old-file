-- Migration 921 predates the spec's guarded regex rule kind. Widen the
-- existing check without changing any taxonomy rows or rule weights.
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT con.conname INTO cname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'demand_taxonomy_rules'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) LIKE '%category_id%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE demand_taxonomy_rules DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE demand_taxonomy_rules
    ADD CONSTRAINT demand_taxonomy_rules_kind_check
    CHECK (kind IN ('category_id','skill_id','job_type','cuisine_tag','menu_tag','keyword','regex'));
END $$;
