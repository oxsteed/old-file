'use strict';

// Fairness reporting and the AI-ranking auto-off switch (spec §12.2, §10.4).
// Selection rates by stage and group, impact ratios under the four-fifths
// rule, groups under 10 people suppressed. EEO answers are read here
// only, decrypted in memory, aggregated, and never written out per person.

const pool = require('../../db');
const logger = require('../../utils/logger');
const { loadForApplications } = require('./eeo');
const { notifyUser } = require('./notify');

const MIN_GROUP = 10;
const IMPACT_THRESHOLD = 0.8;
const DIMENSIONS = Object.freeze(['sex', 'race_ethnicity']);

// Stage transitions measured: did the applicant get past each step?
const STAGE_STEPS = Object.freeze([
  { key: 'advanced_to_interview', reached: ['interview', 'assessment', 'offer', 'hired', 'offer_declined'] },
  { key: 'reached_offer', reached: ['offer', 'hired', 'offer_declined'] },
  { key: 'hired', reached: ['hired'] },
]);

/**
 * rows: [{ group: string|null, selected: boolean }]. Returns
 * { groups: { [g]: { n, selected, rate } }, suppressed: [g], impactRatios: { [g]: ratio }, minRatio }.
 * Groups below minGroup and 'decline' answers are left out of the ratios.
 */
function impactRatios(rows, { minGroup = MIN_GROUP } = {}) {
  const counts = new Map();
  for (const r of rows) {
    if (!r.group || r.group === 'decline') continue;
    const c = counts.get(r.group) || { n: 0, selected: 0 };
    c.n += 1;
    if (r.selected) c.selected += 1;
    counts.set(r.group, c);
  }
  const groups = {};
  const suppressed = [];
  for (const [g, c] of counts) {
    if (c.n < minGroup) { suppressed.push(g); continue; }
    groups[g] = { n: c.n, selected: c.selected, rate: c.selected / c.n };
  }
  const maxRate = Math.max(0, ...Object.values(groups).map((g) => g.rate));
  const impact = {};
  for (const [g, v] of Object.entries(groups)) impact[g] = maxRate > 0 ? Math.round((v.rate / maxRate) * 10000) / 10000 : null;
  const ratios = Object.values(impact).filter((v) => v !== null);
  return { groups, suppressed, impactRatios: impact, minRatio: ratios.length >= 2 ? Math.min(...ratios) : null };
}

function intersectional(eeo) {
  if (!eeo?.sex || !eeo?.race_ethnicity || eeo.sex === 'decline' || eeo.race_ethnicity === 'decline') return null;
  return `${eeo.sex}|${eeo.race_ethnicity}`;
}

function metricsFor(apps, eeoMap) {
  const out = { applications: apps.length, steps: {} };
  for (const step of STAGE_STEPS) {
    const byDim = {};
    for (const dim of DIMENSIONS) {
      byDim[dim] = impactRatios(apps.map((a) => ({ group: eeoMap.get(Number(a.id))?.[dim] || null, selected: step.reached.includes(a.stage) })));
    }
    byDim.intersection = impactRatios(apps.map((a) => ({ group: intersectional(eeoMap.get(Number(a.id))), selected: step.reached.includes(a.stage) })));
    // Proxy check everywhere (no EEO needed): by applicant city.
    byDim.city_proxy = impactRatios(apps.map((a) => ({ group: a.city ? String(a.city).toLowerCase() : null, selected: step.reached.includes(a.stage) })));
    out.steps[step.key] = byDim;
  }
  return out;
}

function lowestRatio(metrics, { includeProxy = false } = {}) {
  let min = null;
  for (const step of Object.values(metrics.steps)) {
    for (const [dim, r] of Object.entries(step)) {
      if (!includeProxy && dim === 'city_proxy') continue;
      if (r.minRatio !== null && (min === null || r.minRatio < min)) min = r.minRatio;
    }
  }
  return min;
}

async function loadApps(db, { periodStart, periodEnd, businessId = null, openingId = null, rankedOnly = false }) {
  const params = [periodStart, periodEnd];
  const where = ['a.created_at >= $1::date', 'a.created_at < ($2::date + 1)', "a.stage <> 'withdrawn'"];
  if (businessId) { params.push(businessId); where.push(`o.business_id = $${params.length}`); }
  if (openingId) { params.push(openingId); where.push(`o.id = $${params.length}`); }
  if (rankedOnly) where.push('a.ai_rank_run_id IS NOT NULL');
  const { rows } = await db.query(
    `SELECT a.id, a.stage, a.city, o.id AS opening_id, o.business_id, o.country_code
       FROM career_applications a JOIN career_openings o ON o.id = a.opening_id
      WHERE ${where.join(' AND ')}`,
    params
  );
  return rows;
}

