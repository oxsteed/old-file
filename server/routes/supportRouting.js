const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const supportRoutingController = require('../controllers/supportRoutingController');
const db = require('../db');

async function resolveSupportBusinessId(req) {
  if (req.params.businessId) return req.params.businessId;
  if (req.body.businessId || req.body.business_id) return req.body.businessId || req.body.business_id;
  if (req.query.business_id || req.query.businessId) return req.query.business_id || req.query.businessId;

  const { rows } = await db.query(
    `SELECT id
     FROM businesses
     WHERE is_active = TRUE
     ORDER BY is_primary DESC, created_at ASC
     LIMIT 1`
  );
  return rows[0]?.id || null;
}

router.get('/status', requireAuth, supportRoutingController.getStatus);

router.post('/connect', requireAuth, async (req, res, next) => {
  try {
    const businessId = await resolveSupportBusinessId(req);
    if (!businessId) return res.status(400).json({ error: 'No support business is available' });
    req.params.businessId = businessId;
    return supportRoutingController.connectConversation(req, res, next);
  } catch (err) {
    next(err);
  }
});

router.post('/conversations', requireAuth, async (req, res, next) => {
  try {
    const businessId = await resolveSupportBusinessId(req);
    if (!businessId) return res.status(400).json({ error: 'No support business is available' });
    req.params.businessId = businessId;
    req.body = {
      ...req.body,
      customerId: req.body.customerId || req.user.id,
      visitorName: req.body.visitorName || req.user.name || req.user.email || 'Customer',
    };
    return supportRoutingController.createConversation(req, res, next);
  } catch (err) {
    next(err);
  }
});

// Create new support conversation with auto-routing
router.post('/:businessId/conversations', requireAuth, supportRoutingController.createConversation);

// Get conversation details with messages
router.get('/:businessId/conversations/:ticketId', requireAuth, supportRoutingController.getConversation);

// Send message to conversation
router.post('/:businessId/conversations/:ticketId/message', requireAuth, supportRoutingController.sendMessage);

// Update conversation status
router.put('/:businessId/conversations/:ticketId/status', requireAuth, supportRoutingController.updateStatus);

// Manually assign ticket to agent
router.post('/:businessId/conversations/:ticketId/assign', requireAuth, supportRoutingController.assignToAgent);

// Get WebSocket connection status (for monitoring)
router.get('/:businessId/status', requireAuth, supportRoutingController.getStatus);

module.exports = router;
