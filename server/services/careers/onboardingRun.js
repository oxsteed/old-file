'use strict';

// The onboarding run (careers spec §4.6, §6.8): accepting an offer turns
// into team operations. Every step is idempotent and committed on its own,
// so a retry only redoes what didn't finish. Manager and new hire both see
// each step's status.

const bcrypt = require('bcrypt');
const pool = require('../../db');
const { AppError } = require('../../middleware/errorHandler');
const { withTransaction } = require('../../utils/transaction');
const { logBusinessAction } = require('../businessAuditLog');
const { staffPinDigest } = require('../restaurantStaffIdentityService');
const { applyAutoAssignRules, notifyTrainingAssigned } = require('../restaurantTrainingLifecycle');
const teamMembership = require('../team/membership');
const { resolveHiringAccess } = require('./access');
const { isAdultConfirmed } = require('./ageGate');
const eorProvider = require('./providers/eor');
const { notifyUser, notifyHiringTeam } = require('./notify');

const STEPS = Object.freeze([
  'membership', 'location', 'pin', 'training', 'documents', 'age_confirmed',
  'eor_enrollment', 'first_shift', 'payroll_handoff', 'notify',
]);
// Steps a manager may mark complete by hand (work done outside OxSteed).
const MANUAL_STEPS = Object.freeze(['documents', 'payroll_handoff']);
const SETTLED = new Set(['done', 'skipped']);

// business_members.pay_rate_period uses hour/week/month/year.
const MEMBER_PERIOD = { hourly: 'hour', monthly: 'month', yearly: 'year' };

function employmentBasisFor(pathStage) {
  if (pathStage === 'seasonal') return 'seasonal';
  if (pathStage === 'shift' || pathStage === 'temporary') return 'temporary';
  return 'regular';
}

/** Create the run and its pending steps inside the hire transaction. */
async function startRun(db, { app, offer }) {
  const { rows: [created] } = await db.query(
    `INSERT INTO career_onboarding_runs (application_id, offer_id, business_id, user_id, acting_user_id, status)
     VALUES ($1, $2, $3, $4, $5, 'running')
     ON CONFLICT (application_id) DO NOTHING
     RETURNING *`,
    [app.id, offer.id, app.business_id, app.user_id, offer.created_by]
  );
  const run = created || (await db.query('SELECT * FROM career_onboarding_runs WHERE application_id = $1', [app.id])).rows[0];
  await db.query(
    `INSERT INTO career_onboarding_steps (run_id, step, status)
     SELECT $1, s, 'pending' FROM unnest($2::text[]) AS s
     ON CONFLICT (run_id, step) DO NOTHING`,
    [run.id, STEPS]
  );
  return run;
}

async function loadContext(db, runId) {
  const { rows: [ctx] } = await db.query(
    `SELECT r.*, of.id AS offer_id, of.team_role, of.job_role_code, of.pay_cents, of.pay_period, of.location_id,
            of.first_shift, of.employer_model, of.start_date, of.created_by AS offer_created_by, of.title AS offer_title,
            a.opening_id, o.path_stage, o.required_credentials, o.title AS opening_title, o.country_code, o.region, o.city,
            b.user_id AS owner_id, b.business_name, u.email, u.first_name, u.last_name,
            fr.id AS restaurant_id, l.name AS location_name, l.address_state AS location_state, l.address_country AS location_country
       FROM career_onboarding_runs r
       JOIN career_offers of ON of.id = r.offer_id
       JOIN career_applications a ON a.id = r.application_id
       JOIN career_openings o ON o.id = a.opening_id
       JOIN businesses b ON b.id = r.business_id
       JOIN users u ON u.id = r.user_id
       LEFT JOIN restaurant_locations l ON l.id = of.location_id
       LEFT JOIN food_restaurants fr ON fr.id = COALESCE(l.restaurant_id, (SELECT id FROM food_restaurants WHERE business_id = r.business_id ORDER BY id LIMIT 1))
      WHERE r.id = $1`,
    [runId]
  );
  if (!ctx) throw new AppError('Onboarding run not found', 404, 'not_found');
  return ctx;
}

function stepError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// ── Steps ────────────────────────────────────────────────────────────────────
// Each returns { status, detail }. Throwing marks the step failed.

