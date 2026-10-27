'use strict';

// OxSteed admin endpoints for careers (spec §7 "Admin"): moderation, fact
// disputes, the AI-ranking market gate and impact-ratio blocks, fairness
// reports, EOR markets, retention and pay-transparency rules.
// Mounted behind requireAdmin + requirePermission (manage_hiring or
// moderate_careers); every write goes to the admin audit chain.

const { AppError } = require('../../middleware/errorHandler');
const { handle, tx, pool, requireUser } = require('./common');
const { logAdminAction } = require('../../services/auditService');
const { text, bool, normalizeCountry } = require('../../services/careers/validation');

function parseDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
const { EU_COUNTRIES } = require('../../services/careerCatalog');
const profileSvc = require('../../services/careers/profile');
const fairness = require('../../services/careers/fairness');
const { notifyUser } = require('../../services/careers/notify');

const validation = (fields) => new AppError('Validation failed', 400, 'validation_failed', fields);

async function adminAudit(req, client, { action, targetType, targetId, before = null, after = null }) {
  await logAdminAction({ adminId: req.user.id, action, targetType, targetId: targetId != null ? String(targetId) : null, before, after, req, client });
}

// ── Moderation ───────────────────────────────────────────────────────────────

exports.listOpenings = handle(async (req, res) => {
  const params = [];
  let where = 'TRUE';
  if (req.query.moderation_status) { params.push(String(req.query.moderation_status)); where += ` AND o.moderation_status = $${params.length}`; }
  if (req.query.status) { params.push(String(req.query.status)); where += ` AND o.status = $${params.length}`; }
  if (req.query.q) { params.push(`%${String(req.query.q).slice(0, 80)}%`); where += ` AND (o.title ILIKE $${params.length} OR b.business_name ILIKE $${params.length})`; }
  const { rows } = await pool.query(
    `SELECT o.id, o.title, o.status, o.moderation_status, o.employer_type, o.business_id, b.business_name,
            o.country_code, o.region, o.city, o.compensation_min, o.compensation_max, o.compensation_period, o.currency_code, o.removed_reason,
            o.published_at, o.updated_at,
            (SELECT COUNT(*)::int FROM career_applications a WHERE a.opening_id = o.id) AS applications
       FROM career_openings o LEFT JOIN businesses b ON b.id = o.business_id
      WHERE ${where} ORDER BY (o.moderation_status = 'flagged') DESC, o.updated_at DESC LIMIT 200`,
    params
  );
  res.json({ openings: rows });
});

exports.moderateOpening = handle(async (req, res) => {
  requireUser(req);
  const status = String(req.body?.moderation_status || '');
  if (!['ok', 'flagged', 'removed'].includes(status)) throw validation({ moderation_status: 'ok, flagged or removed' });
  const note = text(req.body?.note, 1000);
  if (status === 'removed' && !note) throw validation({ note: 'Say why the opening is removed' });
  const opening = await tx(async (c) => {
    const { rows: [before] } = await c.query('SELECT id, moderation_status, business_id, title, created_by FROM career_openings WHERE id = $1 FOR UPDATE', [Number(req.params.id)]);
    if (!before) throw new AppError('Opening not found', 404, 'not_found');
    const { rows: [row] } = await c.query(
      `UPDATE career_openings
          SET moderation_status = $2, updated_at = NOW(),
              removed_reason = CASE WHEN $2 = 'removed' THEN $3 ELSE NULL END,
              removed_by = CASE WHEN $2 = 'removed' THEN $4::uuid ELSE NULL END,
              removed_at = CASE WHEN $2 = 'removed' THEN NOW() ELSE NULL END
        WHERE id = $1 RETURNING id, moderation_status, removed_reason`,
      [before.id, status, note || null, req.user.id]
    );
    await adminAudit(req, c, { action: 'careers.opening.moderated', targetType: 'career_opening', targetId: before.id, before: { moderation_status: before.moderation_status }, after: { moderation_status: status, note } });
    if (status === 'removed' && before.created_by) {
      await notifyUser(c, {
        userId: before.created_by, type: 'career_opening_removed', params: { openingTitle: before.title, note },
        actionUrl: before.business_id ? `/business/${before.business_id}/careers` : '/admin/careers', deliveryKey: `career_opening_removed:${before.id}`,
      });
    }
    return row;
  }, 'career_admin_moderate');
  res.json({ opening });
});

// ── Fact disputes (30-day reinvestigation) ───────────────────────────────────

