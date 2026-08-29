const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { generalLimiter } = require('../middleware/rateLimiter');
const ctrl = require('../controllers/quoteRequestsController');

router.post('/', generalLimiter, ctrl.createQuoteRequest);
router.get('/my', authenticate, ctrl.getMyQuoteRequests);
router.get('/admin/list', authenticate, requireAdmin, ctrl.listQuoteRequests);
router.patch('/admin/:id', authenticate, requireAdmin, ctrl.updateQuoteRequestAdmin);
router.get('/:id', authenticate, ctrl.getQuoteRequest);

module.exports = router;
