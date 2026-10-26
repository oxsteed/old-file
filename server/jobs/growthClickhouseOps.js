"use strict";
const { withFencedJobLock } = require("./jobLockingService");
const incidentStore = require("../services/incidentStore");

const safeName = (value, fallback) =>
  /^[A-Za-z0-9_.-]{1,120}$/.test(String(value || ""))
    ? String(value)
    : fallback;

async function record(conn, operation, status, details = {}, backupRef = null) {
  await conn.query(
    `INSERT INTO growth_ops_runs(operation,status,completed_at,backup_ref,details)
     VALUES($1,$2,CASE WHEN $2 IN ('complete','failed','skipped') THEN NOW() END,$3,$4::jsonb)`,
    [operation, status, backupRef, JSON.stringify(details)],
  );
}

async function alertFailure(operation, details = {}) {
  // Incident persistence is best effort: an unavailable alert table must not
  // turn a ClickHouse health check into an unhandled worker failure. Details
  // are limited to safe status codes and operation metadata, never secrets.
  try {
    return await incidentStore.recordIncident({
      type: `growth_clickhouse_${operation}_failed`,
      severity: "critical",
      message: `Growth ClickHouse ${operation} failed`,
      dedupeKey: `growth-clickhouse:${operation}:failed`,
      details,
    });
  } catch {
    return { persisted: false };
  }
}

async function resolveFailure(operation, details = {}) {
  try {
    return await incidentStore.resolveOpenIncidentsByDedupeKeys(
      [`growth-clickhouse:${operation}:failed`],
      `Growth ClickHouse ${operation} recovered`,
    );
  } catch {
    return [];
  }
}

// ── Backups (D11/D12, N-03, N-04, N-11) ────────────────────────────────
// Backups are written to a ClickHouse disk that ClickHouse itself encrypts
// (`type: encrypted` in the server's storage configuration, key held in the
// server's secret store). The application never sees or sends the key, so
// nothing secret is spliced into SQL text or written to query_log.
// ClickHouse does not accept query parameters inside BACKUP SETTINGS, which
// is why the old zip-password approach could only interpolate the key.
//
// Schedule: the job ticks hourly for health, but a backup runs at most once
// per UTC day, at or after GROWTH_CLICKHOUSE_BACKUP_HOUR_UTC (default 3):
// a full backup on GROWTH_CLICKHOUSE_BACKUP_FULL_WEEKDAY (0 = Sunday,
// default) or whenever no full backup exists in the last 7 days, and an
// incremental backup on the other days whose base is that week's full.
// GROWTH_CLICKHOUSE_BACKUP_MODE=daily_full takes a full backup every day
// instead (strict 7-day residency, roughly double the storage).
// Retention: see docs/growth/clickhouse-runbook.md (bucket lifecycle on the
// `growth-` prefix: 14 days for weekly_full_daily_incremental so every
// backup inside the 7-day restore window keeps its base, 7 days for
// daily_full).
const DAY = 24 * 60 * 60 * 1000;
function intEnv(value, min, max, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}
function backupConfig(env = process.env) {
  const mode = env.GROWTH_CLICKHOUSE_BACKUP_MODE === "daily_full"
    ? "daily_full"
    : "weekly_full_daily_incremental";
  return {
    disk: safeName(env.GROWTH_CLICKHOUSE_BACKUP_DISK, ""),
    mode,
    fullWeekday: intEnv(env.GROWTH_CLICKHOUSE_BACKUP_FULL_WEEKDAY, 0, 6, 0),
    hourUtc: intEnv(env.GROWTH_CLICKHOUSE_BACKUP_HOUR_UTC, 0, 23, 3),
    retentionDays: 7,
    legacyKeyConfigured: Boolean(env.GROWTH_CLICKHOUSE_BACKUP_ENCRYPTION_KEY),
  };
}
const utcDate = (d) => new Date(d).toISOString().slice(0, 10);
function backupRef(kind, now, baseDate) {
  const today = utcDate(now);
  return kind === "full"
    ? `growth-${today}-full`
    : `growth-${baseDate}-inc-${today}`;
}
// Pure scheduling decision so it can be tested without ClickHouse.
// `history` holds completed backups, newest first:
// [{ backup_ref, backup_kind, started_at }].
function planBackup(now, history, cfg) {
  const nowDate = new Date(now);
  if (!cfg.disk) return { action: "skip", reason: "backup_disk_unconfigured" };
  if (history.some((row) => utcDate(row.started_at) === utcDate(nowDate)))
    return { action: "skip", reason: "already_backed_up_today" };
  if (nowDate.getUTCHours() < cfg.hourUtc)
    return { action: "skip", reason: "not_due" };
  if (cfg.mode === "daily_full")
    return { action: "full", ref: backupRef("full", nowDate) };
  const latestFull = history.find(
    (row) =>
      (row.backup_kind || "full") === "full" &&
      nowDate - new Date(row.started_at) < 7 * DAY,
  );
  if (!latestFull || nowDate.getUTCDay() === cfg.fullWeekday)
    return { action: "full", ref: backupRef("full", nowDate) };
  return {
    action: "incremental",
    base: latestFull.backup_ref,
    ref: backupRef("incremental", nowDate, utcDate(latestFull.started_at)),
  };
}

