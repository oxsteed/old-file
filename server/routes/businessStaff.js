const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const ctrl = require('../controllers/businessStaffScheduleController');

router.get   ('/:businessId/staff/shifts',               requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.listShifts);
router.post  ('/:businessId/staff/shifts',               requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.createShift);
router.put   ('/:businessId/staff/shifts/:shiftId',      requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.updateShift);
router.delete('/:businessId/staff/shifts/:shiftId',      requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.deleteShift);

router.get   ('/:businessId/staff/time-entries',         requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.listTimeEntries);
router.post  ('/:businessId/staff/clock-in',             requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.clockIn);
router.post  ('/:businessId/staff/clock-out/:entryId',   requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.clockOut);

module.exports = router;
