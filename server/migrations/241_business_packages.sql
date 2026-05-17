-- 241_business_packages.sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_service_packages') THEN
    CREATE TABLE business_service_packages (
      id                   BIGSERIAL    PRIMARY KEY,
      business_id          INTEGER      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name                 VARCHAR(200) NOT NULL,
      description          TEXT,
      service_id           UUID,
      session_count        INTEGER      NOT NULL DEFAULT 1,
      price_cents          INTEGER      NOT NULL,
      original_price_cents INTEGER,
      is_active            BOOLEAN      NOT NULL DEFAULT true,
      valid_days           INTEGER      NOT NULL DEFAULT 365,
      created_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_bsp_business_id ON business_service_packages(business_id);
    CREATE INDEX idx_bsp_active ON business_service_packages(business_id, is_active);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_client_packages') THEN
    CREATE TABLE business_client_packages (
      id                 BIGSERIAL    PRIMARY KEY,
      package_id         BIGINT       NOT NULL REFERENCES business_service_packages(id) ON DELETE CASCADE,
      business_id        INTEGER      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      client_user_id     UUID         REFERENCES users(id) ON DELETE SET NULL,
      client_name        VARCHAR(200),
      client_email       VARCHAR(255),
      sessions_remaining INTEGER      NOT NULL,
      purchased_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
      expires_at         TIMESTAMPTZ,
      status             VARCHAR(20)  NOT NULL DEFAULT 'active',
      CONSTRAINT bcp_status_check CHECK (status IN ('active','exhausted','expired','cancelled'))
    );
    CREATE INDEX idx_bcp_business_id ON business_client_packages(business_id);
    CREATE INDEX idx_bcp_package_id ON business_client_packages(package_id);
    CREATE INDEX idx_bcp_client ON business_client_packages(client_email);
  END IF;
END $$;
