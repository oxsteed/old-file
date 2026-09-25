'use strict';

const pool = require('../db');
const socketService = require('../services/socketService');
const { broadcastGuestChatMessage } = socketService;

const INTAKE_MARKER = '[[OXS_CLIENT_INTAKE]]';
const RESPONSE_MARKER = '[[OXS_CLIENT_INTAKE_RESPONSE]]';

function cleanText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function normalizeFields(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 12).map((field, index) => {
    const type = ['text', 'textarea', 'number', 'date', 'select'].includes(field?.type)
      ? field.type : 'text';
    const options = Array.isArray(field?.options)
      ? field.options.map((option) => cleanText(option, 80)).filter(Boolean).slice(0, 20)
      : [];
    return {
      id: cleanText(field?.id || `field_${index + 1}`, 60).replace(/[^a-zA-Z0-9_-]/g, '_'),
      label: cleanText(field?.label, 160) || `Question ${index + 1}`,
      type,
      required: field?.required !== false,
      options,
    };
  });
}

async function assertProviderAccess(userId, sessionId) {
  const { rows } = await pool.query(
    `SELECT g.id, g.helper_id, g.business_id, g.guest_name, g.guest_email
       FROM guest_profile_chat_inbound g
      WHERE g.id = $1`,
    [sessionId],
  );
  const session = rows[0];
  if (!session) return null;
  if (String(session.helper_id) === String(userId)) return session;
  if (session.business_id != null) {
    const rep = await pool.query(
      `SELECT 1 FROM business_members WHERE business_id = $1 AND member_id = $2 AND status = 'active'`,
      [session.business_id, userId],
    );
    if (rep.rows.length) return session;
  }
  const error = new Error('Forbidden');
  error.status = 403;
  throw error;
}

function encodeMarker(prefix, payload) {
  return `${prefix}${JSON.stringify(payload)}`;
}

async function createIntake(req, res, next) {
  try {
    const body = req.body || {};
    const sessionId = String(body.guestSessionId || body.sessionId || '').trim();
    if (!sessionId) return res.status(400).json({ error: 'guestSessionId is required' });
    const session = await assertProviderAccess(req.user.id, sessionId);
    if (!session) return res.status(404).json({ error: 'Guest session not found' });

    const title = cleanText(body.title, 160);
    if (!title) return res.status(400).json({ error: 'A title is required' });
    const fields = normalizeFields(body.fields);
    if (!fields.length) return res.status(400).json({ error: 'Add at least one intake question' });
    const description = cleanText(body.description, 1000) || null;
    const { rows } = await pool.query(
      `INSERT INTO guest_profile_chat_intakes
         (session_id, helper_id, business_id, title, description, fields)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id, session_id, helper_id, business_id, title, description, fields, status, created_at`,
      [sessionId, session.helper_id, session.business_id || null, title, description, JSON.stringify(fields)],
    );
    const intake = rows[0];
    const marker = encodeMarker(INTAKE_MARKER, {
      id: intake.id,
      title: intake.title,
      description: intake.description,
      fields: intake.fields,
      status: intake.status,
    });
    const message = await pool.query(
      `INSERT INTO guest_profile_chat_messages (session_id, sender_type, sender_name, message)
       VALUES ($1, 'helper', $2, $3)
       RETURNING id, created_at`,
      [sessionId, `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'Helper', marker],
    );
    await pool.query(
      `UPDATE guest_profile_chat_inbound
          SET last_helper_message_at = NOW(), last_activity_at = NOW(),
              helper_messages_count = COALESCE(helper_messages_count, 0) + 1
        WHERE id = $1`,
      [sessionId],
    );
    const msg = message.rows[0];
    broadcastGuestChatMessage(sessionId, {
      messageId: msg.id,
      senderType: 'helper',
      senderName: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'Helper',
      message: marker,
      createdAt: msg.created_at instanceof Date ? msg.created_at.toISOString() : msg.created_at,
    });
    res.status(201).json({ intake, messageId: msg.id });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
}

async function getIntake(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT i.*, g.guest_name, g.guest_email, g.helper_id AS session_helper_id
         FROM guest_profile_chat_intakes i
         JOIN guest_profile_chat_inbound g ON g.id = i.session_id
        WHERE i.id = $1`,
      [req.params.id],
    );
    const intake = rows[0];
    if (!intake) return res.status(404).json({ error: 'Intake not found' });
    const isGuest = req.guestSession && String(req.guestSession.id) === String(intake.session_id);
    let isProvider = false;
    if (req.user) {
      try {
        await assertProviderAccess(req.user.id, intake.session_id);
        isProvider = true;
      } catch (error) {
        if (error.status !== 403) throw error;
      }
    }
    if (!isGuest && !isProvider) return res.status(403).json({ error: 'Forbidden' });
    res.json({ intake });
  } catch (error) { next(error); }
}

async function respondToIntake(req, res, next) {
  try {
    const session = req.guestSession;
    if (!session) return res.status(401).json({ error: 'Verified guest session required', code: 'auth_error' });
    const { rows } = await pool.query(
      `SELECT i.* FROM guest_profile_chat_intakes i
        WHERE i.id = $1 AND i.session_id = $2 FOR UPDATE`,
      [req.params.id, session.id],
    );
    const intake = rows[0];
    if (!intake) return res.status(404).json({ error: 'Intake not found' });
    if (intake.status !== 'open') return res.status(409).json({ error: 'This intake is no longer accepting responses' });
    const input = req.body?.responses && typeof req.body.responses === 'object' ? req.body.responses : {};
    const responses = {};
    for (const field of Array.isArray(intake.fields) ? intake.fields : []) {
      const value = cleanText(input[field.id], field.type === 'textarea' ? 3000 : 500);
      if (field.required && !value) return res.status(400).json({ error: `${field.label} is required`, field: field.id });
      responses[field.id] = value;
    }
    await pool.query(
      `UPDATE guest_profile_chat_intakes
          SET responses = $2::jsonb, status = 'completed', completed_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [intake.id, JSON.stringify(responses)],
    );
    const marker = encodeMarker(RESPONSE_MARKER, {
      id: intake.id,
      title: intake.title,
      fields: intake.fields,
      responses,
    });
    const message = await pool.query(
      `INSERT INTO guest_profile_chat_messages (session_id, sender_type, sender_name, message)
       VALUES ($1, 'guest', $2, $3) RETURNING id, created_at`,
      [session.id, session.guest_name, marker],
    );
    await pool.query(
      `UPDATE guest_profile_chat_inbound
          SET last_guest_message_at = NOW(), last_activity_at = NOW(),
              guest_messages_count = COALESCE(guest_messages_count, 0) + 1
        WHERE id = $1`,
      [session.id],
    );
    const msg = message.rows[0];
    broadcastGuestChatMessage(session.id, {
      messageId: msg.id,
      senderType: 'guest',
      senderName: session.guest_name,
      message: marker,
      createdAt: msg.created_at instanceof Date ? msg.created_at.toISOString() : msg.created_at,
    });
    res.json({ intake: { ...intake, responses, status: 'completed' }, messageId: msg.id });
  } catch (error) { next(error); }
}

module.exports = { createIntake, getIntake, respondToIntake, INTAKE_MARKER, RESPONSE_MARKER };
