const db = require('../db');
const logger = require('../utils/logger');

/**
 * Get all consulting sessions with filtering and pagination
 * GET /api/consulting/admin/sessions
 */
async function listSessions(req, res) {
  const { page = 1, limit = 20, status = '', service_tier = '' } = req.query;

  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 20, 100);
  const offset = (pageNum - 1) * limitNum;

  try {
    // Build query conditions
    const conditions = [];
    const values = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`status = $${paramIndex}`);
      values.push(status);
      paramIndex++;
    }

    if (service_tier) {
      conditions.push(`service_tier = $${paramIndex}`);
      values.push(service_tier);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM consulting_sessions ${whereClause}`;
    const countResult = await db.query(countQuery, values.slice(0, paramIndex - 1));
    const total = parseInt(countResult.rows[0].total);
    const pages = Math.ceil(total / limitNum);

    // Get paginated results
    const query = `
      SELECT * FROM consulting_sessions
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    values.push(limitNum, offset);

    const result = await db.query(query, values);

    logger.info('Consulting sessions listed', {
      adminId: req.user?.id,
      count: result.rows.length,
      total,
      filters: { status, service_tier },
    });

    return res.json({
      data: result.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages,
      },
    });
  } catch (err) {
    logger.error('Error listing consulting sessions', { err });
    return res.status(500).json({ error: 'Failed to fetch sessions' });
  }
}

/**
 * Get single consulting session
 * GET /api/consulting/admin/sessions/:id
 */
async function getSession(req, res) {
  const { id } = req.params;

  try {
    const result = await db.query(
      'SELECT * FROM consulting_sessions WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    logger.info('Consulting session retrieved', {
      adminId: req.user?.id,
      sessionId: id,
    });

    return res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error fetching consulting session', { sessionId: id, err });
    return res.status(500).json({ error: 'Failed to fetch session' });
  }
}

/**
 * Update consulting session status and details
 * PATCH /api/consulting/admin/sessions/:id
 */
async function updateSession(req, res) {
  const { id } = req.params;
  const { status, consultant_assigned_id, scheduled_at } = req.body;

  try {
    // Verify session exists
    const sessionCheck = await db.query(
      'SELECT id FROM consulting_sessions WHERE id = $1',
      [id]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Build update query
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (status) {
      updates.push(`status = $${paramIndex}`);
      values.push(status);
      paramIndex++;
    }

    if (consultant_assigned_id !== undefined) {
      updates.push(`consultant_assigned_id = $${paramIndex}`);
      values.push(consultant_assigned_id);
      paramIndex++;
    }

    if (scheduled_at) {
      updates.push(`scheduled_at = $${paramIndex}`);
      values.push(scheduled_at);
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Always update the updated_at timestamp
    updates.push(`updated_at = NOW()`);

    values.push(id);
    const query = `
      UPDATE consulting_sessions
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await db.query(query, values);

    logger.info('Consulting session updated', {
      adminId: req.user?.id,
      sessionId: id,
      updates: { status, consultant_assigned_id, scheduled_at },
    });

    return res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error updating consulting session', { sessionId: id, err });
    return res.status(500).json({ error: 'Failed to update session' });
  }
}

module.exports = {
  listSessions,
  getSession,
  updateSession,
};
