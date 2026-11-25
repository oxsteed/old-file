'use strict';
// Groups 5-6 item 265 (G5-5 HIGH): job exceptions, thin handlers over
// services/jobExceptionService.js.
const jobExceptions = require('../services/jobExceptionService');

exports.raiseJobException = async (req, res, next) => {
  try {
    const row = await jobExceptions.raise(req.params.id, req.user.id, req.body);
    return res.status(201).json({ success: true, exception: row, kinds: jobExceptions.KINDS });
  } catch (err) { next(err); }
};

exports.getJobExceptions = async (req, res, next) => {
  try {
    const result = await jobExceptions.summary(req.params.id, req.user.id);
    return res.json({ success: true, ...result, kinds: jobExceptions.KINDS });
  } catch (err) { next(err); }
};

exports.updateJobException = async (req, res, next) => {
  try {
    const row = await jobExceptions.update(req.params.id, req.params.exceptionId, req.user.id, req.body);
    return res.json({ success: true, exception: row });
  } catch (err) { next(err); }
};
