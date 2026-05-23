'use strict';

const AppError = require('../utils/AppError');
const recurringService = require('../services/recurringProcurementService');

exports.listPrograms = async (req, res, next) => {
  try {
    const rows = await recurringService.listPrograms({
      userId: req.user.id,
      businessId: req.query.business_id || null,
      status: req.query.status || null,
      cadence: req.query.cadence || null,
      includeAll: req.isAdmin && req.query.all === 'true',
      limit: parseInt(req.query.limit || '100', 10),
      offset: parseInt(req.query.offset || '0', 10),
    });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
};

exports.getProgram = async (req, res, next) => {
  try {
    const program = await recurringService.getProgram(req.params.id, {
      userId: req.user.id,
      includeAll: Boolean(req.isAdmin),
    });
    if (!program) return next(new AppError('Recurring procurement program not found', 404, 'not_found'));
    res.json({ success: true, data: program });
  } catch (err) { next(err); }
};

exports.createProgram = async (req, res, next) => {
  try {
    if (!req.body.title) {
      return next(new AppError('title is required', 400, 'validation_failed'));
    }
    const program = await recurringService.createProgram(req.body, req.user.id);
    res.status(201).json({ success: true, data: program });
  } catch (err) { next(err); }
};

exports.updateProgram = async (req, res, next) => {
  try {
    const program = await recurringService.updateProgram(req.params.id, req.body, req.user.id, {
      includeAll: Boolean(req.isAdmin),
    });
    if (!program) return next(new AppError('Recurring procurement program not found', 404, 'not_found'));
    res.json({ success: true, data: program });
  } catch (err) { next(err); }
};

exports.updateProgramStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const valid = ['draft', 'active', 'paused', 'archived'];
    if (!valid.includes(status)) {
      return next(new AppError(`status must be one of: ${valid.join(', ')}`, 400, 'validation_failed'));
    }
    const program = await recurringService.updateProgram(req.params.id, { status }, req.user.id, {
      includeAll: Boolean(req.isAdmin),
    });
    if (!program) return next(new AppError('Recurring procurement program not found', 404, 'not_found'));
    res.json({ success: true, data: program });
  } catch (err) { next(err); }
};
