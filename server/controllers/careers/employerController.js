'use strict';

// Employer endpoints (careers spec §7 "Employer"). Business hiring goes
// through Q17 access (brand, region, store) and the rank guard (C-01);
// OxSteed HR uses the same endpoints for platform openings with the
// manage_hiring admin grant (C-17).

const { AppError } = require('../../middleware/errorHandler');
const {
  handle, tx, pool, requireUser, businessIdFrom, businessAccess, openingWithAccess,
  applicationWithAccess, offerWithAccess, audit, canManagePlatformHiring,
} = require('./common');
const { checkOpeningWithRules } = require('../../services/careers/compliance');
const { parseOpening } = require('../../services/careers/validation');
const openingsSvc = require('../../services/careers/openings');
const applications = require('../../services/careers/applications');
const offers = require('../../services/careers/offers');
const onboarding = require('../../services/careers/onboardingRun');
const checks = require('../../services/careers/backgroundChecks');
const talent = require('../../services/careers/talent');
const settingsSvc = require('../../services/careers/settings');
const billing = require('../../services/careers/billing');
const reports = require('../../services/careers/reports');
const profileSvc = require('../../services/careers/profile');
const { rankApplicants, checklistFor } = require('../../services/careers/ranking');
const { factsForViewer } = require('../../services/careers/profileFacts');
const { logAccess } = require('../../services/careers/shareLedger');
const { extractOpeningRequirements } = require('../../services/careers/extract');
const storage = require('../../utils/storage');

const PLATFORM = 'platform';

async function platformAccess(req) {
  const user = requireUser(req);
  if (!(await canManagePlatformHiring(user))) throw new AppError('Not found', 404, 'not_found');
  return { kind: 'platform', isOwner: false, role: 'platform', canApproveAboveRange: true, scope: { mode: 'business' } };
}

const isPlatformRequest = (req) => (req.query.employer || req.body?.employer_type) === PLATFORM;

function scopeFilter(access, params) {
  if (access.kind === 'platform' || access.isOwner || ['business', 'brand'].includes(access.scope?.mode)) return '';
  params.push(access.scope.locationIds || []);
  return ` AND (cardinality(o.location_ids) = 0 OR o.location_ids && $${params.length}::bigint[])`;
}

// ── Openings ─────────────────────────────────────────────────────────────────

exports.listOpenings = handle(async (req, res) => {
  const platform = isPlatformRequest(req);
  const access = platform ? await platformAccess(req) : await businessAccess(req);
  const params = [];
  let where;
  if (platform) where = `o.employer_type = 'platform'`;
  else { params.push(access.businessId); where = `o.business_id = $1`; }
  where += scopeFilter(access, params);
  if (req.query.status) { params.push(String(req.query.status)); where += ` AND o.status = $${params.length}`; }
  const { rows } = await pool.query(
    `SELECT o.*,
            (SELECT json_object_agg(stage, n) FROM (SELECT stage, COUNT(*)::int AS n FROM career_applications a WHERE a.opening_id = o.id GROUP BY stage) s) AS stage_counts,
            (SELECT COUNT(*)::int FROM career_offers co JOIN career_applications a ON a.id = co.application_id
              WHERE a.opening_id = o.id AND co.status = 'pending' AND co.expires_at < NOW() + INTERVAL '24 hours') AS offers_expiring,
            (SELECT COUNT(*)::int FROM career_onboarding_runs r JOIN career_applications a ON a.id = r.application_id
              WHERE a.opening_id = o.id AND r.status IN ('needs_action','failed')) AS onboarding_attention
       FROM career_openings o
      WHERE ${where}
      ORDER BY o.updated_at DESC LIMIT 200`,
    params
  );
  res.json({
    openings: rows,
    locations: platform ? [] : await storesInScope(access),
    access: { kind: access.kind, role: access.role, is_owner: Boolean(access.isOwner), scope: access.scope, can_approve_above_range: access.canApproveAboveRange },
  });
});

