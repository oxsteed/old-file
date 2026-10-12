// server/routes/didit.js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { createSession, getStatus, skipVerification } = require('../controllers/diditController');

// Authenticated: create session + check status
router.post('/session',  authenticate, createSession);
router.post('/start',    authenticate, createSession);
router.get('/status',    authenticate, getStatus);

// Skip verification (P1-334: comment matches the code). Allowed unless
// DIDIT_ALLOW_USER_SKIP=false or the user has didit_enforcement_required;
// otherwise 403. Skipping grants no credit tier and no participant
// activation, so no money path opens on skip.
router.post('/skip', authenticate, skipVerification);

// NOTE: The live Didit webhook is webhookController.diditWebhook, mounted at
// /api/webhooks/didit (routes/webhook.js) and /api/didit/webhook (index.js)
// with express.raw() for HMAC verification. diditController.handleWebhook is
// a legacy handler that is not mounted anywhere; both share the entity
// linking in services/diditEntityLink.js.

module.exports = router;
