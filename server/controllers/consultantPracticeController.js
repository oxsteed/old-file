'use strict';

const db = require('../db');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');
const { notifySupportStaff } = require('../services/supportNotificationService');

// Group 10 Slice I (items 546-550): operate the practice.
// The consultant's own practice reports (546-549) are read-only
// aggregates over existing tables, and the practice support intake
// (550) files a support ticket the consultant can track. Nothing here
// moves money: the earnings report (549) reports completed payments
// and the agreed split; it is not a payout leg (G10-1 stays open).
// Decisions D-146..D-152 in persona-roadmap-decisions.md.

const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_WINDOW_DAYS = 90;
const DEFAULT_WINDOW_DAYS = 30;
const MAX_ROWS = 200;

// The referral pipeline stages, in funnel order. Source of truth is
// REFERRAL_STATUSES in consultantNetworkController.js; this list is
// duplicated here so the report can render empty stages at zero.
const PIPELINE_STAGES = [
  'assigned',
  'intro_pending',
  'intro_sent',
  'discovery_scheduled',
  'proposal_sent',
  'engaged',
  'won',
  'lost',
  'completed',
  'paused',
  'declined',
];

const OUTSTANDING_STATUSES = ['pending', 'in_progress', 'draft_delivered', 'overdue'];
const SUPPORT_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

