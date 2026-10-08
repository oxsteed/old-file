'use strict';

const router = require('express').Router();
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const ctrl = require('../controllers/mediaAdminController');
const verificationCtrl = require('../controllers/mediaVerificationAdminController');

router.use(requireAdmin);

// Creator payments use the shared Credit dispute rail. Keep the Media queue
// scoped to creator references while preserving the existing staff grants.
router.get('/creator-disputes', requirePermission('manage_disputes'), ctrl.listCreatorDisputes);
router.post('/creator-disputes/:disputeId/review', requirePermission('manage_disputes'), ctrl.reviewCreatorDispute);
router.post('/creator-disputes/:disputeId/resolve', requirePermission('issue_refunds'), ctrl.resolveCreatorDispute);

router.get('/flags', requirePermission('moderate_content'), ctrl.listFlags);
router.get('/posts/pending', requirePermission('moderate_content'), ctrl.listPendingPosts);
router.post('/flags/:id/review', requirePermission('moderate_content'), ctrl.reviewFlag);
router.post('/posts/:id/approve', requirePermission('moderate_content'), ctrl.approvePost);
router.get('/verification-requests', requirePermission('verify_users'), verificationCtrl.listVerificationRequests);
router.post('/verification-requests/:id/review', requirePermission('verify_users'), verificationCtrl.reviewVerificationRequest);

module.exports = router;
