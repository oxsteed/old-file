ALTER TABLE analytics_query_audit ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'execution'
  CHECK (event_type IN ('execution','export','nl_parse'));
