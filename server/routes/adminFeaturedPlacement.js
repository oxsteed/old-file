'use strict';

// Admin routes for the featured placement lifecycle (migration 677).
// Mounted at /api/admin/featured-placements. All routes sit behind
// requireAdmin (which enforces the admin TOTP hard-block) plus the
// manage_marketing grant: approving/declining/revoking featured placement
// is a promotional/marketing decision. Every mutation records the admin
// decision audit trail (decided_by_id / decided_at / decision_note) in a
// transaction.

const router = require('express').Router();
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/adminFeaturedPlacementController');

router.use(requireAdmin, requirePermission('manage_marketing'));

router.get('/featured', ctrl.listFeatured);
router.get('/', ctrl.listRequests);
router.post('/:id/contact', ctrl.contactRequest);
router.post('/:id/approve', ctrl.approveRequest);
router.post('/:id/decline', ctrl.declineRequest);
router.post('/:id/revoke', ctrl.revokeRequest);

router.use(errorHandler);

module.exports = router;
