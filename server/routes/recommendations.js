/**
 * routes/recommendations.js
 * GET /api/recommendations  — authenticated, any role
 */

const express  = require('express');
const router   = express.Router();
const { authenticate } = require('../middleware/auth');
const {
  getRecommendations,
  dismissRecommendation,
} = require('../controllers/recommendationController');

router.get('/', authenticate, getRecommendations);
router.post('/:id/dismiss', authenticate, dismissRecommendation);

module.exports = router;
