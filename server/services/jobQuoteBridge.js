'use strict';

// Review P1-134: job-linked quotes (POST /api/helper-quotes and chat quotes
// on a job conversation) used to flip status only. An accepted job quote now
// becomes the helper's bid at the quoted price, so the customer finishes with
// the normal bid acceptance (payment method + schedule) instead of a second,
// disconnected assignment path.
const pool = require('../db');

// Validates that `helperId` may quote on `jobId`. Returns the job row.
async function assertCanQuoteJob(jobId, helperId, db = pool) {
  const { rows } = await db.query(
    `SELECT j.id, j.client_id, j.status, u.role AS helper_role
       FROM jobs j JOIN users u ON u.id = $2
      WHERE j.id = $1`,
    [jobId, helperId]
  );
  const job = rows[0];
  if (!job) return { ok: false, status: 404, error: 'Job not found', code: 'job_not_found' };
  if (String(job.client_id) === String(helperId)) return { ok: false, status: 403, error: 'You cannot quote on your own job', code: 'forbidden' };
  if (!['helper', 'helper_pro', 'broker'].includes(job.helper_role)) return { ok: false, status: 403, error: 'Only helpers can quote on jobs', code: 'helper_required' };
  if (!['published', 'matched', 'negotiating'].includes(job.status)) return { ok: false, status: 409, error: 'This job is not accepting quotes', code: 'invalid_job_state' };
  return { ok: true, job };
}

// Upserts a pending bid for an accepted job quote. Returns the bid id or null
// when the quote has no job or the job no longer accepts bids.
async function bidFromAcceptedQuote(quote, db = pool) {
  if (!quote?.job_id || !quote.helper_id) return null;
  const { rows: jobs } = await db.query('SELECT status FROM jobs WHERE id = $1', [quote.job_id]);
  if (!jobs[0] || !['published', 'matched', 'negotiating'].includes(jobs[0].status)) return null;
  const totalCents = Number(quote.total_cents) || 0;
  const { rows } = await db.query(
    `INSERT INTO bids (job_id, helper_id, amount, amount_cents, currency_code, message, status, expires_at, metadata, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'USD', $5, 'pending', NOW() + interval '7 days', jsonb_build_object('source', 'quote', 'quote_id', $6::text), NOW(), NOW())
     ON CONFLICT (job_id, helper_id) DO UPDATE
       SET amount = EXCLUDED.amount, amount_cents = EXCLUDED.amount_cents,
           message = COALESCE(EXCLUDED.message, bids.message),
           status = 'pending', expires_at = EXCLUDED.expires_at,
           metadata = COALESCE(bids.metadata, '{}'::jsonb) || EXCLUDED.metadata,
           updated_at = NOW()
       WHERE bids.status IN ('pending', 'withdrawn', 'expired', 'rejected')
     RETURNING id`,
    [quote.job_id, quote.helper_id, (totalCents / 100).toFixed(2), totalCents, quote.notes || quote.title || null, String(quote.id)]
  );
  return rows[0]?.id || null;
}

module.exports = { assertCanQuoteJob, bidFromAcceptedQuote };
