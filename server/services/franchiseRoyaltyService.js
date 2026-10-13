'use strict';

/**
 * Franchise territory royalty service (reviews P2-9-F08, P2-9-F13).
 *
 * P2-9-F08: territory matching was fuzzy with an arbitrary winner —
 *   LOWER(desired_city)=LOWER(city) OR LOWER(desired_region)=LOWER(region)
 *   with a bare LIMIT 1, so when several launched franchises matched (same
 *   region, or one on city and another on region) the credited owner was
 *   whichever row Postgres happened to return first. Matching is now
 *   deterministic: an exact city match outranks a region match, then the
 *   most recently updated agreement wins, then the lowest application id.
 *
 * P2-9-F13: royalties fired only on job completion. accrueTerritoryRoyalty
 *   is the single entry point; call it from every revenue surface that can
 *   occur in a franchise territory (jobs, food orders, Direct bookings,
 *   marketplace sales).
 *
 * Pure bookkeeping: credits the franchise owner's platform_ledger and
 * accrues the marketing-fee share on the agreement. No money moves here.
 */

const logger = require('../utils/logger');

/**
 * Find the single franchise agreement that owns a territory point.
 * Returns the row or null when nothing matches.
 */
async function findTerritoryAgreement(client, city, region) {
  const { rows } = await client.query(
    `SELECT fa.id AS application_id,
            fa.owner_user_id,
            fa.desired_city,
            fa.desired_region,
            fagr.id AS agreement_id,
            fagr.royalty_bps,
            fagr.marketing_fee_bps
       FROM franchise_applications fa
       JOIN franchise_agreements fagr ON fagr.application_id = fa.id
      WHERE fa.status = 'launched'
        AND fagr.royalty_bps > 0
        AND (
          ($1::text IS NOT NULL AND btrim($1::text) <> ''
             AND LOWER(TRIM(COALESCE(fa.desired_city, ''))) = LOWER(TRIM($1::text)))
          OR
          ($2::text IS NOT NULL AND btrim($2::text) <> ''
             AND LOWER(TRIM(COALESCE(fa.desired_region, ''))) = LOWER(TRIM($2::text)))
        )
      ORDER BY
        -- exact city match outranks region-only match (deterministic)
        CASE WHEN ($1::text IS NOT NULL AND btrim($1::text) <> ''
                   AND LOWER(TRIM(COALESCE(fa.desired_city, ''))) = LOWER(TRIM($1::text)))
             THEN 0 ELSE 1 END,
        fagr.updated_at DESC,
        fa.id ASC
      LIMIT 1`,
    [city || null, region || null]
  );
  return rows[0] || null;
}

/**
 * Accrue the territory royalty for one revenue event.
 *
 * @param {object} args
 * @param {object} args.client pg client (or pool) — the caller owns the transaction
 * @param {number} args.amountCents gross revenue of the event, in cents
 * @param {string} [args.city]
 * @param {string} [args.region]
 * @param {string} args.sourceType e.g. 'job', 'food_order', 'direct_booking', 'marketplace_sale'
 * @param {string} args.sourceId stable id of the revenue event (idempotency)
 * @param {string} args.description ledger description
 * @returns {object|null} { agreementId, ownerUserId, royaltyCents, marketingCents } or null when no territory matches
 */
async function accrueTerritoryRoyalty({ client, amountCents, city, region, sourceType, sourceId, description }) {
  const gross = Number(amountCents);
  if (!Number.isSafeInteger(gross) || gross <= 0) return null;
  if (!city && !region) return null;

  const agreement = await findTerritoryAgreement(client, city, region);
  if (!agreement || !agreement.owner_user_id) return null;

  const royaltyCents = Math.round((gross * agreement.royalty_bps) / 10000);
  const marketingCents = agreement.marketing_fee_bps > 0
    ? Math.round((gross * agreement.marketing_fee_bps) / 10000)
    : 0;

  if (royaltyCents > 0) {
    const idempotencyKey = `franchise-royalty:${sourceType}:${sourceId}`;
    const { rowCount } = await client.query(
      `INSERT INTO platform_ledger
         (user_id, type, amount_cents, description, metadata, source_type, idempotency_key)
       VALUES ($1, 'franchise_royalty', $2, $3, $4, 'franchise_royalty', $5)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
      [
        agreement.owner_user_id,
        royaltyCents,
        description || `Territory royalty — ${sourceType} ${sourceId} in ${city || region}`,
        JSON.stringify({
          source_type: sourceType,
          source_id: String(sourceId),
          agreement_id: agreement.agreement_id,
          application_id: agreement.application_id,
          royalty_bps: agreement.royalty_bps,
          gross_cents: gross,
        }),
        idempotencyKey,
      ]
    );
    if (rowCount === 0) {
      // Already accrued for this revenue event; do not double-count the
      // marketing accrual either.
      return { agreementId: agreement.agreement_id, ownerUserId: agreement.owner_user_id, royaltyCents: 0, marketingCents: 0, duplicate: true };
    }
    logger.info('[franchise] Territory royalty accrued', {
      sourceType, sourceId, royaltyCents, ownerUserId: agreement.owner_user_id,
    });
  }

  // Marketing-fee share (owed to OxSteed) accrues on the agreement for
  // later settlement; it is tracked, not silently forgiven.
  if (marketingCents > 0) {
    await client.query(
      `UPDATE franchise_agreements
          SET marketing_fee_accrued_cents = COALESCE(marketing_fee_accrued_cents, 0) + $2,
              updated_at = NOW()
        WHERE id = $1`,
      [agreement.agreement_id, marketingCents]
    );
  }

  return {
    agreementId: agreement.agreement_id,
    ownerUserId: agreement.owner_user_id,
    royaltyCents,
    marketingCents,
  };
}

module.exports = {
  findTerritoryAgreement,
  accrueTerritoryRoyalty,
};
