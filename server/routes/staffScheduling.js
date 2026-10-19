const express = require('express');
const router = express.Router();
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/staffSchedulingController');

router.get('/:businessId/staff-schedule', requireAuth, requireBusinessAccess({ minRole: 'manager', resolvePermissions: false }), ctrl.getWeekSchedule);
router.post('/:businessId/staff-schedule', requireAuth, requireBusinessAccess({ minRole: 'manager', resolvePermissions: false }), ctrl.createShift);
router.delete('/:businessId/staff-schedule/:id', requireAuth, requireBusinessAccess({ minRole: 'manager', resolvePermissions: false }), ctrl.deleteShift);
router.post('/:businessId/time-entries', requireAuth, requireBusinessAccess({ minRole: 'manager', resolvePermissions: false }), ctrl.logHours);
router.get('/:businessId/time-entries', requireAuth, requireBusinessAccess({ minRole: 'manager', resolvePermissions: false }), ctrl.getTimeEntries);
router.delete('/:businessId/time-entries/:id', requireAuth, requireBusinessAccess({ minRole: 'manager', resolvePermissions: false }), ctrl.deleteTimeEntry);

module.exports = router;
