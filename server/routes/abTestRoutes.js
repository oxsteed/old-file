const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const ABTestController = require('../controllers/ABTestController');

// Create new A/B test
router.post('/', requireAuth, ABTestController.createTest);

// Get all tests for user
router.get('/', requireAuth, ABTestController.getTests);

// Get single test detail with statistics
router.get('/:test_id', requireAuth, ABTestController.getTest);

// Start test (draft → running)
router.post('/:test_id/start', requireAuth, ABTestController.startTest);

// Pause test
router.post('/:test_id/pause', requireAuth, ABTestController.pauseTest);

// End test (running → completed, calculate final statistics)
router.post('/:test_id/end', requireAuth, ABTestController.endTest);

// Record assignment (assign visitor to variant)
router.post('/:test_id/assign', requireAuth, ABTestController.recordAssignment);

// Record event (view, click, conversion)
router.post('/assignment/:assignment_id/event', requireAuth, ABTestController.recordEvent);

module.exports = router;
