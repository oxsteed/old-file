'use strict';

// OxSteed Restaurants — Merchant payout controller (Stripe Connect Express).
//
// Mirrors the helper flow in paymentController.js (createConnectAccount /
// getConnectStatus / disconnectConnectAccount) but scoped per restaurant:
// one Stripe Express account per food_restaurants row. Restaurants can take
// orders but previously had no way to get paid; this is that link.
//
// Authorization: restaurant owner (effective_role === 'owner') or an admin
// holding the 'view_financials' grant. Staff roles (manager, cashier, …) can
// never connect or disconnect, and cannot read payout status here either.
// The Stripe account id is the source of truth for charges/payouts state;
// the local row caches it and is refreshed from the Stripe API on reads.

const pool = require('../db');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { requirePermission } = require('../middleware/adminAuth');

// Admins act on payouts through the same grant that covers other financial
// surfaces ("View revenue, payouts, and financial data").
const RESTAURANT_PAYOUTS_GRANT = 'view_financials';

// ── helpers ──────────────────────────────────────────────────────────────────

function parseRestaurantId(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Identical access query to foodController.requireRestaurantAccess /
// restaurantOpsController.requireRestaurantAccess: the caller only ever
// touches restaurants they own or belong to.
async function requireRestaurantAccess(userId, restaurantId) {
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const { rows } = await pool.query(
    `SELECT fr.id, fr.business_id,
            CASE
              WHEN b.user_id = $2 OR fr.owner_user_id = $2 THEN 'owner'
              ELSE (
                SELECT bm.role
                  FROM business_members bm
                 WHERE bm.business_id = fr.business_id
                   AND bm.member_id = $2
                   AND bm.status = 'active'
                 LIMIT 1
              )
            END AS effective_role
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1`,
    [restaurantId, userId]
  );
  const restaurant = rows[0];
  if (!restaurant || !restaurant.effective_role) {
    throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  }
  return restaurant;
}

// Stripe only allows pre-registered redirect hosts, so the onboarding return
// URL must stay on our own origin. Mirrors paymentController's sanitizer;
// restaurant onboarding returns to the merchant page.
function sanitizeOnboardingReturnPath(value) {
  if (typeof value !== 'string' || !value.trim()) return '/food/merchant';
  const clean = value.trim().split('?')[0].split('#')[0];
  if (!clean.startsWith('/') || clean.startsWith('//') || clean.includes('\\') || /[\r\n]/.test(clean)) {
    return '/food/merchant';
  }
  return clean;
}

function resolveAppBaseUrl() {
  const candidates = [process.env.APP_URL, process.env.CLIENT_URL, 'https://oxsteed.com'];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:')) continue;
      return url.origin;
    } catch (_) {
      // Do not use untrusted request Origin, Referer or Host for redirects.
    }
  }
  return 'https://oxsteed.com';
}

// Best-effort next-payout ETA from the connected account. Returns null when
// Stripe is unavailable, the account has no pending payout, or the SDK does
// not expose payouts (older mocks). Never throws.
async function fetchNextPayoutInfo(stripeAccountId) {
  if (!stripeAccountId || typeof stripe?.payouts?.list !== 'function') return null;
  try {
    const payouts = await stripe.payouts.list(
      { limit: 1, status: 'pending' },
      { stripeAccount: stripeAccountId }
    );
    const next = payouts && payouts.data && payouts.data[0];
    if (!next) return null;
    return {
      id: next.id,
      amount: next.amount,
      currency: next.currency,
      status: next.status,
      arrival_date: next.arrival_date ? new Date(next.arrival_date * 1000).toISOString() : null,
    };
  } catch (err) {
    logger.warn('Failed to fetch next payout for restaurant connect account', {
      accountId: stripeAccountId,
      error: err.message,
    });
    return null;
  }
}

