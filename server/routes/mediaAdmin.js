'use strict';

const router = require('express').Router();
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const ctrl = require('../controllers/mediaAdminController');

router.use(requireAdmin, requirePermission('moderate_content'));

router.get('/flags', ctrl.listFlags);
router.post('/flags/:id/review', ctrl.reviewFlag);

module.exports = router;
