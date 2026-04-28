const db     = require('../db');
const logger = require('../utils/logger');
const { logAdminAction } = require('../services/auditService');

exports.listConversations = async (req, res) => {
  try {
    const { search = '', status = '', page = 1, limit = 25 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = []; let p = 1; const conds = [];

    if (search) {
      conds.push(`(cu.email ILIKE $${p} OR hu.email ILIKE $${p} OR cu.first_name || ' ' || cu.last_name ILIKE $${p} OR hu.first_name || ' ' || hu.last_name ILIKE $${p})`);
      params.push(`%${search}%`); p++;
    }
    if (status) { conds.push(`c.status = $${p++}`); params.push(status); }
    const wc = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const { rows } = await db.query(`
      SELECT c.id, c.status, c.last_message_at, c.created_at, c.job_id,
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
    `, [...params, parseInt(limit), offset]);

    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) FROM conversations c JOIN users cu ON c.customer_id = cu.id JOIN users hu ON c.helper_id = hu.id ${wc}`,
      params
    );

    try {
      await logAdminAction({
        adminId: req.user.id, action: 'conversations_list_viewed',
        targetType: 'conversations', targetId: null,
        description: search ? `search: ${search}` : null, req,
      });
    } catch (e) {}

    res.json({ conversations: rows, total: parseInt(countRows[0].count) });
  } catch (err) {
    logger.error('listConversations error', { err });
    res.status(500).json({ error: 'Failed to fetch conversations.' });
  }
};

exports.getThread = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows: convRows } = await db.query(`
      SELECT c.id, c.status, c.job_id, c.last_message_at, c.created_at,
             c.customer_id, c.helper_id,
             j.title AS job_title,
             cu.first_name || ' ' || cu.last_name AS customer_name, cu.email AS customer_email,
             hu.first_name || ' ' || hu.last_name AS helper_name, hu.email AS helper_email
        FROM conversations c
        JOIN users cu ON c.customer_id = cu.id
        JOIN users hu ON c.helper_id = hu.id
        LEFT JOIN jobs j ON c.job_id = j.id
       WHERE c.id = $1
    `, [id]);
    if (!convRows.length) return res.status(404).json({ error: 'Conversation not found.' });

    const { rows: messages } = await db.query(`
      SELECT m.id, m.content, m.message_type, m.is_read, m.created_at,
             u.id AS sender_id,
             u.first_name || ' ' || u.last_name AS sender_name,
             u.email AS sender_email
        FROM messages m
        JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC
    `, [id]);

    try {
      await logAdminAction({
        adminId: req.user.id, action: 'conversation_thread_read',
        targetType: 'conversation', targetId: id, req,
      });
    } catch (e) {}

    res.json({ conversation: convRows[0], messages });
  } catch (err) {
    logger.error('getThread error', { err });
    res.status(500).json({ error: 'Failed to fetch thread.' });
  }
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
        adminId: req.user.id, action: `conversation_${status}`,
        targetType: 'conversation', targetId: id,
        before: { status: rows[0].status }, after: { status },
        description: reason || null, req,
      });
    } catch (e) {}
    res.json({ message: `Conversation ${status}.` });
  } catch (err) {
    logger.error('setConversationStatus error', { err });
    res.status(500).json({ error: 'Failed to update conversation.' });
  }
};
