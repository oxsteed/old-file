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
 * Item 44: reporting no longer string-matches a store to an agreement —
 * stores map explicitly through franchise_location_agreements. Accrual
 * follows the same table wherever the revenue belongs to a store: pass
 * locationId (food orders carry one) and the mapped agreement governs;
 * an unmapped store accrues nothing (fail closed, no string fallback),
 * so report and accrual can never disagree about a store. Revenue with
 * no store — a job's location, a marketplace shipping address, a Direct
 * booking's service city — is only a territory point, so it keeps the
 * deterministic city-then-region match below (findTerritoryAgreement).
 * That match is genuinely different: there is no location to map, and
 * unifying it would mean inventing a store for a job. Legacy food
 * orders with no location_id also fall back to it for the same reason.
 *
 * Pure bookkeeping: credits the franchise owner's platform_ledger and
 * accrues the marketing-fee share on the agreement. No money moves here.
 */

const logger = require('../utils/logger');
const locationAgreements = require('./restaurantFranchiseLocationAgreementService');

/**
 * Find the single franchise agreement that owns a territory point.
 * Territory points only: revenue with no store (a job location, a
 * shipping address, a Direct service city). Store revenue must go
 * through the explicit mapping (see accrueTerritoryRoyalty).
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
 * @param {number} [args.locationId] when the revenue belongs to a
 *   store, its restaurant_location id: the explicit mapping governs
 *   and an unmapped store accrues nothing (no string fallback).
 *   Omit it only for territory-point revenue with no store.
 * @param {string} [args.city]
 * @param {string} [args.region]
 * @param {string} args.sourceType e.g. 'job', 'food_order', 'direct_booking', 'marketplace_sale'
 * @param {string} args.sourceId stable id of the revenue event (idempotency)
 * @param {string} args.description ledger description
 * @returns {object|null} { agreementId, ownerUserId, royaltyCents, marketingCents } or null when no territory matches
 */
