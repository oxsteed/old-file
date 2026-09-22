// server/controllers/supportController.js
// Full support ticket lifecycle:
//   Public:    submitSupportRequest
//   User auth: getMyTickets, getMyTicket, replyToMyTicket
//   Admin:     listTickets, getTicketAdmin, claimTicket, unclaimTicket,
//              updateStatus, updatePriority, adminReply, getStats

const db            = require('../db');
const logger        = require('../utils/logger');
const socketService = require('../services/socketService');
const { sendEmail } = require('../utils/email');
const { AppError } = require('../middleware/errorHandler');

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Build the full ticket object with latest message snippet for list views */
async function fetchTicketRow(ticketId) {
  const { rows } = await db.query(
    `SELECT
       t.*,
       u.first_name  AS user_first,
       u.last_name   AS user_last,
       u.email       AS user_email_addr,
       a.first_name  AS assignee_first,
       a.last_name   AS assignee_last,
       (SELECT COUNT(*) FROM support_messages
         WHERE ticket_id = t.id AND is_internal = false) AS message_count,
       (SELECT COUNT(*) FROM support_messages
         WHERE ticket_id = t.id AND is_internal = false
           AND is_from_admin = false
           AND created_at > COALESCE(
             (SELECT MAX(created_at) FROM support_messages
               WHERE ticket_id = t.id AND is_from_admin = true),
             '1970-01-01'
           )) AS unread_user_replies
     FROM support_tickets t
     LEFT JOIN users u ON t.user_id = u.id
     LEFT JOIN users a ON t.assigned_to = a.id
     WHERE t.id = $1`,
    [ticketId]
  );
  return rows[0] || null;
}

  /** Email every admin/super_admin whenever a ticket is opened */
  async function emailAdminsNewTicket(ticket) {
    try {
      const { rows: admins } = await db.query(
        `SELECT email, first_name FROM users WHERE role IN ('admin', 'super_admin') AND email IS NOT NULL`
      );
      await Promise.all(admins.map((admin) =>
        sendEmail({
          to: admin.email,
          subject: `[Ticket #${ticket.ticket_number}] New support ticket opened`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
              <h2 style="color:#ea580c;">New Support Ticket</h2>
              <p>Hi ${admin.first_name || 'there'},</p>
              <p>A new support ticket has been opened and needs review.</p>
              <table style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;width:100%;margin:16px 0;">
                <tr><td style="color:#6b7280;width:140px;">Ticket number</td>
                    <td style="font-weight:bold;">#${ticket.ticket_number}</td></tr>
                <tr><td style="color:#6b7280;">Subject</td>
                    <td>${ticket.subject}</td></tr>
                <tr><td style="color:#6b7280;">Priority</td>
                    <td style="text-transform:capitalize;">${ticket.priority}</td></tr>
                <tr><td style="color:#6b7280;">Requester</td>
                    <td>${ticket.name} (${ticket.email})</td></tr>
              </table>
              <p><a href="https://app.oxsteed.com/admin/support" style="color:#ea580c;">View in Admin Dashboard</a></p>
            </div>`,
        }).catch((err) => { logger.error('Failed to email admin about new ticket', { err, admin: admin.email }); })
      ));
    } catch (err) {
      logger.error('Failed to notify admins by email about new ticket', { err });
    }
  }


function notifyAdmins(event, data) {
  try { socketService.broadcastToAdmins(event, data); } catch { /* socket not ready */ }
}

function notifyUser(userId, event, data) {
  if (!userId) return;
  try { socketService.broadcastToUser(userId, event, data); } catch { /* socket not ready */ }
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

// ─── PUBLIC ───────────────────────────────────────────────────────────────────

/**
 * POST /api/support/request
 * Creates a ticket + first message.
 * Works for guests (no auth) and logged-in users.
 */
exports.submitSupportRequest = async (req, res, next) => {
  try {
    const { name, email, subject, message, category = 'general', priority = 'normal', sender_language = 'en' } = req.body;
    const clientRequestId = req.get('Idempotency-Key')
      || req.body.clientRequestId
      || req.body.client_request_id
      || null;
    if (clientRequestId && !isUuid(clientRequestId)) {
      throw new AppError('clientRequestId must be a valid UUID', 400, 'validation_failed');
    }

    const fields = {};
    if (!name?.trim()) fields.name = 'Name is required';
    if (!email?.trim()) fields.email = 'Email is required';
    if (!message?.trim()) fields.message = 'Message content is required';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fields.email = 'Please enter a valid email address';
    }
    if (Object.keys(fields).length > 0) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
    }

    const allowedPriority = ['low', 'normal', 'high', 'urgent'];
    const safePriority = allowedPriority.includes(priority) ? priority : 'normal';

    const allowedCategory = ['general', 'billing', 'technical', 'account', 'dispute', 'verification', 'other', 'chat_escalation'];
    const safeCategory = allowedCategory.includes(category?.toLowerCase?.()) ? category.toLowerCase() : 'general';

    // Validate and sanitize language code.
    const allowedLanguages = ['en', 'es', 'fr', 'ht', 'ar', 'de', 'it', 'pt', 'nl', 'pl', 'ja', 'zh'];
    const safeLanguage = allowedLanguages.includes(sender_language?.toLowerCase?.()) ? sender_language.toLowerCase() : 'en';

    const client = await db.connect();
    try {
      await client.query('BEGIN');

    // Link to an existing user account if possible
    let userId = null;
    if (req.user?.id) {
      userId = req.user.id;
    } else {
      const { rows } = await client.query(
        `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [email.trim()]
      );
      if (rows.length) userId = rows[0].id;
    }

    const ticketRes = await client.query(
      `INSERT INTO support_tickets
         (user_id, name, email, subject, category, priority, status, source, client_request_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', 'widget', $7)
       ON CONFLICT (client_request_id)
       WHERE client_request_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [
        userId,
        name.trim(),
        email.trim().toLowerCase(),
        (subject?.trim() || 'Support Request').slice(0, 500),
        safeCategory,
        safePriority,
        clientRequestId,
      ]
    );
    let ticket = ticketRes.rows[0];
    if (!ticket && clientRequestId) {
      const replay = await client.query(
        `SELECT * FROM support_tickets WHERE client_request_id = $1`,
        [clientRequestId]
      );
      ticket = replay.rows[0];
      if (!ticket) throw new AppError('Support request retry could not be recovered', 409, 'support_request_retry_failed');
      await client.query('COMMIT');
      return res.status(200).json({
        ticket_id: ticket.id,
        ticket_number: ticket.ticket_number,
        message: 'Your support request has already been received.',
      });
    }

    await client.query(
      `INSERT INTO support_messages
         (ticket_id, sender_id, sender_name, sender_email, content,
          sender_language, is_internal, is_from_admin, client_message_id)
       VALUES ($1, $2, $3, $4, $5, $6, false, false, $7)`,
      [ticket.id, userId, name.trim(), email.trim().toLowerCase(), message.trim(), safeLanguage, clientRequestId]
    );

    await client.query('COMMIT');

    // Confirmation email to the user
    sendEmail({
      to: email.trim(),
      subject: `[Ticket #${ticket.ticket_number}] We received your support request`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
          <h2 style="color:#ea580c;">OxSteed Support</h2>
          <p>Hi ${name.trim()},</p>
          <p>We've received your support request and a member of our team will be in touch soon.</p>
          <table style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;width:100%;margin:16px 0;">
            <tr><td style="color:#6b7280;width:140px;">Ticket number</td>
                <td style="font-weight:bold;">#${ticket.ticket_number}</td></tr>
            <tr><td style="color:#6b7280;">Subject</td>
                <td>${ticket.subject}</td></tr>
            <tr><td style="color:#6b7280;">Priority</td>
                <td style="text-transform:capitalize;">${ticket.priority}</td></tr>
          </table>
          <p style="color:#6b7280;font-size:13px;">
            Keep this email - ticket #${ticket.ticket_number} is your reference if you need to follow up.
          </p>
        </div>`,
    }).catch(() => { /* non-fatal */ });

    // Real-time broadcast to all admin sockets
    notifyAdmins('support:new_ticket', {
      ticket_id:     ticket.id,
      ticket_number: ticket.ticket_number,
      subject:       ticket.subject,
      name:          ticket.name,
      priority:      ticket.priority,
      created_at:    ticket.created_at,
    });
    // Email every admin/super_admin about the new ticket
    emailAdminsNewTicket(ticket).catch(() => { /* logged internally */ });

    logger.info('Support ticket created', {
      ticketId: ticket.id, ticketNumber: ticket.ticket_number,
    });

      return res.status(201).json({
        ticket_id:     ticket.id,
        ticket_number: ticket.ticket_number,
        message: 'Your support request has been received. Check your email for confirmation.',
      });
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Failed to create support ticket', { err });
      throw new AppError('Failed to submit support request', 500, 'support_request_failed');
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
};

// ─── USER (authenticated) ─────────────────────────────────────────────────────

/** GET /api/support/my-tickets */
exports.getMyTickets = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         t.id, t.ticket_number, t.subject, t.category, t.priority,
         t.status, t.created_at, t.updated_at,
         (SELECT COUNT(*) FROM support_messages
           WHERE ticket_id = t.id AND is_internal = false) AS message_count
       FROM support_tickets t
       WHERE t.user_id = $1
       ORDER BY t.created_at DESC
       LIMIT 50`,
      [req.user.id]
    );
    return res.json({ tickets: rows });
  } catch (err) {
    logger.error('getMyTickets error', { err });
    return res.status(500).json({ error: 'Failed to fetch tickets.' });
  }
};

/** GET /api/support/my-tickets/:ticketId */
exports.getMyTicket = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, ticket_number, subject, category, priority, status, created_at, updated_at
         FROM support_tickets
        WHERE id = $1 AND user_id = $2`,
      [req.params.ticketId, req.user.id]
    );
    if (!rows.length) {
      throw new AppError('Support ticket not found', 404, 'ticket_not_found');
    }

    const { rows: msgs } = await db.query(
      `SELECT id, sender_name, sender_email, content, is_from_admin, created_at
         FROM support_messages
        WHERE ticket_id = $1 AND is_internal = false
        ORDER BY created_at ASC`,
      [req.params.ticketId]
    );
    return res.json({ ticket: rows[0], messages: msgs });
  } catch (err) {
    next(err);
  }
};

/** POST /api/support/my-tickets/:ticketId/reply */
exports.replyToMyTicket = async (req, res, next) => {
  try {
    const { content, sender_language = 'en' } = req.body;
    const clientMessageId = req.get('Idempotency-Key')
      || req.body.clientMessageId
      || req.body.client_message_id
      || null;
    if (clientMessageId && !isUuid(clientMessageId)) {
      throw new AppError('clientMessageId must be a valid UUID', 400, 'validation_failed');
    }
    if (!content?.trim()) {
      throw new AppError('Message content is required', 400, 'validation_failed', { content: 'Message content cannot be empty' });
    }

    // Validate language code
    const allowedLanguages = ['en', 'es', 'fr', 'ht', 'ar', 'de', 'it', 'pt', 'nl', 'pl', 'ja', 'zh'];
    const safeLanguage = allowedLanguages.includes(sender_language?.toLowerCase?.()) ? sender_language.toLowerCase() : 'en';

    const { rows: tRows } = await db.query(
      `SELECT id, status, assigned_to, ticket_number, subject, name, email
         FROM support_tickets
        WHERE id = $1 AND user_id = $2`,
      [req.params.ticketId, req.user.id]
    );
    if (!tRows.length) {
      throw new AppError('Support ticket not found', 404, 'ticket_not_found');
    }

    const ticket = tRows[0];
    if (['resolved', 'closed'].includes(ticket.status)) {
      throw new AppError('This ticket is already closed', 409, 'ticket_closed');
    }

    const { rows: [msg] } = await db.query(
      `INSERT INTO support_messages
         (ticket_id, sender_id, sender_name, sender_email, content, sender_language, is_internal, is_from_admin, client_message_id)
       VALUES ($1, $2, $3, $4, $5, $6, false, false, $7)
       ON CONFLICT (ticket_id, client_message_id)
       WHERE client_message_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [ticket.id, req.user.id, ticket.name, ticket.email, content.trim(), safeLanguage, clientMessageId]
    );

    let messageRow = msg;
    const replayed = !messageRow && clientMessageId;
    if (replayed) {
      const replay = await db.query(
        `SELECT * FROM support_messages WHERE ticket_id = $1 AND client_message_id = $2`,
        [ticket.id, clientMessageId]
      );
      messageRow = replay.rows[0];
      if (!messageRow) throw new AppError('Message retry could not be recovered', 409, 'message_retry_failed');
      return res.status(200).json({ message: messageRow });
    }

    // Move back to in_progress if waiting on user response
    if (ticket.status === 'waiting_user') {
      await db.query(
        `UPDATE support_tickets SET status = 'in_progress', updated_at = NOW() WHERE id = $1`,
        [ticket.id]
      );
    } else {
      await db.query(`UPDATE support_tickets SET updated_at = NOW() WHERE id = $1`, [ticket.id]);
    }

    if (ticket.assigned_to) {
      socketService.broadcastToUser(ticket.assigned_to, 'support:user_reply', {
        ticket_id:     ticket.id,
        ticket_number: ticket.ticket_number,
        subject:       ticket.subject,
        from_name:     ticket.name,
      });
    } else {
      notifyAdmins('support:user_reply', {
        ticket_id:     ticket.id,
        ticket_number: ticket.ticket_number,
        subject:       ticket.subject,
        from_name:     ticket.name,
      });
    }

    return res.status(201).json({ message: messageRow });
  } catch (err) {
    next(err);
  }
};

