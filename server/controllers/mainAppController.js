'use strict';

const pool = require('../db');

function parseLimit(value, fallback = 4, max = 12) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, parsed);
}

function tintKeyForHeadline(headline = '') {
  const value = String(headline).toLowerCase();
  if (value.includes('clean')) return 'secondary';
  if (value.includes('plumb') || value.includes('handyman') || value.includes('repair')) return 'primary';
  if (value.includes('tutor') || value.includes('book')) return 'accent';
  if (value.includes('deliver') || value.includes('move')) return 'success';
  return 'primary';
}

function avatarSymbolForHeadline(headline = '') {
  const value = String(headline).toLowerCase();
  if (value.includes('clean')) return 'sparkles';
  if (value.includes('plumb') || value.includes('handyman') || value.includes('repair')) return 'wrench.and.screwdriver.fill';
  if (value.includes('tutor') || value.includes('teach')) return 'book.fill';
  if (value.includes('deliver')) return 'bicycle';
  if (value.includes('move')) return 'shippingbox.fill';
  return 'hammer.fill';
}

function iconForBidAmount(amount) {
  return Number(amount || 0) >= 100 ? 'hammer.fill' : 'hand.raised.fill';
}

function defaultSummary() {
  return {
    activeJobs: 0,
    orders: 0,
    earningsCents: 0,
  };
}

function defaultWalletSummary() {
  return {
    totalWallets: 0,
    activeWallets: 0,
    lockedWallets: 0,
    balances: [],
  };
}

function publicHomeErrorCode(err) {
  const message = String(err?.message || '');
  const code = String(err?.code || '');
  if (code === '42703' || code === '42P01' || /column .* does not exist/i.test(message) || /relation .* does not exist/i.test(message)) {
    return 'schema_mismatch';
  }
  return 'unavailable';
}

async function loadHomeSection(key, fallback, loader) {
  try {
    const data = await loader();
    return {
      key,
      data,
      status: 'ok',
      errorCode: null,
    };
  } catch (err) {
    console.warn(`[main-app/home] ${key} degraded`, {
      code: err?.code,
      message: err?.message,
    });
    return {
      key,
      data: fallback,
      status: 'degraded',
      errorCode: publicHomeErrorCode(err),
    };
  }
}

async function queryFeaturedHelpers(limit) {
  const { rows } = await pool.query(
    `SELECT u.id,
            COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS name,
            COALESCE(NULLIF(TRIM(hp.profile_headline), ''), 'OxSteed Helper') AS headline,
            COALESCE(hp.avg_rating, 0)::float AS rating,
            COALESCE(hp.total_reviews, 0)::int AS review_count,
            COALESCE(hp.hourly_rate_min, 0)::int AS hourly_rate,
            COALESCE(hp.is_available_now, FALSE) AS is_online,
            COALESCE(hp.is_identity_verified, FALSE) AS is_verified,
            hp.service_lat AS latitude,
            hp.service_lng AS longitude
       FROM users u
       JOIN helper_profiles hp ON hp.user_id = u.id
      WHERE u.deleted_at IS NULL
        AND u.is_active = TRUE
        AND u.role IN ('helper', 'helper_pro', 'broker')
        AND u.email_verified = TRUE
        AND COALESCE(hp.is_listed, TRUE) = TRUE
      ORDER BY hp.avg_rating DESC NULLS LAST, hp.total_reviews DESC, u.created_at DESC
      LIMIT $1`,
    [limit]
  );

  return rows.map((row) => ({
    id: String(row.id),
    name: row.name,
    headline: row.headline,
    rating: Number(row.rating || 0),
    reviewCount: Number(row.review_count || 0),
    hourlyRate: Number(row.hourly_rate || 0),
    isOnline: Boolean(row.is_online),
    isVerified: Boolean(row.is_verified),
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    hasLocation: row.latitude !== null && row.longitude !== null,
    avatarSymbol: avatarSymbolForHeadline(row.headline),
    tintKey: tintKeyForHeadline(row.headline),
  }));
}

