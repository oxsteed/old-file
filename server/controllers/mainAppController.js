'use strict';

const pool = require('../db');
const { createLinkedSupportTicket } = require('../services/supportTicketLinkService');

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

function normalizeCurrency(value) {
  return String(value || 'USD').toUpperCase();
}

function centsFromDollars(value) {
  return Math.round(Number(value || 0) * 100);
}

function moneyStatus(value) {
  const status = String(value || '').toLowerCase();
  if (['paid', 'completed', 'released', 'refunded', 'captured'].includes(status)) return 'completed';
  if (['failed', 'cancelled', 'denied'].includes(status)) return 'failed';
  return 'pending';
}

function transactionTypeForSource(sourceType, amountCents = 0) {
  const source = String(sourceType || '').toLowerCase();
  if (source.includes('payout') || source.includes('withdraw')) return 'Withdrawal';
  if (source.includes('refund')) return 'Refund';
  if (source.includes('referral')) return 'Referral';
  if (source.includes('food')) return 'Food Order';
  if (source.includes('wallet') || source.includes('credit') || source.includes('promo')) return 'Credit';
  if (source.includes('job') || source.includes('payment')) return Number(amountCents) >= 0 ? 'Job Earned' : 'Job Paid';
  return Number(amountCents) >= 0 ? 'Credit' : 'Job Paid';
}

function sourceTypeFromTransactionType(type) {
  switch (String(type || '').toLowerCase()) {
    case 'job earned':
    case 'job paid':
      return 'job';
    case 'food order':
      return 'food_order';
    case 'withdrawal':
      return 'payout';
    case 'refund':
      return 'refund';
    case 'referral':
      return 'referral';
    case 'credit':
    default:
      return 'wallet';
  }
}

function serializeTransaction(row) {
  const amountCents = Number(row.amount_cents || 0);
  const sourceType = row.source_type || sourceTypeFromTransactionType(row.type);
  return {
    id: String(row.id),
    type: row.type || transactionTypeForSource(sourceType, amountCents),
    title: row.title || row.description || 'OxSteed transaction',
    subtitle: row.subtitle || '',
    amountCents: Math.abs(amountCents),
    signedAmountCents: amountCents,
    isCredit: amountCents >= 0,
    currencyCode: normalizeCurrency(row.currency_code || row.currency),
    status: moneyStatus(row.status),
    reference: row.reference || '',
    sourceType,
    sourceId: row.source_id ? String(row.source_id) : null,
    date: toIso(row.created_at || row.event_at || row.requested_at),
    disputable: amountCents < 0 && !['payout', 'withdrawal'].includes(String(sourceType).toLowerCase()),
  };
}

