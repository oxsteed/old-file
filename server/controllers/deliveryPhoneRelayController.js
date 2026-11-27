'use strict';

// S-G2 (D-642): the Twilio voice-relay webhook. When the relay number is
// dialed, Twilio POSTs here; the request is authenticated by Twilio's
// signature (not by a user session), the session is resolved by relay
// number + caller, and the response is TwiML that bridges the call to
// the stop contact's real number — or rejects it when no live session
// matches. The recipient sees the relay number as caller ID, so the
// driver's personal number stays hidden too.
//
// Mounted in index.js before the maintenance gate, like the other
// provider webhooks: a relay call must keep working while the app is
// in maintenance, because the driver is mid-job.
const twilio = require('twilio');
const db = require('../db');
const logger = require('../utils/logger');
const { resolveRelayCall } = require('../services/deliveryPhoneRelayService');

function publicUrl(req) {
  return `${req.protocol}://${req.get('host')}${req.originalUrl}`;
}

async function handleRelayCall(req, res) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return res.sendStatus(403);
  const signature = req.headers['x-twilio-signature'];
  if (!signature) return res.sendStatus(403);
  let valid = false;
  try {
    valid = twilio.validateRequest(authToken, signature, publicUrl(req), req.body || {});
  } catch (err) {
    logger.warn('Delivery phone relay webhook signature check failed', { error: err.message });
    return res.sendStatus(403);
  }
  if (!valid) {
    logger.warn('Delivery phone relay webhook rejected: bad Twilio signature');
    return res.sendStatus(403);
  }
  const resolved = await resolveRelayCall(db, { to: req.body?.To, from: req.body?.From });
  const response = new twilio.twiml.VoiceResponse();
  if (resolved) {
    const dial = response.dial({ callerId: String(req.body.To) });
    dial.number(resolved.targetPhone);
  } else {
    response.reject();
  }
  res.set('Content-Type', 'text/xml');
  return res.send(response.toString());
}

module.exports = { handleRelayCall };
