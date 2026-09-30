'use strict';

/**
 * Settings change-management routes.
 *
 * Mounted by server/index.js (see the mount lines reported with this file).
 * All routes require an authenticated admin. Proposing, listing, previewing
 * and cancelling need the manage_settings grant; approving, rejecting and
 * scheduling need the approve_settings grant (separation of duties is
 * enforced in the controller on top of the grant check).
 */

const express = require('express');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const settingsChangeController = require('../controllers/settingsChangeController');

const router = express.Router();

router.use(requireAdmin);

router.post('/', requirePermission('manage_settings'), settingsChangeController.proposeChange);
router.get('/', requirePermission('manage_settings'), settingsChangeController.listChanges);
router.get('/:id/preview', requirePermission('manage_settings'), settingsChangeController.previewChange);
router.post('/:id/approve', requirePermission('approve_settings'), settingsChangeController.approveChange);
router.post('/:id/reject', requirePermission('approve_settings'), settingsChangeController.rejectChange);
router.post('/:id/schedule', requirePermission('approve_settings'), settingsChangeController.scheduleChange);
router.post('/:id/cancel', requirePermission('manage_settings'), settingsChangeController.cancelChange);

module.exports = router;
