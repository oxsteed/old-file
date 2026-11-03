"use strict";
/**
 * Customer 360 upgrades (event log, scores, AI, anomalies, link graph,
 * cohorts, inbox, playbooks, queues, summaries). Every read and mutation
 * writes an admin_audit_log row with throwOnError, so an unaudited read
 * never returns data.
 */
const workspace = require("../services/customer360Workspace");
const events = require("../services/customer360Events");
const { logAdminAction } = require("../services/auditService");
const AppError = require("../utils/appError");

const handle = (fn) => async (req, res, next) => {
  try {
    res.set("Cache-Control", "private, no-store");
    await fn(req, res);
  } catch (error) {
    next(error);
  }
};

async function audit(req, action, { after = null, before = null, description = null, client = null, targetId } = {}) {
  await logAdminAction({
    adminId: req.user.id,
    action,
    targetType: "user",
    targetId: targetId || req.params.userId,
    before,
    after,
    description,
    req,
    client,
    throwOnError: true,
  });
}

async function eventScope(req) {
  const user = await workspace.target(req);
  const allowed = await events.allowedEventSources(workspace.access(req), workspace.sources);
  return { user, allowed };
}

exports.events = handle(async (req, res) => {
  const { user, allowed } = await eventScope(req);
  const filter = events.eventFilters(req.query);
  const result = await events.listEvents(user.id, filter, allowed);
  await audit(req, "customer360_events_read", {
    description: JSON.stringify({ sources: result.sources, from: filter.from, to: filter.to, before: filter.before }),
  });
  res.json({ ...result, backfill: await events.backfillStatus() });
});

exports.replay = handle(async (req, res) => {
  const { user, allowed } = await eventScope(req);
  const result = await events.replay(user.id, {
    entityType: req.query.entityType,
    entityId: req.query.entityId,
    at: req.query.at,
  }, allowed);
  await audit(req, "customer360_events_replay", {
    description: JSON.stringify({ entityType: result.entityType, entityId: result.entityId, at: result.at }),
  });
  res.json(result);
});

exports.verifyEvents = handle(async (req, res) => {
  const user = await workspace.target(req);
  const result = await events.verifyChain(user.id);
  await audit(req, "customer360_events_verify", { after: result });
  res.json(result);
});

module.exports.audit = audit;
module.exports.handle = handle;

