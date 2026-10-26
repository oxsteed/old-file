"use strict";
// N-04: daily incremental + weekly full instead of an hourly full backup.
// N-11: the job never needs the encryption key; an unencrypted disk is
// refused with an incident. N-03: restore uses a backtick identifier.
jest.mock("../services/incidentStore", () => ({
  recordIncident: jest.fn(async () => ({ persisted: true })),
  resolveOpenIncidentsByDedupeKeys: jest.fn(async () => []),
}));
const incidentStore = require("../services/incidentStore");
const ops = require("../jobs/growthClickhouseOps");

const cfg = ops.backupConfig({ GROWTH_CLICKHOUSE_BACKUP_DISK: "growth_backups" });
const at = (iso) => Date.parse(iso);
const sunday = "2026-10-25T04:00:00Z";

describe("backup plan", () => {
  test("defaults: weekly full on Sunday, 03:00 UTC, 7-day retention", () => {
    expect(cfg).toMatchObject({ disk: "growth_backups", mode: "weekly_full_daily_incremental", fullWeekday: 0, hourUtc: 3, retentionDays: 7 });
  });
  test("no disk configured skips", () => {
    expect(ops.planBackup(at(sunday), [], ops.backupConfig({}))).toEqual({ action: "skip", reason: "backup_disk_unconfigured" });
  });
  test("first run takes a full backup", () => {
    expect(ops.planBackup(at("2026-10-27T05:00:00Z"), [], cfg)).toEqual({ action: "full", ref: "growth-2026-10-27-full" });
  });
  test("only one backup per UTC day", () => {
    const history = [{ backup_ref: "growth-2026-10-25-full", backup_kind: "full", started_at: "2026-10-25T03:05:00Z" }];
    expect(ops.planBackup(at("2026-10-25T23:00:00Z"), history, cfg)).toEqual({ action: "skip", reason: "already_backed_up_today" });
  });
  test("not before the configured hour", () => {
    const history = [{ backup_ref: "growth-2026-10-25-full", backup_kind: "full", started_at: "2026-10-25T03:05:00Z" }];
    expect(ops.planBackup(at("2026-10-26T02:00:00Z"), history, cfg)).toEqual({ action: "skip", reason: "not_due" });
  });
  test("weekdays take an incremental on the week's full", () => {
    const history = [
      { backup_ref: "growth-2026-10-25-inc-2026-10-27", backup_kind: "incremental", started_at: "2026-10-27T03:01:00Z" },
      { backup_ref: "growth-2026-10-25-full", backup_kind: "full", started_at: "2026-10-25T03:05:00Z" },
    ];
    expect(ops.planBackup(at("2026-10-28T03:30:00Z"), history, cfg)).toEqual({
      action: "incremental",
      base: "growth-2026-10-25-full",
      ref: "growth-2026-10-25-inc-2026-10-28",
    });
  });
  test("the full weekday starts a new chain", () => {
    const history = [{ backup_ref: "growth-2026-10-25-full", backup_kind: "full", started_at: "2026-10-25T03:05:00Z" }];
    expect(ops.planBackup(at("2026-11-01T03:30:00Z"), history, cfg).action).toBe("full");
  });
  test("a stale full (7+ days) forces a new full", () => {
    const history = [{ backup_ref: "growth-2026-10-18-full", backup_kind: "full", started_at: "2026-10-18T03:05:00Z" }];
    expect(ops.planBackup(at("2026-10-26T03:30:00Z"), history, cfg).action).toBe("full");
  });
  test("daily_full mode takes a full every day", () => {
    const daily = ops.backupConfig({ GROWTH_CLICKHOUSE_BACKUP_DISK: "d", GROWTH_CLICKHOUSE_BACKUP_MODE: "daily_full" });
    const history = [{ backup_ref: "growth-2026-10-25-full", backup_kind: "full", started_at: "2026-10-25T03:05:00Z" }];
    expect(ops.planBackup(at("2026-10-26T03:30:00Z"), history, daily)).toEqual({ action: "full", ref: "growth-2026-10-26-full" });
  });
  test("unsafe disk names are rejected", () => {
    expect(ops.backupConfig({ GROWTH_CLICKHOUSE_BACKUP_DISK: "x'); DROP" }).disk).toBe("");
  });
});

