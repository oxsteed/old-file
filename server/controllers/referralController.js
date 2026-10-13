const db     = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const creditLedger = require('../services/referralCreditLedger');

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
  if (REWARD_TYPE === 'none' || !referrerId || !newUserId) return false;

  // Review P2-570: one reward per referred user, ever. Registration and the
  // first-job value event both call this; the idempotency key makes the
  // second call a no-op, and conversions only count the posting that landed.
  try {
    return await withTransaction(db, async (client) => {
      let referrerPosted = false;
      if (REWARD_TYPE === 'credit' || REWARD_TYPE === 'both') {
        referrerPosted = await creditLedger.postOnce(client, {
          userId: referrerId,
          type: 'referral_credit',
          amountCents: REFERRER_CREDIT_CENTS,
          description: 'Referral reward — new member joined',
          metadata: { new_user_id: newUserId, reward_type: 'referrer' },
          idempotencyKey: `referral:referrer:${newUserId}`,
        });
      }
      if (REWARD_TYPE === 'both') {
        await creditLedger.postOnce(client, {
          userId: newUserId,
          type: 'referral_credit',
          amountCents: REFEREE_CREDIT_CENTS,
          description: 'Welcome credit — joined via referral',
          metadata: { referrer_id: referrerId, reward_type: 'referee' },
          idempotencyKey: `referral:referee:${newUserId}`,
        });
      }
      if (referrerPosted) {
        await client.query(
          `UPDATE users
              SET referral_reward_given      = TRUE,
                  referral_conversions_count = COALESCE(referral_conversions_count, 0) + 1
            WHERE id = $1`,
          [referrerId],
        );
        logger.info('[referral] Reward granted', { referrerId, newUserId, type: REWARD_TYPE });
      }
      return referrerPosted;
    }, 'referral_reward');
  } catch (err) {
    logger.error('[referral] grantReferralReward failed (non-fatal)', { referrerId, newUserId, err: err.message });
    return false;
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
    // /join is the single signup page; ?mode= preselects the signup mode.
    const role = req.user.role || 'customer';
    const roleToJoinMode = {
      helper:          'helper',
      helper_pro:      'helper',
      broker:          'helper',
      business_owner:  'business_owner',
      consultant:      'consultant',
      franchise_owner: 'franchise',
      tool_owner:      'helper',
    };
    const joinMode = roleToJoinMode[role];
    const modeQuery = joinMode ? `?mode=${joinMode}&` : '?';
    const shareUrl         = `${appUrl}/join${modeQuery}ref=${referral_code}`;
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
    const { rows } = await db.query(creditLedger.BALANCE_SQL, [req.user.id]);
    const balanceCents = Math.max(0, parseInt(rows[0].balance_cents, 10));
    res.json({
      balance_cents: balanceCents,
      balance_dollars: (balanceCents / 100).toFixed(2),
    });
  } catch (err) {
    next(err);
  }
};
