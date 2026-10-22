# Growth ClickHouse topology

`docker-compose.growth.yml` is a staging and rehearsal topology for the
Demand & Sales Engine: one shard, two ClickHouse replicas, and three Keeper
members. It is intentionally separate from the legacy application Compose
files and is not a production bootstrap.

Production deployment must supply private-network links, TLS, persistent
encrypted disks, provider and region, backup storage, and credentials through
the deployment secret store. Use the existing `clickhouseMigrate.js` sequence
against the admin endpoint, then run the health, backup, restore-check, and
replica-kill evidence recorded in `docs/growth/clickhouse-runbook.md`.

For a local staging rehearsal, set a synthetic `GROWTH_CH_PASSWORD` in the
environment and run `docker compose -f infra/clickhouse/docker-compose.growth.yml up -d`.
Do not reuse production volumes or credentials.
