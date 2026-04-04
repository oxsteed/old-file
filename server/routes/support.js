const router = require('express').Router();
const { submitSupportRequest } = require('../controllers/supportController');

// Public — no auth required (customers, non-members, and logged-in users can all submit)
router.post('/request', submitSupportRequest);

module.exports = router;
