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

const EVENTS_DDL = "CREATE TABLE growth.activity_events (`day` Date, `received_at` DateTime64(3, 'UTC')) ENGINE = ReplicatedReplacingMergeTree('/clickhouse/{shard}/growth/activity_events', '{replica}', received_at) PARTITION BY toYYYYMM(day) ORDER BY day SETTINGS index_granularity = 8192";
const MIGRATIONS_DDL = "CREATE TABLE growth.schema_migrations (`name` String) ENGINE = ReplicatedReplacingMergeTree('/clickhouse/{shard}/growth/schema_migrations', '{replica}') ORDER BY name SETTINGS index_granularity = 8192";
function restoreClient({ tables = [{ name: "activity_events", create_table_query: EVENTS_DDL }, { name: "schema_migrations", create_table_query: MIGRATIONS_DDL }], rows = 5 } = {}) {
  const commands = [];
  return {
    commands,
    query: jest.fn(async ({ query }) => ({
      json: async () => (/sum\(total_rows\)/.test(query) ? [{ rows }] : tables),
    })),
    command: jest.fn(async ({ query }) => { commands.push(query); }),
  };
}

describe("scratchTableDdl", () => {
  test("turns a replicated table into its non-replicated twin in the scratch database", () => {
    expect(ops.scratchTableDdl(EVENTS_DDL, "activity_events", "growth_restore_check_1")).toBe(
      "CREATE TABLE `growth_restore_check_1`.`activity_events` (`day` Date, `received_at` DateTime64(3, 'UTC')) ENGINE = ReplacingMergeTree(received_at) PARTITION BY toYYYYMM(day) ORDER BY day SETTINGS index_granularity = 8192",
    );
    expect(ops.scratchTableDdl(MIGRATIONS_DDL, "schema_migrations", "s")).toContain("ENGINE = ReplacingMergeTree() ORDER BY name");
  });
  test("leaves plain MergeTree alone and refuses unknown shapes", () => {
    expect(ops.scratchTableDdl("CREATE TABLE growth.t (`n` UInt32) ENGINE = MergeTree ORDER BY n", "t", "s")).toBe("CREATE TABLE `s`.`t` (`n` UInt32) ENGINE = MergeTree ORDER BY n");
    expect(ops.scratchTableDdl("CREATE TABLE other.t (`n` UInt32) ENGINE = MergeTree ORDER BY n", "t", "s")).toBeNull();
    expect(ops.scratchTableDdl("CREATE TABLE growth.t (`n` UInt32) ENGINE = ReplicatedMergeTree(currentDatabase(), '{replica}') ORDER BY n", "t", "s")).toBeNull();
  });
});

describe("runRestoreCheck", () => {
  beforeEach(() => incidentStore.recordIncident.mockClear());
  test("never re-registers a live replica: restores data into non-replicated scratch tables, then drops them", async () => {
    const db = fakeDb([{ backup_ref: "growth-2026-10-25-full", backup_kind: "full", started_at: "2026-10-25T03:05:00Z" }]);
    const client = restoreClient();
    const result = await ops.runRestoreCheck(db, client, { now: 1_700_000_000_000, env: { GROWTH_CLICKHOUSE_BACKUP_DISK: "growth_backups" } });
    expect(result).toEqual({ complete: true, ref: "growth-2026-10-25-full", tables: 2, rows: 5 });
    const scratch = "`growth_restore_check_1700000000`";
    expect(client.commands[0]).toBe(`CREATE DATABASE ${scratch}`);
    expect(client.commands[1]).toMatch(/^CREATE TABLE `growth_restore_check_1700000000`\.`activity_events` .* ENGINE = ReplacingMergeTree\(received_at\)/);
    expect(client.commands[2]).toBe(`RESTORE TABLE growth.\`activity_events\` AS ${scratch}.\`activity_events\` FROM Disk('growth_backups','growth-2026-10-25-full') SETTINGS allow_different_table_def=1`);
    expect(client.commands.at(-1)).toBe(`DROP DATABASE IF EXISTS ${scratch} SYNC`);
    expect(client.commands.join(" ")).not.toMatch(/RESTORE DATABASE|Replicated|AS '/);
  });
  test("an empty restore fails and alerts", async () => {
    const db = fakeDb([{ backup_ref: "growth-2026-10-25-full", backup_kind: "full", started_at: "2026-10-25T03:05:00Z" }]);
    const client = restoreClient({ tables: [] });
    const result = await ops.runRestoreCheck(db, client, { env: { GROWTH_CLICKHOUSE_BACKUP_DISK: "growth_backups" } });
    expect(result).toEqual({ complete: false });
    expect(incidentStore.recordIncident).toHaveBeenCalledWith(expect.objectContaining({ type: "growth_clickhouse_restore_check_failed" }));
  });
  test("an unsupported table definition fails closed and drops the scratch database", async () => {
    const db = fakeDb([{ backup_ref: "growth-2026-10-25-full", backup_kind: "full", started_at: "2026-10-25T03:05:00Z" }]);
    const client = restoreClient({ tables: [{ name: "odd", create_table_query: "CREATE TABLE growth.odd (`n` UInt32) ENGINE = ReplicatedMergeTree(currentDatabase(), 'r') ORDER BY n" }] });
    const result = await ops.runRestoreCheck(db, client, { now: 1_700_000_000_000, env: { GROWTH_CLICKHOUSE_BACKUP_DISK: "growth_backups" } });
    expect(result).toEqual({ complete: false });
    expect(client.commands).not.toContainEqual(expect.stringMatching(/^RESTORE/));
    expect(client.commands.at(-1)).toBe("DROP DATABASE IF EXISTS `growth_restore_check_1700000000` SYNC");
  });
});
