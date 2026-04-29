const { query } = require('../db');
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');

async function createResponse(req, res) {
  try {
    const { businessId } = req.params;
    const { category, title, content, shortcut, language } = req.body;

    if (!title || !content || !shortcut) {
      return sendValidationError(res, { title: 'Required', content: 'Required', shortcut: 'Required' });
    }

    const result = await query(
      `INSERT INTO canned_responses
       (business_id, category, title, content, shortcut, language, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7) RETURNING *`,
      [businessId, category || null, title, content, shortcut, language || 'en', req.user.id]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('createResponse error', { error: err.message });
    sendError(res, 500, 'Failed to create response');
  }
}

async function listResponses(req, res) {
  try {
    const { businessId } = req.params;
    const { category, language } = req.query;

    let sql = 'SELECT * FROM canned_responses WHERE business_id = $1 AND is_active = true';
    const params = [businessId];

    if (category) {
      sql += ` AND category = $${params.length + 1}`;
      params.push(category);
    }
    if (language) {
      sql += ` AND language = $${params.length + 1}`;
      params.push(language);
    }

    sql += ' ORDER BY category, title';

    const result = await query(sql, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('listResponses error', { error: err.message });
    sendError(res, 500, 'Failed to list responses');
  }
}

async function updateResponse(req, res) {
  try {
    const { responseId } = req.params;
    const { title, content } = req.body;

    const result = await query(
      `UPDATE canned_responses
       SET title = COALESCE($1, title), content = COALESCE($2, content), updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 RETURNING *`,
      [title || null, content || null, responseId]
    );

    if (!result.rows.length) return sendError(res, 404, 'Response not found');
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('updateResponse error', { error: err.message });
    sendError(res, 500, 'Failed to update response');
  }
}

async function deleteResponse(req, res) {
  try {
    const { responseId } = req.params;

    const result = await query(
      'UPDATE canned_responses SET is_active = false WHERE id = $1 RETURNING *',
      [responseId]
    );

    if (!result.rows.length) return sendError(res, 404, 'Response not found');
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('deleteResponse error', { error: err.message });
    sendError(res, 500, 'Failed to delete response');
  }
}

async function expandShortcut(req, res) {
  try {
    const { businessId } = req.params;
    const { shortcut, language } = req.query;

    if (!shortcut) {
      return sendValidationError(res, { shortcut: 'Required' });
    }

    const result = await query(
      `SELECT * FROM canned_responses
       WHERE business_id = $1 AND shortcut = $2 AND language = $3 AND is_active = true`,
      [businessId, shortcut, language || 'en']
    );

    if (!result.rows.length) {
      return sendError(res, 404, 'Response not found');
    }

    await query(
      'UPDATE canned_responses SET usage_count = usage_count + 1 WHERE id = $1',
      [result.rows[0].id]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('expandShortcut error', { error: err.message });
    sendError(res, 500, 'Failed to expand shortcut');
  }
}

async function getCategories(req, res) {
  try {
    const { businessId } = req.params;

    const result = await query(
      `SELECT DISTINCT category FROM canned_responses
       WHERE business_id = $1 AND is_active = true AND category IS NOT NULL
       ORDER BY category`,
      [businessId]
    );

    res.json({ success: true, data: result.rows.map(r => r.category) });
  } catch (err) {
    logger.error('getCategories error', { error: err.message });
    sendError(res, 500, 'Failed to get categories');
  }
}

module.exports = {
  createResponse, listResponses, updateResponse, deleteResponse,
  expandShortcut, getCategories
};
