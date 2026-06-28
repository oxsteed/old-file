'use strict';

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const socketService = require('../services/socketService');
const { absoluteUrl } = require('../utils/publicSiteUrl');
const crypto = require('crypto');
const logger = require('../utils/logger');
const notificationService = require('../services/notificationService');
const smsNotificationService = require('../services/smsNotificationService');
const emailService = require('../services/emailService');
const { enqueueKitchenPrinterJobs } = require('../services/restaurantKitchenPrinterService');
const { debitFoodWallet, refundWalletDebitForReference } = require('../services/foodWalletService');
const {
  evaluateOperatingHours,
  normalizeBrandAccentHex,
  normalizeHoursInput,
} = require('../utils/foodOperatingHours');

const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

const VALID_FULFILLMENT = new Set(['pickup', 'dine_in', 'delivery', 'kiosk']);
const VALID_ORDER_SOURCES = new Set(['mobile', 'web', 'kiosk', 'counter', 'tablet']);
const VALID_STATUS = new Set(['received', 'accepted', 'preparing', 'ready', 'completed', 'cancelled', 'refunded']);
const VALID_PAYMENT_STATUS = new Set(['unpaid', 'requires_payment', 'paid', 'failed', 'refunded']);
const PRICE_LEVEL_ALIASES = {
  cheap: 'cheap',
  budget: 'cheap',
  value: 'cheap',
  mid: 'mid',
  moderate: 'mid',
  standard: 'mid',
  expensive: 'expensive',
  premium: 'expensive',
};
const IN_STORE_SOURCES = new Set(['kiosk', 'counter', 'tablet']);
const FOOD_LOYALTY_MIN_REDEEM_POINTS = 100;
const FOOD_LOYALTY_CENTS_PER_POINT = 1;
// Allowed transitions: target status -> statuses it may come from.
const ORDER_TRANSITIONS = {
  accepted: ['received'],
  preparing: ['received', 'accepted'],
  ready: ['received', 'accepted', 'preparing'],
  completed: ['ready'],
  cancelled: ['received', 'accepted', 'preparing', 'ready'],
  refunded: ['completed', 'cancelled'],
};

function hasRestaurantStripeCheckout() {
  return Boolean(stripe && process.env.STRIPE_SECRET_KEY);
}

function isMissingRelationError(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function toTierLabel(value) {
  return String(value || 'new')
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeString(value, max = 255) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function normalizeCountry(value) {
  const raw = normalizeString(value, 2);
  return raw ? raw.toUpperCase() : 'US';
}

function normalizeCurrency(value) {
  const raw = normalizeString(value, 3);
  return raw ? raw.toUpperCase() : 'USD';
}

function normalizePriceLevel(value) {
  const raw = normalizeString(value, 16);
  return PRICE_LEVEL_ALIASES[raw] || 'mid';
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function parseNonNegativeInt(value, fallback = 0) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parseOptionalPositiveInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseOptionalFutureDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeTextArray(value, maxItems = 12) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeString(item, 60))
    .filter(Boolean)
    .slice(0, maxItems);
}

// Restaurant-level dietary capabilities used by the customer dietary filter.
// Canonical values are lowercase + underscore-separated; common variants are
// folded in so older/looser clients still resolve correctly.
const DIETARY_TAG_ALIASES = {
  vegan: 'vegan',
  vegetarian: 'vegetarian',
  veg: 'vegetarian',
  gluten_free: 'gluten_free',
  'gluten-free': 'gluten_free',
  glutenfree: 'gluten_free',
  gf: 'gluten_free',
  halal: 'halal',
};
const ALLOWED_DIETARY_TAGS = new Set(['vegan', 'vegetarian', 'gluten_free', 'halal']);

function normalizeDietaryTags(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  for (const item of value) {
    const key = String(item || '').trim().toLowerCase().replace(/\s+/g, '_');
    const canonical = DIETARY_TAG_ALIASES[key] || key;
    if (ALLOWED_DIETARY_TAGS.has(canonical)) seen.add(canonical);
  }
  return Array.from(seen);
}

function parsePositiveInt(value, fallback = null) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseMoneyCents(value, field = 'priceCents') {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 5000000) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      [field]: 'Must be a non-negative amount in cents',
    });
  }
  return Math.round(n);
}

function safeReturnUrl(value) {
  const raw = normalizeString(value, 1000);
  if (!raw) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) return absoluteUrl(raw);
  return null;
}

function createTrackingToken() {
  return crypto.randomBytes(18).toString('base64url');
}

function attachRestaurantHours(row) {
  if (!row || typeof row !== 'object') return row;
  const hours = evaluateOperatingHours(row.operating_hours, row.timezone);
  const closureUntil = row.temporarily_closed_until ? new Date(row.temporarily_closed_until) : null;
  const isTemporarilyClosed = closureUntil && !Number.isNaN(closureUntil.getTime()) && closureUntil > new Date();
  const acceptsNow = row.is_accepting_orders_now !== false;
  return {
    ...row,
    is_open: hours.isOpen && acceptsNow && !isTemporarilyClosed,
    hours_message: isTemporarilyClosed
      ? `Temporarily closed until ${closureUntil.toISOString()}`
      : hours.message,
    opens_at: hours.opensAt,
    closes_at: hours.closesAt,
  };
}

function normalizeDeliveryAddress(value) {
  if (!value || typeof value !== 'object') return null;
  const line1 = normalizeString(value.line1 || value.line_1 || value.street, 255);
  if (!line1) return null;
  return {
    line1,
    line2: normalizeString(value.line2 || value.line_2, 255),
    city: normalizeString(value.city, 120),
    state: normalizeString(value.state, 120),
    zip: normalizeString(value.postalCode || value.postal_code || value.zip, 40),
    country: normalizeCountry(value.country),
    instructions: normalizeString(value.instructions || value.notes, 500),
    lat: Number.isFinite(Number(value.lat ?? value.latitude)) ? Number(value.lat ?? value.latitude) : null,
    lng: Number.isFinite(Number(value.lng ?? value.longitude)) ? Number(value.lng ?? value.longitude) : null,
  };
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(a));
}

async function resolveFoodPromotionDiscount(client, restaurantId, code, subtotalCents) {
  const normalized = normalizeString(code, 40);
  if (!normalized) return { discountCents: 0, metadata: null, promotionId: null };
  try {
    const { rows } = await client.query(
      `SELECT *
         FROM food_restaurant_promotions
        WHERE restaurant_id = $1
          AND UPPER(code) = UPPER($2)
          AND is_active = TRUE
          AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
          AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
          AND (max_uses IS NULL OR use_count < max_uses)
        LIMIT 1`,
      [restaurantId, normalized]
    );
    const promo = rows[0];
    if (!promo) return { discountCents: 0, metadata: null, promotionId: null };
    if (subtotalCents < Number(promo.min_subtotal_cents || 0)) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        discountCode: `Minimum subtotal not met for promotion ${normalized}`,
      });
    }
    let discountCents = Number(promo.discount_cents || 0);
    if (promo.discount_percent != null) {
      discountCents = Math.max(
        discountCents,
        Math.round(subtotalCents * Number(promo.discount_percent) / 100)
      );
    }
    discountCents = Math.min(subtotalCents, Math.max(0, discountCents));
    return {
      discountCents,
      promotionId: promo.id,
      metadata: {
        code: promo.code,
        label: promo.title,
        amountCents: discountCents,
        promotionId: promo.id,
      },
    };
  } catch (err) {
    if (isMissingRelationError(err)) return { discountCents: 0, metadata: null, promotionId: null };
    throw err;
  }
}

async function maybeCreateDeliveryRunnerTask(client, { order, deliveryAddress, createdBy }) {
  if (order.fulfillment_type !== 'delivery') return null;
  try {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`runner-task:${order.restaurant_id}:${order.id}`]
    );
    const { rows: existingTasks } = await client.query(
      `SELECT *
         FROM restaurant_runner_tasks
        WHERE restaurant_id = $1
          AND food_order_id = $2
          AND task_type = 'Delivery'
        ORDER BY created_at DESC
        LIMIT 1`,
      [order.restaurant_id, order.id]
    );
    if (existingTasks[0]) return existingTasks[0];

    const stopParts = [
      deliveryAddress?.line1,
      deliveryAddress?.city,
    ].filter(Boolean);
    const stopName = stopParts.join(', ') || order.guest_name || 'Delivery stop';
    const { rows: [task] } = await client.query(
      `INSERT INTO restaurant_runner_tasks
         (restaurant_id, food_order_id, order_reference, stop_name, task_type, status,
          route_window, customer_contact_rule, requires_proof, cash_collection_required, created_by)
       VALUES ($1,$2,$3,$4,'Delivery','Queued',$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        order.restaurant_id,
        order.id,
        `#${order.queue_number}`,
        stopName.slice(0, 200),
        'ASAP',
        deliveryAddress?.instructions || 'Deliver to customer address on file.',
        true,
        order.payment_status === 'unpaid',
        createdBy,
      ]
    );
    return task;
  } catch (err) {
    if (isMissingRelationError(err)) return null;
    throw err;
  }
}

function runnerStatusForOrderStatus(status) {
  if (status === 'ready') return 'Ready';
  if (status === 'completed') return 'Completed';
  if (status === 'cancelled' || status === 'refunded') return 'Cancelled';
  return null;
}

async function syncDeliveryRunnerTaskForOrderStatus(client, { order, createdBy }) {
  if (order.fulfillment_type !== 'delivery') return null;
  try {
    const deliveryAddress = order.metadata?.deliveryAddress || order.metadata?.delivery_address || null;
    const runnerTask = ['accepted', 'preparing', 'ready'].includes(order.status)
      ? await maybeCreateDeliveryRunnerTask(client, { order, deliveryAddress, createdBy })
      : null;
    const runnerStatus = runnerStatusForOrderStatus(order.status);
    if (!runnerStatus) return runnerTask;

    const { rows: [updatedTask] } = await client.query(
      `UPDATE restaurant_runner_tasks
          SET status = CASE
                WHEN $3 = 'Ready' AND status IN ('Queued','Assigned') THEN 'Ready'
                WHEN $3 = 'Completed' THEN 'Completed'
                WHEN $3 = 'Cancelled' AND status <> 'Completed' THEN 'Cancelled'
                ELSE status
              END,
              completed_at = CASE WHEN $3 = 'Completed' THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
              updated_at = NOW()
        WHERE restaurant_id = $1
          AND food_order_id = $2
          AND task_type = 'Delivery'
        RETURNING *`,
      [order.restaurant_id, order.id, runnerStatus]
    );
    return updatedTask || runnerTask;
  } catch (err) {
    if (isMissingRelationError(err)) return null;
    throw err;
  }
}

async function earnFoodLoyaltyOnComplete(client, order) {
  if (!order.customer_id) return null;
  const points = Math.max(1, Math.floor(Number(order.total_cents || 0) / 100));
  try {
    const { rows: [account] } = await client.query(
      `INSERT INTO food_loyalty_accounts (restaurant_id, customer_id, points_balance, lifetime_points)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (restaurant_id, customer_id)
       DO UPDATE SET
         points_balance = food_loyalty_accounts.points_balance + $3,
         lifetime_points = food_loyalty_accounts.lifetime_points + $3,
         updated_at = NOW()
       RETURNING *`,
      [order.restaurant_id, order.customer_id, points]
    );
    await client.query(
      `INSERT INTO food_loyalty_ledger (account_id, order_id, delta_points, reason)
       VALUES ($1, $2, $3, 'order_completed')`,
      [account.id, order.id, points]
    );
    return account;
  } catch (err) {
    if (isMissingRelationError(err)) return null;
    throw err;
  }
}

async function resolveFoodLoyaltyRedemption(client, restaurantId, customerId, subtotalCents, existingDiscountCents, requestedPoints) {
  const empty = { pointsRedeemed: 0, discountCents: 0, accountId: null, metadata: null };
  if (!customerId || requestedPoints < FOOD_LOYALTY_MIN_REDEEM_POINTS) return empty;

  const maxDiscountableCents = Math.max(0, subtotalCents - existingDiscountCents);
  if (maxDiscountableCents === 0) return empty;

  try {
    const { rows: [account] } = await client.query(
      `SELECT id, points_balance
         FROM food_loyalty_accounts
        WHERE restaurant_id = $1 AND customer_id = $2
        FOR UPDATE`,
      [restaurantId, customerId]
    );
    if (!account) return empty;

    const balance = Number(account.points_balance || 0);
    const maxPointsBySubtotal = Math.floor(maxDiscountableCents / FOOD_LOYALTY_CENTS_PER_POINT);
    const pointsRedeemed = Math.min(requestedPoints, balance, maxPointsBySubtotal);
    if (pointsRedeemed < FOOD_LOYALTY_MIN_REDEEM_POINTS) return empty;

    const discountCents = pointsRedeemed * FOOD_LOYALTY_CENTS_PER_POINT;
    return {
      pointsRedeemed,
      discountCents,
      accountId: account.id,
      metadata: {
        pointsRedeemed,
        discountCents,
        label: `Loyalty (${pointsRedeemed} pts)`,
      },
    };
  } catch (err) {
    if (isMissingRelationError(err)) return empty;
    throw err;
  }
}

async function deductFoodLoyaltyOnOrder(client, { accountId, orderId, pointsRedeemed }) {
  if (!accountId || pointsRedeemed <= 0) return;
  await client.query(
    `UPDATE food_loyalty_accounts
        SET points_balance = points_balance - $1,
            updated_at = NOW()
      WHERE id = $2`,
    [pointsRedeemed, accountId]
  );
  await client.query(
    `INSERT INTO food_loyalty_ledger (account_id, order_id, delta_points, reason)
     VALUES ($1, $2, $3, 'order_redeem')`,
    [accountId, orderId, -pointsRedeemed]
  );
}

function publicQueueGuestLabel(order) {
  const tableLabel = normalizeString(order.table_label, 80);
  if (tableLabel) {
    return /^table/i.test(tableLabel) ? tableLabel : `Table ${tableLabel}`;
  }
  const guestName = normalizeString(order.guest_name, 140);
  if (guestName) {
    const first = guestName.split(/\s+/)[0];
    return first ? first.slice(0, 24) : 'Guest';
  }
  return 'Guest';
}

