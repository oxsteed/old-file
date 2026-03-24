const pool = require('../db');

// Get all conversations for the current user
const getConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      `SELECT c.*,
        CASE WHEN c.customer_id = $1 THEN h.first_name || ' ' || h.last_name
             ELSE cu.first_name || ' ' || cu.last_name END AS other_user_name,
        CASE WHEN c.customer_id = $1 THEN c.helper_id ELSE c.customer_id END AS other_user_id,
        j.title AS job_title,
        (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
        (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND sender_id != $1 AND is_read = FALSE) AS unread_count
      FROM conversations c
      LEFT JOIN users h ON c.helper_id = h.id
      LEFT JOIN users cu ON c.customer_id = cu.id
      LEFT JOIN jobs j ON c.job_id = j.id
      WHERE (c.customer_id = $1 OR c.helper_id = $1) AND c.status = 'active'
      ORDER BY c.last_message_at DESC NULLS LAST`,
      [userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
};

// Get or create a conversation
const getOrCreateConversation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { helperId, jobId } = req.body;

    if (!helperId) return res.status(400).json({ error: 'Helper ID is required' });

    // Check if conversation already exists
    let result;
    if (jobId) {
      result = await pool.query(
        'SELECT * FROM conversations WHERE customer_id = $1 AND helper_id = $2 AND job_id = $3',
        [userId, helperId, jobId]
      );
    } else {
      result = await pool.query(
        'SELECT * FROM conversations WHERE customer_id = $1 AND helper_id = $2 AND job_id IS NULL',
        [userId, helperId]
      );
    }

    if (result.rows.length > 0) {
      return res.json(result.rows[0]);
    }

    // Create new conversation
    const newConv = await pool.query(
      'INSERT INTO conversations (customer_id, helper_id, job_id) VALUES ($1, $2, $3) RETURNING *',
      [userId, helperId, jobId || null]
    );
    res.status(201).json(newConv.rows[0]);
  } catch (error) {
    console.error('Error creating conversation:', error);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
};

// Get messages for a conversation
const getMessages = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    // Verify user is part of conversation
    const conv = await pool.query(
      'SELECT * FROM conversations WHERE id = $1 AND (customer_id = $2 OR helper_id = $2)',
      [conversationId, userId]
    );
    if (conv.rows.length === 0) return res.status(403).json({ error: 'Access denied' });

    // Mark messages as read
    await pool.query(
      'UPDATE messages SET is_read = TRUE, read_at = NOW() WHERE conversation_id = $1 AND sender_id != $2 AND is_read = FALSE',
      [conversationId, userId]
    );

    const result = await pool.query(
      `SELECT m.*, u.first_name || ' ' || u.last_name AS sender_name
      FROM messages m
      LEFT JOIN users u ON m.sender_id = u.id
      WHERE m.conversation_id = $1
      ORDER BY m.created_at ASC
      LIMIT $2 OFFSET $3`,
      [conversationId, limit, offset]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
};

// Send a message
const sendMessage = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) return res.status(400).json({ error: 'Message content is required' });

    // Verify user is part of conversation
    const conv = await pool.query(
      'SELECT * FROM conversations WHERE id = $1 AND (customer_id = $2 OR helper_id = $2)',
      [conversationId, userId]
    );
    if (conv.rows.length === 0) return res.status(403).json({ error: 'Access denied' });

    const result = await pool.query(
      'INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3) RETURNING *',
      [conversationId, userId, content.trim()]
    );

    // Update conversation last_message_at
    await pool.query(
      'UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1',
      [conversationId]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
};

module.exports = { getConversations, getOrCreateConversation, getMessages, sendMessage };
