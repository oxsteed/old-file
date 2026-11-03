'use strict';

const svc = require('../services/businessCustomer360');

const wrap = (fn) => async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
};

exports.list = wrap(async (req, res) => {
  res.json(await svc.list(req, { search: req.query.search, offset: req.query.offset }));
});
exports.profile = wrap(async (req, res) => {
  res.json(await svc.profile(req, req.params.customerKey));
});
