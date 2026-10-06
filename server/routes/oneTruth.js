const router = require('express').Router();
const { requireSuperAdmin, requirePermission } = require('../middleware/adminAuth');
const ctrl = require('../controllers/oneTruthController');

// All One Truth routes require super_admin
router.get('/filters',         requireSuperAdmin, ctrl.getFilters);
router.get('/stats',           requireSuperAdmin, ctrl.getStats);
router.get('/users',           requireSuperAdmin, ctrl.listUsers);
router.get('/suspects',        requireSuperAdmin, ctrl.listSuspects);
// Detail endpoint exposes PII: requires investigation grant with purpose trail,
// not just super-admin.
router.get('/user/:userId',    requireSuperAdmin, requirePermission('investigate_users'), ctrl.getUserDetail);

module.exports = router;
