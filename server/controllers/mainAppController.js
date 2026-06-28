'use strict';

const pool = require('../db');

function parseLimit(value, fallback = 4, max = 12) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, parsed);
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
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
    earningsCurrencyCode: 'USD',
  };
}

function formatCurrencyDetail(currencyCode, cents) {
  return `${currencyCode || 'USD'} ${(Number(cents || 0) / 100).toFixed(2)}`;
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

async function loadActivitySource(key, loader) {
  try {
    return {
      key,
      data: await loader(),
      status: 'ok',
      errorCode: null,
    };
  } catch (err) {
    console.warn(`[main-app/activity] ${key} degraded`, {
      code: err?.code,
      message: err?.message,
    });
    return {
      key,
      data: [],
      status: 'degraded',
      errorCode: publicHomeErrorCode(err),
    };
  }
}

function activityTypeFromNotification(type = '') {
  const value = String(type).toLowerCase();
  if (value.includes('bid')) return 'bid';
  if (value.includes('order') || value.includes('food')) return 'order';
  if (value.includes('message') || value.includes('chat')) return 'message';
  if (value.includes('booking') || value.includes('appointment')) return 'booking';
  return 'booking';
}

function iconForActivityType(type) {
  switch (type) {
    case 'bid': return 'hand.raised.fill';
    case 'order': return 'bicycle';
    case 'message': return 'bubble.left.fill';
    case 'booking':
    default: return 'checkmark.seal.fill';
  }
}

function tintForActivityType(type) {
  switch (type) {
    case 'bid': return 'primary';
    case 'order': return 'accent';
    case 'message': return 'secondary';
    case 'booking':
    default: return 'success';
  }
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
            COALESCE(fr.is_featured, FALSE) AS is_featured,
            COALESCE(fr.featured_rank, 1000)::int AS featured_rank,
            COALESCE(fr.discovery_status, 'visible') AS discovery_status,
            COALESCE(fr.is_accepting_orders_now, TRUE) AS is_accepting_orders_now,
            fr.temporarily_closed_until,
            COALESCE(fr.minimum_order_cents, 0)::int AS minimum_order_cents,
            COALESCE(fr.delivery_fee_cents, 0)::int AS delivery_fee_cents,
            COALESCE(fr.currency_code, 'USD') AS currency_code,
            COALESCE(fr.accepts_online_orders, TRUE) AS accepts_online_orders,
            COALESCE(fr.fulfillment_modes, ARRAY['pickup']::text[]) AS fulfillment_modes,
            fr.service_area_radius_meters,
            COALESCE(fr.order_count, 0)::int AS order_count,
            fr.last_ordered_at,
            fr.last_reviewed_at,
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
        AND COALESCE(fr.discovery_status, 'visible') = 'visible'
        AND COALESCE(fr.accepts_online_orders, TRUE) = TRUE
        AND COALESCE(fr.is_accepting_orders_now, TRUE) = TRUE
        AND (fr.temporarily_closed_until IS NULL OR fr.temporarily_closed_until <= NOW())
      ORDER BY COALESCE(fr.is_featured, FALSE) DESC,
               COALESCE(fr.featured_rank, 1000) ASC,
               COALESCE(fr.avg_rating, 0) DESC,
               COALESCE(fr.rating_count, 0) DESC,
               COALESCE(fr.order_count, 0) DESC,
               fr.created_at DESC
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
    isFeatured: Boolean(row.is_featured),
    featuredRank: Number(row.featured_rank || 1000),
    discoveryStatus: row.discovery_status || 'visible',
    isAcceptingOrdersNow: Boolean(row.is_accepting_orders_now),
    temporarilyClosedUntil: row.temporarily_closed_until || null,
    minimumOrderCents: Number(row.minimum_order_cents || 0),
    deliveryFeeCents: Number(row.delivery_fee_cents || 0),
    currencyCode: row.currency_code || 'USD',
    acceptsOnlineOrders: Boolean(row.accepts_online_orders),
    isOrderable: Boolean(row.accepts_online_orders) && Boolean(row.is_accepting_orders_now),
    pickupEnabled: Array.isArray(row.fulfillment_modes) ? row.fulfillment_modes.includes('pickup') : true,
    deliveryEnabled: Array.isArray(row.fulfillment_modes) ? row.fulfillment_modes.includes('delivery') : false,
    dineInEnabled: Array.isArray(row.fulfillment_modes) ? row.fulfillment_modes.includes('dine_in') : false,
    serviceAreaRadiusMeters: row.service_area_radius_meters === null ? null : Number(row.service_area_radius_meters),
    orderCount: Number(row.order_count || 0),
    lastOrderedAt: row.last_ordered_at || null,
    lastReviewedAt: row.last_reviewed_at || null,
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
            b.job_id,
            b.amount,
            b.amount_cents,
            COALESCE(b.currency_code, j.currency_code, 'USD') AS currency_code,
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
    subtitle: `${row.job_title} • ${formatCurrencyDetail(row.currency_code, row.amount_cents ?? centsFromDecimalDollars(row.amount))}`,
    icon: iconForBidAmount(row.amount_cents ? Number(row.amount_cents) / 100 : row.amount),
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
      `SELECT COALESCE(currency_code, 'USD') AS currency_code,
              COALESCE(SUM(COALESCE(
                helper_payout_cents,
                job_value_cents,
                final_price_cents,
                budget_max_cents,
                budget_min_cents,
                ROUND(COALESCE(helper_payout, job_value, final_price, budget_max, budget_min, 0) * 100)::int
              )), 0)::bigint AS earnings_cents
         FROM jobs
        WHERE assigned_helper_id = $1
          AND deleted_at IS NULL
          AND status = 'completed'
        GROUP BY COALESCE(currency_code, 'USD')
        ORDER BY earnings_cents DESC
        LIMIT 1`,
      [userId]
    ),
  ]);

  return {
    activeJobs: Number(jobRow?.active_jobs || 0),
    orders: Number(foodOrderRow?.total_orders || 0),
    earningsCents: Number(earningsRow?.earnings_cents || 0),
    earningsCurrencyCode: earningsRow?.currency_code || 'USD',
  };
}

