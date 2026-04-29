const { query } = require('../utils/db');
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');

async function createCategory(req, res) {
  try {
    const { businessId } = req.params;
    const { categoryName, slug, description } = req.body;

    if (!categoryName || !slug) {
      return sendValidationError(res, { categoryName: 'Required', slug: 'Required' });
    }

    const result = await query(
      `INSERT INTO knowledge_base_categories
       (business_id, category_name, slug, description, is_public)
       VALUES ($1, $2, $3, $4, true) RETURNING *`,
      [businessId, categoryName, slug, description || null]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('createCategory error', { error: err.message });
    sendError(res, 500, 'Failed to create category');
  }
}

async function listCategories(req, res) {
  try {
    const { businessId } = req.params;
    const result = await query(
      'SELECT * FROM knowledge_base_categories WHERE business_id = $1 ORDER BY display_order',
      [businessId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('listCategories error', { error: err.message });
    sendError(res, 500, 'Failed to list categories');
  }
}

async function createArticle(req, res) {
  try {
    const { businessId } = req.params;
    const { categoryId, title, slug, content, excerpt, keywords, language } = req.body;

    if (!title || !slug || !content) {
      return sendValidationError(res, { title: 'Required', slug: 'Required', content: 'Required' });
    }

    const readTime = Math.ceil(content.split(/\s+/).length / 200);

    const result = await query(
      `INSERT INTO knowledge_base_articles
       (business_id, category_id, title, slug, content, excerpt, keywords, language,
        is_published, author_id, estimated_read_time_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9, $10)
       RETURNING *`,
      [businessId, categoryId || null, title, slug, content, excerpt || null,
       keywords ? JSON.stringify(keywords) : null, language || 'en', req.user.id, readTime]
    );

    await query(
      `INSERT INTO knowledge_base_search_index (article_id, business_id, search_text)
       VALUES ($1, $2, $3)`,
      [result.rows[0].id, businessId, `${title} ${excerpt || ''} ${keywords ? keywords.join(' ') : ''}`]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('createArticle error', { error: err.message });
    sendError(res, 500, 'Failed to create article');
  }
}

async function updateArticle(req, res) {
  try {
    const { articleId } = req.params;
    const { title, content, excerpt, isPublished } = req.body;

    const result = await query(
      `UPDATE knowledge_base_articles
       SET title = COALESCE($1, title), content = COALESCE($2, content),
           excerpt = COALESCE($3, excerpt), is_published = COALESCE($4, is_published),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 RETURNING *`,
      [title || null, content || null, excerpt || null, isPublished !== undefined ? isPublished : null, articleId]
    );

    if (!result.rows.length) return sendError(res, 404, 'Article not found');

    await query(
      `UPDATE knowledge_base_search_index SET search_text = $1, last_indexed = CURRENT_TIMESTAMP WHERE article_id = $2`,
      [`${result.rows[0].title} ${result.rows[0].excerpt || ''}`, articleId]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('updateArticle error', { error: err.message });
    sendError(res, 500, 'Failed to update article');
  }
}

async function publishArticle(req, res) {
  try {
    const { articleId } = req.params;

    const result = await query(
      `UPDATE knowledge_base_articles
       SET is_published = true, published_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING *`,
      [articleId]
    );

    if (!result.rows.length) return sendError(res, 404, 'Article not found');
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('publishArticle error', { error: err.message });
    sendError(res, 500, 'Failed to publish article');
  }
}

async function getArticle(req, res) {
  try {
    const { articleId } = req.params;

    const result = await query(
      'SELECT * FROM knowledge_base_articles WHERE id = $1',
      [articleId]
    );

    if (!result.rows.length) return sendError(res, 404, 'Article not found');

    await query('UPDATE knowledge_base_articles SET view_count = view_count + 1 WHERE id = $1', [articleId]);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('getArticle error', { error: err.message });
    sendError(res, 500, 'Failed to get article');
  }
}

async function searchArticles(req, res) {
  try {
    const { businessId } = req.params;
    const { query: searchQuery, categoryId, language } = req.query;

    if (!searchQuery) {
      return sendValidationError(res, { query: 'Required' });
    }

    let sql = `
      SELECT kba.* FROM knowledge_base_articles kba
      JOIN knowledge_base_search_index kbsi ON kba.id = kbsi.article_id
      WHERE kba.business_id = $1 AND kba.is_published = true
      AND to_tsvector('english', kbsi.search_text) @@ plainto_tsquery('english', $2)
    `;
    const params = [businessId, searchQuery];

    if (categoryId) {
      sql += ` AND kba.category_id = $${params.length + 1}`;
      params.push(categoryId);
    }
    if (language) {
      sql += ` AND kba.language = $${params.length + 1}`;
      params.push(language);
    }

    sql += ' ORDER BY kba.view_count DESC LIMIT 20';

    const result = await query(sql, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('searchArticles error', { error: err.message });
    sendError(res, 500, 'Failed to search articles');
  }
}

async function recordFeedback(req, res) {
  try {
    const { articleId } = req.params;
    const { helpful, comment } = req.body;

    const result = await query(
      `INSERT INTO knowledge_base_feedback (article_id, user_id, helpful, comment)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [articleId, req.user.id, helpful, comment || null]
    );

    if (helpful) {
      await query('UPDATE knowledge_base_articles SET helpful_count = helpful_count + 1 WHERE id = $1', [articleId]);
    } else {
      await query('UPDATE knowledge_base_articles SET unhelpful_count = unhelpful_count + 1 WHERE id = $1', [articleId]);
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('recordFeedback error', { error: err.message });
    sendError(res, 500, 'Failed to record feedback');
  }
}

async function getArticlesByCategory(req, res) {
  try {
    const { businessId, categoryId } = req.params;

    const result = await query(
      `SELECT * FROM knowledge_base_articles
       WHERE business_id = $1 AND category_id = $2 AND is_published = true
       ORDER BY created_at DESC`,
      [businessId, categoryId]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getArticlesByCategory error', { error: err.message });
    sendError(res, 500, 'Failed to get articles');
  }
}

module.exports = {
  createCategory, listCategories, createArticle, updateArticle, publishArticle,
  getArticle, searchArticles, recordFeedback, getArticlesByCategory
};
