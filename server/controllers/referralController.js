const db     = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');

const REWARD_TYPE = process.env.REFERRAL_REWARD_TYPE || 'credit';

// Reward amounts (cents)
const REFERRER_CREDIT_CENTS = parseInt(process.env.REFERRAL_REFERRER_CREDIT_CENTS || '500',  10); // $5 default
const REFEREE_CREDIT_CENTS  = parseInt(process.env.REFERRAL_REFEREE_CREDIT_CENTS  || '250',  10); // $2.50 default

/**
 * grantReferralReward(referrerId, newUserId)
 *
 * Called after a referred user successfully completes registration.
 * Fail-open — never throws so it can be fire-and-forget from auth.
 *
 * REWARD_TYPE options:
 *   'credit'  – platform_ledger credit for the referrer only
 *   'both'    – credit for referrer + new user
 *   'none'    – no reward (disabled)
 */
exports.grantReferralReward = async function grantReferralReward(referrerId, newUserId) {
  if (REWARD_TYPE === 'none') return;

  try {
    const grants = [];

    if (REWARD_TYPE === 'credit' || REWARD_TYPE === 'both') {
      grants.push(
        db.query(
          `INSERT INTO platform_ledger (user_id, type, amount_cents, description, metadata)
           VALUES ($1, 'referral_credit', $2, 'Referral reward — new member joined', $3)`,
          [referrerId, REFERRER_CREDIT_CENTS, JSON.stringify({ new_user_id: newUserId, reward_type: 'referrer' })],
        ),
      );
    }

    if (REWARD_TYPE === 'both') {
      grants.push(
        db.query(
          `INSERT INTO platform_ledger (user_id, type, amount_cents, description, metadata)
           VALUES ($1, 'referral_credit', $2, 'Welcome credit — joined via referral', $3)`,
          [newUserId, REFEREE_CREDIT_CENTS, JSON.stringify({ referrer_id: referrerId, reward_type: 'referee' })],
        ),
      );
    }

    // Mark reward given + increment conversions on referrer
    grants.push(
      db.query(
        `UPDATE users
         SET referral_reward_given      = TRUE,
             referral_conversions_count = COALESCE(referral_conversions_count, 0) + 1
         WHERE id = $1`,
        [referrerId],
      ),
    );

    await Promise.all(grants);
    logger.info('[referral] Reward granted', { referrerId, newUserId, type: REWARD_TYPE });
  } catch (err) {
    logger.error('[referral] grantReferralReward failed (non-fatal)', { referrerId, newUserId, err: err.message });
  }
};

// ── GET /api/referrals/me ──────────────────────────────────────────────────────
// Returns the authenticated user's referral code, share URL, and stats.
exports.getMyReferral = async (req, res, next) => {
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
      throw new AppError('User not found', 404, 'not_found');
    }

    const { referral_code, referrals_count, referral_conversions_count, referral_reward_given, referred_users } = rows[0];

    const appUrl = process.env.APP_URL || process.env.CLIENT_URL || 'https://oxsteed.com';

    // Generate role-appropriate share URLs so referrers land on the right
    // registration flow, and so the platform can track cross-persona referrals.
    const role = req.user.role || 'customer';
    const roleToRegisterPath = {
      helper:          'register/helper',
      helper_pro:      'register/helper',
      broker:          'register/helper',
      business_owner:  'register/business',
      consultant:      'register/consultant',
      franchise_owner: 'register/franchise',
      tool_owner:      'register/helper',
    };
    const registerPath = roleToRegisterPath[role] || 'join';
    const shareUrl         = `${appUrl}/${registerPath}?ref=${referral_code}`;
    // Also provide a customer-specific URL for when they want to refer end-users
    const customerShareUrl = `${appUrl}/join?ref=${referral_code}`;

    res.json({
      referral_code,
      share_url:          shareUrl,
      customer_share_url: customerShareUrl,
      referrer_role:      role,
      reward_type:  REWARD_TYPE,
      stats: {
        referrals_count:            parseInt(referrals_count)            || 0,
        referral_conversions_count: parseInt(referral_conversions_count) || 0,
        referral_reward_given:      !!referral_reward_given,
      },
      referred_users,
    });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/referrals/validate ───────────────────────────────────────────────
// Public endpoint - validate a referral code before registration.
exports.validateCode = async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) throw new AppError('code is required', 400, 'validation_failed', { code: 'code is required' });

    const { rows } = await db.query(
      `SELECT id, first_name FROM users WHERE referral_code = $1`,
      [String(code).trim()]
    );

    if (!rows.length) {
      return res.status(404).json({ valid: false, error: 'Referral code not found' });
    }

    res.json({ valid: true, referrer_name: rows[0].first_name });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/referrals/balance ─────────────────────────────────────────────────
// Returns the user's spendable referral credit balance in cents and dollars.
exports.getCreditBalance = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT COALESCE(SUM(
         CASE WHEN type IN ('referral_credit', 'dispute_credit', 'promo_credit') THEN amount_cents
              WHEN type = 'credit_applied' THEN -amount_cents
              ELSE 0
         END
       ), 0) AS balance_cents
       FROM platform_ledger
       WHERE user_id = $1`,
      [req.user.id]
    );
    const balanceCents = Math.max(0, parseInt(rows[0].balance_cents, 10));
    res.json({
      balance_cents: balanceCents,
      balance_dollars: (balanceCents / 100).toFixed(2),
    });
  } catch (err) {
    next(err);
  }
};