// The business's stores the caller may hire for (store pickers, talent search).
async function storesInScope(access) {
  const params = [access.businessId];
  let filter = '';
  if (!(access.isOwner || ['business', 'brand'].includes(access.scope?.mode))) {
    params.push(access.scope?.locationIds || []);
    filter = ' AND l.id = ANY($2::bigint[])';
  }
  const { rows } = await pool.query(
    `SELECT l.id, l.name, l.address_city AS city, l.region_id, l.timezone
       FROM restaurant_locations l JOIN food_restaurants fr ON fr.id = l.restaurant_id
      WHERE fr.business_id = $1 AND l.status <> 'closed'${filter}
      ORDER BY l.name`,
    params
  );
  return rows;
}

exports.getOpening = handle(async (req, res) => {
  const { opening, access } = await openingWithAccess(pool, req, req.params.id, { write: false });
  const compliance = await checkOpeningWithRules(pool, opening);
  res.json({ opening, compliance, access: { kind: access.kind, can_approve_above_range: access.canApproveAboveRange } });
});

async function maybeExtract(opening, actorId) {
  // Suggestions only; the employer confirms requirement_tags themselves.
  const r = await extractOpeningRequirements(pool, opening, { actorId }).catch(() => ({ available: false }));
  return r.available ? r.suggestions : null;
}

exports.createOpening = handle(async (req, res) => {
  const user = requireUser(req);
  const platform = isPlatformRequest(req);
  const access = platform ? await platformAccess(req) : await businessAccess(req);
  const businessId = platform ? null : access.businessId;
  const result = await tx(async (c) => {
    const saved = await openingsSvc.saveOpening(c, {
      access, user, body: req.body || {}, employerType: platform ? 'platform' : 'business', businessId,
    });
    await audit(req, access, { action: 'careers.opening.created', targetType: 'career_opening', targetId: saved.opening.id, after: { status: saved.opening.status, title: saved.opening.title }, client: c });
    return saved;
  }, 'career_opening_create');
  res.status(201).json({ ...result, requirement_suggestions: await maybeExtract(result.opening, user.id) });
});

exports.updateOpening = handle(async (req, res) => {
  const user = requireUser(req);
  const result = await tx(async (c) => {
    const { opening, access } = await openingWithAccess(c, req, req.params.id, { write: true, lock: true });
    const saved = await openingsSvc.saveOpening(c, {
      access, user, body: req.body || {}, existing: opening, employerType: opening.employer_type, businessId: opening.business_id,
    });
    await audit(req, access, {
      action: 'careers.opening.updated', targetType: 'career_opening', targetId: opening.id,
      before: { status: opening.status }, after: { status: saved.opening.status }, businessId: opening.business_id, client: c,
    });
    return saved;
  }, 'career_opening_update');
  res.json(result);
});

// Run the pay-transparency checks on a draft without saving (§7, §12.3).
exports.checkOpening = handle(async (req, res) => {
  let existing = null;
  if (req.params.id) ({ opening: existing } = await openingWithAccess(pool, req, req.params.id, { write: false }));
  else if (!isPlatformRequest(req)) await businessAccess(req);
  else await platformAccess(req);
  const employerType = existing ? existing.employer_type : (isPlatformRequest(req) ? 'platform' : 'business');
  const { value, errors } = parseOpening(req.body || {}, { existing, employerType });
  const compliance = await checkOpeningWithRules(pool, { ...(existing || {}), ...value });
  res.json({ compliance, field_errors: errors.fields || {} });
});

// ── Applications ─────────────────────────────────────────────────────────────

