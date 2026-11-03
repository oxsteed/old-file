'use strict';

// Customer 360 upgrade 6: business-scoped, read-only, audited.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const ctrl = require('../controllers/businessCustomer360Controller');

router.get('/:businessId/customer360/customers', requireAuth, requireBusinessAccess({ minRole: 'any' }), ctrl.list);
router.get('/:businessId/customer360/customers/:customerKey', requireAuth, requireBusinessAccess({ minRole: 'any' }), ctrl.profile);

module.exports = router;
