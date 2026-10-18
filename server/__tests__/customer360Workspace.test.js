"use strict";
jest.unmock("../utils/transaction");
jest.mock("../db", () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock("../middleware/adminAuth", () => ({ hasGlobalGrant: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAdminAction: jest.fn() }));
jest.mock("../services/tokenRevocationService", () => ({
  revokeAccessTokenId: jest.fn(),
  revokeAllUserTokens: jest.fn(),
}));
jest.mock("../services/notificationService", () => ({
  sendNotification: jest.fn(),
}));
const db = require("../db"),
  { hasGlobalGrant } = require("../middleware/adminAuth"),
  { logAdminAction } = require("../services/auditService");
const service = require("../services/customer360Workspace"),
  ctrl = require("../controllers/customer360WorkspaceController");
const { deriveHelperOnboarding } = require("../services/helperOnboarding");
const id = "77777777-7777-4777-8777-777777777777",
  admin = "88888888-8888-4888-8888-888888888888";
const user = { id, role: "customer", is_active: true };
const req = (query = {}) => ({
  params: { userId: id },
  user: { id: admin, role: "admin" },
  query,
  headers: {},
});
const response = () => ({
  set: jest.fn(),
  json: jest.fn(),
  status: jest.fn().mockReturnThis(),
});
beforeEach(() => {
  jest.clearAllMocks();
  hasGlobalGrant.mockResolvedValue(false);
  logAdminAction.mockResolvedValue();
});
test("strict pagination, dates and source filter validation", () => {
  for (const offset of ["-1", "0x10", "1.5", Infinity, 100001])
    expect(() => service.filters({ offset })).toThrow();
  for (const from of ["2026-02-30", "nonsense", "2026-01-01T12:00Z"])
    expect(() => service.filters({ from })).toThrow();
  expect(() =>
    service.filters({ from: "2026-10-02", to: "2026-10-01" }),
  ).toThrow();
  expect(service.filters({ limit: 100, offset: 100 })).toMatchObject({
    limit: 100,
    offset: 100,
  });
});
test("super-only credit cannot be exposed by manage_users or financial grant", async () => {
  hasGlobalGrant.mockResolvedValue(true);
  const can = service.access(req());
  expect(await can(service.sources.creditAccounts)).toBe(false);
  expect(await can(service.sources.payments)).toBe(true);
  expect(hasGlobalGrant).toHaveBeenCalledWith(admin, "view_financials");
});
test("empty, restricted and unavailable sources remain distinct; denied SQL never runs", async () => {
  db.query.mockResolvedValueOnce({ rows: [user] });
  const restricted = await service.workspace(req({ source: "creditAccounts" }));
  expect(restricted.sections.creditAccounts.state).toBe("restricted");
  expect(db.query).toHaveBeenCalledTimes(1);
  db.query
    .mockResolvedValueOnce({ rows: [user] })
    .mockResolvedValueOnce({ rows: [{ total: 0, records: [], groups: [] }] });
  hasGlobalGrant.mockResolvedValue(true);
  expect(
    (await service.workspace(req({ source: "jobs" }))).sections.jobs,
  ).toMatchObject({ state: "ready", total: 0, records: [] });
  db.query
    .mockResolvedValueOnce({ rows: [user] })
    .mockRejectedValueOnce(
      Object.assign(new Error("missing table"), { code: "42P01" }),
    );
  const missing = await service.workspace(req({ source: "jobs" }));
  expect(missing.sections.jobs.state).toBe("unavailable");
  expect(missing.sections.jobs.total).toBeUndefined();
});
test("counts, groups and page share one scoped statement and filters are binds", async () => {
  db.query.mockResolvedValue({
    rows: [
      {
        total: 150,
        records: [{ id: "1", label: "Job" }],
        groups: [{ status: "completed", currency_code: "HTG", count: 150 }],
      },
    ],
  });
  const filter = service.filters({
    q: "' OR true --",
    from: "2026-01-01",
    to: "2026-10-18",
  });
  const result = await service.readSource(service.sources.jobs, id, filter),
    [sql, binds] = db.query.mock.calls[0];
  expect(sql).not.toContain(filter.q);
  expect(sql).toContain("client_id = $1");
  expect(sql).toContain("WITH scoped");
  expect(binds[3]).toBe(filter.q);
  expect(result).toMatchObject({ total: 150, hasMore: true, offset: 0 });
});
test("diagnostics use authoritative helper derivation; skip is not blanket eligibility", () => {
  const facts = {
    ...user,
    role: "helper",
    email_verified: true,
    profile_completed: true,
    contact_completed: true,
    terms_accepted: true,
    terms_accepted_at: new Date(),
    terms_version: "1",
    didit_status: "skipped",
  };
  const out = service.eligibility(facts);
  expect(out.helper.work).toBe(deriveHelperOnboarding(facts).complete);
  expect(out.helper.missing).toContain("identity");
  expect(out.identity.diditGateSatisfied).toBe(true);
  expect(
    service.eligibility({
      ...facts,
      identity_verified: true,
      onboarding_completed: true,
    }).helper,
  ).toMatchObject({ listing: true, work: true });
  expect(
    service.eligibility({ ...facts, role: "customer", identity_verified: true })
      .helper.work,
  ).toBe(false);
});
test("delegated staff cannot inspect admin targets or internal users", async () => {
  db.query.mockResolvedValueOnce({ rows: [{ ...user, role: "admin" }] });
  await expect(service.target(req())).rejects.toMatchObject({ status: 403 });
  db.query.mockResolvedValueOnce({ rows: [{ ...user, is_internal: true }] });
  await expect(service.target(req())).rejects.toMatchObject({ status: 404 });
});
test("CSV formulas are neutralized and quotes escaped", () => {
  expect(service.csvCell('=HYPERLINK("danger")')).toBe(
    '"\'=HYPERLINK(""danger"")"',
  );
  expect(service.csvCell(" \t+SUM(1)")).toContain("'");
  expect(service.csvCell("safe")).toBe('"safe"');
});
test("safe projections never include credentials or arbitrary metadata and bodies", () => {
  for (const def of Object.values(service.sources)) {
    const projection = def.sql.split(" FROM ")[0];
    expect(projection).not.toMatch(
      /SELECT\s+\*|r\.(?:metadata|payload|refresh_token|access_token_hash|device_token_hash|credential_hash|pin_hash|password_hash|body|shipping_address)\b/,
    );
  }
});
test("audit failure prevents serving success", async () => {
  db.query.mockResolvedValue({ rows: [user] });
  logAdminAction.mockRejectedValueOnce(new Error("audit down"));
  await expect(
    service.workspace(req({ source: "creditAccounts" })),
  ).rejects.toThrow("audit down");
});
test("invalid export source rejected before any source read", async () => {
  const r = req();
  r.body = { purpose: "case review", sources: ["not_a_source"] };
  const next = jest.fn();
  await ctrl.export(r, response(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));
  expect(db.query).not.toHaveBeenCalled();
});
test("session revoke rejects malformed ids", async () => {
  db.query.mockResolvedValue({ rows: [user] });
  const r = req();
  r.params.sessionId = "1 OR true";
  r.body = { reason: "security review" };
  const next = jest.fn();
  await ctrl.revokeSession(r, response(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));
});
test("task completion requires outcome and valid revision", async () => {
  db.query.mockResolvedValue({ rows: [user] });
  const r = req();
  r.params.taskId = admin;
  r.body = { status: "completed", revision: 1, resolution: "" };
  const next = jest.fn();
  await ctrl.updateTask(r, response(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));
});

test("session revocation immediately denylists access and rolls back on revocation failure", async () => {
  const revoke = require("../services/tokenRevocationService");
  const client = {
    query: jest.fn(async (sql) =>
      sql.startsWith("SELECT id,access_token_hash")
        ? { rows: [{ id: 12, access_token_hash: "synthetic-hash" }] }
        : { rows: [], rowCount: 1 },
    ),
    release: jest.fn(),
  };
  db.connect.mockResolvedValue(client);
  db.query.mockResolvedValue({ rows: [user] });
  const r = req();
  r.params.sessionId = "12";
  r.body = { reason: "Customer security request" };
  const next = jest.fn();
  await ctrl.revokeSession(r, response(), next);
  expect(next).not.toHaveBeenCalled();
  expect(revoke.revokeAccessTokenId).toHaveBeenCalledWith("synthetic-hash");
  expect(client.query).toHaveBeenCalledWith("COMMIT");
  client.query.mockClear();
  revoke.revokeAccessTokenId.mockRejectedValueOnce(new Error("denylist down"));
  await ctrl.revokeSession(r, response(), next);
  expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  expect(
    client.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE sessions")),
  ).toBe(false);
});
test("watch evaluation rechecks permissions and keeps stable per-record notification keys", async () => {
  const { evaluateCustomer360Alerts } = require("../jobs/customer360Alerts"),
    { sendNotification } = require("../services/notificationService");
  const rule = {
    id: admin,
    admin_id: admin,
    customer_id: id,
    source: "jobs",
    statuses: ["published"],
    min_age_minutes: 10,
    role: "admin",
  };
  db.query
    .mockResolvedValueOnce({ rows: [rule] })
    .mockResolvedValue({ rows: [] });
  hasGlobalGrant.mockResolvedValueOnce(false);
  await evaluateCustomer360Alerts();
  expect(sendNotification).not.toHaveBeenCalled();
  db.query.mockReset();
  db.query
    .mockResolvedValueOnce({ rows: [{ ...rule, role: "super_admin" }] })
    .mockResolvedValueOnce({ rows: [user] })
    .mockResolvedValueOnce({ rows: [{ id: "job-1", status: "published" }] })
    .mockResolvedValue({ rows: [] });
  sendNotification.mockResolvedValue({ success: true });
  await evaluateCustomer360Alerts();
  expect(sendNotification).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: admin,
      idempotencyKey: `customer360-rule:${admin}:job-1:published`,
    }),
  );
  const candidate = db.query.mock.calls.find(([sql]) =>
    sql.startsWith("WITH scoped"),
  );
  expect(candidate[0]).toContain("NOT EXISTS");
  expect(candidate[1][1]).toEqual(["published"]);
});
test("assistant sends only permitted aggregate counts and statuses, never customer PII or money", async () => {
  const provider = require("../services/aiChatProvider");
  const configured = jest
    .spyOn(provider, "isMetaConfigured")
    .mockReturnValue(true);
  const model = jest
    .spyOn(provider, "getMetaModel")
    .mockReturnValue("synthetic-model");
  const chat = jest
    .spyOn(provider, "fetchMetaChat")
    .mockResolvedValue({ ok: true, reply: "Review the source [jobs]." });
  const snapshot = jest.spyOn(service, "workspace").mockResolvedValue({
    generatedAt: new Date().toISOString(),
    sections: {
      jobs: {
        key: "jobs",
        state: "ready",
        total: 7,
        groups: [
          {
            status: "pending",
            count: 7,
            recorded_amount_cents: "9007199254740993",
          },
        ],
        records: [
          {
            label: "Sensitive person",
            email: "private@example.invalid",
            balance_cents: 2000,
          },
        ],
      },
    },
  });
  try {
    const r = req();
    r.body = { language: "ar" };
    const next = jest.fn();
    await ctrl.assistant(r, response(), next);
    expect(next).not.toHaveBeenCalled();
    const payload = JSON.stringify(chat.mock.calls[0]);
    expect(payload).toContain("pending");
    expect(payload).not.toMatch(
      /Sensitive person|private@example|balance_cents|9007199254740993/,
    );
  } finally {
    snapshot.mockRestore();
    configured.mockRestore();
    model.mockRestore();
    chat.mockRestore();
  }
});

test("inherited object keys are never accepted as source definitions", async () => {
  for (const source of ["__proto__", "constructor", "toString"]) {
    expect(service.sources[source]).toBeUndefined();
    db.query.mockResolvedValueOnce({ rows: [user] });
    await expect(service.workspace(req({ source }))).rejects.toMatchObject({
      status: 400,
      code: "invalid_source",
    });
  }
});