// Refresh cached onboarding/charges/payouts flags from the Stripe API,
// exactly like refreshConnectAccountStatus in paymentController.js.
// Returns a row-shaped object plus status_verified / status_unavailable.
async function refreshRestaurantConnectStatus(restaurantId, accountRow) {
  if (!accountRow) return null;
  const unavailable = {
    ...accountRow,
    status_verified: false,
    status_unavailable: true,
    last_known_charges_enabled: !!accountRow.charges_enabled,
    last_known_payouts_enabled: !!accountRow.payouts_enabled,
    charges_enabled: false,
    payouts_enabled: false,
  };
  if (!process.env.STRIPE_SECRET_KEY || !accountRow.stripe_account_id) {
    return unavailable;
  }
  try {
    const account = await stripe.accounts.retrieve(accountRow.stripe_account_id);
    const chargesEnabled = !!account.charges_enabled;
    const payoutsEnabled = !!account.payouts_enabled;
    const onboardingComplete = !!account.details_submitted || chargesEnabled || payoutsEnabled;
    const accountStatus = chargesEnabled
      ? 'active'
      : Array.isArray(account.requirements && account.requirements.currently_due) &&
        account.requirements.currently_due.length
        ? 'restricted'
        : 'pending';
    if (
      accountRow.charges_enabled !== chargesEnabled ||
      accountRow.payouts_enabled !== payoutsEnabled ||
      accountRow.onboarding_complete !== onboardingComplete
    ) {
      await pool.query(
        `UPDATE restaurant_connect_accounts
            SET charges_enabled = $2,
                payouts_enabled = $3,
                onboarding_complete = $4,
                updated_at = NOW()
          WHERE restaurant_id = $1 AND stripe_account_id = $5`,
        [restaurantId, chargesEnabled, payoutsEnabled, onboardingComplete, accountRow.stripe_account_id]
      );
    }
    return {
      ...accountRow,
      status_verified: true,
      charges_enabled: chargesEnabled,
      payouts_enabled: payoutsEnabled,
      onboarding_complete: onboardingComplete,
      account_status: accountStatus,
      details_submitted: !!account.details_submitted,
      requirements: account.requirements || null,
      country: account.country || accountRow.country || null,
      default_currency: account.default_currency || accountRow.default_currency || null,
    };
  } catch (err) {
    // Never log the raw Stripe account id as an error secret; acct_* ids are
    // not secrets, but keep the log minimal anyway.
    logger.warn('Failed to refresh restaurant Stripe Connect account status', {
      restaurantId,
      error: err.message,
    });
    return unavailable;
  }
}

// ── authorization middleware ─────────────────────────────────────────────────
// Owner of the restaurant, or an admin holding the financial grant.
// Mounted after `authenticate`, which sets req.user / req.isAdmin /
// req.isSuperAdmin. Sets req.restaurantId and req.restaurant for handlers.
//
// Admins act on any restaurant (they may not be members of it), so they get
// a plain existence check plus the grant check instead of the membership
// query. Everyone else must be the restaurant owner; staff roles get 403.
exports.requirePayoutManager = async (req, res, next) => {
  try {
    const restaurantId = parseRestaurantId(req.params.restaurantId);
    if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    if (req.isAdmin) {
      const { rows } = await pool.query('SELECT id FROM food_restaurants WHERE id = $1', [restaurantId]);
      if (!rows[0]) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
      req.restaurantId = restaurantId;
      req.restaurant = { id: restaurantId, effective_role: 'admin' };
      // requirePermission reads req.isSuper (adminAuth convention); map the
      // flag authenticate set before delegating to the shared grant check.
      req.isSuper = req.isSuperAdmin;
      return requirePermission(RESTAURANT_PAYOUTS_GRANT)(req, res, next);
    }
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    req.restaurantId = restaurantId;
    req.restaurant = restaurant;
    if (restaurant.effective_role === 'owner') return next();
    return next(new AppError('Only the restaurant owner can manage payouts', 403, 'forbidden'));
  } catch (err) {
    next(err);
  }
};

// ── handlers ─────────────────────────────────────────────────────────────────

