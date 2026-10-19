ALTER TABLE analytics_query_audit DROP CONSTRAINT IF EXISTS analytics_query_audit_event_type_check;
ALTER TABLE analytics_query_audit ADD CONSTRAINT analytics_query_audit_event_type_check
  CHECK (event_type IN ('execution','export','nl_parse','evidence'));
