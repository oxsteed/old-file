-- 237_business_recurring_billing.sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_recurring_billing') THEN
    CREATE TABLE business_recurring_billing (
      id                  BIGSERIAL    PRIMARY KEY,
      business_id         INTEGER      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      client_name         VARCHAR(200) NOT NULL,
      client_email        VARCHAR(255),
      description         TEXT         NOT NULL,
      amount_cents        INTEGER      NOT NULL CHECK (amount_cents > 0),
      frequency           VARCHAR(20)  NOT NULL,
      next_billing_date   DATE         NOT NULL,
      last_billed_at      DATE,
      status              VARCHAR(20)  NOT NULL DEFAULT 'active',
      notes               TEXT,
      created_by          UUID         REFERENCES users(id) ON DELETE SET NULL,
      created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
      CONSTRAINT brb_frequency_check CHECK (frequency IN ('weekly','biweekly','monthly','quarterly','annually')),
      CONSTRAINT brb_status_check CHECK (status IN ('active','paused','cancelled'))
    );
    CREATE INDEX idx_brb_business_id ON business_recurring_billing(business_id);
    CREATE INDEX idx_brb_status ON business_recurring_billing(business_id, status);
    CREATE INDEX idx_brb_next_billing ON business_recurring_billing(next_billing_date);
  END IF;
END $$;