exports.listApplications = handle(async (req, res) => {
  const user = requireUser(req);
  const { opening, access } = await openingWithAccess(pool, req, req.params.id, { write: false });
  const params = [opening.id];
  let where = 'a.opening_id = $1';
  if (req.query.stage) { params.push(String(req.query.stage)); where += ` AND a.stage = $${params.length}`; }
  const sort = ['applied', 'distance', 'ai'].includes(req.query.sort) ? req.query.sort : 'applied';
  const { rows } = await pool.query(
    `SELECT a.*, o.hide_identity_until_offer, o.location_ids AS opening_location_ids, o.employer_type, o.business_id
       FROM career_applications a JOIN career_openings o ON o.id = a.opening_id
      WHERE ${where} ORDER BY a.created_at ASC, a.id ASC LIMIT 1000`,
    params
  );
  const visible = rows.filter((a) => applications.applicationInScope(access, a));
  let ordered = visible;
  let ranking = { mode: 'neutral', reason: null };
  if (sort === 'distance' && opening.location_ids?.length) {
    // Distance to the applicant's nearest preferred store is unknown
    // without their address, so distance = preferred store in scope first.
    ordered = [...visible].sort((x, y) => (y.preferred_location_ids?.length ? 1 : 0) - (x.preferred_location_ids?.length ? 1 : 0));
  } else if (sort === 'ai') {
    const active = visible.filter((a) => ['received', 'screening', 'interview', 'assessment'].includes(a.stage) && !a.is_guest);
    ranking = await rankApplicants(pool, opening, active, { actorId: user.id });
    if (ranking.mode === 'ai') {
      const pos = new Map(ranking.order.map((r) => [r.application_id, r]));
      ordered = [...visible].sort((x, y) => (pos.get(Number(x.id))?.position ?? 1e9) - (pos.get(Number(y.id))?.position ?? 1e9));
    }
  }
  const reasonsById = ranking.mode === 'ai' ? new Map(ranking.order.map((r) => [r.application_id, r.reasons])) : new Map();
  const cards = ordered.map((a) => ({
    ...applications.presentForEmployer(a, { checklist: checklistFor(opening, a) }),
    // Reasons, never a bare score (§4.4 step 2).
    ai_reasons: reasonsById.get(Number(a.id)) || null,
  }));
  for (const a of ordered) {
    if (a.user_id) await logAccess(pool, { viewerUserId: user.id, businessId: opening.business_id, subjectUserId: a.user_id, context: 'application', applicationId: a.id, factTypes: (a.profile_snapshot?.facts || []).map((f) => f.fact_type) });
  }
  res.json({ applications: cards, sort, ranking: { mode: ranking.mode, reason: ranking.reason || null } });
});

exports.getApplication = handle(async (req, res) => {
  const user = requireUser(req);
  const { app, access } = await applicationWithAccess(pool, req, req.params.id, { write: false });
  const [{ rows: events }, { rows: interviews }, { rows: offerRows }] = await Promise.all([
    pool.query('SELECT from_stage, to_stage, reason_code, metadata, created_at FROM career_application_events WHERE application_id = $1 ORDER BY id', [app.id]),
    pool.query('SELECT * FROM career_interviews WHERE application_id = $1 ORDER BY scheduled_at', [app.id]),
    pool.query('SELECT * FROM career_offers WHERE application_id = $1 ORDER BY id DESC', [app.id]),
  ]);
  const opening = (await pool.query('SELECT * FROM career_openings WHERE id = $1', [app.opening_id])).rows[0];
  const card = applications.presentForEmployer(app, { checklist: checklistFor(opening, app), interviews, offers: offerRows, events });
  // Employer-only facts (rehire eligibility from this business's records,
  // and the status of a check this business ordered), §9.1.
  if (app.user_id && access.kind === 'business') {
    card.employer_facts = (await factsForViewer(pool, app.user_id, { businessId: access.businessId })).employerFacts;
    card.background_check = await checks.statusForApplication(pool, { applicationId: app.id, businessId: access.businessId });
    await logAccess(pool, { viewerUserId: user.id, businessId: access.businessId, subjectUserId: app.user_id, context: 'application', applicationId: app.id, factTypes: (app.profile_snapshot?.facts || []).map((f) => f.fact_type) });
  }
  const { rows: [run] } = await pool.query('SELECT id, status FROM career_onboarding_runs WHERE application_id = $1', [app.id]);
  card.onboarding_run = run || null;
  res.json({ application: card });
});

exports.resume = handle(async (req, res) => {
  const user = requireUser(req);
  const { app, access } = await applicationWithAccess(pool, req, req.params.id, { write: false });
  res.json(await profileSvc.applicationResumeUrl(pool, { app, viewer: user, businessId: access.businessId || null, signImpl: storage.getSignedDownloadUrl }));
});

