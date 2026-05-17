const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/staffSchedulingController');

router.get('/:businessId/staff-schedule', requireAuth, ctrl.getWeekSchedule);
router.post('/:businessId/staff-schedule', requireAuth, ctrl.createShift);
router.delete('/:businessId/staff-schedule/:id', requireAuth, ctrl.deleteShift);
router.post('/:businessId/time-entries', requireAuth, ctrl.logHours);
router.get('/:businessId/time-entries', requireAuth, ctrl.getTimeEntries);
router.delete('/:businessId/time-entries/:id', requireAuth, ctrl.deleteTimeEntry);

module.exports = router;
