// Phase 2 — Authentication & authorization middleware
// OxSteed v2

const jwt = require('jsonwebtoken');
const pool = require('../db');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_EXPIRES_IN = process.env.REFRESH_EXPIRES_IN || '7d';

function generateTokens(user) {
  const accessToken = jwt.sign(
    { id: user.id, email: user.email, role: user.role, tier: user.tier },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
  const refreshToken = jwt.sign(
    { id: user.id, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: REFRESH_EXPIRES_IN }
  );
  return { accessToken, refreshToken };
}

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function requireTier(...tiers) {
  return (req, res, next) => {
    if (!req.user || !tiers.includes(req.user.tier)) {
      return res.status(403).json({ error: 'Subscription tier required', requiredTiers: tiers });
    }
    next();
  };
}

async function requireActiveSubscription(req, res, next) {
  const { rows } = await pool.query(
    'SELECT subscription_status, subscription_end FROM users WHERE id = $1',
    [req.user.id]
  );
  if (!rows[0] || rows[0].subscription_status !== 'active') {
    return res.status(403).json({ error: 'Active subscription required' });
  }
  if (rows[0].subscription_end && new Date(rows[0].subscription_end) < new Date()) {
    return res.status(403).json({ error: 'Subscription expired' });
  }
  next();
}

module.exports = {
  generateTokens,
  authenticate,
  requireRole,
  requireTier,
  requireActiveSubscription,
};
