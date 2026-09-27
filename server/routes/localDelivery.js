'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/localDeliveryController');

const router = express.Router();

router.post('/quote', requireAuth, controller.quote);
router.post('/jobs', requireAuth, controller.create);
router.get('/jobs', requireAuth, controller.list);
router.get('/jobs/:id', requireAuth, controller.get);
router.post('/jobs/:id/claim', requireAuth, controller.claim);
router.patch('/jobs/:id/status', requireAuth, controller.updateStatus);

module.exports = router;
