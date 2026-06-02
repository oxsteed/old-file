// server/routes/didit.js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { createSession, getStatus, skipVerification } = require('../controllers/diditController');

// Authenticated: create session + check status
router.post('/session',  authenticate, createSession);
router.post('/start',    authenticate, createSession);
router.get('/status',    authenticate, getStatus);

// Skip verification - only succeeds when DIDIT_API_KEY is absent (dev/staging).
// Returns 403 when Didit is configured (production).
router.post('/skip', authenticate, skipVerification);

// NOTE: The Didit webhook handler (handleWebhook) is intentionally NOT in this
// router. It is mounted directly in index.js with express.raw() before
// express.json() so it receives a raw Buffer for HMAC signature verification.

module.exports = router;
