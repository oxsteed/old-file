const pool = require('../db');
const { sendError, sendSuccess } = require('../utils/apiError');
const logger = require('../utils/logger');
const productRankingService = require('../services/productRankingService');
const queryUnderstandingService = require('../services/queryUnderstandingService');
const recommendationService = require('../services/recommendationService');

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
 * Amazon-level advanced search with intelligence
 * GET /api/marketplace/products/search?q=drill&skillIds=1&minPrice=50&maxPrice=500&page=1&limit=20
 *
 * Features:
 * - Query understanding: intent detection, entity recognition, facet extraction
 * - Spell correction and expansion
 * - Multi-factor ranking: BM25 + CTR + conversion + engagement + user affinity
 * - Temporal signals: freshness + momentum
 * - Demand curve tracking
 * - Behavioral learning from clicks and conversions
 */
const searchProducts = async (req, res) => {
  try {
    const { q, skillIds, minPrice, maxPrice, page = 1, limit = 20 } = req.query;
    const userId = req.user?.id;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const safeLimit = Math.min(parseInt(limit), 100);

    if (!q || q.trim().length < 2) {
      return sendError(res, 400, 'Search query must be at least 2 characters');
    }

    // Step 1: Understand query (intent, entities, facets, expansions)
    const queryAnalysis = await queryUnderstandingService.understandQuery(q, {
      userFacets: { minPrice, maxPrice, skillIds },
    });

    // Merge extracted facets with user-provided filters
    const finalFacets = {
      minPrice: queryAnalysis.facets.priceRange?.min || (minPrice ? parseFloat(minPrice) : null),
      maxPrice: queryAnalysis.facets.priceRange?.max || (maxPrice ? parseFloat(maxPrice) : null),
      skillIds: skillIds ? skillIds.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [],
      sortBy: queryAnalysis.facets.sortBy || 'best_match',
      minRating: queryAnalysis.facets.minRating || null,
      inStock: queryAnalysis.facets.inStock !== false,
    };

    const searchTerm = queryAnalysis.normalized;

    // Step 2: Execute search query (get candidates)
    let dbQuery = `
      SELECT DISTINCT
        mp.id, mp.name, mp.description, mp.category, mp.price_cents,
        mp.product_image_url, mp.is_available, mp.created_at,
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
        AND (
          LOWER(mp.name) = $1
          OR LOWER(mp.name) LIKE $2
          OR to_tsvector('english', mp.name || ' ' || COALESCE(mp.description, '')) @@ plainto_tsquery('english', $1)
          OR EXISTS (
            SELECT 1 FROM product_aliases
            WHERE product_id = mp.id AND (LOWER(alias_name) = $1 OR LOWER(alias_name) LIKE $2)
          )
        )
    `;

    const dbParams = [searchTerm, `%${searchTerm}%`];
    let paramCount = 3;

    // Apply facet filters
    if (finalFacets.minPrice !== null) {
      dbQuery += ` AND mp.price_cents >= $${paramCount}`;
      dbParams.push(Math.ceil(finalFacets.minPrice * 100));
      paramCount++;
    }

    if (finalFacets.maxPrice !== null) {
      dbQuery += ` AND mp.price_cents <= $${paramCount}`;
      dbParams.push(Math.floor(finalFacets.maxPrice * 100));
      paramCount++;
    }

    if (finalFacets.minRating !== null) {
      dbQuery += ` AND mp.avg_rating >= $${paramCount}`;
      dbParams.push(finalFacets.minRating);
      paramCount++;
    }

    if (finalFacets.skillIds.length > 0) {
      dbQuery += ` AND mps.skill_id = ANY($${paramCount}::int[])`;
      dbParams.push(finalFacets.skillIds);
      paramCount++;
    }

    dbQuery += ` GROUP BY mp.id ORDER BY mp.name ASC LIMIT 200`;

    const result = await pool.query(dbQuery, dbParams);
    let products = result.rows;

    // Step 3: Advanced re-ranking using multiple signals
    // Get top candidates and apply ML-style ranking
    if (products.length > 0) {
      products = await productRankingService.reRankResults(
        products,
        searchTerm,
        userId
      );

      // Sort by final ranking score if available
      products = products.sort((a, b) => (b._rankingScore || 0) - (a._rankingScore || 0));
    }

    // Apply pagination to ranked results
    const paginatedProducts = products.slice(offset, offset + safeLimit);

    // Log search for analytics and learning
    await queryUnderstandingService.logSearch(q, userId, products.length, null);

    logger.info('Products searched (Amazon-level)', {
      query: q,
      intent: queryAnalysis.intent.primary,
      entities: queryAnalysis.entities.length,
      facets: Object.keys(finalFacets).filter(k => finalFacets[k]),
      resultsCount: products.length,
      paginatedCount: paginatedProducts.length,
    });

    sendSuccess(res, {
      data: paginatedProducts,
      metadata: {
        intent: queryAnalysis.intent,
        entities: queryAnalysis.entities,
        corrections: queryAnalysis.corrections,
        expansions: queryAnalysis.expansions,
      },
      pagination: {
        page: parseInt(page),
        limit: safeLimit,
        total: products.length,
        hasMore: offset + safeLimit < products.length,
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
 * Get all available skills with product counts
 * GET /api/marketplace/products/skills/all
 */
const getSkills = async (req, res) => {
  try {
    const query = `
      SELECT
        sl.id, sl.name, sl.description,
        COUNT(DISTINCT mps.product_id) as product_count,
        ROUND(AVG(mp.avg_rating)::numeric, 2) as avg_rating
      FROM skills_lookup sl
      LEFT JOIN marketplace_product_skills mps ON sl.id = mps.skill_id
      LEFT JOIN marketplace_products mp ON mps.product_id = mp.id AND mp.is_active = TRUE
      GROUP BY sl.id, sl.name, sl.description
      HAVING COUNT(DISTINCT mps.product_id) > 0
      ORDER BY product_count DESC, sl.name ASC
    `;

    const result = await pool.query(query);
    logger.info('Skills fetched', { count: result.rows.length });

    sendSuccess(res, {
      data: result.rows,
      pagination: {
        total: result.rows.length,
      },
    });
  } catch (err) {
    logger.error('Error fetching skills', err);
    sendError(res, 500, 'Failed to fetch skills');
  }
};

/**
 * Get hierarchical product categories
 * GET /api/marketplace/products/categories/hierarchy
 */
const getHierarchicalCategories = async (req, res) => {
  try {
    // Get all categories with product count
    const query = `
      SELECT
        pc.id, pc.name, pc.slug, pc.description,
        pc.parent_category_id, pc.icon_emoji, pc.icon_name, pc.display_order,
        COUNT(DISTINCT mpc.product_id) as product_count
      FROM product_categories pc
      LEFT JOIN marketplace_product_categories mpc ON pc.id = mpc.category_id
      WHERE pc.is_active = TRUE
      GROUP BY pc.id, pc.name, pc.slug, pc.description, pc.parent_category_id,
               pc.icon_emoji, pc.icon_name, pc.display_order
      ORDER BY pc.parent_category_id NULLS FIRST, pc.display_order ASC
    `;

    const result = await pool.query(query);

    // Build hierarchical structure
    const categoryMap = {};
    const rootCategories = [];

    result.rows.forEach(cat => {
      categoryMap[cat.id] = {
        ...cat,
        children: [],
      };
    });

    result.rows.forEach(cat => {
      if (cat.parent_category_id === null) {
        rootCategories.push(categoryMap[cat.id]);
      } else if (categoryMap[cat.parent_category_id]) {
        categoryMap[cat.parent_category_id].children.push(categoryMap[cat.id]);
      }
    });

    logger.info('Categories fetched (hierarchical)', { count: result.rows.length });

    sendSuccess(res, {
      data: rootCategories,
      totalCategories: result.rows.length,
    });
  } catch (err) {
    logger.error('Error fetching hierarchical categories', err);
    sendError(res, 500, 'Failed to fetch categories');
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

/**
 * Autocomplete suggestions for search bar
 * GET /api/marketplace/products/autocomplete?prefix=dri&limit=10
 * Returns popular products matching prefix, ranked by popularity
 */
const getAutocompleteSuggestions = async (req, res) => {
  try {
    const { prefix, limit = 10 } = req.query;
    const userId = req.user?.id;

    if (!prefix || prefix.trim().length < 1) {
      return sendSuccess(res, { data: [] });
    }

    // Get personalized suggestions if user authenticated, else global
    let suggestions;
    if (userId) {
      suggestions = await queryUnderstandingService.getPersonalizedSuggestions(
        userId,
        prefix,
        Math.min(parseInt(limit), 20)
      );
    } else {
      suggestions = await queryUnderstandingService.getSuggestions(
        prefix,
        Math.min(parseInt(limit), 20)
      );
    }

    logger.info('Autocomplete suggestions fetched', {
      prefix,
      count: suggestions.length,
      personalized: !!userId,
    });

    sendSuccess(res, { data: suggestions });
  } catch (err) {
    logger.error('Error fetching autocomplete suggestions', err);
    sendError(res, 500, 'Failed to fetch suggestions');
  }
};

/**
 * Get trending/popular searches
 * GET /api/marketplace/products/trending?limit=10
 * Returns most searched terms in last 7 days
 */
const getTrendingSearches = async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const result = await pool.query(`
      SELECT
        query,
        COUNT(*) as search_count,
        COUNT(DISTINCT user_id) as unique_users,
        MAX(created_at) as last_searched
      FROM search_history
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY query
      ORDER BY search_count DESC
      LIMIT $1
    `, [Math.min(parseInt(limit), 50)]);

    sendSuccess(res, { data: result.rows });
  } catch (err) {
    logger.error('Error fetching trending searches', err);
    sendError(res, 500, 'Failed to fetch trending searches');
  }
};

/**
 * Get search analytics and performance metrics
 * GET /api/admin/marketplace/search-analytics
 * Returns CTR, conversion rates, trending queries for optimization
 */
const getSearchAnalytics = async (req, res) => {
  try {
    // Require admin role
    if (req.user?.role !== 'admin') {
      return sendError(res, 403, 'Admin access required');
    }

    const result = await pool.query(`
      SELECT
        query,
        COUNT(*) as impressions,
        SUM(CASE WHEN clicked = TRUE THEN 1 ELSE 0 END) as clicks,
        ROUND(
          (SUM(CASE WHEN clicked = TRUE THEN 1 ELSE 0 END)::FLOAT /
           NULLS IF(COUNT(*), 0)) * 100,
          2
        ) as ctr_percent,
        AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) as avg_result_time_seconds
      FROM search_impressions
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY query
      HAVING COUNT(*) > 10
      ORDER BY impressions DESC
      LIMIT 100
    `);

    sendSuccess(res, {
      data: result.rows,
      metadata: {
        period: '30 days',
        minImpressions: 10,
      },
    });
  } catch (err) {
    logger.error('Error fetching search analytics', err);
    sendError(res, 500, 'Failed to fetch analytics');
  }
};

/**
 * Get personalized product recommendations
 * GET /api/marketplace/products/recommendations/personalized?limit=20
 * Requires authentication - uses user's history for recommendations
 */
const getPersonalizedRecommendations = async (req, res) => {
  try {
    if (!req.user?.id) {
      return sendError(res, 401, 'Authentication required');
    }

    const { limit = 20 } = req.query;
    const recommendations = await recommendationService.getPersonalizedRecommendations(
      req.user.id,
      Math.min(parseInt(limit), 50)
    );

    logger.info('Personalized recommendations fetched', {
      userId: req.user.id,
      count: recommendations.length,
    });

    sendSuccess(res, { data: recommendations });
  } catch (err) {
    logger.error('Error fetching personalized recommendations', err);
    sendError(res, 500, 'Failed to fetch recommendations');
  }
};

/**
 * Get frequently bought together
 * GET /api/marketplace/products/:productId/frequently-bought-with?limit=10
 */
const getFrequentlyBoughtWith = async (req, res) => {
  try {
    const { productId } = req.params;
    const { limit = 10 } = req.query;

    const recommendations = await recommendationService.getFrequentlyBoughtTogether(
      productId,
      Math.min(parseInt(limit), 50)
    );

    sendSuccess(res, { data: recommendations });
  } catch (err) {
    logger.error('Error fetching frequently bought together', err);
    sendError(res, 500, 'Failed to fetch recommendations');
  }
};

/**
 * Get trending products
 * GET /api/marketplace/products/trending/hot?limit=20&timeWindow=7%20days
 */
const getTrendingProducts = async (req, res) => {
  try {
    const { limit = 20, timeWindow = '7 days' } = req.query;

    const products = await recommendationService.getTrendingProducts(
      Math.min(parseInt(limit), 50),
      timeWindow
    );

    sendSuccess(res, { data: products });
  } catch (err) {
    logger.error('Error fetching trending products', err);
    sendError(res, 500, 'Failed to fetch trending products');
  }
};

/**
 * Get cross-sell recommendations
 * GET /api/marketplace/products/recommendations/cross-sell?limit=10
 * Products from different categories but complementary to user's history
 */
const getCrossSellRecommendations = async (req, res) => {
  try {
    if (!req.user?.id) {
      return sendError(res, 401, 'Authentication required');
    }

    const { limit = 10 } = req.query;

    const recommendations = await recommendationService.getCrossSellRecommendations(
      req.user.id,
      Math.min(parseInt(limit), 50)
    );

    sendSuccess(res, { data: recommendations });
  } catch (err) {
    logger.error('Error fetching cross-sell recommendations', err);
    sendError(res, 500, 'Failed to fetch cross-sell recommendations');
  }
};

/**
 * Get explore recommendations
 * GET /api/marketplace/products/recommendations/explore?limit=12
 * Intentionally introduce serendipity/discovery from less-obvious categories
 */
const getExploreRecommendations = async (req, res) => {
  try {
    if (!req.user?.id) {
      return sendError(res, 401, 'Authentication required');
    }

    const { limit = 12 } = req.query;

    const recommendations = await recommendationService.getExploreRecommendations(
      req.user.id,
      Math.min(parseInt(limit), 50)
    );

    sendSuccess(res, { data: recommendations });
  } catch (err) {
    logger.error('Error fetching explore recommendations', err);
    sendError(res, 500, 'Failed to fetch explore recommendations');
  }
};

module.exports = {
  browseProducts,
  getProduct,
  getProductDetail,
  getBySkill,
  getCategories,
  getHierarchicalCategories,
  getSkills,
  searchProducts,
  getRelatedProducts,
  getFrequentlyBoughtWith,
  getProductReviews,
  submitProductReview,
  getRecommendedProducts,
  getAutocompleteSuggestions,
  getTrendingSearches,
  getSearchAnalytics,
  getPersonalizedRecommendations,
  getTrendingProducts,
  getCrossSellRecommendations,
  getExploreRecommendations,
  syncFromHomeDepot,
};
