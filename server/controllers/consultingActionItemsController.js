const db = require('../db');
const logger = require('../utils/logger');

const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];
const VALID_ASSIGNED_TYPES = ['client', 'consultant'];
const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'overdue'];

// Coerce arbitrary input (true, "true", false, "false", undefined) to a strict boolean.
function coerceBool(value, defaultValue) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return Boolean(value);
}

// Verify the requester is allowed to access action items on this session.
// Returns true if owner of the session OR admin/super_admin.
async function authorizeSessionAccess(req, sessionId) {
  if (!req.user) return false;
  if (req.user.role === 'admin' || req.user.role === 'super_admin') return true;
  const { rows } = await db.query(
    `SELECT user_id FROM consulting_sessions WHERE id = $1`,
    [sessionId]
  );
  return rows.length > 0 && rows[0].user_id === req.user.id;
}

// Map DB row to API response - derives boolean `completed` from `status`
// for backward compatibility with the frontend that reads item.completed.
function rowToResponse(row) {
  if (!row) return row;
  return { ...row, completed: row.status === 'completed' };
}

// Get action items for a session
exports.getSessionActionItems = async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!await authorizeSessionAccess(req, sessionId)) {
      return res.status(403).json({ error: 'Not authorized for this session' });
    }

    const { rows } = await db.query(
      `SELECT id, session_id, title, description, due_date, priority, assigned_to_type,
              client_visible, status, created_at, updated_at
       FROM consulting_action_items
       WHERE session_id = $1
       ORDER BY priority DESC, due_date ASC NULLS LAST`,
      [sessionId]
    );

    res.json(rows.map(rowToResponse));
  } catch (err) {
    logger.error('Failed to get action items', { error: err.message, sessionId: req.params.sessionId });
    res.status(500).json({ error: 'Failed to fetch action items' });
  }
};

