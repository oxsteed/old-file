'use strict';

const express = require('express');
const router = express.Router();
const { optionalAuth } = require('../middleware/auth');
const ctrl = require('../controllers/mainAppController');

router.get('/home', optionalAuth, ctrl.getHomeDashboard);

module.exports = router;
