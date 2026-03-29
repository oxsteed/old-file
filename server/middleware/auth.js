// Phase 2 - Authentication & authorization middleware
// OxSteed v2

const jwt = require('jsonwebtoken');
const pool = require('../db');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_EXPIRES_IN = process.env.REFRESH_EXPIRES_IN || '7d';

function generateTokens(user) {
  const accessToken = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
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

async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    const { rows } = await pool.query(
      `SELECT
         id, first_name, last_name, email, phone, role,
         email_verified, is_verified,
         onboarding_status, onboarding_completed,
         contact_completed, profile_completed,
         tier_selected, w9_completed, terms_accepted,
         membership_tier, id_verified, background_check_passed,
         city, state, zip_code
       FROM users
       WHERE id = $1`,
      [decoded.id]
    );

    const user = rows[0];
    if (!user) {
      return res.status(401).json({ success: false, message: 'User no longer exists' });
    }

    req.user = user;
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

// Check tier from helper_profiles table (not JWT)
function requireTier(...tiers) {
  return async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        'SELECT tier FROM helper_profiles WHERE user_id = $1',
        [req.user.id]
      );
      if (!rows[0] || !tiers.includes(rows[0].tier)) {
        return res.status(403).json({ error: 'Subscription tier required', requiredTiers: tiers });
      }
      next();
    } catch (err) {
      console.error('requireTier error:', err);
      return res.status(500).json({ error: 'Failed to check tier' });
    }
  };
}

// Check active subscription from subscriptions table
async function requireActiveSubscription(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT s.status, s.current_period_end
       FROM subscriptions s
       WHERE s.user_id = $1 AND s.status = 'active'
       ORDER BY s.created_at DESC LIMIT 1`,
      [req.user.id]
    );
    if (!rows[0]) {
      return res.status(403).json({ error: 'Active subscription required' });
    }
    if (rows[0].current_period_end && new Date(rows[0].current_period_end) < new Date()) {
      return res.status(403).json({ error: 'Subscription expired' });
    }
    next();
  } catch (err) {
    console.error('requireActiveSubscription error:', err);
    return res.status(500).json({ error: 'Failed to check subscription' });
  }
}

module.exports = {
  generateTokens,
  authenticate,
  requireRole,
  requireTier,
  requireActiveSubscription,
};