function cents(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

// node-pg returns DATE/TIMESTAMP columns as Date objects; format them
// as YYYY-MM-DD in UTC (these columns are day-granular, never times).
function toISODate(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function validDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function eachDate(from, to) {
  const out = [];
  let current = from;
  while (current <= to) {
    out.push(current);
    current = addDays(current, 1);
  }
  return out;
}

// The weekday (0 = Sunday) of a YYYY-MM-DD date in the given timezone.
// Dates are day-granular; noon UTC keeps the Intl mapping off the DST
// boundary for every real timezone.
function weekdayInTimezone(dateStr, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' });
  const day = fmt.format(new Date(`${dateStr}T12:00:00Z`));
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[day];
}

function timeToMinutes(value) {
  if (value == null) return null;
  const [h, m] = String(value).split(':').map((part) => parseInt(part, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

async function loadPracticeProfile(userId) {
  const { rows } = await db.query(
    `SELECT timezone, default_oxsteed_cut_bps
       FROM consultant_contractor_profiles WHERE user_id = $1`,
    [userId],
  );
  return rows[0] || null;
}

function presentPipelineRow(row) {
  return {
    id: String(row.id),
    businessName: row.business_name,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    stage: row.consultant_assignment_status,
    status: row.status,
    packageSelected: row.package_selected,
    estimatedTotalCents: cents(row.estimated_total_price_cents),
    estimatedConsultantShareCents: cents(row.estimated_consultant_share_cents),
    estimatedOxsteedShareCents: cents(row.estimated_oxsteed_share_cents),
    followUpAt: row.consultant_follow_up_at,
    updatedAt: row.updated_at,
  };
}

// GET /consulting/contractor/practice/inquiry-pipeline (546)
async function getInquiryPipeline(req, res) {
  try {
    const { rows: stageRows } = await db.query(
      `SELECT consultant_assignment_status AS stage,
              COUNT(*)::int AS count,
              COALESCE(SUM(estimated_consultant_share_cents), 0)::bigint AS consultant_cents,
              COALESCE(SUM(estimated_oxsteed_share_cents), 0)::bigint AS oxsteed_cents
         FROM consulting_requests
        WHERE consultant_assigned_id = $1
        GROUP BY consultant_assignment_status`,
      [req.user.id],
    );
    const byStage = new Map(stageRows.map((row) => [row.stage, row]));
    const stages = PIPELINE_STAGES.map((stage) => {
      const row = byStage.get(stage);
      return {
        stage,
        count: row ? row.count : 0,
        estimatedConsultantShareCents: cents(row ? row.consultant_cents : 0),
        estimatedOxsteedShareCents: cents(row ? row.oxsteed_cents : 0),
      };
    });
    const { rows: referralRows } = await db.query(
      `SELECT id, business_name, first_name, last_name, email,
              consultant_assignment_status, status, package_selected,
              estimated_total_price_cents, estimated_consultant_share_cents,
              estimated_oxsteed_share_cents, consultant_follow_up_at, updated_at
         FROM consulting_requests
        WHERE consultant_assigned_id = $1
        ORDER BY updated_at DESC
        LIMIT $2`,
      [req.user.id, MAX_ROWS],
    );
    const totals = stages.reduce(
      (acc, stage) => ({
        count: acc.count + stage.count,
        estimatedConsultantShareCents: acc.estimatedConsultantShareCents + stage.estimatedConsultantShareCents,
        estimatedOxsteedShareCents: acc.estimatedOxsteedShareCents + stage.estimatedOxsteedShareCents,
      }),
      { count: 0, estimatedConsultantShareCents: 0, estimatedOxsteedShareCents: 0 },
    );
    return res.json({ stages, totals, referrals: referralRows.map(presentPipelineRow) });
  } catch (err) {
    logger.error('Consulting practice inquiry pipeline failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to load inquiry pipeline.' });
  }
}

// GET /consulting/contractor/practice/utilization?from=&to= (547)
async function getUtilization(req, res) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const to = typeof req.query.to === 'string' && req.query.to !== '' ? req.query.to : today;
    const from = typeof req.query.from === 'string' && req.query.from !== ''
      ? req.query.from
      : addDays(to, -(DEFAULT_WINDOW_DAYS - 1));
    if (!validDate(from) || !validDate(to)) {
      return res.status(400).json({ error: 'from and to must be YYYY-MM-DD dates', code: 'invalid_window' });
    }
    if (from > to) {
      return res.status(400).json({ error: 'from must be on or before to', code: 'invalid_window' });
    }
    const days = eachDate(from, to);
    if (days.length > MAX_WINDOW_DAYS) {
      return res.status(400).json({ error: `Window is limited to ${MAX_WINDOW_DAYS} days`, code: 'window_too_long' });
    }
    const profile = await loadPracticeProfile(req.user.id);
    const timeZone = profile?.timezone?.trim() || 'America/New_York';
    let resolvedTimeZone = timeZone;
    try {
      Intl.DateTimeFormat('en-US', { timeZone });
    } catch {
      resolvedTimeZone = 'America/New_York';
    }
    const [{ rows: availabilityRows }, { rows: blockedRows }, { rows: exceptionRows }, { rows: bookedRows }] = await Promise.all([
      db.query(
        `SELECT day_of_week, start_time, end_time
           FROM consultant_availability
          WHERE consultant_id = $1 AND is_active = TRUE`,
        [req.user.id],
      ),
      db.query(
        `SELECT blocked_date FROM consultant_blocked_dates
          WHERE consultant_id = $1 AND blocked_date >= $2::date AND blocked_date <= $3::date`,
        [req.user.id, from, to],
      ),
      db.query(
        `SELECT exception_date, start_time, end_time, is_available
           FROM consultant_schedule_exceptions
          WHERE consultant_id = $1 AND exception_date >= $2::date AND exception_date <= $3::date`,
        [req.user.id, from, to],
      ),
      db.query(
        `SELECT scheduled_date::text AS date,
                COALESCE(SUM(duration_minutes), 0)::int AS booked_minutes
           FROM consulting_sessions_scheduled
          WHERE consultant_assigned_id = $1
            AND status IN ('confirmed', 'completed')
            AND scheduled_date >= $2::date AND scheduled_date <= $3::date
          GROUP BY scheduled_date`,
        [req.user.id, from, to],
      ),
    ]);
    const availabilityByWeekday = new Map();
    for (const row of availabilityRows) {
      const start = timeToMinutes(row.start_time);
      const end = timeToMinutes(row.end_time);
      if (start == null || end == null || end <= start) continue;
      availabilityByWeekday.set(row.day_of_week, end - start);
    }
    const blocked = new Set(blockedRows.map((row) => toISODate(row.blocked_date)));
    const exceptions = new Map();
    for (const row of exceptionRows) {
      const key = toISODate(row.exception_date);
      if (row.is_available === false) {
        exceptions.set(key, 0);
        continue;
      }
      const start = timeToMinutes(row.start_time);
      const end = timeToMinutes(row.end_time);
      exceptions.set(key, start != null && end != null && end > start ? end - start : 0);
    }
    const bookedByDate = new Map(bookedRows.map((row) => [row.date, row.booked_minutes]));
    const perDay = days.map((date) => {
      let availableMinutes = 0;
      if (!blocked.has(date)) {
        if (exceptions.has(date)) {
          availableMinutes = exceptions.get(date);
        } else {
          availableMinutes = availabilityByWeekday.get(weekdayInTimezone(date, resolvedTimeZone)) || 0;
        }
      }
      return { date, availableMinutes, bookedMinutes: bookedByDate.get(date) || 0 };
    });
    const totalAvailable = perDay.reduce((sum, day) => sum + day.availableMinutes, 0);
    const totalBooked = perDay.reduce((sum, day) => sum + day.bookedMinutes, 0);
    return res.json({
      from,
      to,
      timeZone: resolvedTimeZone,
      totalAvailableMinutes: totalAvailable,
      totalBookedMinutes: totalBooked,
      utilizationPercent: totalAvailable > 0
        ? Math.round((totalBooked / totalAvailable) * 1000) / 10
        : null,
      days: perDay,
    });
  } catch (err) {
    logger.error('Consulting practice utilization failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to load availability utilization.' });
  }
}

function presentDeliverable(row, today) {
  const due = toISODate(row.due_date);
  let daysOverdue = null;
  if (due && due < today) {
    daysOverdue = Math.round((new Date(`${today}T12:00:00Z`) - new Date(`${due}T12:00:00Z`)) / 86400000);
  }
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    sessionBusinessName: row.session_business_name,
    sessionClientName: [row.session_first_name, row.session_last_name].filter(Boolean).join(' ') || null,
    name: row.name,
    deliverableType: row.deliverable_type,
    dueDate: due,
    status: row.status,
    daysOverdue,
    updatedAt: row.updated_at,
  };
}

