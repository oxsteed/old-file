-- 243_business_message_templates.sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_message_templates') THEN
    CREATE TABLE business_message_templates (
      id           BIGSERIAL    PRIMARY KEY,
      business_id  INTEGER      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name         VARCHAR(200) NOT NULL,
      category     VARCHAR(60)  NOT NULL,
      subject      VARCHAR(300),
      body         TEXT         NOT NULL,
      variables    JSONB        NOT NULL DEFAULT '[]',
      is_active    BOOLEAN      NOT NULL DEFAULT true,
      use_count    INTEGER      NOT NULL DEFAULT 0,
      created_by   UUID         REFERENCES users(id) ON DELETE SET NULL,
      created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
      CONSTRAINT bmt_category_check CHECK (
        category IN ('appointment_reminder','follow_up','payment_request','quote_follow_up','welcome','custom')
      )
    );
    CREATE INDEX idx_bmt_business_id ON business_message_templates(business_id);
    CREATE INDEX idx_bmt_category ON business_message_templates(business_id, category);
  END IF;
END $$;
