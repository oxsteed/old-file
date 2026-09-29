const db = require('../db');
const logger = require('../utils/logger');

// This controller is intentionally read-only. It gives operators one bounded
// view of existing authoritative records; it does not create a second status
// store, payment ledger, or dispatch workflow.

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function assertIdentifier(value) {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return value;
}

async function relationColumns(table) {
  assertIdentifier(table);
  const { rows } = await db.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return new Set(rows.map((row) => row.column_name));
}

async function statusSummary(table, statusColumn = 'status') {
  const columns = await relationColumns(table);
  if (!columns.has(statusColumn)) {
    return { available: false, reason: 'not_configured' };
  }
  const safeTable = assertIdentifier(table);
  const safeColumn = assertIdentifier(statusColumn);
  const { rows } = await db.query(
    `SELECT COALESCE(${safeColumn}::text, 'unknown') AS status, COUNT(*)::integer AS count
       FROM ${safeTable}
      GROUP BY ${safeColumn}
      ORDER BY count DESC
      LIMIT 50`,
  );
  const statuses = {};
  let total = 0;
  for (const row of rows) {
    const count = Number(row.count) || 0;
    statuses[row.status] = count;
    total += count;
  }
  return { available: true, total, statuses };
}

async function countTable(table, where = null, params = []) {
  const columns = await relationColumns(table);
  if (!columns.size) return { available: false, reason: 'not_configured' };
  const safeTable = assertIdentifier(table);
  const clause = where ? ` WHERE ${where}` : '';
  const { rows } = await db.query(`SELECT COUNT(*)::integer AS count FROM ${safeTable}${clause}`, params);
  return { available: true, count: Number(rows[0]?.count) || 0 };
}

async function permissionGranted(req, permission) {
  if (req.isSuper) return true;
  try {
    const { rows } = await db.query(
      `SELECT 1, region_id FROM admin_permission_grants
        WHERE grantee_id = $1
          AND permissions ? $2
          AND region_id IS NULL
          AND expires_at > NOW()
          AND revoked_at IS NULL
        LIMIT 1`,
      [req.user?.id, permission],
    );
    return rows.some((row) => row.region_id == null);
  } catch (error) {
    logger.warn('Admin operations permission check unavailable', { permission, error: error.message });
    return false;
  }
}

async function loadSection(name, source, route, read, correlationId) {
  try {
    const value = await read();
    return {
      key: name,
      source,
      route,
      ...value,
      // Keep a traceable reference on successful cards as well as degraded
      // cards. Operators need the same request context when opening the
      // authoritative module or correlating a live incident.
      correlation_id: correlationId || 'unknown',
    };
  } catch (error) {
    logger.error('Admin operations section failed', { section: name, error: error.message });
    return {
      key: name,
      source,
      route,
      available: false,
      reason: 'temporarily_unavailable',
      error_code: 'operations_section_unavailable',
      correlation_id: correlationId || 'unknown',
    };
  }
}