exports.listDisputes = handle(async (req, res) => {
  const status = ['open', 'upheld', 'rejected'].includes(req.query.status) ? req.query.status : 'open';
  const { rows } = await pool.query(
    `SELECT d.id, d.user_id, d.fact_type, d.fact_id, d.source_ref, d.reason, d.status, d.resolution_note, d.due_at, d.resolved_at, d.created_at,
            u.first_name, u.last_name, (d.due_at < NOW() AND d.status = 'open') AS overdue
       FROM career_fact_disputes d JOIN users u ON u.id = d.user_id
      WHERE d.status = $1 ORDER BY d.due_at ASC LIMIT 200`,
    [status]
  );
  res.json({ disputes: rows });
});

exports.resolveDispute = handle(async (req, res) => {
  const admin = requireUser(req);
  const dispute = await tx(async (c) => {
    const row = await profileSvc.resolveDispute(c, { disputeId: Number(req.params.id), admin, outcome: String(req.body?.outcome || ''), note: req.body?.note });
    await adminAudit(req, c, { action: 'careers.dispute.resolved', targetType: 'career_fact_dispute', targetId: row.id, after: { outcome: row.status } });
    return row;
  }, 'career_admin_dispute');
  res.json({ dispute: { id: dispute.id, status: dispute.status, resolved_at: dispute.resolved_at } });
});

// ── AI ranking gate (Q6) ─────────────────────────────────────────────────────

exports.listRankingMarkets = handle(async (_req, res) => {
  const [{ rows: markets }, { rows: blocks }] = await Promise.all([
    pool.query('SELECT * FROM career_ai_ranking_markets ORDER BY market'),
    pool.query('SELECT * FROM career_ai_ranking_blocks ORDER BY reviewed_at IS NULL DESC, created_at DESC LIMIT 200'),
  ]);
  res.json({ markets, blocks, globally_enabled: require('../../services/careers/providers/config').rankingConfig().enabled });
});

/**
 * Upsert a market. Enabling is refused unless the recorded bias audit is
 * current, EU markets have the AI Act sign-off and UK markets a DPIA that
 * covers ranking (§10.3). The gate re-checks all of this at rank time.
 */
