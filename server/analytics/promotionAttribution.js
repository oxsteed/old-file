'use strict';

// Request-side hook for Growth Center conversion attribution. Checkout
// controllers call attributePromotionConversion() after they have answered;
// it only acts when the client sent the visit's device id in the
// X-Promo-Visitor header, runs on the next tick and never throws, so it can
// neither delay nor break a booking, appointment or order.
const pool = require('../db');
const logger = require('../utils/logger');
const { resolveBusinessAccess } = require('../services/scopeModel');
const { recordConversion } = require('./promotionLinkAnalytics');

async function isOwnerViewer(owner, viewerUserId) {
  if (owner.ownerType === 'helper') return String(owner.ownerUserId) === String(viewerUserId);
  return Boolean(await resolveBusinessAccess(viewerUserId, owner.businessId));
}

function ownerFor({ businessId, helperUserId }) {
  const biz = Number(businessId);
  if (Number.isSafeInteger(biz) && biz > 0) return { type: 'business', businessId: biz };
  if (helperUserId) return { type: 'helper', userId: String(helperUserId) };
  return null;
}

function attributePromotionConversion(req, { businessId = null, helperUserId = null, conversionType, referenceId }, db = pool) {
  const visitorId = typeof req?.get === 'function' ? req.get('x-promo-visitor') : null;
  if (!visitorId) return false;
  const owner = ownerFor({ businessId, helperUserId });
  if (!owner || referenceId == null) return false;
  setImmediate(() => {
    recordConversion(db, owner, { visitorId, conversionType, referenceId, converterUserId: req.user?.id || null }, { isOwnerViewer })
      .catch((err) => logger.warn('Promotion conversion hook failed', { error: err.message }));
  });
  return true;
}

module.exports = { attributePromotionConversion, isOwnerViewer };
