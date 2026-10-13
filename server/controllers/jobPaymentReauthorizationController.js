'use strict';

const { AppError } = require('../middleware/errorHandler');
const service = require('../services/jobPaymentReauthorizationService');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jobIdFrom(req) {
  const id = String(req.params.id || '');
  if (!UUID_RE.test(id)) throw new AppError('Job not found', 404, 'job_not_found');
  return id;
}

exports.getPaymentReauthorization = async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await service.getReauthorizationState(jobIdFrom(req), req.user));
  } catch (err) {
    next(err);
  }
};

exports.startPaymentReauthorization = async (req, res, next) => {
  try {
    const jobId = jobIdFrom(req);
    const method = req.body?.method === 'credit' ? 'credit' : req.body?.method === undefined || req.body?.method === 'card' ? 'card' : null;
    if (!method) throw new AppError('Validation failed', 422, 'validation_failed', { method: 'invalid_option' });
    const result = method === 'credit'
      ? await service.authorizeWithCredit({ jobId, user: req.user, isImpersonated: Boolean(req.isImpersonated) })
      : await service.startCardReauthorization({ jobId, user: req.user });
    res.set('Cache-Control', 'no-store');
    res.status(result.status === 'requires_confirmation' ? 201 : 200).json(result);
  } catch (err) {
    next(err);
  }
};

exports.confirmPaymentReauthorization = async (req, res, next) => {
  try {
    const attemptId = String(req.params.attemptId || '');
    if (!/^\d{1,18}$/.test(attemptId)) throw new AppError('Authorization attempt not found', 404, 'payment_reauthorization_not_found');
    const result = await service.confirmCardReauthorization({ jobId: jobIdFrom(req), user: req.user, attemptId });
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (err) {
    next(err);
  }
};