exports.upsertRankingMarket = handle(async (req, res) => {
  const admin = requireUser(req);
  const market = String(req.params.market || '').toUpperCase();
  if (!/^[A-Z]{2}(-[A-Z0-9]{1,6}){0,2}$/.test(market)) throw validation({ market: 'Use a code like US, US-NY or US-NY-NYC' });
  const b = req.body || {};
  const fields = {};
  const dateOrNull = (key) => {
    if (b[key] === undefined) return undefined;
    if (b[key] === null || b[key] === '') return null;
    const d = parseDate(b[key]);
    if (!d) fields[key] = 'Use a date';
    return d ? d.toISOString() : null;
  };
  const vals = {
    bias_audit_passed_at: dateOrNull('bias_audit_passed_at'),
    bias_audit_expires_at: dateOrNull('bias_audit_expires_at'),
    ai_act_signed_off_at: dateOrNull('ai_act_signed_off_at'),
    dpia_covers_ranking_at: dateOrNull('dpia_covers_ranking_at'),
    bias_audit_ref: b.bias_audit_ref === undefined ? undefined : (text(b.bias_audit_ref, 200) || null),
    bias_audit_summary_url: b.bias_audit_summary_url === undefined ? undefined : (text(b.bias_audit_summary_url, 500) || null),
    enabled: b.enabled === undefined ? undefined : bool(b.enabled),
  };
  if (vals.bias_audit_summary_url && !/^https:\/\//.test(vals.bias_audit_summary_url)) fields.bias_audit_summary_url = 'Use an https link';
  if (Object.keys(fields).length) throw validation(fields);
  const isEu = EU_COUNTRIES.includes(market.slice(0, 2));
  const row = await tx(async (c) => {
    const { rows: [before] } = await c.query('SELECT * FROM career_ai_ranking_markets WHERE market = $1 FOR UPDATE', [market]);
    const merged = { ...(before || {}), ...Object.fromEntries(Object.entries(vals).filter(([, v]) => v !== undefined)) };
    if (merged.enabled) {
      const errs = {};
      if (!merged.bias_audit_passed_at || !merged.bias_audit_ref) errs.bias_audit_passed_at = 'Record the independent bias audit first';
      if (merged.bias_audit_expires_at && new Date(merged.bias_audit_expires_at) <= new Date()) errs.bias_audit_expires_at = 'The bias audit has expired';
      if (isEu && !merged.ai_act_signed_off_at) errs.ai_act_signed_off_at = 'EU markets need the AI Act sign-off';
      if (market.startsWith('GB') && !merged.dpia_covers_ranking_at) errs.dpia_covers_ranking_at = 'UK markets need a DPIA covering ranking';
      if (Object.keys(errs).length) throw new AppError('This market cannot be enabled yet', 409, 'ranking_gate_incomplete', errs);
    }
    const { rows: [saved] } = await c.query(
      `INSERT INTO career_ai_ranking_markets (market, is_eu, bias_audit_passed_at, bias_audit_expires_at, bias_audit_ref, bias_audit_summary_url,
                                              ai_act_signed_off_at, dpia_covers_ranking_at, enabled, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
       ON CONFLICT (market) DO UPDATE SET is_eu = EXCLUDED.is_eu, bias_audit_passed_at = EXCLUDED.bias_audit_passed_at,
         bias_audit_expires_at = EXCLUDED.bias_audit_expires_at, bias_audit_ref = EXCLUDED.bias_audit_ref,
         bias_audit_summary_url = EXCLUDED.bias_audit_summary_url, ai_act_signed_off_at = EXCLUDED.ai_act_signed_off_at,
         dpia_covers_ranking_at = EXCLUDED.dpia_covers_ranking_at, enabled = EXCLUDED.enabled,
         updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING *`,
      [market, isEu, merged.bias_audit_passed_at || null, merged.bias_audit_expires_at || null, merged.bias_audit_ref || null,
        merged.bias_audit_summary_url || null, merged.ai_act_signed_off_at || null, merged.dpia_covers_ranking_at || null, Boolean(merged.enabled), admin.id]
    );
    await adminAudit(req, c, { action: 'careers.ranking_market.updated', targetType: 'career_ai_ranking_market', targetId: market, before: before || null, after: saved });
    return saved;
  }, 'career_admin_market');
  res.json({ market: row });
});

/**
 * Clear an impact-ratio block after review. A reviewer must record what
 * they checked; ranking only resumes if the monthly check passes again.
 */
exports.reviewBlock = handle(async (req, res) => {
  const admin = requireUser(req);
  const note = text(req.body?.note, 1000);
  if (!note) throw validation({ note: 'Record what was reviewed' });
  const block = await tx(async (c) => {
    const { rows: [row] } = await c.query(
      `UPDATE career_ai_ranking_blocks SET reviewed_by = $2, reviewed_at = NOW() WHERE id = $1 AND reviewed_at IS NULL RETURNING *`,
      [Number(req.params.id), admin.id]
    );
    if (!row) throw new AppError('Block not found', 404, 'not_found');
    await adminAudit(req, c, { action: 'careers.ranking_block.reviewed', targetType: 'career_ai_ranking_block', targetId: row.id, after: { scope_type: row.scope_type, scope_ref: row.scope_ref, impact_ratio: row.impact_ratio, note } });
    return row;
  }, 'career_admin_block');
  res.json({ block });
});

exports.listFairnessReports = handle(async (req, res) => {
  const params = [];
  let where = 'TRUE';
  if (req.query.scope_type) { params.push(String(req.query.scope_type)); where += ` AND scope_type = $${params.length}`; }
  if (req.query.kind) { params.push(String(req.query.kind)); where += ` AND kind = $${params.length}`; }
  const { rows } = await pool.query(`SELECT * FROM career_fairness_reports WHERE ${where} ORDER BY generated_at DESC LIMIT 200`, params);
  res.json({ reports: rows });
});

exports.runFairness = handle(async (req, res) => {
  requireUser(req);
  const kind = req.body?.kind === 'quarterly' ? 'quarterly' : 'monthly_ranking';
  const end = parseDate(req.body?.period_end) || new Date();
  const start = parseDate(req.body?.period_start) || new Date(end.getTime() - (kind === 'quarterly' ? 91 : 30) * 86400000);
  if (start >= end) throw validation({ period_start: 'Start before the end' });
  const periodStart = start.toISOString().slice(0, 10);
  const periodEnd = end.toISOString().slice(0, 10);
  const result = kind === 'quarterly'
    ? await fairness.runQuarterlyReports({ periodStart, periodEnd })
    : await fairness.runRankingCheck({ periodStart, periodEnd });
  await adminAudit(req, null, { action: 'careers.fairness.run', targetType: 'career_fairness_report', targetId: null, after: { kind, periodStart, periodEnd, result } });
  res.json({ kind, period_start: periodStart, period_end: periodEnd, result });
});

exports.reviewFairnessReport = handle(async (req, res) => {
  const admin = requireUser(req);
  const { rows: [row] } = await pool.query(
    'UPDATE career_fairness_reports SET reviewed_by = $2, reviewed_at = NOW() WHERE id = $1 AND reviewed_at IS NULL RETURNING id, reviewed_at',
    [Number(req.params.id), admin.id]
  );
  if (!row) throw new AppError('Report not found', 404, 'not_found');
  await adminAudit(req, null, { action: 'careers.fairness.reviewed', targetType: 'career_fairness_report', targetId: row.id });
  res.json({ report: row });
});

// ── Employer-of-record markets (Q2) ──────────────────────────────────────────

exports.listEorMarkets = handle(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM career_eor_markets ORDER BY country, region');
  res.json({ markets: rows, provider_configured: require('../../services/careers/providers/eor').status().configured });
});

