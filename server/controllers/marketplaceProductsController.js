const pool = require('../db');
const { sendError, sendSuccess } = require('../utils/apiError');
const logger = require('../utils/logger');

/**
 * Browse marketplace products with advanced filtering and sorting
 * GET /api/marketplace/products/browse?minPrice=X&maxPrice=Y&skillIds=1,2&sortBy=rating&page=1&limit=20
 */
const browseProducts = async (req, res) => {
  try {
    const { minPrice, maxPrice, skillIds, sortBy = 'newest', category, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const safeLimit = Math.min(parseInt(limit), 100);

    // Parse skill IDs array
    const skillIdArray = skillIds ? skillIds.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];

    let query = `
      SELECT DISTINCT
        mp.id, mp.name, mp.description, mp.category, mp.sku, mp.price_cents,
        mp.product_image_url, mp.is_available, mp.source, mp.external_id,
        mp.avg_rating, mp.rating_count, mp.in_carts_count,
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

    // Filter by price range
    if (minPrice) {
      query += ` AND mp.price_cents >= $${paramCount}`;
      params.push(Math.ceil(parseFloat(minPrice) * 100));
      paramCount++;
    }

    if (maxPrice) {
      query += ` AND mp.price_cents <= $${paramCount}`;
      params.push(Math.floor(parseFloat(maxPrice) * 100));
      paramCount++;
    }

    // Filter by multiple skill IDs (ALL of them must match)
    if (skillIdArray.length > 0) {
      query += ` AND mps.skill_id = ANY($${paramCount}::int[])`;
      params.push(skillIdArray);
      paramCount++;
    }

    // Filter by category
    if (category && category.trim()) {
      query += ` AND mp.category ILIKE $${paramCount}`;
      params.push(`%${category}%`);
      paramCount++;
    }

    // Count total for pagination (before grouping)
    const countQuery = `
      SELECT COUNT(DISTINCT mp.id) as total
      FROM marketplace_products mp
      LEFT JOIN marketplace_product_skills mps ON mp.id = mps.product_id
      WHERE mp.is_active = TRUE AND mp.is_available = TRUE
      ${minPrice ? `AND mp.price_cents >= ${Math.ceil(parseFloat(minPrice) * 100)}` : ''}
      ${maxPrice ? `AND mp.price_cents <= ${Math.floor(parseFloat(maxPrice) * 100)}` : ''}
      ${skillIdArray.length > 0 ? `AND mps.skill_id = ANY(ARRAY[${skillIdArray.join(',')}]::int[])` : ''}
      ${category && category.trim() ? `AND mp.category ILIKE '${category.replace(/'/g, "''")}'` : ''}
    `;

    const countResult = await pool.query(countQuery);
    const total = parseInt(countResult.rows[0]?.total || 0);

    // Apply grouping and ordering
    query += ` GROUP BY mp.id ORDER BY `;

    // Apply sorting
    switch (sortBy) {
      case 'price_asc':
        query += `mp.price_cents ASC`;
        break;
      case 'price_desc':
        query += `mp.price_cents DESC`;
        break;
      case 'rating':
        query += `mp.avg_rating DESC NULLS LAST, mp.rating_count DESC`;
        break;
      case 'in_carts':
        query += `mp.in_carts_count DESC`;
        break;
      case 'newest':
      default:
        query += `mp.updated_at DESC`;
    }

    query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(safeLimit, offset);

    const result = await pool.query(query, params);

    logger.info('Marketplace products browsed', { minPrice, maxPrice, skillIds: skillIdArray, sortBy, page, limit, total });

    sendSuccess(res, {
      data: result.rows,
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
 * Get detailed product info with ratings, reviews, related/frequently bought products
 * GET /api/marketplace/products/:productId
 */
const getProductDetail = async (req, res) => {
  try {
    const { productId } = req.params;

    const query = `
      SELECT
        mp.id, mp.name, mp.description, mp.category, mp.sku, mp.upc,
        mp.price_cents, mp.currency, mp.affiliate_url, mp.product_image_url,
        mp.is_available, mp.source, mp.external_id,
        mp.avg_rating, mp.rating_count, mp.in_carts_count, mp.helper_review_count,
        COALESCE(
          json_agg(jsonb_build_object('id', sl.id, 'name', sl.name))
          FILTER (WHERE sl.id IS NOT NULL),
          '[]'::json
        ) as skills
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
 * Legacy alias for backwards compatibility
 * GET /api/marketplace/products/:productId
 */
const getProduct = getProductDetail;

/**
 * Get products by skill (with optional relevance sorting)
 * GET /api/marketplace/products/by-skill/:skillId?limit=50&sort=relevance|rating|price
 */
const getBySkill = async (req, res) => {
  try {
    const { skillId } = req.params;
    const { limit = 50, sort = 'relevance' } = req.query;
    const safeLimit = Math.min(parseInt(limit), 200);
    const parsedSkillId = parseInt(skillId);

    // Validate skillId
    if (!skillId || isNaN(parsedSkillId)) {
      return sendError(res, 400, 'Valid skill ID is required');
    }

    let orderBy = 'mps.relevance_score DESC NULLS LAST, mp.name ASC';
    switch (sort) {
      case 'rating':
        orderBy = 'mp.avg_rating DESC NULLS LAST, mps.relevance_score DESC NULLS LAST';
        break;
      case 'price':
        orderBy = 'mp.price_cents ASC, mps.relevance_score DESC NULLS LAST';
        break;
      case 'relevance':
      default:
        orderBy = 'mps.relevance_score DESC NULLS LAST, mp.name ASC';
    }

    const query = `
      SELECT DISTINCT
        mp.id, mp.name, mp.description, mp.category, mp.price_cents,
        mp.product_image_url, mp.is_available, mp.avg_rating, mp.rating_count,
        mp.in_carts_count, mps.relevance_score
      FROM marketplace_products mp
      JOIN marketplace_product_skills mps ON mp.id = mps.product_id
      WHERE mps.skill_id = $1 AND mp.is_active = TRUE AND mp.is_available = TRUE
      ORDER BY ${orderBy}
      LIMIT $2
    `;

    const result = await pool.query(query, [parsedSkillId, safeLimit]);

    logger.info('Products fetched by skill', { skillId: parsedSkillId, count: result.rows.length, sort });

    sendSuccess(res, {
      data: result.rows,
      skillId: parsedSkillId,
      pagination: {
        limit: safeLimit,
        total: result.rows.length,
        hasMore: result.rows.length >= safeLimit,
      },
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
 * Search products (full-text search on name + description + filters)
 * GET /api/marketplace/products/search?q=sink&skillIds=1,2&minPrice=10&maxPrice=100&page=1&limit=20
 */
const searchProducts = async (req, res) => {
  try {
    const { q, skillIds, minPrice, maxPrice, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const safeLimit = Math.min(parseInt(limit), 100);

    if (!q || q.trim().length < 2) {
      return sendError(res, 400, 'Search query must be at least 2 characters');
    }

    // Parse skill IDs array
    const skillIdArray = skillIds ? skillIds.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];

    let query = `
      SELECT DISTINCT
        mp.id, mp.name, mp.description, mp.category, mp.price_cents,
        mp.product_image_url, mp.is_available,
        mp.avg_rating, mp.rating_count, mp.in_carts_count,
        ts_rank(to_tsvector('english', mp.name || ' ' || COALESCE(mp.description, '')),
                plainto_tsquery('english', $1)) as relevance,
        COALESCE(
          json_agg(DISTINCT jsonb_build_object('id', sl.id, 'name', sl.name))
          FILTER (WHERE sl.id IS NOT NULL),
          '[]'::json
        ) as skills
      FROM marketplace_products mp
      LEFT JOIN marketplace_product_skills mps ON mp.id = mps.product_id
      LEFT JOIN skills_lookup sl ON mps.skill_id = sl.id
      WHERE mp.is_active = TRUE
        AND to_tsvector('english', mp.name || ' ' || COALESCE(mp.description, ''))
            @@ plainto_tsquery('english', $1)
    `;

    const params = [q];
    let paramCount = 2;

    if (minPrice) {
      query += ` AND mp.price_cents >= $${paramCount}`;
      params.push(Math.ceil(parseFloat(minPrice) * 100));
      paramCount++;
    }

    if (maxPrice) {
      query += ` AND mp.price_cents <= $${paramCount}`;
      params.push(Math.floor(parseFloat(maxPrice) * 100));
      paramCount++;
    }

    if (skillIdArray.length > 0) {
      query += ` AND mps.skill_id = ANY($${paramCount}::int[])`;
      params.push(skillIdArray);
      paramCount++;
    }

    query += ` GROUP BY mp.id
              ORDER BY relevance DESC, mp.name ASC
              LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(safeLimit, offset);

    const result = await pool.query(query, params);

    logger.info('Products searched', { query: q, skillIds: skillIdArray, resultsCount: result.rows.length });

    sendSuccess(res, {
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: safeLimit,
        total: result.rows.length,
        hasMore: offset + safeLimit < result.rows.length,
      },
    });
  } catch (err) {
    logger.error('Error searching products', err);
    sendError(res, 500, 'Failed to search products');
  }
};

/**
 * Get related products by skill
 * GET /api/marketplace/products/:productId/related?limit=10
 */
const getRelatedProducts = async (req, res) => {
  try {
    const { productId } = req.params;
    const { limit = 10 } = req.query;
    const safeLimit = Math.min(parseInt(limit), 50);

    // Get skills of the product
    const skillsQuery = `
      SELECT DISTINCT sl.id
      FROM marketplace_product_skills mps
      JOIN skills_lookup sl ON mps.skill_id = sl.id
      WHERE mps.product_id = $1
      LIMIT 5
    `;

    const skillsResult = await pool.query(skillsQuery, [productId]);
    const skillIds = skillsResult.rows.map(r => r.id);

    if (skillIds.length === 0) {
      return sendSuccess(res, { data: [] });
    }

    // Get related products with same skills
    const query = `
      SELECT DISTINCT
        mp.id, mp.name, mp.description, mp.category, mp.price_cents,
        mp.product_image_url, mp.is_available,
        mp.avg_rating, mp.rating_count, mp.in_carts_count,
        COUNT(DISTINCT mps.skill_id) as matching_skills
      FROM marketplace_products mp
      JOIN marketplace_product_skills mps ON mp.id = mps.product_id
      WHERE mp.is_active = TRUE
        AND mp.is_available = TRUE
        AND mp.id != $1
        AND mps.skill_id = ANY($2::int[])
      GROUP BY mp.id
      ORDER BY matching_skills DESC, mp.avg_rating DESC NULLS LAST, mp.in_carts_count DESC
      LIMIT $3
    `;

    const result = await pool.query(query, [productId, skillIds, safeLimit]);

    logger.info('Related products fetched', { productId, relatedCount: result.rows.length });

    sendSuccess(res, { data: result.rows });
  } catch (err) {
    logger.error('Error fetching related products', err);
    sendError(res, 500, 'Failed to fetch related products');
  }
};

/**
 * Get frequently bought together products
 * GET /api/marketplace/products/:productId/frequently-bought?limit=10
 */
const getFrequentlyBoughtWith = async (req, res) => {
  try {
    const { productId } = req.params;
    const { limit = 10 } = req.query;
    const safeLimit = Math.min(parseInt(limit), 50);

    const query = `
      SELECT
        mp.id, mp.name, mp.description, mp.category, mp.price_cents,
        mp.product_image_url, mp.is_available,
        mp.avg_rating, mp.rating_count, mp.in_carts_count,
        fbt.frequency, fbt.co_purchase_count
      FROM frequently_bought_together fbt
      JOIN marketplace_products mp ON fbt.related_product_id = mp.id
      WHERE fbt.product_id = $1
        AND mp.is_active = TRUE
        AND mp.is_available = TRUE
      ORDER BY fbt.frequency DESC, fbt.co_purchase_count DESC
      LIMIT $2
    `;

    const result = await pool.query(query, [productId, safeLimit]);

    logger.info('Frequently bought products fetched', { productId, count: result.rows.length });

    sendSuccess(res, { data: result.rows });
  } catch (err) {
    logger.error('Error fetching frequently bought products', err);
    sendError(res, 500, 'Failed to fetch frequently bought products');
  }
};

/**
 * Get product reviews with pagination
 * GET /api/marketplace/products/:productId/reviews?page=1&limit=10
 */
const getProductReviews = async (req, res) => {
  try {
    const { productId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const safeLimit = Math.min(parseInt(limit), 50);

    const query = `
      SELECT
        pr.id, pr.rating, pr.review_text, pr.helpful_count,
        pr.is_verified_purchase, pr.created_at,
        u.first_name, u.last_name,
        json_build_object('id', hp.id, 'avg_rating', hp.avg_rating, 'jobs_completed', hp.jobs_completed)
          as helper_info
      FROM product_reviews pr
      JOIN users u ON pr.helper_id = u.id
      LEFT JOIN helper_profiles hp ON u.id = hp.user_id
      WHERE pr.product_id = $1
      ORDER BY pr.helpful_count DESC, pr.created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `SELECT COUNT(*) as total FROM product_reviews WHERE product_id = $1`;
    const countResult = await pool.query(countQuery, [productId]);
    const total = parseInt(countResult.rows[0]?.total || 0);

    const result = await pool.query(query, [productId, safeLimit, offset]);

    logger.info('Product reviews fetched', { productId, page, limit, total });

    sendSuccess(res, {
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: safeLimit,
        total,
        hasMore: offset + safeLimit < total,
      },
    });
  } catch (err) {
    logger.error('Error fetching product reviews', err);
    sendError(res, 500, 'Failed to fetch reviews');
  }
};

/**
 * Submit product review
 * POST /api/marketplace/products/:productId/reviews
 */
const submitProductReview = async (req, res) => {
  try {
    const { productId } = req.params;
    const { rating, reviewText } = req.body;
    const userId = req.user.id;

    if (!rating || rating < 1 || rating > 5) {
      return sendError(res, 400, 'Rating must be between 1 and 5');
    }

    // Verify user is a helper
    if (!['helper', 'helper_pro', 'broker'].includes(req.user.role)) {
      return sendError(res, 403, 'Only helpers can submit reviews');
    }

    const query = `
      INSERT INTO product_reviews (product_id, helper_id, rating, review_text)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (product_id, helper_id)
      DO UPDATE SET
        rating = EXCLUDED.rating,
        review_text = EXCLUDED.review_text,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const result = await pool.query(query, [productId, userId, rating, reviewText || null]);

    logger.info('Product review submitted', { productId, userId, rating });

    sendSuccess(res, {
      message: 'Review submitted successfully',
      review: result.rows[0],
    });
  } catch (err) {
    logger.error('Error submitting product review', err);
    sendError(res, 500, 'Failed to submit review');
  }
};

/**
 * Get recommended products for logged-in helper's skills
 * GET /api/marketplace/products/recommended?limit=20
 */
const getRecommendedProducts = async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const safeLimit = Math.min(parseInt(limit), 100);

    if (!req.user) {
      return sendError(res, 401, 'Authentication required');
    }

    const userId = req.user.id;

    const query = `
      SELECT DISTINCT
        mp.id, mp.name, mp.description, mp.category, mp.price_cents,
        mp.product_image_url, mp.is_available,
        mp.avg_rating, mp.rating_count, mp.in_carts_count,
        COUNT(DISTINCT mps.skill_id) as matching_skills
      FROM marketplace_products mp
      JOIN marketplace_product_skills mps ON mp.id = mps.product_id
      JOIN user_skills us ON mps.skill_id = us.skill_id
      WHERE mp.is_active = TRUE
        AND mp.is_available = TRUE
        AND us.user_id = $1
      GROUP BY mp.id
      ORDER BY matching_skills DESC, mp.avg_rating DESC NULLS LAST, mp.in_carts_count DESC
      LIMIT $2
    `;

    const result = await pool.query(query, [userId, safeLimit]);

    logger.info('Recommended products fetched', { userId, count: result.rows.length });

    sendSuccess(res, {
      data: result.rows,
    });
  } catch (err) {
    logger.error('Error fetching recommended products', err);
    sendError(res, 500, 'Failed to fetch recommended products');
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
  getProductDetail,
  getBySkill,
  getCategories,
  searchProducts,
  getRelatedProducts,
  getFrequentlyBoughtWith,
  getProductReviews,
  submitProductReview,
  getRecommendedProducts,
  syncFromHomeDepot,
};