exports.changeStage = handle(async (req, res) => {
  const user = requireUser(req);
  const toStage = String(req.body?.stage || req.body?.to_stage || '');
  const updated = await tx(async (c) => {
    const { app, access } = await applicationWithAccess(c, req, req.params.id, { write: true, lock: true });
    const row = await applications.changeStage(c, { app, actor: user, toStage, body: req.body || {} });
    await audit(req, access, { action: 'careers.application.stage', targetType: 'career_application', targetId: app.id, before: { stage: app.stage }, after: { stage: row.stage, reason_code: row.rejection_reason_code }, businessId: app.business_id, client: c });
    return row;
  }, 'career_stage');
  res.json({ application: { id: updated.id, stage: updated.stage, rejection_reason_code: updated.rejection_reason_code } });
});

exports.bulkStage = handle(async (req, res) => {
  const user = requireUser(req);
  const access = await businessAccess(req);
  const result = await tx(async (c) => {
    const r = await billing.bulkMove(c, {
      access, actor: user, applicationIds: req.body?.application_ids, toStage: String(req.body?.stage || ''),
      isInScope: (a) => applications.applicationInScope(access, a),
    });
    await audit(req, access, { action: 'careers.application.bulk_stage', targetType: 'career_application', targetId: null, metadata: { moved: r.moved, stage: req.body?.stage }, client: c });
    return r;
  }, 'career_bulk_stage');
  res.json(result);
});

exports.scheduleInterview = handle(async (req, res) => {
  const user = requireUser(req);
  const result = await tx(async (c) => {
    const { app, access } = await applicationWithAccess(c, req, req.params.id, { write: true, lock: true });
    const slot = req.body?.slot_id ? await billing.lockSlot(c, { slotId: Number(req.body.slot_id), businessId: app.business_id }) : null;
    const r = await applications.scheduleInterview(c, { app, actor: user, body: req.body || {}, slot });
    await audit(req, access, { action: 'careers.interview.scheduled', targetType: 'career_interview', targetId: r.interview.id, after: { scheduled_at: r.interview.scheduled_at, mode: r.interview.mode }, businessId: app.business_id, client: c });
    return r;
  }, 'career_interview');
  res.status(201).json({ interview: result.interview, ics: result.ics });
});

exports.cancelInterview = handle(async (req, res) => {
  const user = requireUser(req);
  const interview = await tx(async (c) => {
    const { app, access } = await applicationWithAccess(c, req, req.params.id, { write: true, lock: true });
    const row = await applications.cancelInterview(c, { app, actor: user, interviewId: Number(req.params.interviewId) });
    await audit(req, access, { action: 'careers.interview.cancelled', targetType: 'career_interview', targetId: row.id, businessId: app.business_id, client: c });
    return row;
  }, 'career_interview_cancel');
  res.json({ interview });
});

// ── Offers ───────────────────────────────────────────────────────────────────

exports.createOffer = handle(async (req, res) => {
  const user = requireUser(req);
  const offer = await tx(async (c) => {
    const { app, access } = await applicationWithAccess(c, req, req.params.id, { write: true, lock: true });
    const settings = app.business_id ? await settingsSvc.getSettings(c, app.business_id) : null;
    const row = await offers.createOffer(c, { app, access, actor: user, body: req.body || {}, settings });
    await audit(req, access, { action: 'careers.offer.created', targetType: 'career_offer', targetId: row.id, after: { status: row.status, pay_cents: Number(row.pay_cents), pay_period: row.pay_period, above_range: row.above_range }, businessId: app.business_id, client: c });
    return row;
  }, 'career_offer_create');
  res.status(201).json({ offer });
});

exports.approveAboveRange = handle(async (req, res) => {
  const user = requireUser(req);
  const offer = await tx(async (c) => {
    const { offer: row, app, access } = await offerWithAccess(c, req, req.params.id);
    const updated = await offers.approveAboveRange(c, { offer: row, app, access, actor: user });
    await audit(req, access, { action: 'careers.offer.above_range_approved', targetType: 'career_offer', targetId: row.id, after: { pay_cents: Number(row.pay_cents) }, businessId: app.business_id, client: c });
    return updated;
  }, 'career_offer_approve');
  res.json({ offer });
});

