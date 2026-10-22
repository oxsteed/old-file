-- Exact distinct states are idempotent under replay; SummingMergeTree event
-- counters would double count inserts replayed after a lost acknowledgement.
CREATE TABLE IF NOT EXISTS growth.activity_hourly ON CLUSTER growth (
 hour DateTime('UTC'),event_name LowCardinality(String),role LowCardinality(String),country LowCardinality(String),
 postal_ref UInt32,route LowCardinality(String),element_key LowCardinality(String),
 events AggregateFunction(uniqExact,UUID),subjects AggregateFunction(uniq,String)
) ENGINE=ReplicatedAggregatingMergeTree('/clickhouse/{shard}/growth/activity_hourly','{replica}')
 PARTITION BY toYYYYMM(hour) ORDER BY(hour,event_name,role,country,postal_ref,route,element_key)
 TTL hour+INTERVAL 13 MONTH DELETE;
CREATE MATERIALIZED VIEW IF NOT EXISTS growth.activity_hourly_mv ON CLUSTER growth TO growth.activity_hourly AS
 SELECT toStartOfHour(occurred_at) AS hour,event_name,role,country,postal_ref,route,element_key,
 uniqExactState(event_id) AS events,uniqState(toString(subject_key)) AS subjects
 FROM growth.activity_events WHERE NOT is_bot AND NOT is_internal
 GROUP BY hour,event_name,role,country,postal_ref,route,element_key;
CREATE TABLE IF NOT EXISTS growth.subject_activity_daily ON CLUSTER growth (
 day Date,subject_key FixedString(64),event_name LowCardinality(String),
 events AggregateFunction(uniqExact,UUID)
) ENGINE=ReplicatedAggregatingMergeTree('/clickhouse/{shard}/growth/subject_activity_daily','{replica}')
 PARTITION BY toYYYYMM(day) ORDER BY(day,subject_key,event_name)
 TTL day+INTERVAL 13 MONTH DELETE;
CREATE MATERIALIZED VIEW IF NOT EXISTS growth.subject_activity_daily_mv ON CLUSTER growth TO growth.subject_activity_daily AS
 SELECT day,subject_key,event_name,uniqExactState(event_id) AS events
 FROM growth.activity_events WHERE NOT is_bot AND NOT is_internal GROUP BY day,subject_key,event_name;
GRANT ON CLUSTER growth SELECT ON growth.activity_hourly TO growth_reader,growth_nightly;
GRANT ON CLUSTER growth SELECT, ALTER DELETE ON growth.subject_activity_daily TO growth_rights;
GRANT ON CLUSTER growth SELECT ON growth.subject_activity_daily TO growth_nightly;
