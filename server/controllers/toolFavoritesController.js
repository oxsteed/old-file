const db = require('../db');
const logger = require('../utils/logger');

const getFavorites = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await db.query(
      `SELECT tr.* FROM tool_rentals tr
       INNER JOIN user_tool_favorites utf ON tr.id = utf.tool_id
       WHERE utf.user_id = $1
       ORDER BY utf.created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('getFavorites error', { err, userId: req.user.id });
    res.status(500).json({ error: 'Failed to load favorites' });
  }
};

const toggleFavorite = async (req, res) => {
  const client = await db.connect();
  try {
    const { toolId } = req.params;
    const userId = req.user.id;

    const toolIdNum = parseInt(toolId, 10);
    if (!Number.isInteger(toolIdNum) || toolIdNum < 1) {
      return res.status(400).json({ error: 'Invalid tool id' });
    }

    // The tool must exist; otherwise the INSERT dies on the FK as a 500
    const toolRes = await client.query('SELECT id FROM tool_rentals WHERE id = $1', [toolIdNum]);
    if (!toolRes.rows.length) {
      return res.status(404).json({ error: 'Tool not found' });
    }

    // Check if already favorited
    const existing = await client.query(
      'SELECT id FROM user_tool_favorites WHERE user_id = $1 AND tool_id = $2',
      [userId, toolIdNum]
    );

    if (existing.rows.length > 0) {
      // Remove favorite with RETURNING to verify deletion
      const delResult = await client.query(
        'DELETE FROM user_tool_favorites WHERE user_id = $1 AND tool_id = $2 RETURNING id',
        [userId, toolIdNum]
      );
      if (!delResult.rows.length) throw new Error('Delete verification failed');
      res.json({ favorited: false });
    } else {
      // Add favorite
      await client.query(
        'INSERT INTO user_tool_favorites (user_id, tool_id) VALUES ($1, $2)',
        [userId, toolIdNum]
      );
      res.json({ favorited: true });
    }
  } catch (err) {
    logger.error('toggleFavorite error', { err, userId: req.user.id });
    res.status(500).json({ error: 'Failed to update favorite' });
  } finally {
    client.release();
  }
};

const isFavorited = async (req, res) => {
  try {
    const { toolId } = req.params;
    const userId = req.user.id;
    const toolIdNum = parseInt(toolId, 10);
    if (!Number.isInteger(toolIdNum) || toolIdNum < 1) {
      return res.status(400).json({ error: 'Invalid tool id' });
    }
    const result = await db.query(
      'SELECT id FROM user_tool_favorites WHERE user_id = $1 AND tool_id = $2',
      [userId, toolIdNum]
    );
    res.json({ favorited: result.rows.length > 0 });
  } catch (err) {
    logger.error('isFavorited error', { err });
    res.status(500).json({ error: 'Failed to check favorite status' });
  }
};

module.exports = { getFavorites, toggleFavorite, isFavorited };