exports.upsertEorMarket = handle(async (req, res) => {
  const admin = requireUser(req);
  const country = normalizeCountry(req.body?.country);
  const region = String(req.body?.region || '').toUpperCase().slice(0, 6);
  const licenceRef = text(req.body?.licence_ref, 200);
  const fields = {};
  if (!country) fields.country = 'Use a two-letter country code';
  if (region && !/^[A-Z0-9]{1,6}$/.test(region)) fields.region = 'Use a region code';
  if (!licenceRef) fields.licence_ref = 'Record the licence or partner registration';
  if (Object.keys(fields).length) throw validation(fields);
  const row = await tx(async (c) => {
    const { rows: [saved] } = await c.query(
      `INSERT INTO career_eor_markets (country, region, licence_ref, approved_by, approved_at, revoked_at)
       VALUES ($1, $2, $3, $4, NOW(), NULL)
       ON CONFLICT (country, region) DO UPDATE SET licence_ref = EXCLUDED.licence_ref, approved_by = EXCLUDED.approved_by, approved_at = NOW(), revoked_at = NULL
       RETURNING *`,
      [country, region, licenceRef, admin.id]
    );
    await adminAudit(req, c, { action: 'careers.eor_market.approved', targetType: 'career_eor_market', targetId: `${country}-${region}`, after: saved });
    return saved;
  }, 'career_admin_eor');
  res.json({ market: row });
});

exports.revokeEorMarket = handle(async (req, res) => {
  const country = normalizeCountry(req.params.country);
  const region = String(req.params.region === '-' ? '' : (req.params.region || '')).toUpperCase();
  const row = await tx(async (c) => {
    const { rows: [r] } = await c.query('UPDATE career_eor_markets SET revoked_at = NOW() WHERE country = $1 AND region = $2 AND revoked_at IS NULL RETURNING *', [country, region]);
    if (!r) throw new AppError('Market not found', 404, 'not_found');
    await adminAudit(req, c, { action: 'careers.eor_market.revoked', targetType: 'career_eor_market', targetId: `${country}-${region}` });
    return r;
  }, 'career_admin_eor_revoke');
  res.json({ market: row });
});

// ── Retention (Q18) and pay-transparency rules ───────────────────────────────

exports.listRetentionRules = handle(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM career_retention_rules ORDER BY country, region NULLS FIRST, applies_to');
  res.json({ rules: rows });
});

exports.upsertRetentionRule = handle(async (req, res) => {
  const admin = requireUser(req);
  const country = normalizeCountry(req.body?.country);
  const region = req.body?.region ? String(req.body.region).toUpperCase().slice(0, 3) : null;
  const appliesTo = String(req.body?.applies_to || 'application');
  const months = Number(req.body?.keep_months);
  const source = text(req.body?.legal_source, 500);
  const fields = {};
  if (!country) fields.country = 'Use a two-letter country code';
  if (!['application', 'eeo', 'ai_run', 'background_check'].includes(appliesTo)) fields.applies_to = 'Pick what the rule covers';
  if (!Number.isInteger(months) || months < 1 || months > 120) fields.keep_months = '1 to 120 months';
  // US federal floor (29 CFR 1602.14) is one year; EU/UK stays at 12 (Q18).
  if (country === 'US' && months < 12) fields.keep_months = 'US rules cannot go below the 12-month federal floor';
  if (!source) fields.legal_source = 'Cite the law or counsel memo';
  if (Object.keys(fields).length) throw validation(fields);
  const row = await tx(async (c) => {
    const { rows: [before] } = await c.query(
      `SELECT * FROM career_retention_rules WHERE country = $1 AND COALESCE(region, '') = COALESCE($2, '') AND applies_to = $3 FOR UPDATE`,
      [country, region, appliesTo]
    );
    let saved;
    if (before) {
      ({ rows: [saved] } = await c.query(
        `UPDATE career_retention_rules SET keep_months = $2, legal_source = $3, updated_by = $4, updated_at = NOW(),
                reviewed_by = CASE WHEN $5 THEN $4 ELSE reviewed_by END, reviewed_at = CASE WHEN $5 THEN NOW() ELSE reviewed_at END
          WHERE id = $1 RETURNING *`,
        [before.id, months, source, admin.id, bool(req.body?.legal_reviewed)]
      ));
    } else {
      ({ rows: [saved] } = await c.query(
        `INSERT INTO career_retention_rules (country, region, applies_to, keep_months, legal_source, updated_by, reviewed_by, reviewed_at)
         VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7 THEN $6::uuid END, CASE WHEN $7 THEN NOW() END) RETURNING *`,
        [country, region, appliesTo, months, source, admin.id, bool(req.body?.legal_reviewed)]
      ));
    }
    await adminAudit(req, c, { action: 'careers.retention_rule.saved', targetType: 'career_retention_rule', targetId: saved.id, before: before || null, after: saved });
    return saved;
  }, 'career_admin_retention');
  res.json({ rule: row });
});

