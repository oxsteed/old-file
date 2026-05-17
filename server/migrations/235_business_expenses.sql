-- 235_business_expenses.sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_expenses') THEN
    CREATE TABLE business_expenses (
      id            BIGSERIAL   PRIMARY KEY,
      business_id   INTEGER     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      category      VARCHAR(60) NOT NULL,
      description   TEXT        NOT NULL,
      amount_cents  INTEGER     NOT NULL CHECK (amount_cents > 0),
      expense_date  DATE        NOT NULL DEFAULT CURRENT_DATE,
      receipt_url   TEXT,
      notes         TEXT,
      created_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT business_expenses_category_check CHECK (
        category IN ('materials','labor','vehicle','software','marketing','equipment','utilities','other')
      )
    );
    CREATE INDEX idx_be_business_id ON business_expenses(business_id);
    CREATE INDEX idx_be_date ON business_expenses(business_id, expense_date DESC);
    CREATE INDEX idx_be_category ON business_expenses(business_id, category);
  END IF;
END $$;