async function queryMainAppTransactions(userId, limit) {
  const queries = await Promise.allSettled([
    pool.query(
      `SELECT CONCAT('ledger-', id) AS id,
              source_type,
              description AS title,
              COALESCE(metadata->>'subtitle', source_type) AS subtitle,
              amount_cents,
              UPPER(currency) AS currency_code,
              'completed' AS status,
              COALESCE(metadata->>'reference', stripe_payment_intent_id, stripe_transfer_id, stripe_charge_id, job_id::text, id::text) AS reference,
              job_id::text AS source_id,
              created_at
         FROM platform_ledger
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [userId, limit]
    ),
    pool.query(
      `SELECT CONCAT('payment-', p.id) AS id,
              CASE WHEN p.payee_id = $1 THEN 'job_payment' ELSE 'job_paid' END AS source_type,
              COALESCE(j.title, 'OxSteed job payment') AS title,
              CASE WHEN p.payee_id = $1 THEN 'Earnings from completed work' ELSE 'Payment for hired work' END AS subtitle,
              CASE WHEN p.payee_id = $1 THEN ROUND(COALESCE(p.helper_payout, p.amount) * 100)::int ELSE -ROUND(p.amount * 100)::int END AS amount_cents,
              UPPER(COALESCE(p.currency, 'USD')) AS currency_code,
              p.status,
              COALESCE(p.stripe_payment_intent_id, p.stripe_transfer_id, p.id::text) AS reference,
              p.job_id::text AS source_id,
              p.created_at
         FROM payments p
         LEFT JOIN jobs j ON j.id = p.job_id
        WHERE p.payer_id = $1 OR p.payee_id = $1
        ORDER BY p.created_at DESC
        LIMIT $2`,
      [userId, limit]
    ),
    pool.query(
      `SELECT CONCAT('food-order-', fo.id) AS id,
              'food_order' AS source_type,
              COALESCE(fr.display_name, 'Food order') AS title,
              CONCAT(INITCAP(fo.fulfillment_type), ' · ', fo.status) AS subtitle,
              -fo.total_cents AS amount_cents,
              UPPER(fo.currency_code) AS currency_code,
              CASE WHEN fo.payment_status = 'paid' THEN 'completed' ELSE fo.payment_status END AS status,
              CONCAT('FOOD-', fo.id) AS reference,
              fo.id::text AS source_id,
              fo.created_at
         FROM food_orders fo
         LEFT JOIN food_restaurants fr ON fr.id = fo.restaurant_id
        WHERE fo.customer_id = $1
        ORDER BY fo.created_at DESC
        LIMIT $2`,
      [userId, limit]
    ),
    pool.query(
      `SELECT CONCAT('wallet-', l.id) AS id,
              CONCAT('food_wallet_', l.entry_type) AS source_type,
              COALESCE(l.description, 'Restaurant wallet') AS title,
              COALESCE(fr.display_name, 'OxSteed Food') AS subtitle,
              CASE WHEN l.entry_type IN ('credit', 'refund') THEN l.amount_cents ELSE -l.amount_cents END AS amount_cents,
              UPPER(l.currency_code) AS currency_code,
              'completed' AS status,
              COALESCE(l.reference_id, l.id::text) AS reference,
              l.reference_id AS source_id,
              l.created_at
         FROM food_customer_wallet_ledger l
         LEFT JOIN food_restaurants fr ON fr.id = l.restaurant_id
        WHERE l.customer_id = $1
        ORDER BY l.created_at DESC
        LIMIT $2`,
      [userId, limit]
    ),
    pool.query(
      `SELECT CONCAT('payout-', id) AS id,
              'payout' AS source_type,
              'Withdrawal request' AS title,
              INITCAP(REPLACE(payout_method, '_', ' ')) AS subtitle,
              -amount_cents AS amount_cents,
              UPPER(currency_code) AS currency_code,
              status,
              CONCAT('PO-', id) AS reference,
              id::text AS source_id,
              requested_at AS created_at
         FROM main_app_payout_requests
        WHERE user_id = $1
        ORDER BY requested_at DESC
        LIMIT $2`,
      [userId, limit]
    ),
  ]);

  return queries
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => result.value.rows)
    .map(serializeTransaction)
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, limit);
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

async function queryActivitySupportCases(userId, limit) {
  const { rows } = await pool.query(
    `SELECT t.id,
            t.ticket_number,
            t.subject,
            t.category,
            t.priority,
            t.status,
            t.created_at,
            t.updated_at,
            (SELECT COUNT(*)
               FROM support_messages sm
              WHERE sm.ticket_id = t.id
                AND sm.is_internal = FALSE) AS message_count
       FROM support_tickets t
      WHERE t.user_id = $1
      ORDER BY COALESCE(t.updated_at, t.created_at) DESC
      LIMIT $2`,
    [userId, limit]
  );

  return rows.map((row) => ({
    id: `support-case-${row.id}`,
    source: 'support_case',
    sourceId: String(row.id),
    type: 'support_case',
    title: `Support case #${row.ticket_number || row.id}`,
    subtitle: row.subject || 'Support request',
    detail: `${row.status || 'open'} • ${row.category || 'general'} • ${Number(row.message_count || 0)} messages`,
    icon: row.priority === 'high' || row.priority === 'urgent' ? 'exclamationmark.shield.fill' : 'lifepreserver.fill',
    tintKey: row.priority === 'high' || row.priority === 'urgent' ? 'primary' : 'secondary',
    eventAt: toIso(row.updated_at || row.created_at),
    isUnread: row.status === 'waiting_user',
    actionLabel: 'View Case',
    actionUrl: `/support/my-tickets/${row.id}`,
    canMarkRead: false,
    canDelete: false,
  }));
}

async function queryActivityRestaurantSupportCases(userId, limit) {
  const { rows } = await pool.query(
    `SELECT rsc.id,
            rsc.public_case_number,
            rsc.issue_type,
            rsc.status,
            rsc.priority,
            rsc.title,
            rsc.updated_at,
            rsc.created_at,
            fr.display_name AS restaurant_name,
            (SELECT COUNT(*)
               FROM restaurant_support_case_messages rsm
              WHERE rsm.case_id = rsc.id
                AND rsm.internal_note = FALSE) AS message_count
       FROM restaurant_support_cases rsc
       JOIN food_restaurants fr ON fr.id = rsc.restaurant_id
      WHERE rsc.customer_user_id = $1
        AND rsc.archived_at IS NULL
      ORDER BY COALESCE(rsc.updated_at, rsc.created_at) DESC
      LIMIT $2`,
    [userId, limit]
  );

  return rows.map((row) => ({
    id: `restaurant-support-case-${row.id}`,
    source: 'restaurant_support_case',
    sourceId: String(row.id),
    type: 'support_case',
    title: `Restaurant case ${row.public_case_number || `#${row.id}`}`,
    subtitle: row.restaurant_name || row.title || 'Restaurant support',
    detail: `${row.status || 'open'} • ${String(row.issue_type || 'other').replace(/_/g, ' ')} • ${Number(row.message_count || 0)} messages`,
    icon: row.priority === 'high' || row.priority === 'urgent' ? 'exclamationmark.bubble.fill' : 'lifepreserver.fill',
    tintKey: row.priority === 'high' || row.priority === 'urgent' ? 'primary' : 'secondary',
    eventAt: toIso(row.updated_at || row.created_at),
    isUnread: ['awaiting_customer', 'resolution_offered'].includes(row.status),
    actionLabel: 'View Case',
    actionUrl: `/restaurants/support/cases/${row.id}`,
    canMarkRead: false,
    canDelete: false,
  }));
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
      actionUrl: `/bids/${row.id}`,
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

    const [notifications, bids, foodOrders, bookings, messages, supportCases, restaurantSupportCases] = await Promise.all([
      loadActivitySource('notifications', () => queryActivityNotifications(userId, sourceLimit)),
      loadActivitySource('bids', () => queryActivityBids(userId, sourceLimit)),
      loadActivitySource('foodOrders', () => queryActivityFoodOrders(userId, sourceLimit)),
      loadActivitySource('bookings', () => queryActivityBookings(userId, sourceLimit)),
      loadActivitySource('messages', () => queryActivityMessages(userId, sourceLimit)),
      loadActivitySource('supportCases', () => queryActivitySupportCases(userId, sourceLimit)),
      loadActivitySource('restaurantSupportCases', () => queryActivityRestaurantSupportCases(userId, sourceLimit)),
    ]);

    const sources = [notifications, bids, foodOrders, bookings, messages, supportCases, restaurantSupportCases];
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

exports.getTransactionHistory = async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit, 100, 200);
    const transactions = await queryMainAppTransactions(req.user.id, limit);
    const totalInCents = transactions
      .filter((transaction) => transaction.isCredit)
      .reduce((sum, transaction) => sum + transaction.amountCents, 0);
    const totalOutCents = transactions
      .filter((transaction) => !transaction.isCredit)
      .reduce((sum, transaction) => sum + transaction.amountCents, 0);

    res.json({
      contract: {
        version: 'main-money-transactions-v1',
        generatedAt: new Date().toISOString(),
        dataSource: 'production',
        sources: ['platform_ledger', 'payments', 'food_orders', 'food_customer_wallet_ledger', 'main_app_payout_requests'],
      },
      summary: {
        totalInCents,
        totalOutCents,
        netCents: totalInCents - totalOutCents,
        currencyCode: transactions[0]?.currencyCode || 'USD',
      },
      transactions,
    });
  } catch (err) {
    next(err);
  }
};

