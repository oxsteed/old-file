"use strict";
const { withFencedJobLock } = require("./jobLockingService");
const db = require("../db");

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
    } catch (error) {
      await record(fence.db, "health", "failed", { code: String(error.code || "unknown") });
      results.health = { failed: true };
    }

    const disk = safeName(process.env.GROWTH_CLICKHOUSE_BACKUP_DISK, "");
    const backupPassword = process.env.GROWTH_CLICKHOUSE_BACKUP_ENCRYPTION_KEY || "";
    if (disk && backupPassword && !/[\r\n']/u.test(backupPassword)) {
      const ref = `${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
      await record(fence.db, "backup", "started", {}, ref);
      try {
        await client.command({
          query: `BACKUP DATABASE growth TO Disk('${disk}','${ref}') SETTINGS password='${backupPassword}'`,
          clickhouse_settings: { distributed_ddl_task_timeout: "120" },
        });
        await record(fence.db, "backup", "complete", { retention_days: 7 }, ref);
        results.backup = { complete: true, ref };
      } catch (error) {
        await record(fence.db, "backup", "failed", { code: String(error.code || "unknown") }, ref);
        results.backup = { complete: false };
      }
    } else {
      await record(fence.db, "backup", "skipped", {
        reason: disk ? "backup_encryption_key_unconfigured" : "backup_disk_unconfigured",
      });
    }

    if (process.env.GROWTH_CLICKHOUSE_RESTORE_CHECK_ENABLED === "true" && disk) {
      const ref = safeName(process.env.GROWTH_CLICKHOUSE_RESTORE_REF, "");
      if (ref) {
        const database = `growth_restore_check_${Date.now()}`;
        await record(fence.db, "restore_check", "started", {}, ref);
        try {
          await client.command({ query: `RESTORE DATABASE growth AS '${database}' FROM Disk('${disk}','${ref}')` });
          await client.command({ query: `DROP DATABASE IF EXISTS '${database}' SYNC` });
          await record(fence.db, "restore_check", "complete", { database }, ref);
          results.restore_check = { complete: true };
        } catch (error) {
          await record(fence.db, "restore_check", "failed", { code: String(error.code || "unknown") }, ref);
          results.restore_check = { complete: false };
        }
      } else {
        await record(fence.db, "restore_check", "skipped", { reason: "restore_ref_unconfigured" });
      }
    }

    if (process.env.GROWTH_CLICKHOUSE_UPGRADE_ENABLED === "true") {
      await record(fence.db, "upgrade", "started");
      try {
        await require("../scripts/clickhouseMigrate").migrate(client);
        await record(fence.db, "upgrade", "complete");
        results.upgrade = { complete: true };
      } catch (error) {
        await record(fence.db, "upgrade", "failed", { code: String(error.code || "unknown") });
        results.upgrade = { complete: false };
      }
    }
    return results;
  }, 300);
}
module.exports = { run, safeName };