// GET /consulting/contractor/practice/deliverables/outstanding (548)
async function getOutstandingDeliverables(req, res) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    // The counts are a separate unlimited aggregate: the row list is
    // capped at MAX_ROWS, and counts computed from it would silently
    // under-report a consultant with more open work than that.
    const [{ rows }, { rows: countRows }] = await Promise.all([
      db.query(
        `SELECT d.id, d.session_id, d.name, d.deliverable_type, d.due_date,
                d.status, d.updated_at,
                cs.business_name AS session_business_name,
                cs.first_name AS session_first_name,
                cs.last_name AS session_last_name
           FROM consulting_deliverables d
           JOIN consulting_sessions cs ON cs.id = d.session_id
          WHERE cs.consultant_assigned_id = $1
            AND cs.status <> 'archived'
            AND d.status IN ('pending', 'in_progress', 'draft_delivered', 'overdue', 'completed')
          ORDER BY (d.due_date IS NULL), d.due_date ASC, d.updated_at DESC
          LIMIT $2`,
        [req.user.id, MAX_ROWS],
      ),
      db.query(
        `SELECT d.status, COUNT(*)::int AS count
           FROM consulting_deliverables d
           JOIN consulting_sessions cs ON cs.id = d.session_id
          WHERE cs.consultant_assigned_id = $1
            AND cs.status <> 'archived'
            AND d.status IN ('pending', 'in_progress', 'draft_delivered', 'overdue', 'completed')
          GROUP BY d.status`,
        [req.user.id],
      ),
    ]);
    const presented = rows.map((row) => presentDeliverable(row, today));
    const counts = {};
    for (const row of countRows) counts[row.status] = row.count;
    return res.json({
      outstanding: presented.filter((row) => OUTSTANDING_STATUSES.includes(row.status)),
      awaitingAcceptance: presented.filter((row) => row.status === 'completed'),
      counts,
    });
  } catch (err) {
    logger.error('Consulting practice outstanding deliverables failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to load outstanding deliverables.' });
  }
}

