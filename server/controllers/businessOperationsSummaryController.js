'use strict';

const pool = require('../db');
const logger = require('../utils/logger');
const { collectBusinessOperations } = require('../services/businessOperationsSummary');

async function getBusinessOperationsSummary(req, res, next) {
  try {
    res.set('Cache-Control', 'private, no-store');
    const data = await collectBusinessOperations({ db: pool, businessId: req.business.id, userId: req.user.id,
      role: req.businessRole, permissions: req.permissions, log: logger });
    res.json({ data });
  } catch (error) { next(error); }
}

module.exports = { getBusinessOperationsSummary };
