CREATE TABLE activity_tracking_rollout (
  id SMALLINT PRIMARY KEY CHECK (id=1),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN
    ('draft','notice_scheduled','notice_sending','notice_complete','effective','paused')),
  policy_version TEXT NOT NULL,
  planned_effective_at TIMESTAMPTZ,
  first_notice_sent_at TIMESTAMPTZ,
  last_notice_sent_at TIMESTAMPTZ,
  effective_at TIMESTAMPTZ,
  legal_review_ref TEXT,
  translations_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
  rights_verified BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (effective_at IS NULL OR (last_notice_sent_at IS NOT NULL
    AND planned_effective_at IS NOT NULL
    AND effective_at >= last_notice_sent_at + interval '14 days'
    AND effective_at >= planned_effective_at)),
  CHECK (state NOT IN ('notice_complete','effective') OR effective_at IS NOT NULL)
);
INSERT INTO activity_tracking_rollout(id,policy_version) VALUES(1,'growth-v1');
INSERT INTO platform_settings(key,value,value_type,description) VALUES
 ('growth.activity_tracking_enabled','false','boolean','Growth activity collection kill switch'),
 ('growth.offer_push_weekly_cap','1','number','Maximum offer pushes per person in seven days'),
 ('growth.offer_push_monthly_cap','3','number','Maximum offer pushes per person in thirty days'),
 ('growth.offer_in_app_weekly_cap','3','number','Maximum in-app offers per person in seven days')
ON CONFLICT(key) DO NOTHING;
INSERT INTO platform_settings(key,value,value_type,description) VALUES
 ('growth.jurisdiction_rules','[]','json','Legal-reviewed jurisdiction rules; changes use the settings approval workflow')
ON CONFLICT(key) DO NOTHING;
ALTER TABLE user_consents ADD COLUMN IF NOT EXISTS content_version TEXT;
