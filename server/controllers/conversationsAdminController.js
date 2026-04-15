'use strict';

const db = require('../db');
const { logAdminAction } = require('../services/auditService');
const logger = require('../utils/logger');

async function tableExists(name) {
  try {
    const { rows } = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1`,
      [name]
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

exports.listConversations = async (req, res) => {
  try {
    if (!(await tableExists('conversations'))) {
      return res.json({ conversations: [], total: 0 });
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;
    const status = (req.query.status || '').trim();
    const q = (req.query.q || '').trim();

    const params = [];
    let i = 1;
    const cond = [];
    if (status) {
      cond.push(`c.status = $${i++}`);
      params.push(status);
    }
    if (q) {
      const esc = q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      cond.push(`(
        EXISTS (
          SELECT 1 FROM messages m
           WHERE m.conversation_id = c.id
             AND m.content ILIKE $${i} ESCAPE '\\'
        )
      )`);
      params.push(`%${esc}%`);
      i++;
    }
    const wc = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

    const hasBusinessId = await db.query(`
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'business_id'
    `).then(r => r.rows.length > 0);

    const bizSelect = hasBusinessId
      ? `c.business_id, b.business_name AS business_name`
      : `NULL::int AS business_id, NULL::text AS business_name`;
    const bizJoin = hasBusinessId
      ? `LEFT JOIN businesses b ON b.id = c.business_id`
      : '';

    const { rows } = await db.query(
      `SELECT c.id, c.job_id, c.customer_id, c.helper_id, c.status, c.last_message_at, c.created_at,
              ${bizSelect},
              uc.first_name || ' ' || uc.last_name AS customer_name,
              uc.email AS customer_email,
              uh.first_name || ' ' || uh.last_name AS helper_name,
              uh.email AS helper_email,
              (SELECT COUNT(*)::int FROM messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c
         JOIN users uc ON uc.id = c.customer_id
         JOIN users uh ON uh.id = c.helper_id
         ${bizJoin}
         ${wc}
         ORDER BY COALESCE(c.last_message_at, c.created_at) DESC NULLS LAST
         LIMIT $${i} OFFSET $${i + 1}`,
      [...params, limit, offset]
    );
    const { rows: c } = await db.query(
      `SELECT COUNT(*)::int AS n FROM conversations c ${wc}`,
      params
    );
    try {
      await logAdminAction({
        adminId: req.user.id,
        action: 'admin_conversations_list',
        targetType: 'conversation',
        targetId: null,
        description: `page=${page} limit=${limit} status=${status || 'any'}`,
        req,
      });
    } catch (e) { /* ignore */ }
    res.json({ conversations: rows, total: c[0]?.n || 0, page, limit });
  } catch (err) {
    logger.error('listConversations admin error', { err });
    res.status(500).json({ error: 'Failed to list conversations.' });
  }
};

exports.getThread = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Conversation id required.' });

    const { rows: conv } = await db.query(
      `SELECT c.*,
              uc.first_name || ' ' || uc.last_name AS customer_name,
              uc.email AS customer_email,
              uh.first_name || ' ' || uh.last_name AS helper_name,
              uh.email AS helper_email
         FROM conversations c
         JOIN users uc ON uc.id = c.customer_id
         JOIN users uh ON uh.id = c.helper_id
        WHERE c.id = $1::uuid`,
      [id]
    );
    if (!conv.length) return res.status(404).json({ error: 'Conversation not found.' });

    const { rows: messages } = await db.query(
      `SELECT m.id, m.sender_id, m.content, m.message_type, m.is_read, m.created_at,
              u.first_name || ' ' || u.last_name AS sender_name
         FROM messages m
         JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = $1::uuid
        ORDER BY m.created_at ASC
        LIMIT 500`,
      [id]
    );
    try {
      await logAdminAction({
        adminId: req.user.id,
        action: 'admin_conversation_read',
        targetType: 'conversation',
        targetId: id,
        description: `messages=${messages.length}`,
        req,
      });
    } catch (e) { /* ignore */ }
    res.json({ conversation: conv[0], messages });
  } catch (err) {
    logger.error('getThread admin error', { err });
    res.status(500).json({ error: 'Failed to load thread.' });
  }
};

exports.setConversationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;
    const allowed = ['active', 'archived', 'blocked'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
    }
    const { rows: before } = await db.query(
      `SELECT id, status FROM conversations WHERE id = $1::uuid`,
      [id]
    );
    if (!before.length) return res.status(404).json({ error: 'Conversation not found.' });
    await db.query(
      `UPDATE conversations SET status = $1 WHERE id = $2::uuid`,
      [status, id]
    );
    try {
      await logAdminAction({
        adminId: req.user.id,
        action: 'admin_conversation_status',
        targetType: 'conversation',
        targetId: id,
        description: reason || null,
        before: { status: before[0].status },
        after: { status },
        req,
      });
    } catch (e) { /* ignore */ }
    res.json({ message: 'Conversation status updated.', id, status });
  } catch (err) {
    logger.error('setConversationStatus admin error', { err });
    res.status(500).json({ error: 'Failed to update conversation.' });
  }
};
