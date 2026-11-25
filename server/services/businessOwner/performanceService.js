'use strict';
// Groups 5-6 items 246-250: quote acceptance, utilization, service quality
// trends, operating cost snapshots and recurring revenue. Read models over
// authoritative rows; snapshots freeze a past month's numbers.
const pool = require('../../db');
const { withTransaction } = require('../../utils/transaction');
const { fail, invalid, text } = require('./common');

const PERIODS = { '30d': 30, '90d': 90, '365d': 365 };
const days = q => PERIODS[q?.period || '90d'] || invalid('period');

// 246
async function quoteAcceptance(businessId, query) {
  const n = days(query);
  const { rows: [t] } = await pool.query(`SELECT
      COUNT(*) FILTER (WHERE status <> 'draft')::int AS sent,
      COUNT(*) FILTER (WHERE status IN ('approved','converted'))::int AS accepted,
      COUNT(*) FILTER (WHERE status = 'declined')::int AS declined,
      COUNT(*) FILTER (WHERE status = 'expired' OR (status='sent' AND valid_until < CURRENT_DATE))::int AS expired,
      COUNT(*) FILTER (WHERE status = 'sent' AND (valid_until IS NULL OR valid_until >= CURRENT_DATE))::int AS waiting,
      COALESCE(SUM(total_cents) FILTER (WHERE status IN ('approved','converted')),0)::bigint AS accepted_cents,
      COALESCE(SUM(total_cents) FILTER (WHERE status <> 'draft'),0)::bigint AS sent_cents
    FROM business_quotes WHERE business_id=$1 AND superseded_at IS NULL AND created_at >= NOW() - make_interval(days => $2)`, [businessId, n]);
  const decided = t.accepted + t.declined + t.expired;
  const { rows: byPerson } = await pool.query(`SELECT q.created_by AS user_id, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS name,
      COUNT(*) FILTER (WHERE q.status <> 'draft')::int AS sent, COUNT(*) FILTER (WHERE q.status IN ('approved','converted'))::int AS accepted,
      COALESCE(SUM(q.total_cents) FILTER (WHERE q.status IN ('approved','converted')),0)::bigint AS accepted_cents
    FROM business_quotes q LEFT JOIN users u ON u.id=q.created_by WHERE q.business_id=$1 AND q.superseded_at IS NULL AND q.created_at >= NOW() - make_interval(days => $2)
    GROUP BY 1,2 HAVING COUNT(*) FILTER (WHERE q.status <> 'draft') > 0 ORDER BY 4 DESC LIMIT 50`, [businessId, n]);
  const { rows: byMonth } = await pool.query(`SELECT to_char(date_trunc('month', created_at),'YYYY-MM') AS month,
      COUNT(*) FILTER (WHERE status <> 'draft')::int AS sent, COUNT(*) FILTER (WHERE status IN ('approved','converted'))::int AS accepted
    FROM business_quotes WHERE business_id=$1 AND superseded_at IS NULL AND created_at >= NOW() - make_interval(days => $2) GROUP BY 1 ORDER BY 1`, [businessId, n]);
  const { rows: reasons } = await pool.query(`SELECT LEFT(TRIM(decline_reason), 80) AS reason, COUNT(*)::int AS n FROM business_quotes
    WHERE business_id=$1 AND status='declined' AND decline_reason IS NOT NULL AND TRIM(decline_reason) <> '' AND created_at >= NOW() - make_interval(days => $2) GROUP BY 1 ORDER BY 2 DESC LIMIT 5`, [businessId, n]);
  return {
    period_days: n, totals: t, acceptance_rate: decided ? t.accepted / decided : null,
    average_accepted_cents: t.accepted ? Math.round(Number(t.accepted_cents) / t.accepted) : null,
    by_person: byPerson.map(p => ({ ...p, acceptance_rate: p.sent ? p.accepted / p.sent : null })), by_month: byMonth, decline_reasons: reasons,
  };
}

