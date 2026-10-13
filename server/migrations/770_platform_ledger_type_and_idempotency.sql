-- Review W2 (P2-570, P2-571, P3-789, P3-889).
-- Application code writes platform_ledger.type (referral credits, credit
-- applied, dispute holds, franchise royalty) but the column never existed,
-- so those inserts failed. Add it, keep it in sync with source_type, and add
-- an idempotency key so each referral reward / credit application posts once.

ALTER TABLE platform_ledger ADD COLUMN IF NOT EXISTS type VARCHAR(50);
ALTER TABLE platform_ledger ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- The ledger is append-only through rules; lift the update rule only for
-- this one-time backfill of the new column.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_rules WHERE tablename = 'platform_ledger' AND rulename = 'ledger_no_update') THEN
    EXECUTE 'ALTER TABLE platform_ledger DISABLE RULE ledger_no_update';
    UPDATE platform_ledger SET type = source_type WHERE type IS NULL;
    EXECUTE 'ALTER TABLE platform_ledger ENABLE RULE ledger_no_update';
  ELSE
    UPDATE platform_ledger SET type = source_type WHERE type IS NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION platform_ledger_sync_type()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.source_type := COALESCE(NEW.source_type, NEW.type);
  NEW.type := COALESCE(NEW.type, NEW.source_type);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_platform_ledger_sync_type ON platform_ledger;
CREATE TRIGGER trg_platform_ledger_sync_type
  BEFORE INSERT ON platform_ledger
  FOR EACH ROW EXECUTE FUNCTION platform_ledger_sync_type();

CREATE UNIQUE INDEX IF NOT EXISTS platform_ledger_idempotency_key_uniq
  ON platform_ledger (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_platform_ledger_user_type ON platform_ledger (user_id, type);