function checkoutCompletionHtml({ title, detail, actionLabel, actionHref }) {
  const safeTitle = String(title || 'Payment update');
  const safeDetail = String(detail || '');
  const safeActionLabel = actionLabel ? String(actionLabel) : null;
  const safeActionHref = actionHref ? String(actionHref) : null;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #111827; color: #f9fafb; margin: 0; padding: 32px 20px; }
      main { max-width: 560px; margin: 0 auto; background: #1f2937; border-radius: 18px; padding: 28px; box-shadow: 0 20px 60px rgba(0,0,0,0.35); }
      h1 { margin: 0 0 12px; font-size: 30px; }
      p { margin: 0 0 18px; line-height: 1.5; color: #d1d5db; }
      a { display: inline-block; background: #f97316; color: white; text-decoration: none; padding: 12px 18px; border-radius: 10px; font-weight: 700; }
      small { display: block; margin-top: 18px; color: #9ca3af; }
    </style>
  </head>
  <body>
    <main>
      <h1>${safeTitle}</h1>
      <p>${safeDetail}</p>
      ${safeActionLabel && safeActionHref ? `<a href="${safeActionHref}">${safeActionLabel}</a>` : ''}
      <small>You can return to the OxSteed Restaurants app at any time.</small>
    </main>
  </body>
</html>`;
}

async function syncFoodOrderPaymentStatus(order) {
  if (!order || !order.id || !order.stripe_payment_intent_id || !hasRestaurantStripeCheckout()) {
    return order;
  }
  if (!['requires_payment', 'paid', 'failed'].includes(order.payment_status)) {
    return order;
  }

  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id);
    const mappedStatus = paymentIntent.status === 'succeeded'
      ? 'paid'
      : ['processing', 'requires_capture'].includes(paymentIntent.status)
        ? 'requires_payment'
        : ['canceled'].includes(paymentIntent.status)
          ? 'failed'
          : order.payment_status;

    if (mappedStatus === order.payment_status) {
      return order;
    }

    const { rows: [updated] } = await pool.query(
      `UPDATE food_orders
          SET payment_status = $1,
              updated_at = NOW()
        WHERE id = $2
        RETURNING *`,
      [mappedStatus, order.id]
    );
    if (updated) {
      emitRestaurantOrder(updated.business_id, 'food:order:updated', { order: updated });
      return updated;
    }
    return order;
  } catch (_) {
    return order;
  }
}

async function createFoodCheckoutSession({
  order,
  orderItems,
  customerEmail,
  returnUrl,
}) {
  if (!hasRestaurantStripeCheckout()) {
    throw new AppError('Stripe payments are not configured', 503, 'stripe_not_configured');
  }

  const lineItems = [{
    quantity: 1,
    price_data: {
      currency: String(order.currency_code || 'USD').toLowerCase(),
      unit_amount: Number(order.total_cents || 0),
      product_data: {
        name: `Restaurant order #${order.queue_number}`,
        description: orderItems
          .map((item) => `${item.quantity}x ${item.menuItem.name}`)
          .slice(0, 6)
          .join(', ')
          || 'OxSteed Restaurants order',
      },
    },
  }];

  const successUrlBase = absoluteUrl(`/api/food/orders/${order.id}/checkout/complete`);
  const successUrl = `${successUrlBase}?session_id={CHECKOUT_SESSION_ID}${returnUrl ? `&return_url=${encodeURIComponent(returnUrl)}` : ''}`;
  const cancelUrlBase = absoluteUrl(`/api/food/orders/${order.id}/checkout/cancelled`);
  const cancelUrl = `${cancelUrlBase}${returnUrl ? `?return_url=${encodeURIComponent(returnUrl)}` : ''}`;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: customerEmail || undefined,
    client_reference_id: String(order.id),
    line_items: lineItems,
    metadata: {
      food_order_id: String(order.id),
      restaurant_id: String(order.restaurant_id),
      business_id: String(order.business_id),
      return_url: returnUrl || '',
    },
    payment_intent_data: {
      metadata: {
        food_order_id: String(order.id),
        restaurant_id: String(order.restaurant_id),
        business_id: String(order.business_id),
      },
    },
  });

  const { rows: [updatedOrder] } = await pool.query(
    `UPDATE food_orders
        SET payment_status = 'requires_payment',
            stripe_payment_intent_id = COALESCE($1, stripe_payment_intent_id),
            metadata = jsonb_set(
              jsonb_set(COALESCE(metadata, '{}'::jsonb), '{checkoutSessionId}', to_jsonb($2::text), true),
              '{paymentMode}',
              to_jsonb('pay_now'::text),
              true
            ),
            updated_at = NOW()
      WHERE id = $3
      RETURNING *`,
    [
      typeof session.payment_intent === 'string' ? session.payment_intent : null,
      session.id,
      order.id,
    ]
  );

  return {
    order: updatedOrder || order,
    payment: {
      mode: 'hosted_checkout',
      status: 'requires_payment',
      checkoutUrl: session.url,
      checkoutSessionId: session.id,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
    },
  };
}

exports.getPaymentConfig = async (req, res, next) => {
  try {
    res.json({
      payments: {
        onlineCheckoutAvailable: hasRestaurantStripeCheckout(),
        mode: hasRestaurantStripeCheckout() ? 'hosted_checkout' : 'in_store_only',
      },
    });
  } catch (err) {
    next(err);
  }
};

async function requireRestaurantAccess(userId, restaurantId) {
  const { rows } = await pool.query(
    `SELECT fr.*, b.user_id AS business_owner_id,
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

const RESTAURANT_MANAGE_ROLES = new Set(['owner', 'manager']);

function assertRestaurantManage(restaurant) {
  if (!RESTAURANT_MANAGE_ROLES.has(restaurant.effective_role)) {
    throw new AppError('You do not have permission to manage this restaurant', 403, 'forbidden');
  }
}

function emitRestaurantOrder(businessId, event, payload) {
  try {
    if (businessId) socketService.broadcastToBusinessInbox(businessId, event, payload);
  } catch (_) {
    // Socket delivery is best-effort; API writes are authoritative.
  }
}

// Ping the public restaurant-display screens (TV / kiosk / customer) that an
// order changed, so they refetch instantly instead of waiting for the poll.
// PII-free: only the queue number + status (already public on the board).
function emitRestaurantDisplay(restaurantId, order) {
  try {
    if (!restaurantId) return;
    socketService.broadcastToRestaurantDisplay(restaurantId, 'food:display:changed', {
      restaurantId: String(restaurantId),
      queueNumber: order && order.queue_number != null ? order.queue_number : null,
      status: order ? order.status : null,
    });
  } catch (_) {
    // best-effort; the 5s poll is the fallback.
  }
}

// Notify the customer that their order is ready for pickup.
//
// Picks the right channel for who placed the order:
//   • signed-in customer  → in-app + real-time socket + mobile push + email
//     (all handled by notificationService.sendNotification by userId)
//   • guest with a phone  → SMS
//   • guest with email    → email
//
// Best-effort and fully self-contained: every channel skips gracefully when
// unconfigured and all errors are swallowed, so a missing Twilio/SMTP setup
// (or a slow provider) can never block or fail the merchant's status tap.
async function notifyFoodOrderReady(order, restaurant) {
  try {
    if (!order) return;
    const queue = order.queue_number != null ? `#${order.queue_number}` : '';
    const place = (restaurant && restaurant.display_name) ? restaurant.display_name : 'the restaurant';
    const title = 'Order ready for pickup';
    const body = `Your order ${queue} at ${place} is ready for pickup.`.replace(/\s+/g, ' ').trim();
    const boardUrl = absoluteUrl(`/restaurants/queue/${order.restaurant_id}`);
    const data = {
      orderId: String(order.id),
      restaurantId: String(order.restaurant_id),
      queueNumber: order.queue_number != null ? String(order.queue_number) : null,
      status: 'ready',
    };

    // 1) Signed-in customer — one call covers in-app, socket, push and email.
    if (order.customer_id) {
      await notificationService.sendNotification({
        userId: order.customer_id,
        type: 'food_order_ready',
        title,
        body,
        data,
        action_url: boardUrl,
      });
      logger.info('notifyFoodOrderReady sent', {
        orderId: order.id,
        restaurantId: order.restaurant_id,
        channel: 'notification_service',
        customerId: order.customer_id,
      });
      return;
    }

    // 2) Guest with a phone number — SMS.
    if (order.guest_phone) {
      const smsResult = await smsNotificationService.sendDirectSMS(order.guest_phone, `${body} ${boardUrl}`.trim());
      logger.info('notifyFoodOrderReady sent', {
        orderId: order.id,
        restaurantId: order.restaurant_id,
        channel: 'sms',
        delivered: Boolean(smsResult),
      });
      return;
    }

    // 3) Guest with only an email.
    if (order.guest_email) {
      await emailService.send({
        to: order.guest_email,
        subject: `${title} ${queue}`.trim(),
        html: checkoutCompletionHtml({
          title,
          detail: body,
          actionLabel: 'View the pickup board',
          actionHref: boardUrl,
        }),
      });
      logger.info('notifyFoodOrderReady sent', {
        orderId: order.id,
        restaurantId: order.restaurant_id,
        channel: 'email',
        guestEmail: order.guest_email,
      });
      return;
    }

    logger.info('notifyFoodOrderReady skipped (no reachable guest channel)', {
      orderId: order.id,
      restaurantId: order.restaurant_id,
    });
  } catch (err) {
    logger.warn('notifyFoodOrderReady failed (non-blocking)', { error: err && err.message, orderId: order && order.id });
  }
}

function countryCodeFromAddressCountry(rawCountry) {
  if (!rawCountry) return null;
  const normalized = String(rawCountry).trim();
  if (normalized.length === 2) return normalized.toUpperCase();

  const lower = normalized.toLowerCase();
  if (lower === 'usa') return 'US';
  if (['u.s.', 'united states', 'united states of america'].includes(lower)) return 'US';
  if (['uk', 'u.k.', 'united kingdom', 'great britain', 'england'].includes(lower)) return 'GB';
  if (['uae', 'united arab emirates'].includes(lower)) return 'AE';
  return null;
}

function countryNameFromCode(code, raw) {
  const fallback = (raw || 'USA').trim();
  switch (code?.toUpperCase()) {
  case 'US': return 'USA';
  case 'CA': return 'Canada';
  case 'FR': return 'France';
  case 'HT': return 'Haiti';
  case 'GB': return 'UK';
  case 'AE': return 'UAE';
  case 'NG': return 'Nigeria';
  case 'BR': return 'Brazil';
  case 'DO': return 'Dominican Republic';
  default: return fallback;
  }
}

function countryFlagFromCode(code, raw) {
  switch ((code || '').toUpperCase()) {
  case 'US': return '🇺🇸';
  case 'CA': return '🇨🇦';
  case 'FR': return '🇫🇷';
  case 'HT': return '🇭🇹';
  case 'GB': return '🇬🇧';
  case 'AE': return '🇦🇪';
  case 'NG': return '🇳🇬';
  case 'BR': return '🇧🇷';
  case 'DO': return '🇩🇴';
  default: return '🏳️';
  }
}

function distanceUnitFromCountry(code) {
  switch ((code || '').toUpperCase()) {
  case 'US':
  case 'GB':
    return 'miles';
  default:
    return 'kilometers';
  }
}

function normalizeMarketCurrency(rawCurrency) {
  return normalizeCurrency(rawCurrency);
}

