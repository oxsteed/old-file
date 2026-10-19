'use strict';
const express = require('express');
const ctrl = require('../controllers/broadcastTrackingController');

const router = express.Router();
router.get('/o/:token', ctrl.emailOpen);
router.post('/p/:token', ctrl.pushOpen);
router.get('/c/:token/:index', ctrl.click);
router.get('/u/:token', ctrl.unsubscribePage);
router.post('/u/:token', ctrl.unsubscribe);
module.exports = router;