exports.withdrawOffer = handle(async (req, res) => {
  const user = requireUser(req);
  const offer = await tx(async (c) => {
    const { offer: row, app, access } = await offerWithAccess(c, req, req.params.id);
    const updated = await offers.withdrawOffer(c, { offer: row, app, actor: user });
    await audit(req, access, { action: 'careers.offer.withdrawn', targetType: 'career_offer', targetId: row.id, businessId: app.business_id, client: c });
    return updated;
  }, 'career_offer_withdraw');
  res.json({ offer: { id: offer.id, status: offer.status } });
});

exports.requestBackgroundCheck = handle(async (req, res) => {
  const user = requireUser(req);
  const check = await tx(async (c) => {
    const { app, access } = await applicationWithAccess(c, req, req.params.id, { write: true, lock: true });
    const settings = app.business_id ? (await c.query('SELECT * FROM career_business_settings WHERE business_id = $1', [app.business_id])).rows[0] : null;
    const row = await checks.requestCheck(c, { app, actor: user, settings });
    await audit(req, access, { action: 'careers.background_check.requested', targetType: 'career_background_check', targetId: row.id, after: { package: row.package }, businessId: app.business_id, client: c });
    return row;
  }, 'career_background_check');
  res.status(201).json({ background_check: check });
});

// ── Talent and invitations ───────────────────────────────────────────────────

exports.talent = handle(async (req, res) => {
  const user = requireUser(req);
  const access = await businessAccess(req);
  res.json(await talent.talentYouKnow(pool, { access, viewer: user, limit: req.query.limit, offset: req.query.offset }));
});

exports.talentSearch = handle(async (req, res) => {
  const user = requireUser(req);
  const access = await businessAccess(req);
  res.json(await tx((c) => talent.searchWorkers(c, { access, viewer: user, query: req.query || {} }), 'career_talent_search'));
});

exports.invite = handle(async (req, res) => {
  const user = requireUser(req);
  const access = await businessAccess(req);
  const result = await tx(async (c) => {
    const r = await talent.sendInvitation(c, { access, actor: user, body: req.body || {} });
    await audit(req, access, { action: 'careers.invitation.sent', targetType: 'career_invitation', targetId: r.invitation.id, after: { opening_id: r.invitation.opening_id, reason_code: r.invitation.reason_code, permissible_purpose_certified: true }, client: c });
    return r;
  }, 'career_invite');
  res.status(201).json({ invitation: { id: result.invitation.id, status: result.invitation.status, expires_at: result.invitation.expires_at }, usage: result.usage });
});

// ── Settings, scopes, billing ────────────────────────────────────────────────

exports.getSettings = handle(async (req, res) => {
  const access = await businessAccess(req);
  res.json({ settings: await settingsSvc.getSettings(pool, access.businessId) });
});

exports.updateSettings = handle(async (req, res) => {
  const user = requireUser(req);
  const access = await businessAccess(req);
  const result = await tx(async (c) => {
    const r = await settingsSvc.updateSettings(c, { access, actor: user, body: req.body || {} });
    await audit(req, access, { action: 'careers.settings.updated', targetType: 'career_business_settings', targetId: access.businessId, metadata: { changed: r.changed, checkr_token_changed: r.checkrTokenChanged }, client: c });
    return r;
  }, 'career_settings');
  res.json({ settings: result.settings });
});