exports.listMarkets = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT NULLIF(trim(fr.address_country), '') AS address_country,
              NULLIF(trim(fr.address_city), '') AS address_city,
              COALESCE(NULLIF(trim(fr.currency_code), ''), 'USD') AS currency_code,
              COUNT(*)::int AS restaurant_count
         FROM food_restaurants fr
        WHERE fr.status = 'active'
          AND NULLIF(trim(fr.address_city), '') IS NOT NULL
          AND NULLIF(trim(fr.address_country), '') IS NOT NULL
        GROUP BY fr.address_country, fr.address_city
        ORDER BY restaurant_count DESC, address_city ASC`,
    );

    const markets = rows.map((row) => {
      const countryCode = countryCodeFromAddressCountry(row.address_country) || 'US';
      return {
        city: row.address_city,
        country: countryNameFromCode(countryCode, row.address_country),
        countryCode,
        currencyCode: normalizeMarketCurrency(row.currency_code),
        distanceUnit: distanceUnitFromCountry(countryCode),
        flag: countryFlagFromCode(countryCode, row.address_country),
        restaurantCount: Number(row.restaurant_count || 0),
      };
    });

    res.json({ markets });
  } catch (err) {
    next(err);
  }
};

exports.listRestaurants = async (req, res, next) => {
  try {
    const limit = Math.min(parsePositiveInt(req.query.limit, 30), 100);
    const offset = Math.max(parsePositiveInt(req.query.offset, 0) || 0, 0);
    const params = [];
    const filters = [
      `fr.status = 'active'`,
      `fr.discovery_status = 'visible'`,
    ];

    const q = normalizeString(req.query.q || req.query.search, 120);
    if (q) {
      params.push(`%${q}%`);
      filters.push(`(fr.display_name ILIKE $${params.length} OR fr.description ILIKE $${params.length} OR EXISTS (
        SELECT 1 FROM unnest(fr.cuisine_tags) tag WHERE tag ILIKE $${params.length}
      ))`);
    }

    const cuisine = normalizeString(req.query.cuisine, 60);
    if (cuisine) {
      params.push(cuisine);
      filters.push(`$${params.length} = ANY(fr.cuisine_tags)`);
    }

    const country = req.query.country ? normalizeCountry(req.query.country) : null;
    if (country) {
      params.push(country);
      filters.push(`fr.address_country = $${params.length}`);
    }

    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const hasGeo = Number.isFinite(lat) && Number.isFinite(lng);
    let distanceSelect = 'NULL::double precision AS distance_km';
    let orderBy = 'fr.is_featured DESC, fr.featured_rank ASC, fr.avg_rating DESC, fr.rating_count DESC, fr.order_count DESC, fr.display_name ASC';
    if (hasGeo) {
      params.push(lat);
      const latIndex = params.length;
      params.push(lng);
      const lngIndex = params.length;
      distanceSelect = `(6371 * acos(LEAST(1, GREATEST(-1,
        cos(radians($${latIndex})) * cos(radians(fr.latitude)) *
        cos(radians(fr.longitude) - radians($${lngIndex})) +
        sin(radians($${latIndex})) * sin(radians(fr.latitude))
      )))) AS distance_km`;
      filters.push('fr.latitude IS NOT NULL AND fr.longitude IS NOT NULL');
      orderBy = 'distance_km ASC, fr.is_featured DESC, fr.featured_rank ASC, fr.avg_rating DESC, fr.display_name ASC';
    }

    const { rows } = await pool.query(
      `SELECT fr.id, fr.business_id, fr.display_name, fr.slug, fr.description,
              fr.cuisine_tags, fr.cover_photo_url, fr.logo_url,
              fr.address_city, fr.address_state, fr.address_country,
              fr.latitude, fr.longitude, fr.currency_code, fr.fulfillment_modes,
              fr.accepts_online_orders, fr.accepts_in_store_orders,
              fr.kitchen_display_enabled, fr.prep_time_min,
              COALESCE(fr.estimated_delivery_minutes, fr.prep_time_min, 30)::int AS estimated_delivery_minutes,
              fr.price_level,
              fr.is_featured, fr.featured_rank, fr.discovery_status,
              fr.is_accepting_orders_now, fr.temporarily_closed_until,
              fr.minimum_order_cents, fr.delivery_fee_cents,
              fr.service_area_radius_meters, fr.order_count,
              fr.last_ordered_at, fr.last_reviewed_at,
              fr.brand_accent_hex, fr.operating_hours, fr.timezone, fr.is_verified,
              fr.dietary_tags,
              COALESCE(fr.avg_rating, 0)::float AS avg_rating,
              COALESCE(fr.rating_count, 0)::int AS review_count,
              COALESCE(fr.rating_count, 0)::int AS total_reviews,
              ${distanceSelect}
         FROM food_restaurants fr
        WHERE ${filters.join(' AND ')}
        ORDER BY ${orderBy}
        LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
      params
    );

    res.json({ restaurants: rows.map(attachRestaurantHours), limit, offset });
  } catch (err) {
    if (!isMissingRelationError(err)) return next(err);
    try {
      const limit = Math.min(parsePositiveInt(req.query.limit, 30), 100);
      const offset = Math.max(parsePositiveInt(req.query.offset, 0) || 0, 0);
      const params = [];
      const filters = [`fr.status = 'active'`];
      const q = normalizeString(req.query.q || req.query.search, 120);
      if (q) {
        params.push(`%${q}%`);
        filters.push(`(fr.display_name ILIKE $${params.length} OR fr.description ILIKE $${params.length} OR EXISTS (
          SELECT 1 FROM unnest(fr.cuisine_tags) tag WHERE tag ILIKE $${params.length}
        ))`);
      }
      const cuisine = normalizeString(req.query.cuisine, 60);
      if (cuisine) {
        params.push(cuisine);
        filters.push(`$${params.length} = ANY(fr.cuisine_tags)`);
      }
      const country = req.query.country ? normalizeCountry(req.query.country) : null;
      if (country) {
        params.push(country);
        filters.push(`fr.address_country = $${params.length}`);
      }
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const hasGeo = Number.isFinite(lat) && Number.isFinite(lng);
      let distanceSelect = 'NULL::double precision AS distance_km';
      let orderBy = 'fr.display_name ASC';
      if (hasGeo) {
        params.push(lat);
        const latIndex = params.length;
        params.push(lng);
        distanceSelect = `(6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians($${latIndex})) * cos(radians(fr.latitude)) *
          cos(radians(fr.longitude) - radians($${params.length})) +
          sin(radians($${latIndex})) * sin(radians(fr.latitude))
        )))) AS distance_km`;
        filters.push('fr.latitude IS NOT NULL AND fr.longitude IS NOT NULL');
        orderBy = 'distance_km ASC, fr.display_name ASC';
      }
      const { rows } = await pool.query(
        `SELECT fr.id, fr.business_id, fr.display_name, fr.slug, fr.description,
                fr.cuisine_tags, fr.cover_photo_url, fr.logo_url,
                fr.address_city, fr.address_state, fr.address_country,
                fr.latitude, fr.longitude, fr.currency_code, fr.fulfillment_modes,
                fr.accepts_online_orders, fr.accepts_in_store_orders,
                fr.kitchen_display_enabled, fr.prep_time_min,
                fr.dietary_tags,
                fr.prep_time_min AS estimated_delivery_minutes,
                'mid'::text AS price_level,
                0::float AS avg_rating, 0::int AS review_count,
                0::int AS total_reviews,
                ${distanceSelect}
           FROM food_restaurants fr
          WHERE ${filters.join(' AND ')}
          ORDER BY ${orderBy}
          LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
        params
      );
      return res.json({ restaurants: rows.map(attachRestaurantHours), limit, offset });
    } catch (retryErr) {
      return next(retryErr);
    }
  }
};

exports.getRestaurant = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId || req.params.id);
    if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');

    const { rows: restaurants } = await pool.query(
      `SELECT * FROM food_restaurants WHERE id = $1 AND status IN ('active', 'paused', 'draft')`,
      [restaurantId]
    );
    const restaurant = restaurants[0];
    if (!restaurant) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');

    try {
      const { rows: ratingRows } = await pool.query(
        `SELECT COALESCE(ROUND(AVG(rating)::numeric, 1), 0)::float AS avg_rating,
                COUNT(*)::int AS review_count
           FROM food_reviews WHERE restaurant_id = $1`,
        [restaurantId]
      );
      restaurant.avg_rating = ratingRows[0]?.avg_rating ?? 0;
      restaurant.review_count = ratingRows[0]?.review_count ?? 0;
    } catch (err) {
      if (!isMissingRelationError(err)) throw err;
      restaurant.avg_rating = 0;
      restaurant.review_count = 0;
    }

    const { rows: categories } = await pool.query(
      `SELECT id, name, description, sort_order
         FROM food_menu_categories
        WHERE restaurant_id = $1 AND is_active = TRUE
        ORDER BY sort_order, name`,
      [restaurantId]
    );
    const { rows: items } = await pool.query(
      `SELECT id, category_id, name, description, image_url, price_cents,
              currency_code, is_available, sort_order, tags, allergens
         FROM food_menu_items
        WHERE restaurant_id = $1
        ORDER BY sort_order, name`,
      [restaurantId]
    );
    const { rows: modifiers } = await pool.query(
      `SELECT mg.id AS group_id, mg.menu_item_id, mg.name AS group_name,
              mg.min_select, mg.max_select, mg.is_required, mg.sort_order AS group_sort_order,
              fm.id AS modifier_id, fm.name AS modifier_name, fm.price_delta_cents,
              fm.is_available, fm.sort_order AS modifier_sort_order
         FROM food_modifier_groups mg
         LEFT JOIN food_modifiers fm ON fm.modifier_group_id = mg.id
        WHERE mg.restaurant_id = $1
        ORDER BY mg.sort_order, fm.sort_order`,
      [restaurantId]
    );

    const modifierGroupsByItem = new Map();
    for (const row of modifiers) {
      if (!modifierGroupsByItem.has(row.menu_item_id)) modifierGroupsByItem.set(row.menu_item_id, new Map());
      const groups = modifierGroupsByItem.get(row.menu_item_id);
      if (!groups.has(row.group_id)) {
        groups.set(row.group_id, {
          id: row.group_id,
          name: row.group_name,
          minSelect: row.min_select,
          maxSelect: row.max_select,
          isRequired: row.is_required,
          options: [],
        });
      }
      if (row.modifier_id) {
        groups.get(row.group_id).options.push({
          id: row.modifier_id,
          name: row.modifier_name,
          priceDeltaCents: row.price_delta_cents,
          isAvailable: row.is_available,
        });
      }
    }

    const itemsByCategory = new Map();
    for (const item of items) {
      const key = item.category_id || 0;
      if (!itemsByCategory.has(key)) itemsByCategory.set(key, []);
      itemsByCategory.get(key).push({
        ...item,
        modifierGroups: Array.from(modifierGroupsByItem.get(item.id)?.values() || []),
      });
    }

    res.json({
      restaurant: attachRestaurantHours(restaurant),
      menu: categories.map((category) => ({
        ...category,
        items: itemsByCategory.get(category.id) || [],
      })),
      uncategorizedItems: itemsByCategory.get(0) || [],
    });
  } catch (err) {
    next(err);
  }
};

exports.createRestaurant = async (req, res, next) => {
  try {
    const name = normalizeString(req.body.displayName || req.body.display_name || req.body.businessName || req.body.business_name, 160);
    if (!name) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        displayName: 'Restaurant name is required',
      });
    }

    const result = await withTransaction(pool, async (client) => {
      let businessId = parsePositiveInt(req.body.businessId || req.body.business_id);
      if (businessId) {
        const { rows } = await client.query(
          `SELECT id FROM businesses WHERE id = $1 AND user_id = $2`,
          [businessId, req.user.id]
        );
        if (!rows[0]) throw new AppError('Business not found', 404, 'business_not_found');
      } else {
        const { rows } = await client.query(
          `INSERT INTO businesses
             (user_id, business_name, business_type, description, website, phone,
              address_street, address_city, address_state, address_zip, address_country,
              is_primary, tax_rate)
           VALUES ($1,$2,'restaurant',$3,$4,$5,$6,$7,$8,$9,$10,FALSE,0)
           RETURNING id`,
          [
            req.user.id,
            name,
            normalizeString(req.body.description, 2000),
            normalizeString(req.body.website, 255),
            normalizeString(req.body.phone, 40),
            normalizeString(req.body.addressStreet || req.body.address_street, 255),
            normalizeString(req.body.addressCity || req.body.address_city, 120),
            normalizeString(req.body.addressState || req.body.address_state, 120),
            normalizeString(req.body.addressZip || req.body.address_zip, 40),
            normalizeCountry(req.body.addressCountry || req.body.address_country),
          ]
        );
        businessId = rows[0].id;
      }

      const { rows: [restaurant] } = await client.query(
        `INSERT INTO food_restaurants
           (business_id, owner_user_id, display_name, cuisine_tags, description, phone, website,
            address_street, address_city, address_state, address_zip, address_country,
            latitude, longitude, timezone, currency_code, fulfillment_modes,
            accepts_online_orders, accepts_in_store_orders, kitchen_display_enabled, status, prep_time_min,
            estimated_delivery_minutes, price_level, dietary_tags,
            is_accepting_orders_now, temporarily_closed_until, minimum_order_cents,
            delivery_fee_cents, service_area_radius_meters)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
         RETURNING *`,
        [
          businessId,
          req.user.id,
          name,
          normalizeTextArray(req.body.cuisineTags || req.body.cuisine_tags),
          normalizeString(req.body.description, 2000),
          normalizeString(req.body.phone, 40),
          normalizeString(req.body.website, 255),
          normalizeString(req.body.addressStreet || req.body.address_street, 255),
          normalizeString(req.body.addressCity || req.body.address_city, 120),
          normalizeString(req.body.addressState || req.body.address_state, 120),
          normalizeString(req.body.addressZip || req.body.address_zip, 40),
          normalizeCountry(req.body.addressCountry || req.body.address_country),
          Number.isFinite(Number(req.body.latitude)) ? Number(req.body.latitude) : null,
          Number.isFinite(Number(req.body.longitude)) ? Number(req.body.longitude) : null,
          normalizeString(req.body.timezone, 80) || 'UTC',
          normalizeCurrency(req.body.currencyCode || req.body.currency_code),
          normalizeTextArray(req.body.fulfillmentModes || req.body.fulfillment_modes, 4).filter((mode) => VALID_FULFILLMENT.has(mode)),
          req.body.acceptsOnlineOrders !== false,
          req.body.acceptsInStoreOrders !== false,
          req.body.kitchenDisplayEnabled !== false,
          req.body.status === 'active' ? 'active' : 'draft',
          parsePositiveInt(req.body.prepTimeMin || req.body.prep_time_min, 15),
          parsePositiveInt(req.body.estimatedDeliveryMinutes || req.body.estimated_delivery_minutes, parsePositiveInt(req.body.prepTimeMin || req.body.prep_time_min, 15)),
          normalizePriceLevel(req.body.priceLevel || req.body.price_level),
          normalizeDietaryTags(req.body.dietaryTags || req.body.dietary_tags),
          normalizeBoolean(req.body.isAcceptingOrdersNow ?? req.body.is_accepting_orders_now, true),
          parseOptionalFutureDate(req.body.temporarilyClosedUntil ?? req.body.temporarily_closed_until),
          parseNonNegativeInt(req.body.minimumOrderCents ?? req.body.minimum_order_cents, 0),
          parseNonNegativeInt(req.body.deliveryFeeCents ?? req.body.delivery_fee_cents, 0),
          parseOptionalPositiveInt(req.body.serviceAreaRadiusMeters ?? req.body.service_area_radius_meters),
        ]
      );
      return restaurant;
    }, 'food_create_restaurant');

    res.status(201).json({ restaurant: result });
  } catch (err) {
    next(err);
  }
};

exports.createMenuCategory = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertRestaurantManage(restaurant);
    const name = normalizeString(req.body.name, 120);
    if (!name) throw new AppError('Validation failed', 400, 'validation_failed', { name: 'Name is required' });

    const { rows: [category] } = await pool.query(
      `INSERT INTO food_menu_categories (restaurant_id, name, description, sort_order, is_active)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [
        restaurantId,
        name,
        normalizeString(req.body.description, 1000),
        Number.parseInt(req.body.sortOrder || req.body.sort_order || 0, 10) || 0,
        req.body.isActive !== false && req.body.is_active !== false,
      ]
    );
    res.status(201).json({ category });
  } catch (err) {
    next(err);
  }
};

exports.createMenuItem = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertRestaurantManage(restaurant);
    const name = normalizeString(req.body.name, 160);
    if (!name) throw new AppError('Validation failed', 400, 'validation_failed', { name: 'Name is required' });

    const priceCents = parseMoneyCents(req.body.priceCents ?? req.body.price_cents, 'priceCents');
    const { rows: [item] } = await pool.query(
      `INSERT INTO food_menu_items
         (restaurant_id, category_id, name, description, image_url, price_cents,
          currency_code, is_available, manual_available, inventory_available,
          inventory_availability_state, sort_order, tags, allergens)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,TRUE,'available',$9,$10,$11)
       RETURNING *`,
      [
        restaurantId,
        parsePositiveInt(req.body.categoryId || req.body.category_id),
        name,
        normalizeString(req.body.description, 2000),
        normalizeString(req.body.imageUrl || req.body.image_url, 1000),
        priceCents,
        normalizeCurrency(req.body.currencyCode || req.body.currency_code || restaurant.currency_code),
        req.body.isAvailable !== false && req.body.is_available !== false,
        Number.parseInt(req.body.sortOrder || req.body.sort_order || 0, 10) || 0,
        normalizeTextArray(req.body.tags, 20),
        normalizeTextArray(req.body.allergens, 20),
      ]
    );
    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
};

