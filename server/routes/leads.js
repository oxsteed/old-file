const express = require('express');
const { authenticate } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');
const leadController = require('../controllers/leadController');

const router = express.Router();

// Rate limiting
router.use(generalLimiter);

// ── Customer endpoints ────────────────────────────────────────────────────

// GET customer's leads
router.get('/my', authenticate, leadController.getMyLeads);

// ── Business endpoints (must come before /:leadId to avoid route conflicts) ──

// GET business's received leads
router.get('/business/:businessId', authenticate, leadController.getBusinessLeads);

// ── Shared/parameterized endpoints ────────────────────────────────────────

// POST create a new lead request for a business
router.post('/:businessId/request', authenticate, leadController.createLead);

// GET single lead details (customer or business can view)
router.get('/:leadId', authenticate, leadController.getLead);

// POST accept a quote (customer only)
router.post('/:quoteId/accept-quote', authenticate, leadController.acceptQuote);

// POST submit a quote for a lead (business only)
router.post('/:leadId/quote', authenticate, leadController.submitQuote);

// POST reject a lead
router.post('/:leadId/reject', authenticate, leadController.rejectLead);

// POST mark lead as completed
router.post('/:leadId/complete', authenticate, leadController.completeLead);

module.exports = router;
