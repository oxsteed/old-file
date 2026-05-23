'use strict';

const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/internalWorkspacesController');

router.use(authenticate);

router.get('/catalog', ctrl.getCatalog);
router.get('/:workspace', ctrl.getWorkspaceDashboard);

module.exports = router;
