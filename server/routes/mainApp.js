'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const ctrl = require('../controllers/mainAppController');

router.get('/home', optionalAuth, ctrl.getHomeDashboard);
router.get('/activity', authenticate, ctrl.getActivityFeed);
router.get('/profile-summary', authenticate, ctrl.getProfileSummary);
router.get('/business-hub', authenticate, ctrl.getBusinessHub);

module.exports = router;