// The agreed split, mirroring the assignment formula in
// businessLaunchController.js exactly: the OxSteed share rounds, the
// consultant takes the remainder, so the two always sum to the amount.
function splitPayment(amountCents, oxsteedBps) {
  const bps = Math.max(0, Math.min(10000, parseInt(oxsteedBps, 10) || 0));
  const oxsteedShareCents = Math.round(amountCents * (bps / 10000));
  return { consultantShareCents: amountCents - oxsteedShareCents, oxsteedShareCents };
}

// GET /consulting/contractor/practice/earnings (549)
async function getEarnings(req, res) {
  try {
    const profile = await loadPracticeProfile(req.user.id);
    const defaultCutBps = profile?.default_oxsteed_cut_bps ?? 2000;
    // Totals, monthly breakdown, and status counts are unlimited
    // aggregates: the per-payment row list is capped at MAX_ROWS, and
    // totals computed from it would silently under-report a consultant
    // with more completed payments than that. The SQL split mirrors
    // splitPayment exactly (ROUND the OxSteed share, consultant takes
    // the remainder); ROUND on numerics matches Math.round for the
    // positive amounts payments carry.
    const oxsteedShareSql = `ROUND(cp.amount_cents::numeric * LEAST(10000, GREATEST(0, COALESCE(cr.assigned_oxsteed_cut_bps, $2))) / 10000)`;
    const joins = `FROM consulting_payments cp
         JOIN consulting_sessions_scheduled css ON css.id = cp.session_scheduled_id
         LEFT JOIN consulting_sessions cs ON cs.id = css.session_id
         LEFT JOIN consulting_requests cr ON cr.id = cs.referral_id
        WHERE css.consultant_assigned_id = $1`;
    const [{ rows: totalRows }, { rows: statusRows }, { rows: monthlyRows }, { rows }] = await Promise.all([
      db.query(
        `SELECT COUNT(*) FILTER (WHERE cp.status = 'completed')::int AS completed_payments,
                COALESCE(SUM(cp.amount_cents) FILTER (WHERE cp.status = 'completed'), 0)::bigint AS gross_cents,
                COALESCE(SUM(cp.amount_cents - ${oxsteedShareSql}) FILTER (WHERE cp.status = 'completed'), 0)::bigint AS consultant_share_cents,
                COALESCE(SUM(${oxsteedShareSql}) FILTER (WHERE cp.status = 'completed'), 0)::bigint AS oxsteed_share_cents,
                COUNT(*) FILTER (WHERE cp.status = 'refunded')::int AS refunded_count,
                COALESCE(SUM(cp.amount_cents) FILTER (WHERE cp.status = 'refunded'), 0)::bigint AS refunded_cents
           ${joins}`,
        [req.user.id, defaultCutBps],
      ),
      db.query(
        `SELECT cp.status, COUNT(*)::int AS count ${joins} GROUP BY cp.status`,
        [req.user.id],
      ),
      db.query(
        `SELECT TO_CHAR(DATE_TRUNC('month', cp.created_at), 'YYYY-MM') AS month,
                COUNT(*)::int AS payments,
                COALESCE(SUM(cp.amount_cents), 0)::bigint AS gross_cents,
                COALESCE(SUM(cp.amount_cents - ${oxsteedShareSql}), 0)::bigint AS consultant_share_cents,
                COALESCE(SUM(${oxsteedShareSql}), 0)::bigint AS oxsteed_share_cents
           ${joins} AND cp.status = 'completed'
          GROUP BY DATE_TRUNC('month', cp.created_at)
          ORDER BY DATE_TRUNC('month', cp.created_at) DESC
          LIMIT 12`,
        [req.user.id, defaultCutBps],
      ),
      db.query(
        `SELECT cp.id, cp.amount_cents, cp.service_tier, cp.status,
                cp.created_at, cp.session_scheduled_id,
                css.session_id,
                cs.business_name AS session_business_name,
                cs.first_name AS session_first_name,
                cs.last_name AS session_last_name,
                cr.assigned_oxsteed_cut_bps
           ${joins} AND cp.status = 'completed'
          ORDER BY cp.created_at DESC
          LIMIT $2`,
        [req.user.id, MAX_ROWS],
      ),
    ]);
    const totals = totalRows[0] || {};
    const statusCounts = {};
    for (const row of statusRows) statusCounts[row.status] = row.count;
    const monthly = monthlyRows.map((row) => ({
      month: row.month,
      payments: row.payments,
      grossCents: cents(row.gross_cents),
      consultantShareCents: cents(row.consultant_share_cents),
      oxsteedShareCents: cents(row.oxsteed_share_cents),
    }));
    const payments = rows.map((row) => {
      const amount = cents(row.amount_cents);
      const split = splitPayment(amount, row.assigned_oxsteed_cut_bps ?? defaultCutBps);
      return {
        id: String(row.id),
        sessionId: row.session_id ? String(row.session_id) : null,
        sessionBusinessName: row.session_business_name,
        sessionClientName: [row.session_first_name, row.session_last_name].filter(Boolean).join(' ') || null,
        serviceTier: row.service_tier,
        amountCents: amount,
        consultantShareCents: split.consultantShareCents,
        oxsteedShareCents: split.oxsteedShareCents,
        createdAt: row.created_at,
      };
    });
    return res.json({
      totals: {
        completedPayments: totals.completed_payments || 0,
        grossCents: cents(totals.gross_cents),
        consultantShareCents: cents(totals.consultant_share_cents),
        oxsteedShareCents: cents(totals.oxsteed_share_cents),
        refundedCount: totals.refunded_count || 0,
        refundedCents: cents(totals.refunded_cents),
      },
      statusCounts,
      monthly,
      payments,
    });
  } catch (err) {
    logger.error('Consulting practice earnings failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to load earnings report.' });
  }
}