// 247: scheduled (shifts, else availability) vs worked-on (completed/in-progress visits) per person.
async function utilization(businessId, query) {
  const n = days(query);
  const { rows: [b] } = await pool.query("SELECT COALESCE(NULLIF(timezone,''),'America/New_York') AS tz FROM businesses WHERE id=$1", [businessId]);
  const { rows } = await pool.query(`WITH staff AS (SELECT user_id FROM businesses WHERE id=$1
        UNION SELECT member_id FROM business_members WHERE business_id=$1 AND status='active' AND member_id IS NOT NULL),
      d AS (SELECT (timezone($2, NOW()))::date - g AS day FROM generate_series(1, $3) g),
      shift AS (SELECT shift_date AS day, user_id, SUM(EXTRACT(EPOCH FROM (end_time-start_time))/3600.0) AS h FROM business_staff_shifts
        WHERE business_id=$1 AND cancelled_at IS NULL AND end_time > start_time GROUP BY 1,2),
      avail AS (SELECT day_of_week, user_id, SUM(EXTRACT(EPOCH FROM (end_time-start_time))/3600.0) AS h FROM business_staff_availability WHERE business_id=$1 GROUP BY 1,2),
      sched AS (SELECT staff.user_id, SUM(COALESCE(shift.h, avail.h, 0)) AS h FROM d CROSS JOIN staff
        LEFT JOIN shift ON shift.day=d.day AND shift.user_id=staff.user_id LEFT JOIN avail ON avail.user_id=staff.user_id AND avail.day_of_week=EXTRACT(DOW FROM d.day) GROUP BY 1),
      worked AS (SELECT staff_id AS user_id, SUM(EXTRACT(EPOCH FROM (end_time-start_time))/3600.0) AS h, COUNT(*) AS visits FROM business_appointments
        WHERE business_id=$1 AND status IN ('completed','in_progress') AND start_time >= timezone($2, ((timezone($2, NOW()))::date - $3)::timestamp) AND start_time < timezone($2, (timezone($2, NOW()))::date::timestamp) GROUP BY 1)
    SELECT staff.user_id, TRIM(CONCAT(u.first_name,' ',u.last_name)) AS name, ROUND(COALESCE(sched.h,0)::numeric,1)::float AS scheduled_hours,
      ROUND(COALESCE(worked.h,0)::numeric,1)::float AS booked_hours, COALESCE(worked.visits,0)::int AS visits
    FROM staff JOIN users u ON u.id=staff.user_id LEFT JOIN sched ON sched.user_id=staff.user_id LEFT JOIN worked ON worked.user_id=staff.user_id ORDER BY 4 DESC, 2`, [businessId, b.tz, n]);
  const people = rows.map(r => ({ ...r, utilization: r.scheduled_hours > 0 ? r.booked_hours / r.scheduled_hours : null }));
  const sched = people.reduce((a, r) => a + r.scheduled_hours, 0), booked = people.reduce((a, r) => a + r.booked_hours, 0);
  return { period_days: n, people, scheduled_hours: Math.round(sched * 10) / 10, booked_hours: Math.round(booked * 10) / 10, utilization: sched > 0 ? booked / sched : null };
}

// 248: last 12 months, per month and per service.
async function qualityTrends(businessId) {
  const { rows: months } = await pool.query(`WITH m AS (SELECT generate_series(date_trunc('month', NOW()) - INTERVAL '11 months', date_trunc('month', NOW()), INTERVAL '1 month') AS m)
    SELECT to_char(m.m,'YYYY-MM') AS month,
      (SELECT COUNT(*)::int FROM business_appointments a WHERE a.business_id=$1 AND a.status='completed' AND date_trunc('month', a.start_time)=m.m) AS completed,
      (SELECT COUNT(*)::int FROM business_appointments a WHERE a.business_id=$1 AND a.status='no_show' AND date_trunc('month', a.start_time)=m.m) AS no_shows,
      (SELECT COUNT(*)::int FROM business_appointments a WHERE a.business_id=$1 AND a.status='cancelled' AND date_trunc('month', a.start_time)=m.m) AS cancelled,
      (SELECT COUNT(*)::int FROM business_service_issues i WHERE i.business_id=$1 AND date_trunc('month', i.created_at)=m.m) AS issues,
      (SELECT ROUND(AVG(r)::numeric, 2)::float FROM (
          SELECT rating::numeric AS r FROM business_reviews WHERE business_id=$1 AND COALESCE(is_hidden,FALSE)=FALSE AND date_trunc('month', created_at)=m.m
          UNION ALL SELECT feedback_rating::numeric FROM business_appointments WHERE business_id=$1 AND feedback_rating IS NOT NULL AND date_trunc('month', start_time)=m.m) x) AS avg_rating,
      (SELECT COUNT(*)::int FROM business_reviews WHERE business_id=$1 AND COALESCE(is_hidden,FALSE)=FALSE AND date_trunc('month', created_at)=m.m)
        + (SELECT COUNT(*)::int FROM business_appointments WHERE business_id=$1 AND feedback_rating IS NOT NULL AND date_trunc('month', start_time)=m.m) AS ratings
    FROM m ORDER BY m.m`, [businessId]);
  const { rows: services } = await pool.query(`SELECT s.id, s.name,
      COUNT(a.id) FILTER (WHERE a.status='completed')::int AS completed,
      ROUND(AVG(a.feedback_rating)::numeric, 2)::float AS avg_rating,
      (SELECT COUNT(*)::int FROM business_service_issues i JOIN business_appointments ia ON ia.id=i.appointment_id WHERE i.business_id=$1 AND ia.service_id=s.id AND i.created_at >= NOW() - INTERVAL '12 months') AS issues
    FROM business_services s LEFT JOIN business_appointments a ON a.service_id=s.id AND a.business_id=$1 AND a.start_time >= NOW() - INTERVAL '12 months'
    WHERE s.business_id=$1 AND s.deleted_at IS NULL GROUP BY s.id, s.name ORDER BY 3 DESC LIMIT 50`, [businessId]);
  const rate = (a, b) => (b ? a / b : null);
  return {
    months: months.map(m => ({ ...m, issue_rate: rate(m.issues, m.completed), no_show_rate: rate(m.no_shows, m.completed + m.no_shows), cancel_rate: rate(m.cancelled, m.completed + m.no_shows + m.cancelled) })),
    services: services.map(s => ({ ...s, issue_rate: rate(s.issues, s.completed) })),
  };
}