async function diskIsEncrypted(client, disk) {
  const result = await client.query({
    query: "SELECT is_encrypted FROM system.disks WHERE name = {disk:String}",
    query_params: { disk },
    format: "JSONEachRow",
  });
  const [row] = await result.json();
  return Boolean(row && Number(row.is_encrypted) === 1);
}

async function completedBackups(db) {
  const { rows } = await db.query(
    `SELECT backup_ref, COALESCE(backup_kind,'full') AS backup_kind, started_at
       FROM growth_ops_runs
      WHERE operation='backup' AND status='complete' AND backup_ref IS NOT NULL
        AND started_at > NOW() - interval '8 days'
      ORDER BY started_at DESC
      LIMIT 20`,
  );
  return rows;
}

async function runBackup(db, client, { now = Date.now(), env = process.env } = {}) {
  const cfg = backupConfig(env);
  const plan = planBackup(now, await completedBackups(db), cfg);
  if (plan.action === "skip") {
    // A missing disk is a configuration gap worth recording once per run;
    // "not due"/"already done" are normal hourly ticks and stay silent.
    if (plan.reason === "backup_disk_unconfigured")
      await record(db, "backup", "skipped", { reason: plan.reason });
    return { skipped: true, reason: plan.reason };
  }
  let encrypted = false;
  try {
    encrypted = await diskIsEncrypted(client, cfg.disk);
  } catch (error) {
    encrypted = false;
  }
  if (!encrypted) {
    // Refuse to write an unencrypted backup and raise an incident instead of
    // skipping quietly (N-11).
    const details = {
      reason: "backup_disk_not_encrypted",
      legacy_zip_password_ignored: cfg.legacyKeyConfigured,
    };
    await record(db, "backup", "failed", details);
    await alertFailure("backup", details);
    return { complete: false, reason: details.reason };
  }
  await db.query(
    `INSERT INTO growth_ops_runs(operation,status,backup_ref,backup_kind,base_backup_ref,details)
     VALUES('backup','started',$1,$2,$3,$4::jsonb)`,
    [plan.ref, plan.action, plan.base || null, JSON.stringify({ mode: cfg.mode })],
  );
  // disk and refs are restricted to [A-Za-z0-9_.-] by safeName/backupRef,
  // so they cannot break out of the quoted literal.
  const target = `Disk('${cfg.disk}','${safeName(plan.ref, "")}')`;
  const settings = plan.action === "incremental"
    ? ` SETTINGS base_backup = Disk('${cfg.disk}','${safeName(plan.base, "")}')`
    : "";
  try {
    await client.command({
      query: `BACKUP DATABASE growth TO ${target}${settings}`,
      clickhouse_settings: { distributed_ddl_task_timeout: "120" },
    });
    await db.query(
      `INSERT INTO growth_ops_runs(operation,status,completed_at,backup_ref,backup_kind,base_backup_ref,details)
       VALUES('backup','complete',NOW(),$1,$2,$3,$4::jsonb)`,
      [
        plan.ref,
        plan.action,
        plan.base || null,
        JSON.stringify({ mode: cfg.mode, retention_days: cfg.retentionDays }),
      ],
    );
    await resolveFailure("backup", { ref: plan.ref });
    return { complete: true, ref: plan.ref, kind: plan.action, base: plan.base || null };
  } catch (error) {
    const details = { code: String(error.code || "unknown"), kind: plan.action };
    await record(db, "backup", "failed", details, plan.ref);
    await alertFailure("backup", details);
    return { complete: false };
  }
}