exports.createConnectRestaurantAccount = async (req, res, next) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new AppError('Stripe is not configured on the server.', 503, 'stripe_not_configured');
    }
    const restaurantId = req.restaurantId;
    const returnPath = sanitizeOnboardingReturnPath(req.body && req.body.return_path);
    const appBase = resolveAppBaseUrl();
    const refreshUrl = `${appBase}${returnPath}?refresh=true`;
    const returnUrl = `${appBase}${returnPath}?onboarding=complete`;

    const existing = await pool.query(
      'SELECT * FROM restaurant_connect_accounts WHERE restaurant_id = $1',
      [restaurantId]
    );
    if (existing.rows[0]) {
      const freshExisting = await refreshRestaurantConnectStatus(restaurantId, existing.rows[0]);
      if (freshExisting.status_verified === false) {
        throw new AppError('Stripe account status is temporarily unavailable. Please retry.', 503, 'connect_status_unavailable');
      }
      const requirements = freshExisting.requirements || {};
      if (
        !freshExisting.onboarding_complete ||
        !freshExisting.charges_enabled ||
        !freshExisting.payouts_enabled ||
        (requirements.currently_due && requirements.currently_due.length) ||
        (requirements.past_due && requirements.past_due.length)
      ) {
        const link = await stripe.accountLinks.create({
          account: freshExisting.stripe_account_id,
          refresh_url: refreshUrl,
          return_url: returnUrl,
          type: 'account_onboarding',
        });
        return res.json({
          url: link.url,
          onboarding_url: link.url,
          account_id: freshExisting.stripe_account_id,
        });
      }
      return res.json({
        message: 'Account already set up',
        account: freshExisting,
      });
    }

    const account = await stripe.accounts.create(
      {
        type: 'express',
        country: 'US',
        email: req.user.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: {
          oxsteed_restaurant_id: String(restaurantId),
          oxsteed_owner_user_id: String(req.user.id),
        },
      },
      {
        idempotencyKey: `oxsteed-restaurant-connect-account:${restaurantId}`,
      }
    );

    const { rows: persisted } = await pool.query(
      `INSERT INTO restaurant_connect_accounts (restaurant_id, stripe_account_id)
       VALUES ($1, $2)
       ON CONFLICT (restaurant_id)
         DO UPDATE SET stripe_account_id = restaurant_connect_accounts.stripe_account_id
       RETURNING stripe_account_id`,
      [restaurantId, account.id]
    );
    const accountId = persisted[0] && persisted[0].stripe_account_id;
    if (!accountId) {
      throw new AppError('Payment account could not be saved. Please retry.', 503, 'connect_account_persistence_failed');
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });
    res.json({
      url: link.url,
      onboarding_url: link.url,
      account_id: accountId,
    });
  } catch (err) {
    logger.error('Create restaurant connect account error', {
      restaurantId: req.restaurantId,
      userId: req.user && req.user.id,
      error: err.message,
    });
    next(err instanceof AppError ? err : new AppError('Failed to create payment account', 502, 'connect_account_create_failed'));
  }
};

exports.getRestaurantConnectStatus = async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId;
    const result = await pool.query(
      `SELECT restaurant_id, stripe_account_id, charges_enabled, payouts_enabled, onboarding_complete
         FROM restaurant_connect_accounts
        WHERE restaurant_id = $1`,
      [restaurantId]
    );
    if (!result.rows[0]) return res.json({ connected: false });

    const refreshed = await refreshRestaurantConnectStatus(restaurantId, result.rows[0]);
    const nextPayout = refreshed.status_verified
      ? await fetchNextPayoutInfo(refreshed.stripe_account_id)
      : null;

    res.json({
      connected: true,
      ...refreshed,
      stripe_connect_ready: !!refreshed.charges_enabled,
      stripe_connect_payouts_ready: !!refreshed.payouts_enabled,
      stripe_connect_onboarded: !!refreshed.onboarding_complete,
      next_payout: nextPayout,
    });
  } catch (err) {
    logger.error('Get restaurant connect status error', {
      restaurantId: req.restaurantId,
      userId: req.user && req.user.id,
      error: err.message,
    });
    next(new AppError('Failed to get account status', 500, 'connect_status_failed'));
  }
};

exports.disconnectConnectRestaurantAccount = async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId;
    const accountResult = await pool.query(
      'SELECT * FROM restaurant_connect_accounts WHERE restaurant_id = $1',
      [restaurantId]
    );
    const account = accountResult.rows[0];
    if (!account) {
      return res.json({ success: true, message: 'No connected payout account found.' });
    }
    if (process.env.STRIPE_SECRET_KEY && account.stripe_account_id) {
      try {
        await stripe.accounts.del(account.stripe_account_id);
      } catch (stripeErr) {
        logger.warn('Stripe restaurant account disconnect failed; removing local link', {
          restaurantId,
          userId: req.user && req.user.id,
          error: stripeErr.message,
        });
      }
    }
    await pool.query('DELETE FROM restaurant_connect_accounts WHERE restaurant_id = $1', [restaurantId]);
    res.json({ success: true, message: 'Payout account disconnected.' });
  } catch (err) {
    logger.error('Disconnect restaurant connect account failed', {
      restaurantId: req.restaurantId,
      userId: req.user && req.user.id,
      error: err.message,
    });
    next(new AppError('Failed to disconnect payout account', 500, 'connect_disconnect_failed'));
  }
};
