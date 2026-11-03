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
const { withTransaction } = require("../utils/transaction");

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

// ── Upgrade 2: advisory health and risk scores ─────────────────────────────
const health = require("../services/customer360Health");
async function healthVisibility(req) {
  const can = workspace.access(req);
  return { payments: await can(workspace.sources.payments), support: await can(workspace.sources.tickets) };
}
exports.health = handle(async (req, res) => {
  const user = await workspace.target(req);
  const visible = await healthVisibility(req);
  const row = await health.current(user.id);
  await audit(req, "customer360_health_read", { description: JSON.stringify({ modelVersion: row.model_version, ...visible }) });
  res.json(health.present(row, visible));
});
exports.recomputeHealth = handle(async (req, res) => {
  const user = await workspace.target(req);
  const visible = await healthVisibility(req);
  const row = await health.recompute(user.id);
  await audit(req, "customer360_health_recompute", { after: { modelVersion: row.model_version, churnBand: row.churn_band } });
  res.json(health.present(row, visible));
});

// ── Upgrade 4: anomaly alerts with bundling and snooze ────────────────────
const anomalies = require("../services/customer360Anomalies");
const db = require("../db");
async function anomalyKinds(req) {
  const can = workspace.access(req);
  return anomalies.kindsFor({
    financial: await can(workspace.sources.anomaliesFinancial),
    security: await can(workspace.sources.anomaliesSecurity),
  });
}
function anomalyStatuses(raw) {
  const all = ["open", "snoozed", "acknowledged", "resolved"];
  const list = raw ? String(raw).split(",") : ["open", "snoozed", "acknowledged"];
  if (!list.length || list.some((s) => !all.includes(s))) throw new AppError("Invalid status", 400, "invalid_request");
  return list;
}
function beforeCursor(raw) {
  if (raw === undefined || raw === "") return null;
  if (!/^\d{1,19}$/.test(String(raw))) throw new AppError("Invalid cursor", 400, "invalid_pagination");
  return String(raw);
}
exports.anomalies = handle(async (req, res) => {
  const user = await workspace.target(req);
  const kinds = await anomalyKinds(req);
  const rows = await anomalies.list({ customerId: user.id, kinds, statuses: anomalyStatuses(req.query.status), before: beforeCursor(req.query.before) });
  await audit(req, "customer360_anomalies_read", { description: JSON.stringify({ kinds, count: rows.length }) });
  res.json({ anomalies: rows, kinds });
});
exports.anomalyAction = handle(async (req, res) => {
  const user = await workspace.target(req);
  const kinds = await anomalyKinds(req);
  const { reason, until, revision } = req.body || {};
  const anomaly = await anomalies.act({
    id: req.params.anomalyId, action: req.params.action, adminId: req.user.id, kinds, revision, reason, until, req, customerId: user.id,
  });
  res.json({ anomaly });
});
exports.anomalyQueue = handle(async (req, res) => {
  const kinds = await anomalyKinds(req);
  const rows = await anomalies.list({ kinds, statuses: anomalyStatuses(req.query.status || "open"), before: beforeCursor(req.query.before), limit: 100 });
  await logAdminAction({
    adminId: req.user.id, action: "customer360_anomaly_queue_read", targetType: "customer360", targetId: null,
    description: JSON.stringify({ kinds, count: rows.length }), req, throwOnError: true,
  });
  res.json({ anomalies: rows, kinds, nextBefore: rows.length === 100 ? rows[rows.length - 1].id : null });
});
const WATCH_SOURCES = ["anomaliesFinancial", "anomaliesSecurity"];
exports.anomalyWatches = handle(async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, source, statuses, min_age_minutes, enabled FROM admin_customer_alert_rules WHERE admin_id = $1 AND customer_id IS NULL ORDER BY source`,
    [req.user.id]);
  res.json({ watches: rows });
});
exports.saveAnomalyWatch = handle(async (req, res) => {
  const { source, enabled = true, minAgeMinutes = 0 } = req.body || {};
  if (!WATCH_SOURCES.includes(source) || typeof enabled !== "boolean" || !Number.isInteger(minAgeMinutes) || minAgeMinutes < 0 || minAgeMinutes > 43200) {
    throw new AppError("Invalid watch", 400, "invalid_request");
  }
  if (!(await workspace.access(req)(workspace.sources[source]))) throw new AppError("Permission required", 403, "permission_denied");
  const watch = await withTransaction(db, async (client) => {
    const { rows: [row] } = await client.query(
      `INSERT INTO admin_customer_alert_rules (admin_id, customer_id, source, statuses, min_age_minutes, enabled)
       VALUES ($1, NULL, $2, ARRAY['open'], $3, $4)
       ON CONFLICT (admin_id, source) WHERE customer_id IS NULL
       DO UPDATE SET min_age_minutes = EXCLUDED.min_age_minutes, enabled = EXCLUDED.enabled
       RETURNING id, source, statuses, min_age_minutes, enabled`,
      [req.user.id, source, minAgeMinutes, enabled]);
    await logAdminAction({
      adminId: req.user.id, action: "customer360_anomaly_watch_updated", targetType: "customer360", targetId: null,
      after: row, req, client,
    });
    return row;
  }, "customer360_anomaly_watch");
  res.json({ watch });
});

// ── Upgrade 5: link graph and guided merge review (never merges) ───────────
const links = require("../services/customer360Links");
async function linkKinds(req) {
  const can = workspace.access(req);
  return links.visibleKinds({ financial: await can(workspace.sources.payments), security: await can(workspace.sources.sessions) });
}
exports.links = handle(async (req, res) => {
  const user = await workspace.target(req);
  const kinds = await linkKinds(req);
  const [graph, reviews] = await Promise.all([links.graph(user.id, kinds), links.reviewsFor(user.id)]);
  await audit(req, "customer360_links_read", { description: JSON.stringify({ kinds, nodes: graph.nodes.length }) });
  res.json({ ...graph, kinds, reviews, checklist: links.CHECKLIST, optionalChecklist: links.OPTIONAL_CHECKLIST, signalsEnabled: !!links.signalKey() });
});
exports.openLinkReview = handle(async (req, res) => {
  const user = await workspace.target(req);
  if (!workspace.UUID.test(String(req.params.otherUserId))) throw new AppError("Invalid user id", 400, "invalid_user_id");
  await workspace.target({ ...req, params: { userId: req.params.otherUserId } });
  const review = await links.openReview({ customerId: user.id, otherId: req.params.otherUserId.toLowerCase(), kinds: await linkKinds(req), adminId: req.user.id, req });
  res.status(201).json({ review });
});
exports.decideLinkReview = handle(async (req, res) => {
  const user = await workspace.target(req);
  const { checklist, reason, revision } = req.body || {};
  const review = await links.decide({ reviewId: req.params.reviewId, customerId: user.id, action: req.params.action, checklist, reason, revision, adminId: req.user.id, req });
  res.json({ review });
});

// ── Upgrade 7: lifecycle stage and country cohort comparison ───────────────
const lifecycle = require("../services/customer360Lifecycle");
const { getRegionRestrictedRegions } = require("../services/scopeModel");
exports.lifecycle = handle(async (req, res) => {
  const user = await workspace.target(req);
  const row = await lifecycle.current(user.id);
  // Region-scoped admins see the customer's stage but not cross-country aggregates.
  const regional = !!(await getRegionRestrictedRegions(req.user.id));
  const cohort = row && !regional ? await lifecycle.cohortFor(row) : null;
  await audit(req, "customer360_lifecycle_read", { description: JSON.stringify({ stage: row?.stage || null, cohort: !!cohort }) });
  res.json({ ...lifecycle.present(row), cohort, cohortState: regional ? "restricted" : cohort ? "ready" : "none", minCell: lifecycle.MIN_CELL });
});
exports.cohortComparison = handle(async (req, res) => {
  if (await getRegionRestrictedRegions(req.user.id)) throw new AppError("Cohort comparison is not available to region-scoped admins", 403, "region_scoped_admin");
  const result = await lifecycle.compare({ countries: req.query.countries, months: req.query.months });
  await logAdminAction({
    adminId: req.user.id, action: "customer360_cohorts_read", targetType: "platform", targetId: null,
    description: JSON.stringify({ countries: result.countries.map((c) => c.country), months: result.months }), req, throwOnError: true,
  });
  res.json(result);
});

// ── Upgrade 8: unified inbox (existing grant-gated channels only) ──────────
const inbox = require("../services/customer360Inbox");
const inboxTemplates = require("../services/customer360InboxTemplates");
async function inboxGrants(req) {
  const can = workspace.access(req);
  const [support, messages] = await Promise.all([
    can(workspace.sources.tickets), can({ grant: "message_users" }),
  ]);
  return { support, internal: support, messages };
}
exports.inbox = handle(async (req, res) => {
  const user = await workspace.target(req);
  const grants = await inboxGrants(req);
  const [page, tickets, u] = await Promise.all([
    inbox.list(user.id, grants, { before: req.query.before }),
    grants.support ? inbox.openTickets(user.id) : [],
    inbox.recipient(user.id).catch(() => null),
  ]);
  await audit(req, "customer360_inbox_read", { description: JSON.stringify({ ...grants, items: page.items.length }) });
  res.json({
    ...page, tickets, grants, canSend: grants.messages,
    channels: u ? inbox.channels(u) : null, language: u ? inbox.preferredLanguage(u) : "en",
    firstName: u?.first_name || "", languages: inboxTemplates.LANGUAGES, templates: inboxTemplates.KEYS,
  });
});
exports.inboxTemplate = handle(async (req, res) => {
  const user = await workspace.target(req);
  const u = await inbox.recipient(user.id);
  const t = inboxTemplates.render(String(req.params.templateKey), String(req.query.language || inbox.preferredLanguage(u)), { firstName: u.first_name });
  if (!t) throw new AppError("Unknown template", 404, "template_not_found");
  res.json(t);
});
exports.inboxSend = handle(async (req, res) => {
  const user = await workspace.target(req);
  // Region-limited message grants cannot reach a customer from the workspace.
  if (!(await workspace.access(req)({ grant: "message_users" }))) throw new AppError("A global message_users grant is required", 403, "message_grant_required");
  const b = req.body || {};
  const result = await inbox.send({
    customerId: user.id, adminId: req.user.id, channel: b.channel, templateKey: b.templateKey ?? null,
    language: b.language, subject: b.subject, body: b.body, clientMessageId: req.get("Idempotency-Key") || b.clientMessageId, confirm: b.confirm,
    audit: (client, row) => audit(req, `customer360_inbox_${row.channel}_send`, {
      client, after: { id: row.id, channel: row.channel, template: row.template_key, language: row.language, recipient: row.recipient_masked, bodyHash: row.body_hash },
    }),
  });
  res.status(result.replayed ? 200 : 201).json(result);
});

// ── Upgrade 9: playbooks (safe steps only; money steps are hand-offs) ──────
const playbooks = require("../services/customer360Playbooks");
const playbookAudit = (req) => (action, { client = null, after = null } = {}) => audit(req, action, { client, after });
exports.playbooks = handle(async (req, res) => {
  const user = await workspace.target(req);
  const list = await playbooks.runs(user.id);
  await audit(req, "customer360_playbooks_read", { description: JSON.stringify({ runs: list.length }) });
  res.json({ playbooks: playbooks.definitions(), runs: list });
});
exports.startPlaybook = handle(async (req, res) => {
  const user = await workspace.target(req);
  const b = req.body || {};
  const result = await playbooks.start({
    customerId: user.id, key: String(req.params.playbookKey), adminId: req.user.id,
    clientRequestId: req.get("Idempotency-Key") || b.clientRequestId, confirm: b.confirm,
    can: workspace.access(req), audit: playbookAudit(req),
  });
  res.status(result.replayed ? 200 : 201).json(result);
});
exports.completePlaybookStep = handle(async (req, res) => {
  const user = await workspace.target(req);
  const run = await playbooks.completeStep({
    customerId: user.id, runId: req.params.runId, stepKey: String(req.params.stepKey), adminId: req.user.id,
    note: req.body?.note, audit: playbookAudit(req),
  });
  res.json({ run });
});
exports.cancelPlaybook = handle(async (req, res) => {
  const user = await workspace.target(req);
  const run = await playbooks.cancel({ customerId: user.id, runId: req.params.runId, adminId: req.user.id, audit: playbookAudit(req) });
  res.json({ run });
});
