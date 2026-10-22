"use strict";

jest.mock("../db", () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock("../middleware/adminAuth", () => {
  const pass = (_req, _res, next) => next();
  return {
    requireAdmin: (req, _res, next) => {
      req.user = { id: "admin-1", role: "admin" };
      next();
    },
    requirePermission: () => pass,
    requireRegionalPermission: () => pass,
  };
});
jest.mock("../middleware/rateLimiter", () => ({
  strictLimiter: (_req, _res, next) => next(),
}));
jest.mock("../services/auditService", () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));

const express = require("express");
const request = require("supertest");
const db = require("../db");
const { logAdminAction } = require("../services/auditService");
const growthRouter = require("../routes/growthInsights");

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use("/admin/growth", growthRouter);
  return instance;
}

beforeEach(() => {
  db.query.mockReset();
  db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  logAdminAction.mockClear();
});

describe("growth classification review queue", () => {
  test("lists pending items with bounded pagination", async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 12, entity_type: "menu_item", entity_id: "m-1", status: "pending" }],
    });

    const response = await request(app()).get(
      "/admin/growth/taxonomy/review-queue?status=pending&limit=10&offset=2",
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "pending", limit: 10, offset: 2 });
    expect(response.body.rows).toHaveLength(1);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("classification_review_queue"), ["pending", 10, 2]);
  });

  test("approves a review, supersedes the prior intent, learns a keyword and audits it", async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{ id: 12, entity_type: "menu_item", entity_id: "m-1", proposed_node_id: 4, status: "pending" }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 7, code: "food.delivery", status: "active", sensitive: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 88, node_id: 7, source: "admin", confidence: "1" }] })
      .mockResolvedValueOnce({ rows: [{ id: 91, pattern: "delivery", locale: "en", kind: "keyword" }] })
      .mockResolvedValueOnce({ rows: [{ id: 12, status: "approved", review_note: "Confirmed" }] });

    const response = await request(app())
      .post("/admin/growth/taxonomy/review-queue/12/review")
      .send({
        decision: "approve",
        node_code: "food.delivery",
        review_note: "Confirmed",
        keyword_rule: { locale: "en", pattern: "delivery", weight: 0.8 },
      });

    expect(response.status).toBe(200);
    expect(response.body.queue.status).toBe("approved");
    expect(response.body.intent).toMatchObject({ source: "admin", node_id: 7 });
    expect(response.body.keyword_rule).toMatchObject({ pattern: "delivery" });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE entity_intents"),
      ["menu_item", "m-1"],
    );
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
      action: "growth_classification_overridden",
      targetType: "classification_review",
      targetKey: 12,
      client: expect.any(Object),
    }));
  });

  test("rejects a pending review without creating an intent", async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{ id: 13, entity_type: "category", entity_id: "c-1", proposed_node_id: null, status: "pending" }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 13, status: "rejected", review_note: "Out of scope" }] });

    const response = await request(app())
      .post("/admin/growth/taxonomy/review-queue/13/review")
      .send({ decision: "reject", review_note: "Out of scope" });

    expect(response.status).toBe(200);
    expect(response.body.queue.status).toBe("rejected");
    expect(db.query).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO entity_intents"), expect.anything());
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ action: "growth_classification_overridden" }));
  });

  test.each([
    ["/admin/growth/taxonomy/review-queue?status=unknown", "invalid_review_status"],
    ["/admin/growth/taxonomy/review-queue?limit=101", "invalid_review_limit"],
  ])("rejects invalid queue parameters (%s)", async (path, error) => {
    const response = await request(app()).get(path);
    expect(response.status).toBe(400);
    expect(response.body.error).toBe(error);
    expect(db.query).not.toHaveBeenCalled();
  });

  test("requires an active node when approving", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 14, entity_type: "menu_item", entity_id: "m-2", status: "pending" }] })
      .mockResolvedValueOnce({ rows: [{ id: 8, code: "retired.node", status: "retired" }] });
    const response = await request(app())
      .post("/admin/growth/taxonomy/review-queue/14/review")
      .send({ decision: "approve", node_code: "retired.node" });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("review_node_not_active");
  });

  test("rejects unsafe regex learning before any database mutation", async () => {
    const response = await request(app())
      .post("/admin/growth/taxonomy/review-queue/15/review")
      .send({
        decision: "approve",
        node_code: "food.delivery",
        keyword_rule: { kind: "regex", locale: "en", pattern: "(a+)+" },
      });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_keyword_rule");
    expect(db.query).not.toHaveBeenCalled();
  });
});
