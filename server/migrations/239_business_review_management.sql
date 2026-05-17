-- 239_business_review_management.sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_review_requests') THEN
    CREATE TABLE business_review_requests (
      id              BIGSERIAL    PRIMARY KEY,
      business_id     INTEGER      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      appointment_id  UUID,
      client_email    VARCHAR(255) NOT NULL,
      client_name     VARCHAR(200),
      sent_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
      status          VARCHAR(20)  NOT NULL DEFAULT 'sent',
      created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
      CONSTRAINT brrq_status_check CHECK (status IN ('sent','clicked','reviewed'))
    );
    CREATE INDEX idx_brrq_business_id ON business_review_requests(business_id);
    CREATE INDEX idx_brrq_sent_at ON business_review_requests(sent_at DESC);
  END IF;
END $$;

-- Add owner_reply columns to business_reviews if they don't exist
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_reviews') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'business_reviews' AND column_name = 'owner_reply') THEN
      ALTER TABLE business_reviews ADD COLUMN owner_reply TEXT;
      ALTER TABLE business_reviews ADD COLUMN owner_reply_at TIMESTAMPTZ;
    END IF;
  END IF;
END $$;
