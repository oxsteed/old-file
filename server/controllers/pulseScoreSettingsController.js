'use strict';
const db = require('../db');

// All keys with their defaults (true = included).
// This object is the single source of truth for what keys exist.
const DEFAULTS = {
  include_manual_income:      true,
  include_manual_expenses:    true,
  include_recurring_income:   true,
  include_recurring_expenses: true,
  include_oxsteed_income:     true,
  include_predicted_jobs:     true,
  include_business_pl:        true,
  include_pending_invoices:   true,
  include_tax_obligations:    true,
  include_home_maintenance:   true,
  include_car_care:           true,
  include_personal_care:      true,
  include_tool_rentals:       true,
  include_planned_needs:      true,
  include_debt_obligations:   true,
};

exports.DEFAULTS = DEFAULTS;

// GET /api/life/pulse/settings
exports.getSettings = async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM pulse_score_settings WHERE user_id = $1',
      [req.user.id]
    );
    // Merge DB row over defaults so missing rows return full defaults.
    const settings = { ...DEFAULTS, ...(rows[0] || {}) };
    // Strip DB-only columns not relevant to the client.
    delete settings.user_id;
    delete settings.updated_at;
    res.json(settings);
  } catch (err) {
    console.error('getSettings error:', err);
    res.status(500).json({ error: 'Failed to fetch pulse score settings.' });
  }
};

// PUT /api/life/pulse/settings
// Body: partial or full settings object — only valid keys are applied.
exports.updateSettings = async (req, res) => {
  try {
    const updates = {};
    for (const key of Object.keys(DEFAULTS)) {
      if (key in req.body) {
        updates[key] = Boolean(req.body[key]);
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid setting keys provided.' });
    }

    const setClauses = Object.keys(updates)
      .map((k, i) => `${k} = $${i + 2}`)
      .join(', ');
    const values = [req.user.id, ...Object.values(updates)];

    await db.query(
      `INSERT INTO pulse_score_settings (user_id, ${Object.keys(updates).join(', ')})
       VALUES ($1, ${Object.keys(updates).map((_, i) => `$${i + 2}`).join(', ')})
       ON CONFLICT (user_id) DO UPDATE SET ${setClauses}, updated_at = NOW()`,
      values
    );

    // Return merged settings so the client always has the full picture.
    const { rows } = await db.query(
      'SELECT * FROM pulse_score_settings WHERE user_id = $1',
      [req.user.id]
    );
    const settings = { ...DEFAULTS, ...(rows[0] || {}) };
    delete settings.user_id;
    delete settings.updated_at;
    res.json(settings);
  } catch (err) {
    console.error('updateSettings error:', err);
    res.status(500).json({ error: 'Failed to update pulse score settings.' });
  }
};
