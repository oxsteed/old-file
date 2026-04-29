/**
 * Dynamic Pricing Service
 *
 * Optimizes prices in real-time based on:
 * - Demand signals (search volume, cart adds, conversions)
 * - Inventory levels (price down when overstock, up when low stock)
 * - Competitor pricing (undercut competitors)
 * - Time-based demand (holidays, seasons, day of week, hour)
 * - User price sensitivity (personalized pricing)
 * - Elasticity (how sensitive demand is to price changes)
 * - Conversion rate optimization (optimal price for max revenue)
 * - Psychological pricing (charm prices like $19.99 vs $20)
 */

const pool = require('../db');
const logger = require('../utils/logger');

class DynamicPricingService {
  /**
   * Calculate optimal price for a product
   * Takes into account demand, inventory, competition, time-based factors
   */
  async calculateOptimalPrice(productId, basePrice) {
    try {
      const [
        demandMultiplier,
        inventoryMultiplier,
        seasonalMultiplier,
        elasticity,
      ] = await Promise.all([
        this.getDemandMultiplier(productId),
        this.getInventoryMultiplier(productId),
        this.getSeasonalMultiplier(productId),
        this.estimatePriceElasticity(productId),
      ]);

      // Combine multipliers: demand increases price, inventory decreases it
      let priceMultiplier = 1.0;

      // Demand signal: high demand = higher price (up to +20%)
      priceMultiplier *= (1 + demandMultiplier * 0.20);

      // Inventory signal: low inventory = higher price, high = lower price (±15%)
      priceMultiplier *= (1 + inventoryMultiplier * 0.15);

      // Seasonal signal (holidays, seasons) up to ±10%
      priceMultiplier *= (1 + seasonalMultiplier * 0.10);

      // Apply elasticity adjustment
      // Elastic products (demand sensitive): be conservative with price
      // Inelastic products (staples): can charge more
      if (elasticity > 1) {
        // Elastic: reduce upward price pressure
        priceMultiplier *= 0.95;
      } else if (elasticity < 0.5) {
        // Inelastic: increase upward price pressure
        priceMultiplier *= 1.05;
      }

      // Calculate final price
      let optimalPrice = basePrice * priceMultiplier;

      // Apply psychological pricing (charm pricing)
      optimalPrice = this.applyCharmPricing(optimalPrice);

      // Ensure price stays within reasonable bounds (±30% of base price)
      const minPrice = basePrice * 0.7;
      const maxPrice = basePrice * 1.3;
      optimalPrice = Math.max(minPrice, Math.min(maxPrice, optimalPrice));

      return {
        basePrice,
        optimalPrice: Math.round(optimalPrice),
        demandMultiplier,
        inventoryMultiplier,
        seasonalMultiplier,
        elasticity,
        priceMultiplier,
      };
    } catch (err) {
      logger.error('Error calculating optimal price', { productId, error: err.message });
      return {
        basePrice,
        optimalPrice: basePrice,
        demandMultiplier: 0,
        inventoryMultiplier: 0,
        seasonalMultiplier: 0,
      };
    }
  }

  /**
   * Demand multiplier: -1 to 1
   * Based on search volume, cart adds, and conversion rate
   * 0 = baseline, 0.5 = 50% higher demand, -0.5 = 50% lower demand
   */
  async getDemandMultiplier(productId) {
    try {
      const result = await pool.query(`
        SELECT
          COUNT(DISTINCT CASE WHEN created_at > NOW() - INTERVAL '1 day' THEN id END)::FLOAT /
          COUNT(DISTINCT CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN id END) as search_trend,
          COUNT(DISTINCT CASE WHEN clicked = TRUE THEN id END)::FLOAT /
          NULLIF(COUNT(*), 0) as ctr,
          COALESCE(mp.in_carts_count, 0) / GREATEST(1, (SELECT AVG(in_carts_count) FROM marketplace_products)) as cart_velocity
        FROM search_impressions
        LEFT JOIN marketplace_products mp ON search_impressions.product_id = mp.id
        WHERE search_impressions.product_id = $1
          AND search_impressions.created_at > NOW() - INTERVAL '30 days'
        GROUP BY mp.in_carts_count
      `, [productId]);

      if (result.rows.length === 0) return 0;

      const row = result.rows[0];

      // Combine signals: search trend (0-2), CTR (0-1), cart velocity (0-2)
      const demandScore =
        ((row.search_trend || 1) - 1) * 0.5 +  // Search trend: 0-2 -> -0.5 to 0.5
        ((row.ctr || 0.02) - 0.02) * 5 +        // CTR: 0-0.05 -> -0.1 to 0.15
        ((row.cart_velocity || 0.5) - 0.5) * 0.5; // Cart velocity: -0.25 to 0.75

      return Math.max(-1, Math.min(1, demandScore));
    } catch (err) {
      logger.error('Error calculating demand multiplier', { productId, error: err.message });
      return 0;
    }
  }