exports.createOrder = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId || req.body.restaurantId || req.body.restaurant_id);
    if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    const paymentMode = normalizeString(req.body.paymentMode || req.body.payment_mode, 24) || 'pay_at_counter';
    if (!['pay_at_counter', 'pay_now', 'wallet_credit'].includes(paymentMode)) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        paymentMode: 'Must be pay_at_counter, pay_now, or wallet_credit',
      });
    }

    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (items.length === 0) {
      throw new AppError('Validation failed', 400, 'validation_failed', { items: 'At least one item is required' });
    }

    const clientOrderId = normalizeString(req.body.clientOrderId || req.body.client_order_id, 120);

    const createdOrder = await withTransaction(pool, async (client) => {
      if (clientOrderId) {
        const { rows: existingOrders } = await client.query(
          `SELECT * FROM food_orders
            WHERE restaurant_id = $1 AND metadata->>'clientOrderId' = $2
            LIMIT 1`,
          [restaurantId, clientOrderId]
        );
        if (existingOrders[0]) {
          const { rows: restaurants } = await client.query(
            `SELECT * FROM food_restaurants WHERE id = $1`,
            [restaurantId]
          );
          const existing = existingOrders[0];
          return {
            order: existing,
            restaurant: restaurants[0],
            trackingToken: existing.metadata?.trackingToken || existing.metadata?.tracking_token || null,
            replayed: true,
          };
        }
      }

      // FOR UPDATE serializes concurrent orders for the same restaurant so the
      // per-day queue number below cannot be duplicated under load.
      const { rows: restaurants } = await client.query(
        `SELECT * FROM food_restaurants WHERE id = $1 AND status = 'active' FOR UPDATE`,
        [restaurantId]
      );
      const restaurant = restaurants[0];
      if (!restaurant) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
      const requestedSource = normalizeString(req.body.orderSource || req.body.order_source, 24) || 'mobile';
      const isInStore = IN_STORE_SOURCES.has(requestedSource);
      if (isInStore ? !restaurant.accepts_in_store_orders : !restaurant.accepts_online_orders) {
        throw new AppError('Restaurant is not accepting orders from this channel', 409, 'restaurant_not_accepting_orders');
      }
      if (!isInStore) {
        const hoursStatus = evaluateOperatingHours(restaurant.operating_hours, restaurant.timezone);
        if (!hoursStatus.isOpen) {
          throw new AppError(
            hoursStatus.message || 'Restaurant is closed',
            409,
            'restaurant_closed',
            { hoursMessage: hoursStatus.message, opensAt: hoursStatus.opensAt }
          );
        }
      }

      const ids = items.map((item) => parsePositiveInt(item.menuItemId || item.menu_item_id)).filter(Boolean);
      const { rows: menuRows } = await client.query(
        `SELECT id, name, price_cents, currency_code, is_available
           FROM food_menu_items
          WHERE restaurant_id = $1 AND id = ANY($2::bigint[])`,
        [restaurantId, ids]
      );
      const menuById = new Map(menuRows.map((row) => [Number(row.id), row]));

      const modifierIds = items.flatMap((item) => Array.isArray(item.modifierIds || item.modifier_ids) ? (item.modifierIds || item.modifier_ids) : [])
        .map((id) => parsePositiveInt(id))
        .filter(Boolean);
      const { rows: modifierRows } = modifierIds.length
        ? await client.query(
          `SELECT fm.id, fm.name, fm.price_delta_cents, fm.is_available
             FROM food_modifiers fm
             JOIN food_modifier_groups mg ON mg.id = fm.modifier_group_id
            WHERE mg.restaurant_id = $1 AND fm.id = ANY($2::bigint[])`,
          [restaurantId, modifierIds]
        )
        : { rows: [] };
      const modifierById = new Map(modifierRows.map((row) => [Number(row.id), row]));

      const normalizedItems = items.map((item, index) => {
        const menuItemId = parsePositiveInt(item.menuItemId || item.menu_item_id);
        const menuItem = menuById.get(menuItemId);
        if (!menuItem || !menuItem.is_available) {
          throw new AppError('Validation failed', 400, 'validation_failed', {
            [`items.${index}.menuItemId`]: 'Menu item is unavailable',
          });
        }
        const quantity = Math.min(parsePositiveInt(item.quantity, 1), 99);
        const modifiers = (Array.isArray(item.modifierIds || item.modifier_ids) ? (item.modifierIds || item.modifier_ids) : [])
          .map((id) => modifierById.get(parsePositiveInt(id)))
          .filter((modifier) => modifier && modifier.is_available);
        const modifierTotal = modifiers.reduce((sum, modifier) => sum + Number(modifier.price_delta_cents || 0), 0);
        const lineTotal = (Number(menuItem.price_cents) + modifierTotal) * quantity;
        return {
          menuItem,
          quantity,
          modifiers,
          modifierTotal,
          lineTotal,
          specialInstructions: normalizeString(item.specialInstructions || item.special_instructions, 500),
        };
      });

      const subtotal = normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0);
      const fulfillmentType = normalizeString(req.body.fulfillmentType || req.body.fulfillment_type, 24) || 'pickup';
      const orderSource = normalizeString(req.body.orderSource || req.body.order_source, 24) || 'mobile';
      if (!VALID_FULFILLMENT.has(fulfillmentType)) {
        throw new AppError('Validation failed', 400, 'validation_failed', { fulfillmentType: 'Unsupported fulfillment type' });
      }
      if (paymentMode === 'wallet_credit' && fulfillmentType !== 'delivery') {
        throw new AppError('Wallet credit is only available for delivery orders', 409, 'wallet_credit_delivery_only');
      }
      if (!Array.isArray(restaurant.fulfillment_modes) || !restaurant.fulfillment_modes.includes(fulfillmentType)) {
        throw new AppError('This fulfillment mode is not available', 409, 'fulfillment_mode_unavailable');
      }
      if (!VALID_ORDER_SOURCES.has(orderSource)) {
        throw new AppError('Validation failed', 400, 'validation_failed', { orderSource: 'Unsupported order source' });
      }

      let deliveryAddress = null;
      let deliveryFeeCents = 0;
      if (fulfillmentType === 'delivery') {
        deliveryAddress = normalizeDeliveryAddress(req.body.deliveryAddress || req.body.delivery_address);
        if (!deliveryAddress) {
          throw new AppError('Validation failed', 400, 'validation_failed', {
            deliveryAddress: 'Delivery address is required for delivery orders',
          });
        }
        if (Number(restaurant.delivery_radius_meters || 0) > 0) {
          if (![restaurant.latitude, restaurant.longitude, deliveryAddress.lat, deliveryAddress.lng]
            .every((coordinate) => Number.isFinite(Number(coordinate)))) {
            throw new AppError('Delivery coordinates are required to verify the delivery area', 400, 'delivery_coordinates_required');
          }
          const deliveryDistanceMeters = distanceMeters(
            Number(restaurant.latitude),
            Number(restaurant.longitude),
            Number(deliveryAddress.lat),
            Number(deliveryAddress.lng)
          );
          if (deliveryDistanceMeters > Number(restaurant.delivery_radius_meters)) {
            throw new AppError('Delivery address is outside this restaurant\'s delivery area', 409, 'outside_delivery_area', {
              deliveryDistanceMeters: Math.round(deliveryDistanceMeters),
              deliveryRadiusMeters: Number(restaurant.delivery_radius_meters),
            });
          }
          deliveryAddress.distanceMeters = Math.round(deliveryDistanceMeters);
        }
        const settings = restaurant.settings && typeof restaurant.settings === 'object' ? restaurant.settings : {};
        deliveryFeeCents = parseMoneyCents(
          settings.deliveryFeeCents ?? settings.delivery_fee_cents ?? 0,
          'deliveryFeeCents'
        );
      }

      const tip = parseMoneyCents(req.body.tipCents ?? req.body.tip_cents ?? 0, 'tipCents');
      let discount = parseMoneyCents(req.body.discountCents ?? req.body.discount_cents ?? 0, 'discountCents');
      const discountCode = normalizeString(req.body.discountCode || req.body.discount_code, 40);
      let discountLabel = normalizeString(req.body.discountLabel || req.body.discount_label, 120);
      let promotionId = null;
      if (discountCode) {
        const promoResult = await resolveFoodPromotionDiscount(client, restaurantId, discountCode, subtotal);
        if (promoResult.discountCents > 0) {
          discount = promoResult.discountCents;
          discountLabel = promoResult.metadata?.label || discountLabel;
          promotionId = promoResult.promotionId;
        }
      }

      let loyaltyPointsRedeemed = 0;
      let loyaltyRedemption = null;
      let loyaltyAccountId = null;
      const requestedLoyaltyPoints = parsePositiveInt(
        req.body.loyaltyPointsToRedeem ?? req.body.loyalty_points_to_redeem,
        0
      ) || 0;
      if (requestedLoyaltyPoints > 0 && req.user?.id) {
        const loyaltyResult = await resolveFoodLoyaltyRedemption(
          client,
          restaurantId,
          req.user.id,
          subtotal,
          discount,
          requestedLoyaltyPoints
        );
        if (loyaltyResult.discountCents > 0) {
          loyaltyPointsRedeemed = loyaltyResult.pointsRedeemed;
          loyaltyRedemption = loyaltyResult.metadata;
          loyaltyAccountId = loyaltyResult.accountId;
          discount += loyaltyResult.discountCents;
          if (!discountLabel) discountLabel = loyaltyResult.metadata?.label || null;
        }
      }

      const taxableSubtotal = Math.max(0, subtotal - discount);
      const taxRateBps = Math.max(0, Math.min(10000, Number(restaurant.tax_rate_bps || 0)));
      const serviceFeeBps = Math.max(0, Math.min(10000, Number(restaurant.service_fee_bps || 0)));
      const tax = Math.round(taxableSubtotal * taxRateBps / 10000);
      const serviceFeeCents = Math.round(taxableSubtotal * serviceFeeBps / 10000);
      const total = Math.max(0, taxableSubtotal + tax + serviceFeeCents + tip + deliveryFeeCents);

      const { rows: queueRows } = await client.query(
        `SELECT COALESCE(MAX(queue_number), 0) + 1 AS next_queue
           FROM food_orders
          WHERE restaurant_id = $1 AND created_at::date = CURRENT_DATE`,
        [restaurantId]
      );
      const queueNumber = Number(queueRows[0]?.next_queue || 1);

      const trackingToken = createTrackingToken();
      const discountMetadata = discount > 0
        ? {
          code: discountCode,
          label: discountLabel,
          amountCents: discount,
          ...(promotionId ? { promotionId } : {}),
          ...(loyaltyRedemption ? { loyaltyRedemption } : {}),
        }
        : null;
      const metadata = req.body.metadata && typeof req.body.metadata === 'object'
        ? {
          ...req.body.metadata,
          trackingToken,
          paymentMode,
          ...(clientOrderId ? { clientOrderId } : {}),
          ...(discountMetadata ? { posDiscount: discountMetadata, promotion: discountMetadata } : {}),
          ...(loyaltyRedemption ? { loyaltyRedemption } : {}),
          ...(deliveryAddress ? { deliveryAddress, deliveryFeeCents } : {}),
          pricing: { taxRateBps, serviceFeeBps, taxCents: tax, serviceFeeCents },
        }
        : {
          trackingToken,
          paymentMode,
          ...(clientOrderId ? { clientOrderId } : {}),
          ...(discountMetadata ? { posDiscount: discountMetadata, promotion: discountMetadata } : {}),
          ...(loyaltyRedemption ? { loyaltyRedemption } : {}),
          ...(deliveryAddress ? { deliveryAddress, deliveryFeeCents } : {}),
          pricing: { taxRateBps, serviceFeeBps, taxCents: tax, serviceFeeCents },
        };

      const { rows: [created] } = await client.query(
        `INSERT INTO food_orders
           (restaurant_id, business_id, customer_id, guest_name, guest_phone, guest_email,
            order_source, fulfillment_type, payment_status, subtotal_cents, tax_cents,
            service_fee_cents, delivery_fee_cents, tax_rate_bps, service_fee_bps,
            tip_cents, discount_cents, total_cents, currency_code, table_label,
            queue_number, promised_at, notes, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW() + ($22 || ' minutes')::interval,$23,$24)
         RETURNING *`,
        [
          restaurantId,
          restaurant.business_id,
          req.user?.id || null,
          normalizeString(req.body.guestName || req.body.guest_name, 140),
          normalizeString(req.body.guestPhone || req.body.guest_phone, 40),
          normalizeString(req.body.guestEmail || req.body.guest_email, 255),
          orderSource,
          fulfillmentType,
          paymentMode === 'wallet_credit' ? 'paid' : 'unpaid',
          subtotal,
          tax,
          serviceFeeCents,
          deliveryFeeCents,
          taxRateBps,
          serviceFeeBps,
          tip,
          discount,
          total,
          normalizeCurrency(restaurant.currency_code),
          normalizeString(req.body.tableLabel || req.body.table_label, 80),
          queueNumber,
          restaurant.prep_time_min || 15,
          normalizeString(req.body.notes, 1000),
          metadata,
        ]
      );

      for (const normalized of normalizedItems) {
        const { rows: [orderItem] } = await client.query(
          `INSERT INTO food_order_items
             (order_id, menu_item_id, item_name, quantity, unit_price_cents,
              modifier_total_cents, line_total_cents, special_instructions)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id`,
          [
            created.id,
            normalized.menuItem.id,
            normalized.menuItem.name,
            normalized.quantity,
            normalized.menuItem.price_cents,
            normalized.modifierTotal,
            normalized.lineTotal,
            normalized.specialInstructions,
          ]
        );
        for (const modifier of normalized.modifiers) {
          await client.query(
            `INSERT INTO food_order_item_modifiers
               (order_item_id, modifier_id, modifier_name, price_delta_cents)
             VALUES ($1,$2,$3,$4)`,
            [orderItem.id, modifier.id, modifier.name, modifier.price_delta_cents]
          );
        }
      }

      if (paymentMode === 'wallet_credit') {
        if (!req.user?.id) {
          throw new AppError('Authentication required', 401, 'authentication_required');
        }
        await debitFoodWallet(client, {
          restaurantId,
          customerId: req.user.id,
          currencyCode: normalizeCurrency(restaurant.currency_code),
          amountCents: total,
          description: `Order #${created.id} · Delivery`,
          referenceType: 'food_order',
          referenceId: String(created.id),
          idempotencyKey: `food-order:${created.id}:wallet-credit`,
          createdByUserId: req.user.id,
          metadata: {
            orderId: created.id,
            fulfillmentType,
            orderSource,
          },
        });
      }

      const printerJobs = await enqueueKitchenPrinterJobs(client, {
        restaurantId,
        orderId: created.id,
        createdBy: req.user?.id || null,
      });

      if (promotionId) {
        await client.query(
          `UPDATE food_restaurant_promotions
              SET use_count = use_count + 1, updated_at = NOW()
            WHERE id = $1 AND restaurant_id = $2`,
          [promotionId, restaurantId]
        );
      }

      if (loyaltyPointsRedeemed > 0 && loyaltyAccountId) {
        await deductFoodLoyaltyOnOrder(client, {
          accountId: loyaltyAccountId,
          orderId: created.id,
          pointsRedeemed: loyaltyPointsRedeemed,
        });
      }

      const runnerTask = await maybeCreateDeliveryRunnerTask(client, {
        order: created,
        deliveryAddress,
        createdBy: req.user?.id || null,
      });

      return {
        order: created,
        restaurant,
        normalizedItems,
        trackingToken,
        replayed: false,
        runnerTask,
        printerJobs,
      };
    }, 'food_create_order');

    let order = createdOrder.order;
    let payment = null;
    if (!createdOrder.replayed && paymentMode === 'pay_now') {
      try {
        const paymentResult = await createFoodCheckoutSession({
          order,
          orderItems: createdOrder.normalizedItems,
          customerEmail: normalizeString(req.user?.email || req.body.guestEmail || req.body.guest_email, 255),
          returnUrl: safeReturnUrl(req.body.returnUrl || req.body.return_url),
        });
        order = paymentResult.order;
        payment = paymentResult.payment;
      } catch (paymentErr) {
        payment = {
          mode: 'hosted_checkout',
          status: 'failed',
          error: paymentErr.message || 'Unable to start online checkout',
        };
      }
    }

    if (!createdOrder.replayed) {
      emitRestaurantOrder(order.business_id, 'food:order:created', { order });
      emitRestaurantDisplay(order.restaurant_id, order);
    }
    const statusCode = createdOrder.replayed ? 200 : 201;
    res.status(statusCode).json({
      order,
      payment,
      trackingToken: createdOrder.trackingToken,
      replayed: Boolean(createdOrder.replayed),
      runnerTask: createdOrder.runnerTask || null,
    });
  } catch (err) {
    next(err);
  }
};

