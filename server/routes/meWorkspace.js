'use strict';

/**
 * /api/me/businesses and /api/me/workspace-context endpoints, used by
 * the BusinessSwitcher and the workspace landing logic.
 *
 * Mounted as:
 *   app.use('/api/me', meWorkspaceRoutes);
 */

const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');

const team = require('../controllers/businessTeamController');

router.get('/businesses',           authenticate, team.getMyBusinesses);
router.post('/workspace-context',   authenticate, team.setWorkspaceContext);

module.exports = router;