const handlers = {
  // 1–3. Rank and permission re-check as the offer's creator, rehire
  // rules, membership with role preset and pay.
  async membership(db, ctx) {
    const actor = { id: ctx.offer_created_by };
    const access = await resolveHiringAccess(actor, ctx.business_id, { db });
    if (!access || !access.canHire) throw stepError('acting_user_lost_access', 'The person who made this offer can no longer hire at this business');
    const result = await teamMembership.activateHireMembership(db, {
      businessId: ctx.business_id,
      ownerId: ctx.owner_id,
      userId: ctx.user_id,
      email: ctx.email,
      role: ctx.team_role || 'employee',
      actorRole: access.isOwner ? null : access.role,
      jobRole: ctx.job_role_code,
      payRateCents: MEMBER_PERIOD[ctx.pay_period] ? Number(ctx.pay_cents) : null,
      payRatePeriod: MEMBER_PERIOD[ctx.pay_period] || null,
      employmentBasis: employmentBasisFor(ctx.path_stage),
      careerOfferId: ctx.offer_id,
      grantedBy: ctx.offer_created_by,
    });
    await db.query('UPDATE career_onboarding_runs SET member_id = $2, updated_at = NOW() WHERE id = $1', [ctx.id, result.member.id]);
    ctx.member_id = result.member.id;
    if (result.created) {
      await logBusinessAction({ user: actor, headers: {} }, {
        business_id: ctx.business_id,
        actor_role: access.role,
        action: 'careers.hire.membership_created',
        target_type: 'business_member',
        target_id: result.member.id,
        after_state: { role: result.member.role, job_role: result.member.job_role, employment_basis: result.member.employment_basis },
        metadata: { career_offer_id: ctx.offer_id, rehired: result.rehired },
        client: db,
      });
    }
    return { status: 'done', detail: { member_id: result.member.id, created: result.created, rehired: result.rehired } };
  },

  // 4. Store assignment (restaurants) or the whole business.
  async location(db, ctx) {
    if (!ctx.restaurant_id || !ctx.location_id) return { status: 'skipped', detail: { scope: 'business' } };
    if (!ctx.member_id) throw stepError('membership_missing', 'Membership step has not finished');
    await db.query(
      `INSERT INTO restaurant_location_memberships (restaurant_id, location_id, membership_id, status, created_by)
       VALUES ($1, $2, $3, 'active', $4)
       ON CONFLICT DO NOTHING`,
      [ctx.restaurant_id, ctx.location_id, ctx.member_id, ctx.offer_created_by]
    );
    return { status: 'done', detail: { location_id: Number(ctx.location_id), location_name: ctx.location_name } };
  },

  // 5. The worker sets their own PIN; the manager never sees it.
  async pin(db, ctx) {
    if (!ctx.restaurant_id) return { status: 'skipped', detail: { reason: 'no_store_pins' } };
    const { rows: [pin] } = await db.query(
      `SELECT id FROM restaurant_staff_pins
        WHERE restaurant_id = $1 AND staff_user_id = $2 AND is_active = TRUE
          AND location_id IS NOT DISTINCT FROM $3::bigint`,
      [ctx.restaurant_id, ctx.user_id, ctx.location_id || null]
    );
    return pin ? { status: 'done', detail: { set_by: 'worker' } } : { status: 'needs_action', detail: { action: 'worker_sets_pin' } };
  },

  // 6. Training assigned right away, not on the next daily run.
  async training(db, ctx) {
    if (!ctx.restaurant_id) return { status: 'skipped', detail: { reason: 'no_training_rules' } };
    const created = await applyAutoAssignRules(db, {
      restaurantId: ctx.restaurant_id, businessId: ctx.business_id, assignedBy: ctx.offer_created_by,
      onlyOnHire: true, memberUserId: ctx.user_id,
    });
    const assignments = Array.isArray(created) ? created : (created?.created || []);
    for (const a of assignments) {
      // Same notice the daily run sends; best-effort, outside the step.
      setImmediate(() => notifyTrainingAssigned(a.userId, a).catch(() => {}));
    }
    return { status: 'done', detail: { assigned: assignments.length } };
  },

  // 7. Required documents (e.g. food handler card) through staff documents.
  async documents(db, ctx) {
    const required = ctx.required_credentials || [];
    if (!required.length) return { status: 'skipped', detail: { required: [] } };
    if (!ctx.restaurant_id) return { status: 'needs_action', detail: { required, missing: required, action: 'manager_confirms' } };
    const { rows } = await db.query(
      `SELECT DISTINCT doc_type FROM restaurant_staff_documents
        WHERE restaurant_id = $1 AND user_id = $2 AND deleted_at IS NULL
          AND COALESCE(verification_status, 'pending') <> 'rejected'
          AND (expires_on IS NULL OR expires_on >= CURRENT_DATE)
          AND doc_type = ANY($3)`,
      [ctx.restaurant_id, ctx.user_id, required]
    );
    const have = new Set(rows.map((r) => r.doc_type));
    const missing = required.filter((c) => !have.has(c));
    return missing.length
      ? { status: 'needs_action', detail: { required, missing, action: 'worker_uploads' } }
      : { status: 'done', detail: { required } };
  },

  // 8. 18+ from the existing age verification; no date of birth stored.
  async age_confirmed(db, ctx) {
    return (await isAdultConfirmed(db, ctx.user_id))
      ? { status: 'done', detail: {} }
      : { status: 'needs_action', detail: { action: 'confirm_age' } };
  },

  // 10 (EOR part). Enroll with the partner and wait for "ready to work".
  async eor_enrollment(db, ctx) {
    if (ctx.employer_model !== 'oxsteed_eor') return { status: 'skipped', detail: { employer_model: 'direct' } };
    const { rows: [existing] } = await db.query(
      `SELECT * FROM career_eor_assignments WHERE application_id = $1 AND status <> 'ended' ORDER BY id DESC LIMIT 1`,
      [ctx.application_id]
    );
    if (existing && ['ready', 'active'].includes(existing.status)) return { status: 'done', detail: { assignment_id: existing.id, partner_status: existing.status } };
    if (existing && existing.status === 'enrolling' && existing.partner_worker_ref) {
      return { status: 'needs_action', detail: { assignment_id: existing.id, waiting_for: 'partner_ready' } };
    }
    const cfg = eorProvider.status();
    const { rows: [assignment] } = existing && existing.status !== 'failed'
      ? { rows: [existing] }
      : await db.query(
        `INSERT INTO career_eor_assignments (member_id, business_id, user_id, application_id, partner, state_or_country, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'enrolling') RETURNING *`,
        [ctx.member_id, ctx.business_id, ctx.user_id, ctx.application_id, cfg.provider,
          [ctx.location_country || ctx.country_code, ctx.location_state || ctx.region].filter(Boolean).join('-') || null]
      );
    try {
      const result = await eorProvider.enroll({
        worker: { email: ctx.email, first_name: ctx.first_name, last_name: ctx.last_name },
        business: { id: ctx.business_id, business_name: ctx.business_name },
        assignmentRef: assignment.id,
        workLocation: { country: ctx.location_country || ctx.country_code, state: ctx.location_state || ctx.region, city: ctx.city },
        startDate: ctx.start_date,
      });
      await db.query(
        `UPDATE career_eor_assignments SET partner_worker_ref = $2, status = $3, updated_at = NOW() WHERE id = $1`,
        [assignment.id, result.partnerWorkerRef, result.status]
      );
      return result.status === 'ready'
        ? { status: 'done', detail: { assignment_id: assignment.id, partner_status: 'ready' } }
        : { status: 'needs_action', detail: { assignment_id: assignment.id, waiting_for: 'partner_ready' } };
    } catch (err) {
      if (err.code === 'provider_not_configured') {
        return { status: 'needs_action', detail: { assignment_id: assignment.id, waiting_for: 'eor_partner_setup', reason: err.reason } };
      }
      throw err;
    }
  },

  // 9. The proposed first shift as a DRAFT; publishing stays manual so
  // Fair Workweek notice and premiums apply as usual.
  async first_shift(db, ctx) {
    const fs = ctx.first_shift;
    if (!fs || !fs.date || !fs.start || !fs.end) return { status: 'skipped', detail: { reason: 'no_first_shift' } };
    await db.query(
      `INSERT INTO business_staff_shifts (business_id, user_id, shift_date, start_time, end_time, role_label, restaurant_id, location_id, career_onboarding_run_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (career_onboarding_run_id) WHERE career_onboarding_run_id IS NOT NULL DO NOTHING`,
      [ctx.business_id, ctx.user_id, fs.date, fs.start, fs.end, String(ctx.offer_title || '').slice(0, 100) || null,
        ctx.location_id ? ctx.restaurant_id : null, ctx.location_id || null, ctx.id]
    );
    const { rows: [shift] } = await db.query('SELECT id, published_at FROM business_staff_shifts WHERE career_onboarding_run_id = $1', [ctx.id]);
    return { status: 'done', detail: { shift_id: shift?.id || null, draft: !shift?.published_at } };
  },

  // 10 (direct part). Payroll and I-9 / right-to-work happen in the
  // business's payroll or HR tool, never in OxSteed (§12.5).
  async payroll_handoff(db, ctx, current) {
    if (current?.detail?.completed_by) return { status: 'done', detail: current.detail };
    if (ctx.employer_model === 'oxsteed_eor') {
      const { rows: [eor] } = await db.query(`SELECT status FROM career_onboarding_steps WHERE run_id = $1 AND step = 'eor_enrollment'`, [ctx.id]);
      return eor?.status === 'done'
        ? { status: 'done', detail: { handled_by: 'eor_partner' } }
        : { status: 'needs_action', detail: { waiting_for: 'eor_enrollment' } };
    }
    return { status: 'needs_action', detail: { action: 'set_up_payroll', i9_or_right_to_work: 'outside_oxsteed' } };
  },

  // 11. Tell the new hire and the manager what's left.
  async notify(db, ctx) {
    const { rows: steps } = await db.query('SELECT step, status FROM career_onboarding_steps WHERE run_id = $1', [ctx.id]);
    const open = steps.filter((s) => s.status === 'needs_action').map((s) => s.step);
    await notifyUser(db, {
      userId: ctx.user_id,
      type: 'career_onboarding_needs_action',
      params: { employerName: ctx.business_name, steps: open, welcome: true },
      actionUrl: `/careers/me/onboarding/${ctx.id}`,
      deliveryKey: `career_onboarding_welcome:${ctx.id}`,
    });
    await notifyHiringTeam(db, { employer_type: 'business', business_id: ctx.business_id, created_by: ctx.offer_created_by, location_ids: ctx.location_id ? [ctx.location_id] : [] }, {
      type: 'career_onboarding_needs_action',
      params: { employerName: ctx.business_name, steps: open, manager: true },
      actionUrl: `/business/${ctx.business_id}/careers/onboarding/${ctx.id}`,
      deliveryKey: `career_onboarding_manager:${ctx.id}`,
    });
    return { status: 'done', detail: { open_steps: open } };
  },
};