exports.listRestaurantOrders = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const status = normalizeString(req.query.status, 24);
    const params = [restaurantId];
    let filter = '';
    if (status && VALID_STATUS.has(status)) {
      params.push(status);
      filter = `AND fo.status = $${params.length}`;
    } else if (req.query.active === '1' || req.query.active === 'true') {
      // Kitchen-display polling feed: only today's in-flight orders.
      filter = `AND fo.status IN ('received','accepted','preparing','ready')
                AND fo.created_at::date = CURRENT_DATE`;
    }
    const { rows } = await pool.query(
      `SELECT fo.*,
              COALESCE(json_agg(json_build_object(
                'id', foi.id,
                'itemName', foi.item_name,
                'quantity', foi.quantity,
                'lineTotalCents', foi.line_total_cents,
                'specialInstructions', foi.special_instructions
              ) ORDER BY foi.id) FILTER (WHERE foi.id IS NOT NULL), '[]') AS items
         FROM food_orders fo
         LEFT JOIN food_order_items foi ON foi.order_id = fo.id
        WHERE fo.restaurant_id = $1 ${filter}
        GROUP BY fo.id
        ORDER BY
          CASE fo.status
            WHEN 'received' THEN 1
            WHEN 'accepted' THEN 2
            WHEN 'preparing' THEN 3
            WHEN 'ready' THEN 4
            ELSE 5
          END,
          fo.created_at ASC
        LIMIT 100`,
      params
    );
    const orders = [];
    for (const row of rows) {
      orders.push(await syncFoodOrderPaymentStatus(row));
    }
    res.json({ orders });
  } catch (err) {
    next(err);
  }
};

exports.updateOrderStatus = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const orderId = parsePositiveInt(req.params.orderId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const status = normalizeString(req.body.status, 24);
    if (!VALID_STATUS.has(status) || !ORDER_TRANSITIONS[status]) {
      throw new AppError('Validation failed', 400, 'validation_failed', { status: 'Unsupported order status' });
    }
    if (status === 'completed') {
      const { rows: [deliveryOrder] } = await pool.query(
        `SELECT fulfillment_type FROM food_orders WHERE id = $1 AND restaurant_id = $2`,
        [orderId, restaurantId]
      );
      if (!deliveryOrder) throw new AppError('Order not found', 404, 'order_not_found');
      if (deliveryOrder.fulfillment_type === 'delivery') {
        throw new AppError(
          'Complete delivery orders through Runner handoff or proof submission',
          409,
          'runner_handoff_required'
        );
      }
    }

    const timestampColumn = {
      accepted: 'accepted_at',
      ready: 'ready_at',
      completed: 'completed_at',
      cancelled: 'cancelled_at',
      refunded: 'cancelled_at',
    }[status];

    const transitionResult = await withTransaction(pool, async (client) => {
      const { rows: [order] } = await client.query(
        `UPDATE food_orders
            SET status = $1,
                ${timestampColumn ? `${timestampColumn} = COALESCE(${timestampColumn}, NOW()),` : ''}
                payment_status = CASE
                  WHEN $1 IN ('cancelled', 'refunded')
                    AND COALESCE(metadata->>'paymentMode', '') = 'wallet_credit'
                    AND payment_status = 'paid'
                    THEN 'refunded'
                  ELSE payment_status
                END,
                updated_at = NOW()
          WHERE id = $2 AND restaurant_id = $3 AND status = ANY($4::text[])
          RETURNING *`,
        [status, orderId, restaurantId, ORDER_TRANSITIONS[status]]
      );
      if (!order) {
        const { rows: existing } = await client.query(
          `SELECT status FROM food_orders WHERE id = $1 AND restaurant_id = $2`,
          [orderId, restaurantId]
        );
        if (!existing[0]) throw new AppError('Order not found', 404, 'order_not_found');
        throw new AppError(
          `Cannot move order from '${existing[0].status}' to '${status}'`,
          409,
          'illegal_state_transition'
        );
      }

      let walletRefund = null;
      const paymentMode = order.metadata && typeof order.metadata === 'object'
        ? order.metadata.paymentMode || order.metadata.payment_mode || null
        : null;
      if (['cancelled', 'refunded'].includes(status) && paymentMode === 'wallet_credit' && order.customer_id) {
        const refundResult = await refundWalletDebitForReference(client, {
          restaurantId,
          customerId: order.customer_id,
          currencyCode: normalizeCurrency(order.currency_code),
          orderReferenceId: String(order.id),
          description: `Refund for order #${order.queue_number || order.id}`,
          createdByUserId: req.user?.id || null,
          correlationId: `food-order-status:${order.id}:${status}`,
          actorType: 'restaurant_staff',
          metadata: {
            orderId: order.id,
            orderStatus: status,
            restaurantId,
          },
        });
        walletRefund = refundResult.refunded ? refundResult.entry : null;
      }

      return { order, walletRefund };
    }, 'food_update_order_status');
    const order = transitionResult.order;

    emitRestaurantOrder(order.business_id, 'food:order:updated', { order });
    emitRestaurantDisplay(order.restaurant_id, order);

    const runnerTask = await syncDeliveryRunnerTaskForOrderStatus(pool, {
      order,
      createdBy: req.user?.id || null,
    });

    // When the kitchen marks an order ready, tell the customer (best-effort,
    // fire-and-forget so a slow SMS/email provider never delays this response).
    if (status === 'ready') {
      notifyFoodOrderReady(order, restaurant);
    }
    if (status === 'completed') {
      await withTransaction(pool, async (client) => {
        await earnFoodLoyaltyOnComplete(client, order);
      }, 'food_loyalty_earn');
    }

    res.json({ order, runnerTask, walletRefund: transitionResult.walletRefund || null });
  } catch (err) {
    next(err);
  }
};

exports.updateOrderPayment = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const orderId = parsePositiveInt(req.params.orderId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const paymentStatus = normalizeString(req.body.paymentStatus || req.body.payment_status, 24);
    if (!VALID_PAYMENT_STATUS.has(paymentStatus)) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        paymentStatus: 'Must be one of unpaid, requires_payment, paid, failed, refunded',
      });
    }
    const { rows: [order] } = await pool.query(
      `SELECT id FROM food_orders WHERE id = $1 AND restaurant_id = $2`,
      [orderId, restaurantId]
    );
    if (!order) throw new AppError('Order not found', 404, 'order_not_found');
    throw new AppError(
      'Record payments and refunds through the ledger-backed POS payment endpoints',
      409,
      'payment_transaction_required',
      {
        createPaymentPath: `/api/restaurants/${restaurantId}/pos/orders/${orderId}/payments`,
        paymentStatusPath: `/api/restaurants/${restaurantId}/pos/payments/:paymentId`,
      }
    );
  } catch (err) {
    next(err);
  }
};

exports.completeCheckout = async (req, res, next) => {
  try {
    const orderId = parsePositiveInt(req.params.orderId);
    const sessionId = normalizeString(req.query.session_id, 255);
    const returnUrl = safeReturnUrl(req.query.return_url);
    if (!orderId || !sessionId) {
      throw new AppError('Payment session not found', 404, 'payment_session_not_found');
    }
    if (!hasRestaurantStripeCheckout()) {
      throw new AppError('Stripe payments are not configured', 503, 'stripe_not_configured');
    }

    const { rows: orderRows } = await pool.query(
      `SELECT * FROM food_orders WHERE id = $1`,
      [orderId]
    );
    const order = orderRows[0];
    if (!order) throw new AppError('Order not found', 404, 'order_not_found');

    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
    const linkedOrderId = session.metadata?.food_order_id || session.client_reference_id;
    if (String(linkedOrderId) !== String(orderId)) {
      throw new AppError('Payment does not belong to this order', 403, 'payment_order_mismatch');
    }

    let updatedOrder = order;
    if (session.payment_status === 'paid') {
      const paymentIntentId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id || null;
      const { rows: updatedRows } = await pool.query(
        `UPDATE food_orders
            SET payment_status = 'paid',
                stripe_payment_intent_id = COALESCE($1, stripe_payment_intent_id),
                updated_at = NOW()
          WHERE id = $2
          RETURNING *`,
        [paymentIntentId, orderId]
      );
      updatedOrder = updatedRows[0] || order;
      emitRestaurantOrder(updatedOrder.business_id, 'food:order:updated', { order: updatedOrder });
    }

    if (returnUrl) {
      return res.redirect(returnUrl);
    }

    res
      .status(200)
      .type('html')
      .send(checkoutCompletionHtml({
        title: session.payment_status === 'paid' ? 'Payment complete' : 'Checkout received',
        detail: session.payment_status === 'paid'
          ? `Order #${updatedOrder.queue_number} has been marked paid.`
          : `Order #${updatedOrder.queue_number} is still waiting for payment confirmation.`,
      }));
  } catch (err) {
    next(err);
  }
};

exports.cancelCheckout = async (req, res, next) => {
  try {
    const orderId = parsePositiveInt(req.params.orderId);
    const returnUrl = safeReturnUrl(req.query.return_url);
    if (!orderId) throw new AppError('Order not found', 404, 'order_not_found');

    const { rows } = await pool.query(
      `SELECT queue_number FROM food_orders WHERE id = $1`,
      [orderId]
    );
    let order = rows[0];
    if (!order) throw new AppError('Order not found', 404, 'order_not_found');

    if (returnUrl) {
      return res.redirect(returnUrl);
    }

    res
      .status(200)
      .type('html')
      .send(checkoutCompletionHtml({
        title: 'Checkout cancelled',
        detail: `Order #${order.queue_number} is still open. You can return to the app to pay later or settle at the counter.`,
      }));
  } catch (err) {
    next(err);
  }
};

