const crypto = require('crypto');
const { pool } = require('../utils/db');
const { withTransaction } = require('../utils/transaction');
const logger = require('../utils/logger');
const { sendError, sendValidationError } = require('../utils/apiError');

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function generateKey() {
  return 'apk_' + crypto.randomBytes(24).toString('hex');
}

async function createApiProduct(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendError(res, 401, 'Unauthorized');

    const {
      name,
      description,
      category,
      pricing_type = 'one_time',
      price_cents,
      monthly_price_cents,
      webhook_url,
      max_requests_per_month,
      documentation_url,
      support_email,
      terms_url
    } = req.body;

    // Validation
    if (!name) return sendValidationError(res, { name: 'Required' });
    if (!pricing_type) return sendValidationError(res, { pricing_type: 'Required' });
    if (pricing_type === 'one_time' && !price_cents) {
      return sendValidationError(res, { price_cents: 'Required for one-time pricing' });
    }
    if (pricing_type === 'recurring' && !monthly_price_cents) {
      return sendValidationError(res, { monthly_price_cents: 'Required for recurring pricing' });
    }

    const product = await pool.query(
      `INSERT INTO api_products
       (creator_id, name, description, category, pricing_type, price_cents, monthly_price_cents,
        webhook_url, max_requests_per_month, documentation_url, support_email, terms_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        userId, name, description, category, pricing_type, price_cents || null, monthly_price_cents || null,
        webhook_url, max_requests_per_month, documentation_url, support_email, terms_url, 'draft'
      ]
    );

    logger.info('API product created', { productId: product.rows[0].id, name });

    res.json({
      success: true,
      data: product.rows[0]
    });
  } catch (error) {
    logger.error('Error creating API product', { error });
    sendError(res, 500, 'Failed to create API product');
  }
}

async function publishApiProduct(req, res) {
  try {
    const userId = req.user?.id;
    const { productId } = req.params;

    if (!userId) return sendError(res, 401, 'Unauthorized');

    // Check product exists and belongs to user
    const product = await pool.query(
      'SELECT * FROM api_products WHERE id = $1 AND creator_id = $2',
      [productId, userId]
    );

    if (!product.rows.length) return sendError(res, 404, 'Product not found');

    const updated = await pool.query(
      `UPDATE api_products SET status = $1, published_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      ['published', productId]
    );

    logger.info('API product published', { productId });

    res.json({
      success: true,
      data: updated.rows[0]
    });
  } catch (error) {
    logger.error('Error publishing API product', { error });
    sendError(res, 500, 'Failed to publish API product');
  }
}

async function getApiProduct(req, res) {
  try {
    const { productId } = req.params;

    const product = await pool.query(
      'SELECT * FROM api_products WHERE id = $1',
      [productId]
    );

    if (!product.rows.length) return sendError(res, 404, 'Product not found');

    res.json({
      success: true,
      data: product.rows[0]
    });
  } catch (error) {
    logger.error('Error fetching API product', { error });
    sendError(res, 500, 'Failed to fetch API product');
  }
}

async function getCreatorApiProducts(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendError(res, 401, 'Unauthorized');

    const products = await pool.query(
      'SELECT * FROM api_products WHERE creator_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    res.json({
      success: true,
      data: products.rows
    });
  } catch (error) {
    logger.error('Error fetching creator API products', { error });
    sendError(res, 500, 'Failed to fetch products');
  }
}