exports.getPayoutSummary = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [jobsResult, requestsResult] = await Promise.all([
      pool.query(
        `SELECT
            COALESCE(SUM(CASE WHEN payout_status IN ('earned', 'not_ready') THEN COALESCE(helper_payout_cents, final_price_cents, budget_max_cents, budget_min_cents, 0) ELSE 0 END), 0)::bigint AS available_cents,
            COALESCE(SUM(CASE WHEN payout_status IN ('pending', 'processing') THEN COALESCE(helper_payout_cents, final_price_cents, budget_max_cents, budget_min_cents, 0) ELSE 0 END), 0)::bigint AS pending_cents,
            COALESCE(SUM(CASE WHEN payout_status = 'paid' THEN COALESCE(helper_payout_cents, final_price_cents, budget_max_cents, budget_min_cents, 0) ELSE 0 END), 0)::bigint AS paid_cents,
            COALESCE(MAX(currency_code), 'USD') AS currency_code
           FROM jobs
          WHERE assigned_helper_id = $1
            AND status = 'completed'`,
        [userId]
      ),
      pool.query(
        `SELECT id, amount_cents, currency_code, payout_method, status, note, requested_at, processed_at
           FROM main_app_payout_requests
          WHERE user_id = $1
          ORDER BY requested_at DESC
          LIMIT 25`,
        [userId]
      ),
    ]);

    const row = jobsResult.rows[0] || {};
    res.json({
      contract: { version: 'main-payouts-v1', generatedAt: new Date().toISOString(), dataSource: 'production' },
      summary: {
        availableCents: Number(row.available_cents || 0),
        pendingCents: Number(row.pending_cents || 0),
        paidCents: Number(row.paid_cents || 0),
        currencyCode: normalizeCurrency(row.currency_code),
        minimumWithdrawalCents: 1000,
      },
      requests: requestsResult.rows.map((request) => ({
        id: String(request.id),
        amountCents: Number(request.amount_cents || 0),
        currencyCode: normalizeCurrency(request.currency_code),
        payoutMethod: request.payout_method,
        status: request.status,
        note: request.note || null,
        requestedAt: toIso(request.requested_at),
        processedAt: toIso(request.processed_at),
      })),
    });
  } catch (err) {
    next(err);
  }
};

