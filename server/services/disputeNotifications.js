'use strict';

/**
 * Review P3-817: dispute status changes reach BOTH parties (the opener and
 * the accused), not only the opener. Text comes from the localized
 * templates in utils/i18n.js; each delivery is idempotent per dispute,
 * event and recipient.
 */
const db = require('../db');
const logger = require('../utils/logger');
const { sendNotification } = require('./notificationService');

async function disputeParties(disputeId, runner = db) {
  const { rows } = await runner.query(
    `SELECT d.id, d.opened_by, d.against_user, j.client_id, j.assigned_helper_id, j.title AS job_title
       FROM disputes d LEFT JOIN jobs j ON j.id = d.job_id
      WHERE d.id = $1`,
    [disputeId]
  );
  const row = rows[0];
  if (!row) return { row: null, userIds: [] };
  const ids = new Set(
    [row.opened_by, row.against_user, row.client_id, row.assigned_helper_id]
      .filter(Boolean).map(String)
  );
  return { row, userIds: [...ids] };
}

async function notifyDisputeParties(disputeId, type, data = {}) {
  try {
    const { row, userIds } = await disputeParties(disputeId);
    if (!row) return 0;
    const results = await Promise.allSettled(userIds.map((userId) => sendNotification({
      userId,
      type,
      data: { dispute_id: disputeId, job_title: row.job_title || '', ...data },
      action_url: `/disputes/${disputeId}`,
      idempotencyKey: `dispute:${disputeId}:${type}:${userId}`,
    })));
    return results.filter((r) => r.status === 'fulfilled').length;
  } catch (err) {
    logger.warn('Dispute party notification failed', { disputeId, type, error: err.message });
    return 0;
  }
}

module.exports = { notifyDisputeParties, disputeParties };
