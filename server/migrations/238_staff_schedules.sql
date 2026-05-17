-- 238_staff_schedules.sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_staff_shifts') THEN
    CREATE TABLE business_staff_shifts (
      id           BIGSERIAL    PRIMARY KEY,
      business_id  INTEGER      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      shift_date   DATE         NOT NULL,
      start_time   TIME         NOT NULL,
      end_time     TIME         NOT NULL,
      role_label   VARCHAR(100),
      notes        TEXT,
      created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_bss_business_id ON business_staff_shifts(business_id);
    CREATE INDEX idx_bss_date ON business_staff_shifts(business_id, shift_date);
    CREATE INDEX idx_bss_user ON business_staff_shifts(user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_time_entries') THEN
    CREATE TABLE business_time_entries (
      id           BIGSERIAL      PRIMARY KEY,
      business_id  INTEGER        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      user_id      UUID           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entry_date   DATE           NOT NULL DEFAULT CURRENT_DATE,
      hours_worked NUMERIC(5,2)   NOT NULL CHECK (hours_worked > 0 AND hours_worked <= 24),
      description  TEXT,
      approved_by  UUID           REFERENCES users(id) ON DELETE SET NULL,
      created_at   TIMESTAMPTZ    NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_bte_business_id ON business_time_entries(business_id);
    CREATE INDEX idx_bte_user ON business_time_entries(business_id, user_id);
    CREATE INDEX idx_bte_date ON business_time_entries(entry_date DESC);
  END IF;
END $$;
