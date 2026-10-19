-- Analytics query history must survive application bugs and operator mistakes.
CREATE OR REPLACE FUNCTION prevent_analytics_query_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'analytics_query_audit is append only' USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS analytics_query_audit_append_only ON analytics_query_audit;
CREATE TRIGGER analytics_query_audit_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON analytics_query_audit
FOR EACH STATEMENT EXECUTE FUNCTION prevent_analytics_query_audit_mutation();
