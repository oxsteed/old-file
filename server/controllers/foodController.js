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

const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

const VALID_FULFILLMENT = new Set(['pickup', 'dine_in', 'delivery', 'kiosk']);
const VALID_ORDER_SOURCES = new Set(['mobile', 'web', 'kiosk', 'counter', 'tablet']);
const VALID_STATUS = new Set(['received', 'accepted', 'preparing', 'ready', 'completed', 'cancelled', 'refunded']);
const VALID_PAYMENT_STATUS = new Set(['unpaid', 'requires_payment', 'paid', 'failed', 'refunded']);
const IN_STORE_SOURCES = new Set(['kiosk', 'counter', 'tablet']);
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

function normalizeTextArray(value, maxItems = 12) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeString(item, 60))
    .filter(Boolean)
    .slice(0, maxItems);
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
      return;
    }

    // 2) Guest with a phone number — SMS.
    if (order.guest_phone) {
      await smsNotificationService.sendDirectSMS(order.guest_phone, `${body} ${boardUrl}`.trim());
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
    }
  } catch (err) {
    logger.warn('notifyFoodOrderReady failed (non-blocking)', { error: err && err.message, orderId: order && order.id });
  }
}

exports.listRestaurants = async (req, res, next) => {
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
      const lngIndex = params.length;
      distanceSelect = `(6371 * acos(LEAST(1, GREATEST(-1,
        cos(radians($${latIndex})) * cos(radians(fr.latitude)) *
        cos(radians(fr.longitude) - radians($${lngIndex})) +
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
              ${distanceSelect}
         FROM food_restaurants fr
        WHERE ${filters.join(' AND ')}
        ORDER BY ${orderBy}
        LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
      params
    );

    res.json({ restaurants: rows, limit, offset });
  } catch (err) {
    next(err);
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
      restaurant,
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
            accepts_online_orders, accepts_in_store_orders, kitchen_display_enabled, status, prep_time_min)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
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
    await requireRestaurantAccess(req.user.id, restaurantId);
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
    const name = normalizeString(req.body.name, 160);
    if (!name) throw new AppError('Validation failed', 400, 'validation_failed', { name: 'Name is required' });

    const priceCents = parseMoneyCents(req.body.priceCents ?? req.body.price_cents, 'priceCents');
    const { rows: [item] } = await pool.query(
      `INSERT INTO food_menu_items
         (restaurant_id, category_id, name, description, image_url, price_cents,
          currency_code, is_available, sort_order, tags, allergens)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
    if (!['pay_at_counter', 'pay_now'].includes(paymentMode)) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        paymentMode: 'Must be pay_at_counter or pay_now',
      });
    }

    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (items.length === 0) {
      throw new AppError('Validation failed', 400, 'validation_failed', { items: 'At least one item is required' });
    }

    const createdOrder = await withTransaction(pool, async (client) => {
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
      const tax = parseMoneyCents(req.body.taxCents ?? req.body.tax_cents ?? 0, 'taxCents');
      const tip = parseMoneyCents(req.body.tipCents ?? req.body.tip_cents ?? 0, 'tipCents');
      const discount = parseMoneyCents(req.body.discountCents ?? req.body.discount_cents ?? 0, 'discountCents');
      const total = Math.max(0, subtotal + tax + tip - discount);

      const { rows: queueRows } = await client.query(
        `SELECT COALESCE(MAX(queue_number), 0) + 1 AS next_queue
           FROM food_orders
          WHERE restaurant_id = $1 AND created_at::date = CURRENT_DATE`,
        [restaurantId]
      );
      const queueNumber = Number(queueRows[0]?.next_queue || 1);

      const fulfillmentType = normalizeString(req.body.fulfillmentType || req.body.fulfillment_type, 24) || 'pickup';
      const orderSource = normalizeString(req.body.orderSource || req.body.order_source, 24) || 'mobile';
      if (!VALID_FULFILLMENT.has(fulfillmentType)) {
        throw new AppError('Validation failed', 400, 'validation_failed', { fulfillmentType: 'Unsupported fulfillment type' });
      }
      if (!VALID_ORDER_SOURCES.has(orderSource)) {
        throw new AppError('Validation failed', 400, 'validation_failed', { orderSource: 'Unsupported order source' });
      }

      const trackingToken = createTrackingToken();
      const discountCode = normalizeString(req.body.discountCode || req.body.discount_code, 40);
      const discountLabel = normalizeString(req.body.discountLabel || req.body.discount_label, 120);
      const discountMetadata = discount > 0
        ? {
          code: discountCode,
          label: discountLabel,
          amountCents: discount,
        }
        : null;
      const metadata = req.body.metadata && typeof req.body.metadata === 'object'
        ? { ...req.body.metadata, trackingToken, ...(discountMetadata ? { posDiscount: discountMetadata } : {}) }
        : { trackingToken, ...(discountMetadata ? { posDiscount: discountMetadata } : {}) };

      const { rows: [created] } = await client.query(
        `INSERT INTO food_orders
           (restaurant_id, business_id, customer_id, guest_name, guest_phone, guest_email,
            order_source, fulfillment_type, payment_status, subtotal_cents, tax_cents,
            tip_cents, discount_cents, total_cents, currency_code, table_label,
            queue_number, promised_at, notes, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW() + ($18 || ' minutes')::interval,$19,$20)
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
          // All OxSteed Food payments are settled in store (liability-limiting
          // model): the platform tracks amounts but never processes charges.
          'unpaid',
          subtotal,
          tax,
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

      return {
        order: created,
        restaurant,
        normalizedItems,
        trackingToken,
      };
    }, 'food_create_order');

    let order = createdOrder.order;
    let payment = null;
    if (paymentMode === 'pay_now') {
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

    emitRestaurantOrder(order.business_id, 'food:order:created', { order });
    emitRestaurantDisplay(order.restaurant_id, order);
    res.status(201).json({ order, payment, trackingToken: createdOrder.trackingToken });
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

    const timestampColumn = {
      accepted: 'accepted_at',
      ready: 'ready_at',
      completed: 'completed_at',
      cancelled: 'cancelled_at',
    }[status];

    const { rows: [order] } = await pool.query(
      `UPDATE food_orders
          SET status = $1,
              ${timestampColumn ? `${timestampColumn} = COALESCE(${timestampColumn}, NOW()),` : ''}
              updated_at = NOW()
        WHERE id = $2 AND restaurant_id = $3 AND status = ANY($4::text[])
        RETURNING *`,
      [status, orderId, restaurantId, ORDER_TRANSITIONS[status]]
    );
    if (!order) {
      const { rows: existing } = await pool.query(
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

    emitRestaurantOrder(order.business_id, 'food:order:updated', { order });
    emitRestaurantDisplay(order.restaurant_id, order);

    // When the kitchen marks an order ready, tell the customer (best-effort,
    // fire-and-forget so a slow SMS/email provider never delays this response).
    if (status === 'ready') {
      notifyFoodOrderReady(order, restaurant);
    }

    res.json({ order });
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
      `UPDATE food_orders
          SET payment_status = $1, updated_at = NOW()
        WHERE id = $2 AND restaurant_id = $3
        RETURNING *`,
      [paymentStatus, orderId, restaurantId]
    );
    if (!order) throw new AppError('Order not found', 404, 'order_not_found');
    emitRestaurantOrder(order.business_id, 'food:order:updated', { order });
    res.json({ order });
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
  prepTimeMin: { column: 'prep_time_min', value: (v) => parsePositiveInt(v, 15) },
  acceptsOnlineOrders: { column: 'accepts_online_orders', value: (v) => v !== false },
  acceptsInStoreOrders: { column: 'accepts_in_store_orders', value: (v) => v !== false },
  kitchenDisplayEnabled: { column: 'kitchen_display_enabled', value: (v) => v !== false },
};
const OWNER_SETTABLE_STATUS = new Set(['draft', 'active', 'paused']);

exports.updateRestaurant = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);

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
    await requireRestaurantAccess(req.user.id, restaurantId);
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
    await requireRestaurantAccess(req.user.id, restaurantId);
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
    await requireRestaurantAccess(req.user.id, restaurantId);
    const priceRaw = req.body.priceCents ?? req.body.price_cents;
    const { rows: [item] } = await pool.query(
      `UPDATE food_menu_items
          SET name = COALESCE($1, name),
              description = COALESCE($2, description),
              image_url = COALESCE($3, image_url),
              price_cents = COALESCE($4, price_cents),
              category_id = COALESCE($5, category_id),
              is_available = COALESCE($6, is_available),
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
    await requireRestaurantAccess(req.user.id, restaurantId);
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
    await requireRestaurantAccess(req.user.id, restaurantId);
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
    await requireRestaurantAccess(req.user.id, restaurantId);
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

      profile.loyaltySummary = {
        points,
        tierName,
        rewardSummary,
      };

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

exports.listMyOrders = async (req, res, next) => {
  try {
    const limit = Math.min(parsePositiveInt(req.query.limit, 30), 100);
    const { rows } = await pool.query(
      `SELECT fo.*, fr.display_name AS restaurant_name, fr.logo_url AS restaurant_logo_url,
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
    const order = rows[0];
    if (!order) throw new AppError('Order not found', 404, 'order_not_found');

    const isCustomer = order.customer_id && req.user?.id === order.customer_id;
    if (!isCustomer) {
      // Merchant-side staff can also view; everyone else gets a 404 so order
      // existence is never leaked.
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
