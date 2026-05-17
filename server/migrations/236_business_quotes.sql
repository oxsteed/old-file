-- 236_business_quotes.sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_quotes') THEN
    CREATE TABLE business_quotes (
      id                   BIGSERIAL    PRIMARY KEY,
      business_id          INTEGER      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      client_name          VARCHAR(200) NOT NULL,
      client_email         VARCHAR(255),
      title                VARCHAR(300),
      description          TEXT,
      line_items           JSONB        NOT NULL DEFAULT '[]',
      subtotal_cents       INTEGER      NOT NULL DEFAULT 0,
      tax_rate             NUMERIC(5,2) NOT NULL DEFAULT 0,
      total_cents          INTEGER      NOT NULL DEFAULT 0,
      status               VARCHAR(30)  NOT NULL DEFAULT 'draft',
      valid_until          DATE,
      notes                TEXT,
      invoice_id           BIGINT,
      token                VARCHAR(64)  UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
      created_by           UUID         REFERENCES users(id) ON DELETE SET NULL,
      created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
      CONSTRAINT bq_status_check CHECK (status IN ('draft','sent','approved','declined','expired','converted'))
    );
    CREATE INDEX idx_bq_business_id ON business_quotes(business_id);
    CREATE INDEX idx_bq_status ON business_quotes(business_id, status);
    CREATE INDEX idx_bq_created_at ON business_quotes(created_at DESC);
  END IF;
END $$;