exports.listMyRestaurants = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT fr.*
         FROM food_restaurants fr
         JOIN businesses b ON b.id = fr.business_id
        WHERE fr.owner_user_id = $1
           OR b.user_id = $1
           OR EXISTS (
                SELECT 1 FROM business_members bm
                 WHERE bm.business_id = fr.business_id
                   AND bm.member_id = $1
                   AND bm.status = 'active'
              )
        ORDER BY fr.created_at DESC`,
      [req.user.id]
    );
    res.json({ restaurants: rows });
  } catch (err) {
    next(err);
  }
};

const RESTAURANT_PATCH_FIELDS = {
  displayName: { column: 'display_name', value: (v) => normalizeString(v, 160) },
  description: { column: 'description', value: (v) => normalizeString(v, 2000) },
  phone: { column: 'phone', value: (v) => normalizeString(v, 40) },
  website: { column: 'website', value: (v) => normalizeString(v, 255) },
  coverPhotoUrl: { column: 'cover_photo_url', value: (v) => normalizeString(v, 1000) },
  logoUrl: { column: 'logo_url', value: (v) => normalizeString(v, 1000) },
  addressStreet: { column: 'address_street', value: (v) => normalizeString(v, 255) },
  addressCity: { column: 'address_city', value: (v) => normalizeString(v, 120) },
  addressState: { column: 'address_state', value: (v) => normalizeString(v, 120) },
  addressZip: { column: 'address_zip', value: (v) => normalizeString(v, 40) },
  addressCountry: { column: 'address_country', value: (v) => normalizeCountry(v) },
  latitude: { column: 'latitude', value: (v) => (Number.isFinite(Number(v)) ? Number(v) : null) },
  longitude: { column: 'longitude', value: (v) => (Number.isFinite(Number(v)) ? Number(v) : null) },
  timezone: { column: 'timezone', value: (v) => normalizeString(v, 80) || 'UTC' },
  currencyCode: { column: 'currency_code', value: (v) => normalizeCurrency(v) },
  cuisineTags: { column: 'cuisine_tags', value: (v) => normalizeTextArray(v) },
  dietaryTags: { column: 'dietary_tags', value: (v) => normalizeDietaryTags(v) },
  prepTimeMin: { column: 'prep_time_min', value: (v) => parsePositiveInt(v, 15) },
  estimatedDeliveryMinutes: { column: 'estimated_delivery_minutes', value: (v) => parsePositiveInt(v, 30) },
  priceLevel: { column: 'price_level', value: (v) => normalizePriceLevel(v) },
  isAcceptingOrdersNow: { column: 'is_accepting_orders_now', value: (v) => normalizeBoolean(v, true) },
  temporarilyClosedUntil: { column: 'temporarily_closed_until', value: (v) => parseOptionalFutureDate(v) },
  minimumOrderCents: { column: 'minimum_order_cents', value: (v) => parseNonNegativeInt(v, 0) },
  deliveryFeeCents: { column: 'delivery_fee_cents', value: (v) => parseNonNegativeInt(v, 0) },
  serviceAreaRadiusMeters: { column: 'service_area_radius_meters', value: (v) => parseOptionalPositiveInt(v) },
  acceptsOnlineOrders: { column: 'accepts_online_orders', value: (v) => v !== false },
  acceptsInStoreOrders: { column: 'accepts_in_store_orders', value: (v) => v !== false },
  kitchenDisplayEnabled: { column: 'kitchen_display_enabled', value: (v) => v !== false },
  brandAccentHex: { column: 'brand_accent_hex', value: (v) => normalizeBrandAccentHex(v) },
  operatingHours: { column: 'operating_hours', value: (v) => normalizeHoursInput(v) },
};
const OWNER_SETTABLE_STATUS = new Set(['draft', 'active', 'paused']);

exports.updateRestaurant = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurantAccess = await requireRestaurantAccess(req.user.id, restaurantId);
    assertRestaurantManage(restaurantAccess);

    const sets = [];
    const params = [];
    for (const [key, spec] of Object.entries(RESTAURANT_PATCH_FIELDS)) {
      const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      const raw = req.body[key] !== undefined ? req.body[key] : req.body[snake];
      if (raw === undefined) continue;
      params.push(spec.value(raw));
      sets.push(`${spec.column} = $${params.length}`);
    }
    const status = normalizeString(req.body.status, 24);
    if (status) {
      if (!OWNER_SETTABLE_STATUS.has(status)) {
        throw new AppError('Validation failed', 400, 'validation_failed', {
          status: 'Status must be draft, active, or paused',
        });
      }
      params.push(status);
      sets.push(`status = $${params.length}`);
    }
    if (sets.length === 0) {
      throw new AppError('Validation failed', 400, 'validation_failed', { body: 'No updatable fields provided' });
    }

    params.push(restaurantId);
    const { rows: [restaurant] } = await pool.query(
      `UPDATE food_restaurants SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length}
        RETURNING *`,
      params
    );
    res.json({ restaurant });
  } catch (err) {
    next(err);
  }
};

exports.updateMenuCategory = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const categoryId = parsePositiveInt(req.params.categoryId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertRestaurantManage(restaurant);
    const { rows: [category] } = await pool.query(
      `UPDATE food_menu_categories
          SET name = COALESCE($1, name),
              description = COALESCE($2, description),
              sort_order = COALESCE($3, sort_order),
              is_active = COALESCE($4, is_active),
              updated_at = NOW()
        WHERE id = $5 AND restaurant_id = $6
        RETURNING *`,
      [
        normalizeString(req.body.name, 120),
        normalizeString(req.body.description, 1000),
        Number.isFinite(Number(req.body.sortOrder ?? req.body.sort_order)) ? Number(req.body.sortOrder ?? req.body.sort_order) : null,
        typeof (req.body.isActive ?? req.body.is_active) === 'boolean' ? (req.body.isActive ?? req.body.is_active) : null,
        categoryId,
        restaurantId,
      ]
    );
    if (!category) throw new AppError('Category not found', 404, 'category_not_found');
    res.json({ category });
  } catch (err) {
    next(err);
  }
};

exports.deleteMenuCategory = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const categoryId = parsePositiveInt(req.params.categoryId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertRestaurantManage(restaurant);
    const { rowCount } = await pool.query(
      `DELETE FROM food_menu_categories WHERE id = $1 AND restaurant_id = $2`,
      [categoryId, restaurantId]
    );
    if (!rowCount) throw new AppError('Category not found', 404, 'category_not_found');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};

exports.updateMenuItem = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const itemId = parsePositiveInt(req.params.itemId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertRestaurantManage(restaurant);
    const priceRaw = req.body.priceCents ?? req.body.price_cents;
    const { rows: [item] } = await pool.query(
      `UPDATE food_menu_items
          SET name = COALESCE($1, name),
              description = COALESCE($2, description),
              image_url = COALESCE($3, image_url),
              price_cents = COALESCE($4, price_cents),
              category_id = COALESCE($5, category_id),
              manual_available = COALESCE($6, manual_available),
              is_available = CASE
                WHEN $6::boolean IS NULL THEN is_available
                ELSE $6 AND inventory_available
              END,
              sort_order = COALESCE($7, sort_order),
              updated_at = NOW()
        WHERE id = $8 AND restaurant_id = $9
        RETURNING *`,
      [
        normalizeString(req.body.name, 160),
        normalizeString(req.body.description, 2000),
        normalizeString(req.body.imageUrl || req.body.image_url, 1000),
        priceRaw !== undefined ? parseMoneyCents(priceRaw, 'priceCents') : null,
        parsePositiveInt(req.body.categoryId || req.body.category_id),
        typeof (req.body.isAvailable ?? req.body.is_available) === 'boolean' ? (req.body.isAvailable ?? req.body.is_available) : null,
        Number.isFinite(Number(req.body.sortOrder ?? req.body.sort_order)) ? Number(req.body.sortOrder ?? req.body.sort_order) : null,
        itemId,
        restaurantId,
      ]
    );
    if (!item) throw new AppError('Menu item not found', 404, 'menu_item_not_found');
    res.json({ item });
  } catch (err) {
    next(err);
  }
};

exports.deleteMenuItem = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const itemId = parsePositiveInt(req.params.itemId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertRestaurantManage(restaurant);
    const { rowCount } = await pool.query(
      `DELETE FROM food_menu_items WHERE id = $1 AND restaurant_id = $2`,
      [itemId, restaurantId]
    );
    if (!rowCount) throw new AppError('Menu item not found', 404, 'menu_item_not_found');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};

exports.createModifierGroup = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const itemId = parsePositiveInt(req.params.itemId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertRestaurantManage(restaurant);
    const name = normalizeString(req.body.name, 120);
    if (!name) throw new AppError('Validation failed', 400, 'validation_failed', { name: 'Name is required' });
    const options = Array.isArray(req.body.options) ? req.body.options.slice(0, 30) : [];

    const group = await withTransaction(pool, async (client) => {
      const { rows: items } = await client.query(
        `SELECT id FROM food_menu_items WHERE id = $1 AND restaurant_id = $2`,
        [itemId, restaurantId]
      );
      if (!items[0]) throw new AppError('Menu item not found', 404, 'menu_item_not_found');

      const minSelect = Math.max(0, parsePositiveInt(req.body.minSelect ?? req.body.min_select, 0) || 0);
      const maxSelect = Math.max(minSelect, parsePositiveInt(req.body.maxSelect ?? req.body.max_select, 1) || 1);
      const { rows: [created] } = await client.query(
        `INSERT INTO food_modifier_groups
           (restaurant_id, menu_item_id, name, min_select, max_select, is_required, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          restaurantId,
          itemId,
          name,
          minSelect,
          maxSelect,
          req.body.isRequired === true || req.body.is_required === true,
          Number.parseInt(req.body.sortOrder || req.body.sort_order || 0, 10) || 0,
        ]
      );

      const createdOptions = [];
      for (let i = 0; i < options.length; i += 1) {
        const optionName = normalizeString(options[i]?.name, 120);
        if (!optionName) continue;
        const delta = Number(options[i]?.priceDeltaCents ?? options[i]?.price_delta_cents ?? 0);
        const { rows: [option] } = await client.query(
          `INSERT INTO food_modifiers (modifier_group_id, name, price_delta_cents, sort_order)
           VALUES ($1,$2,$3,$4)
           RETURNING *`,
          [created.id, optionName, Number.isFinite(delta) ? Math.round(delta) : 0, i]
        );
        createdOptions.push(option);
      }
      return { ...created, options: createdOptions };
    }, 'food_create_modifier_group');

    res.status(201).json({ modifierGroup: group });
  } catch (err) {
    next(err);
  }
};

exports.deleteModifierGroup = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const groupId = parsePositiveInt(req.params.groupId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertRestaurantManage(restaurant);
    const { rowCount } = await pool.query(
      `DELETE FROM food_modifier_groups WHERE id = $1 AND restaurant_id = $2`,
      [groupId, restaurantId]
    );
    if (!rowCount) throw new AppError('Modifier group not found', 404, 'modifier_group_not_found');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};

// Public "now serving" board: today's active queue numbers, no auth so it can
// run on a wall display or projector inside the restaurant.
exports.getQueueBoard = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    const { rows: restaurants } = await pool.query(
      `SELECT id, display_name, logo_url FROM food_restaurants WHERE id = $1 AND status IN ('active','paused')`,
      [restaurantId]
    );
    if (!restaurants[0]) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');

    const { rows } = await pool.query(
      `SELECT queue_number, status, guest_name, table_label, fulfillment_type, promised_at
         FROM food_orders
        WHERE restaurant_id = $1
          AND created_at::date = CURRENT_DATE
          AND status IN ('received','accepted','preparing','ready')
        ORDER BY queue_number ASC`,
      [restaurantId]
    );
    res.json({
      restaurant: restaurants[0],
      preparing: rows.filter((r) => r.status !== 'ready').map((r) => r.queue_number),
      ready: rows.filter((r) => r.status === 'ready').map((r) => r.queue_number),
      preparingEntries: rows
        .filter((r) => r.status !== 'ready')
        .map((r) => ({
          queueNumber: r.queue_number,
          guestLabel: publicQueueGuestLabel(r),
          fulfillmentType: r.fulfillment_type,
          promisedAt: r.promised_at,
        })),
      readyEntries: rows
        .filter((r) => r.status === 'ready')
        .map((r) => ({
          queueNumber: r.queue_number,
          guestLabel: publicQueueGuestLabel(r),
          fulfillmentType: r.fulfillment_type,
          promisedAt: r.promised_at,
        })),
    });
  } catch (err) {
    next(err);
  }
};

exports.getTrackedOrder = async (req, res, next) => {
  try {
    const trackingToken = normalizeString(req.params.trackingToken, 255);
    if (!trackingToken) throw new AppError('Order not found', 404, 'order_not_found');

    const { rows } = await pool.query(
      `SELECT fo.*, fr.display_name AS restaurant_name, fr.prep_time_min,
              EXISTS (SELECT 1 FROM food_reviews rv WHERE rv.order_id = fo.id) AS has_review,
              COALESCE(json_agg(json_build_object(
                'id', foi.id,
                'itemName', foi.item_name,
                'quantity', foi.quantity,
                'lineTotalCents', foi.line_total_cents,
                'specialInstructions', foi.special_instructions
              ) ORDER BY foi.id) FILTER (WHERE foi.id IS NOT NULL), '[]') AS items
         FROM food_orders fo
         JOIN food_restaurants fr ON fr.id = fo.restaurant_id
         LEFT JOIN food_order_items foi ON foi.order_id = fo.id
        WHERE fo.metadata->>'trackingToken' = $1
        GROUP BY fo.id, fr.display_name, fr.prep_time_min`,
      [trackingToken]
    );
    let order = rows[0];
    if (!order) throw new AppError('Order not found', 404, 'order_not_found');
    order = await syncFoodOrderPaymentStatus(order);
    res.json({ order });
  } catch (err) {
    next(err);
  }
};

exports.getCustomerProfile = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.query.restaurantId || req.query.restaurant_id);
    let restaurant = null;
    if (restaurantId) {
      const { rows } = await pool.query(
        `SELECT id, business_id, display_name
           FROM food_restaurants
          WHERE id = $1 AND status IN ('active', 'paused', 'draft')`,
        [restaurantId]
      );
      restaurant = rows[0] || null;
    }

    let profile = {
      preferredLanguage: 'english',
      notificationsEnabled: false,
      favoriteRestaurantIds: [],
      favoriteItemIds: [],
      reorderTemplates: [],
      loyaltySummary: {
        points: 0,
        tierName: 'New',
        rewardSummary: 'Place your first restaurant order to start earning points.',
      },
      offers: [],
    };

    try {
      const { rows } = await pool.query(
        `SELECT preferred_language, notifications_enabled
           FROM food_customer_profiles
          WHERE user_id = $1`,
        [req.user.id]
      );
      if (rows[0]) {
        profile.preferredLanguage = rows[0].preferred_language || profile.preferredLanguage;
        profile.notificationsEnabled = rows[0].notifications_enabled === true;
      }
    } catch (err) {
      if (!isMissingRelationError(err)) throw err;
    }

    try {
      const { rows } = await pool.query(
        `SELECT restaurant_id
           FROM food_customer_favorite_restaurants
          WHERE user_id = $1
          ORDER BY created_at DESC`,
        [req.user.id]
      );
      profile.favoriteRestaurantIds = rows.map((row) => Number(row.restaurant_id));
    } catch (err) {
      if (!isMissingRelationError(err)) throw err;
    }

    try {
      const { rows } = await pool.query(
        `SELECT menu_item_id
           FROM food_customer_favorite_items
          WHERE customer_id = $1
          ORDER BY created_at DESC`,
        [req.user.id]
      );
      profile.favoriteItemIds = rows.map((row) => Number(row.menu_item_id));
    } catch (err) {
      if (!isMissingRelationError(err)) throw err;
    }

    const { rows: reorderRows } = await pool.query(
      `SELECT fo.id, fo.restaurant_id, fr.display_name AS restaurant_name,
              fo.currency_code, fo.fulfillment_type, fo.created_at,
              COALESCE(json_agg(json_build_object(
                'menuItemId', foi.menu_item_id,
                'itemName', foi.item_name,
                'quantity', foi.quantity,
                'modifierIds', COALESCE((
                  SELECT array_agg(foim.modifier_id ORDER BY foim.id)
                    FROM food_order_item_modifiers foim
                   WHERE foim.order_item_id = foi.id
                     AND foim.modifier_id IS NOT NULL
                ), ARRAY[]::bigint[]),
                'specialInstructions', COALESCE(foi.special_instructions, '')
              ) ORDER BY foi.id) FILTER (WHERE foi.id IS NOT NULL), '[]') AS lines
         FROM food_orders fo
         JOIN food_restaurants fr ON fr.id = fo.restaurant_id
         LEFT JOIN food_order_items foi ON foi.order_id = fo.id
        WHERE fo.customer_id = $1
          AND fo.status NOT IN ('cancelled', 'refunded')
        GROUP BY fo.id, fr.display_name
        ORDER BY fo.created_at DESC
        LIMIT 12`,
      [req.user.id]
    );
    profile.reorderTemplates = reorderRows.map((row) => ({
      id: String(row.id),
      restaurantId: Number(row.restaurant_id),
      restaurantName: row.restaurant_name,
      currencyCode: row.currency_code,
      fulfillmentType: row.fulfillment_type,
      createdAt: row.created_at,
      lines: Array.isArray(row.lines) ? row.lines : [],
    }));

    if (restaurant?.business_id) {
      let points = 0;
      let tierName = 'New';
      let rewardSummary = 'Keep ordering to unlock your next restaurant reward.';

      if (restaurantId) {
        try {
          const { rows: loyaltyRows } = await pool.query(
            `SELECT points_balance, lifetime_points
               FROM food_loyalty_accounts
              WHERE restaurant_id = $1 AND customer_id = $2`,
            [restaurantId, req.user.id]
          );
          if (loyaltyRows[0]) {
            points = Number(loyaltyRows[0].points_balance || 0);
            const lifetime = Number(loyaltyRows[0].lifetime_points || 0);
            tierName = lifetime >= 500 ? 'Vip' : lifetime >= 200 ? 'Regular' : lifetime >= 50 ? 'Returning' : 'New';
            rewardSummary = `${points} points ready — keep ordering to unlock perks.`;
          }
        } catch (err) {
          if (!isMissingRelationError(err)) throw err;
        }
      }

      if (points === 0) {
        try {
          const { rows } = await pool.query(
            `SELECT lifetime_bookings, lifetime_spent_cents, loyalty_tier
               FROM customer_business_profile
              WHERE business_id = $1 AND customer_id = $2`,
            [restaurant.business_id, req.user.id]
          );
          if (rows[0]) {
            const spent = Number(rows[0].lifetime_spent_cents || 0);
            points = Math.max(0, Math.floor(spent / 100));
            tierName = toTierLabel(rows[0].loyalty_tier);
          } else {
            const { rows: fallbackRows } = await pool.query(
              `SELECT COALESCE(COUNT(*), 0) AS order_count,
                      COALESCE(SUM(total_cents), 0) AS lifetime_spent_cents
                 FROM food_orders
                WHERE business_id = $1
                  AND customer_id = $2
                  AND status NOT IN ('cancelled', 'refunded')`,
              [restaurant.business_id, req.user.id]
            );
            const spent = Number(fallbackRows[0]?.lifetime_spent_cents || 0);
            const count = Number(fallbackRows[0]?.order_count || 0);
            points = Math.max(0, Math.floor(spent / 100));
            tierName = count >= 10 ? 'Vip' : count >= 5 ? 'Regular' : count >= 2 ? 'Returning' : 'New';
          }

          const { rows: tierRows } = await pool.query(
            `SELECT tier_name, min_points
               FROM business_loyalty_tiers
              WHERE business_id = $1
              ORDER BY min_points ASC`,
            [restaurant.business_id]
          );
          const nextTier = tierRows.find((row) => Number(row.min_points) > points);
          rewardSummary = nextTier
            ? `${Math.max(0, Number(nextTier.min_points) - points)} points until ${toTierLabel(nextTier.tier_name)} perks.`
            : 'Top tier reached for this restaurant. Watch for new surprise offers.';
        } catch (err) {
          if (!isMissingRelationError(err)) throw err;
        }
      }

      profile.loyaltySummary = {
        points,
        tierName,
        rewardSummary,
      };

      try {
        const { rows: promoRows } = restaurantId
          ? await pool.query(
            `SELECT id, code, title, description, discount_percent, discount_cents, valid_until
               FROM food_restaurant_promotions
              WHERE restaurant_id = $1
                AND is_active = TRUE
                AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
                AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
              ORDER BY valid_until ASC NULLS LAST, created_at DESC
              LIMIT 6`,
            [restaurantId]
          )
          : { rows: [] };
        if (promoRows.length) {
          profile.offers = promoRows.map((row) => ({
            id: String(row.id),
            title: row.title,
            detail: row.description || 'Use this code at checkout.',
            code: row.code,
            discountPercent: row.discount_percent !== null ? Number(row.discount_percent) : null,
            discountCents: row.discount_cents !== null ? Number(row.discount_cents) : null,
          }));
        }
      } catch (err) {
        if (!isMissingRelationError(err)) throw err;
      }

      if (!profile.offers.length) {
        try {
          const { rows } = await pool.query(
            `SELECT id, offer_type, discount_percent, discount_cents, valid_until
               FROM customer_offers
              WHERE business_id = $1
                AND is_active = TRUE
                AND valid_from <= CURRENT_DATE
                AND valid_until >= CURRENT_DATE
                AND (customer_id = $2 OR customer_id IS NULL)
              ORDER BY valid_until ASC, created_at DESC
              LIMIT 6`,
            [restaurant.business_id, req.user.id]
          );
          profile.offers = rows.map((row) => {
            const discountPercent = row.discount_percent !== null ? Number(row.discount_percent) : null;
            const discountCents = row.discount_cents !== null ? Number(row.discount_cents) : null;
            const title = toTierLabel(row.offer_type).replace('Discount', ' Offer');
            const detail = discountPercent !== null
              ? `Save ${discountPercent}% on your next qualifying order before ${row.valid_until}.`
              : discountCents !== null
                ? `Save $${(discountCents / 100).toFixed(2)} on your next qualifying order before ${row.valid_until}.`
                : `Available through ${row.valid_until}.`;
            return {
              id: String(row.id),
              title,
              detail,
              code: `OX-${String(row.id).slice(0, 6).toUpperCase()}`,
            };
          });
        } catch (err) {
          if (!isMissingRelationError(err)) throw err;
        }
      }
    }

    res.json({ profile });
  } catch (err) {
    next(err);
  }
};

