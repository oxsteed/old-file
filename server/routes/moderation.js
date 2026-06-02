'use strict';

const express = require('express');
const { optionalAuth } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');
const ctrl = require('../controllers/moderationController');

const router = express.Router();

router.get('/blocklist', generalLimiter, ctrl.getBlocklist);
router.post('/flag', generalLimiter, optionalAuth, ctrl.flagContent);

module.exports = router;
