# Existing Coolify database backup reporting

This implementation reports existing executions. It does not create backups,
configure R2, restore production, or create credentials. No migration is needed:
the existing `backup_log.backup_id` unique key and JSONB details hold the durable
execution, source observation, and restoration records. No new HTTP write route
or server bootstrap change is involved.

## Verified source and evidence limits

Read-only inspection on 2026-09-30, starting at repo HEAD
`6b34f4fc012e0805e92daf019d029a81f814f4e2`, confirmed:

- Schedule `fthxpltbf0v8waof9r2fqsi0`, database resource
  `d8tng2ulcrc1pgbvkr6ehcn4`, database `oxsteed_db`.
- Enabled frequency `0 6 * * *`; local backups retained; S3 enabled;
  current destination bucket `oxsteed-backups` uses an R2 endpoint.
- Execution `jve71cca440sfwa863jhnlml`: started `2026-09-30T08:15:11Z`,
  finished `08:15:27Z`, size 3,890,290 bytes, `s3_uploaded=true`, neither
  storage-deletion flag set.
- Execution `lakspgsth3ygjgti2rnviac8`: started `07:56:03Z`, finished
  `07:56:12Z`, size 3,889,740 bytes, `s3_uploaded=null`. This record MUST NOT
  be presented as a confirmed R2 copy.

The live `DatabaseBackupJob` sets `status=success` for a nonempty dump even
when upload fails. Therefore dump success and offsite confirmation are separate.
`verificationLevel=coolify_execution` means Coolify metadata attests to upload
and retention flags. It does not prove current object existence, checksum,
bucket privacy, or restoration. Coolify executions do not retain a historical
destination ID: the collector pins the current schedule/resource/bucket and
records the current configuration. Destination changes require operator review;
do not reuse historical upload flags to assert a different destination received
those executions. No private bucket policy or object read was performed here.

## Durability and failure behavior

`scripts/sync-coolify-backup-monitor.cjs` reads allowlisted metadata from
`coolify-db` using Colima and a read-only, repeatable-read transaction. It never
selects execution messages or S3 credential columns. Reports contain UTC
timestamps, dump basenames, strict booleans, sizes, stable execution UUIDs,
configuration, and an explicit 1,000-execution coverage limit.

The app-side ingester validates before opening a connection and uses one
transaction plus an advisory lock to serialize importers. Execution IDs use
`coolify:<uuid>`; restore tests use `restore:<test-id>`; source observations have
a separate stable key. Same-report retries are no-ops. Older observations cannot
overwrite newer data. Conflicting values at the same observation time roll back.
New observations can update running results or deletion/upload flags. Backup
and restoration counters, duration/size histograms, and failure security/log
events are emitted after commit, once per new result or result transition;
retrying or refreshing the same outcome does not emit them again. Logs use
fixed failure codes, never private Coolify messages or caller errors. A failed
database write propagates failure; it never seeds healthy in-memory history.

Backup age uses execution **start time**, never ingestion time. A report older
than 15 minutes or containing future/invalid timestamps is rejected. Imported
backups are healthy only below 25 hours old with successful completion, positive
size, local copy retained, R2 upload confirmed, expected active configuration,
and a successful collector observation below two hours old containing that
execution. Collector failures record a separate failure observation when delivery
is available. A broken collector or database connection eventually expires the
previous evidence. Database-read failures fail health closed.

Restore records do not affect backup ordering, age, or counts. Legacy restore
calls persist but lack proof and cannot claim verification. Verified restore
records bind an ingested execution to matching filename/size, SHA-256 of the
tested bytes, isolated verifier result, timestamps, and successful checks. Test
IDs are immutable and idempotent. SHA-256 identifies tested bytes; Coolify has no
source checksum to independently authenticate their origin. Preserve trusted
download/copy provenance when obtaining the dump. Treat these JSON documents as
privileged operator evidence, not an untrusted/public input or cryptographic
attestation. Do not manufacture them by hand.

`backupHealthy` describes backup reporting. `restorationVerified` requires a
passing evidenced restore in the last 30 days; `recoveryReady` requires both.
The existing release caller still uses `backupHealthy`; it was not changed.
Empty/unavailable history, failures, incomplete coverage, or missing recovery
readiness cannot produce `COMPLIANT`. Stats count failed executions even without
a filename and exclude in-progress executions from completed-success rates.

## Exact remaining deployment steps (not executed)

1. Review and deploy these service and app-side script files through the normal
   deployment workflow. Keep the existing 06:00 UTC Coolify backup schedule and
   private R2 destination. This work did not commit, push, deploy, or write either
   production database.
