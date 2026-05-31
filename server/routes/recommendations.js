/**
 * routes/recommendations.js
 * GET /api/recommendations  — authenticated, any role
 */

const express  = require('express');
const router   = express.Router();
const { authenticate } = require('../middleware/auth');
const { getRecommendations } = require('../controllers/recommendationController');

router.get('/', authenticate, getRecommendations);

module.exports = router;
