-- D14: activity events have one retention policy regardless of legal basis.
-- Apply this after C002 on every ClickHouse replica and shard.
ALTER TABLE growth.activity_events ON CLUSTER growth
MODIFY TTL day + INTERVAL 90 DAY DELETE;
