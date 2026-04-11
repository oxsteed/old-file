// server/routes/roleToggle.js
// PATCH /api/role-toggle
// Lets a customer switch to helper (or back) without contacting support.
// Allowed transitions:
//   customer  → helper
//   helper    → customer
//   helper    → helper  (no-op, idempotent)
//   customer  → customer (no-op)
// helper_pro, broker, admin, super_admin roles are NOT changeable here.

const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const pool    = require('../db');
const logger  = require('../utils/logger');

const TOGGLEABLE = ['customer', 'helper'];

router.patch('/', authenticate, async (req, res) => {
  try {
    const { role } = req.body;
    if (!TOGGLEABLE.includes(role))
      return res.status(400).json({ error: `role must be one of: ${TOGGLEABLE.join(', ')}` });

    // Only customer/helper can self-toggle — protect higher roles
    if (!TOGGLEABLE.includes(req.user.role))
      return res.status(403).json({ error: 'Your role cannot be changed via this endpoint' });

    const { rows } = await pool.query(
      `UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2
       RETURNING id, email, first_name, last_name, role`,
      [role, req.user.id]
    );

    res.json({ user: rows[0] });
  } catch (err) {
    logger.error('[roleToggle] error', { err: err.message });
    res.status(500).json({ error: 'Failed to update role' });
  }
});

module.exports = router;