function roleFromBusinessMember(role) {
  const value = String(role || '').toLowerCase();
  if (value === 'manager') return 'manager';
  if (value === 'employee' || value === 'representative' || value === 'support_agent') return 'staff';
  return null;
}

function normalizeUserRole(role) {
  const value = String(role || '').toLowerCase();
  if (value === 'helper' || value === 'helper_pro' || value === 'broker') return 'helper';
  if (value === 'restaurant_owner') return 'restaurantOwner';
  if (value === 'restaurant_manager') return 'manager';
  if (value === 'restaurant_staff') return 'staff';
  if (value === 'restaurant_runner') return 'runner';
  return 'customer';
}

function memberSinceLabel(createdAt) {
  const date = createdAt ? new Date(createdAt) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Member';
  return `Member since ${date.getUTCFullYear()}`;
}

function centsFromDecimalDollars(value) {
  return Math.round(Number(value || 0) * 100);
}

async function queryProfileIdentity(userId) {
  const { rows } = await pool.query(
    `SELECT u.id,
            u.first_name,
            u.last_name,
            u.email,
            u.username,
            u.role,
            u.default_mode,
            u.created_at,
            hp.avg_rating,
            hp.total_reviews,
            hp.completed_jobs_count,
            EXISTS (
              SELECT 1
                FROM helper_profiles hp2
               WHERE hp2.user_id = u.id
            ) AS has_helper_profile,
            EXISTS (
              SELECT 1
                FROM businesses b
               WHERE b.user_id = u.id
                 AND COALESCE(b.is_active, true) = true
            ) AS owns_business,
            COALESCE((
              SELECT ARRAY_AGG(DISTINCT bm.role)
                FROM business_members bm
               WHERE bm.member_id = u.id
                 AND COALESCE(bm.status, 'active') = 'active'
            ), ARRAY[]::text[]) AS business_member_roles
       FROM users u
       LEFT JOIN helper_profiles hp ON hp.user_id = u.id
      WHERE u.id = $1
      LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function queryProfileTotals(userId) {
  const [
    { rows: [jobRow] },
    { rows: [foodOrderRow] },
  ] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) FILTER (
                WHERE assigned_helper_id = $1
                  AND status = 'completed'
              )::int AS jobs_completed,
              COALESCE(SUM(COALESCE(
                helper_payout_cents,
                job_value_cents,
                final_price_cents,
                budget_max_cents,
                budget_min_cents,
                ROUND(COALESCE(helper_payout, job_value, final_price, budget_max, budget_min, 0) * 100)::int
              )) FILTER (
                WHERE assigned_helper_id = $1
                  AND status = 'completed'
              ), 0)::bigint AS earned_cents,
              COALESCE(SUM(COALESCE(
                customer_total_cents,
                final_price_cents,
                job_value_cents,
                budget_max_cents,
                budget_min_cents,
                ROUND(COALESCE(customer_total, final_price, job_value, budget_max, budget_min, 0) * 100)::int
              )) FILTER (
                WHERE client_id = $1
                  AND status = 'completed'
              ), 0)::bigint AS spent_job_cents,
              COALESCE(MAX(currency_code), 'USD') AS currency_code
         FROM jobs
        WHERE deleted_at IS NULL
          AND (assigned_helper_id = $1 OR client_id = $1)`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE status <> 'cancelled')::int AS orders_placed,
              COALESCE(SUM(total_cents) FILTER (
                WHERE status <> 'cancelled'
                  AND payment_status IN ('paid', 'refunded')
              ), 0)::bigint AS spent_food_cents
         FROM food_orders
        WHERE customer_id = $1`,
      [userId]
    ),
  ]);

  const earnedCents = Number(jobRow?.earned_cents || 0);
  const spentJobCents = Number(jobRow?.spent_job_cents || 0);
  const spentFoodCents = Number(foodOrderRow?.spent_food_cents || 0);

  return {
    jobsCompleted: Number(jobRow?.jobs_completed || 0),
    ordersPlaced: Number(foodOrderRow?.orders_placed || 0),
    totalEarnedCents: earnedCents,
    totalSpentCents: spentJobCents + spentFoodCents,
    currencyCode: jobRow?.currency_code || 'USD',
  };
}

async function queryProfileWeeklyEarnings(userId) {
  const { rows } = await pool.query(
    `WITH days AS (
       SELECT generate_series(
                date_trunc('week', NOW())::date,
                date_trunc('week', NOW())::date + INTERVAL '6 days',
                INTERVAL '1 day'
              ) AS day
     )
     SELECT to_char(days.day, 'Dy') AS label,
            COALESCE(SUM(COALESCE(
              j.helper_payout_cents,
              j.job_value_cents,
              j.final_price_cents,
              j.budget_max_cents,
              j.budget_min_cents,
              ROUND(COALESCE(j.helper_payout, j.job_value, j.final_price, j.budget_max, j.budget_min, 0) * 100)::int
            )), 0)::bigint AS earned_cents,
            COALESCE(MAX(j.currency_code), 'USD') AS currency_code
       FROM days
       LEFT JOIN jobs j
         ON j.assigned_helper_id = $1
        AND j.deleted_at IS NULL
        AND j.status = 'completed'
        AND COALESCE(j.completed_at, j.updated_at, j.created_at) >= days.day
        AND COALESCE(j.completed_at, j.updated_at, j.created_at) < days.day + INTERVAL '1 day'
      GROUP BY days.day
      ORDER BY days.day`,
    [userId]
  );

  return rows.map((row) => ({
    label: row.label,
    amountCents: Number(row.earned_cents || 0),
    currencyCode: row.currency_code || 'USD',
  }));
}

function buildEnabledRoles(identity) {
  const roles = new Set(['customer']);
  const userRole = String(identity?.role || '').toLowerCase();

  if (identity?.has_helper_profile || ['helper', 'helper_pro', 'broker'].includes(userRole)) {
    roles.add('helper');
  }
  if (identity?.owns_business || userRole === 'restaurant_owner') {
    roles.add('restaurantOwner');
  }
  if (userRole === 'restaurant_runner') {
    roles.add('runner');
  }

  for (const role of identity?.business_member_roles || []) {
    const mapped = roleFromBusinessMember(role);
    if (mapped) roles.add(mapped);
  }

  return Array.from(roles);
}

function activeProfileRole(identity, enabledRoles) {
  const modeRole = normalizeUserRole(identity?.default_mode || identity?.role);
  if (enabledRoles.includes(modeRole)) return modeRole;
  const directRole = normalizeUserRole(identity?.role);
  if (enabledRoles.includes(directRole)) return directRole;
  return enabledRoles[0] || 'customer';
}

function profileHandle(identity) {
  const username = String(identity?.username || '').trim();
  if (username) return username.startsWith('@') ? username : `@${username}`;
  const first = String(identity?.first_name || '').trim().toLowerCase();
  const last = String(identity?.last_name || '').trim().toLowerCase();
  const handle = `${first}${last}`.replace(/[^a-z0-9_]/g, '');
  return handle ? `@${handle}` : '@user';
}

function buildProfileContract(sources) {
  return {
    version: 'main-profile-summary-v1',
    generatedAt: new Date().toISOString(),
    dataSource: 'production',
    sources,
  };
}

function buildBusinessHubContract(count) {
  return {
    version: 'main-business-hub-v1',
    generatedAt: new Date().toISOString(),
    dataSource: 'production',
    sources: [
      {
        key: 'businesses',
        source: 'businesses + business_members + business_invoices + business_clients + food_restaurants',
        status: 'ok',
        count,
      },
    ],
  };
}

function businessHubCapabilities({ role, isOwner }) {
  const normalizedRole = String(role || '').toLowerCase();
  const owner = Boolean(isOwner) || normalizedRole === 'owner';
  const manager = normalizedRole === 'manager';
  return {
    canEditProfile: owner || manager,
    canManageFinance: owner || manager,
    canInviteTeam: owner,
    canApproveWalletLoads: owner || manager,
    canManageRestaurant: owner || manager,
  };
}

function businessHubPermissions(capabilities) {
  const permissions = ['business.view'];
  if (capabilities.canEditProfile) permissions.push('business.edit');
  if (capabilities.canManageFinance) permissions.push('finance.view', 'finance.manage');
  if (capabilities.canInviteTeam) permissions.push('team.invite', 'team.manage');
  if (capabilities.canManageRestaurant) permissions.push('restaurant.view', 'restaurant.manage');
  if (capabilities.canApproveWalletLoads) permissions.push('restaurant.wallet.approve');
  return permissions;
}

function normalizeBusinessHubRow(row) {
  const role = row.role || (row.is_owner ? 'owner' : 'representative');
  const capabilities = businessHubCapabilities({ role, isOwner: row.is_owner });
  const restaurants = Array.isArray(row.restaurants) ? row.restaurants : [];
  const currencyCode = row.currency_code || restaurants[0]?.currency_code || 'USD';
  return {
    id: String(row.id),
    business_name: row.business_name,
    business_type: row.business_type || null,
    industry_category: row.industry_category || null,
    business_mode: row.business_mode || null,
    description: row.description || null,
    website: row.website || null,
    phone: row.phone || null,
    address_city: row.address_city || null,
    address_state: row.address_state || null,
    address_country: row.address_country || null,
    address_zip: row.address_zip || null,
    is_primary: Boolean(row.is_primary),
    is_active: row.is_active !== false,
    is_listed: row.is_listed !== false,
    tax_rate: row.tax_rate === null || row.tax_rate === undefined ? null : Number(row.tax_rate),
    logo_url: row.logo_url || null,
    created_at: toIso(row.created_at),
    role,
    is_owner: Boolean(row.is_owner),
    membership_id: row.membership_id === null || row.membership_id === undefined ? null : String(row.membership_id),
    permissions: businessHubPermissions(capabilities),
    capabilities,
    restaurants: restaurants.map((restaurant) => ({
      id: String(restaurant.id),
      display_name: restaurant.display_name,
      status: restaurant.status || 'draft',
      currency_code: restaurant.currency_code || currencyCode,
      is_accepting_orders_now: restaurant.is_accepting_orders_now !== false,
    })),
    summary: {
      revenue_cents: Number(row.revenue_cents || 0),
      outstanding_cents: Number(row.outstanding_cents || 0),
      invoice_count: Number(row.invoice_count || 0),
      open_invoice_count: Number(row.open_invoice_count || 0),
      client_count: Number(row.client_count || 0),
      team_count: Number(row.team_count || 0),
      pending_invite_count: Number(row.pending_invite_count || 0),
      restaurant_count: Number(row.restaurant_count || 0),
      pending_wallet_approvals: Number(row.pending_wallet_approvals || 0),
      unread_messages: Number(row.unread_messages || 0),
      currency_code: currencyCode,
    },
  };
}

async function queryBusinessHub(userId) {
  const { rows } = await pool.query(
    `WITH accessible AS (
       SELECT b.id,
              b.user_id,
              b.business_name,
              b.business_type,
              b.industry_category,
              b.business_mode,
              b.description,
              b.website,
              b.phone,
              b.address_city,
              b.address_state,
              b.address_country,
              b.address_zip,
              b.is_primary,
              b.is_active,
              b.is_listed,
              b.tax_rate,
              b.logo_url,
              b.created_at,
              NULL::bigint AS membership_id,
              'owner'::text AS role,
              TRUE AS is_owner
         FROM businesses b
        WHERE b.user_id = $1
          AND b.deleted_at IS NULL
          AND COALESCE(b.is_active, TRUE) = TRUE

       UNION ALL

       SELECT b.id,
              b.user_id,
              b.business_name,
              b.business_type,
              b.industry_category,
              b.business_mode,
              b.description,
              b.website,
              b.phone,
              b.address_city,
              b.address_state,
              b.address_country,
              b.address_zip,
              b.is_primary,
              b.is_active,
              b.is_listed,
              b.tax_rate,
              b.logo_url,
              b.created_at,
              bm.id::bigint AS membership_id,
              bm.role,
              FALSE AS is_owner
         FROM business_members bm
         JOIN businesses b ON b.id = bm.business_id
        WHERE bm.member_id = $1
          AND bm.status = 'active'
          AND b.user_id <> $1
          AND b.deleted_at IS NULL
          AND COALESCE(b.is_active, TRUE) = TRUE
     ),
     invoice_stats AS (
       SELECT business_id,
              COUNT(*)::int AS invoice_count,
              COUNT(*) FILTER (WHERE status NOT IN ('paid', 'cancelled'))::int AS open_invoice_count,
              COALESCE(ROUND(SUM(total) FILTER (WHERE status = 'paid') * 100), 0)::bigint AS revenue_cents,
              COALESCE(ROUND(SUM(GREATEST(total - COALESCE(amount_paid, 0), 0)) FILTER (WHERE status NOT IN ('paid', 'cancelled')) * 100), 0)::bigint AS outstanding_cents
         FROM business_invoices
        GROUP BY business_id
     ),
     client_stats AS (
       SELECT business_id,
              COUNT(*)::int AS client_count
         FROM business_clients
        WHERE deleted_at IS NULL
        GROUP BY business_id
     ),
     member_stats AS (
       SELECT business_id,
              COUNT(*) FILTER (WHERE status = 'active')::int AS team_count,
              COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_invite_count
         FROM business_members
        WHERE status <> 'revoked'
        GROUP BY business_id
     ),
     restaurant_stats AS (
       SELECT business_id,
              COUNT(*)::int AS restaurant_count,
              COALESCE(MAX(currency_code) FILTER (WHERE currency_code IS NOT NULL), 'USD') AS currency_code,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', id::text,
                    'display_name', display_name,
                    'status', status,
                    'currency_code', COALESCE(currency_code, 'USD'),
                    'is_accepting_orders_now', COALESCE(is_accepting_orders_now, TRUE)
                  )
                  ORDER BY display_name
                ),
                '[]'::json
              ) AS restaurants
         FROM food_restaurants
        WHERE business_id IS NOT NULL
          AND status IN ('draft', 'paused', 'active')
        GROUP BY business_id
     ),
     wallet_request_stats AS (
       SELECT business_id,
              COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_wallet_approvals
         FROM food_customer_wallet_load_requests
        WHERE business_id IS NOT NULL
        GROUP BY business_id
     ),
     message_stats AS (
       SELECT c.business_id,
              COUNT(m.id) FILTER (
                WHERE m.sender_id <> $1
                  AND COALESCE(m.is_read, FALSE) = FALSE
              )::int AS unread_messages
         FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id
        WHERE c.business_id IS NOT NULL
        GROUP BY c.business_id
     )
     SELECT a.*,
            COALESCE(inv.invoice_count, 0)::int AS invoice_count,
            COALESCE(inv.open_invoice_count, 0)::int AS open_invoice_count,
            COALESCE(inv.revenue_cents, 0)::bigint AS revenue_cents,
            COALESCE(inv.outstanding_cents, 0)::bigint AS outstanding_cents,
            COALESCE(cl.client_count, 0)::int AS client_count,
            COALESCE(ms.team_count, 0)::int AS team_count,
            COALESCE(ms.pending_invite_count, 0)::int AS pending_invite_count,
            COALESCE(rs.restaurant_count, 0)::int AS restaurant_count,
            COALESCE(wrs.pending_wallet_approvals, 0)::int AS pending_wallet_approvals,
            COALESCE(msg.unread_messages, 0)::int AS unread_messages,
            COALESCE(rs.currency_code, 'USD') AS currency_code,
            COALESCE(rs.restaurants, '[]'::json) AS restaurants
       FROM accessible a
       LEFT JOIN invoice_stats inv ON inv.business_id = a.id
       LEFT JOIN client_stats cl ON cl.business_id = a.id
       LEFT JOIN member_stats ms ON ms.business_id = a.id
       LEFT JOIN restaurant_stats rs ON rs.business_id = a.id
       LEFT JOIN wallet_request_stats wrs ON wrs.business_id = a.id
       LEFT JOIN message_stats msg ON msg.business_id = a.id
      ORDER BY a.is_primary DESC, a.is_owner DESC, a.business_name ASC`,
    [userId]
  );

  return rows.map(normalizeBusinessHubRow);
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
           CONCAT(
             COALESCE(j.title, 'Job'),
             ' • ',
             COALESCE(b.currency_code, j.currency_code, 'USD'),
             ' ',
             ROUND(COALESCE(b.amount_cents, ROUND(COALESCE(b.amount, 0) * 100)::int, 0) / 100.0)::text
           ) AS subtitle,
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
           CONCAT(COALESCE(fr.display_name, 'Restaurant'), ' • ', COALESCE(fo.currency_code, 'USD'), ' ', ROUND(COALESCE(fo.total_cents, 0) / 100.0)::text) AS subtitle,
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

async function queryActivityNotifications(userId, limit) {
  const { rows } = await pool.query(
    `SELECT id,
            type,
            title,
            body,
            data,
            data->>'action_url' AS action_url,
            is_read,
            created_at
       FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, limit]
  );

  return rows.map((row) => {
    const type = activityTypeFromNotification(row.type);
    return {
      id: `notification-${row.id}`,
      source: 'notification',
      sourceId: String(row.id),
      type,
      title: row.title || 'Notification',
      subtitle: row.body || '',
      detail: null,
      icon: iconForActivityType(type),
      tintKey: tintForActivityType(type),
      eventAt: toIso(row.created_at),
      isUnread: row.is_read !== true,
      actionLabel: row.is_read === true ? null : 'View',
      actionUrl: row.action_url || null,
      canMarkRead: true,
      canDelete: true,
    };
  });
}