async function queryPopularRestaurants(limit) {
  const { rows } = await pool.query(
    `SELECT fr.id,
            fr.display_name AS name,
            CASE
              WHEN COALESCE(array_length(fr.cuisine_tags, 1), 0) > 0
                THEN array_to_string(fr.cuisine_tags, ' • ')
              ELSE 'Restaurant'
            END AS cuisine,
            COALESCE(fr.avg_rating, 0)::float AS rating,
            COALESCE(fr.rating_count, 0)::int AS review_count,
            COALESCE(fr.estimated_delivery_minutes, fr.prep_time_min, 30)::int AS estimated_delivery_minutes,
            COALESCE(fr.price_level, 'mid') AS price_level,
            fr.logo_url,
            fr.cover_photo_url,
            fr.dietary_tags,
            fr.latitude,
            fr.longitude,
            promo.title AS promo_title
       FROM food_restaurants fr
       LEFT JOIN LATERAL (
         SELECT p.title
           FROM food_restaurant_promotions p
          WHERE p.restaurant_id = fr.id
            AND p.is_active = TRUE
            AND (p.valid_from IS NULL OR p.valid_from <= CURRENT_DATE)
            AND (p.valid_until IS NULL OR p.valid_until >= CURRENT_DATE)
          ORDER BY p.created_at DESC
          LIMIT 1
       ) promo ON TRUE
      WHERE fr.status = 'active'
        AND COALESCE(fr.accepts_online_orders, TRUE) = TRUE
      ORDER BY COALESCE(fr.avg_rating, 0) DESC, COALESCE(fr.rating_count, 0) DESC, fr.created_at DESC
      LIMIT $1`,
    [limit]
  );

  return rows.map((row) => ({
    id: String(row.id),
    name: row.name,
    cuisine: row.cuisine,
    rating: Number(row.rating || 0),
    reviewCount: Number(row.review_count || 0),
    estimatedDeliveryMinutes: Number(row.estimated_delivery_minutes || 30),
    priceLevel: row.price_level || 'mid',
    logoUrl: row.logo_url || null,
    bannerUrl: row.cover_photo_url || null,
    dietaryTags: Array.isArray(row.dietary_tags) ? row.dietary_tags : [],
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    hasLocation: row.latitude !== null && row.longitude !== null,
    promo: row.promo_title || null,
  }));
}

async function queryPublicActivity(limit) {
  const { rows } = await pool.query(
    `SELECT b.id,
            b.amount,
            b.created_at,
            COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), 'A helper') AS helper_name,
            COALESCE(j.title, 'Job') AS job_title
       FROM bids b
       JOIN users u ON u.id = b.helper_id
       JOIN jobs j ON j.id = b.job_id
      WHERE j.deleted_at IS NULL
      ORDER BY b.created_at DESC
      LIMIT $1`,
    [limit]
  );

  return rows.map((row) => ({
    id: `bid-${row.id}`,
    title: `${row.helper_name} placed a bid`,
    subtitle: `${row.job_title} • $${Number(row.amount || 0).toFixed(0)}`,
    icon: iconForBidAmount(row.amount),
    tintKey: 'primary',
    timeAgo: row.created_at,
  }));
}

async function queryUserSummary(userId) {
  const [
    { rows: [jobRow] },
    { rows: [foodOrderRow] },
    { rows: [earningsRow] },
  ] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS active_jobs
         FROM jobs
        WHERE deleted_at IS NULL
          AND (
            client_id = $1
            OR assigned_helper_id = $1
          )
          AND status IN ('open', 'published', 'bidding', 'matched', 'assigned', 'in_progress')`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total_orders
         FROM food_orders
        WHERE customer_id = $1
          AND status <> 'cancelled'`,
      [userId]
    ),
    pool.query(
      `SELECT COALESCE(SUM(COALESCE(budget_max, budget_min, 0) * 100), 0)::bigint AS earnings_cents
         FROM jobs
        WHERE assigned_helper_id = $1
          AND deleted_at IS NULL
          AND status = 'completed'`,
      [userId]
    ),
  ]);

  return {
    activeJobs: Number(jobRow?.active_jobs || 0),
    orders: Number(foodOrderRow?.total_orders || 0),
    earningsCents: Number(earningsRow?.earnings_cents || 0),
  };
}

async function queryUserWalletSummary(userId) {
  const { rows } = await pool.query(
    `SELECT currency_code,
            COUNT(*)::int AS wallet_count,
            COUNT(*) FILTER (WHERE status = 'active')::int AS active_wallet_count,
            COUNT(*) FILTER (WHERE status = 'suspended')::int AS locked_wallet_count,
            COALESCE(SUM(balance_cents), 0)::bigint AS total_balance_cents,
            COALESCE(SUM(balance_cents) FILTER (WHERE status = 'active'), 0)::bigint AS available_balance_cents,
            COALESCE(SUM(balance_cents) FILTER (WHERE status = 'suspended'), 0)::bigint AS locked_balance_cents
       FROM food_customer_wallet_accounts
      WHERE customer_id = $1
        AND status <> 'closed'
      GROUP BY currency_code
      ORDER BY currency_code`,
    [userId]
  );

  return {
    totalWallets: rows.reduce((sum, row) => sum + Number(row.wallet_count || 0), 0),
    activeWallets: rows.reduce((sum, row) => sum + Number(row.active_wallet_count || 0), 0),
    lockedWallets: rows.reduce((sum, row) => sum + Number(row.locked_wallet_count || 0), 0),
    balances: rows.map((row) => ({
      currencyCode: row.currency_code || 'USD',
      walletCount: Number(row.wallet_count || 0),
      activeWalletCount: Number(row.active_wallet_count || 0),
      lockedWalletCount: Number(row.locked_wallet_count || 0),
      balanceCents: Number(row.available_balance_cents || 0),
      availableBalanceCents: Number(row.available_balance_cents || 0),
      lockedBalanceCents: Number(row.locked_balance_cents || 0),
      totalBalanceCents: Number(row.total_balance_cents || 0),
    })),
  };
}

