const express = require('express');
const router = express.Router();
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/businessTemplatesController');

router.get('/:businessId/message-templates', requireAuth, requireBusinessAccess({ minRole: 'any', resolvePermissions: false }), ctrl.list);
router.post('/:businessId/message-templates', requireAuth, requireBusinessAccess({ minRole: 'any', resolvePermissions: false }), ctrl.create);
router.put('/:businessId/message-templates/:id', requireAuth, requireBusinessAccess({ minRole: 'any', resolvePermissions: false }), ctrl.update);
router.delete('/:businessId/message-templates/:id', requireAuth, requireBusinessAccess({ minRole: 'any', resolvePermissions: false }), ctrl.remove);
router.post('/:businessId/message-templates/:id/use', requireAuth, requireBusinessAccess({ minRole: 'any', resolvePermissions: false }), ctrl.use);

module.exports = router;
