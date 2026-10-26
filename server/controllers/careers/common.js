'use strict';

// Shared plumbing for the careers controllers (careers spec §7).

const crypto = require('crypto');
const pool = require('../../db');
const { AppError } = require('../../middleware/errorHandler');
const { withTransaction } = require('../../utils/transaction');
const { logBusinessAction } = require('../../services/businessAuditLog');
const { logAdminAction } = require('../../services/auditService');
const {
  assertCanManageOpening, requireHiringAccess, canManagePlatformHiring,
} = require('../../services/careers/access');
const { loadApplicationForEmployer, applicationInScope, openingView } = require('../../services/careers/applications');

const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const tx = (fn, name = 'careers') => withTransaction(pool, fn, name);

function requireUser(req) {
  if (!req.user) throw new AppError('Authentication required', 401, 'auth_required');
  return req.user;
}

function ipHash(req) {
  const ip = String(req.ip || req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  if (!ip) return null;
  const pepper = process.env.CAREERS_IP_PEPPER || process.env.JWT_SECRET || 'careers-ip';
  return crypto.createHmac('sha256', pepper).update(ip).digest('hex');
}

function businessIdFrom(req) {
  const raw = req.query.business_id ?? req.body?.business_id;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Validation failed', 400, 'validation_failed', { business_id: 'Pick a business' });
  return id;
}

/** Hiring access for a business-level employer route (no record yet). */
async function businessAccess(req, { requireHire = true } = {}) {
  const user = requireUser(req);
  const access = await requireHiringAccess(user, businessIdFrom(req));
  return { kind: 'business', ...access, requireHire };
}

async function loadOpeningRow(db, id, { lock = false } = {}) {
  if (!/^\d+$/.test(String(id))) throw new AppError('Opening not found', 404, 'not_found');
  const { rows: [row] } = await db.query(`SELECT * FROM career_openings WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id]);
  if (!row) throw new AppError('Opening not found', 404, 'not_found');
  return row;
}

/** Opening + access; out-of-scope reads answer 404 (§4.7 step 3). */
async function openingWithAccess(db, req, id, { write = true, lock = false } = {}) {
  const opening = await loadOpeningRow(db, id, { lock });
  const access = await assertCanManageOpening(requireUser(req), opening, { db, write });
  return { opening, access };
}

/** Application + access for the employer pipeline (C-01, C-02). */
async function applicationWithAccess(db, req, id, { write = true, lock = false } = {}) {
  const app = await loadApplicationForEmployer(db, id, { lock });
  const access = await assertCanManageOpening(requireUser(req), openingView(app), { db, write });
  if (!applicationInScope(access, app)) throw new AppError('Application not found', 404, 'not_found');
  return { app, access };
}

async function offerWithAccess(db, req, offerId, { lock = true } = {}) {
  if (!/^\d+$/.test(String(offerId))) throw new AppError('Offer not found', 404, 'not_found');
  const { rows: [offer] } = await db.query(`SELECT * FROM career_offers WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [offerId]);
  if (!offer) throw new AppError('Offer not found', 404, 'not_found');
  const { app, access } = await applicationWithAccess(db, req, offer.application_id, { write: true, lock });
  return { offer, app, access };
}

/**
 * One audit entry per employer write: business audit log for business
 * hiring, the admin audit hash chain for OxSteed HR.
 */
async function audit(req, access, { action, targetType, targetId, after = null, before = null, metadata = null, businessId = null, client = null }) {
  if (access?.kind === 'platform') {
    await logAdminAction({
      adminId: req.user.id, action, targetType, targetId: targetId != null ? String(targetId) : null,
      before, after: after || metadata, req, client,
    });
    return;
  }
  await logBusinessAction(req, {
    business_id: businessId || access?.businessId,
    actor_role: access?.role,
    action, target_type: targetType, target_id: targetId, before_state: before, after_state: after, metadata, client,
  });
}

module.exports = {
  pool,
  handle,
  tx,
  requireUser,
  ipHash,
  businessIdFrom,
  businessAccess,
  loadOpeningRow,
  openingWithAccess,
  applicationWithAccess,
  offerWithAccess,
  audit,
  canManagePlatformHiring,
};