async function queryUserActivity(userId, limit) {
  const { rows } = await pool.query(
    `SELECT *
       FROM (
         SELECT
           CONCAT('bid-', b.id) AS id,
           b.created_at AS event_at,
           CONCAT(COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), 'A helper'), ' placed a bid') AS title,
           CONCAT(COALESCE(j.title, 'Job'), ' • $', ROUND(COALESCE(b.amount, 0))::text) AS subtitle,
           'hand.raised.fill' AS icon,
           'primary' AS tint_key
           FROM bids b
           JOIN users u ON u.id = b.helper_id
           JOIN jobs j ON j.id = b.job_id
          WHERE j.client_id = $1

         UNION ALL

         SELECT
           CONCAT('food-order-', fo.id) AS id,
           fo.created_at AS event_at,
           CASE
             WHEN fo.status = 'completed' THEN 'Order delivered'
             WHEN fo.status = 'ready' THEN 'Order ready'
             ELSE 'Food order updated'
           END AS title,
           CONCAT(COALESCE(fr.display_name, 'Restaurant'), ' • $', ROUND(COALESCE(fo.total_cents, 0) / 100.0)::text) AS subtitle,
           CASE
             WHEN fo.status = 'completed' THEN 'checkmark.seal.fill'
             WHEN fo.fulfillment_type = 'delivery' THEN 'bicycle'
             ELSE 'bag.fill'
           END AS icon,
           CASE
             WHEN fo.status = 'completed' THEN 'success'
             WHEN fo.fulfillment_type = 'delivery' THEN 'accent'
             ELSE 'secondary'
           END AS tint_key
           FROM food_orders fo
           LEFT JOIN food_restaurants fr ON fr.id = fo.restaurant_id
          WHERE fo.customer_id = $1
       ) activity
      ORDER BY event_at DESC
      LIMIT $2`,
    [userId, limit]
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    icon: row.icon,
    tintKey: row.tint_key,
    timeAgo: row.event_at,
  }));
}

function contractStatus(result) {
  return {
    status: result.status,
    errorCode: result.errorCode,
  };
}

function buildDashboardContract({ helpers, restaurants, activity, summaryResult, walletResult, helpersResult, restaurantsResult, activityResult }) {
  return {
    version: 'main-home-v1',
    generatedAt: new Date().toISOString(),
    dataSource: 'production',
    sections: [
      {
        key: 'summary',
        source: 'jobs + food_orders + completed helper jobs',
        count: 1,
        ...contractStatus(summaryResult),
      },
      {
        key: 'walletSummary',
        source: 'food_customer_wallet_accounts',
        count: walletResult.data.totalWallets,
        ...contractStatus(walletResult),
      },
      {
        key: 'featuredHelpers',
        source: 'users + helper_profiles',
        count: helpers.length,
        ...contractStatus(helpersResult),
      },
      {
        key: 'popularRestaurants',
        source: 'food_restaurants + food_restaurant_promotions',
        count: restaurants.length,
        ...contractStatus(restaurantsResult),
      },
      {
        key: 'activity',
        source: 'bids + jobs + food_orders',
        count: activity.length,
        ...contractStatus(activityResult),
      },
    ],
  };
}

exports.getHomeDashboard = async (req, res, next) => {
  try {
    const helperLimit = parseLimit(req.query.helpers, 4, 8);
    const restaurantLimit = parseLimit(req.query.restaurants, 4, 8);
    const activityLimit = parseLimit(req.query.activity, 5, 10);

    const [helpersResult, restaurantsResult, activityResult, summaryResult, walletResult] = await Promise.all([
      loadHomeSection('featuredHelpers', [], () => queryFeaturedHelpers(helperLimit)),
      loadHomeSection('popularRestaurants', [], () => queryPopularRestaurants(restaurantLimit)),
      loadHomeSection('activity', [], () => (
        req.user ? queryUserActivity(req.user.id, activityLimit) : queryPublicActivity(activityLimit)
      )),
      loadHomeSection('summary', defaultSummary(), () => (
        req.user ? queryUserSummary(req.user.id) : Promise.resolve(defaultSummary())
      )),
      loadHomeSection('walletSummary', defaultWalletSummary(), () => (
        req.user ? queryUserWalletSummary(req.user.id) : Promise.resolve(defaultWalletSummary())
      )),
    ]);

    const helpers = helpersResult.data;
    const restaurants = restaurantsResult.data;
    const activity = activityResult.data;
    const summary = summaryResult.data;
    const walletSummary = walletResult.data;
    const contract = buildDashboardContract({
      helpers,
      restaurants,
      activity,
      summaryResult,
      walletResult,
      helpersResult,
      restaurantsResult,
      activityResult,
    });

    res.json({
      contract,
      context: {
        isAuthenticated: Boolean(req.user),
        userId: req.user?.id || null,
      },
      summary,
      walletSummary,
      featuredHelpers: helpers,
      popularRestaurants: restaurants,
      activity,
    });
  } catch (err) {
    next(err);
  }
};