exports.updateCustomerProfile = async (req, res, next) => {
  try {
    const preferredLanguage = normalizeString(req.body.preferredLanguage || req.body.preferred_language, 24);
    const notificationsEnabled = req.body.notificationsEnabled ?? req.body.notifications_enabled;

    if (!preferredLanguage && typeof notificationsEnabled !== 'boolean') {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        body: 'Provide preferredLanguage and/or notificationsEnabled',
      });
    }

    const allowedLanguages = new Set(['english', 'spanish', 'french', 'haitian_creole']);
    const normalizedLanguage = preferredLanguage && allowedLanguages.has(preferredLanguage)
      ? preferredLanguage
      : preferredLanguage
        ? null
        : undefined;
    if (preferredLanguage && !normalizedLanguage) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        preferredLanguage: 'Unsupported language',
      });
    }

    const { rows: [profile] } = await pool.query(
      `INSERT INTO food_customer_profiles (user_id, preferred_language, notifications_enabled)
       VALUES ($1, COALESCE($2, 'english'), COALESCE($3, FALSE))
       ON CONFLICT (user_id) DO UPDATE
          SET preferred_language = COALESCE($2, food_customer_profiles.preferred_language),
              notifications_enabled = COALESCE($3, food_customer_profiles.notifications_enabled),
              updated_at = NOW()
       RETURNING preferred_language, notifications_enabled`,
      [
        req.user.id,
        normalizedLanguage ?? null,
        typeof notificationsEnabled === 'boolean' ? notificationsEnabled : null,
      ]
    );
    res.json({
      profile: {
        preferredLanguage: profile.preferred_language,
        notificationsEnabled: profile.notifications_enabled === true,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.toggleCustomerFavoriteRestaurant = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    const { rows: restaurants } = await pool.query(
      `SELECT id FROM food_restaurants WHERE id = $1 AND status IN ('active', 'paused', 'draft')`,
      [restaurantId]
    );
    if (!restaurants[0]) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');

    const { rows: existing } = await pool.query(
      `SELECT 1
         FROM food_customer_favorite_restaurants
        WHERE user_id = $1 AND restaurant_id = $2`,
      [req.user.id, restaurantId]
    );
    let favorited;
    if (existing[0]) {
      await pool.query(
        `DELETE FROM food_customer_favorite_restaurants
          WHERE user_id = $1 AND restaurant_id = $2`,
        [req.user.id, restaurantId]
      );
      favorited = false;
    } else {
      await pool.query(
        `INSERT INTO food_customer_favorite_restaurants (user_id, restaurant_id)
         VALUES ($1, $2)`,
        [req.user.id, restaurantId]
      );
      favorited = true;
    }

    const { rows } = await pool.query(
      `SELECT restaurant_id
         FROM food_customer_favorite_restaurants
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({
      favorited,
      favoriteRestaurantIds: rows.map((row) => Number(row.restaurant_id)),
    });
  } catch (err) {
    next(err);
  }
};

exports.listCustomerFavoriteItems = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT cfi.menu_item_id,
              cfi.restaurant_id,
              cfi.created_at,
              fmi.name AS item_name,
              fmi.description,
              fmi.image_url,
              fmi.price_cents,
              fmi.currency_code,
              fmi.is_available,
              fr.display_name AS restaurant_name
         FROM food_customer_favorite_items cfi
         JOIN food_menu_items fmi
           ON fmi.id = cfi.menu_item_id
          AND fmi.restaurant_id = cfi.restaurant_id
         JOIN food_restaurants fr ON fr.id = cfi.restaurant_id
        WHERE cfi.customer_id = $1
        ORDER BY cfi.created_at DESC
        LIMIT 500`,
      [req.user.id]
    );
    res.json({
      favoriteItems: rows.map((row) => ({
        menuItemId: Number(row.menu_item_id),
        restaurantId: Number(row.restaurant_id),
        restaurantName: row.restaurant_name,
        name: row.item_name,
        description: row.description,
        imageUrl: row.image_url,
        priceCents: Number(row.price_cents || 0),
        currencyCode: row.currency_code,
        isAvailable: row.is_available === true,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
};

exports.toggleCustomerFavoriteItem = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId || req.body.restaurantId || req.body.restaurant_id);
    const itemId = parsePositiveInt(req.params.itemId || req.body.itemId || req.body.item_id);
    if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    if (!itemId) throw new AppError('Menu item not found', 404, 'menu_item_not_found');

    const { rows: items } = await pool.query(
      `SELECT id, restaurant_id
         FROM food_menu_items
        WHERE id = $1 AND restaurant_id = $2`,
      [itemId, restaurantId]
    );
    if (!items[0]) throw new AppError('Menu item not found', 404, 'menu_item_not_found');

    const result = await withTransaction(pool, async (client) => {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
        [String(req.user.id), String(itemId)]
      );
      const { rows: existing } = await client.query(
        `SELECT 1
           FROM food_customer_favorite_items
          WHERE customer_id = $1 AND menu_item_id = $2`,
        [req.user.id, itemId]
      );
      let favorited;
      if (existing[0]) {
        await client.query(
          `DELETE FROM food_customer_favorite_items
            WHERE customer_id = $1 AND menu_item_id = $2`,
          [req.user.id, itemId]
        );
        favorited = false;
      } else {
        await client.query(
          `INSERT INTO food_customer_favorite_items (customer_id, restaurant_id, menu_item_id)
           VALUES ($1, $2, $3)`,
          [req.user.id, restaurantId, itemId]
        );
        favorited = true;
      }
      const { rows } = await client.query(
        `SELECT menu_item_id, restaurant_id, created_at
           FROM food_customer_favorite_items
          WHERE customer_id = $1
          ORDER BY created_at DESC, id DESC`,
        [req.user.id]
      );
      return { favorited, rows };
    });
    res.json({
      favorited: result.favorited,
      favoriteItemIds: result.rows.map((row) => Number(row.menu_item_id)),
      favorites: result.rows.map((row) => ({
        restaurantId: Number(row.restaurant_id),
        menuItemId: Number(row.menu_item_id),
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
};

exports.syncCustomerFavoriteItems = async (req, res, next) => {
  try {
    const mode = normalizeString(req.body.mode, 16) || 'merge';
    if (!['merge', 'replace'].includes(mode)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { mode: 'Mode must be merge or replace' });
    }
    const input = Array.isArray(req.body.favorites)
      ? req.body.favorites
      : Array.isArray(req.body.items)
        ? req.body.items
        : [];
    if (input.length > 500) {
      throw new AppError('Validation failed', 400, 'validation_failed', { favorites: 'No more than 500 favorites may be synced at once' });
    }
    const unique = new Map();
    for (const value of input) {
      const restaurantId = parsePositiveInt(value?.restaurantId || value?.restaurant_id);
      const menuItemId = parsePositiveInt(value?.menuItemId || value?.menu_item_id || value?.itemId || value?.item_id);
      if (!restaurantId || !menuItemId) {
        throw new AppError('Validation failed', 400, 'validation_failed', { favorites: 'Every favorite requires restaurantId and menuItemId' });
      }
      unique.set(String(menuItemId), { restaurantId, menuItemId });
    }
    const favorites = Array.from(unique.values());
    const result = await withTransaction(pool, async (client) => {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        [`favorite-sync:${req.user.id}`]
      );
      if (favorites.length) {
        const restaurantIds = favorites.map((favorite) => favorite.restaurantId);
        const menuItemIds = favorites.map((favorite) => favorite.menuItemId);
        const { rows: validRows } = await client.query(
          `SELECT fmi.id AS menu_item_id, fmi.restaurant_id
             FROM food_menu_items fmi
             JOIN unnest($1::bigint[], $2::bigint[]) requested(restaurant_id, menu_item_id)
               ON requested.restaurant_id = fmi.restaurant_id
              AND requested.menu_item_id = fmi.id`,
          [restaurantIds, menuItemIds]
        );
        if (validRows.length !== favorites.length) {
          throw new AppError('One or more favorite items no longer exist', 400, 'favorite_item_invalid');
        }
      }
      if (mode === 'replace') {
        await client.query(
          `DELETE FROM food_customer_favorite_items WHERE customer_id = $1`,
          [req.user.id]
        );
      }
      for (const favorite of favorites) {
        await client.query(
          `INSERT INTO food_customer_favorite_items (customer_id, restaurant_id, menu_item_id)
           VALUES ($1,$2,$3)
           ON CONFLICT (customer_id, menu_item_id)
           DO UPDATE SET restaurant_id = EXCLUDED.restaurant_id`,
          [req.user.id, favorite.restaurantId, favorite.menuItemId]
        );
      }
      const { rows } = await client.query(
        `SELECT restaurant_id, menu_item_id, created_at
           FROM food_customer_favorite_items
          WHERE customer_id = $1
          ORDER BY created_at DESC, id DESC`,
        [req.user.id]
      );
      return rows;
    });
    res.json({
      mode,
      syncedAt: new Date().toISOString(),
      favoriteItemIds: result.map((row) => Number(row.menu_item_id)),
      favorites: result.map((row) => ({
        restaurantId: Number(row.restaurant_id),
        menuItemId: Number(row.menu_item_id),
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
};

exports.listMyOrders = async (req, res, next) => {
  try {
    const limit = Math.min(parsePositiveInt(req.query.limit, 30), 100);
    const { rows } = await pool.query(
      `SELECT fo.*, fr.display_name AS restaurant_name, fr.logo_url AS restaurant_logo_url,
              EXISTS (SELECT 1 FROM food_reviews rv WHERE rv.order_id = fo.id) AS has_review,
              COALESCE(json_agg(json_build_object(
                'id', foi.id,
                'itemName', foi.item_name,
                'quantity', foi.quantity,
                'lineTotalCents', foi.line_total_cents
              ) ORDER BY foi.id) FILTER (WHERE foi.id IS NOT NULL), '[]') AS items
         FROM food_orders fo
         JOIN food_restaurants fr ON fr.id = fo.restaurant_id
         LEFT JOIN food_order_items foi ON foi.order_id = fo.id
        WHERE fo.customer_id = $1
        GROUP BY fo.id, fr.display_name, fr.logo_url
        ORDER BY fo.created_at DESC
        LIMIT $2`,
      [req.user.id, limit]
    );
    const orders = [];
    for (const row of rows) {
      orders.push(await syncFoodOrderPaymentStatus(row));
    }
    res.json({ orders });
  } catch (err) {
    next(err);
  }
};

exports.getOrder = async (req, res, next) => {
  try {
    const orderId = parsePositiveInt(req.params.orderId);
    if (!orderId) throw new AppError('Order not found', 404, 'order_not_found');
    const { rows } = await pool.query(
      `SELECT fo.*, fr.display_name AS restaurant_name, fr.prep_time_min,
              EXISTS (SELECT 1 FROM food_reviews rv WHERE rv.order_id = fo.id) AS has_review,
              COALESCE(json_agg(json_build_object(
                'id', foi.id,
                'itemName', foi.item_name,
                'quantity', foi.quantity,
                'lineTotalCents', foi.line_total_cents,
                'specialInstructions', foi.special_instructions
              ) ORDER BY foi.id) FILTER (WHERE foi.id IS NOT NULL), '[]') AS items
         FROM food_orders fo
         JOIN food_restaurants fr ON fr.id = fo.restaurant_id
         LEFT JOIN food_order_items foi ON foi.order_id = fo.id
        WHERE fo.id = $1
        GROUP BY fo.id, fr.display_name, fr.prep_time_min`,
      [orderId]
    );
    let order = rows[0];
    if (!order) throw new AppError('Order not found', 404, 'order_not_found');

    const isCustomer = order.customer_id && req.user?.id === order.customer_id;
    if (!isCustomer) {
      try {
        await requireRestaurantAccess(req.user?.id, order.restaurant_id);
      } catch (_) {
        throw new AppError('Order not found', 404, 'order_not_found');
      }
    }
    order = await syncFoodOrderPaymentStatus(order);
    res.json({ order });
  } catch (err) {
    next(err);
  }
};

exports.listRestaurantPromotions = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    try {
      const { rows } = await pool.query(
        `SELECT id, code, title, description, discount_percent, discount_cents,
                min_subtotal_cents, valid_from, valid_until
           FROM food_restaurant_promotions
          WHERE restaurant_id = $1
            AND is_active = TRUE
            AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
            AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
          ORDER BY created_at DESC
          LIMIT 20`,
        [restaurantId]
      );
      return res.json({ promotions: rows });
    } catch (err) {
      if (isMissingRelationError(err)) return res.json({ promotions: [] });
      throw err;
    }
  } catch (err) {
    next(err);
  }
};

exports.createRestaurantPromotion = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertRestaurantManage(restaurant);
    const code = normalizeString(req.body.code, 40);
    const title = normalizeString(req.body.title, 120);
    if (!code || !title) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        code: 'Code is required',
        title: 'Title is required',
      });
    }
    const discountPercent = req.body.discountPercent ?? req.body.discount_percent;
    const discountCents = req.body.discountCents ?? req.body.discount_cents;
    const { rows: [promotion] } = await pool.query(
      `INSERT INTO food_restaurant_promotions
         (restaurant_id, code, title, description, discount_percent, discount_cents,
          min_subtotal_cents, valid_from, valid_until, max_uses, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        restaurantId,
        code.toUpperCase(),
        title,
        normalizeString(req.body.description, 2000),
        discountPercent != null ? Number(discountPercent) : null,
        discountCents != null ? parseMoneyCents(discountCents, 'discountCents') : null,
        parseMoneyCents(req.body.minSubtotalCents ?? req.body.min_subtotal_cents ?? 0, 'minSubtotalCents'),
        req.body.validFrom || req.body.valid_from || null,
        req.body.validUntil || req.body.valid_until || null,
        parsePositiveInt(req.body.maxUses ?? req.body.max_uses),
        req.body.isActive !== false,
      ]
    );
    res.status(201).json({ promotion });
  } catch (err) {
    if (isMissingRelationError(err)) {
      return next(new AppError('Promotions are not available yet', 503, 'promotions_unavailable'));
    }
    next(err);
  }
};

exports.listMerchantRestaurantPromotions = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    try {
      const { rows } = await pool.query(
        `SELECT id, code, title, description, discount_percent, discount_cents,
                min_subtotal_cents, valid_from, valid_until, max_uses, use_count,
                is_active, created_at, updated_at
           FROM food_restaurant_promotions
          WHERE restaurant_id = $1
          ORDER BY created_at DESC
          LIMIT 50`,
        [restaurantId]
      );
      return res.json({ promotions: rows });
    } catch (err) {
      if (isMissingRelationError(err)) return res.json({ promotions: [] });
      throw err;
    }
  } catch (err) {
    next(err);
  }
};

exports.updateRestaurantPromotion = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const promotionId = parsePositiveInt(req.params.promotionId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertRestaurantManage(restaurant);

    const sets = ['updated_at = NOW()'];
    const params = [];

    if (req.body.isActive !== undefined || req.body.is_active !== undefined) {
      params.push(req.body.isActive !== false && req.body.is_active !== false);
      sets.push(`is_active = $${params.length}`);
    }
    if (req.body.title !== undefined) {
      const title = normalizeString(req.body.title, 120);
      if (!title) {
        throw new AppError('Validation failed', 400, 'validation_failed', { title: 'Title is required' });
      }
      params.push(title);
      sets.push(`title = $${params.length}`);
    }
    if (req.body.description !== undefined) {
      params.push(normalizeString(req.body.description, 2000));
      sets.push(`description = $${params.length}`);
    }
    if (req.body.validUntil !== undefined || req.body.valid_until !== undefined) {
      params.push(req.body.validUntil || req.body.valid_until || null);
      sets.push(`valid_until = $${params.length}`);
    }
    if (req.body.maxUses !== undefined || req.body.max_uses !== undefined) {
      params.push(parsePositiveInt(req.body.maxUses ?? req.body.max_uses));
      sets.push(`max_uses = $${params.length}`);
    }

    if (sets.length === 1) {
      throw new AppError('Validation failed', 400, 'validation_failed', { body: 'No supported fields to update' });
    }

    params.push(promotionId, restaurantId);

    try {
      const { rows: [promotion] } = await pool.query(
        `UPDATE food_restaurant_promotions
            SET ${sets.join(', ')}
          WHERE id = $${params.length - 1} AND restaurant_id = $${params.length}
          RETURNING *`,
        params
      );
      if (!promotion) throw new AppError('Promotion not found', 404, 'promotion_not_found');
      return res.json({ promotion });
    } catch (err) {
      if (isMissingRelationError(err)) {
        return next(new AppError('Promotions are not available yet', 503, 'promotions_unavailable'));
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
};

exports.createOrderReview = async (req, res, next) => {
  try {
    const orderId = parsePositiveInt(req.params.orderId);
    const rating = parsePositiveInt(req.body.rating);
    const body = normalizeString(req.body.body, 2000);
    const trackingToken = normalizeString(req.body.trackingToken || req.body.tracking_token, 255);
    if (!orderId || !rating || rating < 1 || rating > 5) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        rating: 'Must be an integer from 1 to 5',
      });
    }

    let order;
    if (req.user?.id) {
      const { rows } = await pool.query(
        `SELECT * FROM food_orders WHERE id = $1 AND customer_id = $2`,
        [orderId, req.user.id]
      );
      order = rows[0];
    } else if (trackingToken) {
      const { rows } = await pool.query(
        `SELECT * FROM food_orders WHERE id = $1 AND metadata->>'trackingToken' = $2`,
        [orderId, trackingToken]
      );
      order = rows[0];
    }
    if (!order) throw new AppError('Order not found', 404, 'order_not_found');
    if (order.status !== 'completed') {
      throw new AppError('Only completed orders can be reviewed', 409, 'order_not_reviewable');
    }

    const customerId = req.user?.id || order.customer_id || null;
    const { rows: [review] } = await pool.query(
      `INSERT INTO food_reviews (restaurant_id, order_id, customer_id, rating, body)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (order_id) DO NOTHING
       RETURNING id, restaurant_id, order_id, customer_id, rating, body, created_at`,
      [order.restaurant_id, orderId, customerId, rating, body]
    );
    if (!review) {
      throw new AppError('Review already submitted for this order', 409, 'review_exists');
    }
    res.status(201).json({ review });
  } catch (err) {
    if (isMissingRelationError(err)) {
      return next(new AppError('Reviews are not available yet', 503, 'reviews_unavailable'));
    }
    next(err);
  }
};

async function buildRestaurantSetupProgress(restaurantId, restaurant) {
  let menuCount = 0;
  let locationCount = 0;
  try {
    const { rows: menuRows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM food_menu_items WHERE restaurant_id = $1`,
      [restaurantId]
    );
    menuCount = Number(menuRows[0]?.count || 0);
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;
  }
  try {
    const { rows: locationRows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM restaurant_locations WHERE restaurant_id = $1 AND status = 'active'`,
      [restaurantId]
    );
    locationCount = Number(locationRows[0]?.count || 0);
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;
  }

  const hours = normalizeHoursInput(restaurant.operating_hours);
  const hasHours = Boolean(hours.weekly && Object.keys(hours.weekly).length > 0);
  const hasProfile = Boolean(
    normalizeString(restaurant.display_name, 160)
    && (normalizeString(restaurant.description, 2000) || (Array.isArray(restaurant.cuisine_tags) && restaurant.cuisine_tags.length))
  );
  const hasLocation = Boolean(
    locationCount > 0
    || (normalizeString(restaurant.address_city, 120)
      && Number.isFinite(Number(restaurant.latitude))
      && Number.isFinite(Number(restaurant.longitude)))
  );

  const steps = [
    { id: 'profile', title: 'Restaurant profile', complete: hasProfile },
    { id: 'location', title: 'Location', complete: hasLocation },
    { id: 'hours', title: 'Operating hours', complete: hasHours },
    { id: 'menu', title: 'Menu items', complete: menuCount > 0 },
    { id: 'publish', title: 'Go live', complete: restaurant.status === 'active' },
  ];
  const readyToPublish = steps.slice(0, 4).every((step) => step.complete);
  const nextStep = steps.find((step) => !step.complete && step.id !== 'publish') || null;
  return { steps, readyToPublish, nextStepId: nextStep?.id || null, menuItemCount: menuCount, locationCount };
}

exports.getRestaurantSetupProgress = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const { rows } = await pool.query(`SELECT * FROM food_restaurants WHERE id = $1`, [restaurantId]);
    const restaurant = rows[0];
    if (!restaurant) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    const progress = await buildRestaurantSetupProgress(restaurantId, restaurant);
    res.json(progress);
  } catch (err) {
    next(err);
  }
};

exports.listRestaurantLocations = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    let isMerchant = false;
    if (req.user?.id) {
      try {
        await requireRestaurantAccess(req.user.id, restaurantId);
        isMerchant = true;
      } catch (_) {
        isMerchant = false;
      }
    }
    if (!isMerchant) {
      const { rows: restaurants } = await pool.query(
        `SELECT id FROM food_restaurants WHERE id = $1 AND status = 'active'`,
        [restaurantId]
      );
      if (!restaurants[0]) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    }
    try {
      const { rows } = await pool.query(
        `SELECT id, restaurant_id, name, address_street, address_city, address_state, address_zip,
                address_country, latitude, longitude, timezone, phone, is_primary, status,
                operating_hours, created_at, updated_at
           FROM restaurant_locations
          WHERE restaurant_id = $1 ${isMerchant ? '' : "AND status = 'active'"}
          ORDER BY is_primary DESC, name ASC`,
        [restaurantId]
      );
      return res.json({ locations: rows.map(attachRestaurantHours) });
    } catch (err) {
      if (isMissingRelationError(err)) return res.json({ locations: [] });
      throw err;
    }
  } catch (err) {
    next(err);
  }
};

exports.createRestaurantLocation = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertRestaurantManage(restaurant);
    const name = normalizeString(req.body.name, 160);
    if (!name) {
      throw new AppError('Validation failed', 400, 'validation_failed', { name: 'Location name is required' });
    }
    const isPrimary = req.body.isPrimary === true || req.body.is_primary === true;
    if (isPrimary) {
      await pool.query(
        `UPDATE restaurant_locations SET is_primary = FALSE, updated_at = NOW() WHERE restaurant_id = $1`,
        [restaurantId]
      );
    }
    const { rows: [location] } = await pool.query(
      `INSERT INTO restaurant_locations
         (restaurant_id, name, address_street, address_city, address_state, address_zip,
          address_country, latitude, longitude, timezone, phone, is_primary, status, operating_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        restaurantId,
        name,
        normalizeString(req.body.addressStreet || req.body.address_street, 255),
        normalizeString(req.body.addressCity || req.body.address_city, 120),
        normalizeString(req.body.addressState || req.body.address_state, 120),
        normalizeString(req.body.addressZip || req.body.address_zip, 40),
        normalizeCountry(req.body.addressCountry || req.body.address_country),
        Number.isFinite(Number(req.body.latitude)) ? Number(req.body.latitude) : null,
        Number.isFinite(Number(req.body.longitude)) ? Number(req.body.longitude) : null,
        normalizeString(req.body.timezone, 80) || 'UTC',
        normalizeString(req.body.phone, 40),
        isPrimary,
        normalizeString(req.body.status, 24) || 'active',
        normalizeHoursInput(req.body.operatingHours || req.body.operating_hours),
      ]
    );
    res.status(201).json({ location: attachRestaurantHours(location) });
  } catch (err) {
    if (isMissingRelationError(err)) {
      return next(new AppError('Locations are not available yet', 503, 'locations_unavailable'));
    }
    next(err);
  }
};

exports.updateRestaurantLocation = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const locationId = parsePositiveInt(req.params.locationId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertRestaurantManage(restaurant);
    const { rows: existing } = await pool.query(
      `SELECT * FROM restaurant_locations WHERE id = $1 AND restaurant_id = $2`,
      [locationId, restaurantId]
    );
    if (!existing[0]) throw new AppError('Location not found', 404, 'location_not_found');

    if (req.body.isPrimary === true || req.body.is_primary === true) {
      await pool.query(
        `UPDATE restaurant_locations SET is_primary = FALSE, updated_at = NOW() WHERE restaurant_id = $1`,
        [restaurantId]
      );
    }

    const { rows: [location] } = await pool.query(
      `UPDATE restaurant_locations
          SET name = COALESCE($1, name),
              address_street = COALESCE($2, address_street),
              address_city = COALESCE($3, address_city),
              address_state = COALESCE($4, address_state),
              address_zip = COALESCE($5, address_zip),
              address_country = COALESCE($6, address_country),
              latitude = COALESCE($7, latitude),
              longitude = COALESCE($8, longitude),
              timezone = COALESCE($9, timezone),
              phone = COALESCE($10, phone),
              is_primary = COALESCE($11, is_primary),
              status = COALESCE($12, status),
              operating_hours = COALESCE($13, operating_hours),
              updated_at = NOW()
        WHERE id = $14 AND restaurant_id = $15
        RETURNING *`,
      [
        normalizeString(req.body.name, 160),
        normalizeString(req.body.addressStreet || req.body.address_street, 255),
        normalizeString(req.body.addressCity || req.body.address_city, 120),
        normalizeString(req.body.addressState || req.body.address_state, 120),
        normalizeString(req.body.addressZip || req.body.address_zip, 40),
        req.body.addressCountry || req.body.address_country ? normalizeCountry(req.body.addressCountry || req.body.address_country) : null,
        Number.isFinite(Number(req.body.latitude)) ? Number(req.body.latitude) : null,
        Number.isFinite(Number(req.body.longitude)) ? Number(req.body.longitude) : null,
        normalizeString(req.body.timezone, 80),
        normalizeString(req.body.phone, 40),
        typeof (req.body.isPrimary ?? req.body.is_primary) === 'boolean' ? (req.body.isPrimary ?? req.body.is_primary) : null,
        normalizeString(req.body.status, 24),
        req.body.operatingHours || req.body.operating_hours ? normalizeHoursInput(req.body.operatingHours || req.body.operating_hours) : null,
        locationId,
        restaurantId,
      ]
    );
    res.json({ location: attachRestaurantHours(location) });
  } catch (err) {
    if (isMissingRelationError(err)) {
      return next(new AppError('Locations are not available yet', 503, 'locations_unavailable'));
    }
    next(err);
  }
};