function fakeDb(history = []) {
  const queries = [];
  return {
    queries,
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (/operation='backup' AND status='complete'/.test(sql)) return { rows: history };
      return { rows: [] };
    }),
  };
}
function fakeClient({ encrypted = true, tables = 3 } = {}) {
  const commands = [];
  return {
    commands,
    query: jest.fn(async ({ query }) => ({
      json: async () => (/system\.disks/.test(query) ? [{ is_encrypted: encrypted ? 1 : 0 }] : [{ tables }]),
    })),
    command: jest.fn(async ({ query }) => { commands.push(query); }),
  };
}

describe("runBackup", () => {
  beforeEach(() => incidentStore.recordIncident.mockClear());
  test("refuses an unencrypted disk and raises an incident", async () => {
    const db = fakeDb();
    const client = fakeClient({ encrypted: false });
    const result = await ops.runBackup(db, client, {
      now: at(sunday),
      env: { GROWTH_CLICKHOUSE_BACKUP_DISK: "plain", GROWTH_CLICKHOUSE_BACKUP_ENCRYPTION_KEY: "legacy'key" },
    });
    expect(result).toEqual({ complete: false, reason: "backup_disk_not_encrypted" });
    expect(client.commands).toEqual([]);
    expect(incidentStore.recordIncident).toHaveBeenCalledWith(expect.objectContaining({ type: "growth_clickhouse_backup_failed" }));
  });
  test("never puts a key or password in the backup SQL", async () => {
    const db = fakeDb([{ backup_ref: "growth-2026-10-25-full", backup_kind: "full", started_at: "2026-10-25T03:05:00Z" }]);
    const client = fakeClient();
    const result = await ops.runBackup(db, client, {
      now: at("2026-10-26T03:30:00Z"),
      env: { GROWTH_CLICKHOUSE_BACKUP_DISK: "growth_backups", GROWTH_CLICKHOUSE_BACKUP_ENCRYPTION_KEY: "secret-value" },
    });
    expect(result).toMatchObject({ complete: true, kind: "incremental", base: "growth-2026-10-25-full" });
    expect(client.commands[0]).toBe(
      "BACKUP DATABASE growth TO Disk('growth_backups','growth-2026-10-25-inc-2026-10-26') SETTINGS base_backup = Disk('growth_backups','growth-2026-10-25-full')",
    );
    expect(client.commands.join(" ")).not.toMatch(/password|secret-value/);
  });
});

describe("runRestoreCheck", () => {
  test("restores into a backtick-quoted database and drops it", async () => {
    const db = fakeDb([{ backup_ref: "growth-2026-10-25-full", backup_kind: "full", started_at: "2026-10-25T03:05:00Z" }]);
    const client = fakeClient({ tables: 4 });
    const result = await ops.runRestoreCheck(db, client, { now: 1_700_000_000_000, env: { GROWTH_CLICKHOUSE_BACKUP_DISK: "growth_backups" } });
    expect(result).toEqual({ complete: true, ref: "growth-2026-10-25-full", tables: 4 });
    expect(client.commands[0]).toBe("RESTORE DATABASE growth AS `growth_restore_check_1700000000` FROM Disk('growth_backups','growth-2026-10-25-full')");
    expect(client.commands[1]).toBe("DROP DATABASE IF EXISTS `growth_restore_check_1700000000` SYNC");
    expect(client.commands.join(" ")).not.toMatch(/AS '/);
  });
  test("an empty restore fails and alerts", async () => {
    const db = fakeDb([{ backup_ref: "growth-2026-10-25-full", backup_kind: "full", started_at: "2026-10-25T03:05:00Z" }]);
    const client = fakeClient({ tables: 0 });
    const result = await ops.runRestoreCheck(db, client, { env: { GROWTH_CLICKHOUSE_BACKUP_DISK: "growth_backups" } });
    expect(result).toEqual({ complete: false });
    expect(incidentStore.recordIncident).toHaveBeenCalledWith(expect.objectContaining({ type: "growth_clickhouse_restore_check_failed" }));
  });
});