// Create action item - admin/consultant only.
exports.createActionItem = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { title, description, dueDate, priority, assignedToType, clientVisible } = req.body;

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required to create action items' });
    }

    // Validate
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }
    if (priority && !VALID_PRIORITIES.includes(priority.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid priority level' });
    }
    if (assignedToType && !VALID_ASSIGNED_TYPES.includes(assignedToType.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid assignment type' });
    }

    // Verify session exists before inserting (avoids FK violation 500).
    const { rows: sessionCheck } = await db.query(
      `SELECT status FROM consulting_sessions WHERE id = $1`,
      [sessionId]
    );
    if (sessionCheck.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    if (sessionCheck[0].status === 'cancelled') {
      return res.status(409).json({ error: 'Cannot add action items to a cancelled session' });
    }

    const { rows } = await db.query(
      `INSERT INTO consulting_action_items
        (session_id, title, description, due_date, priority, assigned_to_type, client_visible)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, session_id, title, description, due_date, priority, assigned_to_type,
                 client_visible, status, created_at, updated_at`,
      [
        sessionId,
        title.trim(),
        description || null,
        dueDate || null,
        priority?.toLowerCase() || 'medium',
        assignedToType?.toLowerCase() || 'client',
        coerceBool(clientVisible, true),
      ]
    );

    logger.info('Action item created', { sessionId, itemId: rows[0].id, adminId: req.user.id });
    res.status(201).json(rowToResponse(rows[0]));
  } catch (err) {
    logger.error('Failed to create action item', { error: err.message });
    res.status(500).json({ error: 'Failed to create action item' });
  }
};

// Update action item - admin only.
exports.updateActionItem = async (req, res) => {
  try {
    const { sessionId, itemId } = req.params;
    const { title, description, dueDate, priority, assignedToType, clientVisible, completed, status } = req.body;

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required to update action items' });
    }

    // Verify the item exists and belongs to the session - explicit field list, no SELECT *.
    const { rows: existingItems } = await db.query(
      `SELECT id, session_id, title, description, due_date, priority, assigned_to_type,
              client_visible, status, created_at, updated_at
       FROM consulting_action_items WHERE id = $1 AND session_id = $2`,
      [itemId, sessionId]
    );
    if (existingItems.length === 0) {
      return res.status(404).json({ error: 'Action item not found' });
    }

    // Validate inputs
    if (priority !== undefined && priority && !VALID_PRIORITIES.includes(priority.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid priority level' });
    }
    if (assignedToType !== undefined && assignedToType && !VALID_ASSIGNED_TYPES.includes(assignedToType.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid assignment type' });
    }
    if (status !== undefined && status && !VALID_STATUSES.includes(status.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Build update query dynamically with strict boolean coercion.
    const updates = [];
    const values = [itemId, sessionId];
    let paramNum = 3;

    if (title !== undefined) {
      updates.push(`title = $${paramNum++}`);
      values.push(title);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramNum++}`);
      values.push(description || null);
    }
    if (dueDate !== undefined) {
      updates.push(`due_date = $${paramNum++}`);
      values.push(dueDate || null);
    }
    if (priority !== undefined) {
      updates.push(`priority = $${paramNum++}`);
      values.push(priority?.toLowerCase() || 'medium');
    }
    if (assignedToType !== undefined) {
      updates.push(`assigned_to_type = $${paramNum++}`);
      values.push(assignedToType?.toLowerCase() || 'client');
    }
    if (clientVisible !== undefined) {
      updates.push(`client_visible = $${paramNum++}`);
      values.push(coerceBool(clientVisible, true));
    }
    // Accept either `status` (preferred) or `completed` (legacy from old client).
    if (status !== undefined) {
      updates.push(`status = $${paramNum++}`);
      values.push(status.toLowerCase());
    } else if (completed !== undefined) {
      updates.push(`status = $${paramNum++}`);
      values.push(coerceBool(completed, false) ? 'completed' : 'pending');
    }

    if (updates.length === 0) {
      return res.json(rowToResponse(existingItems[0]));
    }

    updates.push(`updated_at = NOW()`);

    const query = `UPDATE consulting_action_items
                   SET ${updates.join(', ')}
                   WHERE id = $1 AND session_id = $2
                   RETURNING id, session_id, title, description, due_date, priority,
                             assigned_to_type, client_visible, status, created_at, updated_at`;

    const { rows } = await db.query(query, values);

    logger.info('Action item updated', { sessionId, itemId, adminId: req.user.id });
    res.json(rowToResponse(rows[0]));
  } catch (err) {
    logger.error('Failed to update action item', { error: err.message });
    res.status(500).json({ error: 'Failed to update action item' });
  }
};

// Delete action item - admin only.
exports.deleteActionItem = async (req, res) => {
  try {
    const { sessionId, itemId } = req.params;

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required to delete action items' });
    }

    const { rows } = await db.query(
      `DELETE FROM consulting_action_items WHERE id = $1 AND session_id = $2 RETURNING id`,
      [itemId, sessionId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Action item not found' });
    }

    logger.info('Action item deleted', { sessionId, itemId, adminId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to delete action item', { error: err.message });
    res.status(500).json({ error: 'Failed to delete action item' });
  }
};

// Mark action item as complete - admin only.
exports.completeActionItem = async (req, res) => {
  try {
    const { sessionId, itemId } = req.params;

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { rows } = await db.query(
      `UPDATE consulting_action_items
       SET status = 'completed', updated_at = NOW()
       WHERE id = $1 AND session_id = $2
       RETURNING id, session_id, title, description, due_date, priority,
                 assigned_to_type, client_visible, status, created_at, updated_at`,
      [itemId, sessionId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Action item not found' });
    }

    logger.info('Action item marked complete', { sessionId, itemId, adminId: req.user.id });
    res.json(rowToResponse(rows[0]));
  } catch (err) {
    logger.error('Failed to complete action item', { error: err.message });
    res.status(500).json({ error: 'Failed to complete action item' });
  }
};
