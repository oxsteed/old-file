# Growth ClickHouse operations

The `growthClickhouseOps` worker is dormant unless ClickHouse is configured.
It records health, backup, restore-check, and upgrade outcomes in
`growth_ops_runs`. Runtime backup credentials belong in the deployment secret
store; no plaintext secret is committed or printed.

Backups require both `GROWTH_CLICKHOUSE_BACKUP_DISK` and the runtime
`GROWTH_CLICKHOUSE_BACKUP_ENCRYPTION_KEY`. The configured disk must be an
encrypted same-region object-store disk with a seven-day lifecycle policy.
`GROWTH_CLICKHOUSE_RESTORE_CHECK_ENABLED=true` runs a temporary-database
restore check for `GROWTH_CLICKHOUSE_RESTORE_REF`, then drops the temporary
database. `GROWTH_CLICKHOUSE_UPGRADE_ENABLED=true` applies the checksummed
`server/migrations-clickhouse/C*.sql` sequence through the admin client.

A release requires a successful backup, restore-check, replica health result,
and upgrade rehearsal. The worker does not enable tracking or campaigns.