async function refreshRunStatus(db, runId) {
  const { rows } = await db.query('SELECT status FROM career_onboarding_steps WHERE run_id = $1', [runId]);
  let status = 'done';
  if (rows.some((r) => r.status === 'failed')) status = 'failed';
  else if (rows.some((r) => r.status === 'pending')) status = 'running';
  else if (rows.some((r) => r.status === 'needs_action')) status = 'needs_action';
  await db.query(
    `UPDATE career_onboarding_runs SET status = $2, updated_at = NOW(),
            finished_at = CASE WHEN $2 = 'done' THEN COALESCE(finished_at, NOW()) ELSE NULL END
      WHERE id = $1`,
    [runId, status]
  );
  return status;
}

async function runStep(runner, runId, step) {
  return withTransaction(runner, async (client) => {
    const { rows: [current] } = await client.query(
      'SELECT * FROM career_onboarding_steps WHERE run_id = $1 AND step = $2 FOR UPDATE', [runId, step]
    );
    if (!current || SETTLED.has(current.status)) return current?.status || null;
    const ctx = await loadContext(client, runId);
    await client.query('SAVEPOINT career_step');
    let result;
    try {
      result = await handlers[step](client, ctx, current);
      await client.query('RELEASE SAVEPOINT career_step');
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT career_step');
      result = { status: 'failed', detail: { error: err.code || 'step_failed', message: String(err.message || '').slice(0, 300) } };
    }
    await client.query(
      `UPDATE career_onboarding_steps SET status = $3, detail = $4, attempts = attempts + 1, updated_at = NOW()
        WHERE run_id = $1 AND step = $2`,
      [runId, step, result.status, JSON.stringify(result.detail || {})]
    );
    return result.status;
  }, `career_onboarding_${step}`);
}

