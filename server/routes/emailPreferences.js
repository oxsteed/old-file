const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const emailPreferencesController = require('../controllers/emailPreferencesController');

// Get email preferences (authenticated)
router.get('/', requireAuth, emailPreferencesController.getEmailPreferences);

// Update email preferences (authenticated)
router.put('/', requireAuth, emailPreferencesController.updateEmailPreferences);

// Unsubscribe from all emails (authenticated)
router.post('/unsubscribe-all', requireAuth, emailPreferencesController.unsubscribeFromAll);

// Explicit re-subscribe to all emails (authenticated, item 5). The only
// ordinary path that clears unsubscribe_all; saving other email
// preferences never does.
router.post('/resubscribe-all', requireAuth, emailPreferencesController.resubscribeAll);

// RFC 8058 one-click unsubscribe (no auth; token in query string or body)
router.post('/unsubscribe-one-click', emailPreferencesController.unsubscribeOneClick);

// Handle unsubscribe via email link (no auth required)
router.get('/unsubscribe/:token', emailPreferencesController.handleUnsubscribeLink);

// Confirm unsubscribe via POST (no auth required)
router.post('/unsubscribe/:token', emailPreferencesController.confirmUnsubscribe);

module.exports = router;
