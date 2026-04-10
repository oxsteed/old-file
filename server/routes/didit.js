// server/routes/didit.js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { createSession, handleWebhook, getStatus } = require('../controllers/diditController');

// Authenticated: create session + check status
router.post('/session',  authenticate, createSession);
router.get('/status',    authenticate, getStatus);

// Public: Didit webhook (verify signature in controller)
router.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

module.exports = router;