async function queryActivityBids(userId, limit) {
  const { rows } = await pool.query(
    `SELECT b.id,
            b.job_id,
            b.amount,
            b.amount_cents,
            COALESCE(b.currency_code, j.currency_code, 'USD') AS currency_code,
            b.status,
            b.created_at,
            b.helper_id,
            j.client_id,
            COALESCE(j.title, 'Job') AS job_title,
            COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), 'A helper') AS helper_name
       FROM bids b
       JOIN jobs j ON j.id = b.job_id
       JOIN users u ON u.id = b.helper_id
      WHERE j.deleted_at IS NULL
        AND (j.client_id = $1 OR b.helper_id = $1)
      ORDER BY b.created_at DESC
      LIMIT $2`,
    [userId, limit]
  );

  return rows.map((row) => {
    const isHelper = String(row.helper_id) === String(userId);
    return {
      id: `bid-${row.id}`,
      source: 'bid',
      sourceId: String(row.id),
      type: 'bid',
      title: isHelper ? 'Bid sent' : `${row.helper_name} placed a bid`,
      subtitle: row.job_title,
      detail: `${formatCurrencyDetail(row.currency_code, row.amount_cents ?? centsFromDecimalDollars(row.amount))} • ${row.status || 'pending'}`,
      icon: iconForBidAmount(row.amount_cents ? Number(row.amount_cents) / 100 : row.amount),
      tintKey: 'primary',
      eventAt: toIso(row.created_at),
      isUnread: false,
      actionLabel: 'View Bid',
      actionUrl: `/jobs/${row.job_id || ''}`,
      canMarkRead: false,
      canDelete: false,
    };
  });
}

