const { pool } = require('../db');
const { sendError, sendSuccess } = require('../utils/apiError');
const logger = require('../utils/logger');

/**
 * Browse marketplace products filtered by skill
 * GET /api/marketplace/products/browse?skill=X&search=Y&category=Z&page=1&limit=20
 */
const browseProducts = async (req, res) => {
  try {
    const { skill, search, category, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const safeLimit = Math.min(parseInt(limit), 100); // max 100 per page

    let query = `
      SELECT DISTINCT
        mp.id, mp.name, mp.description, mp.category, mp.sku, mp.price_cents,
        mp.product_image_url, mp.is_available, mp.source, mp.external_id,
        COALESCE(
          json_agg(DISTINCT jsonb_build_object('id', sl.id, 'name', sl.name))
          FILTER (WHERE sl.id IS NOT NULL),
          '[]'::json
        ) as skills
      FROM marketplace_products mp
      LEFT JOIN marketplace_product_skills mps ON mp.id = mps.product_id
      LEFT JOIN skills_lookup sl ON mps.skill_id = sl.id
      WHERE mp.is_active = TRUE AND mp.is_available = TRUE
    `;

    const params = [];
    let paramCount = 1;

    // Filter by skill
    if (skill && skill.trim()) {
      query += ` AND mps.skill_id = $${paramCount}`;
      params.push(skill);
      paramCount++;
    }

    // Filter by category
    if (category && category.trim()) {
      query += ` AND mp.category ILIKE $${paramCount}`;
      params.push(`%${category}%`);
      paramCount++;
    }

    // Full-text search on name and description
    if (search && search.trim()) {
      query += ` AND to_tsvector('english', mp.name || ' ' || COALESCE(mp.description, ''))
                 @@ plainto_tsquery('english', $${paramCount})`;
      params.push(search);
      paramCount++;
    }

    // Count total for pagination
    const countQuery = `
      SELECT COUNT(DISTINCT mp.id) as total
      FROM marketplace_products mp
      LEFT JOIN marketplace_product_skills mps ON mp.id = mps.product_id
      WHERE mp.is_active = TRUE AND mp.is_available = TRUE
      ${skill && skill.trim() ? `AND mps.skill_id = $1` : ''}
      ${category && category.trim() ? `AND mp.category ILIKE $${skill && skill.trim() ? '2' : '1'}` : ''}
    `;

    const countResult = await pool.query(countQuery, params.slice(0, paramCount - 1));
    const total = parseInt(countResult.rows[0]?.total || 0);

    // Get paginated results
    query += ` GROUP BY mp.id
              ORDER BY mp.updated_at DESC
              LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(safeLimit, offset);

    const result = await pool.query(query, params);

    logger.info('Marketplace products browsed', { skillId: skill, page, limit, total });

    sendSuccess(res, {
      products: result.rows,
      pagination: {
        page: parseInt(page),
        limit: safeLimit,
        total,
        hasMore: offset + safeLimit < total,
      },
    });
  } catch (err) {
    logger.error('Error browsing marketplace products', err);
    sendError(res, 500, 'Failed to browse products');
  }
};

/**
 * Get product details
 * GET /api/marketplace/products/:productId
 */
const getProduct = async (req, res) => {
  try {
    const { productId } = req.params;

    const query = `
      SELECT
        mp.id, mp.name, mp.description, mp.category, mp.sku, mp.upc,
        mp.price_cents, mp.currency, mp.affiliate_url, mp.product_image_url,
        mp.is_available, mp.source, mp.external_id,
        COALESCE(
          json_agg(jsonb_build_object('id', sl.id, 'name', sl.name))
          FILTER (WHERE sl.id IS NOT NULL),
          '[]'::json
        ) as skills,
        (SELECT COUNT(*) FROM shopping_cart_items WHERE product_id = mp.id) as in_carts_count
      FROM marketplace_products mp
      LEFT JOIN marketplace_product_skills mps ON mp.id = mps.product_id
      LEFT JOIN skills_lookup sl ON mps.skill_id = sl.id
      WHERE mp.id = $1
      GROUP BY mp.id
    `;

    const result = await pool.query(query, [productId]);

    if (result.rows.length === 0) {
      return sendError(res, 404, 'Product not found');
    }

    sendSuccess(res, result.rows[0]);
  } catch (err) {
    logger.error('Error fetching product details', err);
    sendError(res, 500, 'Failed to fetch product');
  }
};

/**
 * Get products by skill
 * GET /api/marketplace/products/by-skill/:skillId?limit=50
 */
const getBySkill = async (req, res) => {
  try {
    const { skillId } = req.params;
    const { limit = 50 } = req.query;
    const safeLimit = Math.min(parseInt(limit), 200);

    const query = `
      SELECT DISTINCT
        mp.id, mp.name, mp.description, mp.category, mp.price_cents,
        mp.product_image_url, mp.is_available, mps.relevance_score
      FROM marketplace_products mp
      JOIN marketplace_product_skills mps ON mp.id = mps.product_id
      WHERE mps.skill_id = $1 AND mp.is_active = TRUE AND mp.is_available = TRUE
      ORDER BY mps.relevance_score DESC, mp.name ASC
      LIMIT $2
    `;

    const result = await pool.query(query, [skillId, safeLimit]);

    logger.info('Products fetched by skill', { skillId, count: result.rows.length });

    sendSuccess(res, {
      skillId,
      products: result.rows,
      count: result.rows.length,
    });
  } catch (err) {
    logger.error('Error fetching products by skill', err);
    sendError(res, 500, 'Failed to fetch products');
  }
};

/**
 * Get product categories
 * GET /api/marketplace/products/categories
 */
const getCategories = async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT category
      FROM marketplace_products
      WHERE is_active = TRUE AND category IS NOT NULL
      ORDER BY category ASC
    `;

    const result = await pool.query(query);
    const categories = result.rows.map((r) => r.category);

    sendSuccess(res, { categories });
  } catch (err) {
    logger.error('Error fetching categories', err);
    sendError(res, 500, 'Failed to fetch categories');
  }
};

/**
 * Search products (full-text search + filters)
 * GET /api/marketplace/products/search?q=sink&skill=plumbing&minPrice=10&maxPrice=100
 */
const searchProducts = async (req, res) => {
  try {
    const { q, skill, minPrice, maxPrice, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const safeLimit = Math.min(parseInt(limit), 100);

    if (!q || q.trim().length < 2) {
      return sendError(res, 400, 'Search query must be at least 2 characters');
    }

    let query = `
      SELECT DISTINCT
        mp.id, mp.name, mp.description, mp.category, mp.price_cents,
        mp.product_image_url, mp.is_available,
        ts_rank(to_tsvector('english', mp.name || ' ' || COALESCE(mp.description, '')),
                plainto_tsquery('english', $1)) as relevance
      FROM marketplace_products mp
      LEFT JOIN marketplace_product_skills mps ON mp.id = mps.product_id
      WHERE mp.is_active = TRUE
        AND to_tsvector('english', mp.name || ' ' || COALESCE(mp.description, ''))
            @@ plainto_tsquery('english', $1)
    `;

    const params = [q];
    let paramCount = 2;

    if (skill && skill.trim()) {
      query += ` AND mps.skill_id = $${paramCount}`;
      params.push(skill);
      paramCount++;
    }

    if (minPrice) {
      query += ` AND mp.price_cents >= $${paramCount}`;
      params.push(parseInt(minPrice) * 100);
      paramCount++;
    }

    if (maxPrice) {
      query += ` AND mp.price_cents <= $${paramCount}`;
      params.push(parseInt(maxPrice) * 100);
      paramCount++;
    }

    query += ` ORDER BY relevance DESC, mp.name ASC
              LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(safeLimit, offset);

    const result = await pool.query(query, params);

    logger.info('Products searched', { query: q, skill, resultsCount: result.rows.length });

    sendSuccess(res, {
      results: result.rows,
      pagination: {
        page: parseInt(page),
        limit: safeLimit,
        total: result.rows.length,
      },
    });
  } catch (err) {
    logger.error('Error searching products', err);
    sendError(res, 500, 'Failed to search products');
  }
};

/**
 * Sync products from Home Depot (admin/scheduled only)
 * POST /api/marketplace/products/sync-homedepot
 */
const syncFromHomeDepot = async (req, res) => {
  try {
    // This is a placeholder - actual HD API integration would go here
    // For now, just log that sync was triggered
    logger.info('Home Depot product sync triggered');

    sendSuccess(res, {
      message: 'Sync scheduled',
      nextSync: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
  } catch (err) {
    logger.error('Error syncing from Home Depot', err);
    sendError(res, 500, 'Failed to sync products');
  }
};

module.exports = {
  browseProducts,
  getProduct,
  getBySkill,
  getCategories,
  searchProducts,
  syncFromHomeDepot,
};
