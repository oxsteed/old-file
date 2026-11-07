'use strict';

// F-02 phase 2: brand HQ console routes (mounted at /api/restaurant-brands).
// Every route is authenticated; brand visibility is derived per request from
// the restaurants the caller can already access (see restaurantBrandController).

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const { authenticatedLimiter } = require('../middleware/rateLimiter');
const { scopeExempt } = require('../middleware/scopeGates');
const brand = require('../controllers/restaurantBrandController');

router.use(authenticate, rejectImpersonated, authenticatedLimiter);

router.get('/', brand.listBrands);
router.get('/:brandId/overview', brand.getOverview);
router.get('/:brandId/store-comparison', brand.getStoreComparison);
router.get('/:brandId/compliance', brand.getCompliance);
router.post('/:brandId/menu/publish', brand.publishMenu);
// Phase 8 Track C: cross-restaurant payroll — a read-first
// cross-store pay-run view, then consolidated finalize/pay with
// per-store attribution and Phase 5 dual control.
const consolidations = require('../controllers/restaurantPayRunConsolidationController');
router.get('/:brandId/pay-runs', consolidations.listBrandPayRuns);
router.get('/:brandId/pay-runs/consolidations', consolidations.listConsolidations);
router.post('/:brandId/pay-runs/consolidations', consolidations.createConsolidation);
router.get('/:brandId/pay-runs/consolidations/:consolidationId', consolidations.getConsolidation);
router.post('/:brandId/pay-runs/consolidations/:consolidationId/finalize', consolidations.finalizeConsolidation);
router.post('/:brandId/pay-runs/consolidations/:consolidationId/approve', consolidations.approveConsolidation);
router.post('/:brandId/pay-runs/consolidations/:consolidationId/void', consolidations.voidConsolidation);
// Phase 8 Track A: brand FX policy + stored rates (brand rollups
// convert with the brand policy; restaurant HQ rollups use the
// restaurant policy).
router.get('/:brandId/fx-policy', brand.getBrandFxPolicy);
router.put('/:brandId/fx-policy', brand.updateBrandFxPolicy);
router.get('/:brandId/fx-rates', brand.listBrandFxRates);
router.post('/:brandId/fx-rates', brand.createBrandFxRate);
// Phase 8 Track D: staged brand menu rollout — pilot restaurants
// first, then every remaining target, one advance per stage.
const menuRollouts = require('../controllers/restaurantBrandMenuRolloutController');
router.get('/:brandId/menu/rollouts', menuRollouts.listRollouts);
router.post('/:brandId/menu/rollouts', menuRollouts.createRollout);
router.get('/:brandId/menu/rollouts/:rolloutId', menuRollouts.getRollout);
router.post('/:brandId/menu/rollouts/:rolloutId/advance', menuRollouts.advanceRollout);
router.post('/:brandId/menu/rollouts/:rolloutId/cancel', menuRollouts.cancelRollout);
// Phase 8 Track E: franchise reporting per store with conversion
// and royalty/fee reporting from the stored agreement terms.
const franchiseReport = require('../controllers/restaurantFranchiseReportController');
router.get('/:brandId/franchise-report', franchiseReport.getFranchiseReport);
// Item 44: explicit store-to-agreement mappings. Read with the same
// reports.view grant as the franchise report; assign/unassign with
// settings.manage, the same grant as the brand FX policy.
const franchiseMappings = require('../controllers/restaurantFranchiseLocationAgreementController');
router.get('/:brandId/franchise-mappings', franchiseMappings.listFranchiseMappings);
router.post('/:brandId/franchise-mappings', franchiseMappings.assignFranchiseMapping);
router.delete('/:brandId/franchise-mappings/:locationId', franchiseMappings.removeFranchiseMapping);
router.post('/:brandId/restaurants', brand.attachRestaurant);
router.delete('/:brandId/restaurants/:restaurantId', scopeExempt('resource-scoped'), brand.detachRestaurant);

module.exports = router;
