-- 242_business_health_alerts.sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_health_alerts') THEN
    CREATE TABLE business_health_alerts (
      id           BIGSERIAL    PRIMARY KEY,
      business_id  INTEGER      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      alert_type   VARCHAR(60)  NOT NULL,
      severity     VARCHAR(20)  NOT NULL DEFAULT 'info',
      title        VARCHAR(300) NOT NULL,
      message      TEXT,
      action_url   TEXT,
      is_dismissed BOOLEAN      NOT NULL DEFAULT false,
      dismissed_at TIMESTAMPTZ,
      created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
      CONSTRAINT bha_severity_check CHECK (severity IN ('info','warning','critical')),
      UNIQUE(business_id, alert_type)
    );
    CREATE INDEX idx_bha_business_id ON business_health_alerts(business_id, is_dismissed);
    CREATE INDEX idx_bha_created_at ON business_health_alerts(created_at DESC);
  END IF;
END $$;
