const router = require('express').Router();
const { requireSuperAdmin } = require('../middleware/adminAuth');
const ctrl = require('../controllers/oneTruthController');

// All One Truth routes require super_admin
router.get('/filters',         requireSuperAdmin, ctrl.getFilters);
router.get('/stats',           requireSuperAdmin, ctrl.getStats);
router.get('/users',           requireSuperAdmin, ctrl.listUsers);
router.get('/suspects',        requireSuperAdmin, ctrl.listSuspects);
router.get('/user/:userId',    requireSuperAdmin, ctrl.getUserDetail);

module.exports = router;