async function queryActivityFoodOrders(userId, limit) {
  const { rows } = await pool.query(
    `SELECT fo.id,
            fo.status,
            fo.fulfillment_type,
            fo.total_cents,
            fo.currency_code,
            fo.created_at,
            COALESCE(fr.display_name, 'Restaurant') AS restaurant_name
       FROM food_orders fo
       LEFT JOIN food_restaurants fr ON fr.id = fo.restaurant_id
      WHERE fo.customer_id = $1
      ORDER BY fo.created_at DESC
      LIMIT $2`,
    [userId, limit]
  );

  return rows.map((row) => {
    let title = 'Food order updated';
    if (row.status === 'completed') title = 'Order delivered';
    if (row.status === 'ready') title = 'Order ready';
    if (row.status === 'received') title = 'Order received';
    return {
      id: `food-order-${row.id}`,
      source: 'food_order',
      sourceId: String(row.id),
      type: 'order',
      title,
      subtitle: row.restaurant_name,
      detail: `${formatCurrencyDetail(row.currency_code, row.total_cents)} • ${row.fulfillment_type || 'pickup'}`,
      icon: row.fulfillment_type === 'delivery' ? 'bicycle' : 'bag.fill',
      tintKey: row.status === 'completed' ? 'success' : 'accent',
      eventAt: toIso(row.created_at),
      isUnread: false,
      actionLabel: 'View Order',
      actionUrl: `/food/orders/${row.id}`,
      canMarkRead: false,
      canDelete: false,
    };
  });
}