exports.listScopes = handle(async (req, res) => {
  const access = await businessAccess(req);
  const { rows } = await pool.query(
    `SELECT s.id, s.membership_id, s.scope_level, s.region_id, s.created_at, bm.member_id, u.first_name, u.last_name, bm.role
       FROM career_hiring_scopes s JOIN business_members bm ON bm.id = s.membership_id
       LEFT JOIN users u ON u.id = bm.member_id
      WHERE s.business_id = $1 AND s.revoked_at IS NULL ORDER BY s.created_at`,
    [access.businessId]
  );
  // Pickers for the owner's grant form: active managers and the regions.
  const [{ rows: managers }, { rows: regions }] = await Promise.all([
    pool.query(
      `SELECT bm.id AS membership_id, u.first_name, u.last_name FROM business_members bm LEFT JOIN users u ON u.id = bm.member_id
        WHERE bm.business_id = $1 AND bm.status = 'active' AND bm.role = 'manager' ORDER BY u.last_name, u.first_name`,
      [access.businessId]
    ),
    pool.query(
      `SELECT rr.id, rr.name FROM restaurant_regions rr JOIN food_restaurants fr ON fr.id = rr.restaurant_id
        WHERE fr.business_id = $1 ORDER BY rr.name`,
      [access.businessId]
    ),
  ]);
  res.json({ scopes: rows, managers, regions, is_owner: Boolean(access.isOwner) });
});

// Only the owner grants brand-admin or regional-manager hiring scope (Q17).
exports.grantScope = handle(async (req, res) => {
  const user = requireUser(req);
  const access = await businessAccess(req);
  if (!access.isOwner) throw new AppError('Only the owner can grant hiring scopes', 403, 'scope_forbidden');
  const level = String(req.body?.scope_level || '');
  const membershipId = Number(req.body?.membership_id);
  const regionId = req.body?.region_id == null || req.body.region_id === '' ? null : Number(req.body.region_id);
  const fields = {};
  if (!['brand', 'region'].includes(level)) fields.scope_level = 'Choose brand or region';
  if (!Number.isInteger(membershipId)) fields.membership_id = 'Pick a manager';
  if (level === 'region' && !Number.isInteger(regionId)) fields.region_id = 'Pick a region';
  if (Object.keys(fields).length) throw new AppError('Validation failed', 400, 'validation_failed', fields);
  const scope = await tx(async (c) => {
    const { rows: [m] } = await c.query(`SELECT id FROM business_members WHERE id = $1 AND business_id = $2 AND status = 'active' AND role = 'manager'`, [membershipId, access.businessId]);
    if (!m) throw new AppError('Manager not found', 404, 'not_found');
    if (level === 'region') {
      const { rows: [r] } = await c.query('SELECT rr.id FROM restaurant_regions rr JOIN food_restaurants fr ON fr.id = rr.restaurant_id WHERE rr.id = $1 AND fr.business_id = $2', [regionId, access.businessId]);
      if (!r) throw new AppError('Region not found', 404, 'not_found');
    }
    const { rows: [row] } = await c.query(
      `INSERT INTO career_hiring_scopes (business_id, membership_id, scope_level, region_id, granted_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING RETURNING *`,
      [access.businessId, membershipId, level, level === 'region' ? regionId : null, user.id]
    );
    if (!row) throw new AppError('That manager already has this hiring scope', 409, 'scope_exists');
    await audit(req, access, { action: 'careers.hiring_scope.granted', targetType: 'career_hiring_scope', targetId: row.id, after: { membership_id: membershipId, scope_level: level, region_id: row.region_id }, client: c });
    return row;
  }, 'career_scope_grant');
  res.status(201).json({ scope });
});

exports.revokeScope = handle(async (req, res) => {
  const access = await businessAccess(req);
  if (!access.isOwner) throw new AppError('Only the owner can change hiring scopes', 403, 'scope_forbidden');
  const row = await tx(async (c) => {
    const { rows: [r] } = await c.query(`UPDATE career_hiring_scopes SET revoked_at = NOW() WHERE id = $1 AND business_id = $2 AND revoked_at IS NULL RETURNING *`, [Number(req.params.scopeId), access.businessId]);
    if (!r) throw new AppError('Scope not found', 404, 'not_found');
    await audit(req, access, { action: 'careers.hiring_scope.revoked', targetType: 'career_hiring_scope', targetId: r.id, client: c });
    return r;
  }, 'career_scope_revoke');
  res.json({ scope: { id: row.id, revoked_at: row.revoked_at } });
});

