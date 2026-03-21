const { verifyToken } = require('../services/authService');
const db              = require('../db');

exports.requireAdmin = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized.' });

    const decoded = verifyToken(token);

    const { rows } = await db.query(
      `SELECT id, role, is_active, first_name, last_name, email
       FROM users WHERE id = $1`,
      [decoded.userId]
    );

    if (!rows.length || !rows[0].is_active) {
      return res.status(401).json({ error: 'Account not found or inactive.' });
    }

    const user = rows[0];

    if (!['admin','super_admin'].includes(user.role)) {
      return res.status(403).json({ error: 'Admin access required.' });
    }

    req.user      = user;
    req.isSuper   = user.role === 'super_admin';
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

exports.requireSuperAdmin = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized.' });

    const decoded = verifyToken(token);

    const { rows } = await db.query(
      `SELECT id, role, is_active FROM users WHERE id = $1`,
      [decoded.userId]
    );

    if (!rows.length || rows[0].role !== 'super_admin' || !rows[0].is_active) {
      return res.status(403).json({ error: 'Super Admin access required.' });
    }

    req.user    = rows[0];
    req.isSuper = true;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};