exports.requestPayout = async (req, res, next) => {
  try {
    res.status(503).json({
      error: {
        code: 'payouts_coming_soon',
        message: 'Platform-managed withdrawals are coming soon. Restaurant credit, pay-at-restaurant, and direct user payment arrangements remain available where clearly labeled.',
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.getReferralDashboard = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT
          u.referral_code,
          COALESCE(u.referrals_count, 0)::int AS referrals_count,
          COALESCE(u.referral_conversions_count, 0)::int AS referral_conversions_count,
          COALESCE(json_agg(
            json_build_object(
              'id', r.id,
              'name', COALESCE(NULLIF(TRIM(r.first_name || ' ' || r.last_name), ''), 'OxSteed member'),
              'joinedAt', r.created_at,
              'status', CASE WHEN r.email_verified THEN 'Rewarded' ELSE 'Joined' END
            )
            ORDER BY r.created_at DESC
          ) FILTER (WHERE r.id IS NOT NULL), '[]') AS referred_users
         FROM users u
         LEFT JOIN users r ON r.referred_by = u.id
        WHERE u.id = $1
        GROUP BY u.id`,
      [req.user.id]
    );

    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    const row = rows[0];
    const appUrl = process.env.APP_URL || process.env.CLIENT_URL || 'https://oxsteed.com';
    const code = row.referral_code || '';
    const rewards = await pool.query(
      `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS earned_cents
         FROM platform_ledger
        WHERE user_id = $1
          AND source_type IN ('referral_credit', 'promo_credit')`,
      [req.user.id]
    );

    res.json({
      referralCode: code,
      shareUrl: `${appUrl}/join?ref=${encodeURIComponent(code)}`,
      friendRewardCents: Number(process.env.REFERRAL_REFEREE_CREDIT_CENTS || 250),
      rewardPerReferralCents: Number(process.env.REFERRAL_REFERRER_CREDIT_CENTS || 500),
      totalEarnedCents: Number(rewards.rows[0]?.earned_cents || 0),
      stats: {
        invited: Number(row.referrals_count || 0),
        joined: Number(row.referral_conversions_count || 0),
      },
      referrals: row.referred_users || [],
    });
  } catch (err) {
    next(err);
  }
};

function serializePromo(row) {
  return {
    id: String(row.voucher_id || row.id || row.code),
    code: row.code,
    title: row.title || row.description || `${row.code} restaurant credit voucher`,
    description: row.description || 'Eligible restaurant-credit food order voucher. Service booking and card checkout promo support is coming soon.',
    discountType: String(row.discount_type || '').includes('percent') ? 'percent' : 'fixed',
    discountValue: Number(row.discount_value || row.discount_amount || 0),
    expiresAt: toIso(row.expires_at || row.end_date),
    category: row.category || 'food',
    applicabilityNote: 'Eligible restaurant-credit food orders only. Service booking and card checkout promo support is coming soon.',
    status: row.voucher_status || row.status || 'active',
    isUsed: ['used', 'revoked'].includes(String(row.voucher_status || '').toLowerCase()),
  };
}

exports.getPromoWallet = async (req, res, next) => {
  try {
    const [available, wallet] = await Promise.all([
      pool.query(
        `SELECT id, code, COALESCE(description, code) AS title, description,
                discount_type,
                CASE WHEN discount_type = 'percentage' THEN discount_amount ELSE discount_amount / 100.0 END AS discount_value,
                end_date, 'food' AS category, status
           FROM discount_codes
          WHERE status = 'active'
            AND (start_date IS NULL OR start_date <= NOW())
            AND (end_date IS NULL OR end_date >= NOW())
          ORDER BY created_at DESC
          LIMIT 50`
      ),
      pool.query(
        `SELECT v.id AS voucher_id, v.code, v.status AS voucher_status, v.redeemed_at,
                d.description AS title, d.description, d.discount_type,
                CASE WHEN d.discount_type = 'percentage' THEN d.discount_amount ELSE d.discount_amount / 100.0 END AS discount_value,
                d.end_date, 'food' AS category
           FROM main_app_user_vouchers v
           LEFT JOIN discount_codes d ON d.id = v.discount_code_id
          WHERE v.user_id = $1
          ORDER BY v.redeemed_at DESC
          LIMIT 50`,
        [req.user.id]
      ),
    ]);

    const walletCodes = new Set(wallet.rows.map((row) => String(row.code).toUpperCase()));
    const promos = [
      ...wallet.rows.map(serializePromo),
      ...available.rows.filter((row) => !walletCodes.has(String(row.code).toUpperCase())).map(serializePromo),
    ];

    res.json({ contract: { version: 'main-promos-v1', generatedAt: new Date().toISOString() }, promos });
  } catch (err) {
    next(err);
  }
};

exports.redeemPromoCode = async (req, res, next) => {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: { code: 'code_required', message: 'Promo code is required.' } });

    const found = await pool.query(
      `SELECT id, code, description, discount_type, discount_amount, end_date
         FROM discount_codes
        WHERE UPPER(code) = $1
          AND status = 'active'
          AND (start_date IS NULL OR start_date <= NOW())
          AND (end_date IS NULL OR end_date >= NOW())
        LIMIT 1`,
      [code]
    );
    if (!found.rows.length) {
      return res.status(404).json({ error: { code: 'invalid_promo', message: 'Invalid or expired promo code.' } });
    }

    const promo = found.rows[0];
    const inserted = await pool.query(
      `INSERT INTO main_app_user_vouchers (user_id, discount_code_id, code, source, status)
       VALUES ($1, $2, $3, 'manual', 'active')
       ON CONFLICT (user_id, code)
       DO UPDATE SET status = CASE WHEN main_app_user_vouchers.status = 'used' THEN main_app_user_vouchers.status ELSE 'active' END
       RETURNING id, code, status AS voucher_status, redeemed_at`,
      [req.user.id, promo.id, promo.code]
    );

    res.status(201).json({
      promo: serializePromo({
        ...promo,
        voucher_id: inserted.rows[0].id,
        voucher_status: inserted.rows[0].voucher_status,
        title: promo.description,
        discount_value: promo.discount_type === 'percentage' ? promo.discount_amount : Number(promo.discount_amount || 0) / 100,
        category: 'food',
      }),
    });
  } catch (err) {
    next(err);
  }
};

exports.getDisputeRefunds = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.source_type, d.source_id, d.transaction_reference, d.reason, d.details, d.refund_method,
              d.requested_refund_cents, d.currency_code, d.status, d.support_ticket_uuid,
              d.opened_at, d.resolved_at,
              t.ticket_number AS support_ticket_number,
              t.status AS support_ticket_status
         FROM main_app_payment_disputes d
         LEFT JOIN support_tickets t ON t.id = d.support_ticket_uuid
        WHERE d.user_id = $1
        ORDER BY d.opened_at DESC
        LIMIT 100`,
      [req.user.id]
    );
    res.json({
      disputes: rows.map((row) => ({
        id: String(row.id),
        sourceType: row.source_type,
        sourceId: row.source_id || null,
        transactionReference: row.transaction_reference || null,
        reason: row.reason,
        details: row.details,
        refundMethod: row.refund_method,
        requestedRefundCents: row.requested_refund_cents === null ? null : Number(row.requested_refund_cents),
        currencyCode: normalizeCurrency(row.currency_code),
        status: row.status,
        supportTicketId: row.support_ticket_uuid ? String(row.support_ticket_uuid) : null,
        supportTicket: row.support_ticket_uuid ? {
          id: String(row.support_ticket_uuid),
          ticketNumber: row.support_ticket_number === null ? null : Number(row.support_ticket_number),
          status: row.support_ticket_status || null,
          actionUrl: `/support/my-tickets/${row.support_ticket_uuid}`,
        } : null,
        openedAt: toIso(row.opened_at),
        resolvedAt: toIso(row.resolved_at),
      })),
    });
  } catch (err) {
    next(err);
  }
};

exports.createDisputeRefund = async (req, res, next) => {
  try {
    const reason = String(req.body.reason || '').trim();
    const details = String(req.body.details || '').trim();
    if (!reason || !details) {
      return res.status(400).json({ error: { code: 'missing_dispute_details', message: 'Reason and details are required.' } });
    }
    const sourceType = String(req.body.sourceType || req.body.source_type || 'other');
    const validSourceTypes = new Set(['job', 'food_order', 'service_booking', 'wallet', 'payment', 'other']);
    const normalizedSourceType = validSourceTypes.has(sourceType) ? sourceType : 'other';
    const sourceId = req.body.sourceId || req.body.source_id || null;
    const transactionReference = req.body.transactionReference || req.body.transaction_reference || null;
    const requestedRefundCents = req.body.requestedRefundCents ?? req.body.requested_refund_cents ?? null;
    const currencyCode = normalizeCurrency(req.body.currencyCode || req.body.currency_code);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: userRows } = await client.query(
        `SELECT first_name, last_name, email FROM users WHERE id = $1`,
        [req.user.id]
      );
      const user = userRows[0] || {};
      const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'OxSteed user';
      const supportTicket = await createLinkedSupportTicket(client, {
        userId: req.user.id,
        name: userName,
        email: user.email || req.user.email || 'support@oxsteed.com',
        subject: `Refund request: ${normalizedSourceType}`,
        category: 'refund_dispute',
        priority: 'normal',
        source: 'direct',
        metadata: {
          source: 'main_app_payment_dispute',
          sourceType: normalizedSourceType,
          sourceId,
          transactionReference,
          refundMethod: req.body.refundMethod || req.body.refund_method || 'original',
          requestedRefundCents,
          currencyCode,
          app: 'oxsteed-main',
        },
        initialMessage: [
          `A refund/dispute request was opened from OxSteed Main.`,
          `Source: ${normalizedSourceType}`,
          sourceId ? `Source ID: ${sourceId}` : null,
          transactionReference ? `Transaction reference: ${transactionReference}` : null,
          `Reason: ${reason}`,
          '',
          details,
        ].filter(Boolean).join('\n'),
      });

      const { rows } = await client.query(
        `INSERT INTO main_app_payment_disputes
          (user_id, source_type, source_id, transaction_reference, reason, details, refund_method,
           requested_refund_cents, currency_code, support_ticket_uuid, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, source_type, source_id, transaction_reference, reason, details, refund_method,
                   requested_refund_cents, currency_code, status, support_ticket_uuid, opened_at, resolved_at`,
        [
          req.user.id,
          normalizedSourceType,
          sourceId,
          transactionReference,
          reason,
          details,
          req.body.refundMethod || req.body.refund_method || 'original',
          requestedRefundCents,
          currencyCode,
          supportTicket.id,
          JSON.stringify({
            client: 'oxsteed-main-ios',
            supportTicketId: supportTicket.id,
            supportTicketNumber: supportTicket.ticket_number,
          }),
        ]
      );
      await client.query('COMMIT');
      res.status(201).json({
        dispute: rows[0],
        ticket: {
          id: supportTicket.id,
          ticketNumber: supportTicket.ticket_number,
          status: supportTicket.status,
        },
      });
    } catch (innerErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw innerErr;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

exports.getReceivedReviews = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.job_id, r.reviewer_id, r.reviewee_id, r.rating, r.comment, r.response,
              r.is_public, r.created_at, u.first_name AS reviewer_first_name, u.last_name AS reviewer_last_name
         FROM reviews r
         LEFT JOIN users u ON u.id = r.reviewer_id
        WHERE r.reviewee_id = $1
          AND r.is_public = TRUE
        ORDER BY r.created_at DESC
        LIMIT 100`,
      [req.user.id]
    );
    res.json({
      reviews: rows.map((row) => ({
        id: String(row.id),
        jobId: row.job_id ? String(row.job_id) : '',
        reviewerId: row.reviewer_id ? String(row.reviewer_id) : '',
        revieweeId: row.reviewee_id ? String(row.reviewee_id) : '',
        rating: Number(row.rating || 0),
        comment: row.comment || '',
        response: row.response || null,
        isPublic: row.is_public !== false,
        createdAt: toIso(row.created_at),
        reviewerFirstName: row.reviewer_first_name || 'Anonymous',
        reviewerLastName: row.reviewer_last_name || '',
      })),
    });
  } catch (err) {
    next(err);
  }
};

exports.getHelperEarningsDashboard = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [summaryResult, jobsResult, weeklyResult, monthlyResult, payoutResult] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(COALESCE(helper_payout_cents, final_price_cents, budget_max_cents, budget_min_cents, 0)), 0)::bigint AS lifetime_cents,
                COALESCE(SUM(CASE WHEN completed_at >= date_trunc('week', NOW()) THEN COALESCE(helper_payout_cents, final_price_cents, budget_max_cents, budget_min_cents, 0) ELSE 0 END), 0)::bigint AS week_cents,
                COALESCE(SUM(CASE WHEN completed_at >= date_trunc('month', NOW()) THEN COALESCE(helper_payout_cents, final_price_cents, budget_max_cents, budget_min_cents, 0) ELSE 0 END), 0)::bigint AS month_cents,
                COUNT(*)::int AS completed_jobs,
                COALESCE(MAX(currency_code), 'USD') AS currency_code
           FROM jobs
          WHERE assigned_helper_id = $1
            AND status = 'completed'`,
        [userId]
      ),
      pool.query(
        `SELECT id, title, completed_at,
                COALESCE(helper_payout_cents, final_price_cents, budget_max_cents, budget_min_cents, 0)::bigint AS amount_cents,
                currency_code, payout_status
           FROM jobs
          WHERE assigned_helper_id = $1
            AND status = 'completed'
          ORDER BY completed_at DESC NULLS LAST, created_at DESC
          LIMIT 50`,
        [userId]
      ),
      pool.query(
        `SELECT date_trunc('week', completed_at)::date AS period,
                COALESCE(SUM(COALESCE(helper_payout_cents, final_price_cents, budget_max_cents, budget_min_cents, 0)), 0)::bigint AS amount_cents
           FROM jobs
          WHERE assigned_helper_id = $1
            AND status = 'completed'
            AND completed_at >= NOW() - INTERVAL '12 weeks'
          GROUP BY 1
          ORDER BY 1 DESC`,
        [userId]
      ),
      pool.query(
        `SELECT date_trunc('month', completed_at)::date AS period,
                COALESCE(SUM(COALESCE(helper_payout_cents, final_price_cents, budget_max_cents, budget_min_cents, 0)), 0)::bigint AS amount_cents
           FROM jobs
          WHERE assigned_helper_id = $1
            AND status = 'completed'
            AND completed_at >= NOW() - INTERVAL '12 months'
          GROUP BY 1
          ORDER BY 1 DESC`,
        [userId]
      ),
      pool.query(
        `SELECT
            COALESCE(SUM(CASE WHEN payout_status IN ('earned', 'not_ready') THEN COALESCE(helper_payout_cents, final_price_cents, budget_max_cents, budget_min_cents, 0) ELSE 0 END), 0)::bigint AS available_cents,
            COALESCE(SUM(CASE WHEN payout_status IN ('pending', 'processing') THEN COALESCE(helper_payout_cents, final_price_cents, budget_max_cents, budget_min_cents, 0) ELSE 0 END), 0)::bigint AS pending_cents,
            COALESCE(SUM(CASE WHEN payout_status = 'paid' THEN COALESCE(helper_payout_cents, final_price_cents, budget_max_cents, budget_min_cents, 0) ELSE 0 END), 0)::bigint AS paid_cents
           FROM jobs
          WHERE assigned_helper_id = $1
            AND status = 'completed'`,
        [userId]
      ),
    ]);

    const summary = summaryResult.rows[0] || {};
    const payout = payoutResult.rows[0] || {};
    res.json({
      contract: { version: 'main-helper-earnings-v1', generatedAt: new Date().toISOString(), dataSource: 'production' },
      summary: {
        lifetimeCents: Number(summary.lifetime_cents || 0),
        weekCents: Number(summary.week_cents || 0),
        monthCents: Number(summary.month_cents || 0),
        completedJobs: Number(summary.completed_jobs || 0),
        currencyCode: normalizeCurrency(summary.currency_code),
        availableCents: Number(payout.available_cents || 0),
        pendingCents: Number(payout.pending_cents || 0),
        paidCents: Number(payout.paid_cents || 0),
      },
      jobs: jobsResult.rows.map((job) => ({
        id: String(job.id),
        title: job.title || 'Completed job',
        completedAt: toIso(job.completed_at),
        amountCents: Number(job.amount_cents || 0),
        currencyCode: normalizeCurrency(job.currency_code),
        payoutStatus: job.payout_status || 'not_ready',
      })),
      weekly: weeklyResult.rows.map((row) => ({ period: toIso(row.period), amountCents: Number(row.amount_cents || 0) })),
      monthly: monthlyResult.rows.map((row) => ({ period: toIso(row.period), amountCents: Number(row.amount_cents || 0) })),
    });
  } catch (err) {
    next(err);
  }
};