exports.listPayRules = handle(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM career_pay_rules ORDER BY code');
  res.json({ rules: rows });
});

const PAY_RULE_FLAGS = ['pay_range_required', 'benefits_required', 'close_date_required', 'pay_history_banned', 'gender_neutral_titles', 'internal_promotion_notice'];

exports.upsertPayRule = handle(async (req, res) => {
  const admin = requireUser(req);
  const code = String(req.params.code || '').toUpperCase();
  const b = req.body || {};
  const fields = {};
  if (!/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(code)) fields.code = 'Use a code like US-CO or DE';
  const legalRef = text(b.legal_ref, 500);
  if (!legalRef) fields.legal_ref = 'Cite the law';
  const minEmployees = b.min_employees == null || b.min_employees === '' ? null : Number(b.min_employees);
  if (minEmployees != null && (!Number.isInteger(minEmployees) || minEmployees < 1 || minEmployees > 10000)) fields.min_employees = '1 to 10000';
  const inForce = b.in_force_from ? parseDate(b.in_force_from) : null;
  if (b.in_force_from && !inForce) fields.in_force_from = 'Use a date';
  if (Object.keys(fields).length) throw validation(fields);
  const flags = PAY_RULE_FLAGS.map((k) => (b[k] === undefined ? null : bool(b[k])));
  const row = await tx(async (c) => {
    const { rows: [before] } = await c.query('SELECT * FROM career_pay_rules WHERE code = $1 FOR UPDATE', [code]);
    const { rows: [saved] } = await c.query(
      `INSERT INTO career_pay_rules (code, ${PAY_RULE_FLAGS.join(', ')}, min_employees, in_force_from, legal_ref, updated_by, updated_at, reviewed_by, reviewed_at)
       VALUES ($1, ${PAY_RULE_FLAGS.map((_, i) => `COALESCE($${i + 2}, ${['pay_range_required', 'pay_history_banned'].includes(PAY_RULE_FLAGS[i]) ? 'TRUE' : 'FALSE'})`).join(', ')},
               $8, $9, $10, $11, NOW(), CASE WHEN $12 THEN $11::uuid END, CASE WHEN $12 THEN NOW() END)
       ON CONFLICT (code) DO UPDATE SET
         ${PAY_RULE_FLAGS.map((k, i) => `${k} = COALESCE($${i + 2}, career_pay_rules.${k})`).join(', ')},
         min_employees = EXCLUDED.min_employees, in_force_from = EXCLUDED.in_force_from, legal_ref = EXCLUDED.legal_ref,
         updated_by = EXCLUDED.updated_by, updated_at = NOW(),
         reviewed_by = CASE WHEN $12 THEN EXCLUDED.updated_by ELSE career_pay_rules.reviewed_by END,
         reviewed_at = CASE WHEN $12 THEN NOW() ELSE career_pay_rules.reviewed_at END
       RETURNING *`,
      [code, ...flags, minEmployees, inForce ? inForce.toISOString().slice(0, 10) : null, legalRef, admin.id, bool(b.legal_reviewed)]
    );
    await adminAudit(req, c, { action: 'careers.pay_rule.saved', targetType: 'career_pay_rule', targetId: code, before: before || null, after: saved });
    return saved;
  }, 'career_admin_pay_rule');
  res.json({ rule: row });
});