// N-03: the restore check restores the newest complete backup (or an
// explicitly configured ref) into a throwaway database named with a
// backtick-quoted identifier, verifies that tables came back, then drops it.
// It runs at most once per UTC day.
// The growth tables are Replicated* with fixed Keeper paths, so restoring
// them under another database name would try to register a second replica
// at the live table's Keeper path (REPLICA_ALREADY_EXISTS), or worse, join
// live replication. The restore check therefore pre-creates each storage
// table in the scratch database as its non-replicated twin and restores
// only the data parts into it. Views are skipped: they hold no data.
function scratchTableDdl(createQuery, name, database) {
  const header = `CREATE TABLE growth.${name} `;
  if (!createQuery.startsWith(header)) return null;
  const body = createQuery.slice(header.length).replace(
    /ENGINE = Replicated(\w*MergeTree)\('(?:[^'\\]|\\.)*',\s*'(?:[^'\\]|\\.)*'(?:,\s*)?/,
    "ENGINE = $1(",
  );
  if (/ENGINE = Replicated/.test(body)) return null;
  return `CREATE TABLE \`${database}\`.\`${name}\` ${body}`;
}

async function restoreIntoScratch(client, disk, ref, database) {
  const result = await client.query({
    query: "SELECT name, create_table_query FROM system.tables WHERE database = 'growth' AND engine LIKE '%MergeTree' ORDER BY name",
    format: "JSONEachRow",
  });
  const tables = (await result.json()).filter((t) => /^[A-Za-z0-9_]+$/.test(t.name));
  await client.command({ query: `CREATE DATABASE \`${database}\`` });
  let restored = 0;
  for (const table of tables) {
    const ddl = scratchTableDdl(table.create_table_query, table.name, database);
    if (!ddl) throw Object.assign(new Error("restore_table_ddl_unsupported"), { code: "restore_table_ddl_unsupported" });
    await client.command({ query: ddl });
    await client.command({
      query: `RESTORE TABLE growth.\`${table.name}\` AS \`${database}\`.\`${table.name}\` FROM Disk('${disk}','${ref}') SETTINGS allow_different_table_def=1`,
    });
    restored += 1;
  }
  const counted = await client.query({
    query: "SELECT sum(total_rows) AS rows FROM system.tables WHERE database = {database:String}",
    query_params: { database },
    format: "JSONEachRow",
  });
  return { tables: restored, rows: Number((await counted.json())[0]?.rows || 0) };
}

async function runRestoreCheck(db, client, { now = Date.now(), env = process.env } = {}) {
  const cfg = backupConfig(env);
  if (!cfg.disk) return { skipped: true, reason: "backup_disk_unconfigured" };
  const { rows: done } = await db.query(
    `SELECT 1 FROM growth_ops_runs
      WHERE operation='restore_check' AND status='complete'
        AND started_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      LIMIT 1`,
  );
  if (done[0]) return { skipped: true, reason: "already_checked_today" };
  let ref = safeName(env.GROWTH_CLICKHOUSE_RESTORE_REF, "");
  if (!ref) ref = (await completedBackups(db))[0]?.backup_ref || "";
  if (!ref) {
    await record(db, "restore_check", "skipped", { reason: "no_backup_to_check" });
    return { skipped: true, reason: "no_backup_to_check" };
  }
  const database = `growth_restore_check_${Math.floor(now / 1000)}`;
  await record(db, "restore_check", "started", {}, ref);
  try {
    const { tables: restoredTables, rows: restoredRows } = await restoreIntoScratch(client, cfg.disk, ref, database);
    await client.command({ query: `DROP DATABASE IF EXISTS \`${database}\` SYNC` });
    if (restoredTables < 1) throw Object.assign(new Error("restore_empty"), { code: "restore_empty" });
    await record(db, "restore_check", "complete", { database, tables: restoredTables, rows: restoredRows }, ref);
    await resolveFailure("restore_check", { ref });
    return { complete: true, ref, tables: restoredTables, rows: restoredRows };
  } catch (error) {
    try {
      await client.command({ query: `DROP DATABASE IF EXISTS \`${database}\` SYNC` });
    } catch {
      // best effort cleanup; the incident below carries the failure
    }
    await record(db, "restore_check", "failed", { code: String(error.code || "unknown") }, ref);
    await alertFailure("restore_check", { code: String(error.code || "unknown"), ref });
    return { complete: false };
  }
}

async function run() {
  if (!process.env.GROWTH_CLICKHOUSE_URL)
    return { skipped: true, reason: "clickhouse_unconfigured" };
  return withFencedJobLock("growth-clickhouse-ops", async (fence) => {
    const client = require("../growth/clickhouse").getClient("admin");
    const results = {};
    await record(fence.db, "health", "started");
    try {
      const health = await client.query({
        query: "SELECT count() AS replicas, countIf(is_readonly) AS readonly FROM system.replicas WHERE database='growth'",
        format: "JSONEachRow",
      });
      results.health = (await health.json())[0] || {};
      await record(fence.db, "health", "complete", results.health);
      if (Number(results.health.replicas || 0) > 0 && Number(results.health.readonly || 0) === 0)
        await resolveFailure("health", results.health);
      else
        await alertFailure("health", { replicas: results.health.replicas, readonly: results.health.readonly });
    } catch (error) {
      await record(fence.db, "health", "failed", { code: String(error.code || "unknown") });
      await alertFailure("health", { code: String(error.code || "unknown") });
      results.health = { failed: true };
    }

    results.backup = await runBackup(fence.db, client);
    if (process.env.GROWTH_CLICKHOUSE_RESTORE_CHECK_ENABLED === "true")
      results.restore_check = await runRestoreCheck(fence.db, client);

    if (process.env.GROWTH_CLICKHOUSE_UPGRADE_ENABLED === "true") {
      await record(fence.db, "upgrade", "started");
      try {
        await require("../scripts/clickhouseMigrate").migrate(client);
        await record(fence.db, "upgrade", "complete");
        await resolveFailure("upgrade");
        results.upgrade = { complete: true };
      } catch (error) {
        await record(fence.db, "upgrade", "failed", { code: String(error.code || "unknown") });
        await alertFailure("upgrade", { code: String(error.code || "unknown") });
        results.upgrade = { complete: false };
      }
    }
    return results;
  }, 300);
}
module.exports = {
  run,
  safeName,
  alertFailure,
  resolveFailure,
  backupConfig,
  planBackup,
  runBackup,
  runRestoreCheck,
  scratchTableDdl,
};
