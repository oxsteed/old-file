const db = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { logAdminAction } = require('../services/auditService');
const { getPublicCapabilities } = require('../services/featureCapabilities');

async function hasPlatformConfigTable() {
  const { rows } = await db.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='platform_config'"
  );
  return rows.length > 0;
}

async function ensurePlatformConfigTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS platform_config (
      id SERIAL PRIMARY KEY,
      key VARCHAR(100) UNIQUE NOT NULL,
      value TEXT NOT NULL,
      updated_by UUID REFERENCES users(id),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const entries = Object.entries(DEFAULT_PRICES);
  for (const [key, value] of entries) {
    await db.query(
      `INSERT INTO platform_config (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING`,
      [key, value]
    );
  }
}

// Default tier pricing (fallback if DB has no entries)
const DEFAULT_PRICES = {
  tier1_price: '0',
  tier1_label: 'Free',
  tier2_price: '19.99',
  tier2_label: '/month',
  tier3_price: 'up to 17%',
  tier3_label: 'per transaction',
};

// GET /api/config/pricing - public, no auth needed
exports.getPricing = async (req, res, next) => {
  try {
    if (!(await hasPlatformConfigTable())) {
      return res.json(DEFAULT_PRICES);
    }
    const { rows } = await db.query(
      `SELECT key, value FROM platform_config WHERE key LIKE 'tier%' ORDER BY key`
    );
    if (rows.length === 0) {
      return res.json(DEFAULT_PRICES);
    }
    const pricing = {};
    rows.forEach(r => { pricing[r.key] = r.value; });
    res.json({ ...DEFAULT_PRICES, ...pricing });
  } catch (err) {
    // Table might not exist yet - return defaults
    logger.error('Config pricing error:', { err: err.message });
    res.json(DEFAULT_PRICES);
  }
};

// GET /api/config/capabilities - public, contains availability only (no secrets)
exports.getCapabilities = (req, res) => {
  res.json({ capabilities: getPublicCapabilities() });
};

// PUT /api/config/pricing - super_admin only
exports.updatePricing = async (req, res, next) => {
  try {
    if (!(await hasPlatformConfigTable())) {
      await ensurePlatformConfigTable();
    }
    const updates = req.body; // { tier1_price: '0', tier2_price: '29.99', ... }
    const allowedKeys = Object.keys(DEFAULT_PRICES);
    const entries = Object.entries(updates).filter(([k]) => allowedKeys.includes(k));
    if (entries.length === 0) {
      throw new AppError('No valid pricing keys provided', 400, 'validation_failed', { pricing: 'At least one valid pricing key is required' });
    }
    // Validate price value format up front (fail before any partial write).
    // Price keys must be non-negative numeric strings; label keys are free text.
    for (const [key, value] of entries) {
      if (key.endsWith('_price')) {
        const str = String(value).trim();
        if (!/^\d+(\.\d+)?$/.test(str)) {
          throw new AppError(`Invalid price value for ${key}`, 400, 'validation_failed', { [key]: 'Must be a non-negative numeric price' });
        }
      }
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      for (const [key, value] of entries) {
        await client.query(
          `INSERT INTO platform_config (key, value, updated_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()`,
          [key, String(value), req.user.id]
        );
      }
      await logAdminAction({
        adminId: req.user.id,
        action: 'pricing_updated',
        targetType: 'platform_config',
        description: 'Platform pricing updated',
        after: Object.fromEntries(entries.map(([k, v]) => [k, String(v)])),
        req,
        client,
        throwOnError: true,
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    res.json({ message: 'Pricing updated', updated: Object.fromEntries(entries) });
  } catch (err) {
    next(err);
  }
};
