-- 240_business_marketing.sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_broadcasts') THEN
    CREATE TABLE business_broadcasts (
      id               BIGSERIAL    PRIMARY KEY,
      business_id      INTEGER      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      subject          VARCHAR(300) NOT NULL,
      body             TEXT         NOT NULL,
      audience_tag     VARCHAR(100),
      sent_at          TIMESTAMPTZ,
      recipient_count  INTEGER,
      status           VARCHAR(20)  NOT NULL DEFAULT 'draft',
      created_by       UUID         REFERENCES users(id) ON DELETE SET NULL,
      created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
      CONSTRAINT bb_status_check CHECK (status IN ('draft','sent'))
    );
    CREATE INDEX idx_bb_business_id ON business_broadcasts(business_id);
    CREATE INDEX idx_bb_status ON business_broadcasts(business_id, status);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_promo_codes') THEN
    CREATE TABLE business_promo_codes (
      id              BIGSERIAL      PRIMARY KEY,
      business_id     INTEGER        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      code            VARCHAR(50)    NOT NULL,
      discount_type   VARCHAR(20)    NOT NULL,
      discount_value  NUMERIC(10,2)  NOT NULL,
      min_order_cents INTEGER        NOT NULL DEFAULT 0,
      max_uses        INTEGER,
      uses_count      INTEGER        NOT NULL DEFAULT 0,
      valid_from      DATE,
      valid_until     DATE,
      is_active       BOOLEAN        NOT NULL DEFAULT true,
      created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
      CONSTRAINT bpc_discount_type_check CHECK (discount_type IN ('percent','fixed')),
      UNIQUE(business_id, code)
    );
    CREATE INDEX idx_bpc_business_id ON business_promo_codes(business_id);
    CREATE INDEX idx_bpc_active ON business_promo_codes(business_id, is_active);
  END IF;
END $$;
