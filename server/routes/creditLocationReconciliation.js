'use strict';

// Group 13 Slice 4h (686-690): the participant/HQ door of the location
// reconciliation surface. User-authenticated behind requireRestaurantAccess:
// an owner/member reads every location of their own restaurant and no
// other restaurant's. Mounted at
// /api/restaurants/:restaurantId/credit-reconciliation.
//
// The admin reconciliation workspace is untouched and stays admin-only
// (D-354). No money moves on any of these routes.

const router = require('express').Router({ mergeParams: true });
const { authenticate } = require('../middleware/auth');
const { requireRestaurantAccess } = require('../middleware/scopeGates');
const controller = require('../controllers/creditLocationReconciliationController');

router.use(authenticate, requireRestaurantAccess());

// 686: the HQ location picker — every location of the caller's own restaurant.
// 686: the per-location reconciliation summary.
router.get('/locations', controller.userListLocations);
router.get('/summary', controller.userGetSummary);
// 687/688: the location's exceptions, with matched adjustments and
// annotations attached.
router.get('/exceptions', controller.userListExceptions);
router.get('/exceptions/:exceptionId/annotations', controller.userListAnnotations);
// 688: annotate an open/acknowledged exception.
router.post('/exceptions/:exceptionId/annotations', controller.userAddAnnotation);
// 689: the per-location period-close review (read), and recording the
// review (write). Neither approves a settlement.
router.get('/period-close', controller.userGetPeriodClose);
router.post('/period-close', controller.userRecordPeriodClose);
// 690: the authorized reconciliation export (CSV, same columns as the
// summary), server-enforced to the caller's location.
router.get('/export.csv', controller.userExportCsv);

module.exports = router;
