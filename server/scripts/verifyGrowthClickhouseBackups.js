#!/usr/bin/env node
"use strict";
// N-03 / N-04 / N-11 rehearsal against the disposable CI ClickHouse fixture:
// 1. an unencrypted disk is refused (no silent plaintext backup);
// 2. the first daily run takes a FULL backup to the encrypted disk;
// 3. a second run on the same UTC day is skipped;
// 4. the next day takes an INCREMENTAL backup based on that full backup;
// 5. the restore check restores the newest backup into a backtick-quoted
//    throwaway database, finds the tables and drops it again.
// Postgres bookkeeping (growth_ops_runs) is replaced by an in-memory stub so
// this runs in the ClickHouse-only CI job.
const { createClient } = require("@clickhouse/client");
// Incidents are persisted in Postgres in production; this ClickHouse-only
// rehearsal records them in memory instead.
const incidents = [];
const incidentStore = require("../services/incidentStore");
incidentStore.recordIncident = async (incident) => { incidents.push(incident); return { persisted: false }; };
incidentStore.resolveOpenIncidentsByDedupeKeys = async () => [];
const ops = require("../jobs/growthClickhouseOps");

function memoryDb() {
  const runs = [];
  return {
    runs,
    async query(sql, params = []) {
      if (/^\s*INSERT INTO growth_ops_runs/.test(sql)) {
        const status = /VALUES\('backup','complete'/.test(sql) ? "complete"
          : /VALUES\('backup','started'/.test(sql) ? "started" : params[1];
        if (/VALUES\('backup'/.test(sql))
          runs.push({ operation: "backup", status, backup_ref: params[0], backup_kind: params[1], started_at: memoryDb.now });
        else runs.push({ operation: params[0], status: params[1], backup_ref: params[2] || null, started_at: memoryDb.now });
        return { rows: [] };
      }
      if (/operation='backup' AND status='complete'/.test(sql))
        return { rows: runs.filter((r) => r.operation === "backup" && r.status === "complete").slice().reverse() };
      if (/operation='restore_check' AND status='complete'/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
}

async function verify() {
  const url = new URL(process.env.GROWTH_CLICKHOUSE_URL || "invalid:");
  if (process.env.NODE_ENV !== "test" || !["127.0.0.1", "localhost"].includes(url.hostname))
    throw new Error("Disposable loopback ClickHouse fixture required");
  const client = createClient({
    url: url.href,
    username: process.env.GROWTH_CLICKHOUSE_ADMIN_USER,
    password: process.env.GROWTH_CLICKHOUSE_ADMIN_PASSWORD,
    log: { level: "OFF" },
  });
  const encryptedDisk = process.env.GROWTH_CLICKHOUSE_TEST_ENCRYPTED_DISK || "growth_backups";
  const plainDisk = process.env.GROWTH_CLICKHOUSE_TEST_PLAIN_DISK || "growth_backups_plain";
  try {
    await client.command({ query: "CREATE DATABASE IF NOT EXISTS growth" });
    await client.command({ query: "CREATE TABLE IF NOT EXISTS growth.backup_rehearsal (n UInt32) ENGINE=MergeTree ORDER BY n" });
    await client.command({ query: "INSERT INTO growth.backup_rehearsal VALUES (1),(2)" });
    const stamp = Date.now();
    const sunday = Date.UTC(2031, 0, 5, 4, 0, 0) + (stamp % 1000) * 7 * 86400000; // a Sunday, unique per run
    const db = memoryDb();

    memoryDb.now = new Date(sunday).toISOString();
    const refused = await ops.runBackup(db, client, { now: sunday, env: { GROWTH_CLICKHOUSE_BACKUP_DISK: plainDisk } });
    if (refused.complete !== false || refused.reason !== "backup_disk_not_encrypted")
      throw new Error(`plaintext_disk_not_refused:${JSON.stringify(refused)}`);
    if (!incidents.some((i) => i.type === "growth_clickhouse_backup_failed"))
      throw new Error("plaintext_disk_refusal_not_alerted");

    const env = { GROWTH_CLICKHOUSE_BACKUP_DISK: encryptedDisk };
    const full = await ops.runBackup(db, client, { now: sunday, env });
    if (!full.complete || full.kind !== "full") throw new Error(`full_backup_failed:${JSON.stringify(full)}`);
    const again = await ops.runBackup(db, client, { now: sunday + 3600000, env });
    if (again.reason !== "already_backed_up_today") throw new Error(`duplicate_daily_backup:${JSON.stringify(again)}`);

    await client.command({ query: "INSERT INTO growth.backup_rehearsal VALUES (3)" });
    const monday = sunday + 86400000;
    memoryDb.now = new Date(monday).toISOString();
    const inc = await ops.runBackup(db, client, { now: monday, env });
    if (!inc.complete || inc.kind !== "incremental" || inc.base !== full.ref)
      throw new Error(`incremental_backup_failed:${JSON.stringify(inc)}`);

    const check = await ops.runRestoreCheck(db, client, { now: monday, env });
    // backup_rehearsal alone holds 3 rows; replicated growth tables restore as
    // non-replicated scratch copies, so the live replica stays untouched.
    if (!check.complete || check.ref !== inc.ref || check.tables < 1 || check.rows < 3)
      throw new Error(`restore_check_failed:${JSON.stringify(check)}`);
    const leftovers = await (await client.query({
      query: "SELECT count() AS n FROM system.databases WHERE name LIKE 'growth_restore_check_%'",
      format: "JSONEachRow",
    })).json();
    if (Number(leftovers[0].n) !== 0) throw new Error("restore_check_database_left_behind");
    const readonly = await (await client.query({
      query: "SELECT countIf(is_readonly) AS n FROM system.replicas WHERE database = 'growth'",
      format: "JSONEachRow",
    })).json();
    if (Number(readonly[0].n) !== 0) throw new Error("live_replica_disturbed_by_restore_check");
    process.stdout.write(`${JSON.stringify({ full: full.ref, incremental: inc.ref, restored_tables: check.tables, restored_rows: check.rows })}\n`);
  } finally {
    await client.command({ query: "DROP TABLE IF EXISTS growth.backup_rehearsal SYNC" }).catch(() => {});
    await client.close();
  }
}
verify().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