exports.getOverview = async (req, res) => {
  const correlationId = req.correlationId || req.id || req.requestId || 'unknown';
  const section = (name, source, route, read) => loadSection(name, source, route, read, correlationId);
  const canViewFinancials = await permissionGranted(req, 'view_financials');
  const canManageSettings = await permissionGranted(req, 'manage_settings');
  const canViewAuditLog = await permissionGranted(req, 'view_audit_log');
  const canViewCredit = Boolean(req.isSuper);

  const [delivery, jobs, orders, support, payments, disputes, queues, integrations, credit, sla, risk, dataGovernance, changeControl, observability, crm] = await Promise.all([
    section('delivery', 'delivery_jobs', '/delivery/operations', async () => {
      const [statuses, issues, events] = await Promise.all([
        statusSummary('delivery_jobs'),
        countTable('delivery_issues', "status = 'open'"),
        countTable('delivery_event_deliveries', "status IN ('pending', 'processing', 'failed')"),
      ]);
      return { available: statuses.available, statuses, openIssues: issues, pendingEvents: events };
    }),
    section('jobs', 'jobs', '/admin/jobs', () => statusSummary('jobs')),
    section('orders', 'food_orders', '/admin/orders', () => statusSummary('food_orders')),
    section('support', 'support_tickets', '/admin/support', async () => {
      const [tickets, queue] = await Promise.all([
        statusSummary('support_tickets'),
        statusSummary('support_queue'),
      ]);
      return { available: tickets.available || queue.available, tickets, queue };
    }),
    section('payments', 'payments', '/admin/payments', async () => {
      if (!canViewFinancials) return { available: false, reason: 'permission_required', permission: 'view_financials' };
      return statusSummary('payments');
    }),
    section('disputes', 'disputes', '/admin/disputes', () => statusSummary('disputes')),
    section('queues', 'queue_events', '/admin/support/metrics', async () => {
      const [queue, events] = await Promise.all([
        statusSummary('support_queue'),
        countTable('queue_events', "created_at >= NOW() - INTERVAL '24 hours'"),
      ]);
      return { available: queue.available || events.available, queue, eventsLast24h: events };
    }),
    section('integrations', 'business_integrations', '/admin/super/settings', async () => {
      if (!canManageSettings) return { available: false, reason: 'permission_required', permission: 'manage_settings' };
      const [connected, webhooks] = await Promise.all([
        countTable('business_integrations', 'is_connected = TRUE AND is_enabled = TRUE'),
        countTable('webhook_delivery_log', 'completed_at IS NULL AND (next_retry_at IS NULL OR next_retry_at <= NOW())'),
      ]);
      return { available: connected.available || webhooks.available, connected, pendingWebhooks: webhooks };
    }),
    section('credit', 'oxsteed_credit_reconciliation_runs', '/admin/super/oxsteed-credit', async () => {
      if (!canViewCredit) return { available: false, reason: 'permission_required', permission: 'super_admin' };
      const [runs, disputes] = await Promise.all([
        statusSummary('oxsteed_credit_reconciliation_runs'),
        statusSummary('oxsteed_credit_disputes'),
      ]);
      return { available: runs.available || disputes.available, reconciliation: runs, disputes };
    }),
    section('sla', 'support_conversations', '/admin/support/sla', async () => {
      const [conversations, breaches, metrics] = await Promise.all([
        statusSummary('support_conversations'),
        countTable('support_conversations', "(sla_first_response_breached = TRUE OR sla_resolution_breached = TRUE) AND status NOT IN ('resolved', 'closed')"),
        statusSummary('conversation_metrics', 'sla_first_response_met'),
      ]);
      return { available: conversations.available, conversations, openBreaches: breaches, metrics };
    }),
    section('risk', 'incident_log', '/admin/reports/dashboard', async () => {
      const [incidents, reports, security] = await Promise.all([
        countTable('incident_log', "resolved_at IS NULL"),
        statusSummary('content_reports'),
        countTable('security_audit_log', "status IN ('failure', 'denied') AND created_at >= NOW() - INTERVAL '24 hours'"),
      ]);
      return { available: incidents.available || reports.available || security.available, openIncidents: incidents, reports, securityFailures24h: security };
    }),
    section('dataGovernance', 'ccpa_data_requests', '/admin/legal/ccpa-requests', async () => {
      const [privacy, exports] = await Promise.all([
        statusSummary('ccpa_data_requests'),
        statusSummary('main_app_data_export_requests'),
      ]);
      return { available: privacy.available || exports.available, privacy, exports };
    }),
    section('changeControl', 'admin_audit_log', '/admin/super/audit-log', async () => {
      if (!canViewAuditLog) return { available: false, reason: 'permission_required', permission: 'view_audit_log' };
      const [audit, flags, settings] = await Promise.all([
        countTable('admin_audit_log', "created_at >= NOW() - INTERVAL '24 hours'"),
        countTable('feature_flags', 'is_enabled = TRUE'),
        countTable('platform_settings'),
      ]);
      return { available: audit.available || flags.available || settings.available, changes24h: audit, enabledFlags: flags, settings };
    }),
    section('observability', 'incident_log', '/admin/reports/dashboard', async () => {
      const [incidents, deliveryEvents, webhooks] = await Promise.all([
        countTable('incident_log', "resolved_at IS NULL"),
        countTable('delivery_event_deliveries', "status = 'failed'"),
        countTable('webhook_delivery_log', "completed_at IS NULL AND error_message IS NOT NULL"),
      ]);
      return { available: incidents.available || deliveryEvents.available || webhooks.available, openIncidents: incidents, failedDeliveryEvents: deliveryEvents, failedWebhooks: webhooks };
    }),
    section('crm', 'business_leads', '/admin/businesses', async () => {
      const [leads, clients] = await Promise.all([
        statusSummary('business_leads'),
        statusSummary('business_clients'),
      ]);
      return { available: leads.available || clients.available, leads, clients };
    }),
  ]);

  res.json({
    generated_at: new Date().toISOString(),
    correlation_id: correlationId,
    sections: {
      delivery, jobs, orders, support, payments, disputes, queues, integrations, credit,
      sla, risk, dataGovernance, changeControl, observability, crm,
    },
  });
};

module.exports = exports;
