'use strict';

// Review P3-891: super-admin API for failed webhook receipts.
const svc = require('../services/webhookReceiptRecoveryService');

exports.list = async (req, res, next) => {
  try {
    const provider = ['stripe', 'didit'].includes(req.query.provider) ? req.query.provider : null;
    res.json({ receipts: await svc.listFailedReceipts({ provider, limit: req.query.limit }) });
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
