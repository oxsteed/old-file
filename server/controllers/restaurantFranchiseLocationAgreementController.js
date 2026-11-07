'use strict';

// Franchise store-to-agreement mappings (design-review item 44).
//
// Read: reports.view on the brand's restaurants, the same grant as
// the franchise report itself. Write (assign / unassign): settings.manage
// on the brand's restaurants, the same grant as the brand FX policy —
// changing a store's agreement re-attributes its royalty and marketing
// fee, so it is a money-attribution change, not a read. Both go through
// loadBrandRestaurants, so a caller with no access to any restaurant in
// the brand gets the usual indistinguishable 404, and a location in
// another brand is a 404 too (the service checks brand membership).

const pool = require('../db');
const { loadBrandRestaurants, brandIdParam } = require('./restaurantBrandController');
const mappings = require('../services/restaurantFranchiseLocationAgreementService');
const { withTransaction } = require('../utils/transaction');
const { logBusinessAction } = require('../services/businessAuditLog');

exports.listFranchiseMappings = async (req, res, next) => {
  try {
    const brandId = brandIdParam(req);
    await loadBrandRestaurants(req, brandId, { permission: 'reports.view' });
    const result = await mappings.listBrandLocationAgreements(pool, { brandId });
    res.json(result);
  } catch (error) { next(error); }
};

exports.assignFranchiseMapping = async (req, res, next) => {
  try {
    const brandId = brandIdParam(req);
    const accessible = await loadBrandRestaurants(req, brandId, { permission: 'settings.manage' });
    const body = req.body || {};
    const locationId = body.locationId ?? body.location_id;
    const agreementId = body.agreementId ?? body.agreement_id;
    const saved = await withTransaction(pool, async (client) => {
      const mapping = await mappings.assignLocationAgreement(client, {
        brandId,
        locationId,
        agreementId,
        actorUserId: req.user.id,
      });
      await logBusinessAction(req, {
        business_id: accessible[0].restaurant.business_id,
        actor_role: accessible[0].restaurant.effective_role,
        action: 'restaurant.brand_franchise_mapping.assigned',
        target_type: 'restaurant_brand',
        target_id: brandId,
        after_state: mapping,
        client,
        throwOnError: true,
      });
      return mapping;
    }, 'restaurant_brand_franchise_mapping_assign');
    res.status(201).json({ mapping: saved });
  } catch (error) { next(error); }
};

exports.removeFranchiseMapping = async (req, res, next) => {
  try {
    const brandId = brandIdParam(req);
    const accessible = await loadBrandRestaurants(req, brandId, { permission: 'settings.manage' });
    const locationId = Number.parseInt(req.params.locationId, 10);
    const removed = await withTransaction(pool, async (client) => {
      const result = await mappings.removeLocationAgreement(client, { brandId, locationId });
      await logBusinessAction(req, {
        business_id: accessible[0].restaurant.business_id,
        actor_role: accessible[0].restaurant.effective_role,
        action: 'restaurant.brand_franchise_mapping.removed',
        target_type: 'restaurant_brand',
        target_id: brandId,
        after_state: result,
        client,
        throwOnError: true,
      });
      return result;
    }, 'restaurant_brand_franchise_mapping_remove');
    res.json(removed);
  } catch (error) { next(error); }
};
