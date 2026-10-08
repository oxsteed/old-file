'use strict';

const router = require('express').Router();
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const ctrl = require('../controllers/mediaAdminController');

router.use(requireAdmin, requirePermission('moderate_content'));

router.get('/flags', ctrl.listFlags);
router.get('/posts/pending', ctrl.listPendingPosts);
router.post('/flags/:id/review', ctrl.reviewFlag);
router.post('/posts/:id/approve', ctrl.approvePost);

module.exports = router;