// 249
const monthStart = v => {
  if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) invalid('month');
  return `${v}-01`;
};
async function computeCosts(db, businessId, month) {
  const { rows: [r] } = await db.query(`WITH bounds AS (SELECT $2::date AS s, ($2::date + INTERVAL '1 month')::date AS e),
      pay AS (SELECT DISTINCT ON (member_id) member_id, COALESCE(hourly_wage_cents, CASE pay_rate_period WHEN 'hour' THEN pay_rate_cents WHEN 'week' THEN pay_rate_cents / 40.0
          WHEN 'month' THEN pay_rate_cents * 12 / 2080.0 WHEN 'year' THEN pay_rate_cents / 2080.0 END) AS rate
        FROM business_members WHERE business_id=$1 AND member_id IS NOT NULL ORDER BY member_id, (status='active') DESC, id DESC)
    SELECT
      (SELECT COALESCE(SUM(ROUND(amount_paid*100)),0) FROM business_invoices, bounds WHERE business_id=$1 AND paid_at >= bounds.s AND paid_at < bounds.e)::bigint
        + (SELECT COALESCE(SUM(COALESCE(final_price_cents, base_price_cents, 0)),0) FROM business_appointments a, bounds WHERE a.business_id=$1 AND a.payment_status='paid'
            AND a.start_time >= bounds.s AND a.start_time < bounds.e AND NOT EXISTS (SELECT 1 FROM business_invoices i WHERE i.business_id=$1 AND i.stripe_payment_intent_id IS NOT NULL AND i.stripe_payment_intent_id=a.stripe_payment_intent_id))::bigint AS revenue_cents,
      (SELECT COALESCE(SUM(amount_cents),0) FROM business_expenses, bounds WHERE business_id=$1 AND COALESCE(approval_status,'approved')='approved' AND expense_date >= bounds.s AND expense_date < bounds.e)::bigint AS expense_cents,
      (SELECT COALESCE(jsonb_object_agg(category, total), '{}'::jsonb) FROM (SELECT category, SUM(amount_cents) AS total FROM business_expenses, bounds
          WHERE business_id=$1 AND COALESCE(approval_status,'approved')='approved' AND expense_date >= bounds.s AND expense_date < bounds.e GROUP BY category) c) AS expenses_by_category,
      (SELECT COALESCE(SUM(hours_worked),0) FROM business_time_entries, bounds WHERE business_id=$1 AND voided_at IS NULL AND entry_date >= bounds.s AND entry_date < bounds.e)::numeric(12,2) AS labor_hours,
      (SELECT COALESCE(ROUND(SUM(te.hours_worked * COALESCE(pay.rate,0))),0) FROM business_time_entries te CROSS JOIN bounds LEFT JOIN pay ON pay.member_id=te.user_id
          WHERE te.business_id=$1 AND te.voided_at IS NULL AND te.entry_date >= bounds.s AND te.entry_date < bounds.e)::bigint AS labor_cents,
      (SELECT COUNT(*)::int FROM business_time_entries te CROSS JOIN bounds LEFT JOIN pay ON pay.member_id=te.user_id
          WHERE te.business_id=$1 AND te.voided_at IS NULL AND te.entry_date >= bounds.s AND te.entry_date < bounds.e AND pay.rate IS NULL) AS entries_without_rate`, [businessId, month]);
  const revenue = Number(r.revenue_cents), costs = Number(r.expense_cents) + Number(r.labor_cents);
  return { ...r, labor_hours: Number(r.labor_hours), total_cost_cents: costs, margin_cents: revenue - costs, margin_rate: revenue > 0 ? (revenue - costs) / revenue : null };
}
async function costSnapshots(businessId, query) {
  const now = new Date();
  const month = query?.month ? monthStart(query.month) : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const live = await computeCosts(pool, businessId, month);
  const { rows: saved } = await pool.query(`SELECT DISTINCT ON (period_month) *, to_char(period_month,'YYYY-MM') AS month FROM business_cost_snapshots WHERE business_id=$1
    ORDER BY period_month DESC, version DESC LIMIT 24`, [businessId]);
  return { month: month.slice(0, 7), live, snapshots: saved };
}
async function takeSnapshot(businessId, actorId, body) {
  const month = monthStart(body?.month);
  const now = new Date();
  const current = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  if (month >= current) fail(409, 'month_not_closed');
  const note = text(body.note, 500, { required: false });
  return withTransaction(pool, async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`biz-cost-snap:${businessId}:${month}`]);
    const c = await computeCosts(db, businessId, month);
    const { rows: [v] } = await db.query('SELECT COALESCE(MAX(version),0)+1 AS v FROM business_cost_snapshots WHERE business_id=$1 AND period_month=$2', [businessId, month]);
    const { rows: [row] } = await db.query(`INSERT INTO business_cost_snapshots(business_id, period_month, version, revenue_cents, expense_cents, labor_cents, labor_hours, expenses_by_category, note, created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [businessId, month, v.v, c.revenue_cents, c.expense_cents, c.labor_cents, c.labor_hours, c.expenses_by_category, note, actorId]);
    return row;
  }, 'business_cost_snapshot');
}

// 250
const MONTHLY = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, annually: 1 / 12 };
async function recurringRevenue(businessId) {
  const { rows } = await pool.query(`SELECT id, client_name, description, amount_cents, frequency, next_billing_date, status, updated_at FROM business_recurring_billing WHERE business_id=$1`, [businessId]);
  const monthly = r => Math.round(r.amount_cents * (MONTHLY[r.frequency] || 0));
  const active = rows.filter(r => r.status === 'active');
  const mrr = active.reduce((n, r) => n + monthly(r), 0);
  const since = Date.now() - 90 * 864e5;
  const churned = rows.filter(r => r.status === 'cancelled' && new Date(r.updated_at).getTime() >= since);
  const byClient = {};
  for (const r of active) byClient[r.client_name] = (byClient[r.client_name] || 0) + monthly(r);
  const soon = Date.now() + 30 * 864e5;
  return {
    mrr_cents: mrr, arr_cents: mrr * 12, active: active.length, paused: rows.filter(r => r.status === 'paused').length,
    paused_mrr_cents: rows.filter(r => r.status === 'paused').reduce((n, r) => n + monthly(r), 0),
    churned_90d: churned.length, churned_mrr_90d_cents: churned.reduce((n, r) => n + monthly(r), 0),
    by_frequency: Object.keys(MONTHLY).map(f => ({ frequency: f, count: active.filter(r => r.frequency === f).length, mrr_cents: active.filter(r => r.frequency === f).reduce((n, r) => n + monthly(r), 0) })),
    top_clients: Object.entries(byClient).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([client_name, mrr_cents]) => ({ client_name, mrr_cents })),
    upcoming: active.filter(r => r.next_billing_date && new Date(r.next_billing_date).getTime() <= soon).sort((a, b) => new Date(a.next_billing_date) - new Date(b.next_billing_date)).slice(0, 20)
      .map(r => ({ id: r.id, client_name: r.client_name, amount_cents: r.amount_cents, next_billing_date: r.next_billing_date })),
  };
}

module.exports = { quoteAcceptance, utilization, qualityTrends, costSnapshots, takeSnapshot, recurringRevenue, computeCosts };
