'use strict';

// Growth Center (Promote page) link analytics endpoints. Helpers act on their
// own events; business events are authorized by requireBusinessAccess on the
// business routes (manager role and above), mirroring campaign performance.
const pool = require('../db');
const { resolveBusinessAccess } = require('../services/scopeModel');
const {
  recordShare, recordVisit, promotionPerformance,
} = require('../analytics/promotionLinkAnalytics');

const ownerForHelper = req => ({ type: 'helper', userId: req.user.id });
const ownerForBusiness = req => ({ type: 'business', businessId: Number(req.business.id) });

async function isOwnerViewer(owner, viewerUserId) {
  if (owner.ownerType === 'helper') return String(owner.ownerUserId) === String(viewerUserId);
  return Boolean(await resolveBusinessAccess(viewerUserId, owner.businessId));
}

exports.recordHelperShare = async (req, res, next) => {
  try { await recordShare(pool, ownerForHelper(req), req.body || {}); res.status(204).end(); }
  catch (err) { next(err); }
};

exports.recordBusinessShare = async (req, res, next) => {
  try { await recordShare(pool, ownerForBusiness(req), req.body || {}); res.status(204).end(); }
  catch (err) { next(err); }
};

exports.getHelperPerformance = async (req, res, next) => {
  try { res.json(await promotionPerformance(pool, ownerForHelper(req), { days: req.query.days })); }
  catch (err) { next(err); }
};

exports.getBusinessPerformance = async (req, res, next) => {
  try { res.json(await promotionPerformance(pool, ownerForBusiness(req), { days: req.query.days })); }
  catch (err) { next(err); }
};

// Public landing beacon. Answers 204 before any work so the profile page is
// never delayed, and never reveals whether the owner exists.
exports.recordVisit = async (req, res) => {
  res.status(204).end();
  const body = req.body || {};
  let owner = null;
  if (body.ownerType === 'business') {
    const businessId = Number.parseInt(body.ownerId, 10);
    if (Number.isSafeInteger(businessId) && businessId > 0) owner = { type: 'business', businessId };
  } else if (body.ownerType === 'helper') {
    owner = { type: 'helper', userId: String(body.ownerId || '') };
  }
  if (!owner) return;
  await recordVisit(pool, owner, body, { viewerUserId: req.user?.id || null, isOwnerViewer });
};
