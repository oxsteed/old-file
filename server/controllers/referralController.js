const db     = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const creditLedger = require('../services/referralCreditLedger');
const { recordException } = require('../services/reconciliationExceptions');
const { logAdminAction } = require('../services/auditService');

const REWARD_TYPE = process.env.REFERRAL_REWARD_TYPE || 'credit';

// P3-11-F12: referral rewards are system-triggered platform money with no
// human admin. Audit rows use the sentinel system user (migration 812),
// the same zero-UUID convention migration 055 established for
// system/migration actions in admin_audit_log.
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

// Reward amounts (cents)
const REFERRER_CREDIT_CENTS = parseInt(process.env.REFERRAL_REFERRER_CREDIT_CENTS || '500',  10); // $5 default
const REFEREE_CREDIT_CENTS  = parseInt(process.env.REFERRAL_REFEREE_CREDIT_CENTS  || '250',  10); // $2.50 default

// P2-6-F12: farming guards. Each distinct email used to earn $5 at
// registration with no purchase/job required and no velocity caps, so one
// actor with many throwaway emails could farm credit indefinitely.
// - The reward is granted ONLY on the first-completed-job value event
//   (jobController.afterJobCompleted), matching the program's stated terms
//   ("signs up and completes their first job"); registration no longer pays.
// - Grants per referrer are capped per rolling window (env-overridable).
// - Grants are refused when too many of one referrer's referees signed up
//   from the same IP in the trailing week (shared-device/IP farming).
// - v7 residual: grants are also refused when too many of one referrer's
//   referees share a signup device fingerprint (X-Device-Fingerprint,
//   migration 845), and when too many rewarded referees share a signup IP
//   across referrer codes (farming rings spreading signups over many codes).
//   Missing IP/fingerprint data fails open; the first-job value event is the
//   primary guard.
const REFERRAL_MAX_REWARDS_PER_DAY = parseInt(process.env.REFERRAL_MAX_REWARDS_PER_DAY || '10', 10);
const REFERRAL_MAX_REWARDS_PER_WEEK = parseInt(process.env.REFERRAL_MAX_REWARDS_PER_WEEK || '50', 10);
const REFERRAL_MAX_REFERRED_PER_IP_PER_WEEK = parseInt(process.env.REFERRAL_MAX_REFERRED_PER_IP_PER_WEEK || '5', 10);
// P2-6-F12 (v7 residual): the per-referrer caps above do not stop a farming
// ring that spreads signups across many referrer codes. These two guards are
// referrer-agnostic: they look at the signup IP and the device fingerprint
// of the referees who were actually rewarded.
const REFERRAL_MAX_REWARDS_PER_IP_PER_WEEK = parseInt(process.env.REFERRAL_MAX_REWARDS_PER_IP_PER_WEEK || '5', 10);
const REFERRAL_MAX_REFERRED_PER_DEVICE_PER_WEEK = parseInt(process.env.REFERRAL_MAX_REFERRED_PER_DEVICE_PER_WEEK || '5', 10);

/**
 * Count referrer-side referral rewards posted in the trailing window.
 * Runs inside the grant transaction so the check and the posting are atomic.
 */
