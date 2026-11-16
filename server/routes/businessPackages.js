const express = require('express');
const router = express.Router();
const { scopeExempt } = require('../middleware/scopeGates');
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const ctrl = require('../controllers/businessPackagesController');
// WP-055: client packages expose customers; redeeming is a booking action.
const requirePermission = require('../middleware/requirePermission');

router.get   ('/public/:businessId/packages',                         scopeExempt('public-storefront'), ctrl.listPublicPackages);
router.get   ('/:businessId/packages',                                  requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.listPackages);
router.post  ('/:businessId/packages',                                  requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.createPackage);
router.put   ('/:businessId/packages/:packageId',                       requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.updatePackage);
router.delete('/:businessId/packages/:packageId',                       requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.deletePackage);

router.get   ('/:businessId/client-packages',                           requireAuth, requireBusinessAccess({ minRole: 'any' }),     requirePermission(['customers.view_all', 'customers.view_assigned']), ctrl.listClientPackages);
router.post  ('/:businessId/client-packages',                           requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.issueClientPackage);
router.post  ('/:businessId/client-packages/:clientPackageId/redeem',   requireAuth, requireBusinessAccess({ minRole: 'any' }),     requirePermission(['calendar.manage_all', 'calendar.manage_self']), ctrl.redeemSession);

module.exports = router;