async function queryActivityBookings(userId, limit) {
  const { rows } = await pool.query(
    `SELECT a.id,
            a.status,
            a.service_description,
            a.scheduled_start_time,
            a.created_at,
            a.customer_id,
            COALESCE(NULLIF(TRIM(helper.first_name || ' ' || helper.last_name), ''), 'Helper') AS helper_name,
            COALESCE(NULLIF(TRIM(customer.first_name || ' ' || customer.last_name), ''), 'Customer') AS customer_name
       FROM appointments a
       LEFT JOIN users helper ON helper.id = a.helper_id
       LEFT JOIN users customer ON customer.id = a.customer_id
      WHERE a.customer_id = $1 OR a.helper_id = $1
      ORDER BY COALESCE(a.updated_at, a.created_at) DESC
      LIMIT $2`,
    [userId, limit]
  );

  return rows.map((row) => {
    const isCustomer = String(row.customer_id) === String(userId);
    return {
      id: `booking-${row.id}`,
      source: 'booking',
      sourceId: String(row.id),
      type: 'booking',
      title: `Booking ${row.status || 'updated'}`,
      subtitle: row.service_description || (isCustomer ? row.helper_name : row.customer_name),
      detail: row.scheduled_start_time ? `Scheduled ${toIso(row.scheduled_start_time)}` : null,
      icon: 'checkmark.seal.fill',
      tintKey: row.status === 'cancelled' ? 'secondary' : 'success',
      eventAt: toIso(row.created_at),
      isUnread: false,
      actionLabel: 'View Booking',
      actionUrl: `/calendar/appointments/${row.id}`,
      canMarkRead: false,
      canDelete: false,
    };
  });
}

