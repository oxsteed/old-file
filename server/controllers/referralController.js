const db     = require('../db');
const logger = require('../utils/logger');

const REWARD_TYPE = process.env.REFERRAL_REWARD_TYPE || 'none';

// ── GET /api/referrals/me ──────────────────────────────────────────────────────
// Returns the authenticated user's referral code, share URL, and stats.
exports.getMyReferral = async (req, res) => {
  try {
    const userId = req.user.id;

    const { rows } = await db.query(`
      SELECT
        u.referral_code,
        u.referrals_count,
        u.referral_conversions_count,
        u.referral_reward_given,
        COALESCE(
          json_agg(
            json_build_object(
              'id',         r.id,
              'first_name', r.first_name,
              'joined_at',  r.created_at
            )
            ORDER BY r.created_at DESC
          ) FILTER (WHERE r.id IS NOT NULL),
          '[]'
        ) AS referred_users
      FROM users u
      LEFT JOIN users r ON r.referred_by = u.id
      WHERE u.id = $1
      GROUP BY u.id
    `, [userId]);

    if (!rows.length) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const { referral_code, referrals_count, referral_conversions_count, referral_reward_given, referred_users } = rows[0];

    const appUrl = process.env.APP_URL || process.env.CLIENT_URL || 'https://oxsteed.com';
    const shareUrl = `${appUrl}/register/customer?ref=${referral_code}`;

    res.json({
      referral_code,
      share_url:    shareUrl,
      reward_type:  REWARD_TYPE,
      stats: {
        referrals_count:            parseInt(referrals_count)            || 0,
        referral_conversions_count: parseInt(referral_conversions_count) || 0,
        referral_reward_given:      !!referral_reward_given,
      },
      referred_users,
    });
  } catch (err) {
    logger.error('getMyReferral error', { err });
    res.status(500).json({ error: 'Failed to fetch referral info.' });
  }
};

// ── POST /api/referrals/validate ───────────────────────────────────────────────
// Public endpoint — validate a referral code before registration.
exports.validateCode = async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'code required.' });

    const { rows } = await db.query(
      `SELECT id, first_name FROM users WHERE referral_code = $1`,
      [String(code).trim()]
    );

    if (!rows.length) {
      return res.status(404).json({ valid: false, error: 'Referral code not found.' });
    }

    res.json({ valid: true, referrer_name: rows[0].first_name });
  } catch (err) {
    logger.error('validateCode error', { err });
    res.status(500).json({ error: 'Failed to validate code.' });
  }
};
