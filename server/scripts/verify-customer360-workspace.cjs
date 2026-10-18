"use strict";
// Synthetic verification only. Never accept a production database target.
const raw = process.env.CUSTOMER360_WORKSPACE_TEST_DATABASE_URL;
if (!raw)
  throw new Error("Set the disposable CUSTOMER360_WORKSPACE_TEST_DATABASE_URL");
const url = new URL(raw);
if (
  !["postgres:", "postgresql:"].includes(url.protocol) ||
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  url.pathname !== "/oxsteed_rehearsal"
)
  throw new Error("Use the disposable loopback oxsteed_rehearsal database");
process.env.DATABASE_URL = raw;
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "customer360-synthetic-verification-only";
process.env.LOG_LEVEL = "error";
const assert = require("node:assert/strict"),
  crypto = require("crypto"),
  db = require("../db"),
  service = require("../services/customer360Workspace"),
  ctrl = require("../controllers/customer360WorkspaceController");
const customer = crypto.randomUUID(),
  other = crypto.randomUUID(),
  admin = crypto.randomUUID();
const req = (body = {}, query = {}) => ({
  params: { userId: customer },
  user: { id: admin, role: "super_admin" },
  body,
  query,
  headers: {},
});
async function invoke(fn, request) {
  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    set() {
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await fn(request, res, (e) => {
    throw e;
  });
  return res.body;
}
(async () => {
  try {
    await db.query(
      `INSERT INTO users(id,email,first_name,last_name,password_hash,role,is_active) VALUES ($1,$4,'Synthetic','Customer','synthetic','customer',true),($2,$5,'Synthetic','Other','synthetic','customer',true),($3,$6,'Synthetic','Admin','synthetic','super_admin',true)`,
      [
        customer,
        other,
        admin,
        `${customer}@example.invalid`,
        `${other}@example.invalid`,
        `${admin}@example.invalid`,
      ],
    );
    await db.query(
      `INSERT INTO jobs(client_id,title,description,status,currency_code,job_value_cents,created_at) SELECT $1,'Synthetic C360 '||n,'Synthetic test','published',CASE WHEN n%2=0 THEN 'USD' ELSE 'HTG' END,1234,'2026-10-01'::timestamptz FROM generate_series(1,240)n`,
      [customer],
    );
    await db.query(
      `INSERT INTO jobs(client_id,title,description,status,currency_code,job_value_cents) VALUES($1,'Other customer synthetic','Synthetic','published','USD',999)`,
      [other],
    );
    let checked = 0;
    for (const def of Object.values(service.sources)) {
      const result = await service.readSource(def, customer, service.filters());
      assert.equal(result.state, "ready");
      checked++;
    }
    const exactDef = {
      ...service.sources.jobs,
      key: "exact",
      sql: `SELECT 'exact'::text AS id,'Exact synthetic amount'::text AS label,'posted'::text AS status,now() AS occurred_at,9007199254740993::bigint AS amount_cents,'USD'::text AS currency_code WHERE $1::uuid IS NOT NULL`,
    };
    const exact = await service.readSource(
      exactDef,
      customer,
      service.filters(),
    );
    assert.equal(exact.records[0].amount_cents, "9007199254740993");
    assert.equal(exact.groups[0].recorded_amount_cents, "9007199254740993");
    const data = await service.workspace(req({}, { source: "jobs", limit: 5 }));
    assert.equal(data.viewerId, admin);
    assert.equal(data.sections.jobs.total, 240);
    assert.equal(data.sections.jobs.records.length, 5);
    assert.equal(data.sections.jobs.groups.length, 2);
    assert.equal(
      data.sections.jobs.groups.reduce((s, g) => s + g.count, 0),
      240,
    );
    const page = await service.readSource(
      service.sources.jobs,
      customer,
      service.filters({ offset: 239, limit: 5 }),
    );
    assert.equal(page.records.length, 1);
    assert.equal(page.total, 240);
    assert.equal(page.hasMore, false);
    assert.equal(
      (
        await service.readSource(
          service.sources.jobs,
          customer,
          service.filters({ offset: 1000 }),
        )
      ).total,
      240,
    );
    assert.equal(
      (
        await service.readSource(
          service.sources.jobs,
          customer,
          service.filters({ q: "' OR TRUE --" }),
        )
      ).total,
      0,
    );
    assert.equal(
      (
        await service.readSource(
          service.sources.jobs,
          customer,
          service.filters({ from: "2026-10-02" }),
        )
      ).total,
      0,
    );
    const body = {
      title: "Synthetic reconciliation follow-up",
      priority: "urgent",
      idempotencyKey: crypto.randomUUID(),
    };
    const first = await invoke(ctrl.createTask, req(body)),
      again = await invoke(ctrl.createTask, req(body));
    assert.equal(first.task.id, again.task.id);
    await assert.rejects(
      () =>
        invoke(ctrl.createTask, req({ ...body, title: "Different intent" })),
      (e) => e.code === "idempotency_conflict",
    );
    const taskReq = () => {
      const r = req({
        status: "completed",
        revision: 1,
        resolution: "Synthetic evidence checked",
      });
      r.params.taskId = first.task.id;
      return r;
    };
    const updates = await Promise.allSettled([
      invoke(ctrl.updateTask, taskReq()),
      invoke(ctrl.updateTask, taskReq()),
    ]);
    assert.equal(updates.filter((u) => u.status === "fulfilled").length, 1);
    assert.equal(
      updates.find((u) => u.status === "rejected").reason.code,
      "revision_conflict",
    );
    const audit = await db.query(
      "SELECT action FROM admin_audit_log WHERE target_id::text=$1",
      [customer],
    );
    assert.ok(audit.rows.some((r) => r.action === "customer360_task_created"));
    assert.ok(audit.rows.some((r) => r.action === "customer360_task_updated"));
    const rule = await invoke(
      ctrl.saveAlertRule,
      req({
        source: "jobs",
        statuses: ["published"],
        minAgeMinutes: 0,
        enabled: true,
      }),
    );
    assert.equal(rule.rule.source, "jobs");
    const rules = await invoke(ctrl.alertRules, req());
    assert.equal(rules.rules.length, 1);
    const exported = await invoke(
      ctrl.export,
      req({
        sources: ["jobs"],
        purpose: "Synthetic verification report",
        format: "json",
      }),
    );
    assert.equal(exported.sections[0].total, 240);
    assert.equal(exported.sections[0].exported, 100);
    assert.equal(exported.sections[0].partial, true);
    assert.equal(
      exported.records.some((r) => r.label === "Other customer synthetic"),
      false,
    );
    console.log(
      JSON.stringify({
        ok: true,
        sourcesChecked: checked,
        records: 240,
        currencyGroups: 2,
        pagination: true,
        isolation: true,
        idempotency: true,
        concurrentTaskConflict: true,
        alerts: true,
        audit: true,
        partialExport: true,
      }),
    );
  } finally {
    await db.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