/**
 * Run (or resume) every unsettled step in order. A failed membership step
 * stops the run since every later step depends on it.
 */
async function executeRun(runId, { runner = pool, only = null } = {}) {
  const steps = only ? [only] : STEPS;
  for (const step of steps) {
    const status = await runStep(runner, runId, step);
    if (step === 'membership' && status === 'failed') break;
  }
  return withTransaction(runner, (client) => refreshRunStatus(client, runId), 'career_onboarding_status');
}

async function loadRun(db, runId) {
  if (!/^\d+$/.test(String(runId))) throw new AppError('Onboarding run not found', 404, 'not_found');
  const { rows: [run] } = await db.query(
    `SELECT r.*, of.employer_model, of.first_shift, of.start_date, of.location_id, of.title AS offer_title,
            b.business_name, l.name AS location_name
       FROM career_onboarding_runs r
       JOIN career_offers of ON of.id = r.offer_id
       JOIN businesses b ON b.id = r.business_id
       LEFT JOIN restaurant_locations l ON l.id = of.location_id
      WHERE r.id = $1`,
    [runId]
  );
  if (!run) throw new AppError('Onboarding run not found', 404, 'not_found');
  const { rows: steps } = await db.query(
    `SELECT step, status, detail, attempts, updated_at FROM career_onboarding_steps WHERE run_id = $1`,
    [runId]
  );
  steps.sort((a, b) => STEPS.indexOf(a.step) - STEPS.indexOf(b.step));
  return { ...run, steps };
}