// ─── ADMIN ────────────────────────────────────────────────────────────────────

/** GET /api/admin/support/tickets */
exports.listTickets = async (req, res) => {
  if (!['admin', 'super_admin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin access required.' });
  try {
    const {
      status   = '',
      priority = '',
      assigned = '',   // 'me' | 'unassigned' | UUID
      search   = '',
      limit    = 50,
      offset   = 0,
    } = req.query;

    const limitN  = Math.min(Math.max(1, parseInt(limit)  || 50), 200);
    const offsetN = Math.max(0, parseInt(offset) || 0);

    const VALID_STATUSES   = ['open', 'assigned', 'in_progress', 'waiting_user', 'resolved', 'closed'];
    const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
    const safeStatus   = VALID_STATUSES.includes(status)     ? status   : '';
    const safePriority = VALID_PRIORITIES.includes(priority) ? priority : '';

    const conditions = [];
    const params     = [];
    let p = 1;

    if (safeStatus) {
      conditions.push(`t.status = $${p++}`);
      params.push(safeStatus);
    }
    if (safePriority) {
      conditions.push(`t.priority = $${p++}`);
      params.push(safePriority);
    }
    if (assigned === 'me') {
      conditions.push(`t.assigned_to = $${p++}`);
      params.push(req.user.id);
    } else if (assigned === 'unassigned') {
      conditions.push(`t.assigned_to IS NULL`);
    } else if (assigned && assigned.length > 10) {
      conditions.push(`t.assigned_to = $${p++}`);
      params.push(assigned);
    }
    if (search) {
      conditions.push(
        `(t.subject ILIKE $${p} OR t.name ILIKE $${p} OR t.email ILIKE $${p} OR t.ticket_number::TEXT = $${p + 1})`
      );
      params.push(`%${search}%`, search.replace(/^#/, ''));
      p += 2;
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const { rows } = await db.query(
      `SELECT
         t.id, t.ticket_number, t.subject, t.name, t.email,
         t.category, t.priority, t.status, t.source,
         t.assigned_at, t.first_response_at, t.created_at, t.updated_at,
         u.first_name  AS user_first, u.last_name AS user_last,
         a.first_name  AS assignee_first, a.last_name AS assignee_last,
         a.id          AS assignee_id,
         (SELECT COUNT(*) FROM support_messages
           WHERE ticket_id = t.id AND is_internal = false) AS message_count,
         (SELECT COUNT(*) FROM support_messages
           WHERE ticket_id = t.id AND is_internal = false
             AND is_from_admin = false
             AND created_at > COALESCE(
               (SELECT MAX(created_at) FROM support_messages
                 WHERE ticket_id = t.id AND is_from_admin = true),
               '1970-01-01'
             )) AS unread_user_replies
       FROM support_tickets t
       LEFT JOIN users u ON t.user_id = u.id
       LEFT JOIN users a ON t.assigned_to = a.id
       ${where}
       ORDER BY
         CASE t.priority
           WHEN 'urgent' THEN 1 WHEN 'high' THEN 2
           WHEN 'normal' THEN 3 WHEN 'low' THEN 4
         END,
         t.created_at DESC
       LIMIT $${p} OFFSET $${p + 1}`,
      [...params, limitN, offsetN]
    );

    const { rows: [{ total }] } = await db.query(
      `SELECT COUNT(*) AS total FROM support_tickets t ${where}`,
      params
    );

    return res.json({ tickets: rows, total: parseInt(total), limit: limitN, offset: offsetN });
  } catch (err) {
    logger.error('listTickets error', { err });
    return res.status(500).json({ error: 'Failed to fetch tickets.' });
  }
};

/** GET /api/admin/support/tickets/:ticketId */
exports.getTicketAdmin = async (req, res) => {
  if (!['admin', 'super_admin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin access required.' });
  try {
    const ticket = await fetchTicketRow(req.params.ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

    const { rows: msgs } = await db.query(
      `SELECT
         m.id, m.content, m.is_internal, m.is_from_admin,
         m.sender_id, m.sender_name, m.sender_email, m.created_at,
         u.first_name AS sender_first, u.last_name AS sender_last
       FROM support_messages m
       LEFT JOIN users u ON m.sender_id = u.id
       WHERE m.ticket_id = $1
       ORDER BY m.created_at ASC`,
      [req.params.ticketId]
    );

    return res.json({ ticket, messages: msgs });
  } catch (err) {
    logger.error('getTicketAdmin error', { err });
    return res.status(500).json({ error: 'Failed to fetch ticket.' });
  }
};

/** POST /api/admin/support/tickets/:ticketId/claim */
exports.claimTicket = async (req, res) => {
  if (!['admin', 'super_admin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin access required.' });
  try {
    const { rows } = await db.query(
      `SELECT id, status, assigned_to, ticket_number FROM support_tickets WHERE id = $1`,
      [req.params.ticketId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Ticket not found.' });

    const ticket = rows[0];
    if (['resolved', 'closed'].includes(ticket.status)) {
      return res.status(409).json({ error: 'Cannot claim a closed ticket.' });
    }
    if (ticket.assigned_to && ticket.assigned_to !== req.user.id && !req.isSuper) {
      return res.status(403).json({ error: 'Ticket is assigned to another admin. Only a super admin can take over.' });
    }

    await db.query(
      `UPDATE support_tickets
          SET assigned_to = $1, assigned_at = NOW(),
              status = CASE WHEN status = 'open' THEN 'assigned' ELSE status END,
              updated_at = NOW()
        WHERE id = $2`,
      [req.user.id, ticket.id]
    );

    const updated = await fetchTicketRow(ticket.id);
    notifyAdmins('support:ticket_claimed', {
      ticket_id:       ticket.id,
      ticket_number:   ticket.ticket_number,
      claimed_by_id:   req.user.id,
      claimed_by_name: `${req.user.first_name} ${req.user.last_name}`,
    });

    logger.info('Ticket claimed', { ticketId: ticket.id, adminId: req.user.id });
    return res.json({ ticket: updated });
  } catch (err) {
    logger.error('claimTicket error', { err });
    return res.status(500).json({ error: 'Failed to claim ticket.' });
  }
};

/** POST /api/admin/support/tickets/:ticketId/unclaim */
exports.unclaimTicket = async (req, res) => {
  if (!['admin', 'super_admin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin access required.' });
  try {
    const { rows } = await db.query(
      `SELECT id, status, assigned_to, ticket_number FROM support_tickets WHERE id = $1`,
      [req.params.ticketId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Ticket not found.' });

    const ticket = rows[0];
    if (ticket.assigned_to !== req.user.id && !req.isSuper) {
      return res.status(403).json({ error: 'You can only unclaim your own tickets.' });
    }

    await db.query(
      `UPDATE support_tickets
          SET assigned_to = NULL, assigned_at = NULL,
              status = CASE WHEN status = 'assigned' THEN 'open' ELSE status END,
              updated_at = NOW()
        WHERE id = $1`,
      [ticket.id]
    );

    const updated = await fetchTicketRow(ticket.id);
    notifyAdmins('support:ticket_updated', {
      ticket_id: ticket.id, ticket_number: ticket.ticket_number,
    });
    return res.json({ ticket: updated });
  } catch (err) {
    logger.error('unclaimTicket error', { err });
    return res.status(500).json({ error: 'Failed to unclaim ticket.' });
  }
};

/** PUT /api/admin/support/tickets/:ticketId/status  - body: { status } */
exports.updateStatus = async (req, res) => {
  if (!['admin', 'super_admin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin access required.' });
  const allowed = ['open', 'assigned', 'in_progress', 'waiting_user', 'resolved', 'closed'];
  const { status } = req.body;
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Allowed: ${allowed.join(', ')}.` });
  }

  try {
    let extraCols = '';
    if (status === 'resolved') extraCols = ', resolved_at = NOW()';
    if (status === 'closed')   extraCols = ', closed_at = NOW()';

    const { rows } = await db.query(
      `UPDATE support_tickets
          SET status = $1, updated_at = NOW() ${extraCols}
        WHERE id = $2
        RETURNING id, ticket_number, status, user_id, name, email, subject`,
      [status, req.params.ticketId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Ticket not found.' });

    const ticket = rows[0];
    notifyUser(ticket.user_id, 'support:ticket_updated', {
      ticket_id: ticket.id, ticket_number: ticket.ticket_number, status,
    });
    notifyAdmins('support:ticket_updated', {
      ticket_id: ticket.id, ticket_number: ticket.ticket_number, status,
    });

    if (status === 'resolved') {
      sendEmail({
        to: ticket.email,
        subject: `[Ticket #${ticket.ticket_number}] Your support request has been resolved`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
            <h2 style="color:#ea580c;">OxSteed Support</h2>
            <p>Hi ${ticket.name},</p>
            <p>Your support request (<strong>#${ticket.ticket_number}</strong>) has been marked as resolved.</p>
            <p>If you still need help, reply to this email and your ticket will be re-opened.</p>
          </div>`,
      }).catch(() => { /* non-fatal */ });
    }

    return res.json({ ticket: rows[0] });
  } catch (err) {
    logger.error('updateStatus error', { err });
    return res.status(500).json({ error: 'Failed to update status.' });
  }
};

/** PUT /api/admin/support/tickets/:ticketId/priority  - body: { priority } */
exports.updatePriority = async (req, res) => {
  if (!['admin', 'super_admin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin access required.' });
  const allowed = ['low', 'normal', 'high', 'urgent'];
  const { priority } = req.body;
  if (!allowed.includes(priority)) {
    return res.status(400).json({ error: `Invalid priority. Allowed: ${allowed.join(', ')}.` });
  }

  try {
    const { rows } = await db.query(
      `UPDATE support_tickets SET priority = $1, updated_at = NOW()
        WHERE id = $2 RETURNING id, ticket_number, priority`,
      [priority, req.params.ticketId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Ticket not found.' });

    notifyAdmins('support:ticket_updated', { ticket_id: rows[0].id, priority });
    return res.json({ ticket: rows[0] });
  } catch (err) {
    logger.error('updatePriority error', { err });
    return res.status(500).json({ error: 'Failed to update priority.' });
  }
};

/**
 * POST /api/admin/support/tickets/:ticketId/reply
 * Body: { content, is_internal }
 * is_internal = true  → private note (admins only)
 * is_internal = false → public reply, emails user
 */
exports.adminReply = async (req, res) => {
  if (!['admin', 'super_admin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin access required.' });
  const { content, is_internal = false, sender_language = 'en' } = req.body;
  const clientMessageId = req.get('Idempotency-Key')
    || req.body.clientMessageId
    || req.body.client_message_id
    || null;
  if (!content?.trim()) return res.status(400).json({ error: 'Content is required.' });
  if (clientMessageId && !isUuid(clientMessageId)) {
    return res.status(400).json({ error: 'clientMessageId must be a valid UUID' });
  }

  // Validate language code (admin reply is assumed to be in English unless specified)
  const allowedLanguages = ['en', 'es', 'fr', 'ht', 'ar', 'de', 'it', 'pt', 'nl', 'pl', 'ja', 'zh'];
  const safeLanguage = allowedLanguages.includes(sender_language?.toLowerCase?.()) ? sender_language.toLowerCase() : 'en';

  try {
    const { rows: tRows } = await db.query(
      `SELECT id, ticket_number, status, user_id, name, email, subject,
              assigned_to, first_response_at
         FROM support_tickets WHERE id = $1`,
      [req.params.ticketId]
    );
    if (!tRows.length) return res.status(404).json({ error: 'Ticket not found.' });

    const ticket = tRows[0];
    if (['resolved', 'closed'].includes(ticket.status) && !req.isSuper) {
      return res.status(409).json({ error: 'Cannot reply to a closed ticket.' });
    }

    // Regular admins can only reply on their own (or unassigned) ticket
    if (ticket.assigned_to && ticket.assigned_to !== req.user.id && !req.isSuper) {
      return res.status(403).json({
        error: 'This ticket belongs to another admin. Claim it first.',
      });
    }

    const adminName =
      `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'Support Team';

    const { rows: [msg] } = await db.query(
      `INSERT INTO support_messages
         (ticket_id, sender_id, sender_name, sender_email, content, sender_language, is_internal, is_from_admin, client_message_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)
       ON CONFLICT (ticket_id, client_message_id)
       WHERE client_message_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [ticket.id, req.user.id, adminName, req.user.email, content.trim(), safeLanguage, Boolean(is_internal), clientMessageId]
    );
    const replayed = !msg && Boolean(clientMessageId);
    let message = msg;
    if (!message && clientMessageId) {
      const { rows: replayRows } = await db.query(
        `SELECT * FROM support_messages WHERE ticket_id = $1 AND client_message_id = $2`,
        [ticket.id, clientMessageId]
      );
      message = replayRows[0];
      if (!message) return res.status(409).json({ error: 'Message retry could not be recovered' });
    }

    if (replayed) {
      return res.status(200).json({ message, idempotent: true });
    }

    // Build UPDATE SET clause
    const sets = ['updated_at = NOW()'];
    const updateParams = [];
    let paramIdx = 1;

    if (!ticket.first_response_at && !is_internal) {
      sets.push('first_response_at = NOW()');
    }
    if (!is_internal && ticket.status === 'assigned') {
      sets.push(`status = 'in_progress'`);
    }
    if (!is_internal && ticket.status === 'in_progress') {
      sets.push(`status = 'waiting_user'`);
    }
    if (!ticket.assigned_to) {
      sets.push(`assigned_to = $${paramIdx++}`);
      updateParams.push(req.user.id);
      sets.push(`assigned_at = NOW()`);
      if (!is_internal && ticket.status === 'open') {
        sets.push(`status = 'in_progress'`);
      }
    }

    updateParams.push(ticket.id);
    await db.query(
      `UPDATE support_tickets SET ${sets.join(', ')} WHERE id = $${paramIdx}`,
      updateParams
    );

    if (!is_internal) {
      notifyUser(ticket.user_id, 'support:admin_reply', {
        ticket_id: ticket.id,
        ticket_number: ticket.ticket_number,
        subject: ticket.subject,
      });

      sendEmail({
        to: ticket.email,
        subject: `[Ticket #${ticket.ticket_number}] New reply from support`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
            <h2 style="color:#ea580c;">OxSteed Support</h2>
            <p>Hi ${ticket.name},</p>
            <p>You have a new reply on ticket <strong>#${ticket.ticket_number}</strong>:</p>
            <blockquote style="border-left:3px solid #ea580c;padding:12px 16px;margin:16px 0;
                               background:#fff7ed;color:#374151;border-radius:0 8px 8px 0;">
              ${content.trim().replace(/\n/g, '<br>')}
            </blockquote>
            <p style="color:#6b7280;font-size:13px;">
              Reply to this email or log in to view the full conversation.
            </p>
          </div>`,
      }).catch(() => { /* non-fatal */ });
    }

    notifyAdmins('support:ticket_updated', {
      ticket_id: ticket.id,
      ticket_number: ticket.ticket_number,
    });

    logger.info('Admin replied to ticket', {
      ticketId: ticket.id,
      adminId: req.user.id,
      isInternal: is_internal,
    });

    return res.status(201).json({ message });
  } catch (err) {
    logger.error('adminReply error', { err });
    return res.status(500).json({ error: 'Failed to send reply.' });
  }
};

/** GET /api/admin/support/stats */
exports.getStats = async (req, res) => {
  if (!['admin', 'super_admin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin access required.' });
  try {
    const { rows: byStatus } = await db.query(
      `SELECT status, COUNT(*) AS count FROM support_tickets GROUP BY status`
    );
    const { rows: byPriority } = await db.query(
      `SELECT priority, COUNT(*) AS count FROM support_tickets
       WHERE status NOT IN ('resolved','closed') GROUP BY priority`
    );
    const { rows: [myLoad] } = await db.query(
      `SELECT COUNT(*) AS count FROM support_tickets
       WHERE assigned_to = $1 AND status NOT IN ('resolved','closed')`,
      [req.user.id]
    );
    const { rows: [unassigned] } = await db.query(
      `SELECT COUNT(*) AS count FROM support_tickets
       WHERE assigned_to IS NULL AND status NOT IN ('resolved','closed')`
    );

    const statusMap   = {};
    const priorityMap = {};
    byStatus.forEach(r   => { statusMap[r.status]     = parseInt(r.count); });
    byPriority.forEach(r => { priorityMap[r.priority] = parseInt(r.count); });

    return res.json({
      by_status:   statusMap,
      by_priority: priorityMap,
      my_open:     parseInt(myLoad.count),
      unassigned:  parseInt(unassigned.count),
    });
  } catch (err) {
    logger.error('getStats error', { err });
    return res.status(500).json({ error: 'Failed to fetch stats.' });
  }
};

// —— Admin live-support availability toggle ——

/** GET /api/admin/support/availability */
exports.getMyAvailability = async (req, res) => {
  if (!['admin', 'super_admin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin access required.' });
  try {
    const { rows } = await db.query(
      `SELECT
         is_available_for_support
           AND support_available_at > NOW() - INTERVAL '2 minutes' AS is_available_for_support,
         support_available_at
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    const { rows: agentRows } = await db.query(
      `SELECT sa.id
       FROM support_agents sa
       JOIN support_employers se ON se.id = sa.employer_id
       WHERE sa.user_id = $1 AND se.kind = 'platform'
       LIMIT 1`,
      [req.user.id]
    );
    return res.json({
      is_available_for_support: rows[0].is_available_for_support,
      support_available_at: rows[0].support_available_at,
      agent_id: agentRows[0]?.id || null,
      expires_in_seconds: 120,
    });
  } catch (err) {
    logger.error('getMyAvailability error', { err });
    return res.status(500).json({ error: 'Failed to fetch availability.' });
  }
};

/** PUT /api/admin/support/availability */
exports.setMyAvailability = async (req, res) => {
  if (!['admin', 'super_admin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin access required.' });
  let client;
  try {
    const { is_available_for_support } = req.body;
    if (typeof is_available_for_support !== 'boolean') {
      return res.status(400).json({ error: 'is_available_for_support must be a boolean.' });
    }

    client = await db.connect();
    await client.query('BEGIN');
    const { rows: employerRows } = await client.query(
      `INSERT INTO support_employers (kind, display_name)
       VALUES ('platform', 'OxSteed Platform')
       ON CONFLICT (kind) WHERE kind = 'platform'
       DO UPDATE SET updated_at = NOW()
       RETURNING id`
    );
    const employerId = employerRows[0].id;

    const { rows: agentRows } = await client.query(
      `INSERT INTO support_agents (
         employer_id, business_id, user_id, status, role, department,
         max_concurrent_chats, is_available, updated_at
       )
       VALUES ($1, NULL, $2, 'active', 'admin', 'platform', 8, $3, NOW())
       ON CONFLICT (employer_id, user_id)
       DO UPDATE SET
         status = 'active',
         role = 'admin',
         department = 'platform',
         is_available = EXCLUDED.is_available,
         updated_at = NOW()
       RETURNING id, is_available`,
      [employerId, req.user.id, is_available_for_support]
    );

    const { rows } = await client.query(
      `UPDATE users
       SET is_available_for_support = $1,
           support_available_at = CASE WHEN $1 THEN NOW() ELSE NULL END
       WHERE id = $2
       RETURNING is_available_for_support, support_available_at`,
      [is_available_for_support, req.user.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found.' });
    }
    await client.query('COMMIT');
    logger.info('Admin support availability updated', { userId: req.user.id, is_available_for_support });
    return res.json({
      is_available_for_support: rows[0].is_available_for_support,
      support_available_at: rows[0].support_available_at,
      agent_id: agentRows[0].id,
      expires_in_seconds: 120,
    });
  } catch (err) {
    await client?.query('ROLLBACK').catch(() => {});
    logger.error('setMyAvailability error', { err });
    return res.status(500).json({ error: 'Failed to update availability.' });
  } finally {
    client?.release();
  }
};
