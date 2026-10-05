-- Observe existing financial writers; this is source-version evidence, not a
-- second ledger. No amounts, statuses, timestamps or issued documents are changed.
-- Existing records get an observation baseline NOW, never a historical backfill.
BEGIN;

CREATE TABLE IF NOT EXISTS settlement_source_history (
  id BIGSERIAL PRIMARY KEY,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('business_invoice','helper_job','helper_payment')),
  source_id TEXT NOT NULL,
  scope_id TEXT,
  currency_code TEXT,
  operation TEXT NOT NULL CHECK (operation IN ('baseline','insert','update','delete')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  source JSONB NOT NULL CHECK (jsonb_typeof(source) = 'object')
);
CREATE INDEX IF NOT EXISTS settlement_source_history_scope
  ON settlement_source_history(source_kind, scope_id, currency_code, id);
CREATE INDEX IF NOT EXISTS settlement_source_history_record
  ON settlement_source_history(source_kind, source_id, id);

CREATE OR REPLACE FUNCTION settlement_source_projection(kind TEXT, row_data JSONB)
RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_object_agg(key, value) FROM jsonb_each(row_data)
  WHERE key = ANY(CASE kind
    WHEN 'business_invoice' THEN ARRAY['id','business_id','user_id','invoice_number','client_name',
      'status','issue_date','due_date','total','amount_paid','paid_at','currency_code']
    WHEN 'helper_job' THEN ARRAY['id','assigned_helper_id','title','status','payout_status',
      'completed_at','paid_at','helper_payout_cents','platform_fee_cents','customer_total_cents','currency_code']
    WHEN 'helper_payment' THEN ARRAY['id','job_id','payee_id','amount','helper_payout','currency',
      'status','escrow_status','refund_amount','refunded_at','captured_at','released_at']
  END)
$$;

CREATE OR REPLACE FUNCTION capture_settlement_source_history()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  kind TEXT := TG_ARGV[0];
  evidence JSONB;
  old_evidence JSONB;
  scope TEXT;
  currency TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    evidence := settlement_source_projection(kind, to_jsonb(OLD));
  ELSE
    evidence := settlement_source_projection(kind, to_jsonb(NEW));
  END IF;
  IF TG_OP = 'UPDATE' THEN
    old_evidence := settlement_source_projection(kind, to_jsonb(OLD));
    IF evidence = old_evidence THEN RETURN NEW; END IF;
  END IF;
  scope := CASE kind WHEN 'business_invoice' THEN evidence->>'business_id'
    WHEN 'helper_job' THEN evidence->>'assigned_helper_id' ELSE evidence->>'payee_id' END;
  currency := upper(CASE kind WHEN 'helper_payment' THEN evidence->>'currency'
    ELSE evidence->>'currency_code' END);
  INSERT INTO settlement_source_history(source_kind, source_id, scope_id, currency_code, operation, source)
    VALUES(kind, evidence->>'id', scope, currency, lower(TG_OP), evidence);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- Locks prevent a financial write racing the baseline/trigger installation.
LOCK TABLE business_invoices, jobs, payments IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO settlement_source_history(source_kind, source_id, scope_id, currency_code, operation, source)
 SELECT 'business_invoice', i.id::text, i.business_id::text, upper(i.currency_code), 'baseline',
   settlement_source_projection('business_invoice', to_jsonb(i)) FROM business_invoices i
 WHERE NOT EXISTS (SELECT 1 FROM settlement_source_history h
   WHERE h.source_kind = 'business_invoice' AND h.source_id = i.id::text);
INSERT INTO settlement_source_history(source_kind, source_id, scope_id, currency_code, operation, source)
 SELECT 'helper_job', j.id::text, j.assigned_helper_id::text, upper(j.currency_code), 'baseline',
   settlement_source_projection('helper_job', to_jsonb(j)) FROM jobs j
 WHERE NOT EXISTS (SELECT 1 FROM settlement_source_history h
   WHERE h.source_kind = 'helper_job' AND h.source_id = j.id::text);
INSERT INTO settlement_source_history(source_kind, source_id, scope_id, currency_code, operation, source)
 SELECT 'helper_payment', p.id::text, p.payee_id::text, upper(p.currency), 'baseline',
   settlement_source_projection('helper_payment', to_jsonb(p)) FROM payments p
 WHERE NOT EXISTS (SELECT 1 FROM settlement_source_history h
   WHERE h.source_kind = 'helper_payment' AND h.source_id = p.id::text);

DROP TRIGGER IF EXISTS business_invoice_source_history ON business_invoices;
CREATE TRIGGER business_invoice_source_history AFTER INSERT OR UPDATE OR DELETE ON business_invoices
 FOR EACH ROW EXECUTE FUNCTION capture_settlement_source_history('business_invoice');
DROP TRIGGER IF EXISTS helper_job_source_history ON jobs;
CREATE TRIGGER helper_job_source_history AFTER INSERT OR UPDATE OR DELETE ON jobs
 FOR EACH ROW EXECUTE FUNCTION capture_settlement_source_history('helper_job');
DROP TRIGGER IF EXISTS helper_payment_source_history ON payments;
CREATE TRIGGER helper_payment_source_history AFTER INSERT OR UPDATE OR DELETE ON payments
 FOR EACH ROW EXECUTE FUNCTION capture_settlement_source_history('helper_payment');

CREATE OR REPLACE FUNCTION reject_settlement_source_history_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Settlement source history is immutable'; END $$;
DROP TRIGGER IF EXISTS settlement_source_history_immutable ON settlement_source_history;
CREATE TRIGGER settlement_source_history_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON settlement_source_history
 FOR EACH STATEMENT EXECUTE FUNCTION reject_settlement_source_history_mutation();

CREATE OR REPLACE FUNCTION guard_settlement_source_history_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'Settlement source history must be captured by an authoritative source write';
  END IF;
  NEW.recorded_at := clock_timestamp();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS settlement_source_history_capture_only ON settlement_source_history;
CREATE TRIGGER settlement_source_history_capture_only BEFORE INSERT ON settlement_source_history
 FOR EACH ROW EXECUTE FUNCTION guard_settlement_source_history_insert();

-- Expenses have an x100-cents writer but no source currency. Preserve legacy
-- NULLs as unknown; stamp the configured business currency on NEW writes only.
-- No amount, financial workflow, old currency or historical date is invented.
ALTER TABLE business_expenses
  ADD COLUMN IF NOT EXISTS statement_currency_code TEXT,
  ADD COLUMN IF NOT EXISTS statement_minor_unit_digits SMALLINT;
CREATE OR REPLACE FUNCTION capture_business_expense_currency()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT upper(nullif(currency_code, '')) INTO NEW.statement_currency_code
      FROM businesses WHERE id = NEW.business_id;
    NEW.statement_minor_unit_digits := CASE WHEN NEW.statement_currency_code IS NULL THEN NULL ELSE 2 END;
  ELSIF NEW.statement_currency_code IS DISTINCT FROM OLD.statement_currency_code
     OR NEW.statement_minor_unit_digits IS DISTINCT FROM OLD.statement_minor_unit_digits
     OR NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION 'Recorded expense currency and business scope are immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS business_expense_currency_capture ON business_expenses;
CREATE TRIGGER business_expense_currency_capture BEFORE INSERT OR UPDATE ON business_expenses
 FOR EACH ROW EXECUTE FUNCTION capture_business_expense_currency();
COMMIT;