/** Worker sets the store PIN for the pin step (§4.6 step 5). */
async function setWorkerPin(runId, { userId, pin, runner = pool }) {
  if (!/^\d{4,12}$/.test(String(pin || ''))) throw new AppError('Validation failed', 400, 'validation_failed', { pin: 'PIN must be 4-12 digits' });
  await withTransaction(runner, async (client) => {
    const { rows: [run] } = await client.query('SELECT * FROM career_onboarding_runs WHERE id = $1 FOR UPDATE', [runId]);
    if (!run || run.user_id !== userId) throw new AppError('Onboarding run not found', 404, 'not_found');
    const ctx = await loadContext(client, runId);
    if (!ctx.restaurant_id) throw new AppError('This workplace does not use store PINs', 409, 'pin_not_needed');
    const { rows: [member] } = await client.query(
      `SELECT id FROM business_members WHERE business_id = $1 AND member_id = $2 AND status = 'active'`, [ctx.business_id, userId]
    );
    if (!member) throw new AppError('Your team membership is not active yet', 409, 'membership_pending');
    const locationId = ctx.location_id || null;
    const digest = staffPinDigest(ctx.restaurant_id, pin);
    const { rows: clash } = await client.query(
      `SELECT id FROM restaurant_staff_pins
        WHERE restaurant_id = $1 AND pin_digest = $2 AND is_active = TRUE AND location_id IS NOT DISTINCT FROM $3::bigint
          AND staff_user_id IS DISTINCT FROM $4`,
      [ctx.restaurant_id, digest, locationId, userId]
    );
    if (clash.length) throw new AppError('This PIN is already in use at this store. Pick another.', 409, 'pin_already_in_use');
    const hash = await bcrypt.hash(String(pin), 10);
    const { rows: [existing] } = await client.query(
      `SELECT id FROM restaurant_staff_pins WHERE restaurant_id = $1 AND staff_user_id = $2 AND location_id IS NOT DISTINCT FROM $3::bigint FOR UPDATE`,
      [ctx.restaurant_id, userId, locationId]
    );
    const label = `${ctx.first_name || ''} ${ctx.last_name || ''}`.trim().slice(0, 160) || null;
    let pinId;
    try {
      if (existing) {
        await client.query(
          `UPDATE restaurant_staff_pins SET pin_hash = $1, pin_digest = $2, is_active = TRUE, updated_at = NOW() WHERE id = $3`,
          [hash, digest, existing.id]
        );
        pinId = existing.id;
      } else {
        const { rows: [created] } = await client.query(
          `INSERT INTO restaurant_staff_pins (restaurant_id, staff_user_id, staff_label, pin_hash, pin_digest, role_label, is_active, created_by, location_id)
           VALUES ($1, $2, $3, $4, $5, $6, TRUE, $2, $7) RETURNING id`,
          [ctx.restaurant_id, userId, label, hash, digest, ctx.team_role || 'employee', locationId]
        );
        pinId = created.id;
      }
    } catch (err) {
      if (err.code === '23505') throw new AppError('This PIN is already in use at this store. Pick another.', 409, 'pin_already_in_use');
      throw err;
    }
    await client.query(
      `UPDATE career_onboarding_steps SET status = 'done', detail = '{"set_by":"worker"}'::jsonb, attempts = attempts + 1, updated_at = NOW()
        WHERE run_id = $1 AND step = 'pin'`,
      [runId]
    );
    await logBusinessAction({ user: { id: userId }, headers: {} }, {
      business_id: ctx.business_id, action: 'restaurant.staff_pin.updated', target_type: 'restaurant_staff_pin', target_id: pinId,
      metadata: { source: 'careers_onboarding', run_id: Number(runId) }, client,
    });
    await refreshRunStatus(client, runId);
  }, 'career_onboarding_pin');
  return loadRun(runner, runId);
}

