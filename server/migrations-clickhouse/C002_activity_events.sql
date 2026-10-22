CREATE TABLE IF NOT EXISTS growth.activity_events ON CLUSTER growth (
 day Date, event_id UUID, occurred_at DateTime64(3,'UTC'), received_at DateTime64(3,'UTC'),
 event_name LowCardinality(String), schema_ver UInt16,
 subject_key FixedString(64),device_key String,session_key String,
 role LowCardinality(String),surface LowCardinality(String),app_version LowCardinality(String),
 locale LowCardinality(String),country LowCardinality(String),postal_ref UInt32,
 jurisdiction LowCardinality(String),basis Enum8('notice'=1,'consent'=2),
 route LowCardinality(String),element_key LowCardinality(String),entity_type LowCardinality(String),entity_id String,
 props String CODEC(ZSTD(3)),is_bot Bool,is_internal Bool,
 INDEX idx_subject subject_key TYPE bloom_filter(0.01) GRANULARITY 4,
 INDEX idx_device device_key TYPE bloom_filter(0.01) GRANULARITY 4
) ENGINE=ReplicatedReplacingMergeTree('/clickhouse/{shard}/growth/activity_events','{replica}')
 PARTITION BY day ORDER BY (event_name,day,subject_key,event_id)
 TTL day + INTERVAL 30 DAY DELETE WHERE basis='consent',day + INTERVAL 90 DAY DELETE;
GRANT ON CLUSTER growth INSERT ON growth.activity_events TO growth_writer;
GRANT ON CLUSTER growth SELECT, ALTER DELETE ON growth.activity_events TO growth_rights;
GRANT ON CLUSTER growth SELECT ON growth.activity_events TO growth_nightly;
