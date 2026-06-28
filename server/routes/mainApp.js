'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const ctrl = require('../controllers/mainAppController');

router.get('/home', optionalAuth, ctrl.getHomeDashboard);
router.get('/activity', authenticate, ctrl.getActivityFeed);

module.exports = router;
