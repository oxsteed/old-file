-- Canonical minor amounts remain authoritative; retain exact major display
-- amounts for supported three-decimal currencies. PostgreSQL requires UPDATE
-- OF triggers to be recreated around a referenced column type change.
DO $$
DECLARE
 triggers JSONB;
 item JSONB;
BEGIN
 LOCK TABLE bids IN ACCESS EXCLUSIVE MODE;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('name',tgname,'ddl',pg_get_triggerdef(oid),'enabled',tgenabled)), '[]'::jsonb)
 INTO triggers FROM pg_trigger WHERE tgrelid='bids'::regclass AND NOT tgisinternal;
 FOR item IN SELECT value FROM jsonb_array_elements(triggers) LOOP
  EXECUTE format('DROP TRIGGER %I ON bids',item->>'name');
 END LOOP;
 ALTER TABLE bids ALTER COLUMN amount TYPE NUMERIC(16,3);
 FOR item IN SELECT value FROM jsonb_array_elements(triggers) LOOP
  EXECUTE item->>'ddl';
  IF item->>'enabled'='D' THEN EXECUTE format('ALTER TABLE bids DISABLE TRIGGER %I',item->>'name'); END IF;
  IF item->>'enabled'='R' THEN EXECUTE format('ALTER TABLE bids ENABLE REPLICA TRIGGER %I',item->>'name'); END IF;
  IF item->>'enabled'='A' THEN EXECUTE format('ALTER TABLE bids ENABLE ALWAYS TRIGGER %I',item->>'name'); END IF;
 END LOOP;
END $$;
-- A job deletion cascades through both the original and resulting quote.
ALTER TABLE helper_quote_counters DROP CONSTRAINT IF EXISTS helper_quote_counters_result_quote_id_fkey;
ALTER TABLE helper_quote_counters ADD CONSTRAINT helper_quote_counters_result_quote_id_fkey
 FOREIGN KEY(result_quote_id) REFERENCES helper_quotes(id) ON DELETE SET NULL;