async function queryActivityMessages(userId, limit) {
  const { rows } = await pool.query(
    `SELECT m.id,
            m.content,
            m.is_read,
            m.created_at,
            m.sender_id,
            c.id AS conversation_id,
            c.job_id,
            COALESCE(j.title, 'Conversation') AS job_title,
            COALESCE(NULLIF(TRIM(sender.first_name || ' ' || sender.last_name), ''), 'Someone') AS sender_name
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       LEFT JOIN jobs j ON j.id = c.job_id
       JOIN users sender ON sender.id = m.sender_id
      WHERE (c.customer_id = $1 OR c.helper_id = $1)
        AND COALESCE(c.status, 'active') <> 'blocked'
        AND c.archived_at IS NULL
      ORDER BY m.created_at DESC
      LIMIT $2`,
    [userId, limit]
  );

  return rows.map((row) => {
    const sentByCurrentUser = String(row.sender_id) === String(userId);
    return {
      id: `message-${row.id}`,
      source: 'message',
      sourceId: String(row.id),
      type: 'message',
      title: sentByCurrentUser ? 'Message sent' : `Message from ${row.sender_name}`,
      subtitle: row.job_title,
      detail: row.content,
      icon: 'bubble.left.fill',
      tintKey: 'secondary',
      eventAt: toIso(row.created_at),
      isUnread: !sentByCurrentUser && row.is_read !== true,
      actionLabel: sentByCurrentUser ? 'Open Chat' : 'Reply',
      actionUrl: `/messages/conversations/${row.conversation_id}`,
      canMarkRead: false,
      canDelete: false,
    };
  });
}