/** Manager marks an outside-OxSteed step complete (documents, payroll). */
async function completeManualStep(runId, { step, actor, runner = pool }) {
  if (!MANUAL_STEPS.includes(step)) throw new AppError('This step can\'t be completed by hand', 400, 'validation_failed', { step: 'Not a manual step' });
  await withTransaction(runner, async (client) => {
    const { rows: [row] } = await client.query(
      'SELECT * FROM career_onboarding_steps WHERE run_id = $1 AND step = $2 FOR UPDATE', [runId, step]
    );
    if (!row) throw new AppError('Onboarding step not found', 404, 'not_found');
    const detail = { ...(row.detail || {}), completed_by: actor.id, completed_at: new Date().toISOString() };
    await client.query(
      `UPDATE career_onboarding_steps SET status = 'done', detail = $3, updated_at = NOW() WHERE run_id = $1 AND step = $2`,
      [runId, step, JSON.stringify(detail)]
    );
    await refreshRunStatus(client, runId);
  }, 'career_onboarding_manual');
  return loadRun(runner, runId);
}

/** Retry one step (failed or needs_action) by resetting it to pending. */
async function retryStep(runId, { step, runner = pool }) {
  if (!STEPS.includes(step)) throw new AppError('Unknown step', 400, 'validation_failed', { step: 'Unknown step' });
  await runner.query(
    `UPDATE career_onboarding_steps SET status = 'pending', updated_at = NOW()
      WHERE run_id = $1 AND step = $2 AND status IN ('failed','needs_action')`,
    [runId, step]
  );
  await executeRun(runId, { runner, only: step });
  // Later steps that were waiting on this one (e.g. payroll on EOR) re-check.
  if (step === 'membership' || step === 'eor_enrollment') await executeRun(runId, { runner });
  return loadRun(runner, runId);
}

/** EOR partner says ready/ended/failed: update the assignment and steps. */
async function applyEorStatus(db, { assignmentId, status, partnerWorkerRef }) {
  const { rows: [assignment] } = await db.query(
    `UPDATE career_eor_assignments
        SET status = $2, partner_worker_ref = COALESCE($3, partner_worker_ref), updated_at = NOW(),
            started_at = CASE WHEN $2 IN ('ready','active') THEN COALESCE(started_at, NOW()) ELSE started_at END,
            ended_at = CASE WHEN $2 = 'ended' THEN NOW() ELSE ended_at END
      WHERE id = $1 RETURNING *`,
    [assignmentId, status, partnerWorkerRef]
  );
  if (!assignment) return null;
  const { rows: [run] } = await db.query('SELECT id FROM career_onboarding_runs WHERE application_id = $1', [assignment.application_id]);
  if (run && ['ready', 'active', 'failed'].includes(status)) {
    const stepStatus = status === 'failed' ? 'failed' : 'done';
    await db.query(
      `UPDATE career_onboarding_steps SET status = $2, detail = detail || $3::jsonb, updated_at = NOW()
        WHERE run_id = $1 AND step = 'eor_enrollment'`,
      [run.id, stepStatus, JSON.stringify({ partner_status: status })]
    );
    if (stepStatus === 'done') {
      await db.query(
        `UPDATE career_onboarding_steps SET status = 'done', detail = '{"handled_by":"eor_partner"}'::jsonb, updated_at = NOW()
          WHERE run_id = $1 AND step = 'payroll_handoff' AND status <> 'done'`,
        [run.id]
      );
    }
    await refreshRunStatus(db, run.id);
  }
  return assignment;
}

/** Resume runs a crash left in 'running' (job queue half of §4.6). */
async function resumeStalled({ runner = pool, olderThanMinutes = 5, limit = 50 } = {}) {
  const { rows } = await runner.query(
    `SELECT id FROM career_onboarding_runs
      WHERE status = 'running' AND updated_at < NOW() - make_interval(mins => $1::int)
      ORDER BY id LIMIT $2`,
    [olderThanMinutes, limit]
  );
  for (const r of rows) await executeRun(r.id, { runner });
  return rows.length;
}

module.exports = {
  STEPS,
  MANUAL_STEPS,
  employmentBasisFor,
  startRun,
  executeRun,
  loadRun,
  setWorkerPin,
  completeManualStep,
  retryStep,
  applyEorStatus,
  resumeStalled,
  refreshRunStatus,
  handlers,
};
