'use strict';

// Public broadcast tracking (analytics decision 1). Tokens are 256-bit per
// recipient; every endpoint answers the same way for unknown tokens so they
// cannot be probed, and only links captured from the broadcast can be
// redirected to (no open redirect).
const pool = require('../db');
const logger = require('../utils/logger');
const broadcasts = require('../services/broadcastDeliveryService');

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

exports.emailOpen = async (req, res) => {
  const token = String(req.params.token || '').replace(/\.gif$/i, '');
  await broadcasts.recordOpen(pool, token, 'email').catch(err => logger.warn('[broadcast] open not recorded', { error: err.message }));
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, max-age=0', 'Content-Length': GIF.length });
  res.end(GIF);
};

exports.pushOpen = async (req, res) => {
  await broadcasts.recordOpen(pool, req.params.token, 'push').catch(err => logger.warn('[broadcast] push open not recorded', { error: err.message }));
  res.status(204).end();
};

exports.click = async (req, res) => {
  let target = null;
  try { target = await broadcasts.recordClick(pool, req.params.token, req.params.index); }
  catch (err) { logger.warn('[broadcast] click not recorded', { error: err.message }); }
  if (!target) return res.status(404).type('text/plain').send('Not found');
  res.set('Cache-Control', 'no-store');
  res.redirect(302, target);
};

function language(req, recipient) {
  return recipient?.preferred_language || String(req.headers['accept-language'] || 'en').slice(0, 2);
}

// GET never mutates (mail scanners prefetch links): it shows a confirm form.
exports.unsubscribePage = async (req, res) => {
  const recipient = await broadcasts.recipientByToken(pool, req.params.token).catch(() => null);
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  res.status(recipient ? 200 : 404).type('html').send(broadcasts.unsubscribePage({
    state: recipient ? 'confirm' : 'invalid', language: language(req, recipient), business: recipient?.business_name,
    actionUrl: req.originalUrl, // post back to this same URL (same origin)
  }));
};

// POST: confirm form or RFC 8058 one-click (List-Unsubscribe=One-Click).
exports.unsubscribe = async (req, res) => {
  const oneClick = req.body && req.body['List-Unsubscribe'] === 'One-Click';
  let recipient = null;
  try { recipient = await broadcasts.unsubscribe(pool, req.params.token, oneClick ? 'one_click' : 'unsubscribe_link'); }
  catch (err) {
    logger.error('[broadcast] unsubscribe failed', { error: err.message });
    return res.status(503).type('text/plain').send('Please try again shortly');
  }
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  if (oneClick) return res.status(recipient ? 200 : 404).json({ success: Boolean(recipient) });
  res.status(recipient ? 200 : 404).type('html').send(broadcasts.unsubscribePage({
    state: recipient ? 'done' : 'invalid', language: language(req, recipient), business: recipient?.business_name,
  }));
};
