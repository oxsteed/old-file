const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const ctrl = require('../controllers/businessPackagesController');

router.get   ('/:businessId/packages',                                  requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.listPackages);
router.post  ('/:businessId/packages',                                  requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.createPackage);
router.put   ('/:businessId/packages/:packageId',                       requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.updatePackage);
router.delete('/:businessId/packages/:packageId',                       requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.deletePackage);

router.get   ('/:businessId/client-packages',                           requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.listClientPackages);
router.post  ('/:businessId/client-packages',                           requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.issueClientPackage);
router.post  ('/:businessId/client-packages/:clientPackageId/redeem',   requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.redeemSession);

module.exports = router;
