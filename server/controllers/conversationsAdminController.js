'use strict';

const db = require('../db');
const logger = require('../utils/logger');
const { logAdminAction } = require('../services/auditService');
const { normalizeBreakGlassReason } = require('../services/chatThreadAccess');
const { toPublicQuoteCard } = require('../services/chatQuotes');
const { toPublicPopCard } = require('../services/chatProofOfPayment');
const { toPublicAgreementCard } = require('../services/chatAgreements');
const { toPublicPaymentRequestCard } = require('../services/chatOxsteedCreditPayment');

async function writeBreakGlassLog({ adminId, conversationId, guestSessionId, reason, req }) {
  await db.query(
    `INSERT INTO admin_conversation_access_log
       (admin_id, conversation_id, guest_session_id, reason, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      adminId,
      conversationId || null,
      guestSessionId || null,
      reason,
      req?.ip || null,
      req?.headers?.['user-agent'] || null,
    ],
  );
  try {
    await logAdminAction({
      adminId,
      action: 'conversation_break_glass',
      targetType: conversationId ? 'conversation' : 'guest_session',
      targetId: conversationId || guestSessionId,
      description: reason,
      req,
    });
  } catch (e) {
    /* audit best-effort */
  }
}

async function loadLinkedArtifacts(conversationId) {
  const [quotesBiz, quotesHelper, pops, agreements, bookings, paymentRequests] = await Promise.all([
    db
      .query(
        `SELECT * FROM business_quotes WHERE conversation_id = $1 ORDER BY created_at DESC NULLS LAST LIMIT 50`,
        [conversationId],
      )
      .catch(() => ({ rows: [] })),
    db
      .query(
        `SELECT * FROM helper_quotes WHERE conversation_id = $1 ORDER BY created_at DESC NULLS LAST LIMIT 50`,
        [conversationId],
      )
      .catch(() => ({ rows: [] })),
    db
      .query(
        `SELECT * FROM chat_proof_of_payments WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [conversationId],
      )
      .catch(() => ({ rows: [] })),
    db
      .query(
        `SELECT * FROM chat_agreements WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [conversationId],
      )
      .catch(() => ({ rows: [] })),
    db
      .query(
        `SELECT id, status, requested_date, requested_start_time, service_name, created_at, quote_id
           FROM booking_requests
          WHERE conversation_id = $1
          ORDER BY created_at DESC NULLS LAST
          LIMIT 50`,
        [conversationId],
      )
      .catch(() => ({ rows: [] })),
    db
      .query(
        `SELECT * FROM chat_payment_requests WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [conversationId],
      )
      .catch(() => ({ rows: [] })),
  ]);

  return {
    quotes: [
      ...quotesBiz.rows.map((r) => toPublicQuoteCard('business', r)),
      ...quotesHelper.rows.map((r) => toPublicQuoteCard('helper', r)),
    ].filter(Boolean),
    proof_of_payments: pops.rows.map((r) => toPublicPopCard(r)),
    agreements: agreements.rows.map((r) => toPublicAgreementCard(r, { includeBody: true })),
    payment_requests: paymentRequests.rows.map((r) => toPublicPaymentRequestCard(r)),
    bookings: bookings.rows,
  };
}

