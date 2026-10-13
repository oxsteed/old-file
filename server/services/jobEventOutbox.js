'use strict';

/**
 * Transactional outbox for job events. Call enqueueJobEvent with the same
 * client that wrote the job so the event commits (or rolls back) with it.
 *
 * Coalescing: events with a coalesce_key merge into the still-pending row
 * (payload merged, first due time kept), so ten quick edits produce one
 * notification wave. The worker lives in jobs/jobEventOutbox.js.
 */

const EVENT_TYPES = Object.freeze({
  UPDATED: 'job.updated',
  MATERIAL_CHANGE: 'job.material_change',
  PUBLISHED: 'job.published',
  CHANGE_ORDER_APPLIED: 'job.change_order_applied',
  PAYMENT_REAUTHORIZED: 'job.payment_reauthorized',
  PAYMENT_REAUTH_FAILED: 'job.payment_reauth_failed',
});

// Debounce windows (seconds) before an event is delivered.
const DEFAULT_DELAYS = Object.freeze({
  [EVENT_TYPES.UPDATED]: 0,
  [EVENT_TYPES.MATERIAL_CHANGE]: Number(process.env.JOB_MATERIAL_NOTIFY_DEBOUNCE_SECONDS || 120),
  [EVENT_TYPES.PUBLISHED]: 0,
  [EVENT_TYPES.CHANGE_ORDER_APPLIED]: 0,
  [EVENT_TYPES.PAYMENT_REAUTHORIZED]: 0,
  [EVENT_TYPES.PAYMENT_REAUTH_FAILED]: 0,
});

async function enqueueJobEvent(client, { jobId, eventType, payload = {}, coalesce = true, delaySeconds = null }) {
  if (!client || typeof client.query !== 'function') throw new Error('enqueueJobEvent requires a transaction client');
  if (!jobId || !eventType) throw new Error('enqueueJobEvent requires jobId and eventType');
  const delay = Math.max(0, Number(delaySeconds ?? DEFAULT_DELAYS[eventType] ?? 0));
  const coalesceKey = coalesce ? `${eventType}:${jobId}` : null;
  const { rows } = await client.query(
    `INSERT INTO job_event_outbox (job_id, event_type, payload, coalesce_key, next_attempt_at)
     VALUES ($1, $2, $3::jsonb, $4, NOW() + ($5::integer * INTERVAL '1 second'))
     ON CONFLICT (coalesce_key) WHERE status = 'pending' AND coalesce_key IS NOT NULL
     DO UPDATE SET payload = job_event_outbox.payload || EXCLUDED.payload,
                   updated_at = NOW()
     RETURNING id`,
    [jobId, eventType, JSON.stringify(payload || {}), coalesceKey, Math.round(delay)]
  );
  return rows?.[0]?.id ?? null;
}

module.exports = { EVENT_TYPES, enqueueJobEvent };
