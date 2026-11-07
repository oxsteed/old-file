'use strict';

// Explicit franchise store-to-agreement mapping (design-review item 44).
//
// A location maps to exactly one launched franchise agreement through
// franchise_location_agreements — never through city/region string
// matching. Reporting reads this table; a location with no row reports
// as unmapped (fail closed), never string-matched. The royalty accrual
// for revenue that belongs to a store (food orders, which carry a
// location_id) reads the same table; revenue that is only a territory
// point (jobs, marketplace shipping addresses, Direct bookings) has no
// store to map and keeps the deterministic territory match in
// franchiseRoyaltyService.findTerritoryAgreement.
//
// Grain: one agreement per location (UNIQUE location_id). A location
// belongs to one restaurant and nothing lets it belong to two
// agreements; two stores of one restaurant in different cities can
// belong to different franchisees, so restaurant-level would be wrong.

const AppError = require('../utils/appError');

const LAUNCHED_AGREEMENT = `
  FROM franchise_location_agreements fla
  JOIN franchise_agreements fagr ON fagr.id = fla.agreement_id
  JOIN franchise_applications fa ON fa.id = fagr.application_id
 WHERE fa.status = 'launched'`;

function agreementRow(row) {
  if (!row) return null;
  return {
    agreementId: String(row.agreement_id),
    applicationId: String(row.application_id),
    ownerUserId: row.owner_user_id || null,
    royaltyBps: Number(row.royalty_bps || 0),
    marketingFeeBps: Number(row.marketing_fee_bps || 0),
    initialFeeCents: row.initial_fee_cents == null ? null : Number(row.initial_fee_cents),
    currency: row.currency || null,
    territoryExclusive: row.territory_exclusive === true,
    territoryCity: row.desired_city || null,
    territoryRegion: row.desired_region || null,
    mappingSource: row.mapping_source || null,
    mappingAmbiguous: row.mapping_ambiguous === true,
    ambiguousCandidateCount: Number(row.ambiguous_candidate_count || 0),
  };
}