exports.getActivityFeed = async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit, 30, 100);
    const sourceLimit = Math.min(50, Math.max(limit, 20));
    const userId = req.user.id;

    const [notifications, bids, foodOrders, bookings, messages] = await Promise.all([
      loadActivitySource('notifications', () => queryActivityNotifications(userId, sourceLimit)),
      loadActivitySource('bids', () => queryActivityBids(userId, sourceLimit)),
      loadActivitySource('foodOrders', () => queryActivityFoodOrders(userId, sourceLimit)),
      loadActivitySource('bookings', () => queryActivityBookings(userId, sourceLimit)),
      loadActivitySource('messages', () => queryActivityMessages(userId, sourceLimit)),
    ]);

    const sources = [notifications, bids, foodOrders, bookings, messages];
    const events = sources
      .flatMap((source) => source.data)
      .sort((a, b) => new Date(b.eventAt || 0) - new Date(a.eventAt || 0))
      .slice(0, limit);

    res.json({
      contract: {
        version: 'main-activity-v1',
        generatedAt: new Date().toISOString(),
        dataSource: 'production',
        sources: sources.map((source) => ({
          key: source.key,
          status: source.status,
          errorCode: source.errorCode,
          count: source.data.length,
        })),
      },
      events,
      unreadCount: events.filter((event) => event.isUnread).length,
      limit,
    });
  } catch (err) {
    next(err);
  }
};

