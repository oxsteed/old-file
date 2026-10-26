const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const ctrl = require('../controllers/businessStaffScheduleController');

router.get   ('/:businessId/staff/shifts',               requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.listShifts);
router.post  ('/:businessId/staff/shifts',               requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.createShift);
router.put   ('/:businessId/staff/shifts/:shiftId',      requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.updateShift);
router.delete('/:businessId/staff/shifts/:shiftId',      requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.deleteShift);
// S-04: schedule publishing — drafts go live and notify assigned staff.
router.post  ('/:businessId/staff/shifts/publish',       requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.publishShifts);
// S-20: native labor-law jurisdiction rules per location.
router.get   ('/:businessId/staff/labor-jurisdiction',    requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.getLaborJurisdiction);
router.put   ('/:businessId/staff/labor-jurisdiction',    requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.setLaborJurisdiction);
// S-04: time-off / PTO requests.
router.get   ('/:businessId/staff/time-off',             requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.listTimeOffRequests);
router.post  ('/:businessId/staff/time-off',             requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.createTimeOffRequest);
router.post  ('/:businessId/staff/time-off/:requestId/decide', requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.decideTimeOffRequest);
router.post  ('/:businessId/staff/time-off/:requestId/cancel', requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.cancelTimeOffRequest);
router.get   ('/:businessId/staff/availability',          requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.listAvailability);
router.put   ('/:businessId/staff/availability',          requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.replaceAvailability);
router.get   ('/:businessId/staff/shift-swaps',           requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.listShiftSwapRequests);
router.post  ('/:businessId/staff/shifts/:shiftId/swap-requests', requireAuth, requireBusinessAccess({ minRole: 'any' }), ctrl.createShiftSwapRequest);
router.post  ('/:businessId/staff/shift-swaps/:requestId/approve', requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.approveShiftSwapRequest);
router.post  ('/:businessId/staff/shift-swaps/:requestId/reject', requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.rejectShiftSwapRequest);

router.get   ('/:businessId/staff/time-entries',         requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.listTimeEntries);
router.get   ('/:businessId/staff/time-entries/mine',    requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.listMyTimeEntries);
router.post  ('/:businessId/staff/clock-in',             requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.clockIn);
router.post  ('/:businessId/staff/clock-out/:entryId',   requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.clockOut);
router.post  ('/:businessId/staff/time-entries/:entryId/break', requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.punchBreak);
router.patch ('/:businessId/staff/time-entries/:entryId',       requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.editTimeEntry);
router.post  ('/:businessId/staff/time-entries/:entryId/void',  requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.voidTimeEntry);

module.exports = router;
