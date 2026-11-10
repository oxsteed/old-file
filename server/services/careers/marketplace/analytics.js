'use strict';

// Employer analytics (docs/careers/marketplace.md §14). Per-opening funnel
// (impressions → views → apply starts → applications → interviews →
// offers → hires), saves/shares, median first-response time and source
// mix, for the openings in the caller's hiring scope. Counts only — no
// applicant identities. CSV export is formula-neutralized (utils/csv) and
// gated by the plan entitlement when plans are on.

const { AppError } = require('../../../middleware/errorHandler');
const { csvRow } = require('../../../utils/csv');
const plans = require('./plans');

const RANGES = [7, 30, 90];

function scopeSql(access, params) {
  if (access.kind === 'platform') return "o.employer_type = 'platform'";
  params.push(access.businessId);
  let sql = `o.business_id = $${params.length}`;
  if (access.agencyBusinessId) {
    params.push(access.agencyBusinessId);
    sql += ` AND o.posted_by_agency_id = $${params.length}`;
  } else if (!(access.isOwner || ['business', 'brand'].includes(access.scope?.mode))) {
    params.push(access.scope?.locationIds || []);
    sql += ` AND cardinality(o.location_ids) > 0 AND o.location_ids <@ $${params.length}::bigint[]`;
  }
  return sql;
}

async function dashboard(db, { access, days = 30 }) {
  const range = RANGES.includes(Number(days)) ? Number(days) : 30;
  const params = [];
  const where = scopeSql(access, params);
  params.push(range);
  const r = `$${params.length}`;
  const { rows } = await db.query(
    `WITH scoped AS (SELECT o.id, o.title, o.status, o.published_at FROM career_openings o WHERE ${where}),
     m AS (
       SELECT d.opening_id, SUM(d.impressions)::int AS impressions, SUM(d.views)::int AS views,
              SUM(d.apply_starts)::int AS apply_starts, SUM(d.saves)::int AS saves, SUM(d.shares)::int AS shares
         FROM career_opening_metrics_daily d JOIN scoped s ON s.id = d.opening_id
        WHERE d.day > CURRENT_DATE - ${r}::int GROUP BY d.opening_id
     ),
     a AS (
       SELECT a.opening_id, COUNT(*)::int AS applications,
              COUNT(*) FILTER (WHERE a.source = 'guest')::int AS from_guest,
              COUNT(*) FILTER (WHERE a.source = 'invitation')::int AS from_invitation,
              COUNT(*) FILTER (WHERE a.stage = 'hired')::int AS hires,
              COUNT(*) FILTER (WHERE a.screener_passed = FALSE)::int AS screened_out,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM career_interviews i WHERE i.application_id = a.id))::int AS interviewed,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM career_offers f WHERE f.application_id = a.id AND f.status <> 'awaiting_approval'))::int AS offered,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (
                (SELECT MIN(e.created_at) FROM career_application_events e WHERE e.application_id = a.id AND e.actor_user_id IS NOT NULL AND e.actor_user_id IS DISTINCT FROM a.user_id)
                - a.created_at)) / 3600.0) AS median_first_response_hours
         FROM career_applications a JOIN scoped s ON s.id = a.opening_id
        WHERE a.created_at > NOW() - make_interval(days => ${r}::int)
        GROUP BY a.opening_id
     )
     SELECT s.id, s.title, s.status, s.published_at,
            COALESCE(m.impressions, 0) AS impressions, COALESCE(m.views, 0) AS views, COALESCE(m.apply_starts, 0) AS apply_starts,
            COALESCE(m.saves, 0) AS saves, COALESCE(m.shares, 0) AS shares,
            COALESCE(a.applications, 0) AS applications, COALESCE(a.interviewed, 0) AS interviewed, COALESCE(a.offered, 0) AS offered,
            COALESCE(a.hires, 0) AS hires, COALESCE(a.screened_out, 0) AS screened_out,
            COALESCE(a.from_guest, 0) AS from_guest, COALESCE(a.from_invitation, 0) AS from_invitation,
            ROUND(a.median_first_response_hours::numeric, 1) AS median_first_response_hours
       FROM scoped s LEFT JOIN m ON m.opening_id = s.id LEFT JOIN a ON a.opening_id = s.id
      ORDER BY COALESCE(a.applications, 0) DESC, COALESCE(m.views, 0) DESC, s.id DESC
      LIMIT 500`,
    params
  );
  const openings = rows.map((x) => ({
    ...x,
    median_first_response_hours: x.median_first_response_hours == null ? null : Number(x.median_first_response_hours),
    view_rate: x.impressions ? Math.round((x.views / x.impressions) * 1000) / 10 : null,
    apply_rate: x.views ? Math.round((x.applications / x.views) * 1000) / 10 : null,
  }));
  const sum = (k) => openings.reduce((acc, o) => acc + Number(o[k] || 0), 0);
  const totals = Object.fromEntries(['impressions', 'views', 'apply_starts', 'applications', 'interviewed', 'offered', 'hires', 'saves', 'shares', 'screened_out']
    .map((k) => [k, sum(k)]));
  const { rows: daily } = await db.query(
    `SELECT d.day, SUM(d.impressions)::int AS impressions, SUM(d.views)::int AS views, SUM(d.apply_starts)::int AS apply_starts
       FROM career_opening_metrics_daily d JOIN career_openings o ON o.id = d.opening_id
      WHERE ${where} AND d.day > CURRENT_DATE - ${r}::int GROUP BY d.day ORDER BY d.day`,
    params
  );
  return { days: range, totals, openings, daily };
}

async function exportCsv(db, { access, days }) {
  if (access.kind !== 'platform') {
    const e = await plans.entitlements(db, access.businessId);
    if (!e.analytics_export) throw new AppError('CSV export is included from the Starter plan', 402, 'plan_limit', { limit: 'analytics_export', plan: e.plan });
  }
  const data = await dashboard(db, { access, days });
  const header = ['opening_id', 'title', 'status', 'impressions', 'views', 'apply_starts', 'applications', 'interviewed', 'offered', 'hires', 'saves', 'shares', 'screened_out', 'median_first_response_hours'];
  const lines = [csvRow(header)];
  for (const o of data.openings) lines.push(csvRow(header.map((h) => o[h] ?? ''), { allowNumeric: true }));
  return `${lines.join('\r\n')}\r\n`;
}

module.exports = { RANGES, dashboard, exportCsv };