exports.createBoost = handle(async (req, res) => {
  const user = requireUser(req);
  const access = await businessAccess(req);
  const result = await tx(async (c) => {
    const r = await billing.createBoost(c, { access, actor: user, body: req.body || {}, idempotencyKey: req.get('Idempotency-Key') || req.body?.idempotency_key });
    await audit(req, access, { action: 'careers.boost.checkout', targetType: 'career_boost', targetId: r.boost.id, after: { plan: r.boost.plan, opening_id: r.boost.opening_id }, client: c });
    return r;
  }, 'career_boost');
  res.status(result.replayed ? 200 : 201).json({ boost: result.boost, checkout_url: result.checkoutUrl || null });
});

exports.createHiringEvent = handle(async (req, res) => {
  const user = requireUser(req);
  const access = await businessAccess(req);
  const result = await tx(async (c) => {
    const r = await billing.createHiringEvent(c, { access, actor: user, body: req.body || {} });
    await audit(req, access, { action: 'careers.hiring_event.checkout', targetType: 'career_hiring_event', targetId: r.hiringEvent.id, after: { name: r.hiringEvent.name }, client: c });
    return r;
  }, 'career_hiring_event');
  res.status(201).json({ hiring_event: result.hiringEvent, checkout_url: result.checkoutUrl });
});

exports.listPaid = handle(async (req, res) => {
  const access = await businessAccess(req);
  const [{ rows: boosts }, { rows: events }] = await Promise.all([
    pool.query('SELECT id, opening_id, plan, starts_at, ends_at, price_cents, currency, status, created_at FROM career_boosts WHERE business_id = $1 ORDER BY id DESC LIMIT 100', [access.businessId]),
    pool.query('SELECT id, name, location_ids, opening_ids, starts_at, ends_at, price_cents, currency, status, created_at FROM career_hiring_events WHERE business_id = $1 ORDER BY id DESC LIMIT 100', [access.businessId]),
  ]);
  res.json({ boosts, hiring_events: events });
});

exports.createSlots = handle(async (req, res) => {
  const access = await businessAccess(req);
  const slots = await tx((c) => billing.createInterviewSlots(c, { access, hiringEventId: Number(req.params.id), body: req.body || {} }), 'career_slots');
  res.status(201).json({ slots });
});

// ── Onboarding and reports ───────────────────────────────────────────────────

async function runWithAccess(req, { write }) {
  const run = await onboarding.loadRun(pool, req.params.runId);
  const user = requireUser(req);
  const { requireHiringAccess, locationsInScope } = require('../../services/careers/access');
  const access = { kind: 'business', ...(await requireHiringAccess(user, run.business_id)) };
  if (run.location_id && !locationsInScope(access, [run.location_id])) throw new AppError('Onboarding run not found', 404, 'not_found');
  if (write && !access.canHire) throw new AppError('Onboarding run not found', 404, 'not_found');
  return { run, access };
}

exports.getOnboarding = handle(async (req, res) => {
  const { run } = await runWithAccess(req, { write: false });
  res.json({ run });
});

exports.retryOnboarding = handle(async (req, res) => {
  const { run, access } = await runWithAccess(req, { write: true });
  const updated = await onboarding.retryStep(run.id, { step: String(req.params.step) });
  await audit(req, access, { action: 'careers.onboarding.retry', targetType: 'career_onboarding_run', targetId: run.id, metadata: { step: req.params.step } });
  res.json({ run: updated });
});

exports.completeOnboardingStep = handle(async (req, res) => {
  const user = requireUser(req);
  const { run, access } = await runWithAccess(req, { write: true });
  const updated = await onboarding.completeManualStep(run.id, { step: String(req.params.step), actor: user });
  await audit(req, access, { action: 'careers.onboarding.step_completed', targetType: 'career_onboarding_run', targetId: run.id, metadata: { step: req.params.step } });
  res.json({ run: updated });
});

exports.reports = handle(async (req, res) => {
  const access = await businessAccess(req);
  const since = req.query.since && !Number.isNaN(new Date(req.query.since).getTime()) ? new Date(req.query.since).toISOString() : null;
  res.json(await reports.hiringReport(pool, { access, since }));
});

exports._businessIdFrom = businessIdFrom;
