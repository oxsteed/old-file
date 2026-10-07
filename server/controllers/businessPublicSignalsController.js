'use strict';

// Business-scoped public signals that used to be fetched with the owner's
// user id (GV-5 fallout). None of these responses contain the owner id.
//
//   GET /api/businesses/:id/status      -> { businessId, online, helperStatus }
//   GET /api/businesses/:id/reputation  -> { success, data: {...no userId} }
//
// The Pay link lives in routes/qrPayments.js
// (GET /api/qr-payments/public/business/:businessId/pay-code).

const pool = require('../db');
const logger = require('../utils/logger');
const socketService = require('../services/socketService');
const { resolvePublicBusinessOwner } = require('../services/businessPublicOwner');
const { loadReputationSummary } = require('./reputationController');

function notFound(res) {
  return res.status(404).json({ error: 'Business not found' });
}

async function getBusinessStatus(req, res) {
  try {
    const resolved = await resolvePublicBusinessOwner(req.params.id);
    if (!resolved) return notFound(res);
    // Same signal as GET /api/helpers/:id/status: the owner's manual
    // "available now" toggle, else live socket presence.
    const { rows: [hp] } = await pool.query(
      'SELECT is_available_now FROM helper_profiles WHERE user_id = $1',
      [resolved.ownerId]
    );
    const online = !!hp?.is_available_now || socketService.isOnline(resolved.ownerId);
    return res.json({
      businessId: String(resolved.businessId),
      online,
      helperStatus: online ? 'live' : 'ai_assistant',
    });
  } catch (err) {
    logger.error('getBusinessStatus error', { err: err.message });
    return res.status(500).json({ error: 'Failed to load status' });
  }
}

async function getBusinessReputation(req, res) {
  try {
    const resolved = await resolvePublicBusinessOwner(req.params.id);
    if (!resolved) return notFound(res);
    const { userId: _omit, ...data } = await loadReputationSummary(resolved.ownerId);
    return res.json({ success: true, data: { businessId: String(resolved.businessId), ...data } });
  } catch (err) {
    logger.error('getBusinessReputation error', { err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch reputation' });
  }
}

module.exports = { getBusinessStatus, getBusinessReputation };
