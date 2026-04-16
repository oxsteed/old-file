const express = require('express');
const router = express.Router();
const { generalLimiter } = require('../middleware/rateLimiter');
const { translate, languages } = require('../controllers/translateController');

// Language list is public and cheap (served from in-process cache after first fetch)
router.get('/languages', languages);

// Translation endpoint: rate-limited but public so guest users can translate content
router.post('/', generalLimiter, translate);

module.exports = router;
