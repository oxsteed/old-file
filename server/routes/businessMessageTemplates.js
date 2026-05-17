const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/businessTemplatesController');

router.get('/:businessId/message-templates', requireAuth, ctrl.list);
router.post('/:businessId/message-templates', requireAuth, ctrl.create);
router.put('/:businessId/message-templates/:id', requireAuth, ctrl.update);
router.delete('/:businessId/message-templates/:id', requireAuth, ctrl.remove);
router.post('/:businessId/message-templates/:id/use', requireAuth, ctrl.use);

module.exports = router;