2. Identify the current application container with
   `docker --context colima ps --format '{{.Names}}'`. Run the collector dry run
   from this checkout:

   ```sh
   node scripts/sync-coolify-backup-monitor.cjs
   ```

3. After the deployed image contains `server/scripts/ingest-backup-evidence.cjs`,
   ingest with the existing app-container database configuration:

   ```sh
   node scripts/sync-coolify-backup-monitor.cjs --apply --app-container ACTUAL_APP_CONTAINER
   ```

   This is an explicit **production backup_log write**, left for the operator.
   It neither reads out credentials nor changes Coolify. Confirm the existing
   authenticated `GET /api/monitoring/backup-status` shows two distinct backups,
   correct original execution times, R2 unknown for the older execution, and
   `restorationVerified=false` until an actual restore result is ingested.
4. Have Pascal's host automation invoke the same apply command every five minutes
   on the existing host using its normal
   scheduler and restricted operator account. Resolve the current app container
   on each invocation across deployments; require exactly one app match and fail
   rather than sending evidence to an arbitrary container. Retain nonzero exit
   status for scheduler alerting. This schedule is reporting only and must not
   replace or trigger the 06:00 UTC backup. No scheduler was installed here.
   Restart the app and repeat the status read to verify durable history; confirm
   stale collector evidence and a failed latest execution turn health false.
5. Obtain the confirmed execution's local dump (or its private R2 copy using the
   existing trusted operator workflow), preserving its exact basename and size.
   Use a **separate disposable PostgreSQL/PostGIS container**, never production,
   named `oxsteed-restore-...`, with label `oxsteed.restore-verification=true`.
   It must be healthy and support the extensions required by the dump. No new
   credentials or disposable environment were created by this implementation.
   Against that already prepared isolated container, run:

   ```sh
   node scripts/verify-coolify-restore-evidence.cjs jve71cca440sfwa863jhnlml /PRIVATE/PATH/pg-dump-oxsteed_db-1790756111.dmp oxsteed-restore-ACTUAL_CONTAINER /PRIVATE/PATH/restore-evidence.json
   ```

   The wrapper runs the existing full verifier against a temporary database in
   that container, checks migrations/catalog/Credit tables/triggers and the
   immutable-trigger probe, checks dump bytes did not change during the test,
   and writes a new mode-0600 evidence file, including failed verifier results.
   `pg_restore --list` alone is never a restoration pass. Inspect the result.
   The existing verifier deliberately requires the dump's complete migration set
   to equal the checked-out source and the seeded Direct catalog to have exactly
   1,000 services, 40 tools, and fixed published/live/localization flags. A
   historical dump missing any current migration filename fails this contract;
   authorized catalog edits can also fail it even if PostgreSQL restored all
   bytes correctly. This wrapper preserves those checks and certifies that exact
   contract only. It is not a general long-term restore certification policy.
   Versioned migration/catalog expectations and an approved semantic validation
   profile are separate follow-up work; never label a failed contract as a pass.
   Source currently has 609 SQL files, ending at
   `610_audit_chain_target_key_awareness.sql`; the maximum filename number is not
   the applied migration count. No claim is made that the live dump lacks that file.
   The wrapper defaults to `legacy-exact-v1`; proof includes that profile and
   its whitelisted checks. Unfinished semantic-profile drafts are preserved under
   `docs/backup-monitor-drafts/` and must be excluded from the foundation release.
6. Validate generated restore evidence without writes, then ingest the actual
   pass **or failure** into the deployed monitor:

   ```sh
   node server/scripts/ingest-backup-evidence.cjs --restore < /PRIVATE/PATH/restore-evidence.json
   docker --context colima exec -i ACTUAL_APP_CONTAINER node /app/server/scripts/ingest-backup-evidence.cjs --restore --apply < /PRIVATE/PATH/restore-evidence.json
   ```

   Confirm restart persistence and the original backup timestamp. A real pass
   can enable recovery readiness; a failure must remain visible. Repeat actual
   isolated restore verification at least monthly. Runtime errors before the
   wrapper starts cannot produce restore evidence and must be investigated.

## Focused verification

```sh
npm --prefix server test -- --runTestsByPath __tests__/backupMonitor.test.js __tests__/coolifyBackupEvidence.test.js __tests__/backupEvidenceIngestion.test.js __tests__/monitoringRoutes.test.js
node --test scripts/sync-coolify-backup-monitor.test.cjs
node scripts/sync-coolify-backup-monitor.cjs
```

Unit tests mock persistence/external commands and are not live ingestion or a
successful restore. The last command performs only live read-only collection.