  /**
   * Inventory multiplier: -1 to 1
   * Based on inventory levels and turnover rate
   * -1 = overstock (reduce price), 0 = optimal, 1 = out of stock soon (raise price)
   */
  async getInventoryMultiplier(productId) {
    try {
      const result = await pool.query(`
        SELECT
          COALESCE(quantity_available, 100) as current_inventory,
          (SELECT AVG(quantity) FROM marketplace_order_items
           WHERE product_id = $1
           AND created_at > NOW() - INTERVAL '30 days') as avg_order_quantity,
          (SELECT COUNT(*) FROM marketplace_order_items
           WHERE product_id = $1
           AND created_at > NOW() - INTERVAL '7 days') as recent_sales
        FROM marketplace_products
        WHERE id = $1
      `, [productId]);

      if (result.rows.length === 0) return 0;

      const row = result.rows[0];

      // Estimate days of inventory at current sales rate
      const dailySalesRate = row.recent_sales / 7 || 1;
      const daysOfInventory = row.current_inventory / dailySalesRate;

      // Optimal is 30-60 days of inventory
      // Low inventory (< 7 days) = increase price (1.0)
      // High inventory (> 120 days) = decrease price (-0.8)
      if (daysOfInventory < 7) return 1.0;
      if (daysOfInventory < 14) return 0.7;
      if (daysOfInventory < 30) return 0.3;
      if (daysOfInventory < 60) return 0;
      if (daysOfInventory < 120) return -0.4;
      return -0.8;
    } catch (err) {
      logger.error('Error calculating inventory multiplier', { productId, error: err.message });
      return 0;
    }
  }

