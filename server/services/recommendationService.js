/**
 * Recommendation Engine
 *
 * Collaborative filtering + content-based recommendations:
 * - User-to-user similarity (people who viewed X also viewed Y)
 * - Product-to-product affinity (products frequently bought together)
 * - Content-based (similar products by category, skill, attributes)
 * - Hybrid recommendation combining all signals
 * - Cold-start solutions (new users/products)
 * - Personalized recommendations based on user history
 * - Cross-sell and upsell scoring
 * - Diversity and serendipity (not just obvious recommendations)
 */

const pool = require('../db');
const logger = require('../utils/logger');

class RecommendationService {
  /**
   * Get personalized product recommendations for a user
   * Combines: purchase history + browsing history + similar users
   */
  async getPersonalizedRecommendations(userId, limit = 20) {
    try {
      // Get user's product history (purchases + views)
      const userHistory = await pool.query(`
        SELECT DISTINCT
          COALESCE(oi.product_id, si.product_id) as product_id,
          MAX(CASE WHEN oi.product_id IS NOT NULL THEN 1 ELSE 0 END) as purchased,
          COUNT(DISTINCT si.id) as view_count
        FROM (
          -- Products user purchased
          SELECT product_id, user_id FROM marketplace_order_items
          WHERE user_id = $1
          UNION ALL
          -- Products user viewed in search
          SELECT product_id, user_id FROM search_impressions
          WHERE user_id = $1
        ) si
        LEFT JOIN marketplace_order_items oi ON si.product_id = oi.product_id
        GROUP BY COALESCE(oi.product_id, si.product_id)
        LIMIT 100
      `, [userId]);

      if (userHistory.rows.length === 0) {
        // Cold start: return popular products
        return this.getPopularProducts(limit);
      }

      const userProductIds = userHistory.rows.map(r => r.product_id);

      // Collaborative filtering: find similar users
      const similarUsers = await pool.query(`
        SELECT
          si2.user_id,
          COUNT(DISTINCT si2.product_id) as shared_products,
          -- Jaccard similarity: intersection / union
          COUNT(DISTINCT si2.product_id)::FLOAT /
          (COUNT(DISTINCT si1.product_id) + COUNT(DISTINCT si2.product_id)) as similarity_score
        FROM search_impressions si1
        JOIN search_impressions si2 ON si1.product_id = si2.product_id
        WHERE si1.user_id = $1
          AND si2.user_id != $1
        GROUP BY si2.user_id
        HAVING COUNT(DISTINCT si2.product_id) > 5
        ORDER BY similarity_score DESC
        LIMIT 50
      `, [userId]);

      const similarUserIds = similarUsers.rows.map(r => r.user_id);

      // Get products from similar users that current user hasn't seen
      const collaborativeProducts = await pool.query(`
        SELECT DISTINCT
          mp.id, mp.name, mp.description, mp.price_cents,
          mp.product_image_url, mp.avg_rating, mp.rating_count,
          mp.in_carts_count,
          COUNT(si.id) as recommendation_score,
          'collaborative' as recommendation_type
        FROM marketplace_products mp
        JOIN search_impressions si ON mp.id = si.product_id
        WHERE si.user_id = ANY($1)
          AND mp.id NOT IN (
            SELECT product_id FROM search_impressions WHERE user_id = $2
          )
          AND mp.is_active = TRUE
        GROUP BY mp.id, mp.name, mp.description, mp.price_cents,
                 mp.product_image_url, mp.avg_rating, mp.rating_count, mp.in_carts_count
        ORDER BY recommendation_score DESC, mp.avg_rating DESC
        LIMIT $3
      `, [similarUserIds, userId, limit]);

      // Content-based: products similar to user's history
      const contentBasedProducts = await pool.query(`
        SELECT DISTINCT
          mp.id, mp.name, mp.description, mp.price_cents,
          mp.product_image_url, mp.avg_rating, mp.rating_count,
          mp.in_carts_count,
          (
            COUNT(DISTINCT CASE WHEN mps1.skill_id = mps2.skill_id THEN mps1.skill_id END) * 30 +
            CASE WHEN mp.category = mp_hist.category THEN 50 ELSE 0 END +
            mp.in_carts_count / 10
          ) as content_score,
          'content_based' as recommendation_type
        FROM marketplace_products mp
        JOIN marketplace_product_skills mps1 ON mp.id = mps1.product_id
        LEFT JOIN (
          SELECT DISTINCT mp2.id, mp2.category
          FROM marketplace_products mp2
          WHERE mp2.id = ANY($1)
        ) mp_hist ON TRUE
        LEFT JOIN marketplace_product_skills mps2
          ON mp_hist.id = mps2.product_id AND mps1.skill_id = mps2.skill_id
        WHERE mp.id NOT IN (
          SELECT product_id FROM search_impressions WHERE user_id = $2
        )
          AND mp.is_active = TRUE
        GROUP BY mp.id, mp.name, mp.description, mp.price_cents,
                 mp.product_image_url, mp.avg_rating, mp.rating_count,
                 mp.in_carts_count, mp_hist.category
        ORDER BY content_score DESC
        LIMIT $3
      `, [userProductIds, userId, limit]);

      // Hybrid: combine collaborative + content-based
      const allRecommendations = [
        ...collaborativeProducts.rows,
        ...contentBasedProducts.rows,
      ];

      // Deduplicate and sort by combined score
      const seen = new Set();
      const unique = allRecommendations.filter(r => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });

      unique.sort((a, b) => (b.recommendation_score || b.content_score) - (a.recommendation_score || a.content_score));

      return unique.slice(0, limit);
    } catch (err) {
      logger.error('Error getting personalized recommendations', { userId, error: err.message });
      return [];
    }
  }

  /**
   * Frequently bought together
   * Products commonly purchased in same order
   */
  async getFrequentlyBoughtTogether(productId, limit = 10) {
    try {
      const result = await pool.query(`
        SELECT
          mp.id, mp.name, mp.description, mp.price_cents,
          mp.product_image_url, mp.avg_rating, mp.in_carts_count,
          COUNT(*) as co_purchases,
          ROUND(
            COUNT(*)::FLOAT /
            (SELECT COUNT(*) FROM marketplace_order_items WHERE product_id = $1),
            3
          ) as co_purchase_rate
        FROM marketplace_order_items oi1
        JOIN marketplace_order_items oi2 ON oi1.order_id = oi2.order_id
          AND oi1.product_id = $1
          AND oi2.product_id != $1
        JOIN marketplace_products mp ON oi2.product_id = mp.id
        WHERE mp.is_active = TRUE
        GROUP BY mp.id, mp.name, mp.description, mp.price_cents,
                 mp.product_image_url, mp.avg_rating, mp.in_carts_count
        HAVING COUNT(*) > 3
        ORDER BY co_purchase_rate DESC, co_purchases DESC
        LIMIT $2
      `, [productId, limit]);

      return result.rows;
    } catch (err) {
      logger.error('Error getting frequently bought together', { productId, error: err.message });
      return [];
    }
  }

  /**
   * Popular products in specific category/skill
   * Used for trending, homepage, cold-start recommendations
   */
  async getPopularProducts(limit = 20, category = null, skill = null) {
    try {
      let query = `
        SELECT
          mp.id, mp.name, mp.description, mp.price_cents,
          mp.product_image_url, mp.avg_rating, mp.rating_count,
          mp.in_carts_count,
          -- Popularity scoring: recent purchases + high rating + lots of reviews
          (
            mp.in_carts_count * 0.5 +
            mp.rating_count * 0.3 +
            (mp.avg_rating * 100 / 5) * 0.2
          ) as popularity_score
        FROM marketplace_products mp
        LEFT JOIN marketplace_product_skills mps ON mp.id = mps.product_id
        WHERE mp.is_active = TRUE AND mp.is_available = TRUE
      `;

      const params = [];

      if (category) {
        query += ` AND mp.category = $1`;
        params.push(category);
      }

      if (skill) {
        query += ` AND mps.skill_id = $${params.length + 1}`;
        params.push(skill);
      }

      query += `
        GROUP BY mp.id, mp.name, mp.description, mp.price_cents,
                 mp.product_image_url, mp.avg_rating, mp.rating_count, mp.in_carts_count
        ORDER BY popularity_score DESC, mp.avg_rating DESC
        LIMIT $${params.length + 1}
      `;
      params.push(limit);

      const result = await pool.query(query, params);
      return result.rows;
    } catch (err) {
      logger.error('Error getting popular products', { category, skill, error: err.message });
      return [];
    }
  }

  /**
   * Find products that would be good cross-sells
   * Different category/skill but complementary to user's history
   */
  async getCrossSellRecommendations(userId, limit = 10) {
    try {
      const result = await pool.query(`
        WITH user_categories AS (
          SELECT DISTINCT mp.category
          FROM marketplace_order_items oi
          JOIN marketplace_products mp ON oi.product_id = mp.id
          WHERE oi.user_id = $1
        ),
        user_skills AS (
          SELECT DISTINCT mps.skill_id
          FROM marketplace_order_items oi
          JOIN marketplace_product_skills mps ON oi.product_id = mps.product_id
          WHERE oi.user_id = $1
        )
        SELECT
          mp.id, mp.name, mp.description, mp.price_cents,
          mp.product_image_url, mp.avg_rating, mp.in_carts_count,
          -- Cross-sell score: complementary products with good ratings
          (mp.avg_rating * 100 / 5) + (mp.in_carts_count / 10) as cross_sell_score
        FROM marketplace_products mp
        WHERE mp.is_active = TRUE
          -- Different category from user's purchases
          AND mp.category NOT IN (SELECT category FROM user_categories)
          -- But related skill
          AND EXISTS (
            SELECT 1 FROM marketplace_product_skills mps
            WHERE mps.product_id = mp.id
              AND mps.skill_id IN (SELECT skill_id FROM user_skills)
          )
        ORDER BY cross_sell_score DESC, mp.avg_rating DESC
        LIMIT $2
      `, [userId, limit]);

      return result.rows;
    } catch (err) {
      logger.error('Error getting cross-sell recommendations', { userId, error: err.message });
      return [];
    }
  }

  /**
   * Trending/hot products
   * Products with high recent sales velocity
   */
  async getTrendingProducts(limit = 20, timeWindow = '7 days') {
    try {
      const result = await pool.query(`
        SELECT
          mp.id, mp.name, mp.price_cents, mp.product_image_url,
          mp.avg_rating, mp.in_carts_count,
          COUNT(DISTINCT oi.order_id) as recent_sales,
          COUNT(DISTINCT si.id) as recent_views,
          -- Velocity: sales / views (conversion rate)
          ROUND(
            COUNT(DISTINCT oi.order_id)::FLOAT /
            NULLIF(COUNT(DISTINCT si.id), 0),
            3
          ) as sales_velocity
        FROM marketplace_products mp
        LEFT JOIN marketplace_order_items oi
          ON mp.id = oi.product_id
          AND oi.created_at > NOW() - INTERVAL $1
        LEFT JOIN search_impressions si
          ON mp.id = si.product_id
          AND si.created_at > NOW() - INTERVAL $1
        WHERE mp.is_active = TRUE
        GROUP BY mp.id, mp.name, mp.price_cents, mp.product_image_url,
                 mp.avg_rating, mp.in_carts_count
        HAVING COUNT(DISTINCT si.id) > 10
        ORDER BY sales_velocity DESC, recent_sales DESC
        LIMIT $2
      `, [timeWindow, limit]);

      return result.rows;
    } catch (err) {
      logger.error('Error getting trending products', { error: err.message });
      return [];
    }
  }

  /**
   * Explore recommendations
   * Intentionally introduce serendipity/discovery
   * Show products from less-obvious categories but matching user skills
   */
  async getExploreRecommendations(userId, limit = 12) {
    try {
      const result = await pool.query(`
        WITH user_skills AS (
          SELECT DISTINCT mps.skill_id
          FROM marketplace_order_items oi
          JOIN marketplace_product_skills mps ON oi.product_id = mps.product_id
          WHERE oi.user_id = $1
        ),
        uncommon_categories AS (
          SELECT category FROM marketplace_products
          WHERE is_active = TRUE
          GROUP BY category
          ORDER BY COUNT(*) ASC
          LIMIT 10
        )
        SELECT
          mp.id, mp.name, mp.description, mp.price_cents,
          mp.product_image_url, mp.avg_rating,
          'explore' as recommendation_type
        FROM marketplace_products mp
        JOIN marketplace_product_skills mps ON mp.id = mps.product_id
        WHERE mp.is_active = TRUE
          AND mps.skill_id IN (SELECT skill_id FROM user_skills)
          AND mp.category IN (SELECT category FROM uncommon_categories)
          AND mp.id NOT IN (
            SELECT product_id FROM search_impressions WHERE user_id = $1
          )
        ORDER BY RANDOM(), mp.avg_rating DESC
        LIMIT $2
      `, [userId, limit]);

      return result.rows;
    } catch (err) {
      logger.error('Error getting explore recommendations', { userId, error: err.message });
      return [];
    }
  }

  /**
   * Log recommendation shown to user (for analytics and learning)
   */
  async trackRecommendation(userId, productId, recommendationType, position) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS recommendation_impressions (
          id SERIAL PRIMARY KEY,
          user_id UUID NOT NULL,
          product_id UUID NOT NULL REFERENCES marketplace_products(id),
          recommendation_type VARCHAR(50),
          position SMALLINT,
          clicked BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_rec_impressions_user
          ON recommendation_impressions(user_id);
        CREATE INDEX IF NOT EXISTS idx_rec_impressions_product
          ON recommendation_impressions(product_id);
        CREATE INDEX IF NOT EXISTS idx_rec_impressions_type
          ON recommendation_impressions(recommendation_type);
      `);

      await pool.query(
        `INSERT INTO recommendation_impressions (user_id, product_id, recommendation_type, position)
         VALUES ($1, $2, $3, $4)`,
        [userId, productId, recommendationType, position]
      );
    } catch (err) {
      logger.debug('Error tracking recommendation', { userId, productId, error: err.message });
    }
  }

  /**
   * Log recommendation click (user clicked on recommendation)
   */
  async trackRecommendationClick(userId, productId) {
    try {
      await pool.query(
        `UPDATE recommendation_impressions
         SET clicked = TRUE
         WHERE user_id = $1 AND product_id = $2
         ORDER BY created_at DESC LIMIT 1`,
        [userId, productId]
      );
    } catch (err) {
      logger.debug('Error tracking rec click', { userId, productId, error: err.message });
    }
  }

  /**
   * Get recommendation analytics (CTR by type)
   * Used for A/B testing and optimization
   */
  async getRecommendationAnalytics(recommendationType = null) {
    try {
      let query = `
        SELECT
          recommendation_type,
          COUNT(*) as impressions,
          SUM(CASE WHEN clicked = TRUE THEN 1 ELSE 0 END) as clicks,
          ROUND(
            (SUM(CASE WHEN clicked = TRUE THEN 1 ELSE 0 END)::FLOAT /
             NULLIF(COUNT(*), 0)) * 100,
            2
          ) as ctr_percent
        FROM recommendation_impressions
        WHERE created_at > NOW() - INTERVAL '30 days'
      `;

      const params = [];
      if (recommendationType) {
        query += ` WHERE recommendation_type = $1`;
        params.push(recommendationType);
      }

      query += ` GROUP BY recommendation_type ORDER BY impressions DESC`;

      const result = await pool.query(query, params);
      return result.rows;
    } catch (err) {
      logger.error('Error getting recommendation analytics', { error: err.message });
      return [];
    }
  }
}

module.exports = new RecommendationService();