async function accrueTerritoryRoyalty({ client, amountCents, locationId, city, region, sourceType, sourceId, description }) {
  const gross = Number(amountCents);
  if (!Number.isSafeInteger(gross) || gross <= 0) return null;
  if (locationId == null && !city && !region) return null;

  let agreement;
  try {
    if (locationId != null) {
      // Store revenue: the explicit mapping is the only source of
      // truth. Unmapped (or mapped to a no-longer-launched agreement)
      // accrues nothing — never fall back to string matching, or the
      // report and the accrual would disagree about the same store.
      const mapped = await locationAgreements.findLocationAgreement(client, locationId);
      if (!mapped || !mapped.ownerUserId) return null;
      agreement = {
        application_id: mapped.applicationId,
        owner_user_id: mapped.ownerUserId,
        agreement_id: mapped.agreementId,
        royalty_bps: mapped.royaltyBps,
        marketing_fee_bps: mapped.marketingFeeBps,
      };
    } else {
      agreement = await findTerritoryAgreement(client, city, region);
    }
    if (!agreement || !agreement.owner_user_id) return null;

    const royaltyCents = Math.round((gross * agreement.royalty_bps) / 10000);
    const marketingCents = agreement.marketing_fee_bps > 0
      ? Math.round((gross * agreement.marketing_fee_bps) / 10000)
      : 0;

    // Royalty ledger insert. Idempotency without ON CONFLICT:
    // platform_ledger is append-only (ledger_no_update /
    // ledger_no_delete rules, migration 001) and Postgres refuses
    // INSERT ... ON CONFLICT on a table with rules, so the old
    // upsert errored on the real table and no store royalty could
    // ever accrue (the isolated-schema royalty tests build a
    // rule-free ledger, which hid it). Pre-check, then a plain
    // insert; a 23505 from a racing duplicate is the same duplicate
    // outcome. A duplicate does NOT return early: the marketing-fee
    // step below runs on its own idempotency record, so a retry
    // after a crash between the royalty insert and the fee UPDATE
    // still accrues the fee (background-jobs audit #45c).
    let royaltyDuplicate = false;
    if (royaltyCents > 0) {
      const idempotencyKey = `franchise-royalty:${sourceType}:${sourceId}`;
      const { rows: existing } = await client.query(
        'SELECT id FROM platform_ledger WHERE idempotency_key = $1 LIMIT 1',
        [idempotencyKey]
      );
      if (existing.length) {
        royaltyDuplicate = true;
      } else {
        try {
          await client.query(
            `INSERT INTO platform_ledger
               (user_id, type, amount_cents, description, metadata, source_type, idempotency_key)
             VALUES ($1, 'franchise_royalty', $2, $3, $4, 'franchise_royalty', $5)`,
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
          logger.info('[franchise] Territory royalty accrued', {
            sourceType, sourceId, royaltyCents, ownerUserId: agreement.owner_user_id,
          });
        } catch (error) {
          if (error?.code === '23505') royaltyDuplicate = true;
          else throw error;
        }
      }
    }

    // Marketing-fee share (owed to OxSteed) accrues on the agreement
    // for later settlement; it is tracked, not silently forgiven.
    // Background-jobs audit #45: the fee is exact-once per source.
    // The accrual record and the agreement UPDATE run in ONE
    // statement, so the UPDATE fires only when the record is newly
    // inserted. A repeated accrue cannot double-count the fee —
    // including the royaltyCents == 0 case, where no ledger insert
    // exists to gate on — and a crash between the two writes is
    // impossible at the statement level.
    let feeApplied = false;
    if (marketingCents > 0) {
      const { rows: applied } = await client.query(
        `WITH acc AS (
           INSERT INTO franchise_marketing_fee_accruals (agreement_id, source_type, source_id, marketing_cents)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (agreement_id, source_type, source_id) DO NOTHING
           RETURNING id
         )
         UPDATE franchise_agreements
            SET marketing_fee_accrued_cents = COALESCE(marketing_fee_accrued_cents, 0) + $4,
                updated_at = NOW()
          WHERE id = $1 AND EXISTS (SELECT 1 FROM acc)
          RETURNING id`,
        [agreement.agreement_id, sourceType, String(sourceId), marketingCents]
      );
      feeApplied = applied.length > 0;
    }

    if (royaltyDuplicate) {
      return {
        agreementId: agreement.agreement_id,
        ownerUserId: agreement.owner_user_id,
        royaltyCents: 0,
        marketingCents: feeApplied ? marketingCents : 0,
        duplicate: true,
      };
    }
    return {
      agreementId: agreement.agreement_id,
      ownerUserId: agreement.owner_user_id,
      royaltyCents,
      marketingCents,
    };
  } catch (error) {
    // Background-jobs audit #45: a failed accrual is no longer
    // warn-only at the call site with the revenue event already
    // terminal. Record it in the re-drive outbox keyed by
    // sourceType:sourceId, then rethrow so the caller's warn-only
    // handling is unchanged.
    await recordRoyaltyFailure(client, {
      sourceType,
      sourceId,
      agreementId: agreement?.agreement_id ?? null,
      amountCents: gross,
      locationId: locationId ?? null,
      city: city || null,
      region: region || null,
      description: description || null,
      error: error?.message || String(error),
    });
    throw error;
  }
}

// Record a failed accrual for re-drive. Never throws: the recording
// itself must not turn a failed accrual into a second failure. A
// repeat failure for the same still-unresolved source refreshes the
// error and the retry time without resetting the attempt count.
async function recordRoyaltyFailure(client, { sourceType, sourceId, agreementId, amountCents, locationId, city, region, description, error }) {
  try {
    await client.query(
      `INSERT INTO franchise_royalty_failures
         (source_type, source_id, agreement_id, amount_cents, location_id, city, region, description, error, attempts, next_retry_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, NOW())
       ON CONFLICT (source_type, source_id) WHERE resolved_at IS NULL
       DO UPDATE SET error = EXCLUDED.error, next_retry_at = NOW(), updated_at = NOW()`,
      [
        sourceType, String(sourceId), agreementId, amountCents, locationId,
        city, region, description, String(error || '').slice(0, 2000),
      ]
    );
  } catch (recordErr) {
    logger.warn('[franchise] Failed to record royalty failure for re-drive', {
      sourceType, sourceId, error: recordErr.message,
    });
  }
}

// Re-drive unresolved failed accruals (background-jobs audit #45).
// A source that accrues (or already accrued, or no longer matches a
// launched agreement) resolves; a source that still fails backs off
// exponentially (10m, 20m, 40m, ... capped at one day) and stays
// open for the next run.
async function retryFailedRoyalties(client, { limit = 100 } = {}) {
  const bounded = Math.max(1, Math.min(Number(limit) || 100, 500));
  const { rows: failures } = await client.query(
    `SELECT * FROM franchise_royalty_failures
      WHERE resolved_at IS NULL AND next_retry_at <= NOW()
      ORDER BY next_retry_at, id LIMIT $1`,
    [bounded]
  );
  const result = { attempted: 0, resolved: 0, failed: 0, errors: [] };
  for (const failure of failures) {
    result.attempted += 1;
    try {
      await accrueTerritoryRoyalty({
        client,
        amountCents: Number(failure.amount_cents),
        locationId: failure.location_id == null ? undefined : Number(failure.location_id),
        city: failure.city || null,
        region: failure.region || null,
        sourceType: failure.source_type,
        sourceId: failure.source_id,
        description: failure.description,
      });
      await client.query(
        `UPDATE franchise_royalty_failures SET resolved_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [failure.id]
      );
      result.resolved += 1;
    } catch (err) {
      result.failed += 1;
      result.errors.push({ source_type: failure.source_type, source_id: failure.source_id, error: err.message });
      // The failed accrue already re-recorded the failure (same
      // source, still unresolved); this UPDATE only advances the
      // attempt count and the next retry time.
      const attempts = Number(failure.attempts || 0) + 1;
      const backoffMinutes = Math.min(1440, 5 * 2 ** attempts);
      await client.query(
        `UPDATE franchise_royalty_failures
            SET attempts = $2, error = $3,
                next_retry_at = NOW() + ($4::int * INTERVAL '1 minute'),
                updated_at = NOW()
          WHERE id = $1`,
        [failure.id, attempts, String(err.message || err).slice(0, 2000), backoffMinutes]
      ).catch(() => {});
    }
  }
  return result;
}

module.exports = {
  findTerritoryAgreement,
  accrueTerritoryRoyalty,
  retryFailedRoyalties,
};