// The explicit agreement for one location, or null when unmapped (or
// when the mapped agreement is no longer launched — fail closed, the
// store surfaces as unmapped rather than attributing to a dead deal).
async function findLocationAgreement(client, locationId) {
  const id = Number(locationId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const { rows } = await client.query(
    `SELECT fagr.id AS agreement_id, fagr.application_id,
            fa.owner_user_id, fagr.royalty_bps, fagr.marketing_fee_bps,
            fagr.initial_fee_cents, fagr.currency, fagr.territory_exclusive,
            fa.desired_city, fa.desired_region,
            fla.source AS mapping_source, fla.ambiguous AS mapping_ambiguous,
            fla.ambiguous_candidate_count
       ${LAUNCHED_AGREEMENT}
        AND fla.location_id = $1`,
    [id]
  );
  return agreementRow(rows[0]);
}

// Every store of a brand with its explicit mapping (or lack of one),
// plus every launched agreement an operator may assign. The caller
// must already have established brand access; this only reads.
async function listBrandLocationAgreements(client, { brandId } = {}) {
  const { rows: locations } = await client.query(
    `SELECT loc.id AS location_id, loc.name AS location_name,
            loc.address_city, loc.address_state,
            fr.id AS restaurant_id, fr.display_name AS restaurant_name
       FROM restaurant_locations loc
       JOIN food_restaurants fr ON fr.id = loc.restaurant_id
      WHERE fr.brand_id = $1 AND loc.status <> 'archived'
      ORDER BY fr.display_name ASC, fr.id ASC, loc.is_primary DESC, loc.id ASC`,
    [Number(brandId)]
  );
  const mappings = [];
  const unmappedStores = [];
  for (const location of locations) {
    const agreement = await findLocationAgreement(client, Number(location.location_id));
    const store = {
      locationId: Number(location.location_id),
      locationName: location.location_name,
      restaurantId: Number(location.restaurant_id),
      restaurantName: location.restaurant_name,
      city: location.address_city || null,
      region: location.address_state || null,
    };
    if (agreement) mappings.push({ ...store, agreement });
    else unmappedStores.push(store);
  }
  const { rows: agreements } = await client.query(
    `SELECT fagr.id AS agreement_id, fa.id AS application_id,
            fa.owner_user_id, fa.desired_city, fa.desired_region,
            fagr.royalty_bps, fagr.marketing_fee_bps,
            fagr.initial_fee_cents, fagr.currency, fagr.territory_exclusive
       FROM franchise_agreements fagr
       JOIN franchise_applications fa ON fa.id = fagr.application_id
      WHERE fa.status = 'launched'
      ORDER BY fa.desired_city ASC NULLS LAST, fa.desired_region ASC NULLS LAST, fa.id ASC`
  );
  return {
    mappings,
    unmappedStores,
    agreements: agreements.map((row) => ({
      agreementId: String(row.agreement_id),
      applicationId: String(row.application_id),
      ownerUserId: row.owner_user_id || null,
      territoryCity: row.desired_city || null,
      territoryRegion: row.desired_region || null,
      royaltyBps: Number(row.royalty_bps || 0),
      marketingFeeBps: Number(row.marketing_fee_bps || 0),
      initialFeeCents: row.initial_fee_cents == null ? null : Number(row.initial_fee_cents),
      currency: row.currency || null,
      territoryExclusive: row.territory_exclusive === true,
    })),
  };
}

// Assign (or reassign) a location to a launched agreement. A manual
// assignment clears the backfill ambiguity flag: a human has now
// decided, so the old overlap is no longer ambiguous. The location
// must belong to the brand the caller was authorized for.
async function assignLocationAgreement(client, { brandId, locationId, agreementId, actorUserId } = {}) {
  const location = Number(locationId);
  if (!Number.isSafeInteger(location) || location <= 0) {
    throw new AppError('A valid location is required', 400, 'validation_failed');
  }
  if (typeof agreementId !== 'string' || agreementId.trim() === '') {
    throw new AppError('A valid agreement is required', 400, 'validation_failed');
  }
  const { rows: [store] } = await client.query(
    `SELECT loc.id AS location_id, fr.brand_id
       FROM restaurant_locations loc
       JOIN food_restaurants fr ON fr.id = loc.restaurant_id
      WHERE loc.id = $1 AND loc.status <> 'archived'`,
    [location]
  );
  if (!store || Number(store.brand_id) !== Number(brandId)) {
    throw new AppError('Location not found', 404, 'location_not_found');
  }
  const { rows: [agreement] } = await client.query(
    `SELECT fagr.id AS agreement_id
       FROM franchise_agreements fagr
       JOIN franchise_applications fa ON fa.id = fagr.application_id
      WHERE fagr.id = $1 AND fa.status = 'launched'`,
    [agreementId.trim()]
  );
  if (!agreement) {
    throw new AppError('Agreement not found or not launched', 404, 'agreement_not_found');
  }
  const { rows: [saved] } = await client.query(
    `INSERT INTO franchise_location_agreements
       (location_id, agreement_id, source, ambiguous, ambiguous_candidate_count, created_by, updated_at)
     VALUES ($1, $2, 'manual', FALSE, 0, $3, NOW())
     ON CONFLICT (location_id) DO UPDATE
        SET agreement_id = EXCLUDED.agreement_id,
            source = 'manual',
            ambiguous = FALSE,
            ambiguous_candidate_count = 0,
            created_by = EXCLUDED.created_by,
            updated_at = NOW()
     RETURNING location_id, agreement_id, source, ambiguous, ambiguous_candidate_count`,
    [location, agreement.agreement_id, actorUserId || null]
  );
  return {
    locationId: Number(saved.location_id),
    agreementId: String(saved.agreement_id),
    source: saved.source,
    ambiguous: saved.ambiguous === true,
    ambiguousCandidateCount: Number(saved.ambiguous_candidate_count || 0),
  };
}

// Remove a location's mapping. The store becomes unmapped and reports
// (and accrues) nothing until an operator assigns an agreement.
async function removeLocationAgreement(client, { brandId, locationId } = {}) {
  const location = Number(locationId);
  if (!Number.isSafeInteger(location) || location <= 0) {
    throw new AppError('A valid location is required', 400, 'validation_failed');
  }
  const { rows: [store] } = await client.query(
    `SELECT loc.id AS location_id, fr.brand_id
       FROM restaurant_locations loc
       JOIN food_restaurants fr ON fr.id = loc.restaurant_id
      WHERE loc.id = $1 AND loc.status <> 'archived'`,
    [location]
  );
  if (!store || Number(store.brand_id) !== Number(brandId)) {
    throw new AppError('Location not found', 404, 'location_not_found');
  }
  const { rowCount } = await client.query(
    'DELETE FROM franchise_location_agreements WHERE location_id = $1',
    [location]
  );
  return { locationId: location, removed: rowCount > 0 };
}

module.exports = {
  findLocationAgreement,
  listBrandLocationAgreements,
  assignLocationAgreement,
  removeLocationAgreement,
};
