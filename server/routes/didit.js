// server/routes/didit.js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { createSession, getStatus } = require('../controllers/diditController');

// Authenticated: create session + check status
router.post('/session',  authenticate, createSession);
router.get('/status',    authenticate, getStatus);

// NOTE: The Didit webhook handler (handleWebhook) is intentionally NOT in this
// router. It is mounted directly in index.js with express.raw() before
// express.json() so it receives a raw Buffer for HMAC signature verification.

module.exports = router;