exports.listConversations = async (req, res) => {
  try {
    const { search = '', status = '', page = 1, limit = 25 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const params = [];
    let p = 1;
    const conds = [];

    if (search) {
      conds.push(
        `(cu.email ILIKE $${p} OR hu.email ILIKE $${p} OR cu.first_name || ' ' || cu.last_name ILIKE $${p} OR hu.first_name || ' ' || hu.last_name ILIKE $${p})`,
      );
      params.push(`%${search}%`);
      p++;
    }
    if (status) {
      conds.push(`c.status = $${p++}`);
      params.push(status);
    }
    const wc = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const { rows } = await db.query(
      `
      SELECT c.id, c.status, c.last_message_at, c.created_at, c.job_id, c.business_id,
             j.title AS job_title,
             cu.id AS customer_id,
             cu.first_name || ' ' || cu.last_name AS customer_name,
             cu.email AS customer_email,
             hu.id AS helper_id,
             hu.first_name || ' ' || hu.last_name AS helper_name,
             hu.email AS helper_email,
             (SELECT COUNT(*)::int FROM messages m WHERE m.conversation_id = c.id) AS message_count
        FROM conversations c
        JOIN users cu ON c.customer_id = cu.id
        JOIN users hu ON c.helper_id = hu.id
        LEFT JOIN jobs j ON c.job_id = j.id
        ${wc}
       ORDER BY c.last_message_at DESC NULLS LAST
       LIMIT $${p} OFFSET $${p + 1}
    `,
      [...params, parseInt(limit, 10), offset],
    );

    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) FROM conversations c JOIN users cu ON c.customer_id = cu.id JOIN users hu ON c.helper_id = hu.id ${wc}`,
      params,
    );

    try {
      await logAdminAction({
        adminId: req.user.id,
        action: 'conversations_list_viewed',
        targetType: 'conversations',
        targetId: null,
        description: search ? `search: ${search}` : null,
        req,
      });
    } catch (e) {
      /* ignore */
    }

    res.json({ conversations: rows, total: parseInt(countRows[0].count, 10) });
  } catch (err) {
    logger.error('listConversations error', { err });
    res.status(500).json({ error: 'Failed to fetch conversations.' });
  }
};

/**
 * Break-glass open: requires reason (query or body). Logs who/when/why/which conversation.
 */
exports.getThread = async (req, res) => {
  try {
    const { id } = req.params;
    const reasonRaw = req.query.reason || req.body?.reason || req.headers['x-break-glass-reason'];
    const normalized = normalizeBreakGlassReason(reasonRaw);
    if (!normalized.ok) {
      return res.status(400).json({ error: normalized.error, code: 'break_glass_reason_required' });
    }

    const { rows: convRows } = await db.query(
      `
      SELECT c.id, c.status, c.job_id, c.business_id, c.last_message_at, c.created_at,
             c.customer_id, c.helper_id,
             j.title AS job_title,
             cu.first_name || ' ' || cu.last_name AS customer_name, cu.email AS customer_email,
             hu.first_name || ' ' || hu.last_name AS helper_name, hu.email AS helper_email
        FROM conversations c
        JOIN users cu ON c.customer_id = cu.id
        JOIN users hu ON c.helper_id = hu.id
        LEFT JOIN jobs j ON c.job_id = j.id
       WHERE c.id = $1
    `,
      [id],
    );
    if (!convRows.length) return res.status(404).json({ error: 'Conversation not found.' });

    await writeBreakGlassLog({
      adminId: req.user.id,
      conversationId: id,
      reason: normalized.reason,
      req,
    });

    const { rows: messages } = await db.query(
      `
      SELECT m.id, m.content, m.message_type, m.is_read, m.created_at, m.attachments,
             u.id AS sender_id,
             u.first_name || ' ' || u.last_name AS sender_name,
             u.email AS sender_email
        FROM messages m
        JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC
    `,
      [id],
    );

    const linked = await loadLinkedArtifacts(id);

    res.json({
      conversation: convRows[0],
      messages,
      ...linked,
      break_glass: {
        reason: normalized.reason,
        accessed_at: new Date().toISOString(),
        admin_id: req.user.id,
      },
    });
  } catch (err) {
    logger.error('getThread error', { err });
    res.status(500).json({ error: 'Failed to fetch thread.' });
  }
};

/** Explicit POST break-glass (same payload as GET with reason). */
exports.breakGlass = async (req, res) => {
  // Audit fix: reason comes from the body only, not the query string.
  // Query params end up in logs and URLs; the reason is sensitive.
  const reason = req.body?.reason;
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'A reason is required for break-glass access.' });
  }
  req.query = { ...req.query, reason: String(reason).trim() };
  return exports.getThread(req, res);
};

exports.setConversationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;
    const allowed = ['active', 'blocked', 'archived'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
    }
    const { rows } = await db.query('SELECT id, status FROM conversations WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Conversation not found.' });

    await db.query('UPDATE conversations SET status = $1 WHERE id = $2', [status, id]);
    try {
      await logAdminAction({
        adminId: req.user.id,
        action: `conversation_${status}`,
        targetType: 'conversation',
        targetId: id,
        before: { status: rows[0].status },
        after: { status },
        description: reason || null,
        req,
      });
    } catch (e) {
      /* ignore */
    }
    res.json({ message: `Conversation ${status}.` });
  } catch (err) {
    logger.error('setConversationStatus error', { err });
    res.status(500).json({ error: 'Failed to update conversation.' });
  }
};

/**
 * GET /api/admin/super/guest-inquiries/:id?reason=
 */
exports.getGuestInquiry = async (req, res) => {
  try {
    const { id } = req.params;
    const normalized = normalizeBreakGlassReason(
      req.query.reason || req.body?.reason || req.headers['x-break-glass-reason'],
    );
    if (!normalized.ok) {
      return res.status(400).json({ error: normalized.error, code: 'break_glass_reason_required' });
    }

    const { rows } = await db
      .query(`SELECT * FROM guest_profile_chat_inbound WHERE id = $1`, [id])
      .catch(() => ({ rows: [] }));
    if (!rows.length) return res.status(404).json({ error: 'Guest inquiry not found.' });

    await writeBreakGlassLog({
      adminId: req.user.id,
      guestSessionId: id,
      reason: normalized.reason,
      req,
    });

    const { rows: messages } = await db
      .query(
        `SELECT id, sender_type, sender_name, message AS content, created_at
           FROM guest_profile_chat_messages
          WHERE session_id = $1
          ORDER BY created_at ASC`,
        [id],
      )
      .catch(() => ({ rows: [] }));

    const [pops, agreements, quotesH, quotesB, paymentRequests] = await Promise.all([
      db
        .query(`SELECT * FROM chat_proof_of_payments WHERE guest_session_id = $1 ORDER BY created_at DESC LIMIT 50`, [
          id,
        ])
        .catch(() => ({ rows: [] })),
      db
        .query(`SELECT * FROM chat_agreements WHERE guest_session_id = $1 ORDER BY created_at DESC LIMIT 50`, [id])
        .catch(() => ({ rows: [] })),
      db
        .query(`SELECT * FROM helper_quotes WHERE guest_session_id = $1 ORDER BY created_at DESC LIMIT 50`, [id])
        .catch(() => ({ rows: [] })),
      db
        .query(`SELECT * FROM business_quotes WHERE guest_session_id = $1 ORDER BY created_at DESC LIMIT 50`, [id])
        .catch(() => ({ rows: [] })),
      db
        .query(`SELECT * FROM chat_payment_requests WHERE guest_session_id = $1 ORDER BY created_at DESC LIMIT 50`, [id])
        .catch(() => ({ rows: [] })),
    ]);

    res.json({
      guest_inquiry: rows[0],
      messages,
      proof_of_payments: pops.rows.map((r) => toPublicPopCard(r)),
      agreements: agreements.rows.map((r) => toPublicAgreementCard(r)),
      payment_requests: paymentRequests.rows.map((r) => toPublicPaymentRequestCard(r)),
      quotes: [
        ...quotesB.rows.map((r) => toPublicQuoteCard('business', r)),
        ...quotesH.rows.map((r) => toPublicQuoteCard('helper', r)),
      ].filter(Boolean),
      break_glass: {
        reason: normalized.reason,
        accessed_at: new Date().toISOString(),
        admin_id: req.user.id,
      },
    });
  } catch (err) {
    logger.error('getGuestInquiry error', { err });
    res.status(500).json({ error: 'Failed to fetch guest inquiry.' });
  }
};
