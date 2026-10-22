const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const ctrl = require('../controllers/businessStaffScheduleController');

router.get   ('/:businessId/staff/shifts',               requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.listShifts);
router.post  ('/:businessId/staff/shifts',               requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.createShift);
router.put   ('/:businessId/staff/shifts/:shiftId',      requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.updateShift);
router.delete('/:businessId/staff/shifts/:shiftId',      requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.deleteShift);
router.get   ('/:businessId/staff/availability',          requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.listAvailability);
router.put   ('/:businessId/staff/availability',          requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.replaceAvailability);
router.get   ('/:businessId/staff/shift-swaps',           requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.listShiftSwapRequests);
router.post  ('/:businessId/staff/shifts/:shiftId/swap-requests', requireAuth, requireBusinessAccess({ minRole: 'any' }), ctrl.createShiftSwapRequest);
router.post  ('/:businessId/staff/shift-swaps/:requestId/approve', requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.approveShiftSwapRequest);
router.post  ('/:businessId/staff/shift-swaps/:requestId/reject', requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.rejectShiftSwapRequest);

router.get   ('/:businessId/staff/time-entries',         requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.listTimeEntries);
router.post  ('/:businessId/staff/clock-in',             requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.clockIn);
router.post  ('/:businessId/staff/clock-out/:entryId',   requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.clockOut);
router.post  ('/:businessId/staff/time-entries/:entryId/break', requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.punchBreak);
router.patch ('/:businessId/staff/time-entries/:entryId',       requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.editTimeEntry);
router.post  ('/:businessId/staff/time-entries/:entryId/void',  requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.voidTimeEntry);

module.exports = router;
