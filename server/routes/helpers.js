// server/routes/helpers.js
// Public helper discovery — no authentication required.

const express = require('express');
const router  = express.Router();
const { listHelpers, getHelperProfile } = require('../controllers/helpersController');

router.get('/',           listHelpers);
router.get('/:id/profile', getHelperProfile);

module.exports = router;