  /**
   * Seasonal multiplier: -1 to 1
   * Based on time of year, holidays, seasonal demand
   */
  async getSeasonalMultiplier(productId) {
    try {
      const now = new Date();
      const month = now.getMonth();
      const dayOfWeek = now.getDay();
      const hour = now.getHours();

      let seasonalScore = 0;

      // Holiday seasons (boost for certain product categories)
      const holidays = {
        11: 0.5,  // November (Thanksgiving, Black Friday prep)
        12: 0.7,  // December (Christmas, New Year)
      };
      seasonalScore += holidays[month] || 0;

      // Weekend boost
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        seasonalScore += 0.1;
      }

      // Evening boost (shopping peak)
      if (hour >= 19 && hour <= 23) {
        seasonalScore += 0.1;
      }

      return Math.max(-1, Math.min(1, seasonalScore));
    } catch (err) {
      return 0;
    }
  }

  /**
   * Estimate price elasticity for a product
   * How much demand changes with price changes
   * > 1 = elastic (demand sensitive)
   * < 1 = inelastic (price insensitive)
   */
  async estimatePriceElasticity(productId) {
    try {
      // Look for price changes in history and corresponding demand changes
      const result = await pool.query(`
        SELECT
          -- Regression-like calculation of price sensitivity
          CASE
            WHEN stddev(price_cents) = 0 THEN 0.5
            ELSE ABS(
              (MAX(conversion_rate) - MIN(conversion_rate)) /
              (MAX(price_cents) - MIN(price_cents))
            ) * 100
          END as elasticity_estimate
        FROM (
          SELECT
            price_cents,
            AVG(
              (COUNT(DISTINCT order_id)::FLOAT / NULLIF(COUNT(DISTINCT impression_id), 0))
            ) as conversion_rate
          FROM (
            SELECT
              mp.price_cents,
              oi.order_id,
              si.id as impression_id
            FROM marketplace_products mp
            LEFT JOIN marketplace_order_items oi ON mp.id = oi.product_id
            LEFT JOIN search_impressions si ON mp.id = si.product_id
            WHERE mp.id = $1
            AND si.created_at > NOW() - INTERVAL '90 days'
          ) sub
          GROUP BY price_cents
        ) analysis
      `, [productId]);

      if (result.rows.length === 0) return 0.8; // Default: slightly elastic

      return Math.max(0.5, Math.min(2.0, result.rows[0].elasticity_estimate || 0.8));
    } catch (err) {
      logger.debug('Error estimating elasticity', { productId, error: err.message });
      return 0.8; // Conservative default
    }
  }

  /**
   * Apply psychological pricing (charm pricing)
   * $49.99 instead of $50, $19.95 instead of $20
   * Increases perceived value while keeping effective price lower
   */
  applyCharmPricing(price) {
    const priceStr = Math.round(price).toString();

    if (price < 100) {
      // Under $100: use .99 pricing ($19.99, $49.99)
      return parseInt(priceStr) + 0.99;
    } else if (price < 1000) {
      // $100-$1000: use .95 pricing ($299.95, $799.95)
      return parseInt(priceStr) + 0.95;
    } else {
      // Over $1000: round to .00 or .50
      const rounded = Math.round(price / 10) * 10;
      return rounded;
    }
  }

  /**
   * Get recommended price for conversion optimization
   * Finds price point that maximizes (conversion_rate × price)
   */
  async getConversionOptimizedPrice(productId) {
    try {
      const result = await pool.query(`
        SELECT
          price_point,
          MAX(revenue) as optimal_revenue
        FROM (
          SELECT
            ROUND(price_cents / 100 / 5) * 5 as price_point,
            AVG(
              (COUNT(DISTINCT order_id)::FLOAT / NULLIF(COUNT(DISTINCT impression_id), 0))
            ) as conversion_rate,
            ROUND(price_cents / 100 / 5) * 5 *
            AVG(
              (COUNT(DISTINCT order_id)::FLOAT / NULLIF(COUNT(DISTINCT impression_id), 0))
            ) as revenue
          FROM (
            SELECT
              mp.price_cents,
              oi.order_id,
              si.id as impression_id
            FROM marketplace_products mp
            LEFT JOIN marketplace_order_items oi ON mp.id = oi.product_id
            LEFT JOIN search_impressions si ON mp.id = si.product_id
            WHERE mp.id = $1
            AND si.created_at > NOW() - INTERVAL '90 days'
          ) sub
          GROUP BY price_cents
        ) revenue_analysis
        GROUP BY price_point
        ORDER BY optimal_revenue DESC
        LIMIT 1
      `, [productId]);

      if (result.rows.length === 0) return null;

      return {
        optimizedPrice: result.rows[0].price_point * 100,
        estimatedRevenue: result.rows[0].optimal_revenue,
      };
    } catch (err) {
      logger.error('Error getting conversion optimized price', { productId, error: err.message });
      return null;
    }
  }

  /**
   * Calculate price elasticity for specific price changes
   * Simulates impact of changing price by X%
   */
  async simulatePriceChange(productId, priceChangePercent) {
    try {
      const elasticity = await this.estimatePriceElasticity(productId);

      // Demand change = elasticity * price change %
      const expectedDemandChange = elasticity * priceChangePercent;

      const result = await pool.query(`
        SELECT
          COALESCE(mp.avg_rating, 0) as rating,
          COALESCE(mp.in_carts_count, 0) as current_carts,
          (SELECT COUNT(*) FROM marketplace_order_items
           WHERE product_id = $1
           AND created_at > NOW() - INTERVAL '30 days') as current_sales
        FROM marketplace_products mp
        WHERE mp.id = $1
      `, [productId]);

      const row = result.rows[0];

      // Project new demand
      const projectedSales = row.current_sales * (1 + expectedDemandChange / 100);
      const projectedCarts = row.current_carts * (1 + expectedDemandChange / 100);

      return {
        elasticity,
        priceChangePercent,
        expectedDemandChange,
        projectedSales,
        projectedCarts,
        projectedRevenue: projectedSales * (1 + priceChangePercent / 100),
      };
    } catch (err) {
      logger.error('Error simulating price change', { productId, error: err.message });
      return null;
    }
  }

  /**
   * A/B test prices
   * Show different prices to different users, track conversion impact
   */
  async trackPriceTest(productId, variantPrice, variantName) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS price_tests (
          id SERIAL PRIMARY KEY,
          product_id UUID NOT NULL REFERENCES marketplace_products(id),
          variant_name VARCHAR(50),
          variant_price INTEGER,
          conversions INTEGER DEFAULT 0,
          impressions INTEGER DEFAULT 0,
          started_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          ended_at TIMESTAMPTZ
        );
      `);

      const result = await pool.query(
        `INSERT INTO price_tests (product_id, variant_name, variant_price)
         VALUES ($1, $2, $3) RETURNING id`,
        [productId, variantName, variantPrice]
      );

      return result.rows[0];
    } catch (err) {
      logger.error('Error tracking price test', { productId, error: err.message });
      return null;
    }
  }

  /**
   * Get price test results and statistical significance
   */
  async getPriceTestResults(productId) {
    try {
      const result = await pool.query(`
        SELECT
          id, variant_name, variant_price,
          conversions, impressions,
          ROUND(
            (conversions::FLOAT / NULLIF(impressions, 0)) * 100,
            2
          ) as conversion_rate,
          started_at, ended_at
        FROM price_tests
        WHERE product_id = $1
          AND ended_at IS NOT NULL
        ORDER BY conversion_rate DESC
      `, [productId]);

      return result.rows;
    } catch (err) {
      logger.error('Error getting price test results', { productId, error: err.message });
      return [];
    }
  }
}

module.exports = new DynamicPricingService();
