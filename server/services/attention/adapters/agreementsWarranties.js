'use strict';

/**
 * agreements_warranties adapter.
 * Sources: work_agreements (unsigned = owner-helper has not signed the latest
 * version), work_agreement_warranty_claims (filed/under_review).
 * Awaiting only the customer (helper already signed) is excluded.
 */

const { buildItem, makeTracker } = require('../utils');

const UNSIGNED_HIGH_AFTER_MS = 7 * 24 * 3600 * 1000;
const CLAIM_HIGH_AFTER_MS = 7 * 24 * 3600 * 1000;

async function collect(business, ctx) {
  const items = [];
  const freshness = [];
  const agrTrack = makeTracker(freshness, 'work_agreements');
  const claimTrack = makeTracker(freshness, 'work_agreement_warranty_claims');

  const ownerUserId = business.user_id;
  const hasCore = await ctx.tableExists('work_agreements')
    && await ctx.tableExists('jobs');

  if (hasCore) {
    const canCheckSigs = await ctx.tableExists('work_agreement_signatures')
      && await ctx.tableExists('work_agreement_versions');

    const { rows } = await ctx.pool.query(
      `SELECT wa.id, wa.status, wa.created_at, wa.updated_at,
              lv.version_number AS latest_version,
              lv.id AS latest_version_id
         FROM work_agreements wa
         JOIN jobs j ON j.id = wa.job_id
         LEFT JOIN LATERAL (
           SELECT v.id, v.version_number FROM work_agreement_versions v
           WHERE v.agreement_id = wa.id
           ORDER BY v.version_number DESC LIMIT 1
         ) lv ON ${canCheckSigs ? 'TRUE' : 'FALSE'}
        WHERE j.assigned_helper_id = $1
          AND wa.status = 'pending_signatures'`,
      [ownerUserId]
    );

    for (const a of rows) {
      agrTrack.touch(a.updated_at || a.created_at);
      let needsOwnerSignature = true;
      if (canCheckSigs && a.latest_version_id) {
        const { rows: sigs } = await ctx.pool.query(
          `SELECT 1 FROM work_agreement_signatures
            WHERE version_id = $1 AND signer_id = $2 LIMIT 1`,
          [a.latest_version_id, ownerUserId]
        );
        needsOwnerSignature = sigs.length === 0;
      }
      // Awaiting only the customer: not the business's action.
      if (!needsOwnerSignature) continue;

      const ageMs = ctx.now - new Date(a.created_at);
      items.push(buildItem({
        category: 'agreements_warranties',
        sourceType: 'work_agreement',
        sourceId: a.id,
        business,
        reason: 'attention.reasons.signatureRequired',
        reasonParams: {},
        urgency: ageMs > UNSIGNED_HIGH_AFTER_MS ? 'high' : 'normal',
        createdAt: a.created_at,
        deadlineAt: null,
        taskDestination: {
          type: 'route',
          route: `/business/${business.id}/agreements`,
          params: { agreementId: String(a.id) },
        },
      }, ctx));
    }
    agrTrack.done(false);
  } else {
    agrTrack.done(true, 'work_agreements/jobs tables are missing');
  }

  if (hasCore && await ctx.tableExists('work_agreement_warranty_claims')) {
    const { rows } = await ctx.pool.query(
      `SELECT wc.id, wc.agreement_id, wc.status, wc.description, wc.created_at
         FROM work_agreement_warranty_claims wc
         JOIN work_agreements wa ON wa.id = wc.agreement_id
         JOIN jobs j ON j.id = wa.job_id
        WHERE j.assigned_helper_id = $1
          AND wc.status IN ('filed', 'under_review')`,
      [ownerUserId]
    );
    for (const w of rows) {
      claimTrack.touch(w.created_at);
      const ageMs = ctx.now - new Date(w.created_at);
      items.push(buildItem({
        category: 'agreements_warranties',
        sourceType: 'warranty_claim',
        sourceId: w.id,
        business,
        reason: w.status === 'filed'
          ? 'attention.reasons.warrantyClaim'
          : 'attention.reasons.warrantyClaim',
        reasonParams: {},
        urgency: ageMs > CLAIM_HIGH_AFTER_MS ? 'high' : 'normal',
        createdAt: w.created_at,
        deadlineAt: null,
        taskDestination: {
          type: 'route',
          route: `/business/${business.id}/agreements`,
          params: { agreementId: String(w.agreement_id), claimId: String(w.id) },
        },
      }, ctx));
    }
    claimTrack.done(false);
  } else {
    claimTrack.done(true, 'work_agreement_warranty_claims table is missing');
  }

  return { items, freshness };
}

module.exports = { collect };
