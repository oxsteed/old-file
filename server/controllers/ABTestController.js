const pool = require('../db');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class ABTestController {
  // Create a new A/B test
  static async createTest(req, res) {
    try {
      const {
        test_name,
        description,
        test_type,
        target_audience,
        traffic_allocation_percentage,
        min_sample_size,
        confidence_level,
        power,
        expected_effect_size,
        variants
      } = req.body;

      const helper_id = req.user.id;

      // Validation
      if (!test_name || !test_type) {
        return res.status(400).json({ error: 'test_name and test_type required' });
      }

      if (!Array.isArray(variants) || variants.length < 2) {
        return res.status(400).json({ error: 'At least 2 variants required' });
      }

      if (traffic_allocation_percentage < 0 || traffic_allocation_percentage > 100) {
        return res.status(400).json({ error: 'traffic_allocation_percentage must be 0-100' });
      }

      const query = `
        INSERT INTO ab_tests (
          helper_id,
          test_name,
          description,
          test_type,
          status,
          target_audience,
          traffic_allocation_percentage,
          min_sample_size,
          confidence_level,
          power,
          expected_effect_size,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW()
        ) RETURNING *
      `;

      const result = await pool.query(query, [
        helper_id,
        test_name,
        description,
        test_type,
        'draft',
        target_audience || 'all',
        traffic_allocation_percentage || 100,
        min_sample_size || 100,
        confidence_level || 0.95,
        power || 0.80,
        expected_effect_size || null
      ]);

      const test = result.rows[0];
      const testId = test.id;

      // Insert variants
      const variantQueries = variants.map((variant, index) => {
        const variantId = uuidv4();
        const isControl = index === 0;

        return {
          query: `
            INSERT INTO ab_test_variants (
              id,
              test_id,
              variant_name,
              is_control,
              discount_code_id,
              discount_percentage,
              discount_fixed_amount_cents,
              discount_description,
              created_at,
              updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
            RETURNING *
          `,
          params: [
            variantId,
            testId,
            variant.variant_name || `Variant ${isControl ? 'A (Control)' : String.fromCharCode(66 + index - 1)}`,
            isControl,
            variant.discount_code_id || null,
            variant.discount_percentage || null,
            variant.discount_fixed_amount_cents || null,
            variant.discount_description || null
          ]
        };
      });

      const variantResults = await Promise.all(
        variantQueries.map(vq => pool.query(vq.query, vq.params))
      );

      test.variants = variantResults.map(r => r.rows[0]);

      logger.info('Created A/B test', { test_id: testId, helper_id, variant_count: variants.length });
      res.status(201).json({ success: true, data: test });
    } catch (err) {
      logger.error('Failed to create A/B test', { error: err.message });
      res.status(500).json({ error: 'Failed to create A/B test' });
    }
  }

  // Get all tests for a helper
  static async getTests(req, res) {
    try {
      const helper_id = req.user.id;
      const { status, limit = 20, offset = 0 } = req.query;

      let query = 'SELECT * FROM ab_tests WHERE helper_id = $1';
      const params = [helper_id];

      if (status) {
        query += ` AND status = $${params.length + 1}`;
        params.push(status);
      }

      query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const result = await pool.query(query, params);

      // Fetch variants for each test
      const tests = await Promise.all(
        result.rows.map(async (test) => {
          const variantResult = await pool.query(
            'SELECT * FROM ab_test_variants WHERE test_id = $1 ORDER BY is_control DESC',
            [test.id]
          );
          return { ...test, variants: variantResult.rows };
        })
      );

      res.json({ success: true, data: tests });
    } catch (err) {
      logger.error('Failed to fetch A/B tests', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch A/B tests' });
    }
  }

  // Get single test with current statistics
  static async getTest(req, res) {
    try {
      const { test_id } = req.params;
      const helper_id = req.user.id;

      const query = 'SELECT * FROM ab_tests WHERE id = $1 AND helper_id = $2';
      const result = await pool.query(query, [test_id, helper_id]);

      if (!result.rows.length) {
        return res.status(404).json({ error: 'Test not found' });
      }

      const test = result.rows[0];

      // Fetch variants
      const variantResult = await pool.query(
        'SELECT * FROM ab_test_variants WHERE test_id = $1 ORDER BY is_control DESC',
        [test_id]
      );

      test.variants = variantResult.rows;

      // Fetch latest statistics
      const statsResult = await pool.query(
        'SELECT * FROM ab_test_statistics WHERE test_id = $1 ORDER BY analysis_date DESC LIMIT 1',
        [test_id]
      );

      test.latest_statistics = statsResult.rows[0] || null;

      // Fetch daily metrics for each variant
      const metricsResult = await pool.query(
        `SELECT * FROM ab_test_daily_metrics
         WHERE variant_id = ANY($1)
         ORDER BY metric_date DESC
         LIMIT 30`,
        [test.variants.map(v => v.id)]
      );

      test.daily_metrics = metricsResult.rows;

      res.json({ success: true, data: test });
    } catch (err) {
      logger.error('Failed to fetch A/B test', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch A/B test' });
    }
  }

  // Start test (change status to 'running')
  static async startTest(req, res) {
    try {
      const { test_id } = req.params;
      const helper_id = req.user.id;

      const query = `
        UPDATE ab_tests
        SET status = 'running', start_date = NOW(), updated_at = NOW()
        WHERE id = $1 AND helper_id = $2 AND status = 'draft'
        RETURNING *
      `;

      const result = await pool.query(query, [test_id, helper_id]);

      if (!result.rows.length) {
        return res.status(404).json({ error: 'Test not found or not in draft status' });
      }

      logger.info('Started A/B test', { test_id, helper_id });
      res.json({ success: true, data: result.rows[0] });
    } catch (err) {
      logger.error('Failed to start A/B test', { error: err.message });
      res.status(500).json({ error: 'Failed to start A/B test' });
    }
  }

  // Pause test
  static async pauseTest(req, res) {
    try {
      const { test_id } = req.params;
      const helper_id = req.user.id;

      const query = `
        UPDATE ab_tests
        SET status = 'paused', updated_at = NOW()
        WHERE id = $1 AND helper_id = $2 AND status = 'running'
        RETURNING *
      `;

      const result = await pool.query(query, [test_id, helper_id]);

      if (!result.rows.length) {
        return res.status(404).json({ error: 'Test not found or not in running status' });
      }

      logger.info('Paused A/B test', { test_id, helper_id });
      res.json({ success: true, data: result.rows[0] });
    } catch (err) {
      logger.error('Failed to pause A/B test', { error: err.message });
      res.status(500).json({ error: 'Failed to pause A/B test' });
    }
  }

  // End test (calculate final statistics, declare winner)
  static async endTest(req, res) {
    try {
      const { test_id } = req.params;
      const helper_id = req.user.id;

      // Verify test ownership
      const testResult = await pool.query(
        'SELECT * FROM ab_tests WHERE id = $1 AND helper_id = $2',
        [test_id, helper_id]
      );

      if (!testResult.rows.length) {
        return res.status(404).json({ error: 'Test not found' });
      }

      const test = testResult.rows[0];

      // Calculate final statistics
      const statsResult = await ABTestController.calculateStatistics(test_id);

      if (!statsResult) {
        return res.status(400).json({ error: 'Insufficient data to calculate statistics' });
      }

      // Determine winner
      let winnerId = null;
      let recommendation = 'Insufficient statistical power';

      if (statsResult.is_statistically_significant) {
        // Variant 2 is winner if uplift is positive
        if (statsResult.relative_uplift_percentage > 0) {
          winnerId = statsResult.variant2_id;
          recommendation = `Stop test - Variant 2 wins (${statsResult.relative_uplift_percentage.toFixed(2)}% uplift, p=${statsResult.p_value.toFixed(4)})`;
        } else {
          winnerId = statsResult.variant1_id;
          recommendation = `Stop test - Control wins (Variant 2 underperformed by ${Math.abs(statsResult.relative_uplift_percentage).toFixed(2)}%, p=${statsResult.p_value.toFixed(4)})`;
        }
      } else {
        recommendation = `Continue test or increase sample size (p=${statsResult.p_value.toFixed(4)}, need p<0.05)`;
      }

      // Update test with winner and completion time
      const updateQuery = `
        UPDATE ab_tests
        SET
          status = 'completed',
          end_date = NOW(),
          winner_id = $1,
          statistically_significant = $2,
          p_value = $3,
          updated_at = NOW()
        WHERE id = $4
        RETURNING *
      `;

      const updateResult = await pool.query(updateQuery, [
        winnerId,
        statsResult.is_statistically_significant,
        statsResult.p_value,
        test_id
      ]);

      // Create final report
      const reportQuery = `
        INSERT INTO ab_test_reports (
          test_id,
          report_type,
          summary_json,
          statistical_results,
          recommendation,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING *
      `;

      const reportResult = await pool.query(reportQuery, [
        test_id,
        'final',
        JSON.stringify({
          variant1_conversions: statsResult.variant1_conversions,
          variant1_conversion_rate: statsResult.variant1_conversion_rate,
          variant2_conversions: statsResult.variant2_conversions,
          variant2_conversion_rate: statsResult.variant2_conversion_rate,
          total_sample_size: statsResult.total_sample_size
        }),
        JSON.stringify(statsResult),
        recommendation
      ]);

      logger.info('Ended A/B test', { test_id, helper_id, winner_id: winnerId });

      res.json({
        success: true,
        data: {
          test: updateResult.rows[0],
          statistics: statsResult,
          report: reportResult.rows[0]
        }
      });
    } catch (err) {
      logger.error('Failed to end A/B test', { error: err.message });
      res.status(500).json({ error: 'Failed to end A/B test' });
    }
  }

  // Record assignment (assign visitor/session to variant)
  static async recordAssignment(req, res) {
    try {
      const { test_id, variant_id, user_id, session_id } = req.body;

      if (!test_id || !variant_id) {
        return res.status(400).json({ error: 'test_id and variant_id required' });
      }

      // Verify variant belongs to test
      const variantResult = await pool.query(
        'SELECT * FROM ab_test_variants WHERE id = $1 AND test_id = $2',
        [variant_id, test_id]
      );

      if (!variantResult.rows.length) {
        return res.status(404).json({ error: 'Variant not found in test' });
      }

      const query = `
        INSERT INTO ab_test_assignments (
          test_id,
          variant_id,
          user_id,
          session_id,
          assigned_at
        ) VALUES ($1, $2, $3, $4, NOW())
        RETURNING *
      `;

      const result = await pool.query(query, [test_id, variant_id, user_id || null, session_id || null]);

      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
      logger.error('Failed to record assignment', { error: err.message });
      res.status(500).json({ error: 'Failed to record assignment' });
    }
  }

  // Record event (view, click, conversion, purchase)
  static async recordEvent(req, res) {
    try {
      const { assignment_id, event_type, order_id, revenue_cents } = req.body;

      if (!assignment_id || !event_type) {
        return res.status(400).json({ error: 'assignment_id and event_type required' });
      }

      const validEvents = ['viewed', 'clicked', 'converted'];
      if (!validEvents.includes(event_type)) {
        return res.status(400).json({ error: `event_type must be one of: ${validEvents.join(', ')}` });
      }

      // Update assignment with event timestamp
      const updateQuery = `
        UPDATE ab_test_assignments
        SET
          ${event_type}_at = CASE WHEN ${event_type}_at IS NULL THEN NOW() ELSE ${event_type}_at END,
          ${order_id ? 'order_id = $2,' : ''}
          ${revenue_cents ? `revenue_cents = $${order_id ? 3 : 2},` : ''}
          created_at = created_at
        WHERE id = $1
        RETURNING *
      `;

      const params = [assignment_id];
      if (order_id) params.push(order_id);
      if (revenue_cents) params.push(revenue_cents);

      const result = await pool.query(updateQuery, params);

      if (!result.rows.length) {
        return res.status(404).json({ error: 'Assignment not found' });
      }

      // Update variant metrics snapshot
      const assignment = result.rows[0];
      await pool.query(
        `UPDATE ab_test_variants
         SET
           views_count = views_count + CASE WHEN $2 = 'viewed' THEN 1 ELSE 0 END,
           clicks_count = clicks_count + CASE WHEN $2 = 'clicked' THEN 1 ELSE 0 END,
           conversions_count = conversions_count + CASE WHEN $2 = 'converted' THEN 1 ELSE 0 END,
           revenue_cents = revenue_cents + COALESCE($3, 0),
           updated_at = NOW()
         WHERE id = $1`,
        [assignment.variant_id, event_type, revenue_cents || 0]
      );

      res.json({ success: true, data: assignment });
    } catch (err) {
      logger.error('Failed to record event', { error: err.message });
      res.status(500).json({ error: 'Failed to record event' });
    }
  }

  // Calculate statistics (chi-square test)
  static async calculateStatistics(testId) {
    try {
      // Fetch test and variants
      const testResult = await pool.query('SELECT * FROM ab_tests WHERE id = $1', [testId]);
      if (!testResult.rows.length) return null;

      const test = testResult.rows[0];

      // Fetch variants
      const variantsResult = await pool.query(
        'SELECT * FROM ab_test_variants WHERE test_id = $1 ORDER BY is_control DESC LIMIT 2',
        [testId]
      );

      if (variantsResult.rows.length < 2) return null;

      const variant1 = variantsResult.rows[0]; // Control
      const variant2 = variantsResult.rows[1];

      // Count assignments and conversions per variant
      const statsQuery = `
        SELECT
          variant_id,
          COUNT(*) as sample_size,
          COUNT(CASE WHEN converted_at IS NOT NULL THEN 1 END) as conversions
        FROM ab_test_assignments
        WHERE test_id = $1
        GROUP BY variant_id
      `;

      const statsResult = await pool.query(statsQuery, [testId]);
      const variantStats = {};

      statsResult.rows.forEach(row => {
        variantStats[row.variant_id] = {
          sample_size: parseInt(row.sample_size),
          conversions: parseInt(row.conversions),
          conversion_rate: parseInt(row.conversions) / parseInt(row.sample_size)
        };
      });

      if (!variantStats[variant1.id] || !variantStats[variant2.id]) {
        return null;
      }

      const v1 = variantStats[variant1.id];
      const v2 = variantStats[variant2.id];

      // Chi-square calculation
      // H0: No difference in conversion rates
      const expectedConversions1 = ((v1.conversions + v2.conversions) / (v1.sample_size + v2.sample_size)) * v1.sample_size;
      const expectedConversions2 = ((v1.conversions + v2.conversions) / (v1.sample_size + v2.sample_size)) * v2.sample_size;
      const expectedNonConversions1 = v1.sample_size - expectedConversions1;
      const expectedNonConversions2 = v2.sample_size - expectedConversions2;

      const chiSquare =
        Math.pow(v1.conversions - expectedConversions1, 2) / expectedConversions1 +
        Math.pow(v1.sample_size - v1.conversions - expectedNonConversions1, 2) / expectedNonConversions1 +
        Math.pow(v2.conversions - expectedConversions2, 2) / expectedConversions2 +
        Math.pow(v2.sample_size - v2.conversions - expectedNonConversions2, 2) / expectedNonConversions2;

      // P-value approximation (chi-square with 1 df)
      // For df=1, p≈0.05 when chi_square≈3.841
      const pValue = chiSquare > 3.841 ? 0.05 * Math.exp(-chiSquare / 5) : 1 - (chiSquare / 3.841) * 0.95;
      const isSignificant = pValue < 0.05;

      // Confidence intervals (Wilson score)
      const ci1Lower = ABTestController.wilsonConfidenceInterval(v1.conversions, v1.sample_size, 'lower');
      const ci1Upper = ABTestController.wilsonConfidenceInterval(v1.conversions, v1.sample_size, 'upper');
      const ci2Lower = ABTestController.wilsonConfidenceInterval(v2.conversions, v2.sample_size, 'lower');
      const ci2Upper = ABTestController.wilsonConfidenceInterval(v2.conversions, v2.sample_size, 'upper');

      const relativeUplift = ((v2.conversion_rate - v1.conversion_rate) / v1.conversion_rate) * 100;

      // Store statistics
      const insertQuery = `
        INSERT INTO ab_test_statistics (
          test_id,
          variant1_id,
          variant1_conversions,
          variant1_conversion_rate,
          variant1_confidence_interval_lower,
          variant1_confidence_interval_upper,
          variant2_id,
          variant2_conversions,
          variant2_conversion_rate,
          variant2_confidence_interval_lower,
          variant2_confidence_interval_upper,
          chi_square_statistic,
          p_value,
          degrees_of_freedom,
          relative_uplift_percentage,
          is_statistically_significant,
          confidence_level_achieved,
          variant1_sample_size,
          variant2_sample_size,
          total_sample_size,
          analysis_date
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW()
        ) RETURNING *
      `;

      await pool.query(insertQuery, [
        testId,
        variant1.id,
        v1.conversions,
        parseFloat(v1.conversion_rate.toFixed(3)),
        parseFloat(ci1Lower.toFixed(3)),
        parseFloat(ci1Upper.toFixed(3)),
        variant2.id,
        v2.conversions,
        parseFloat(v2.conversion_rate.toFixed(3)),
        parseFloat(ci2Lower.toFixed(3)),
        parseFloat(ci2Upper.toFixed(3)),
        parseFloat(chiSquare.toFixed(4)),
        parseFloat(Math.max(0, Math.min(1, pValue)).toFixed(6)),
        1,
        parseFloat(relativeUplift.toFixed(2)),
        isSignificant,
        isSignificant ? 0.95 : 0.80,
        v1.sample_size,
        v2.sample_size,
        v1.sample_size + v2.sample_size
      ]);

      return {
        test_id: testId,
        variant1_id: variant1.id,
        variant1_conversions: v1.conversions,
        variant1_conversion_rate: parseFloat(v1.conversion_rate.toFixed(3)),
        variant2_id: variant2.id,
        variant2_conversions: v2.conversions,
        variant2_conversion_rate: parseFloat(v2.conversion_rate.toFixed(3)),
        chi_square_statistic: parseFloat(chiSquare.toFixed(4)),
        p_value: parseFloat(Math.max(0, Math.min(1, pValue)).toFixed(6)),
        relative_uplift_percentage: parseFloat(relativeUplift.toFixed(2)),
        is_statistically_significant: isSignificant,
        variant1_sample_size: v1.sample_size,
        variant2_sample_size: v2.sample_size,
        total_sample_size: v1.sample_size + v2.sample_size
      };
    } catch (err) {
      logger.error('Failed to calculate statistics', { error: err.message });
      return null;
    }
  }

  // Wilson score interval for confidence bounds
  static wilsonConfidenceInterval(successes, trials, bound = 'lower', z = 1.96) {
    const p = successes / trials;
    const denominator = 1 + (z * z) / trials;
    const centre = (p + (z * z) / (2 * trials)) / denominator;
    const adjustment = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * trials)) / trials) / denominator;

    if (bound === 'lower') {
      return Math.max(0, centre - adjustment);
    }
    return Math.min(1, centre + adjustment);
  }
}

module.exports = ABTestController;