exports.getProfileSummary = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [identity, totals, weeklyEarnings] = await Promise.all([
      queryProfileIdentity(userId),
      queryProfileTotals(userId),
      queryProfileWeeklyEarnings(userId),
    ]);

    if (!identity) {
      return res.status(404).json({ error: 'User not found' });
    }

    const enabledRoles = buildEnabledRoles(identity);
    const activeRole = activeProfileRole(identity, enabledRoles);
    const fullName = [identity.first_name, identity.last_name].filter(Boolean).join(' ').trim() || 'OxSteed User';

    return res.json({
      contract: buildProfileContract([
        {
          key: 'identity',
          source: 'users + helper_profiles + businesses + business_members',
          status: 'ok',
          count: 1,
        },
        {
          key: 'totals',
          source: 'jobs + food_orders',
          status: 'ok',
          count: 1,
        },
        {
          key: 'weeklyEarnings',
          source: 'completed helper jobs grouped by current week',
          status: 'ok',
          count: weeklyEarnings.length,
        },
      ]),
      account: {
        name: fullName,
        handle: profileHandle(identity),
        avatarSymbol: 'person.crop.circle.fill',
        memberSince: memberSinceLabel(identity.created_at),
        activeRole,
        enabledRoles,
        rating: Number(identity.avg_rating || 0),
        reviewCount: Number(identity.total_reviews || 0),
        jobsCompleted: Math.max(Number(identity.completed_jobs_count || 0), totals.jobsCompleted),
        ordersPlaced: totals.ordersPlaced,
        totalEarnedCents: totals.totalEarnedCents,
        totalSpentCents: totals.totalSpentCents,
        currencyCode: totals.currencyCode || 'USD',
      },
      earningsWeekly: weeklyEarnings,
    });
  } catch (err) {
    next(err);
  }
};

exports.getBusinessHub = async (req, res, next) => {
  try {
    const businesses = await queryBusinessHub(req.user.id);
    const totals = businesses.reduce((acc, business) => {
      acc.revenueCents += business.summary.revenue_cents;
      acc.outstandingCents += business.summary.outstanding_cents;
      acc.invoiceCount += business.summary.invoice_count;
      acc.clientCount += business.summary.client_count;
      acc.teamCount += business.summary.team_count;
      acc.restaurantCount += business.summary.restaurant_count;
      acc.pendingWalletApprovals += business.summary.pending_wallet_approvals;
      acc.unreadMessages += business.summary.unread_messages;
      return acc;
    }, {
      revenueCents: 0,
      outstandingCents: 0,
      invoiceCount: 0,
      clientCount: 0,
      teamCount: 0,
      restaurantCount: 0,
      pendingWalletApprovals: 0,
      unreadMessages: 0,
    });

    return res.json({
      contract: buildBusinessHubContract(businesses.length),
      businesses,
      totals,
    });
  } catch (err) {
    next(err);
  }
};

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
