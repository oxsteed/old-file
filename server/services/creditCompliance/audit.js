'use strict';

/**
 * Shared writer for oxsteed_credit_audit_events (hash-chained by trigger).
 * Compliance evidence: errors are NOT swallowed, so a failed audit write
 * rolls the caller's transaction back.
 */
async function insertComplianceAudit(client, {
  actionType,
  actorUserId = null,
  customerId = null,
  partnerId = null,
  resourceType,
  resourceId,
  reason = null,
  correlationId = null,
  requestIp = null,
  beforeState = null,
  afterState = null,
  metadata = {},
}) {
  await client.query(
    `INSERT INTO oxsteed_credit_audit_events
       (action_type, actor_user_id, customer_id, partner_id, resource_type, resource_id, reason,
        correlation_id, request_ip, before_state, after_state, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb)`,
    [
      String(actionType).slice(0, 80),
      actorUserId || null,
      customerId || null,
      partnerId === null || partnerId === undefined ? null : partnerId,
      String(resourceType).slice(0, 80),
      String(resourceId).slice(0, 160),
      reason === null || reason === undefined ? null : String(reason).slice(0, 2000),
      correlationId ? String(correlationId).slice(0, 160) : null,
      requestIp || null,
      beforeState === null ? null : JSON.stringify(beforeState),
      afterState === null ? null : JSON.stringify(afterState),
      JSON.stringify(metadata || {}),
    ]
  );
}

module.exports = { insertComplianceAudit };
