// server/routes/profileSlugs.js
// Public vanity-slug availability checks: GET /api/profile-slugs/check?slug=&type=

const express = require('express');
const router = express.Router();
const { checkSlugAvailability } = require('../controllers/profileSlugController');
const { generalLimiter } = require('../middleware/rateLimiter');

router.get('/check', generalLimiter, checkSlugAvailability);

module.exports = router;
