'use strict';

// Review P3-891: super-admin API for failed webhook receipts.
const svc = require('../services/webhookReceiptRecoveryService');

exports.list = async (req, res, next) => {
  try {
    const provider = ['stripe', 'didit'].includes(req.query.provider) ? req.query.provider : null;
    const status = ['failed', 'processing', 'resolved'].includes(req.query.status) ? req.query.status : null;
    const restaurantId = Number.parseInt(req.query.restaurantId || req.query.restaurant_id, 10);
    res.json(await svc.listFailedReceipts({
      provider,
      limit: req.query.limit,
      offset: req.query.offset,
      eventType: req.query.eventType || req.query.event_type || null,
      account: req.query.account || req.query.accountId || req.query.account_id || null,
      status,
      restaurantId: Number.isInteger(restaurantId) && restaurantId > 0 ? restaurantId : null,
    }));
  } catch (err) { next(err); }
};

exports.replay = async (req, res, next) => {
  try {
    const out = await svc.replayStripeReceipt(Number(req.params.id), { adminId: req.user.id, req });
    res.status(out.status).json(out);
  } catch (err) { next(err); }
};

exports.resolve = async (req, res, next) => {
  try {
    const out = await svc.resolveReceipt(Number(req.params.id), { adminId: req.user.id, note: req.body?.note, req });
    res.status(out.status).json(out);
  } catch (err) { next(err); }
};