async function saveReport(db, { scopeType, scopeRef, periodStart, periodEnd, kind, metrics }) {
  const { rows: [r] } = await db.query(
    `INSERT INTO career_fairness_reports (scope_type, scope_ref, period_start, period_end, kind, metrics)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [scopeType, scopeRef, periodStart, periodEnd, kind, JSON.stringify(metrics)]
  );
  return r.id;
}

async function blockScope(db, { scopeType, scopeRef, ratio, reportId }) {
  const { rows } = await db.query(
    `INSERT INTO career_ai_ranking_blocks (scope_type, scope_ref, impact_ratio, reason, report_id)
     VALUES ($1, $2, $3, 'impact_ratio_below_0_8', $4)
     ON CONFLICT (scope_type, scope_ref) WHERE reviewed_at IS NULL DO NOTHING
     RETURNING id`,
    [scopeType, scopeRef, ratio, reportId]
  );
  return rows[0]?.id || null;
}

async function notifyAdmins(db, params, deliveryKey) {
  const { rows } = await db.query(
    `SELECT DISTINCT u.id FROM users u
      LEFT JOIN admin_permission_grants g ON g.grantee_id = u.id AND g.revoked_at IS NULL AND g.expires_at > NOW()
       AND (g.permissions ? 'moderate_careers' OR g.permissions ? 'manage_hiring')
     WHERE u.role = 'super_admin' OR g.id IS NOT NULL
     LIMIT 50`
  );
  for (const r of rows) await notifyUser(db, { userId: r.id, type: 'career_ranking_disabled', params, actionUrl: '/admin/careers/fairness', deliveryKey: `${deliveryKey}:${r.id}` });
}

/**
 * Quarterly selection-rate report for the platform and each business.
 */
async function runQuarterlyReports({ db = pool, periodStart, periodEnd } = {}) {
  const apps = await loadApps(db, { periodStart, periodEnd });
  const eeoMap = await loadForApplications(db, apps.map((a) => Number(a.id)));
  const reports = [];
  reports.push(await saveReport(db, { scopeType: 'platform', scopeRef: 'platform', periodStart, periodEnd, kind: 'quarterly', metrics: metricsFor(apps, eeoMap) }));
  const byBusiness = new Map();
  for (const a of apps) if (a.business_id) byBusiness.set(a.business_id, [...(byBusiness.get(a.business_id) || []), a]);
  for (const [bid, list] of byBusiness) {
    reports.push(await saveReport(db, { scopeType: 'business', scopeRef: String(bid), periodStart, periodEnd, kind: 'quarterly', metrics: metricsFor(list, eeoMap) }));
  }
  return { reports: reports.length };
}

/**
 * Monthly ranking check: for ranked applications, any impact ratio under
 * 0.8 (EEO dimensions; groups of 10+) switches ranking off for that scope
 * until a person reviews it.
 */
async function runRankingCheck({ db = pool, periodStart, periodEnd } = {}) {
  const apps = await loadApps(db, { periodStart, periodEnd, rankedOnly: true });
  if (!apps.length) return { checked: 0, blocked: [] };
  const eeoMap = await loadForApplications(db, apps.map((a) => Number(a.id)));
  const blocked = [];
  const scopes = [['platform', 'platform', apps]];
  const byBusiness = new Map();
  const byOpening = new Map();
  for (const a of apps) {
    const bkey = String(a.business_id || 'platform');
    byBusiness.set(bkey, [...(byBusiness.get(bkey) || []), a]);
    byOpening.set(String(a.opening_id), [...(byOpening.get(String(a.opening_id)) || []), a]);
  }
  for (const [k, list] of byBusiness) if (k !== 'platform') scopes.push(['business', k, list]);
  for (const [k, list] of byOpening) scopes.push(['opening', k, list]);
  for (const [scopeType, scopeRef, list] of scopes) {
    const metrics = metricsFor(list, eeoMap);
    const ratio = lowestRatio(metrics);
    const reportId = await saveReport(db, { scopeType, scopeRef, periodStart, periodEnd, kind: 'monthly_ranking', metrics: { ...metrics, lowest_ratio: ratio } });
    if (ratio !== null && ratio < IMPACT_THRESHOLD) {
      const blockId = await blockScope(db, { scopeType, scopeRef, ratio, reportId });
      if (blockId) {
        blocked.push({ scopeType, scopeRef, ratio });
        logger.warn('careers: AI ranking blocked by impact ratio', { scopeType, scopeRef, ratio });
        await notifyAdmins(db, { scope: `${scopeType}:${scopeRef}`, ratio: ratio.toFixed(2) }, `career_ranking_block:${blockId}`);
      }
    }
  }
  return { checked: scopes.length, blocked };
}

module.exports = {
  MIN_GROUP,
  IMPACT_THRESHOLD,
  STAGE_STEPS,
  impactRatios,
  metricsFor,
  lowestRatio,
  runQuarterlyReports,
  runRankingCheck,
};