function presentSupportTicket(row, messageCount) {
  return {
    id: String(row.id),
    ticketNumber: row.ticket_number,
    subject: row.subject,
    priority: row.priority,
    status: row.status,
    messageCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// POST /consulting/contractor/practice/support (550)
async function createSupportIntake(req, res) {
  const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const priority = typeof req.body?.priority === 'string' ? req.body.priority : 'normal';
  const clientRequestId = typeof req.body?.clientRequestId === 'string' ? req.body.clientRequestId.trim() : '';
  if (!subject || subject.length > 500) {
    return res.status(400).json({ error: 'Subject is required and must be 500 characters or fewer', code: 'invalid_subject' });
  }
  if (!message || message.length > 5000) {
    return res.status(400).json({ error: 'Message is required and must be 5000 characters or fewer', code: 'invalid_message' });
  }
  if (!SUPPORT_PRIORITIES.has(priority)) {
    return res.status(400).json({ error: 'Priority must be low, normal, high, or urgent', code: 'invalid_priority' });
  }
  if (clientRequestId !== '' && !UUID_RE.test(clientRequestId)) {
    return res.status(400).json({ error: 'clientRequestId must be a UUID', code: 'invalid_client_request_id' });
  }
  try {
    const { rows: userRows } = await db.query(
      `SELECT first_name, last_name, email FROM users WHERE id = $1`,
      [req.user.id],
    );
    const user = userRows[0] || {};
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || 'Consultant';
    const outcome = await withTransaction(db, async (client) => {
      const slaDue = priority === 'urgent' ? '1 hour' : priority === 'high' ? '4 hours' : priority === 'low' ? '72 hours' : '24 hours';
      const { rows: ticketRows } = await client.query(
        `INSERT INTO support_tickets
           (user_id, name, email, subject, category, priority, status, source,
            client_request_id, metadata, sla_due_at)
         VALUES ($1, $2, $3, $4, 'consultant_practice', $5, 'open', 'direct',
                 $6, $7::jsonb, NOW() + ($8::text)::interval)
         ON CONFLICT (client_request_id)
         WHERE client_request_id IS NOT NULL DO NOTHING
         RETURNING *`,
        [
          req.user.id,
          name,
          (user.email || '').toLowerCase(),
          subject,
          priority,
          clientRequestId === '' ? null : clientRequestId,
          JSON.stringify({ practice_intake: true }),
          slaDue,
        ],
      );
      if (ticketRows.length === 0) {
        const { rows: existing } = await client.query(
          `SELECT * FROM support_tickets WHERE client_request_id = $1`,
          [clientRequestId],
        );
        return { status: 200, body: { ticket: presentSupportTicket(existing[0], 1), duplicate: true } };
      }
      const ticket = ticketRows[0];
      await client.query(
        `INSERT INTO support_messages
           (ticket_id, sender_id, sender_name, sender_email, content, is_internal, is_from_admin)
         VALUES ($1, $2, $3, $4, $5, FALSE, FALSE)`,
        [ticket.id, req.user.id, name, (user.email || '').toLowerCase(), message],
      );
      return { status: 201, body: { ticket: presentSupportTicket(ticket, 1), duplicate: false } };
    }, 'consultant_practice_support_intake');
    // After the transaction commits, never inside it (the Slice B
    // decline pattern): tell support staff, best-effort.
    if (outcome.status === 201) {
      try {
        await notifySupportStaff({
          type: 'consulting_practice_support_requested',
          title: 'Consultant requested practice support',
          body: `A consultant filed a practice support request: ${subject}`,
          data: { ticketId: outcome.body.ticket.id, ticketNumber: outcome.body.ticket.ticketNumber },
          action_url: '/admin/support',
          idempotencyKeyPrefix: `consulting-practice-support-${outcome.body.ticket.id}`,
        });
      } catch (e) {
        logger.warn('Failed to notify staff of practice support request', { ticketId: outcome.body.ticket.id, error: e.message });
      }
    }
    return res.status(outcome.status).json(outcome.body);
  } catch (err) {
    logger.error('Consulting practice support intake failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to file practice support request.' });
  }
}

// GET /consulting/contractor/practice/support (550)
async function listSupportIntakes(req, res) {
  try {
    const { rows } = await db.query(
      `SELECT t.id, t.ticket_number, t.subject, t.priority, t.status,
              t.created_at, t.updated_at,
              (SELECT COUNT(*)::int FROM support_messages m WHERE m.ticket_id = t.id) AS message_count
         FROM support_tickets t
        WHERE t.user_id = $1 AND t.category = 'consultant_practice'
        ORDER BY t.created_at DESC
        LIMIT $2`,
      [req.user.id, MAX_ROWS],
    );
    return res.json({ tickets: rows.map((row) => presentSupportTicket(row, row.message_count)) });
  } catch (err) {
    logger.error('Consulting practice support list failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to load practice support requests.' });
  }
}

module.exports = {
  getInquiryPipeline,
  getUtilization,
  getOutstandingDeliverables,
  getEarnings,
  createSupportIntake,
  listSupportIntakes,
};
