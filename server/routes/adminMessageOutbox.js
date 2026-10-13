'use strict';

// P1-268: admin visibility and retry for dead-lettered chat notifications.
// Mounted at /api/admin/message-notification-outbox behind requireAdmin.
const router = require('express').Router();
const { requireAdmin } = require('../middleware/adminAuth');
const { errorHandler, AppError } = require('../middleware/errorHandler');
const outbox = require('../jobs/messageNotificationOutbox');
const { logAdminAction } = require('../services/auditService');

router.use(requireAdmin);

router.get('/failed', async (req, res, next) => {
  try {
    res.json(await outbox.listFailedMessageNotifications({ limit: req.query.limit, offset: req.query.offset }));
  } catch (err) { next(err); }
});

router.post('/retry', async (req, res, next) => {
  try {
    const all = req.body?.all === true;
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
    if (!all && (!ids || ids.length === 0)) {
      throw new AppError('Pass ids or all: true', 400, 'validation_failed');
    }
    const retried = await outbox.retryFailedMessageNotifications(all ? null : ids);
    await logAdminAction({
      adminId: req.user.id,
      action: 'message_notification_outbox.retry',
      targetType: 'message_notification_outbox',
      targetKey: all ? 'all' : retried.slice(0, 20).join(','),
      description: `Requeued ${retried.length} failed message notification(s)`,
      req,
    });
    res.json({ retried: retried.length });
  } catch (err) { next(err); }
});

router.use(errorHandler);
module.exports = router;
