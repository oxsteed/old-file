const express = require('express');
const router = express.Router();
const { scopeExempt } = require('../middleware/scopeGates');
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const ctrl = require('../controllers/businessWaitlistController');
// WP-055: the business queue is a calendar-wide surface (customer names and
// emails): reading needs customers.view_all (the hub tab's gate) or calendar.view_all,
// acting needs calendar.manage_all.
const requirePermission = require('../middleware/requirePermission');

router.get   ('/:businessId/waitlist',               requireAuth, requireBusinessAccess({ minRole: 'any' }),     requirePermission(['customers.view_all', 'calendar.view_all']), ctrl.listWaitlist);
router.post  ('/:businessId/waitlist',               requireAuth,                                                scopeExempt('public-intake'), ctrl.addToWaitlist);
router.put   ('/:businessId/waitlist/:entryId',      requireAuth, requireBusinessAccess({ minRole: 'any' }),     requirePermission('calendar.manage_all'), ctrl.updateWaitlistEntry);
router.delete('/:businessId/waitlist/:entryId',      requireAuth, requireBusinessAccess({ minRole: 'any' }),     requirePermission('calendar.manage_all'), ctrl.removeFromWaitlist);

module.exports = router;