async function countRecentReferrerRewards(client, referrerId, interval) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS count FROM platform_ledger
      WHERE user_id = $1 AND type = 'referral_credit'
        AND metadata ->> 'reward_type' = 'referrer'
        AND created_at > NOW() - $2::interval`,
    [referrerId, interval]
  );
  return Number(rows[0]?.count || 0);
}

async function referralVelocityExceeded(client, referrerId) {
  if (await countRecentReferrerRewards(client, referrerId, '24 hours') >= REFERRAL_MAX_REWARDS_PER_DAY) return 'day';
  if (await countRecentReferrerRewards(client, referrerId, '7 days') >= REFERRAL_MAX_REWARDS_PER_WEEK) return 'week';
  return null;
}

/**
 * P2-6-F12: shared-IP farming check. Returns the offending IP when too many
 * of this referrer's referees registered from the same signup IP in the
 * trailing week. Missing IP data fails open (the first-job value event is
 * the primary guard); the check only fires on positive evidence.
 */
async function referralIpFarmingExceeded(client, referrerId, newUserId) {
  const { rows: [user] } = await client.query(
    'SELECT terms_acceptance_ip FROM users WHERE id = $1',
    [newUserId]
  );
  const ip = user && typeof user.terms_acceptance_ip === 'string'
    ? user.terms_acceptance_ip.trim()
    : '';
  if (!ip) return null;
  const { rows: [{ count }] } = await client.query(
    `SELECT COUNT(*)::int AS count FROM users
      WHERE referred_by = $1 AND id <> $2
        AND terms_acceptance_ip = $3
        AND created_at > NOW() - INTERVAL '7 days'`,
    [referrerId, newUserId, ip]
  );
  return Number(count || 0) >= REFERRAL_MAX_REFERRED_PER_IP_PER_WEEK ? ip : null;
}

/**
 * P2-6-F12 (v7 residual): shared-device farming check. Many rewarded
 * referees for one code from a single device in a week is a farming pattern,
 * not word of mouth. Missing fingerprint data fails open (same rationale as
 * the IP check): the first-job value event is the primary guard.
 */
async function referralDeviceFarmingExceeded(client, referrerId, newUserId) {
  const { rows: [user] } = await client.query(
    'SELECT signup_device_fingerprint FROM users WHERE id = $1',
    [newUserId]
  );
  const fp = user && typeof user.signup_device_fingerprint === 'string'
    ? user.signup_device_fingerprint.trim()
    : '';
  if (!fp) return null;
  const { rows: [{ count }] } = await client.query(
    `SELECT COUNT(*)::int AS count FROM users
      WHERE referred_by = $1 AND id <> $2
        AND signup_device_fingerprint = $3
        AND created_at > NOW() - INTERVAL '7 days'`,
    [referrerId, newUserId, fp]
  );
  return Number(count || 0) >= REFERRAL_MAX_REFERRED_PER_DEVICE_PER_WEEK ? fp : null;
}

/**
 * P2-6-F12 (v7 residual): cross-referrer farming-ring check. Counts distinct
 * referees rewarded in the trailing week whose signup IP matches the new
 * referee's, regardless of which referrer code they used. A ring spreading
 * throwaway signups across many codes still shares devices/IPs; once the
 * cap is hit, further rewards from that IP stop earning.
 */
async function referralRingIpExceeded(client, newUserId) {
  const { rows: [user] } = await client.query(
    'SELECT terms_acceptance_ip FROM users WHERE id = $1',
    [newUserId]
  );
  const ip = user && typeof user.terms_acceptance_ip === 'string'
    ? user.terms_acceptance_ip.trim()
    : '';
  if (!ip) return null;
  const { rows: [{ count }] } = await client.query(
    `SELECT COUNT(DISTINCT pl.metadata ->> 'new_user_id')::int AS count
       FROM platform_ledger pl
      WHERE pl.type = 'referral_credit'
        AND pl.metadata ->> 'reward_type' = 'referrer'
        AND pl.created_at > NOW() - INTERVAL '7 days'
        AND (pl.metadata ->> 'new_user_id') <> $2
        AND EXISTS (
          SELECT 1 FROM users u
           WHERE u.id::text = pl.metadata ->> 'new_user_id'
             AND u.terms_acceptance_ip = $1
        )`,
    [ip, String(newUserId)]
  );
  return Number(count || 0) >= REFERRAL_MAX_REWARDS_PER_IP_PER_WEEK ? ip : null;
}

/**
 * grantReferralReward(referrerId, newUserId)
 *
 * Called when a referred user completes their first job (the value event in
 * jobController.afterJobCompleted) — never at registration.
 * Never throws so it can be fire-and-forget from callers, but failures are
 * NOT silent: they are recorded as reconciliation exceptions (domain
 * 'credit', reference `referral-reward:<newUserId>`) and retried by the
 * referral-reward-retry worker. Reward postings are idempotent per referred
 * user, so recording + retrying can never double-grant.
 *
 * REWARD_TYPE options:
 *   'credit'  – platform_ledger credit for the referrer only
 *   'both'    – credit for referrer + new user
 *   'none'    – no reward (disabled)
 */
exports.grantReferralReward = async function grantReferralReward(referrerId, newUserId) {
  if (REWARD_TYPE === 'none' || !referrerId || !newUserId) return false;
  // P2-6-F12: self-referral (same account id on both sides) never earns.
  if (String(referrerId) === String(newUserId)) {
    logger.warn('[referral] self-referral reward refused', { referrerId, newUserId });
    return false;
  }

  // Review P2-570: one reward per referred user, ever. The first-job value
  // event is the only caller; the idempotency key makes duplicate or
  // concurrent invocations no-ops, and conversions only count the posting
  // that landed.
  try {
    return await withTransaction(db, async (client) => {
      // P2-6-F12: velocity cap. Farming many throwaway signups against one
      // code stops earning once the cap is hit; the refusal is recorded as
      // a reconciliation exception so it is visible, not silent. The
      // per-referrer advisory lock keeps the check-and-post atomic across
      // concurrent grants.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`referral-velocity:${referrerId}`]);
      const breachedWindow = await referralVelocityExceeded(client, referrerId);
      if (breachedWindow) {
        logger.warn('[referral] velocity cap breached; reward withheld', { referrerId, newUserId, window: breachedWindow });
        await recordException({
          domain: 'credit',
          referenceId: `referral-velocity:${referrerId}:${newUserId}`,
          severity: 'warning',
          summary: 'Referral reward withheld: referrer velocity cap breached',
          details: {
            referrer_id: String(referrerId),
            new_user_id: String(newUserId),
            window: breachedWindow,
          },
          sourceRunId: 'grantReferralReward',
        });
        return false;
      }
      // P2-6-F12: shared-IP farming check. Many referees for one code from
      // a single signup IP in a week is a farming pattern, not word of mouth.
      const farmingIp = await referralIpFarmingExceeded(client, referrerId, newUserId);
      if (farmingIp) {
        logger.warn('[referral] shared-IP farming pattern; reward withheld', { referrerId, newUserId, farmingIp });
        await recordException({
          domain: 'credit',
          referenceId: `referral-ip-farm:${referrerId}:${newUserId}`,
          severity: 'warning',
          summary: 'Referral reward withheld: shared signup IP across referees',
          details: {
            referrer_id: String(referrerId),
            new_user_id: String(newUserId),
            signup_ip: farmingIp,
          },
          sourceRunId: 'grantReferralReward',
        });
        return false;
      }
      // P2-6-F12 (v7 residual): shared-device farming check. Many rewarded
      // referees for one code from a single device in a week is a farming
      // pattern, not word of mouth.
      const farmingDevice = await referralDeviceFarmingExceeded(client, referrerId, newUserId);
      if (farmingDevice) {
        logger.warn('[referral] shared-device farming pattern; reward withheld', { referrerId, newUserId });
        await recordException({
          domain: 'credit',
          referenceId: `referral-device-farm:${referrerId}:${newUserId}`,
          severity: 'warning',
          summary: 'Referral reward withheld: shared signup device across referees',
          details: {
            referrer_id: String(referrerId),
            new_user_id: String(newUserId),
          },
          sourceRunId: 'grantReferralReward',
        });
        return false;
      }
      // P2-6-F12 (v7 residual): cross-referrer ring check. Spreading signups
      // across many codes does not help when the rewards share a signup IP.
      const ringIp = await referralRingIpExceeded(client, newUserId);
      if (ringIp) {
        logger.warn('[referral] cross-referrer IP farming ring; reward withheld', { referrerId, newUserId });
        await recordException({
          domain: 'credit',
          referenceId: `referral-ring-ip:${newUserId}`,
          severity: 'warning',
          summary: 'Referral reward withheld: signup IP shared across referral rewards',
          details: {
            referrer_id: String(referrerId),
            new_user_id: String(newUserId),
          },
          sourceRunId: 'grantReferralReward',
        });
        return false;
      }
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
        // P3-11-F12: audit the platform-money grant. Fail closed: the
        // audit row is written with the transaction client, so a dropped
        // audit rolls the grant back and the retry worker replays it
        // (grantReferralReward records failures as reconciliation
        // exceptions, never silently).
        await logAdminAction({
          client,
          adminId: SYSTEM_ACTOR_ID,
          action: 'referral_reward_granted',
          targetType: 'user',
          targetId: String(referrerId),
          description: `Referral reward granted to referrer ${referrerId} for new user ${newUserId}`,
          after: {
            referrer_id: String(referrerId),
            new_user_id: String(newUserId),
            reward_type: REWARD_TYPE,
            referrer_credit_cents: REFERRER_CREDIT_CENTS,
            referee_credit_cents: REWARD_TYPE === 'both' ? REFEREE_CREDIT_CENTS : 0,
          },
        });
        logger.info('[referral] Reward granted', { referrerId, newUserId, type: REWARD_TYPE });
      }
      return referrerPosted;
    }, 'referral_reward');
  } catch (err) {
    logger.error('[referral] grantReferralReward failed; recorded for retry', { referrerId, newUserId, err: err.message });
    // P2-6-F11: fail visible, not silent. recordException dedupes on the
    // open reference, so repeated failures do not spam the queue, and the
    // retry worker resolves the exception once the reward posts.
    await recordException({
      domain: 'credit',
      referenceId: `referral-reward:${newUserId}`,
      severity: 'warning',
      summary: 'Referral reward grant failed; queued for automatic retry',
      details: {
        referrer_id: referrerId != null ? String(referrerId) : null,
        new_user_id: newUserId != null ? String(newUserId) : null,
        error: String(err?.message || err).slice(0, 500),
      },
      sourceRunId: 'grantReferralReward',
    });
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