exports.getBillingHub = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [profileResult, payoutResult, ownerMethodsResult, payoutMethodsResult, transactions] = await Promise.allSettled([
      pool.query(
        `SELECT id, first_name, last_name, email, stripe_customer_id, country, preferred_currency
           FROM users
          WHERE id = $1
          LIMIT 1`,
        [userId]
      ),
      pool.query(
        `SELECT
            COALESCE(SUM(CASE WHEN payout_status IN ('earned', 'not_ready') THEN COALESCE(helper_payout_cents, final_price_cents, budget_max_cents, budget_min_cents, 0) ELSE 0 END), 0)::bigint AS available_cents,
            COALESCE(SUM(CASE WHEN payout_status IN ('pending', 'processing') THEN COALESCE(helper_payout_cents, final_price_cents, budget_max_cents, budget_min_cents, 0) ELSE 0 END), 0)::bigint AS pending_cents,
            COALESCE(SUM(CASE WHEN payout_status = 'paid' THEN COALESCE(helper_payout_cents, final_price_cents, budget_max_cents, budget_min_cents, 0) ELSE 0 END), 0)::bigint AS paid_cents,
            COALESCE(MAX(currency_code), 'USD') AS currency_code
           FROM jobs
          WHERE assigned_helper_id = $1
            AND status = 'completed'
            AND deleted_at IS NULL`,
        [userId]
      ),
      pool.query(
        `SELECT id, payment_type, payment_identifier, is_active, updated_at
           FROM owner_payment_methods
          WHERE owner_id = $1
          ORDER BY is_active DESC, updated_at DESC`,
        [userId]
      ),
      pool.query(
        `SELECT id, method_type, status, is_primary, account_holder_name, bank_name,
                account_last_four, routing_number_last_four, account_type, paypal_email,
                stripe_account_id, verified_at, updated_at
           FROM payout_methods
          WHERE helper_id = $1
          ORDER BY is_primary DESC, updated_at DESC`,
        [userId]
      ),
      queryMainAppTransactions(userId, 8),
    ]);

    const profile = profileResult.status === 'fulfilled' ? profileResult.value.rows[0] : null;
    const payout = payoutResult.status === 'fulfilled' ? payoutResult.value.rows[0] : {};
    const ownerMethods = ownerMethodsResult.status === 'fulfilled' ? ownerMethodsResult.value.rows : [];
    const payoutMethods = payoutMethodsResult.status === 'fulfilled' ? payoutMethodsResult.value.rows : [];

    const savedPaymentMethods = ownerMethods.map((method) => ({
      id: String(method.id),
      type: method.payment_type,
      label: method.payment_type === 'bank_transfer' ? 'Bank transfer' : method.payment_type.replace(/_/g, ' '),
      detail: method.payment_identifier,
      isActive: method.is_active !== false,
      updatedAt: toIso(method.updated_at),
    }));

    const payoutMethodRows = payoutMethods.map((method) => ({
      id: String(method.id),
      type: method.method_type,
      label: method.method_type === 'bank_account' ? (method.bank_name || 'Bank account') : method.method_type.replace(/_/g, ' '),
      detail: method.method_type === 'bank_account'
        ? `•••• ${method.account_last_four || '----'}`
        : method.paypal_email || method.stripe_account_id || 'Connected payout method',
      status: method.status || 'pending',
      isPrimary: method.is_primary === true,
      verifiedAt: toIso(method.verified_at),
      updatedAt: toIso(method.updated_at),
    }));

    const currencyCode = normalizeCurrency(profile?.preferred_currency || payout?.currency_code);
    res.json({
      contract: { version: 'main-billing-v1', generatedAt: new Date().toISOString(), dataSource: 'production' },
      profile: {
        billingName: [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || 'OxSteed user',
        billingEmail: profile?.email || '',
        country: profile?.country || null,
        currencyCode,
        hasStripeCustomer: Boolean(profile?.stripe_customer_id),
      },
      balances: {
        availableCents: Number(payout?.available_cents || 0),
        pendingCents: Number(payout?.pending_cents || 0),
        paidCents: Number(payout?.paid_cents || 0),
        currencyCode,
      },
      savedPaymentMethods,
      payoutMethods: payoutMethodRows,
      recentTransactions: transactions.status === 'fulfilled' ? transactions.value : [],
      capabilities: {
        secureCardVault: false,
        payoutRequests: false,
        directPaymentInstructions: savedPaymentMethods.length > 0,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.getTaxDocuments = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `WITH earnings AS (
         SELECT EXTRACT(YEAR FROM COALESCE(completed_at, updated_at, created_at))::int AS tax_year,
                COALESCE(MAX(currency_code), 'USD') AS currency_code,
                COALESCE(SUM(COALESCE(helper_payout_cents, final_price_cents, budget_max_cents, budget_min_cents, 0)), 0)::bigint AS earned_cents,
                COUNT(*)::int AS completed_jobs,
                MAX(COALESCE(completed_at, updated_at, created_at)) AS last_activity_at
           FROM jobs
          WHERE assigned_helper_id = $1
            AND status = 'completed'
            AND deleted_at IS NULL
          GROUP BY 1
       )
       SELECT tax_year, currency_code, earned_cents, completed_jobs, last_activity_at
         FROM earnings
        ORDER BY tax_year DESC`,
      [req.user.id]
    );

    const currentYear = new Date().getUTCFullYear();
    const earnedYears = new Set(rows.map((row) => Number(row.tax_year)));
    const yearRows = [
      ...rows,
      ...[currentYear, currentYear - 1].filter((year) => !earnedYears.has(year)).map((year) => ({
        tax_year: year,
        currency_code: 'USD',
        earned_cents: 0,
        completed_jobs: 0,
        last_activity_at: null,
      })),
    ].sort((a, b) => Number(b.tax_year) - Number(a.tax_year));

    const documents = yearRows.flatMap((row) => {
      const earnedCents = Number(row.earned_cents || 0);
      const year = Number(row.tax_year);
      const base = {
        year,
        earnedCents,
        currencyCode: normalizeCurrency(row.currency_code),
        completedJobs: Number(row.completed_jobs || 0),
        lastActivityAt: toIso(row.last_activity_at),
      };
      const annualSummary = {
        id: `summary-${year}`,
        title: 'Annual Earnings Summary',
        type: 'annual_summary',
        status: earnedCents > 0 ? 'available' : 'not_available',
        downloadAvailable: earnedCents > 0,
        ...base,
      };
      const form1099 = {
        id: `1099-${year}`,
        title: '1099 Tax Form',
        type: 'form_1099',
        status: earnedCents >= 60000 ? 'available' : 'not_required',
        downloadAvailable: earnedCents >= 60000,
        ...base,
      };
      return [annualSummary, form1099];
    });

    res.json({
      contract: { version: 'main-tax-documents-v1', generatedAt: new Date().toISOString(), dataSource: 'production' },
      thresholdCents: 60000,
      documents,
    });
  } catch (err) {
    next(err);
  }
};

exports.requestDataExport = async (req, res, next) => {
  try {
    const sections = Array.isArray(req.body.sections) && req.body.sections.length
      ? req.body.sections.map((section) => String(section).trim()).filter(Boolean)
      : ['profile', 'jobs', 'food_orders', 'messages', 'reviews', 'payments'];
    const deliveryEmail = String(req.body.deliveryEmail || req.body.delivery_email || req.user.email || '').trim() || null;

    const { rows } = await pool.query(
      `INSERT INTO main_app_data_export_requests
        (user_id, requested_sections, delivery_email, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING id, status, requested_sections, delivery_email, requested_at, completed_at, expires_at, download_url`,
      [req.user.id, sections, deliveryEmail, JSON.stringify({ client: 'oxsteed-main-ios' })]
    );

    const request = rows[0];
    res.status(201).json({
      exportRequest: {
        id: String(request.id),
        status: request.status,
        sections: request.requested_sections || [],
        deliveryEmail: request.delivery_email || null,
        requestedAt: toIso(request.requested_at),
        completedAt: toIso(request.completed_at),
        expiresAt: toIso(request.expires_at),
        downloadUrl: request.download_url || null,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.createSupportReport = async (req, res, next) => {
  try {
    const category = String(req.body.category || 'general').trim();
    const details = String(req.body.details || req.body.description || '').trim();
    if (!details) {
      return res.status(400).json({ error: { code: 'missing_report_details', message: 'Report details are required.' } });
    }

    const user = await pool.query(
      `SELECT first_name, last_name, email FROM users WHERE id = $1 LIMIT 1`,
      [req.user.id]
    );
    const profile = user.rows[0] || {};
    const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'OxSteed user';
    const email = profile.email || req.user.email || 'support@oxsteed.com';
    const priority = /payment|safety|fraud|charge|refund/i.test(category) ? 'high' : 'normal';
    const subject = `OxSteed Main report: ${category}`;

    const ticketResult = await pool.query(
      `INSERT INTO support_tickets
        (user_id, name, email, subject, category, priority, source, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, 'direct', $7)
       RETURNING id, ticket_number, status, priority, created_at`,
      [
        req.user.id,
        name,
        email,
        subject,
        category.toLowerCase().replace(/\s+/g, '_'),
        priority,
        JSON.stringify({ app: 'oxsteed-main-ios', category }),
      ]
    );
    const ticket = ticketResult.rows[0];

    await pool.query(
      `INSERT INTO support_messages
        (ticket_id, sender_id, sender_name, sender_email, content, is_internal, is_from_admin)
       VALUES ($1, $2, $3, $4, $5, FALSE, FALSE)`,
      [ticket.id, req.user.id, name, email, details]
    );

    res.status(201).json({
      ticket: {
        id: String(ticket.id),
        ticketNumber: Number(ticket.ticket_number),
        status: ticket.status,
        priority: ticket.priority,
        createdAt: toIso(ticket.created_at),
      },
    });
  } catch (err) {
    next(err);
  }
};
