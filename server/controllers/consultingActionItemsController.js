const db = require('../db');
const logger = require('../utils/logger');

// Get action items for a session
exports.getSessionActionItems = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const { rows } = await db.query(
      `SELECT id, session_id, title, description, due_date, priority, assigned_to_type, client_visible, completed, created_at, updated_at
       FROM consulting_action_items
       WHERE session_id = $1
       ORDER BY priority DESC, due_date ASC`,
      [sessionId]
    );

    res.json(rows);
  } catch (err) {
    logger.error('Failed to get action items', { error: err.message, sessionId: req.params.sessionId });
    res.status(500).json({ error: 'Failed to fetch action items' });
  }
};

// Create action item
exports.createActionItem = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { title, description, dueDate, priority, assignedToType, clientVisible } = req.body;

    // Validate
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    // Validate priority and assigned_to_type
    const validPriorities = ['low', 'medium', 'high', 'critical'];
    const validAssignedTypes = ['customer', 'consultant', 'both'];

    if (priority && !validPriorities.includes(priority.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid priority level' });
    }

    if (assignedToType && !validAssignedTypes.includes(assignedToType.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid assignment type' });
    }

    const { rows } = await db.query(
      `INSERT INTO consulting_action_items (session_id, title, description, due_date, priority, assigned_to_type, client_visible)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        sessionId,
        title,
        description || null,
        dueDate || null,
        priority?.toLowerCase() || 'medium',
        assignedToType?.toLowerCase() || 'both',
        clientVisible !== false
      ]
    );

    logger.info('Action item created', { sessionId, itemId: rows[0].id });
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('Failed to create action item', { error: err.message });
    res.status(500).json({ error: 'Failed to create action item' });
  }
};

// Update action item
exports.updateActionItem = async (req, res) => {
  try {
    const { sessionId, itemId } = req.params;
    const { title, description, dueDate, priority, assignedToType, clientVisible, completed } = req.body;

    // Get existing item first
    const { rows: existingItems } = await db.query(
      `SELECT * FROM consulting_action_items WHERE id = $1 AND session_id = $2`,
      [itemId, sessionId]
    );

    if (existingItems.length === 0) {
      return res.status(404).json({ error: 'Action item not found' });
    }

    // Build update query dynamically
    const updates = [];
    const values = [itemId, sessionId];
    let paramNum = 3;

    if (title !== undefined) {
      updates.push(`title = $${paramNum}`);
      values.push(title);
      paramNum++;
    }

    if (description !== undefined) {
      updates.push(`description = $${paramNum}`);
      values.push(description || null);
      paramNum++;
    }

    if (dueDate !== undefined) {
      updates.push(`due_date = $${paramNum}`);
      values.push(dueDate || null);
      paramNum++;
    }

    if (priority !== undefined) {
      updates.push(`priority = $${paramNum}`);
      values.push(priority?.toLowerCase() || 'medium');
      paramNum++;
    }

    if (assignedToType !== undefined) {
      updates.push(`assigned_to_type = $${paramNum}`);
      values.push(assignedToType?.toLowerCase() || 'both');
      paramNum++;
    }

    if (clientVisible !== undefined) {
      updates.push(`client_visible = $${paramNum}`);
      values.push(clientVisible);
      paramNum++;
    }

    if (completed !== undefined) {
      updates.push(`completed = $${paramNum}`);
      values.push(completed);
      paramNum++;
    }

    // Add updated_at
    updates.push(`updated_at = NOW()`);

    if (updates.length === 1) {
      // Only updated_at changed, return existing item
      res.json(existingItems[0]);
      return;
    }

    const query = `UPDATE consulting_action_items
                   SET ${updates.join(', ')}
                   WHERE id = $1 AND session_id = $2
                   RETURNING *`;

    const { rows } = await db.query(query, values);

    logger.info('Action item updated', { sessionId, itemId });
    res.json(rows[0]);
  } catch (err) {
    logger.error('Failed to update action item', { error: err.message });
    res.status(500).json({ error: 'Failed to update action item' });
  }
};

// Delete action item
exports.deleteActionItem = async (req, res) => {
  try {
    const { sessionId, itemId } = req.params;

    const { rows } = await db.query(
      `DELETE FROM consulting_action_items WHERE id = $1 AND session_id = $2 RETURNING id`,
      [itemId, sessionId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Action item not found' });
    }

    logger.info('Action item deleted', { sessionId, itemId });
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to delete action item', { error: err.message });
    res.status(500).json({ error: 'Failed to delete action item' });
  }
};

// Mark action item as complete
exports.completeActionItem = async (req, res) => {
  try {
    const { sessionId, itemId } = req.params;

    const { rows } = await db.query(
      `UPDATE consulting_action_items
       SET completed = TRUE, updated_at = NOW()
       WHERE id = $1 AND session_id = $2
       RETURNING *`,
      [itemId, sessionId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Action item not found' });
    }

    logger.info('Action item marked complete', { sessionId, itemId });
    res.json(rows[0]);
  } catch (err) {
    logger.error('Failed to complete action item', { error: err.message });
    res.status(500).json({ error: 'Failed to complete action item' });
  }
};
