'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const runnerWorkspace = require('../controllers/runnerWorkspaceController');

const router = express.Router();

router.use(authenticate);
router.get('/workspaces', runnerWorkspace.listWorkspaces);
router.get('/inbox', runnerWorkspace.getUnifiedInbox);

module.exports = router;
