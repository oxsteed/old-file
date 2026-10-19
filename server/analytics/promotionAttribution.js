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
  // Decision 3: a signed-in converter can also be linked through the account
  // recorded on a non-consent visit, so the device header is not required.
  const accountUserId = req?.user?.id || null;
  if (req?.impersonated) return false; // an admin acting as the customer is not a conversion
  if (!visitorId && !accountUserId) return false;
  const owner = ownerFor({ businessId, helperUserId });
  if (!owner || referenceId == null) return false;
  setImmediate(() => {
    recordConversion(db, owner, { visitorId, accountUserId, conversionType, referenceId, converterUserId: accountUserId }, { isOwnerViewer })
      .catch((err) => logger.warn('Promotion conversion hook failed', { error: err.message }));
  });
  return true;
}

// Businesses a hired helper works for: owned or active membership, live only.
async function helperBusinessIds(db, helperUserId) {
  const { rows } = await db.query(
    `SELECT b.id FROM businesses b
      WHERE b.deleted_at IS NULL
        AND (b.user_id = $1::uuid OR EXISTS (
          SELECT 1 FROM business_members bm
           WHERE bm.business_id = b.id AND bm.member_id = $1::uuid AND bm.status = 'active'))
      ORDER BY b.id LIMIT 50`,
    [helperUserId]
  );
  return rows.map(r => Number(r.id));
}

/**
 * Decision 2: a marketplace job hire counts as a Promote conversion for the
 * business whose helper (owner or active member) was hired, under the same
 * rules: 7 days, latest visit, counted once per job, owners/team excluded.
 */
function attributePromotionJobHire(req, { helperUserId, jobId }, db = pool) {
  const visitorId = typeof req?.get === 'function' ? req.get('x-promo-visitor') : null;
  const accountUserId = req?.user?.id || null;
  if (req?.impersonated) return false;
  if ((!visitorId && !accountUserId) || !helperUserId || jobId == null) return false;
  setImmediate(async () => {
    try {
      const businessIds = await helperBusinessIds(db, helperUserId);
      if (!businessIds.length) return;
      await recordConversion(db, businessIds.map(id => ({ type: 'business', businessId: id })),
        { visitorId, accountUserId, conversionType: 'job', referenceId: jobId, converterUserId: accountUserId }, { isOwnerViewer });
    } catch (err) {
      logger.warn('Promotion job-hire hook failed', { error: err.message });
    }
  });
  return true;
}

module.exports = { attributePromotionConversion, attributePromotionJobHire, helperBusinessIds, isOwnerViewer };
