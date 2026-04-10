const db = require('../db');
const logger = require('../utils/logger');

async function hasPlatformConfigTable() {
  const { rows } = await db.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='platform_config'"
  );
  return rows.length > 0;
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

// GET /api/config/pricing — public, no auth needed
exports.getPricing = async (req, res) => {
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
    // Table might not exist yet — return defaults
    logger.error('Config pricing error:', err.message);
    res.json(DEFAULT_PRICES);
  }
};

// PUT /api/config/pricing — super_admin only
exports.updatePricing = async (req, res) => {
  try {
    if (!(await hasPlatformConfigTable())) {
      return res.status(501).json({ error: 'Pricing configuration is not available yet.' });
    }
    const updates = req.body; // { tier1_price: '0', tier2_price: '29.99', ... }
    const allowedKeys = Object.keys(DEFAULT_PRICES);
    const entries = Object.entries(updates).filter(([k]) => allowedKeys.includes(k));
    if (entries.length === 0) {
      return res.status(400).json({ error: 'No valid pricing keys provided' });
    }
    for (const [key, value] of entries) {
      await db.query(
        `INSERT INTO platform_config (key, value, updated_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()`,
        [key, String(value), req.user.id]
      );
    }
    res.json({ message: 'Pricing updated', updated: Object.fromEntries(entries) });
  } catch (err) {
    logger.error('Update pricing error:', err);
    res.status(500).json({ error: 'Failed to update pricing' });
  }
};
