CREATE DATABASE IF NOT EXISTS growth ON CLUSTER growth;
CREATE TABLE IF NOT EXISTS growth.schema_migrations ON CLUSTER growth
 (name String, checksum String, applied_at DateTime DEFAULT now())
 ENGINE=ReplicatedReplacingMergeTree('/clickhouse/{shard}/growth/schema_migrations','{replica}') ORDER BY name;
CREATE ROLE IF NOT EXISTS growth_writer ON CLUSTER growth;
CREATE ROLE IF NOT EXISTS growth_reader ON CLUSTER growth;
CREATE ROLE IF NOT EXISTS growth_rights ON CLUSTER growth;
CREATE ROLE IF NOT EXISTS growth_nightly ON CLUSTER growth;
CREATE SETTINGS PROFILE IF NOT EXISTS growth_readonly ON CLUSTER growth
 SETTINGS readonly=1 CONST,max_execution_time=30 CONST,max_result_rows=1000000 CONST,max_memory_usage=2000000000 CONST
 TO growth_reader;
