'use strict';

const express = require('express');
const controller = require('../controllers/supportChannelWebhookController');

const router = express.Router();
router.post('/:channel', controller.ingestChannelWebhook);

module.exports = router;