async function generateApiKey(req, res) {
  try {
    const userId = req.user?.id;
    const { productId } = req.params;

    if (!userId) return sendError(res, 401, 'Unauthorized');

    // Verify product exists and user has access
    const product = await pool.query(
      'SELECT * FROM api_products WHERE id = $1',
      [productId]
    );

    if (!product.rows.length) return sendError(res, 404, 'Product not found');

    const apiKey = generateKey();
    const keyHash = hashKey(apiKey);
    const keyPrefix = apiKey.substring(0, 20);

    const record = await pool.query(
      `INSERT INTO api_product_keys
       (api_product_id, customer_id, key_hash, key_prefix)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [productId, userId, keyHash, keyPrefix]
    );

    logger.info('API key generated', { productId, keyId: record.rows[0].id });

    res.json({
      success: true,
      data: {
        id: record.rows[0].id,
        apiKey, // Only returned once
        keyPrefix,
        createdAt: record.rows[0].created_at
      }
    });
  } catch (error) {
    logger.error('Error generating API key', { error });
    sendError(res, 500, 'Failed to generate API key');
  }
}

async function revokeApiKey(req, res) {
  try {
    const userId = req.user?.id;
    const { keyId } = req.params;

    if (!userId) return sendError(res, 401, 'Unauthorized');

    // Verify key belongs to user
    const key = await pool.query(
      `SELECT apk.* FROM api_product_keys apk
       WHERE apk.id = $1 AND apk.customer_id = $2`,
      [keyId, userId]
    );

    if (!key.rows.length) return sendError(res, 404, 'Key not found');

    const updated = await pool.query(
      `UPDATE api_product_keys SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [keyId]
    );

    logger.info('API key revoked', { keyId });

    res.json({
      success: true,
      data: updated.rows[0]
    });
  } catch (error) {
    logger.error('Error revoking API key', { error });
    sendError(res, 500, 'Failed to revoke API key');
  }
}

async function getApiKeys(req, res) {
  try {
    const userId = req.user?.id;
    const { productId } = req.params;

    if (!userId) return sendError(res, 401, 'Unauthorized');

    const keys = await pool.query(
      `SELECT id, api_product_id, key_prefix, usage_limit, requests_this_month, last_used_at, revoked_at, created_at
       FROM api_product_keys
       WHERE api_product_id = $1 AND customer_id = $2
       ORDER BY created_at DESC`,
      [productId, userId]
    );

    res.json({
      success: true,
      data: keys.rows
    });
  } catch (error) {
    logger.error('Error fetching API keys', { error });
    sendError(res, 500, 'Failed to fetch API keys');
  }
}

async function getApiProductUsage(req, res) {
  try {
    const userId = req.user?.id;
    const { productId } = req.params;

    if (!userId) return sendError(res, 401, 'Unauthorized');

    // Verify product belongs to user
    const product = await pool.query(
      'SELECT * FROM api_products WHERE id = $1 AND creator_id = $2',
      [productId, userId]
    );

    if (!product.rows.length) return sendError(res, 404, 'Product not found');

    // Get usage stats
    const usage = await pool.query(
      `SELECT
        COUNT(*) as total_requests,
        AVG(response_time_ms) as avg_response_time_ms,
        COUNT(DISTINCT key_id) as active_keys,
        SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as error_count,
        DATE(created_at) as date
       FROM api_product_usage_logs
       WHERE api_product_id = $1
       AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      [productId]
    );

    res.json({
      success: true,
      data: usage.rows
    });
  } catch (error) {
    logger.error('Error fetching API product usage', { error });
    sendError(res, 500, 'Failed to fetch usage data');
  }
}

async function subscribeToApiProduct(req, res) {
  try {
    const userId = req.user?.id;
    const { productId } = req.params;
    const { orderId } = req.body;

    if (!userId) return sendError(res, 401, 'Unauthorized');
    if (!orderId) return sendValidationError(res, { orderId: 'Required' });

    // Verify order exists and belongs to user
    const order = await pool.query(
      'SELECT * FROM marketplace_orders WHERE id = $1 AND customer_id = $2 AND status = $3',
      [orderId, userId, 'paid']
    );

    if (!order.rows.length) return sendError(res, 404, 'Valid paid order not found');

    // Create subscription
    const subscription = await pool.query(
      `INSERT INTO api_product_subscriptions
       (api_product_id, customer_id, order_id, status, current_period_start, current_period_end)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '30 days')
       RETURNING *`,
      [productId, userId, orderId, 'active']
    );

    logger.info('API product subscription created', { productId, userId });

    res.json({
      success: true,
      data: subscription.rows[0]
    });
  } catch (error) {
    logger.error('Error subscribing to API product', { error });
    sendError(res, 500, 'Failed to subscribe');
  }
}

module.exports = {
  createApiProduct,
  publishApiProduct,
  getApiProduct,
  getCreatorApiProducts,
  generateApiKey,
  revokeApiKey,
  getApiKeys,
  getApiProductUsage,
  subscribeToApiProduct
};
