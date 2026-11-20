CREATE TABLE business_quote_standards (
 business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
 terms TEXT NOT NULL DEFAULT '' CHECK(length(terms)<=4000),
 version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE business_quote_templates (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 name VARCHAR(100) NOT NULL,
 line_items JSONB NOT NULL,
 tax_rate NUMERIC(5,2) NOT NULL CHECK(tax_rate BETWEEN 0 AND 100),
 terms TEXT NOT NULL CHECK(length(terms)<=4000),
 version INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX business_quote_templates_scope_idx ON business_quote_templates(business_id);
ALTER TABLE business_quotes ADD COLUMN standard_terms TEXT;
ALTER TABLE lead_quotes ADD COLUMN standard_terms TEXT;
-- Every creation path, including chat and leads, snapshots the current terms.
-- Later defaults never rewrite terms on quotes already sent to a customer.
CREATE FUNCTION snapshot_business_quote_terms() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE scope_id INTEGER;
BEGIN
 IF TG_OP='UPDATE' THEN
   IF NEW.standard_terms IS DISTINCT FROM OLD.standard_terms AND OLD.status <> 'draft' THEN
     RAISE EXCEPTION 'Sent quote terms are immutable' USING ERRCODE='23514',CONSTRAINT='business_quote_terms_locked';
   END IF;
 ELSE
   IF TG_TABLE_NAME='lead_quotes' THEN
     SELECT business_id INTO scope_id FROM business_leads WHERE id=NEW.lead_id;
   ELSE scope_id:=NEW.business_id;
   END IF;
   IF NEW.standard_terms IS NULL THEN
     SELECT terms INTO NEW.standard_terms FROM business_quote_standards WHERE business_id=scope_id;
     NEW.standard_terms:=COALESCE(NEW.standard_terms,'');
   END IF;
 END IF;
 IF NEW.standard_terms IS NOT NULL AND length(NEW.standard_terms)>4000 THEN
   RAISE EXCEPTION 'Quote terms too long' USING ERRCODE='23514',CONSTRAINT='business_quote_terms_length';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER business_quote_terms_snapshot BEFORE INSERT OR UPDATE OF standard_terms ON business_quotes FOR EACH ROW EXECUTE FUNCTION snapshot_business_quote_terms();
CREATE TRIGGER lead_quote_terms_snapshot BEFORE INSERT ON lead_quotes FOR EACH ROW EXECUTE FUNCTION snapshot_business_quote_terms();
