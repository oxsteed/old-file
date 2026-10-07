'use strict';

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const socketService = require('../services/socketService');
const { absoluteUrl, getPublicSiteUrl } = require('../utils/publicSiteUrl');
const crypto = require('crypto');
const logger = require('../utils/logger');
const notificationService = require('../services/notificationService');
const smsNotificationService = require('../services/smsNotificationService');
const emailService = require('../services/emailService');
const { sanitizeMessage } = require('../utils/messageSanitizer');
const { ensureBusinessConversation, mirrorMessage } = require('../services/businessConversationSync');
const { createLinkedSupportTicket } = require('../services/supportTicketLinkService');
const { scheduleSupportMessageNotifications } = require('../services/supportNotificationService');
const { getClientRequestId } = require('../utils/idempotency');
const { enqueueKitchenPrinterJobs } = require('../services/restaurantKitchenPrinterService');
const {
  reserveInventoryForOrder,
  releaseInventoryForOrder,
  consumeInventoryForOrder,
} = require('../services/restaurantInventoryOrderService');
const permissionsService = require('../services/permissionsService');
const { debitFoodWallet, refundWalletDebitForReference, formatLedgerRow } = require('../services/foodWalletService');
const {
  purchaseWithCreditInTransaction,
  refundCreditForReferenceInTransaction,
  formatCreditAmount,
  getCustomerCreditEligibility,
} = require('../services/oxsteedCreditService');
const {
  recordWalletCreditPaymentForOrder,
  recordWalletCreditRefundForOrder,
} = require('../services/restaurantPosPaymentLedgerService');
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
// Card-payment intent sanity bounds (cents). The intent amount is client-
// supplied, so it is clamped here and re-verified against the server-priced
// order total at order creation.
const FOOD_CARD_INTENT_MIN_CENTS = 50;
const FOOD_CARD_INTENT_MAX_CENTS = 1000000;

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const FOOD_PAYMENT_MODE_ALIASES = {
  pay_at_counter: 'pay_at_restaurant',
  pay_at_restaurant: 'pay_at_restaurant',
  wallet_credit: 'restaurant_credit',
  restaurant_credit: 'restaurant_credit',
  oxsteed_credit: 'oxsteed_credit',
  oxsteedCredit: 'oxsteed_credit',
  credit: 'oxsteed_credit',
  pay_now: 'pay_now',
  card: 'card',
  direct: 'direct_payment',
  direct_payment: 'direct_payment',
  off_platform: 'direct_payment',
};
const FOOD_PAYMENT_LEGACY_MODE = {
  pay_at_restaurant: 'pay_at_counter',
  restaurant_credit: 'wallet_credit',
  oxsteed_credit: 'oxsteed_credit',
  pay_now: 'pay_now',
  card: 'card',
  direct_payment: 'direct_payment',
};
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

// Returns the restaurant owner's most recent active QR pay URL, or null.
// Lets restaurant direct payments ride the OxSteed QR rail (Stripe Connect
// direct charge, platform fee captured) instead of an uploaded external QR
// image. Fails soft so the restaurant page never breaks when the QR tables
// are absent or the owner has no active code.
async function getOwnerOxsteedPayUrl(businessId) {
  try {
    const { rows } = await pool.query(
      `SELECT qpc.code
         FROM qr_payment_codes qpc
         JOIN businesses b ON b.user_id = qpc.owner_user_id
        WHERE b.id = $1 AND qpc.is_active = TRUE
        ORDER BY qpc.created_at DESC
        LIMIT 1`,
      [businessId]
    );
    const code = rows[0]?.code;
    if (!code) return null;
    return absoluteUrl(`/pay/${code}`);
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;
    return null;
  }
}

function getRestaurantStripeStatus(restaurant) {
  const accountId = normalizeString(
    restaurant?.stripe_account_id
      || restaurant?.business_stripe_account_id
      || restaurant?.businessStripeAccountId,
    255
  );
  const chargesEnabled = normalizeBoolean(
    restaurant?.stripe_charges_enabled
      ?? restaurant?.business_stripe_charges_enabled
      ?? restaurant?.businessStripeChargesEnabled,
    false
  );
  const payoutsEnabled = normalizeBoolean(
    restaurant?.stripe_payouts_enabled
      ?? restaurant?.business_stripe_payouts_enabled
      ?? restaurant?.businessStripePayoutsEnabled,
    false
  );
  const accountStatus = normalizeString(
    restaurant?.stripe_account_status
      || restaurant?.business_stripe_account_status
      || restaurant?.businessStripeAccountStatus,
    40
  );
  return {
    accountId,
    chargesEnabled,
    payoutsEnabled,
    accountStatus,
    connected: Boolean(accountId),
    readyForCheckout: Boolean(accountId && chargesEnabled),
  };
}

function ensureRestaurantStripeCheckoutReady(restaurant) {
  const stripeStatus = getRestaurantStripeStatus(restaurant);
  if (!stripeStatus.readyForCheckout) {
    throw new AppError(
      'This restaurant has not connected Stripe yet.',
      409,
      'restaurant_card_payments_unavailable',
      {
        stripeConnected: stripeStatus.connected,
        stripeChargesEnabled: stripeStatus.chargesEnabled,
        stripePayoutsEnabled: stripeStatus.payoutsEnabled,
        stripeAccountStatus: stripeStatus.accountStatus,
      }
    );
  }
  return stripeStatus;
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

function formatPosPayment(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    restaurantId: String(row.restaurant_id),
    orderId: String(row.food_order_id),
    paymentType: row.payment_type,
    amountCents: Number(row.amount_cents || 0),
    status: row.status,
    provider: row.provider || null,
    reference: row.reference || null,
    idempotencyKey: row.idempotency_key || null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function buildWalletPaymentResponse({
  status,
  amountCents,
  currencyCode,
  walletResult = null,
  ledgerEntry = null,
  posPayment = null,
  replayed = false,
  refunded = false,
  reason = null,
}) {
  const entry = ledgerEntry || walletResult?.entry || null;
  const account = walletResult?.account || null;
  return {
    mode: 'wallet_credit',
    status,
    amountCents: Number(amountCents || entry?.amount_cents || 0),
    amount: Number(amountCents || entry?.amount_cents || 0) / 100,
    currencyCode: normalizeCurrency(currencyCode || entry?.currency_code || account?.currency_code),
    replayed: Boolean(replayed || walletResult?.replayed),
    refunded: Boolean(refunded),
    reason,
    wallet: {
      accountId: account?.id ? String(account.id) : (entry?.account_id ? String(entry.account_id) : null),
      balanceAfterCents: entry?.balance_after_cents === undefined || entry?.balance_after_cents === null
        ? null
        : Number(entry.balance_after_cents),
      ledgerEntry: formatLedgerRow(entry),
    },
    posPayment: formatPosPayment(posPayment),
  };
}

function buildOxsteedCreditPaymentResponse({ status, amountCents, currencyCode, transaction = null, replayed = false, reason = null }) {
  return {
    mode: 'oxsteed_credit',
    status,
    amountCents: Number(amountCents || transaction?.amountCents || 0),
    amount: formatCreditAmount(amountCents || transaction?.amountCents || 0, currencyCode),
    currencyCode: normalizeCurrency(currencyCode || transaction?.currencyCode),
    transactionId: transaction?.id ? String(transaction.id) : null,
    transaction: transaction || null,
    replayed: Boolean(replayed || transaction?.replayed),
    reason,
  };
}

function normalizeString(value, max = 255) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function canonicalIdempotencyAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount) : String(value ?? '');
}

function buildFoodOrderIdempotencyFingerprint({ restaurantId, paymentMode, request }) {
  const fulfillmentType = normalizeString(request.fulfillmentType || request.fulfillment_type, 24) || 'pickup';
  const orderSource = normalizeString(request.orderSource || request.order_source, 24) || 'mobile';
  const rawItems = Array.isArray(request.items) ? request.items : [];
  const items = rawItems.map((item) => {
    const rawModifierIds = Array.isArray(item?.modifierIds || item?.modifier_ids)
      ? (item.modifierIds || item.modifier_ids)
      : [];
    return {
      menuItemId: parsePositiveInt(item?.menuItemId || item?.menu_item_id),
      quantity: parsePositiveInt(item?.quantity, 1),
      modifierIds: rawModifierIds
        .map((modifierId) => parsePositiveInt(modifierId))
        .sort((left, right) => (left || 0) - (right || 0)),
      specialInstructions: normalizeString(item?.specialInstructions || item?.special_instructions, 500),
    };
  });

  const deliveryAddress = fulfillmentType === 'delivery'
    ? normalizeDeliveryAddress(request.deliveryAddress || request.delivery_address)
    : null;
  const discountCode = normalizeString(request.discountCode || request.discount_code, 40);
  const loyaltyPoints = parsePositiveInt(
    request.loyaltyPointsToRedeem ?? request.loyalty_points_to_redeem,
    0
  ) || 0;
  const externalPayment = normalizeFoodExternalPaymentSubmission(
    request.externalPayment
      || request.external_payment
      || request.paymentProof
      || request.payment_proof
      || request.metadata?.externalPayment
      || request.metadata?.paymentProof
  );
  const fingerprintInput = {
    version: 2,
    restaurantId: Number(restaurantId),
    paymentMode,
    fulfillmentType,
    orderSource,
    items,
    deliveryAddress,
    tipCents: canonicalIdempotencyAmount(request.tipCents ?? request.tip_cents ?? 0),
    discountCode: discountCode ? discountCode.toUpperCase() : null,
    loyaltyPoints,
    guestName: normalizeString(request.guestName || request.guest_name, 140),
    guestPhone: normalizeString(request.guestPhone || request.guest_phone, 40),
    guestEmail: normalizeString(request.guestEmail || request.guest_email, 255),
    tableLabel: normalizeString(request.tableLabel || request.table_label, 80),
    notes: normalizeString(request.notes, 1000),
    kitchenNotes: normalizeString(request.kitchenNotes || request.kitchen_notes, 1000),
    pickupContactName: normalizeString(request.pickupContactName || request.pickup_contact_name, 120),
    pickupContactPhone: normalizeString(request.pickupContactPhone || request.pickup_contact_phone, 40),
    scheduledFor: normalizeString(request.scheduledFor || request.scheduled_for, 64),
    stripePaymentIntentId: normalizeString(
      request.stripePaymentIntentId || request.stripe_payment_intent_id,
      255
    ),
    externalPayment,
  };
  return crypto.createHash('sha256').update(JSON.stringify(fingerprintInput)).digest('hex');
}

function assertFoodOrderIdempotencyMatch(order, fingerprint, clientOrderId) {
  const idempotency = order?.metadata?.idempotency;
  const recordedFingerprint = idempotency?.requestFingerprint
    || order?.metadata?.idempotencyRequestFingerprint;
  // Orders created before fingerprints were introduced remain replayable, as
  // do v1 fingerprints which predate the checkout fields (kitchen notes,
  // pickup contact, scheduled time, card intent) added to the fingerprint.
  if (!recordedFingerprint || Number(idempotency?.version) < 2) return;
  if (recordedFingerprint === fingerprint) return;
  throw new AppError(
    'This idempotency key was already used for a different order request',
    409,
    'food_order_idempotency_conflict',
    { clientOrderId }
  );
}

function buildFoodOrderIdempotencyLookup({ restaurantId, customerId, clientOrderId }) {
  if (customerId) {
    return {
      text: `SELECT * FROM food_orders
            WHERE restaurant_id = $1
              AND customer_id = $2
              AND metadata->>'clientOrderId' = $3
            LIMIT 1`,
      values: [restaurantId, customerId, clientOrderId],
    };
  }
  return {
    text: `SELECT * FROM food_orders
          WHERE restaurant_id = $1
            AND customer_id IS NULL
            AND metadata->>'clientOrderId' = $2
          LIMIT 1`,
    values: [restaurantId, clientOrderId],
  };
}

function normalizeFoodPaymentMode(value) {
  const requested = normalizeString(value, 40) || 'pay_at_restaurant';
  const canonical = FOOD_PAYMENT_MODE_ALIASES[requested];
  if (!canonical) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      paymentMode: 'Must be pay_now, card, restaurant_credit, oxsteed_credit, pay_at_restaurant, or direct_payment',
    });
  }
  return {
    canonical,
    legacy: FOOD_PAYMENT_LEGACY_MODE[canonical],
  };
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

function orderModifierGroupsForMenuItem(menuItem) {
  if (!Array.isArray(menuItem?.modifier_groups)) return [];
  return menuItem.modifier_groups.filter((group) => group && group.id);
}

function resolveOrderItemModifiers(menuItem, item, index) {
  const rawModifierIds = Array.isArray(item.modifierIds || item.modifier_ids)
    ? (item.modifierIds || item.modifier_ids)
    : [];
  const groups = orderModifierGroupsForMenuItem(menuItem);
  const groupsById = new Map(groups.map((group) => [Number(group.id), group]));
  const modifiersById = new Map();
  for (const group of groups) {
    for (const modifier of Array.isArray(group.options) ? group.options : []) {
      if (modifier?.id) modifiersById.set(Number(modifier.id), { ...modifier, groupId: Number(group.id) });
    }
  }

  const selectedByGroup = new Map();
  const selectedModifiers = [];
  const seenModifierIds = new Set();
  for (const rawId of rawModifierIds) {
    const modifierId = parsePositiveInt(rawId);
    if (!modifierId || seenModifierIds.has(modifierId)) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        [`items.${index}.modifierIds`]: 'Modifier selections must contain unique valid options',
      });
    }
    seenModifierIds.add(modifierId);
    const modifier = modifiersById.get(modifierId);
    if (!modifier || modifier.is_available === false) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        [`items.${index}.modifierIds`]: 'One or more selected options are not available for this menu item',
      });
    }
    const group = groupsById.get(modifier.groupId);
    if (!group) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        [`items.${index}.modifierIds`]: 'One or more selected options are not available for this menu item',
      });
    }
    const selected = selectedByGroup.get(modifier.groupId) || [];
    const maxSelect = Math.max(0, Number(group.max_select ?? group.maxSelect ?? 1));
    if (selected.length >= maxSelect) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        [`items.${index}.modifierIds`]: `Choose no more than ${maxSelect} option${maxSelect === 1 ? '' : 's'} from ${group.name}`,
      });
    }
    selected.push(modifier);
    selectedByGroup.set(modifier.groupId, selected);
    selectedModifiers.push(modifier);
  }

  for (const group of groups) {
    const selectedCount = (selectedByGroup.get(Number(group.id)) || []).length;
    const configuredMin = Math.max(0, Number(group.min_select ?? group.minSelect ?? 0));
    const minSelect = group.is_required ? Math.max(1, configuredMin) : configuredMin;
    const maxSelect = Math.max(0, Number(group.max_select ?? group.maxSelect ?? 1));
    if (selectedCount < minSelect) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        [`items.${index}.modifierIds`]: `Choose at least ${minSelect} option${minSelect === 1 ? '' : 's'} from ${group.name}`,
      });
    }
    if (selectedCount > maxSelect) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        [`items.${index}.modifierIds`]: `Choose no more than ${maxSelect} option${maxSelect === 1 ? '' : 's'} from ${group.name}`,
      });
    }
  }

  return selectedModifiers;
}

exports.resolveOrderItemModifiers = resolveOrderItemModifiers;
exports.buildFoodOrderIdempotencyFingerprint = buildFoodOrderIdempotencyFingerprint;

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
  // M12: the old code accepted ANY absolute URL on the unauthenticated
  // checkout complete/cancel endpoints — a phishing-ready open redirect.
  // Relative paths are anchored to the public site; absolute URLs must stay
  // on the site's own host.
  // Protocol-relative URLs ("//evil.example/...") are not same-site links.
  if (raw.startsWith('//')) return null;
  if (raw.startsWith('/')) return absoluteUrl(raw);
  if (/^https?:\/\//i.test(raw)) {
    try {
      const siteHost = new URL(getPublicSiteUrl()).host.toLowerCase();
      const targetHost = new URL(raw).host.toLowerCase();
      if (targetHost === siteHost) return raw;
    } catch {
      return null;
    }
    return null;
  }
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

const RESTAURANT_SORTS = new Set(['recommended', 'rating', 'fastest', 'distance']);

function normalizeRestaurantSort(value) {
  const sort = String(value || '').trim().toLowerCase();
  return RESTAURANT_SORTS.has(sort) ? sort : 'recommended';
}

function restaurantListResponse(rows, limit, offset) {
  const total = Number(rows[0]?.total_count);
  const safeTotal = Number.isSafeInteger(total) && total >= 0 ? total : rows.length;
  const restaurants = rows.map(({ total_count: _totalCount, ...row }) => attachRestaurantHours(row));
  const nextOffset = offset + restaurants.length;
  return {
    restaurants,
    limit,
    offset,
    pagination: {
      limit,
      offset,
      total: safeTotal,
      hasMore: nextOffset < safeTotal,
      nextOffset: nextOffset < safeTotal ? nextOffset : null,
    },
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

// Customer time-slot selections on the restaurant ordering page. The offset
// shifts promised_at forward from the normal prep-time estimate.
const DELIVERY_SLOT_OFFSET_MINUTES = { asap: 0, '+15': 15, '+30': 30, later: 0 };

function normalizeDeliverySlot(value) {
  if (value === undefined || value === null || value === '') return { slot: null, offsetMinutes: 0 };
  const slot = normalizeString(value, 24);
  if (!Object.prototype.hasOwnProperty.call(DELIVERY_SLOT_OFFSET_MINUTES, slot)) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      deliverySlot: 'Unsupported delivery time slot',
    });
  }
  return { slot, offsetMinutes: DELIVERY_SLOT_OFFSET_MINUTES[slot] };
}

// Guards the "blank delivery address becomes the restaurant's address"
// fallback: a delivery order needs the customer's own address, never the
// restaurant's.
function assertValidDeliveryAddress(deliveryAddress, restaurant) {
  if (!deliveryAddress || !deliveryAddress.line1) {
    throw new AppError('A delivery address is required for delivery orders', 400, 'delivery_address_required', {
      deliveryAddress: 'Delivery address is required for delivery orders',
    });
  }
  const restaurantStreet = normalizeString(restaurant && restaurant.address_street, 255);
  if (
    restaurantStreet
    && normalizeString(deliveryAddress.line1, 255).toLowerCase() === restaurantStreet.toLowerCase()
  ) {
    throw new AppError('Delivery address cannot be the restaurant address', 400, 'delivery_address_is_restaurant', {
      deliveryAddress: 'Enter your own delivery address for this order',
    });
  }
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
    let promo = rows[0];
    if (!promo) {
      const global = await client.query(
        `SELECT id, code, description AS title, discount_type, discount_amount,
                max_discount_cents, min_order_cents
           FROM discount_codes
          WHERE UPPER(code) = UPPER($1)
            AND status = 'active'
            AND (start_date IS NULL OR start_date <= NOW())
            AND (end_date IS NULL OR end_date >= NOW())
            AND (usage_limit IS NULL OR usage_count < usage_limit)
          LIMIT 1`,
        [normalized]
      );
      promo = global.rows[0];
      if (!promo) return { discountCents: 0, metadata: null, promotionId: null };
      if (subtotalCents < Number(promo.min_order_cents || 0)) {
        throw new AppError('Validation failed', 400, 'validation_failed', {
          discountCode: `Minimum subtotal not met for promotion ${normalized}`,
        });
      }
      let discountCents = 0;
      if (promo.discount_type === 'percentage') {
        discountCents = Math.round(subtotalCents * Number(promo.discount_amount || 0) / 100);
        if (promo.max_discount_cents != null) {
          discountCents = Math.min(discountCents, Number(promo.max_discount_cents || 0));
        }
      } else {
        discountCents = Number(promo.discount_amount || 0);
      }
      discountCents = Math.min(subtotalCents, Math.max(0, discountCents));
      return {
        discountCents,
        promotionId: null,
        metadata: {
          code: promo.code,
          label: promo.title || promo.description || promo.code,
          amountCents: discountCents,
          discountCodeId: promo.id,
          source: 'discount_codes',
        },
      };
    }
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

// M13: points earned on completion must be clawed back when the order is
// cancelled/refunded, or customers can farm loyalty points on refunded
// orders. Idempotent on the ledger: only claws back an 'order_completed'
// award that has no matching 'order_refunded' row, and never drives the
// balance below zero.
async function clawBackFoodLoyaltyOnRefund(client, order) {
  if (!order.customer_id) return null;
  try {
    const { rows: [account] } = await client.query(
      `SELECT id FROM food_loyalty_accounts
        WHERE restaurant_id = $1 AND customer_id = $2
        FOR UPDATE`,
      [order.restaurant_id, order.customer_id]
    );
    if (!account) return null;
    const { rows: [earned] } = await client.query(
      `SELECT id, delta_points
         FROM food_loyalty_ledger
        WHERE account_id = $1 AND order_id = $2 AND reason = 'order_completed'
        ORDER BY id DESC
        LIMIT 1`,
      [account.id, order.id]
    );
    if (!earned) return null;
    const { rows: [alreadyClawedBack] } = await client.query(
      `SELECT id FROM food_loyalty_ledger
        WHERE account_id = $1 AND order_id = $2 AND reason = 'order_refunded'
        LIMIT 1`,
      [account.id, order.id]
    );
    if (alreadyClawedBack) return null;
    const points = Math.max(0, Number(earned.delta_points || 0));
    if (points <= 0) return null;
    await client.query(
      `UPDATE food_loyalty_accounts
          SET points_balance = GREATEST(0, points_balance - $1),
              updated_at = NOW()
        WHERE id = $2`,
      [points, account.id]
    );
    await client.query(
      `INSERT INTO food_loyalty_ledger (account_id, order_id, delta_points, reason)
       VALUES ($1, $2, $3, 'order_refunded')`,
      [account.id, order.id, -points]
    );
    logger.info('Clawed back food loyalty points for refunded order', {
      orderId: order.id,
      accountId: account.id,
      points,
    });
    return { accountId: account.id, points };
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

function publicQueueGuestLabel(order, { showGuestNames = false } = {}) {
  const tableLabel = normalizeString(order.table_label, 80);
  if (tableLabel) {
    return /^table/i.test(tableLabel) ? tableLabel : `Table ${tableLabel}`;
  }
  const guestName = showGuestNames ? normalizeString(order.guest_name, 140) : null;
  if (guestName) {
    const first = guestName.split(/\s+/)[0];
    return first ? first.slice(0, 24) : 'Guest';
  }
  return 'Guest';
}

function publicTrackedOrder(order) {
  if (!order) return null;
  return {
    id: order.id,
    restaurant_id: order.restaurant_id,
    status: order.status,
    payment_status: order.payment_status,
    order_source: order.order_source,
    fulfillment_type: order.fulfillment_type,
    subtotal_cents: order.subtotal_cents,
    tax_cents: order.tax_cents,
    service_fee_cents: order.service_fee_cents,
    delivery_fee_cents: order.delivery_fee_cents,
    tip_cents: order.tip_cents,
    discount_cents: order.discount_cents,
    total_cents: order.total_cents,
    currency_code: order.currency_code,
    table_label: order.table_label,
    queue_number: order.queue_number,
    promised_at: order.promised_at,
    created_at: order.created_at,
    updated_at: order.updated_at,
    accepted_at: order.accepted_at,
    ready_at: order.ready_at,
    completed_at: order.completed_at,
    cancelled_at: order.cancelled_at,
    restaurant_name: order.restaurant_name,
    prep_time_min: order.prep_time_min,
    has_review: order.has_review,
    items: Array.isArray(order.items)
      ? order.items.map((item) => ({
        id: item.id,
        itemName: item.itemName,
        quantity: item.quantity,
        lineTotalCents: item.lineTotalCents,
      }))
      : [],
  };
}

const PUBLIC_RESTAURANT_SETTING_KEYS = [
  'deliveryFeeCents',
  'delivery_fee_cents',
  'minimumOrderCents',
  'minimum_order_cents',
  'externalPaymentEnabled',
  'external_payment_enabled',
  'requireExternalPaymentProof',
  'require_external_payment_proof',
  'externalPaymentLabel',
  'external_payment_label',
  'externalPaymentHandle',
  'external_payment_handle',
  'externalPaymentInstructions',
  'external_payment_instructions',
  'externalPaymentReferenceHint',
  'external_payment_reference_hint',
  'externalPaymentQrUrl',
  'external_payment_qr_url',
  'priceRange',
  'price_range',
  'requireGuestNameForPickup',
  'require_guest_name_for_pickup',
  'requireContactForUpdates',
  'require_contact_for_updates',
];

function publicRestaurantPayload(restaurant) {
  if (!restaurant) return null;
  const sourceSettings = restaurant.settings && typeof restaurant.settings === 'object'
    ? restaurant.settings
    : {};
  const settings = Object.fromEntries(
    PUBLIC_RESTAURANT_SETTING_KEYS
      .filter((key) => sourceSettings[key] !== undefined && sourceSettings[key] !== null)
      .map((key) => [key, sourceSettings[key]])
  );
  return {
    id: restaurant.id,
    business_id: restaurant.business_id,
    display_name: restaurant.display_name,
    slug: restaurant.slug,
    description: restaurant.description,
    cuisine_tags: restaurant.cuisine_tags,
    cover_photo_url: restaurant.cover_photo_url,
    logo_url: restaurant.logo_url,
    address_city: restaurant.address_city,
    address_state: restaurant.address_state,
    address_country: restaurant.address_country,
    latitude: restaurant.latitude,
    longitude: restaurant.longitude,
    currency_code: restaurant.currency_code,
    fulfillment_modes: restaurant.fulfillment_modes,
    accepts_online_orders: restaurant.accepts_online_orders,
    accepts_in_store_orders: restaurant.accepts_in_store_orders,
    kitchen_display_enabled: restaurant.kitchen_display_enabled,
    prep_time_min: restaurant.prep_time_min,
    estimated_delivery_minutes: restaurant.estimated_delivery_minutes,
    price_level: restaurant.price_level,
    is_accepting_orders_now: restaurant.is_accepting_orders_now,
    temporarily_closed_until: restaurant.temporarily_closed_until,
    minimum_order_cents: restaurant.minimum_order_cents,
    delivery_fee_cents: restaurant.delivery_fee_cents,
    service_area_radius_meters: restaurant.service_area_radius_meters,
    order_count: restaurant.order_count,
    last_ordered_at: restaurant.last_ordered_at,
    last_reviewed_at: restaurant.last_reviewed_at,
    brand_accent_hex: restaurant.brand_accent_hex,
    operating_hours: restaurant.operating_hours,
    timezone: restaurant.timezone,
    is_open: restaurant.is_open,
    hours_message: restaurant.hours_message,
    opens_at: restaurant.opens_at,
    closes_at: restaurant.closes_at,
    is_verified: restaurant.is_verified,
    dietary_tags: restaurant.dietary_tags,
    avg_rating: restaurant.avg_rating,
    review_count: restaurant.review_count,
    stripe_charges_enabled: normalizeBoolean(
      restaurant.stripe_charges_enabled
        ?? restaurant.business_stripe_charges_enabled,
      false
    ),
    settings,
  };
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
      <small>You can return to the Local Food Directory app at any time.</small>
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
    const connectedAccountId = normalizeString(
      order.metadata?.stripeCheckout?.connectedAccountId
        || order.metadata?.stripe_checkout?.connectedAccountId,
      255
    );
    const paymentIntent = await stripe.paymentIntents.retrieve(
      order.stripe_payment_intent_id,
      connectedAccountId ? { stripeAccount: connectedAccountId } : undefined
    );
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
  connectedAccountId,
}) {
  if (!hasRestaurantStripeCheckout()) {
    throw new AppError('Stripe payments are not configured', 503, 'stripe_not_configured');
  }
  const stripeAccountId = normalizeString(connectedAccountId, 255);

  // H12: never create a second Checkout Session for an order that already has
  // one. The session id is stamped on the order at creation; retries and the
  // resume endpoint replay the existing session instead of charging twice.
  const existingSessionId = normalizeString(order.metadata?.checkoutSessionId, 255);
  if (existingSessionId) {
    return {
      order,
      payment: {
        mode: 'hosted_checkout',
        status: 'requires_payment',
        checkoutSessionId: existingSessionId,
        replayed: true,
      },
      replayed: true,
    };
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
          || 'Local Food Directory order',
      },
    },
  }];

  const successUrlBase = absoluteUrl(`/api/food/orders/${order.id}/checkout/complete`);
  const successUrl = `${successUrlBase}?session_id={CHECKOUT_SESSION_ID}${returnUrl ? `&return_url=${encodeURIComponent(returnUrl)}` : ''}`;
  const cancelUrlBase = absoluteUrl(`/api/food/orders/${order.id}/checkout/cancelled`);
  const trackingToken = normalizeString(
    order.metadata?.trackingToken || order.metadata?.tracking_token,
    255
  );
  const cancelUrl = `${cancelUrlBase}?tracking_token=${encodeURIComponent(trackingToken || '')}${returnUrl ? `&return_url=${encodeURIComponent(returnUrl)}` : ''}`;

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
      connected_account_id: stripeAccountId || '',
    },
    payment_intent_data: {
      metadata: {
        food_order_id: String(order.id),
        restaurant_id: String(order.restaurant_id),
        business_id: String(order.business_id),
        connected_account_id: stripeAccountId || '',
      },
    },
  }, {
    // H12: deterministic per-order key. A retried order creation that replays
    // the same order id resolves to the same Stripe session instead of
    // authorizing a second charge.
    ...(stripeAccountId ? { stripeAccount: stripeAccountId } : {}),
    idempotencyKey: `food-order-checkout:${order.id}`,
  });

  const { rows: [updatedOrder] } = await pool.query(
    `UPDATE food_orders
        SET payment_status = 'requires_payment',
            stripe_payment_intent_id = COALESCE($1, stripe_payment_intent_id),
            metadata = jsonb_set(
              jsonb_set(
                jsonb_set(COALESCE(metadata, '{}'::jsonb), '{checkoutSessionId}', to_jsonb($2::text), true),
                '{paymentMode}',
                to_jsonb('pay_now'::text),
                true
              ),
              '{stripeCheckout}',
              to_jsonb(
                json_build_object(
                  'connectedAccountId', $4::text,
                  'sessionId', $2::text
                )
              ),
              true
            ),
            updated_at = NOW()
      WHERE id = $3
      RETURNING *`,
    [
      typeof session.payment_intent === 'string' ? session.payment_intent : null,
      session.id,
      order.id,
      stripeAccountId || null,
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

// C5: Refund the Stripe charge behind a paid pay_now food order when the order
// is cancelled or refunded. The refund is idempotency-keyed per order and the
// POS refund row dedupes on (restaurant_id, idempotency_key), so retries and
// the charge.refunded webhook cannot double-refund. Runs inside the caller's
// transaction so a failed refund rolls back the status transition.
async function refundFoodOrderStripePayment(client, { order, restaurantId, createdByUserId = null, status = 'refunded' }) {
  if (!hasRestaurantStripeCheckout()) {
    throw new AppError('Stripe payments are not configured', 503, 'stripe_not_configured');
  }
  const connectedAccountId = normalizeString(
    order.metadata?.stripeCheckout?.connectedAccountId
      || order.metadata?.stripe_checkout?.connectedAccountId,
    255
  );
  let refund;
  try {
    refund = await stripe.refunds.create(
      { payment_intent: order.stripe_payment_intent_id },
      {
        stripeAccount: connectedAccountId || undefined,
        idempotencyKey: `food-order:${order.id}:refund`,
      }
    );
  } catch (refundErr) {
    logger.error('Stripe refund failed for food order', {
      orderId: order.id,
      paymentIntentId: order.stripe_payment_intent_id,
      error: refundErr.message,
    });
    throw new AppError('The card refund could not be processed', 502, 'stripe_refund_failed', { orderId: order.id });
  }
  const chargeId = typeof refund.charge === 'string' ? refund.charge : refund.charge?.id || null;
  const { rows: posRows } = await client.query(
    `INSERT INTO restaurant_pos_payments
       (restaurant_id, food_order_id, shift_id, payment_type, amount_cents, status,
        provider, provider_payment_intent_id, provider_charge_id, idempotency_key,
        reference, note, metadata)
     VALUES ($1, $2, NULL, 'refund', $3, 'refunded', 'stripe_checkout', $4, $5, $6, $5, $7, $8::jsonb)
     ON CONFLICT (restaurant_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
     RETURNING *`,
    [
      restaurantId,
      order.id,
      Number(refund.amount || 0),
      order.stripe_payment_intent_id,
      chargeId,
      `food-order-refund:${order.id}`,
      'Card refund for cancelled order',
      JSON.stringify({ stripeRefundId: refund.id, orderStatus: status, createdByUserId }),
    ]
  );
  return { refund, chargeId, posPayment: posRows[0] || null };
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
            END AS effective_role,
            (SELECT bm.id
               FROM business_members bm
              WHERE bm.business_id = fr.business_id
                AND bm.member_id = $2
                AND bm.status = 'active'
              LIMIT 1) AS effective_membership_id
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1`,
    [restaurantId, userId]
  );
  const restaurant = rows[0];
  if (!restaurant || !restaurant.effective_role) {
    throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  }
  restaurant.access_user_id = userId;
  return restaurant;
}

async function getRestaurantPermissions(restaurant) {
  if (restaurant.effective_role === 'owner') return new Set(['*']);
  const { permissions } = await permissionsService.getEffectivePermissions({
    businessId: restaurant.business_id,
    userId: restaurant.access_user_id,
    role: restaurant.effective_role,
    membershipId: restaurant.effective_membership_id,
  });
  return permissions;
}

async function assertRestaurantPermission(restaurant, requested, message = 'You do not have permission to manage this restaurant') {
  if (restaurant.effective_role === 'owner') return;
  const permissions = await getRestaurantPermissions(restaurant);
  if (!permissionsService.hasAny(permissions, requested)) {
    throw new AppError(message, 403, 'forbidden', { requiredPermissions: requested });
  }
}

async function hasRestaurantPermission(restaurant, requested) {
  if (restaurant.effective_role === 'owner') return true;
  const permissions = await getRestaurantPermissions(restaurant);
  return permissionsService.hasAny(permissions, requested);
}

async function assertRestaurantManage(restaurant) {
  if (restaurant.effective_role === 'owner') return;
  await assertRestaurantPermission(restaurant, ['restaurant.manage', 'settings.manage']);
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

// Transactional ladder: order accepted / preparing milestones. Fire-and-forget
// like notifyFoodOrderReady; the notification service handles localization,
// quiet hours, per-user prefs, and idempotency via the delivery key.
async function notifyFoodOrderMilestone(order, restaurant, status) {
  try {
    if (!order || !order.customer_id) return;
    if (status !== 'accepted' && status !== 'preparing') return;
    const queue = order.queue_number != null ? `#${order.queue_number}` : '';
    const place = (restaurant && restaurant.display_name) ? restaurant.display_name : 'the restaurant';
    const boardUrl = absoluteUrl(`/restaurants/queue/${order.restaurant_id}`);
    await notificationService.sendNotification({
      userId: order.customer_id,
      type: status === 'accepted' ? 'food_order_accepted' : 'food_order_preparing',
      title: status === 'accepted' ? 'Order confirmed' : 'Your food is being prepared',
      body: status === 'accepted'
        ? `Your order ${queue} at ${place} was confirmed.`.replace(/\s+/g, ' ').trim()
        : `The kitchen at ${place} started working on your order ${queue}.`.replace(/\s+/g, ' ').trim(),
      data: {
        orderId: String(order.id),
        restaurantId: String(order.restaurant_id),
        queueNumber: order.queue_number != null ? String(order.queue_number) : null,
        status,
      },
      action_url: boardUrl,
      idempotencyKey: `food-order:${order.id}:${status}`,
    });
  } catch (err) {
    logger.warn('notifyFoodOrderMilestone failed (non-blocking)', { error: err && err.message, orderId: order && order.id, status });
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
              COALESCE(MIN(NULLIF(trim(fr.currency_code), '')), 'USD') AS currency_code,
              COUNT(*)::int AS restaurant_count
         FROM food_restaurants fr
         JOIN businesses b ON b.id = fr.business_id
        WHERE fr.status = 'active'
          AND fr.discovery_status = 'visible'
          AND COALESCE(fr.is_hidden_by_admin, FALSE) = FALSE
          AND b.is_active = TRUE
          AND b.is_listed = TRUE
          AND COALESCE(b.setup_status, 'active') = 'active'
          AND COALESCE(b.business_kind, 'restaurant') = 'restaurant'
          AND b.deleted_at IS NULL
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
    const sort = normalizeRestaurantSort(req.query.sort);
    const params = [];
    const filters = [
      `fr.status = 'active'`,
      `fr.discovery_status = 'visible'`,
      // H5: admin-hidden restaurants stay out of public discovery.
      `COALESCE(fr.is_hidden_by_admin, FALSE) = FALSE`,
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
    // Effective-featured is stateless: expiry is evaluated in the query, so no
    // sweeper job is needed. NULL featured_until = open-ended feature.
    const effectiveFeaturedSql = `(fr.is_featured AND (fr.featured_until IS NULL OR fr.featured_until > NOW()))`;
    let distanceSelect = 'NULL::double precision AS distance_km';
    let orderBy = `${effectiveFeaturedSql} DESC, fr.featured_rank ASC, fr.avg_rating DESC, fr.rating_count DESC, fr.order_count DESC, fr.display_name ASC`;
    if (sort === 'rating') {
      orderBy = `fr.avg_rating DESC, fr.rating_count DESC, ${effectiveFeaturedSql} DESC, fr.display_name ASC`;
    } else if (sort === 'fastest') {
      orderBy = `COALESCE(fr.estimated_delivery_minutes, fr.prep_time_min, 999999) ASC, ${effectiveFeaturedSql} DESC, fr.display_name ASC`;
    }
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
      orderBy = sort === 'distance'
        ? `distance_km ASC, ${effectiveFeaturedSql} DESC, fr.display_name ASC`
        : orderBy;
    }

    // featured_only=true returns just the effectively-featured set, ordered
    // by admin rank then rating. Visibility/hold guards still apply.
    const featuredOnly = String(req.query.featured_only || '').toLowerCase() === 'true';
    if (featuredOnly) {
      filters.push(effectiveFeaturedSql);
      orderBy = 'fr.featured_rank ASC, fr.avg_rating DESC';
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
              fr.is_featured, fr.featured_rank, fr.featured_until, fr.discovery_status,
              fr.is_accepting_orders_now, fr.temporarily_closed_until,
              fr.minimum_order_cents, fr.delivery_fee_cents,
              fr.service_area_radius_meters, fr.order_count,
              fr.last_ordered_at, fr.last_reviewed_at,
              fr.brand_accent_hex, fr.operating_hours, fr.timezone, fr.is_verified,
              fr.dietary_tags,
              COALESCE(fr.avg_rating, 0)::float AS avg_rating,
              COALESCE(fr.rating_count, 0)::int AS review_count,
              COALESCE(fr.rating_count, 0)::int AS total_reviews,
              COUNT(*) OVER()::int AS total_count,
              ${distanceSelect}
         FROM food_restaurants fr
         JOIN businesses b ON b.id = fr.business_id
        WHERE ${filters.join(' AND ')}
          AND b.is_active = TRUE
          AND b.is_listed = TRUE
          AND COALESCE(b.setup_status, 'active') = 'active'
          AND COALESCE(b.business_kind, 'restaurant') = 'restaurant'
          AND b.deleted_at IS NULL
        ORDER BY ${orderBy}
        LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
      params
    );

    res.json(restaurantListResponse(rows, limit, offset));
  } catch (err) {
    if (!isMissingRelationError(err)) return next(err);
    try {
      const limit = Math.min(parsePositiveInt(req.query.limit, 30), 100);
      const offset = Math.max(parsePositiveInt(req.query.offset, 0) || 0, 0);
      const sort = normalizeRestaurantSort(req.query.sort);
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
      let orderBy = sort === 'fastest'
        ? 'COALESCE(fr.prep_time_min, 999999) ASC, fr.display_name ASC'
        : 'fr.display_name ASC';
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
        orderBy = sort === 'distance'
          ? 'distance_km ASC, fr.display_name ASC'
          : orderBy;
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
                COUNT(*) OVER()::int AS total_count,
                ${distanceSelect}
           FROM food_restaurants fr
           JOIN businesses b ON b.id = fr.business_id
          WHERE ${filters.join(' AND ')}
            AND b.is_active = TRUE
            AND b.is_listed = TRUE
            AND COALESCE(b.setup_status, 'active') = 'active'
            AND COALESCE(b.business_kind, 'restaurant') = 'restaurant'
            AND b.deleted_at IS NULL
          ORDER BY ${orderBy}
          LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
        params
      );
      return res.json(restaurantListResponse(rows, limit, offset));
    } catch (retryErr) {
      return next(retryErr);
    }
  }
};

async function loadRestaurantMenu(restaurantId, { managed = false } = {}) {
  const { rows: categories } = await pool.query(
    `SELECT id, name, description, sort_order, is_active
       FROM food_menu_categories
      WHERE restaurant_id = $1 ${managed ? '' : 'AND is_active = TRUE'}
      ORDER BY sort_order, name`,
    [restaurantId]
  );
  const { rows: items } = await pool.query(
    `SELECT id, category_id, name, description, image_url, price_cents,
            currency_code, is_available, sort_order, tags, allergens,
            publication_status, archived_at, availability_schedule
       FROM food_menu_items
      WHERE restaurant_id = $1
        ${managed ? '' : "AND publication_status = 'published' AND archived_at IS NULL"}
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

  const visibleItemIds = new Set(items.map((item) => Number(item.id)));
  const modifierGroupsByItem = new Map();
  for (const row of modifiers) {
    if (!visibleItemIds.has(Number(row.menu_item_id))) continue;
    if (!modifierGroupsByItem.has(row.menu_item_id)) modifierGroupsByItem.set(row.menu_item_id, new Map());
    const groups = modifierGroupsByItem.get(row.menu_item_id);
    if (!groups.has(row.group_id)) {
      groups.set(row.group_id, {
        id: row.group_id,
        name: row.group_name,
        minSelect: row.min_select,
        maxSelect: row.max_select,
        isRequired: row.is_required,
        sortOrder: row.group_sort_order,
        options: [],
      });
    }
    if (row.modifier_id) {
      groups.get(row.group_id).options.push({
        id: row.modifier_id,
        name: row.modifier_name,
        priceDeltaCents: row.price_delta_cents,
        isAvailable: row.is_available,
        sortOrder: row.modifier_sort_order,
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

  return {
    menu: categories.map((category) => ({
      ...category,
      items: itemsByCategory.get(category.id) || [],
    })),
    uncategorizedItems: itemsByCategory.get(0) || [],
  };
}

exports.getRestaurant = (req, res, next) => respondRestaurantProfile(req, res, next, false);
exports.getAdminProfilePreview = (req, res, next) => respondRestaurantProfile(req, res, next, true);

async function respondRestaurantProfile(req, res, next, adminPreview) {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId || req.params.id);
    if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');

    const { rows: restaurants } = await pool.query(
      `SELECT fr.*,
              b.stripe_charges_enabled AS business_stripe_charges_enabled
         FROM food_restaurants fr
         JOIN businesses b ON b.id = fr.business_id
        WHERE fr.id = $1
          AND b.deleted_at IS NULL
          ${adminPreview ? '' : `AND fr.status IN ('active', 'paused')
                    AND fr.discovery_status = 'visible'
                    AND COALESCE(fr.is_hidden_by_admin, FALSE) = FALSE
          AND b.is_active = TRUE
          AND b.is_listed = TRUE
          AND COALESCE(b.setup_status, 'active') IN ('active', 'paused')
          AND COALESCE(b.business_kind, 'restaurant') = 'restaurant'`}`,
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

    const menuData = await loadRestaurantMenu(restaurantId);

    const payload = publicRestaurantPayload(attachRestaurantHours(restaurant));
    if (!adminPreview) payload.oxsteed_pay_url = await getOwnerOxsteedPayUrl(restaurant.business_id);

    res.json({
      restaurant: payload,
      ...menuData,
    });
  } catch (err) {
    next(err);
  }
}

exports.getManagedRestaurantMenu = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertRestaurantPermission(restaurant, ['menu.view', 'menu.manage', 'restaurant.manage']);
    const menuData = await loadRestaurantMenu(restaurantId, { managed: true });
    res.json(menuData);
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
      const { getOrMintEntityId, grantLink } = require('../lib/entityIds');
      let businessId = parsePositiveInt(req.body.businessId || req.body.business_id);
      let businessCreatedHere = false;
      if (businessId) {
        const { rows } = await client.query(
          `SELECT id, business_kind, business_mode
             FROM businesses
            WHERE id = $1 AND user_id = $2`,
          [businessId, req.user.id]
        );
        if (!rows[0]) throw new AppError('Business not found', 404, 'business_not_found');
        if (
          (rows[0].business_kind && rows[0].business_kind !== 'restaurant')
          || (rows[0].business_mode && rows[0].business_mode !== 'food')
        ) {
          throw new AppError('This business is not a restaurant business', 409, 'business_kind_mismatch');
        }
        const { rows: [existingRestaurant] } = await client.query(
          'SELECT * FROM food_restaurants WHERE business_id = $1 LIMIT 1',
          [businessId]
        );
        if (existingRestaurant) return existingRestaurant;
      } else {
        const country = normalizeCountry(req.body.addressCountry || req.body.address_country);
        const timezone = normalizeString(req.body.timezone, 80) || 'UTC';
        const currencyCode = normalizeCurrency(req.body.currencyCode || req.body.currency_code);
        const { rows } = await client.query(
          `INSERT INTO businesses
             (user_id, business_name, business_type, description, website, phone,
              address_street, address_city, address_state, address_zip, address_country,
              is_primary, tax_rate, industry_category, business_mode, business_kind,
              setup_status, timezone, currency_code, is_active, is_listed)
           VALUES (
             $1,$2,'Restaurant',$3,$4,$5,$6,$7,$8,$9,$10,
             NOT EXISTS (SELECT 1 FROM businesses owned WHERE owned.user_id = $1),
             0,'food','food','restaurant','in_progress',$11,$12,TRUE,FALSE
           )
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
            country,
            timezone,
            currencyCode,
          ]
        );
        businessId = rows[0].id;
        businessCreatedHere = true;
      }

      const { rows: [restaurant] } = await client.query(
        `INSERT INTO food_restaurants
           (business_id, owner_user_id, display_name, cuisine_tags, description, phone, website,
            logo_url, cover_photo_url, address_street, address_city, address_state, address_zip, address_country,
            latitude, longitude, timezone, currency_code, fulfillment_modes,
            accepts_online_orders, accepts_in_store_orders, kitchen_display_enabled, status, prep_time_min,
            estimated_delivery_minutes, price_level, dietary_tags,
            is_accepting_orders_now, temporarily_closed_until, minimum_order_cents,
            delivery_fee_cents, service_area_radius_meters)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
         RETURNING *`,
        [
          businessId,
          req.user.id,
          name,
          normalizeTextArray(req.body.cuisineTags || req.body.cuisine_tags),
          normalizeString(req.body.description, 2000),
          normalizeString(req.body.phone, 40),
          normalizeString(req.body.website, 255),
          normalizeString(req.body.logoUrl || req.body.logo_url, 1000),
          normalizeString(req.body.coverPhotoUrl || req.body.cover_photo_url, 1000),
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
      // Mint universal entity IDs (migration 670) inside the same transaction.
      const ownerPersonId = await getOrMintEntityId(client, 'person', req.user.id);
      const businessPublicId = await getOrMintEntityId(client, 'business', businessId);
      const restaurantPublicId = await getOrMintEntityId(client, 'restaurant', restaurant.id);
      if (businessCreatedHere) {
        await grantLink(client, { subjectId: ownerPersonId, objectId: businessPublicId, relation: 'owns' });
      }
      await grantLink(client, { subjectId: ownerPersonId, objectId: restaurantPublicId, relation: 'owns' });
      await grantLink(client, { subjectId: restaurantPublicId, objectId: businessPublicId, relation: 'belongs_to' });
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
    await assertRestaurantPermission(restaurant, ['menu.manage', 'restaurant.manage']);
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
    await assertRestaurantPermission(restaurant, ['menu.manage', 'restaurant.manage']);
    const name = normalizeString(req.body.name, 160);
    if (!name) throw new AppError('Validation failed', 400, 'validation_failed', { name: 'Name is required' });

    const priceCents = parseMoneyCents(req.body.priceCents ?? req.body.price_cents, 'priceCents');
    const { rows: [item] } = await pool.query(
      `INSERT INTO food_menu_items
         (restaurant_id, category_id, name, description, image_url, price_cents,
          currency_code, is_available, manual_available, inventory_available,
          inventory_availability_state, sort_order, tags, allergens,
          publication_status, availability_schedule)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,TRUE,'available',$9,$10,$11,$12,$13)
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
        ['draft', 'published'].includes(req.body.publicationStatus || req.body.publication_status)
          ? (req.body.publicationStatus || req.body.publication_status)
          : 'published',
        req.body.availabilitySchedule && typeof req.body.availabilitySchedule === 'object'
          ? JSON.stringify(req.body.availabilitySchedule)
          : '{}',
      ]
    );
    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
};

exports.quoteOrder = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId || req.body.restaurantId || req.body.restaurant_id);
    if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    const paymentContract = normalizeFoodPaymentMode(req.body.paymentMode || req.body.payment_mode);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length) {
      throw new AppError('Validation failed', 400, 'validation_failed', { items: 'At least one item is required' });
    }

    const { rows: restaurants } = await pool.query(
      `SELECT fr.*,
              b.stripe_account_id AS business_stripe_account_id,
              b.stripe_charges_enabled AS business_stripe_charges_enabled,
              b.stripe_payouts_enabled AS business_stripe_payouts_enabled,
              b.stripe_account_status AS business_stripe_account_status
         FROM food_restaurants fr
         LEFT JOIN businesses b ON b.id = fr.business_id
        WHERE fr.id = $1
          AND fr.status IN ('active','paused')
                    AND fr.discovery_status = 'visible'
                    AND COALESCE(fr.is_hidden_by_admin, FALSE) = FALSE
          AND b.is_active = TRUE
          AND b.is_listed = TRUE
          AND COALESCE(b.setup_status, 'active') IN ('active', 'paused')
          AND COALESCE(b.business_kind, 'restaurant') = 'restaurant'
          AND b.deleted_at IS NULL`,
      [restaurantId]
    );
    const restaurant = restaurants[0];
    if (!restaurant) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    const stripeStatus = getRestaurantStripeStatus(restaurant);
    if (paymentContract.canonical === 'pay_now' && !stripeStatus.readyForCheckout) {
      throw new AppError(
        'This restaurant has not connected Stripe yet.',
        409,
        'restaurant_card_payments_unavailable',
        {
          stripeConnected: stripeStatus.connected,
          stripeChargesEnabled: stripeStatus.chargesEnabled,
          stripePayoutsEnabled: stripeStatus.payoutsEnabled,
          stripeAccountStatus: stripeStatus.accountStatus,
        }
      );
    }

    const orderSource = normalizeString(req.body.orderSource || req.body.order_source, 24) || 'kiosk';
    const fulfillmentType = normalizeString(req.body.fulfillmentType || req.body.fulfillment_type, 24) || 'pickup';
    if (!VALID_ORDER_SOURCES.has(orderSource)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { orderSource: 'Unsupported order source' });
    }
    if (!VALID_FULFILLMENT.has(fulfillmentType)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { fulfillmentType: 'Unsupported fulfillment type' });
    }
    const isInStore = IN_STORE_SOURCES.has(orderSource);
    if (isInStore ? !restaurant.accepts_in_store_orders : !restaurant.accepts_online_orders) {
      throw new AppError('Restaurant is not accepting orders from this channel', 409, 'restaurant_not_accepting_orders');
    }
    const restaurantFulfillmentModes = Array.isArray(restaurant.fulfillment_modes) && restaurant.fulfillment_modes.length
      ? restaurant.fulfillment_modes
      : ['pickup'];
    if (!restaurantFulfillmentModes.includes(fulfillmentType)) {
      throw new AppError('This fulfillment mode is not available', 409, 'fulfillment_mode_unavailable');
    }
    const itemIds = items.map((item) => parsePositiveInt(item.menuItemId || item.menu_item_id)).filter(Boolean);
    const { rows: menuRows } = await pool.query(
      `SELECT fmi.id, fmi.name, fmi.price_cents, fmi.currency_code, fmi.is_available,
              fmc.name AS category_name,
              COALESCE((
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'id', mg.id,
                    'name', mg.name,
                    'min_select', mg.min_select,
                    'max_select', mg.max_select,
                    'is_required', mg.is_required,
                    'options', COALESCE((
                      SELECT jsonb_agg(
                        jsonb_build_object(
                          'id', fm.id,
                          'name', fm.name,
                          'price_delta_cents', fm.price_delta_cents,
                          'is_available', fm.is_available
                        ) ORDER BY fm.sort_order, fm.id
                      )
                      FROM food_modifiers fm
                      WHERE fm.modifier_group_id = mg.id
                    ), '[]'::jsonb)
                  ) ORDER BY mg.sort_order, mg.id
                )
                FROM food_modifier_groups mg
                WHERE mg.restaurant_id = fmi.restaurant_id
                  AND mg.menu_item_id = fmi.id
              ), '[]'::jsonb) AS modifier_groups
         FROM food_menu_items fmi
         LEFT JOIN food_menu_categories fmc ON fmc.id = fmi.category_id
        WHERE fmi.restaurant_id = $1
          AND fmi.id = ANY($2::bigint[])
          AND fmi.publication_status = 'published'
          AND fmi.archived_at IS NULL`,
      [restaurantId, itemIds]
    );
    const menuById = new Map(menuRows.map((row) => [Number(row.id), row]));

    const lineItems = items.map((item, index) => {
      const menuItemId = parsePositiveInt(item.menuItemId || item.menu_item_id);
      const menuItem = menuById.get(menuItemId);
      if (!menuItem || !menuItem.is_available) {
        throw new AppError('Validation failed', 400, 'validation_failed', {
          [`items.${index}.menuItemId`]: 'Menu item is unavailable',
        });
      }
      const quantity = Math.min(parsePositiveInt(item.quantity, 1), 99);
      const modifiers = resolveOrderItemModifiers(menuItem, item, index);
      const modifierTotalCents = modifiers.reduce((sum, modifier) => sum + Number(modifier.price_delta_cents || 0), 0);
      const unitPriceCents = Number(menuItem.price_cents || 0);
      const lineTotalCents = (unitPriceCents + modifierTotalCents) * quantity;
      return {
        menuItemId,
        menu_item_id: menuItemId,
        name: menuItem.name,
        quantity,
        unitPriceCents,
        unit_price_cents: unitPriceCents,
        modifierTotalCents,
        modifier_total_cents: modifierTotalCents,
        lineTotalCents,
        line_total_cents: lineTotalCents,
        category: menuItem.category_name || null,
        category_name: menuItem.category_name || null,
        modifiers: modifiers.map((modifier) => ({
          id: modifier.id,
          name: modifier.name,
          priceDeltaCents: Number(modifier.price_delta_cents || 0),
          price_delta_cents: Number(modifier.price_delta_cents || 0),
        })),
      };
    });

    const subtotalCents = lineItems.reduce((sum, item) => sum + item.lineTotalCents, 0);
    const tipCents = parseMoneyCents(req.body.tipCents ?? req.body.tip_cents ?? 0, 'tipCents');
    // Discounts must come from a server-validated promotion. Never trust a
    // client-provided amount because it would let a caller reduce the quote.
    let discountCents = 0;
    const discountCode = normalizeString(req.body.discountCode || req.body.discount_code, 40);
    let discount = null;
    if (discountCode) {
      const promoResult = await resolveFoodPromotionDiscount(pool, restaurantId, discountCode, subtotalCents);
      discountCents = promoResult.discountCents;
      discount = promoResult.metadata;
    }
    discountCents = Math.min(subtotalCents, discountCents);

    let deliveryAddress = null;
    let deliveryFeeCents = 0;
    if (fulfillmentType === 'delivery') {
      deliveryAddress = normalizeDeliveryAddress(req.body.deliveryAddress || req.body.delivery_address);
      assertValidDeliveryAddress(deliveryAddress, restaurant);
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
      deliveryFeeCents = parseMoneyCents(settings.deliveryFeeCents ?? settings.delivery_fee_cents ?? 0, 'deliveryFeeCents');
    }

    const taxableSubtotalCents = Math.max(0, subtotalCents - discountCents);
    const taxRateBps = Math.max(0, Math.min(10000, Number(restaurant.tax_rate_bps || 0)));
    const serviceFeeBps = Math.max(0, Math.min(10000, Number(restaurant.service_fee_bps || 0)));
    const taxCents = Math.round(taxableSubtotalCents * taxRateBps / 10000);
    const serviceFeeCents = Math.round(taxableSubtotalCents * serviceFeeBps / 10000);
    const totalCents = Math.max(0, taxableSubtotalCents + taxCents + serviceFeeCents + tipCents + deliveryFeeCents);
    const legacyPaymentMode = FOOD_PAYMENT_LEGACY_MODE[paymentContract.canonical];
    const supportedPaymentModes = ['pay_at_counter', 'pay_at_restaurant', 'restaurant_credit', 'wallet_credit', 'direct_payment'];
    let oxsteedCreditEligibility = null;
    if (req.user?.id) {
      try {
        oxsteedCreditEligibility = await getCustomerCreditEligibility({
          customerId: req.user.id,
          restaurantId,
          amountCents: totalCents,
          currencyCode: restaurant.currency_code,
          orderType: fulfillmentType,
          categories: lineItems.map((item) => item.category_name).filter(Boolean),
          menuItemIds: lineItems.map((item) => item.menuItemId),
        });
        if (oxsteedCreditEligibility.eligible) supportedPaymentModes.push('oxsteed_credit');
      } catch (error) {
        logger.warn('OxSteed Credit quote eligibility check unavailable', {
          restaurantId,
          customerId: req.user.id,
          code: error.code || null,
          message: error.message,
        });
      }
    }
    if (stripeStatus.readyForCheckout) supportedPaymentModes.push('pay_now');

    const quote = {
      restaurantId,
      restaurant_id: restaurantId,
      currencyCode: normalizeCurrency(restaurant.currency_code),
      currency_code: normalizeCurrency(restaurant.currency_code),
      orderSource,
      order_source: orderSource,
      fulfillmentType,
      fulfillment_type: fulfillmentType,
      paymentMode: legacyPaymentMode,
      payment_mode: legacyPaymentMode,
      restaurantPaymentMode: paymentContract.canonical,
      paymentContract: {
        mode: paymentContract.canonical,
        legacyMode: legacyPaymentMode,
        collection: paymentContract.canonical,
        supportedModes: supportedPaymentModes,
        oxsteedCreditEligibility,
      },
      lineItems,
      line_items: lineItems,
      subtotalCents,
      subtotal_cents: subtotalCents,
      discountCents,
      discount_cents: discountCents,
      taxableSubtotalCents,
      taxable_subtotal_cents: taxableSubtotalCents,
      taxRateBps,
      tax_rate_bps: taxRateBps,
      taxCents,
      tax_cents: taxCents,
      serviceFeeBps,
      service_fee_bps: serviceFeeBps,
      serviceFeeCents,
      service_fee_cents: serviceFeeCents,
      deliveryFeeCents,
      delivery_fee_cents: deliveryFeeCents,
      tipCents,
      tip_cents: tipCents,
      totalCents,
      total_cents: totalCents,
      discount,
      deliveryAddress,
      delivery_address: deliveryAddress,
      oxsteedCreditEligibility,
    };
    res.json({
      quote,
      supportedPaymentModes: quote.paymentContract.supportedModes,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
};

exports.createOrder = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId || req.body.restaurantId || req.body.restaurant_id);
    if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    const paymentContract = normalizeFoodPaymentMode(req.body.paymentMode || req.body.payment_mode);
    const paymentMode = paymentContract.legacy;
    if (paymentContract.canonical === 'oxsteed_credit' && !req.user?.id) {
      throw new AppError('Sign in to use OxSteed Credit', 401, 'credit_authentication_required');
    }

    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (items.length === 0) {
      throw new AppError('Validation failed', 400, 'validation_failed', { items: 'At least one item is required' });
    }

    const headerClientOrderId = normalizeString(req.get('Idempotency-Key'), 120);
    const bodyClientOrderId = normalizeString(req.body.clientOrderId || req.body.client_order_id, 120);
    if (headerClientOrderId && bodyClientOrderId && headerClientOrderId !== bodyClientOrderId) {
      throw new AppError('Idempotency-Key does not match clientOrderId', 400, 'food_order_idempotency_conflict');
    }
    const clientOrderId = headerClientOrderId || bodyClientOrderId;
    // H12: every food order needs a client-supplied idempotency key, not just
    // stored-value modes. Without it, retried pay_now checkouts can create
    // duplicate orders and duplicate Stripe sessions.
    if (!clientOrderId) {
      throw new AppError('Idempotency-Key is required for food orders', 400, 'food_order_idempotency_required');
    }
    const idempotencyFingerprint = clientOrderId
      ? buildFoodOrderIdempotencyFingerprint({
        restaurantId,
        paymentMode: paymentContract.canonical,
        request: req.body,
      })
      : null;

    const createdOrder = await withTransaction(pool, async (client) => {
      if (clientOrderId) {
        const lookup = buildFoodOrderIdempotencyLookup({
          restaurantId,
          customerId: req.user?.id,
          clientOrderId,
        });
        const { rows: existingOrders } = await client.query(lookup.text, lookup.values);
        if (existingOrders[0]) {
          assertFoodOrderIdempotencyMatch(existingOrders[0], idempotencyFingerprint, clientOrderId);
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
        `SELECT fr.*,
                b.stripe_account_id AS business_stripe_account_id,
                b.stripe_charges_enabled AS business_stripe_charges_enabled,
                b.stripe_payouts_enabled AS business_stripe_payouts_enabled,
                b.stripe_account_status AS business_stripe_account_status
           FROM food_restaurants fr
           LEFT JOIN businesses b ON b.id = fr.business_id
          WHERE fr.id = $1
            AND fr.status = 'active'
                      AND fr.discovery_status = 'visible'
                      AND COALESCE(fr.is_hidden_by_admin, FALSE) = FALSE
            AND b.is_active = TRUE
            AND b.is_listed = TRUE
            AND COALESCE(b.setup_status, 'active') = 'active'
            AND COALESCE(b.business_kind, 'restaurant') = 'restaurant'
            AND b.deleted_at IS NULL
          FOR UPDATE`,
        [restaurantId]
      );
      const restaurant = restaurants[0];
      if (!restaurant) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');

      // The fast-path check above can race with another request. Recheck after
      // locking the restaurant row so concurrent offline retries replay cleanly.
      if (clientOrderId) {
        const lookup = buildFoodOrderIdempotencyLookup({
          restaurantId,
          customerId: req.user?.id,
          clientOrderId,
        });
        const { rows: existingOrders } = await client.query(lookup.text, lookup.values);
        if (existingOrders[0]) {
          assertFoodOrderIdempotencyMatch(existingOrders[0], idempotencyFingerprint, clientOrderId);
          const existing = existingOrders[0];
          return {
            order: existing,
            restaurant,
            trackingToken: existing.metadata?.trackingToken || existing.metadata?.tracking_token || null,
            replayed: true,
          };
        }
      }
      const stripeStatus = getRestaurantStripeStatus(restaurant);
      if (['pay_now', 'card'].includes(paymentContract.canonical) && !stripeStatus.readyForCheckout) {
        throw new AppError(
          'This restaurant has not connected Stripe yet.',
          409,
          'restaurant_card_payments_unavailable',
          {
            stripeConnected: stripeStatus.connected,
            stripeChargesEnabled: stripeStatus.chargesEnabled,
            stripePayoutsEnabled: stripeStatus.payoutsEnabled,
            stripeAccountStatus: stripeStatus.accountStatus,
          }
        );
      }
      const requestedSource = normalizeString(req.body.orderSource || req.body.order_source, 24) || 'mobile';
      const isInStore = IN_STORE_SOURCES.has(requestedSource);
      if (isInStore ? !restaurant.accepts_in_store_orders : !restaurant.accepts_online_orders) {
        throw new AppError('Restaurant is not accepting orders from this channel', 409, 'restaurant_not_accepting_orders');
      }
      if (!isInStore) {
        // The restaurant page folds the manual pause flags into is_open for
        // display; enforce them here too so a paused restaurant cannot be
        // ordered from at submit time.
        const closureUntil = restaurant.temporarily_closed_until
          ? new Date(restaurant.temporarily_closed_until)
          : null;
        const isTemporarilyClosed = closureUntil
          && !Number.isNaN(closureUntil.getTime())
          && closureUntil > new Date();
        if (restaurant.is_accepting_orders_now === false || isTemporarilyClosed) {
          throw new AppError(
            'This restaurant is not accepting orders right now',
            409,
            'restaurant_not_accepting_orders'
          );
        }
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
        `SELECT fmi.id, fmi.name, fmi.price_cents, fmi.currency_code, fmi.is_available,
                fmc.name AS category_name,
                COALESCE((
                  SELECT jsonb_agg(
                    jsonb_build_object(
                      'id', mg.id,
                      'name', mg.name,
                      'min_select', mg.min_select,
                      'max_select', mg.max_select,
                      'is_required', mg.is_required,
                      'options', COALESCE((
                        SELECT jsonb_agg(
                          jsonb_build_object(
                            'id', fm.id,
                            'name', fm.name,
                            'price_delta_cents', fm.price_delta_cents,
                            'is_available', fm.is_available
                          ) ORDER BY fm.sort_order, fm.id
                        )
                        FROM food_modifiers fm
                        WHERE fm.modifier_group_id = mg.id
                      ), '[]'::jsonb)
                    ) ORDER BY mg.sort_order, mg.id
                  )
                  FROM food_modifier_groups mg
                  WHERE mg.restaurant_id = fmi.restaurant_id
                    AND mg.menu_item_id = fmi.id
                ), '[]'::jsonb) AS modifier_groups
           FROM food_menu_items fmi
           LEFT JOIN food_menu_categories fmc ON fmc.id = fmi.category_id
          WHERE fmi.restaurant_id = $1
            AND fmi.id = ANY($2::bigint[])
            AND fmi.publication_status = 'published'
            AND fmi.archived_at IS NULL`,
        [restaurantId, ids]
      );
      const menuById = new Map(menuRows.map((row) => [Number(row.id), row]));

      const normalizedItems = items.map((item, index) => {
        const menuItemId = parsePositiveInt(item.menuItemId || item.menu_item_id);
        const menuItem = menuById.get(menuItemId);
        if (!menuItem || !menuItem.is_available) {
          throw new AppError('Validation failed', 400, 'validation_failed', {
            [`items.${index}.menuItemId`]: 'Menu item is unavailable',
          });
        }
        const quantity = Math.min(parsePositiveInt(item.quantity, 1), 99);
        const modifiers = resolveOrderItemModifiers(menuItem, item, index);
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
      const { slot: deliverySlot, offsetMinutes: deliverySlotOffsetMinutes } = normalizeDeliverySlot(
        req.body.deliverySlot ?? req.body.delivery_slot
      );
      // Checkout fields: order-level kitchen notes, a scheduled-fulfillment
      // time for "later" slots, and the optional pickup contact. Persisted to
      // dedicated food_orders columns (migration 676) and mirrored into
      // metadata for the client/POS payloads.
      const kitchenNotes = normalizeString(req.body.kitchenNotes || req.body.kitchen_notes, 1000);
      let scheduledFor = null;
      const rawScheduledFor = req.body.scheduledFor ?? req.body.scheduled_for;
      if (rawScheduledFor !== undefined && rawScheduledFor !== null && rawScheduledFor !== '') {
        const parsed = new Date(rawScheduledFor);
        if (Number.isNaN(parsed.getTime())) {
          throw new AppError('Validation failed', 400, 'validation_failed', {
            scheduledFor: 'Invalid scheduled fulfillment time',
          });
        }
        const msFromNow = parsed.getTime() - Date.now();
        if (msFromNow <= 0) {
          throw new AppError('Validation failed', 400, 'validation_failed', {
            scheduledFor: 'Scheduled time must be in the future',
          });
        }
        if (msFromNow > 48 * 60 * 60 * 1000) {
          throw new AppError('Validation failed', 400, 'validation_failed', {
            scheduledFor: 'Scheduled time must be within 48 hours',
          });
        }
        scheduledFor = parsed.toISOString();
      }
      const pickupContactName = normalizeString(
        req.body.pickupContactName || req.body.pickup_contact_name,
        120
      );
      const pickupContactPhone = normalizeString(
        req.body.pickupContactPhone || req.body.pickup_contact_phone,
        40
      );
      const pickupContact = (pickupContactName || pickupContactPhone)
        ? {
          ...(pickupContactName ? { name: pickupContactName } : {}),
          ...(pickupContactPhone ? { phone: pickupContactPhone } : {}),
        }
        : null;
      const minimumOrderCents = Math.max(0, Number(restaurant.minimum_order_cents || 0) || 0);
      if (minimumOrderCents > 0 && subtotal < minimumOrderCents) {
        throw new AppError(
          'This order does not meet the restaurant minimum',
          400,
          'minimum_order_not_met',
          { minimumOrderCents, subtotalCents: subtotal }
        );
      }
      const restaurantFulfillmentModes = Array.isArray(restaurant.fulfillment_modes) && restaurant.fulfillment_modes.length
        ? restaurant.fulfillment_modes
        : ['pickup'];
      if (!restaurantFulfillmentModes.includes(fulfillmentType)) {
        throw new AppError('This fulfillment mode is not available', 409, 'fulfillment_mode_unavailable');
      }
      if (!VALID_ORDER_SOURCES.has(orderSource)) {
        throw new AppError('Validation failed', 400, 'validation_failed', { orderSource: 'Unsupported order source' });
      }
      const restaurantSettings = restaurant.settings && typeof restaurant.settings === 'object' ? restaurant.settings : {};
      const requireGuestNameForPickup = normalizeBoolean(
        restaurantSettings.requireGuestNameForPickup ?? restaurantSettings.require_guest_name_for_pickup,
        true
      );
      const requireContactForUpdates = normalizeBoolean(
        restaurantSettings.requireContactForUpdates ?? restaurantSettings.require_contact_for_updates,
        false
      );
      const externalPaymentEnabled = normalizeBoolean(
        restaurantSettings.externalPaymentEnabled ?? restaurantSettings.external_payment_enabled,
        false
      );
      const requireExternalPaymentProof = normalizeBoolean(
        restaurantSettings.requireExternalPaymentProof ?? restaurantSettings.require_external_payment_proof,
        false
      );
      const externalPaymentSubmission = normalizeFoodExternalPaymentSubmission(
        req.body.externalPayment
          || req.body.external_payment
          || req.body.paymentProof
          || req.body.payment_proof
          || req.body.metadata?.externalPayment
          || req.body.metadata?.paymentProof
      );
      const guestPickupOrder = !req.user?.id && fulfillmentType === 'pickup' && !isInStore;
      const resolvedGuestName = normalizeString(req.body.guestName || req.body.guest_name, 140);
      const resolvedGuestPhone = normalizeString(req.body.guestPhone || req.body.guest_phone, 40);
      const resolvedGuestEmail = normalizeString(req.body.guestEmail || req.body.guest_email, 255);
      if (guestPickupOrder && requireGuestNameForPickup && !resolvedGuestName) {
        throw new AppError('Validation failed', 400, 'validation_failed', {
          guestName: 'Guest name is required for pickup orders',
        });
      }
      if (!req.user?.id && requireContactForUpdates && !resolvedGuestPhone && !resolvedGuestEmail) {
        throw new AppError('Validation failed', 400, 'validation_failed', {
          guestContact: 'Provide a phone number or email for order updates',
        });
      }
      if (
        paymentContract.canonical === 'direct_payment'
        && requireExternalPaymentProof
        && !(
          externalPaymentSubmission?.attachmentUrl
          || externalPaymentSubmission?.reference
          || externalPaymentSubmission?.note
        )
      ) {
        throw new AppError('Validation failed', 400, 'validation_failed', {
          externalPayment: 'Attach proof of payment or include a confirmation number before submitting the order',
        });
      }

      let deliveryAddress = null;
      let deliveryFeeCents = 0;
      if (fulfillmentType === 'delivery') {
        deliveryAddress = normalizeDeliveryAddress(req.body.deliveryAddress || req.body.delivery_address);
        assertValidDeliveryAddress(deliveryAddress, restaurant);
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
        deliveryFeeCents = parseMoneyCents(
          restaurantSettings.deliveryFeeCents ?? restaurantSettings.delivery_fee_cents ?? 0,
          'deliveryFeeCents'
        );
      }

      const tip = parseMoneyCents(req.body.tipCents ?? req.body.tip_cents ?? 0, 'tipCents');
      // As with quoteOrder, only a promotion or loyalty redemption may set a
      // discount. Client-provided discount amounts are not authoritative.
      let discount = 0;
      const discountCode = normalizeString(req.body.discountCode || req.body.discount_code, 40);
      let discountLabel = normalizeString(req.body.discountLabel || req.body.discount_label, 120);
      let promotionId = null;
      let discountSourceMetadata = null;
      if (discountCode) {
        const promoResult = await resolveFoodPromotionDiscount(client, restaurantId, discountCode, subtotal);
        if (promoResult.discountCents > 0) {
          discount = promoResult.discountCents;
          discountLabel = promoResult.metadata?.label || discountLabel;
          promotionId = promoResult.promotionId;
          discountSourceMetadata = promoResult.metadata;
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
      const shouldDebitWalletImmediately = paymentContract.canonical === 'restaurant_credit' && Boolean(req.user?.id);
      const shouldDebitOxsteedCreditImmediately = paymentContract.canonical === 'oxsteed_credit' && Boolean(req.user?.id);
      const initialPaymentStatus = ['restaurant_credit', 'oxsteed_credit'].includes(paymentContract.canonical)
        ? ((shouldDebitWalletImmediately || shouldDebitOxsteedCreditImmediately) ? 'paid' : 'requires_payment')
        : (paymentContract.canonical === 'pay_now' ? 'requires_payment' : (paymentContract.canonical === 'card' ? 'paid' : 'unpaid'));

      // Card payments (Stripe Elements): the client confirms a PaymentIntent
      // created by POST /api/food/card-payment/intent and submits its id
      // here. Never trust the client's word that payment succeeded: re-fetch
      // the intent from Stripe and fail closed on any mismatch. Anything
      // other than a succeeded intent for exactly this order total fails with
      // 402 and no order is created.
      let cardPaymentIntentId = null;
      if (paymentContract.canonical === 'card') {
        if (!hasRestaurantStripeCheckout()) {
          throw new AppError('Stripe payments are not configured', 503, 'stripe_not_configured');
        }
        cardPaymentIntentId = normalizeString(
          req.body.stripePaymentIntentId || req.body.stripe_payment_intent_id,
          255
        );
        if (!cardPaymentIntentId) {
          throw new AppError('Validation failed', 400, 'validation_failed', {
            stripePaymentIntentId: 'A confirmed card payment is required',
          });
        }
        let paymentIntent;
        try {
          // Destination charges live on the platform account.
          paymentIntent = await stripe.paymentIntents.retrieve(cardPaymentIntentId);
        } catch (err) {
          throw new AppError('The card payment could not be verified', 402, 'card_payment_unverifiable');
        }
        const destinationAccountId = normalizeString(paymentIntent.transfer_data?.destination, 255);
        if (destinationAccountId !== stripeStatus.accountId) {
          throw new AppError('The card payment does not belong to this restaurant', 402, 'card_payment_account_mismatch');
        }
        if (Number(paymentIntent.amount) !== total) {
          throw new AppError('The card payment amount does not match the order total', 402, 'card_payment_amount_mismatch');
        }
        if (String(paymentIntent.currency || '').toUpperCase() !== normalizeCurrency(restaurant.currency_code)) {
          throw new AppError('The card payment currency does not match the restaurant currency', 402, 'card_payment_currency_mismatch');
        }
        if (paymentIntent.status !== 'succeeded') {
          throw new AppError('The card payment has not succeeded', 402, 'card_payment_not_succeeded');
        }
        const { rows: intentUsedRows } = await client.query(
          `SELECT id FROM food_orders WHERE stripe_payment_intent_id = $1 LIMIT 1`,
          [cardPaymentIntentId]
        );
        if (intentUsedRows[0]) {
          throw new AppError('This card payment has already been used for an order', 402, 'card_payment_already_used');
        }
      }

      const { rows: queueRows } = await client.query(
        `SELECT COALESCE(MAX(queue_number), 0) + 1 AS next_queue
           FROM food_orders
          WHERE restaurant_id = $1
            AND (created_at AT TIME ZONE COALESCE($2, 'UTC'))::date =
                (CURRENT_TIMESTAMP AT TIME ZONE COALESCE($2, 'UTC'))::date`,
        [restaurantId, restaurant.timezone || 'UTC']
      );
      const queueNumber = Number(queueRows[0]?.next_queue || 1);

      const trackingToken = createTrackingToken();
      const discountMetadata = discount > 0
        ? {
          code: discountCode,
          label: discountLabel,
          amountCents: discount,
          ...(discountSourceMetadata || {}),
          ...(promotionId ? { promotionId } : {}),
          ...(loyaltyRedemption ? { loyaltyRedemption } : {}),
        }
        : null;
      const metadata = req.body.metadata && typeof req.body.metadata === 'object'
        ? {
          ...req.body.metadata,
          trackingToken,
          paymentMode,
          payment_mode: paymentMode,
          restaurantPaymentMode: paymentContract.canonical,
          paymentContract: {
            mode: paymentContract.canonical,
            legacyMode: paymentMode,
            collection: paymentContract.canonical,
          },
          ...(clientOrderId ? { clientOrderId } : {}),
          ...(clientOrderId ? {
            idempotency: {
              scope: 'food_order',
              version: 2,
              requestFingerprint: idempotencyFingerprint,
            },
          } : {}),
          ...(discountMetadata ? { posDiscount: discountMetadata, promotion: discountMetadata } : {}),
          ...(loyaltyRedemption ? { loyaltyRedemption } : {}),
          ...(deliveryAddress ? { deliveryAddress, deliveryFeeCents } : {}),
          ...(deliverySlot ? { deliverySlot } : {}),
          ...(kitchenNotes ? { kitchenNotes } : {}),
          ...(scheduledFor ? { scheduledFor } : {}),
          ...(pickupContact ? { pickupContact } : {}),
          ...(cardPaymentIntentId ? { cardPaymentIntentId } : {}),
          pricing: { taxRateBps, serviceFeeBps, taxCents: tax, serviceFeeCents },
          ...(paymentContract.canonical === 'direct_payment' || externalPaymentSubmission ? {
            externalPayment: {
              enabled: externalPaymentEnabled,
              requiresProof: requireExternalPaymentProof,
              label: normalizeString(
                restaurantSettings.externalPaymentLabel ?? restaurantSettings.external_payment_label,
                120
              ),
              handle: normalizeString(
                restaurantSettings.externalPaymentHandle ?? restaurantSettings.external_payment_handle,
                120
              ),
              instructions: normalizeString(
                restaurantSettings.externalPaymentInstructions ?? restaurantSettings.external_payment_instructions,
                2000
              ),
              referenceHint: normalizeString(
                restaurantSettings.externalPaymentReferenceHint ?? restaurantSettings.external_payment_reference_hint,
                255
              ),
              qrUrl: normalizeString(
                restaurantSettings.externalPaymentQrUrl ?? restaurantSettings.external_payment_qr_url,
                2000
              ),
              submission: externalPaymentSubmission,
            },
          } : {}),
        }
        : {
          trackingToken,
          paymentMode,
          payment_mode: paymentMode,
          restaurantPaymentMode: paymentContract.canonical,
          paymentContract: {
            mode: paymentContract.canonical,
            legacyMode: paymentMode,
            collection: paymentContract.canonical,
          },
          ...(clientOrderId ? { clientOrderId } : {}),
          ...(clientOrderId ? {
            idempotency: {
              scope: 'food_order',
              version: 2,
              requestFingerprint: idempotencyFingerprint,
            },
          } : {}),
          ...(discountMetadata ? { posDiscount: discountMetadata, promotion: discountMetadata } : {}),
          ...(loyaltyRedemption ? { loyaltyRedemption } : {}),
          ...(deliveryAddress ? { deliveryAddress, deliveryFeeCents } : {}),
          ...(deliverySlot ? { deliverySlot } : {}),
          ...(kitchenNotes ? { kitchenNotes } : {}),
          ...(scheduledFor ? { scheduledFor } : {}),
          ...(pickupContact ? { pickupContact } : {}),
          ...(cardPaymentIntentId ? { cardPaymentIntentId } : {}),
          pricing: { taxRateBps, serviceFeeBps, taxCents: tax, serviceFeeCents },
          ...(paymentContract.canonical === 'direct_payment' || externalPaymentSubmission ? {
            externalPayment: {
              enabled: externalPaymentEnabled,
              requiresProof: requireExternalPaymentProof,
              label: normalizeString(
                restaurantSettings.externalPaymentLabel ?? restaurantSettings.external_payment_label,
                120
              ),
              handle: normalizeString(
                restaurantSettings.externalPaymentHandle ?? restaurantSettings.external_payment_handle,
                120
              ),
              instructions: normalizeString(
                restaurantSettings.externalPaymentInstructions ?? restaurantSettings.external_payment_instructions,
                2000
              ),
              referenceHint: normalizeString(
                restaurantSettings.externalPaymentReferenceHint ?? restaurantSettings.external_payment_reference_hint,
                255
              ),
              qrUrl: normalizeString(
                restaurantSettings.externalPaymentQrUrl ?? restaurantSettings.external_payment_qr_url,
                2000
              ),
              submission: externalPaymentSubmission,
            },
          } : {}),
        };

      const { rows: [created] } = await client.query(
        `INSERT INTO food_orders
           (restaurant_id, business_id, customer_id, guest_name, guest_phone, guest_email,
            order_source, fulfillment_type, payment_status, subtotal_cents, tax_cents,
            service_fee_cents, delivery_fee_cents, tax_rate_bps, service_fee_bps,
            tip_cents, discount_cents, total_cents, currency_code, table_label,
            queue_number, promised_at, notes, metadata,
            kitchen_notes, pickup_contact_name, pickup_contact_phone, scheduled_for,
            stripe_payment_intent_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW() + ($22 || ' minutes')::interval,$23,$24,$25,$26,$27,$28,$29)
         RETURNING *`,
        [
          restaurantId,
          restaurant.business_id,
          req.user?.id || null,
          resolvedGuestName,
          resolvedGuestPhone,
          resolvedGuestEmail,
          orderSource,
          fulfillmentType,
          initialPaymentStatus,
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
          (restaurant.prep_time_min || 15) + deliverySlotOffsetMinutes,
          normalizeString(req.body.notes, 1000),
          metadata,
          kitchenNotes,
          pickupContactName,
          pickupContactPhone,
          scheduledFor,
          cardPaymentIntentId,
        ]
      );

      if (paymentContract.canonical === 'card' && cardPaymentIntentId) {
        // Link the order to the intent so payment_intent.* webhooks reconcile
        // even if this response is lost. Fail closed: a linking failure rolls
        // back the order and the client retries with the same idempotency key.
        try {
          await stripe.paymentIntents.update(cardPaymentIntentId, {
            metadata: { food_order_id: String(created.id) },
          });
        } catch (err) {
          throw new AppError('The card payment could not be linked to the order', 502, 'card_payment_link_failed');
        }
      }

      const createdOrderItems = [];
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
        createdOrderItems.push({
          id: orderItem.id,
          menuItemId: normalized.menuItem.id,
          quantity: normalized.quantity,
        });
        for (const modifier of normalized.modifiers) {
          await client.query(
            `INSERT INTO food_order_item_modifiers
               (order_item_id, modifier_id, modifier_name, price_delta_cents)
             VALUES ($1,$2,$3,$4)`,
            [orderItem.id, modifier.id, modifier.name, modifier.price_delta_cents]
          );
        }
      }
      await reserveInventoryForOrder(client, {
        restaurantId,
        orderId: created.id,
        orderItems: createdOrderItems,
        reservationExpiresAt: paymentContract.canonical === 'pay_now'
          ? new Date(Date.now() + 30 * 60 * 1000)
          : null,
      });

      let walletPayment = null;
      let oxsteedCreditPayment = null;
      if (paymentContract.canonical === 'restaurant_credit') {
        if (!shouldDebitWalletImmediately) {
          walletPayment = buildWalletPaymentResponse({
            status: 'requires_payment',
            amountCents: total,
            currencyCode: normalizeCurrency(restaurant.currency_code),
            reason: 'awaiting_pos_qr_redemption',
          });
        } else if (total > 0) {
          const walletResult = await debitFoodWallet(client, {
            restaurantId,
            customerId: req.user.id,
            currencyCode: normalizeCurrency(restaurant.currency_code),
            amountCents: total,
            description: `Order #${created.id} · ${fulfillmentType}`,
            referenceType: 'food_order',
            referenceId: String(created.id),
            idempotencyKey: `food-order:${created.id}:wallet-credit`,
            createdByUserId: req.user.id,
            correlationId: clientOrderId || `food-order:${created.id}:wallet-credit`,
            actorType: 'customer',
            metadata: {
              orderId: created.id,
              fulfillmentType,
              orderSource,
              clientOrderId: clientOrderId || null,
            },
          });
          const posPaymentResult = await recordWalletCreditPaymentForOrder(client, {
            restaurantId,
            orderId: created.id,
            amountCents: total,
            currencyCode: normalizeCurrency(restaurant.currency_code),
            walletAccountId: walletResult.account?.id || null,
            walletLedgerEntryId: walletResult.entry?.id || null,
            walletBalanceAfterCents: walletResult.entry?.balance_after_cents ?? null,
            idempotencyKey: `food-order:${created.id}:wallet-credit`,
            createdByUserId: req.user.id,
            metadata: {
              orderSource,
              fulfillmentType,
              clientOrderId: clientOrderId || null,
            },
          });
          walletPayment = buildWalletPaymentResponse({
            status: 'paid',
            amountCents: total,
            currencyCode: normalizeCurrency(restaurant.currency_code),
            walletResult,
            posPayment: posPaymentResult.payment,
          });
        } else {
          walletPayment = buildWalletPaymentResponse({
            status: 'paid',
            amountCents: 0,
            currencyCode: normalizeCurrency(restaurant.currency_code),
            reason: 'zero_total_order',
          });
        }
      }

      if (paymentContract.canonical === 'oxsteed_credit') {
        if (total <= 0) {
          oxsteedCreditPayment = buildOxsteedCreditPaymentResponse({
            status: 'paid',
            amountCents: 0,
            currencyCode: normalizeCurrency(restaurant.currency_code),
            reason: 'zero_total_order',
          });
        } else {
          const { rows: partnerRows } = await client.query(
            `SELECT id
               FROM oxsteed_credit_partners
              WHERE restaurant_id = $1 AND status = 'active'
              LIMIT 1`,
            [restaurantId]
          );
          if (!partnerRows[0]) {
            throw new AppError('This restaurant does not currently accept OxSteed Credit', 409, 'credit_partner_not_eligible');
          }
          const creditResult = await purchaseWithCreditInTransaction(client, {
            customerId: req.user.id,
            partnerId: partnerRows[0].id,
            amountCents: total,
            currencyCode: normalizeCurrency(restaurant.currency_code),
            idempotencyKey: `food-order:${created.id}:oxsteed-credit`,
            actorUserId: req.user.id,
            actorType: 'customer',
            orderType: fulfillmentType,
            categories: normalizedItems.map((item) => item.menuItem.category_name).filter(Boolean),
            menuItemIds: normalizedItems.map((item) => item.menuItem.id),
            city: restaurant.address_city,
            state: restaurant.address_state,
            postalCode: restaurant.address_zip,
            country: restaurant.address_country,
            referenceType: 'food_order',
            referenceId: String(created.id),
            correlationId: clientOrderId || `food-order:${created.id}:oxsteed-credit`,
            requestIp: req.ip || null,
            description: `Order #${created.id} · ${fulfillmentType}`,
            metadata: {
              orderId: created.id,
              restaurantId,
              fulfillmentType,
              orderSource,
              clientOrderId: clientOrderId || null,
            },
          });
          const creditTransactionId = creditResult.transaction?.id || null;
          await client.query(
            `UPDATE food_orders
                SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb,
                    updated_at = NOW()
              WHERE id = $2`,
            [JSON.stringify({ oxsteedCreditTransactionId: creditTransactionId }), created.id]
          );
          created.metadata = {
            ...(created.metadata || {}),
            oxsteedCreditTransactionId: creditTransactionId,
          };
          oxsteedCreditPayment = buildOxsteedCreditPaymentResponse({
            status: 'paid',
            amountCents: total,
            currencyCode: creditResult.transaction?.currencyCode || normalizeCurrency(restaurant.currency_code),
            transaction: creditResult.transaction,
            replayed: Boolean(creditResult.replayed),
          });
        }
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
      } else if (discountMetadata?.discountCodeId) {
        await client.query(
          `UPDATE discount_codes
              SET usage_count = usage_count + 1, updated_at = NOW()
            WHERE id = $1`,
          [discountMetadata.discountCodeId]
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
        walletPayment,
        oxsteedCreditPayment,
      };
    }, 'food_create_order');

    let order = createdOrder.order;
    let payment = null;
    const responsePaymentMode = order.metadata && typeof order.metadata === 'object'
      ? order.metadata.paymentMode || order.metadata.payment_mode || paymentMode
      : paymentMode;
    if (responsePaymentMode === 'wallet_credit') {
      payment = createdOrder.walletPayment || buildWalletPaymentResponse({
        status: order.payment_status || 'paid',
        amountCents: order.total_cents,
        currencyCode: order.currency_code,
        replayed: Boolean(createdOrder.replayed),
        reason: createdOrder.replayed ? 'idempotent_order_replay' : null,
      });
    }
    if (responsePaymentMode === 'oxsteed_credit') {
      payment = createdOrder.oxsteedCreditPayment || buildOxsteedCreditPaymentResponse({
        status: order.payment_status || 'paid',
        amountCents: order.total_cents,
        currencyCode: order.currency_code,
        replayed: Boolean(createdOrder.replayed),
        reason: createdOrder.replayed ? 'idempotent_order_replay' : null,
        transaction: order.metadata?.oxsteedCreditTransactionId
          ? { id: order.metadata.oxsteedCreditTransactionId }
          : null,
      });
    }
    if (responsePaymentMode === 'card') {
      payment = {
        mode: 'card_payment',
        status: order.payment_status || 'paid',
        paymentIntentId: order.stripe_payment_intent_id || null,
        amountCents: order.total_cents,
        currencyCode: order.currency_code,
        replayed: Boolean(createdOrder.replayed),
      };
    }
    if (!createdOrder.replayed && paymentMode === 'pay_now') {
      try {
        const paymentResult = await createFoodCheckoutSession({
          order,
          orderItems: createdOrder.normalizedItems,
          customerEmail: normalizeString(req.user?.email || req.body.guestEmail || req.body.guest_email, 255),
          returnUrl: safeReturnUrl(req.body.returnUrl || req.body.return_url),
          connectedAccountId: createdOrder.restaurant?.business_stripe_account_id
            || createdOrder.restaurant?.stripe_account_id
            || null,
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

exports.createCardPaymentIntent = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.body.restaurantId || req.body.restaurant_id);
    if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    if (!hasRestaurantStripeCheckout()) {
      throw new AppError('Stripe payments are not configured', 503, 'stripe_not_configured');
    }
    // Money-safety: never trust a client amount blindly. There is no persisted
    // quote draft to re-price from here, so the client amount is accepted only
    // inside hard sanity bounds; the order total is re-derived server-side at
    // order creation and the intent is verified against it.
    const amountCents = parsePositiveInt(req.body.amountCents ?? req.body.amount_cents, 0);
    if (!amountCents || amountCents < FOOD_CARD_INTENT_MIN_CENTS || amountCents > FOOD_CARD_INTENT_MAX_CENTS) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        amountCents: `Amount must be between ${FOOD_CARD_INTENT_MIN_CENTS} and ${FOOD_CARD_INTENT_MAX_CENTS} cents`,
      });
    }
    const currency = normalizeCurrency(
      req.body.currency || req.body.currencyCode || req.body.currency_code
    );
    const idempotencyKey = normalizeString(
      req.get('Idempotency-Key') || req.body.idempotencyKey || req.body.idempotency_key,
      120
    );
    if (!idempotencyKey) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        idempotencyKey: 'An idempotency key is required',
      });
    }
    const { rows: restaurants } = await pool.query(
      `SELECT fr.id, fr.business_id, fr.currency_code,
              b.stripe_account_id AS business_stripe_account_id,
              b.stripe_charges_enabled AS business_stripe_charges_enabled,
              b.stripe_payouts_enabled AS business_stripe_payouts_enabled,
              b.stripe_account_status AS business_stripe_account_status
         FROM food_restaurants fr
         JOIN businesses b ON b.id = fr.business_id
        WHERE fr.id = $1
          AND fr.status = 'active'
          AND fr.discovery_status = 'visible'
          AND COALESCE(fr.is_hidden_by_admin, FALSE) = FALSE
          AND b.is_active = TRUE
          AND b.is_listed = TRUE
          AND COALESCE(b.setup_status, 'active') = 'active'
          AND COALESCE(b.business_kind, 'restaurant') = 'restaurant'
          AND b.deleted_at IS NULL`,
      [restaurantId]
    );
    const restaurant = restaurants[0];
    if (!restaurant) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    if (normalizeCurrency(restaurant.currency_code) !== currency) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        currency: 'Currency must match the restaurant currency',
      });
    }
    const stripeStatus = getRestaurantStripeStatus(restaurant);
    if (!stripeStatus.accountId || !stripeStatus.chargesEnabled) {
      throw new AppError(
        'This restaurant cannot accept card payments yet.',
        400,
        'restaurant_card_payments_unavailable',
        {
          stripeConnected: stripeStatus.connected,
          stripeChargesEnabled: stripeStatus.chargesEnabled,
          stripePayoutsEnabled: stripeStatus.payoutsEnabled,
          stripeAccountStatus: stripeStatus.accountStatus,
        }
      );
    }

    // Idempotent reuse: the same (restaurant, idempotencyKey) pair resolves to
    // the original PaymentIntent instead of authorizing a second charge. A key
    // reused with different payment terms is a client bug: fail closed.
    const { rows: existingIntents } = await pool.query(
      `SELECT stripe_payment_intent_id, amount_cents, currency_code, status
         FROM food_card_payment_intents
        WHERE restaurant_id = $1 AND idempotency_key = $2`,
      [restaurantId, idempotencyKey]
    );
    if (existingIntents[0]) {
      const existing = existingIntents[0];
      if (Number(existing.amount_cents) !== amountCents || normalizeCurrency(existing.currency_code) !== currency) {
        throw new AppError('This idempotency key was already used with different payment terms', 409, 'card_payment_idempotency_conflict');
      }
      let reusedIntent;
      try {
        reusedIntent = await stripe.paymentIntents.retrieve(existing.stripe_payment_intent_id);
      } catch (err) {
        throw new AppError('The previous card payment could not be retrieved', 502, 'card_payment_intent_unavailable');
      }
      return res.json({
        clientSecret: reusedIntent.client_secret,
        paymentIntentId: reusedIntent.id,
      });
    }

    const feeBps = Math.max(0, Math.min(10000, Number(process.env.FOOD_CARD_FEE_BPS ?? 0) || 0));
    const applicationFeeAmount = Math.floor(amountCents * feeBps / 10000);

    // Saved cards: attach the platform Stripe customer so successful card
    // payments are saved for one-tap reuse. Destination charges support
    // setup_future_usage=off_session.
    let stripeCustomerId = null;
    if (req.user?.id) {
      try {
        const { rows: userRows } = await pool.query(
          `SELECT stripe_customer_id, email, first_name, last_name FROM users WHERE id = $1`,
          [req.user.id]
        );
        const u = userRows[0];
        if (u) {
          stripeCustomerId = u.stripe_customer_id || null;
          if (!stripeCustomerId) {
            const customer = await stripe.customers.create({
              email: u.email || undefined,
              name: [u.first_name, u.last_name].filter(Boolean).join(' ') || undefined,
              metadata: { user_id: String(req.user.id), oxsteed: 'food' },
            });
            stripeCustomerId = customer.id;
            await pool.query(`UPDATE users SET stripe_customer_id = $1 WHERE id = $2`, [stripeCustomerId, req.user.id]);
          }
        }
      } catch (err) {
        logger.warn('[Food] Stripe customer lookup failed; continuing without saved cards', { error: err.message });
      }
    }

    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: currency.toLowerCase(),
          description: `Restaurant order · ${restaurantId}`,
          // Destination charge: funds settle to the restaurant's Connect
          // account; the platform keeps application_fee_amount (0 by default).
          transfer_data: { destination: stripeStatus.accountId },
          ...(applicationFeeAmount > 0 ? { application_fee_amount: applicationFeeAmount } : {}),
          ...(stripeCustomerId ? { customer: stripeCustomerId, setup_future_usage: 'off_session' } : {}),
          metadata: {
            food_card_payment: 'true',
            restaurant_id: String(restaurantId),
            business_id: String(restaurant.business_id),
            customer_id: req.user?.id ? String(req.user.id) : '',
            idempotency_key: idempotencyKey,
          },
        },
        {
          // Deterministic key so a retried request replays the same
          // PaymentIntent instead of authorizing twice.
          idempotencyKey: `food-card-payment:${restaurantId}:${idempotencyKey}`,
        }
      );
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('The card payment could not be started', 502, 'card_payment_intent_failed');
    }
    if (!paymentIntent?.id || !paymentIntent?.client_secret) {
      throw new AppError('The card payment could not be started', 502, 'card_payment_intent_failed');
    }
    // Record the intent before returning the secret. ON CONFLICT covers the
    // race where two requests create the same deterministic Stripe intent;
    // the row is re-read so the response always reflects the stored record.
    await pool.query(
      `INSERT INTO food_card_payment_intents
         (restaurant_id, customer_id, idempotency_key, stripe_payment_intent_id,
          amount_cents, currency_code, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'created')
       ON CONFLICT (restaurant_id, idempotency_key) DO NOTHING`,
      [
        restaurantId,
        req.user?.id || null,
        idempotencyKey,
        paymentIntent.id,
        amountCents,
        currency,
      ]
    );
    const { rows: storedIntents } = await pool.query(
      `SELECT stripe_payment_intent_id
         FROM food_card_payment_intents
        WHERE restaurant_id = $1 AND idempotency_key = $2`,
      [restaurantId, idempotencyKey]
    );
    const storedIntentId = storedIntents[0]?.stripe_payment_intent_id || paymentIntent.id;
    let responseIntent = paymentIntent;
    if (storedIntentId !== paymentIntent.id) {
      try {
        responseIntent = await stripe.paymentIntents.retrieve(storedIntentId);
      } catch (err) {
        throw new AppError('The card payment could not be retrieved', 502, 'card_payment_intent_unavailable');
      }
    }
    res.status(201).json({
      clientSecret: responseIntent.client_secret,
      paymentIntentId: responseIntent.id,
    });
  } catch (err) {
    next(err);
  }
};

// List the signed-in user's saved card payment methods for one-tap checkout.
// Returns only safe display fields (brand, last4, expiry); never full PANs.
exports.listSavedPaymentMethods = async (req, res, next) => {
  try {
    if (!hasRestaurantStripeCheckout()) {
      return res.json({ paymentMethods: [] });
    }
    const { rows } = await pool.query(
      `SELECT stripe_customer_id FROM users WHERE id = $1`,
      [req.user.id]
    );
    const customerId = rows[0]?.stripe_customer_id;
    if (!customerId) return res.json({ paymentMethods: [] });
    const methods = await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
      limit: 10,
    });
    res.json({
      paymentMethods: (methods.data || []).map((pm) => ({
        id: pm.id,
        brand: pm.card?.brand || 'card',
        last4: pm.card?.last4 || '••••',
        expMonth: pm.card?.exp_month || null,
        expYear: pm.card?.exp_year || null,
      })),
    });
  } catch (err) {
    next(err);
  }
};

exports.listRestaurantOrders = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertRestaurantPermission(restaurant, ['orders.view', 'orders.manage', 'kitchen.view', 'kitchen.update']);
    const status = normalizeString(req.query.status, 24);
    const source = normalizeString(req.query.source || req.query.orderSource || req.query.order_source, 24);
    const scope = normalizeString(req.query.scope, 24);
    const fulfillment = normalizeString(
      req.query.fulfillment || req.query.fulfillmentType || req.query.fulfillment_type,
      24
    );
    const paymentStatus = normalizeString(req.query.paymentStatus || req.query.payment_status, 24);
    const search = normalizeString(req.query.q || req.query.search, 120);
    const from = normalizeString(req.query.from || req.query.dateFrom || req.query.date_from, 40);
    const to = normalizeString(req.query.to || req.query.dateTo || req.query.date_to, 40);
    const includeMeta = req.query.includeMeta === '1' || req.query.includeMeta === 'true';
    const limit = Math.min(parsePositiveInt(req.query.limit, 50), 100);
    const offset = Math.max(parsePositiveInt(req.query.offset, 0) || 0, 0);
    const params = [restaurantId];
    const filters = [];
    if (status && VALID_STATUS.has(status)) {
      params.push(status);
      filters.push(`fo.status = $${params.length}`);
    } else if (scope === 'active') {
      // Merchant operations must not hide an unfinished order after midnight.
      filters.push(`fo.status IN ('received','accepted','preparing','ready')`);
    } else if (scope === 'history') {
      filters.push(`fo.status IN ('completed','cancelled','refunded')`);
    } else if (req.query.active === '1' || req.query.active === 'true') {
      // Kitchen-display polling feed: only today's in-flight orders.
      filters.push(`fo.status IN ('received','accepted','preparing','ready')`);
      filters.push(`(fo.created_at AT TIME ZONE COALESCE(
        (SELECT fr.timezone FROM food_restaurants fr WHERE fr.id = fo.restaurant_id), 'UTC'
      ))::date = (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(
        (SELECT fr.timezone FROM food_restaurants fr WHERE fr.id = fo.restaurant_id), 'UTC'
      ))::date`);
    }
    if (source === 'pos' || source === 'in_store') {
      params.push(Array.from(IN_STORE_SOURCES));
      filters.push(`fo.order_source = ANY($${params.length}::text[])`);
    } else if (source && VALID_ORDER_SOURCES.has(source)) {
      params.push(source);
      filters.push(`fo.order_source = $${params.length}`);
    }
    if (fulfillment && VALID_FULFILLMENT.has(fulfillment)) {
      params.push(fulfillment);
      filters.push(`fo.fulfillment_type = $${params.length}`);
    }
    if (paymentStatus && VALID_PAYMENT_STATUS.has(paymentStatus)) {
      params.push(paymentStatus);
      filters.push(`fo.payment_status = $${params.length}`);
    }
    if (from && !Number.isNaN(Date.parse(from))) {
      params.push(new Date(from).toISOString());
      filters.push(`fo.created_at >= $${params.length}::timestamptz`);
    }
    if (to && !Number.isNaN(Date.parse(to))) {
      params.push(new Date(to).toISOString());
      filters.push(`fo.created_at < $${params.length}::timestamptz`);
    }
    if (search) {
      params.push(`%${search}%`);
      const searchParam = `$${params.length}`;
      filters.push(`(
        CAST(fo.id AS TEXT) ILIKE ${searchParam}
        OR CAST(fo.queue_number AS TEXT) ILIKE ${searchParam}
        OR COALESCE(fo.guest_name, '') ILIKE ${searchParam}
        OR COALESCE(fo.guest_phone, '') ILIKE ${searchParam}
        OR COALESCE(fo.guest_email, '') ILIKE ${searchParam}
        OR COALESCE(u.first_name || ' ' || u.last_name, '') ILIKE ${searchParam}
        OR COALESCE(u.email, '') ILIKE ${searchParam}
        OR EXISTS (
          SELECT 1 FROM food_order_items search_item
           WHERE search_item.order_id = fo.id AND search_item.item_name ILIKE ${searchParam}
        )
      )`);
    }
    const whereSql = filters.length ? ` AND ${filters.join(' AND ')}` : '';
    params.push(limit, offset);
    const limitParam = `$${params.length - 1}`;
    const offsetParam = `$${params.length}`;
    const { rows } = await pool.query(
      `SELECT fo.*,
              COALESCE(NULLIF(fo.guest_name, ''), NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), 'Guest') AS customer_name,
              COALESCE(NULLIF(fo.guest_email, ''), u.email) AS customer_email,
              COALESCE(NULLIF(fo.guest_phone, ''), u.phone) AS customer_phone,
              COUNT(*) OVER()::int AS total_count,
              COALESCE(json_agg(json_build_object(
                'id', foi.id,
                'itemName', foi.item_name,
                'quantity', foi.quantity,
                'unitPriceCents', foi.unit_price_cents,
                'modifierTotalCents', foi.modifier_total_cents,
                'lineTotalCents', foi.line_total_cents,
                'specialInstructions', foi.special_instructions,
                'kitchenStatus', foi.kitchen_status,
                'stationLabel', foi.station_label,
                'kitchenStartedAt', foi.kitchen_started_at,
                'delayedAt', foi.delayed_at,
                'delayReason', foi.delay_reason,
                'targetPrepSeconds', foi.target_prep_seconds,
                'modifiers', COALESCE((
                  SELECT json_agg(json_build_object(
                    'id', foim.id,
                    'name', foim.modifier_name,
                    'priceDeltaCents', foim.price_delta_cents
                  ) ORDER BY foim.id)
                    FROM food_order_item_modifiers foim
                   WHERE foim.order_item_id = foi.id
                ), '[]'::json)
              ) ORDER BY foi.id) FILTER (WHERE foi.id IS NOT NULL), '[]') AS items
         FROM food_orders fo
         LEFT JOIN users u ON u.id = fo.customer_id
         LEFT JOIN food_order_items foi ON foi.order_id = fo.id
        WHERE fo.restaurant_id = $1${whereSql}
        GROUP BY fo.id, u.id
        ORDER BY
          ${scope === 'history' ? 'fo.created_at DESC' : `CASE fo.status
            WHEN 'received' THEN 1
            WHEN 'accepted' THEN 2
            WHEN 'preparing' THEN 3
            WHEN 'ready' THEN 4
            ELSE 5
          END, fo.created_at ASC`}
        LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params
    );
    const orders = [];
    for (const row of rows) {
      orders.push(await syncFoodOrderPaymentStatus(row));
    }
    let summary = null;
    if (includeMeta) {
      const { rows: summaryRows } = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE fo.status IN ('received','accepted'))::int AS new_orders,
                COUNT(*) FILTER (WHERE fo.status = 'preparing')::int AS preparing_orders,
                COUNT(*) FILTER (WHERE fo.status = 'ready')::int AS ready_orders,
                COUNT(*) FILTER (WHERE fo.status = 'completed')::int AS completed_orders,
                COALESCE(SUM(fo.total_cents) FILTER (
                  WHERE fo.payment_status = 'paid' AND fo.status NOT IN ('cancelled','refunded')
                ), 0)::bigint AS paid_sales_cents,
                COUNT(*)::int AS total_orders
           FROM food_orders fo
           JOIN food_restaurants fr ON fr.id = fo.restaurant_id
          WHERE fo.restaurant_id = $1
            AND (fo.created_at AT TIME ZONE COALESCE(fr.timezone, 'UTC'))::date =
                (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(fr.timezone, 'UTC'))::date`,
        [restaurantId]
      );
      summary = summaryRows[0] || null;
    }
    res.json({
      orders,
      meta: {
        total: Number(rows[0]?.total_count || 0),
        limit,
        offset,
        hasMore: offset + orders.length < Number(rows[0]?.total_count || 0),
      },
      summary,
    });
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
    // Critical fix: status transitions to cancelled/refunded trigger money
    // refunds. Kitchen staff (kitchen.update) must not be able to move money.
    // Financial transitions require orders.manage or issue_refunds.
    const isFinancialTransition = ['cancelled', 'refunded'].includes(status);
    if (isFinancialTransition) {
      await assertRestaurantPermission(restaurant, ['orders.manage', 'issue_refunds']);
    } else {
      await assertRestaurantPermission(restaurant, ['orders.manage', 'kitchen.update']);
    }
    const reason = normalizeString(req.body.reason || req.body.note, 1000);
    const stationLabel = normalizeString(req.body.stationLabel || req.body.station_label, 80);
    const action = normalizeString(req.body.action, 48) || `order_${status}`;
    const idempotencyKey = normalizeString(
      req.get('Idempotency-Key') || req.body.idempotencyKey || req.body.idempotency_key,
      160
    );
    if (!VALID_STATUS.has(status) || !ORDER_TRANSITIONS[status]) {
      throw new AppError('Validation failed', 400, 'validation_failed', { status: 'Unsupported order status' });
    }
    const timestampColumn = {
      accepted: 'accepted_at',
      ready: 'ready_at',
      completed: 'completed_at',
      cancelled: 'cancelled_at',
      refunded: 'cancelled_at',
    }[status];

    const transitionResult = await withTransaction(pool, async (client) => {
      if (idempotencyKey) {
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
          [`food-status:${restaurantId}:${idempotencyKey}`]
        );
        const { rows: [replayedEvent] } = await client.query(
          `SELECT food_order_id
             FROM restaurant_kitchen_events
            WHERE restaurant_id = $1 AND idempotency_key = $2`,
          [restaurantId, idempotencyKey]
        );
        if (replayedEvent) {
          const { rows: [replayedOrder] } = await client.query(
            `SELECT * FROM food_orders WHERE id = $1 AND restaurant_id = $2`,
            [replayedEvent.food_order_id, restaurantId]
          );
          return { order: replayedOrder, walletRefund: null, payment: null, replayed: true };
        }
      }

      const kitchenPrep = restaurant.settings?.kitchenPrep || restaurant.settings?.kitchen_prep || {};
      const qualityCheckRequired = kitchenPrep.requireQualityCheck !== false
        && kitchenPrep.require_quality_check !== false;
      // Older POS/Kitchen clients only send a status. Keep that contract working
      // while the explicit KDS action opts into the stricter item/QC gate.
      const enforceKitchenReadiness = status === 'ready'
        && (action === 'mark_ready' || req.body.enforceKitchenReadiness === true);
      const { rows: [order] } = await client.query(
        `WITH current AS (
           SELECT * FROM food_orders
            WHERE id = $2 AND restaurant_id = $3
            FOR UPDATE
         ), updated AS (
          UPDATE food_orders fo
            SET status = $1,
                ${timestampColumn ? `${timestampColumn} = COALESCE(fo.${timestampColumn}, NOW()),` : ''}
                kitchen_stage = CASE $1
                  WHEN 'accepted' THEN 'acknowledged'
                  WHEN 'preparing' THEN 'preparing'
                  WHEN 'ready' THEN 'ready'
                  WHEN 'completed' THEN 'handed_off'
                  WHEN 'cancelled' THEN 'cancelled'
                  WHEN 'refunded' THEN 'cancelled'
                  ELSE fo.kitchen_stage
                END,
                kitchen_acknowledged_at = CASE
                  WHEN $1 IN ('accepted','preparing','ready','completed')
                    THEN COALESCE(fo.kitchen_acknowledged_at, NOW())
                  ELSE fo.kitchen_acknowledged_at
                END,
                preparation_started_at = CASE
                  WHEN $1 IN ('preparing','ready','completed')
                    THEN COALESCE(fo.preparation_started_at, NOW())
                  ELSE fo.preparation_started_at
                END,
                quality_check_at = CASE
                  WHEN $1 IN ('ready','completed')
                    THEN COALESCE(fo.quality_check_at, NOW())
                  ELSE fo.quality_check_at
                END,
                handed_off_at = CASE WHEN $1 = 'completed' THEN COALESCE(fo.handed_off_at, NOW()) ELSE fo.handed_off_at END,
                handed_off_by = CASE WHEN $1 = 'completed' THEN COALESCE(fo.handed_off_by, $5) ELSE fo.handed_off_by END,
                payment_status = CASE
                  WHEN $1 IN ('cancelled', 'refunded')
                    AND COALESCE(fo.metadata->>'paymentMode', '') IN ('wallet_credit', 'oxsteed_credit', 'pay_now')
                    AND fo.payment_status = 'paid'
                    THEN 'refunded'
                  ELSE fo.payment_status
                END,
                updated_at = NOW()
           FROM current
          WHERE fo.id = current.id
            AND current.status = ANY($4::text[])
            AND ($1 <> 'completed' OR current.fulfillment_type <> 'delivery')
            AND (
              $1 <> 'ready'
              OR $7 = FALSE
              OR (
                ($6 = FALSE OR current.kitchen_stage = 'quality_check')
                AND NOT EXISTS (
                  SELECT 1 FROM food_order_items foi
                   WHERE foi.order_id = current.id
                     AND foi.kitchen_status NOT IN ('ready','bumped','cancelled')
                )
              )
            )
          RETURNING fo.*, current.status AS previous_status,
                    current.kitchen_stage AS previous_kitchen_stage,
                    current.payment_status AS previous_payment_status
         )
         SELECT * FROM updated`,
        [
          status,
          orderId,
          restaurantId,
          ORDER_TRANSITIONS[status],
          req.user?.id || null,
          qualityCheckRequired,
          enforceKitchenReadiness,
        ]
      );
      if (!order) {
        const { rows: existing } = await client.query(
          `SELECT status, kitchen_stage, fulfillment_type
             FROM food_orders WHERE id = $1 AND restaurant_id = $2`,
          [orderId, restaurantId]
        );
        if (!existing[0]) throw new AppError('Order not found', 404, 'order_not_found');
        if (status === 'completed' && existing[0].fulfillment_type === 'delivery') {
          throw new AppError(
            'Complete delivery orders through Runner handoff or proof submission',
            409,
            'runner_handoff_required'
          );
        }
        if (enforceKitchenReadiness && ORDER_TRANSITIONS.ready.includes(existing[0].status)) {
          const { rows: [readiness] } = await client.query(
            `SELECT COUNT(*)::int AS total_items,
                    COUNT(*) FILTER (WHERE kitchen_status IN ('ready','bumped','cancelled'))::int AS finished_items
               FROM food_order_items WHERE order_id = $1`,
            [orderId]
          );
          const totalItems = Number(readiness?.total_items || 0);
          const finishedItems = Number(readiness?.finished_items || 0);
          if (totalItems > 0 && finishedItems < totalItems) {
            throw new AppError(
              'All required kitchen items must be finished before the order can be marked ready',
              409,
              'kitchen_items_incomplete',
              { totalItems, finishedItems }
            );
          }
          if (qualityCheckRequired && existing[0].kitchen_stage !== 'quality_check') {
            throw new AppError(
              'Complete the kitchen quality check before marking this order ready',
              409,
              'quality_check_required'
            );
          }
        }
        throw new AppError(
          `Cannot move order from '${existing[0].status}' to '${status}'`,
          409,
          'illegal_state_transition'
        );
      }

      const paymentMode = order.metadata && typeof order.metadata === 'object'
        ? order.metadata.paymentMode || order.metadata.payment_mode || null
        : null;
      if (['cancelled', 'refunded'].includes(status) && paymentMode === 'oxsteed_credit') {
        await assertRestaurantPermission(
          restaurant,
          ['credit.manage'],
          'Credit-funded order refunds require the credit management permission'
        );
      }

      await client.query(
        `INSERT INTO restaurant_kitchen_events
           (restaurant_id, food_order_id, event_type, from_status, to_status,
            station_label, reason, metadata, idempotency_key, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
        [
          restaurantId,
          orderId,
          action,
          order.previous_status,
          status,
          stationLabel,
          reason,
          JSON.stringify({
            fromKitchenStage: order.previous_kitchen_stage || null,
            toKitchenStage: order.kitchen_stage || null,
            source: 'food_order_status',
            actorRole: restaurant.effective_role || null,
          }),
          idempotencyKey,
          req.user?.id || null,
        ]
      );

      delete order.previous_status;
      delete order.previous_kitchen_stage;
      const previousPaymentStatus = order.previous_payment_status || null;
      delete order.previous_payment_status;

      let walletRefund = null;
      let payment = null;
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
        let posRefundPayment = null;
        if (refundResult.refunded && refundResult.entry) {
          const posRefundResult = await recordWalletCreditRefundForOrder(client, {
            restaurantId,
            orderId: order.id,
            amountCents: Number(refundResult.entry.amount_cents || 0),
            currencyCode: normalizeCurrency(order.currency_code),
            walletAccountId: refundResult.account?.id || refundResult.entry.account_id || null,
            walletRefundLedgerEntryId: refundResult.entry.id,
            walletOriginalLedgerEntryId: refundResult.entry.metadata?.originalDebitEntryId || null,
            walletBalanceAfterCents: refundResult.entry.balance_after_cents ?? null,
            idempotencyKey: `food-order:${order.id}:wallet-credit-refund`,
            createdByUserId: req.user?.id || null,
            metadata: {
              orderStatus: status,
              refundReason: 'order_status_transition',
            },
          });
          posRefundPayment = posRefundResult.payment;
        }
        payment = buildWalletPaymentResponse({
          status: 'refunded',
          amountCents: Number((refundResult.entry || walletRefund)?.amount_cents || order.total_cents || 0),
          currencyCode: normalizeCurrency(order.currency_code),
          walletResult: refundResult.account ? refundResult : null,
          ledgerEntry: refundResult.entry || walletRefund,
          posPayment: posRefundPayment,
          refunded: Boolean(refundResult.refunded),
          reason: refundResult.reason || null,
        });
      }

      if (['cancelled', 'refunded'].includes(status) && paymentMode === 'oxsteed_credit' && order.customer_id && Number(order.total_cents || 0) > 0) {
        const refundResult = await refundCreditForReferenceInTransaction(client, {
          referenceType: 'food_order',
          referenceId: String(order.id),
          amountCents: Number(order.total_cents),
          idempotencyKey: `food-order:${order.id}:oxsteed-credit-refund`,
          actorUserId: req.user?.id || null,
          actorType: 'restaurant_staff',
          reason: `Order ${status}`,
          correlationId: `food-order-status:${order.id}:${status}`,
          requestIp: req.ip || null,
          metadata: {
            orderId: order.id,
            orderStatus: status,
            restaurantId,
          },
        });
        payment = buildOxsteedCreditPaymentResponse({
          status: 'refunded',
          amountCents: Number(order.total_cents),
          currencyCode: normalizeCurrency(order.currency_code),
          transaction: refundResult.transaction,
          replayed: Boolean(refundResult.replayed),
          reason: refundResult.replayed ? 'idempotent_refund_replay' : 'order_status_transition',
        });
      }

      // C5: pay_now orders are charged through Stripe at placement. Cancelling or
      // refunding a paid card order must refund the charge, not just flip the
      // status. The refund is idempotency-keyed per order so retries and the
      // charge.refunded webhook cannot double-refund.
      if (['cancelled', 'refunded'].includes(status)
        && paymentMode === 'pay_now'
        && previousPaymentStatus === 'paid'
        && order.stripe_payment_intent_id) {
        const cardRefund = await refundFoodOrderStripePayment(client, {
          order,
          restaurantId,
          createdByUserId: req.user?.id || null,
          status,
        });
        payment = {
          mode: 'pay_now',
          status: 'refunded',
          amountCents: Number(order.total_cents || 0),
          amount: Number(order.total_cents || 0) / 100,
          currencyCode: normalizeCurrency(order.currency_code),
          refundId: cardRefund.refund?.id || null,
          stripeChargeId: cardRefund.chargeId,
          posPayment: formatPosPayment(cardRefund.posPayment),
        };
      }

      if (status === 'completed') {
        await consumeInventoryForOrder(client, {
          restaurantId,
          orderId: order.id,
          actorUserId: req.user?.id || null,
        });
      } else if (['cancelled', 'refunded'].includes(status)) {
        await releaseInventoryForOrder(client, {
          restaurantId,
          orderId: order.id,
        });
        // M13: claw back loyalty points earned on completion so refunded
        // orders cannot farm points.
        await clawBackFoodLoyaltyOnRefund(client, order);
      }

      return { order, walletRefund, payment };
    }, 'food_update_order_status');
    const order = transitionResult.order;
    let runnerTask = null;

    // Idempotent retries return the original result without repeating customer
    // messages, loyalty awards, runner transitions, or realtime side effects.
    if (!transitionResult.replayed) {
      emitRestaurantOrder(order.business_id, 'food:order:updated', { order });
      emitRestaurantDisplay(order.restaurant_id, order);

      runnerTask = await syncDeliveryRunnerTaskForOrderStatus(pool, {
        order,
        createdBy: req.user?.id || null,
      });

      // When the kitchen marks an order ready, tell the customer (best-effort,
      // fire-and-forget so a slow SMS/email provider never delays this response).
      if (status === 'ready') {
        notifyFoodOrderReady(order, restaurant);
      }
      // Transactional ladder: accepted / preparing milestones keep the
      // customer informed and pull them back to the tracker.
      if (status === 'accepted' || status === 'preparing') {
        notifyFoodOrderMilestone(order, restaurant, status);
      }
      if (status === 'completed') {
        await withTransaction(pool, async (client) => {
          await earnFoodLoyaltyOnComplete(client, order);
        }, 'food_loyalty_earn');
      }
    }

    res.json({
      order,
      runnerTask,
      walletRefund: transitionResult.walletRefund || null,
      payment: transitionResult.payment || null,
      replayed: Boolean(transitionResult.replayed),
    });
  } catch (err) {
    next(err);
  }
};

exports.updateOrderPayment = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const orderId = parsePositiveInt(req.params.orderId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertRestaurantPermission(restaurant, ['orders.manage', 'credit.manage', 'pos.manage']);
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

exports.resumeFoodCheckoutSession = async (req, res, next) => {
  // H12: if checkout session creation failed after the order was placed (or
  // the customer abandoned the tab), the customer resumes payment here instead
  // of placing a duplicate order. Replays the existing session when one is
  // already stamped on the order.
  try {
    const orderId = parsePositiveInt(req.params.orderId);
    if (!orderId) throw new AppError('Order not found', 404, 'order_not_found');
    const { rows: orderRows } = await pool.query(
      `SELECT fo.*,
              b.stripe_account_id AS business_stripe_account_id
         FROM food_orders fo
         LEFT JOIN businesses b ON b.id = fo.business_id
        WHERE fo.id = $1`,
      [orderId]
    );
    const order = orderRows[0];
    if (!order) throw new AppError('Order not found', 404, 'order_not_found');
    const isCustomer = order.customer_id && req.user?.id === order.customer_id;
    if (!isCustomer) throw new AppError('Order not found', 404, 'order_not_found');
    const paymentMode = order.metadata?.paymentMode || order.metadata?.payment_mode || null;
    if (paymentMode && paymentMode !== 'pay_now') {
      throw new AppError('This order does not use online checkout', 409, 'checkout_not_applicable');
    }
    if (order.payment_status === 'paid') {
      throw new AppError('This order is already paid', 409, 'order_already_paid');
    }
    const { rows: itemRows } = await pool.query(
      `SELECT foi.quantity, foi.item_name AS name
         FROM food_order_items foi
        WHERE foi.order_id = $1
        ORDER BY foi.id`,
      [orderId]
    );
    const orderItems = itemRows.map((row) => ({
      quantity: Number(row.quantity || 1),
      menuItem: { name: row.name || 'Item' },
    }));
    const result = await createFoodCheckoutSession({
      order,
      orderItems,
      customerEmail: normalizeString(req.user?.email || req.body.guestEmail || req.body.guest_email, 255),
      returnUrl: safeReturnUrl(req.body.returnUrl || req.body.return_url),
      connectedAccountId: order.business_stripe_account_id
        || order.metadata?.stripeCheckout?.connectedAccountId
        || order.metadata?.stripe_checkout?.connectedAccountId
        || null,
    });
    res.status(result.replayed ? 200 : 201).json({
      order: result.order,
      payment: result.payment,
      replayed: Boolean(result.replayed),
    });
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
      `SELECT fo.*,
              b.stripe_account_id AS business_stripe_account_id
         FROM food_orders fo
         LEFT JOIN businesses b ON b.id = fo.business_id
        WHERE fo.id = $1`,
      [orderId]
    );
    const order = orderRows[0];
    if (!order) throw new AppError('Order not found', 404, 'order_not_found');

    const connectedAccountId = normalizeString(
      order.business_stripe_account_id
        || order.metadata?.stripeCheckout?.connectedAccountId
        || order.metadata?.stripe_checkout?.connectedAccountId,
      255
    );
    const session = await stripe.checkout.sessions.retrieve(
      sessionId,
      connectedAccountId ? { expand: ['payment_intent'], stripeAccount: connectedAccountId } : { expand: ['payment_intent'] }
    );
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
    const trackingToken = normalizeString(req.query.tracking_token || req.query.trackingToken, 255);
    const returnUrl = safeReturnUrl(req.query.return_url);
    if (!orderId || !trackingToken) throw new AppError('Order not found', 404, 'order_not_found');

    const { rows } = await pool.query(
      `SELECT queue_number
         FROM food_orders
        WHERE id = $1
          AND metadata->>'trackingToken' = $2`,
      [orderId, trackingToken]
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
      `SELECT fr.*,
              b.stripe_account_id AS business_stripe_account_id,
              b.stripe_charges_enabled AS business_stripe_charges_enabled,
              b.stripe_payouts_enabled AS business_stripe_payouts_enabled,
              b.stripe_account_status AS business_stripe_account_status,
              CASE
                WHEN fr.owner_user_id = $1 OR b.user_id = $1 THEN 'owner'
                ELSE bm.role
              END AS effective_role,
              bm.id AS effective_membership_id
         FROM food_restaurants fr
         JOIN businesses b ON b.id = fr.business_id
         LEFT JOIN business_members bm
           ON bm.business_id = fr.business_id
          AND bm.member_id = $1
          AND bm.status = 'active'
        WHERE fr.owner_user_id = $1
           OR b.user_id = $1
           OR bm.id IS NOT NULL
        ORDER BY fr.created_at DESC`,
      [req.user.id]
    );
    const restaurants = await Promise.all(rows.map(async (restaurant) => {
      const oxsteed_pay_url = await getOwnerOxsteedPayUrl(restaurant.business_id);
      if (restaurant.effective_role === 'owner') {
        return { ...restaurant, permissions: ['*'], oxsteed_pay_url };
      }
      const { permissions } = await permissionsService.getEffectivePermissions({
        businessId: restaurant.business_id,
        userId: req.user.id,
        role: restaurant.effective_role,
        membershipId: restaurant.effective_membership_id,
      });
      return { ...restaurant, permissions: [...permissions].sort(), oxsteed_pay_url };
    }));
    res.json({ restaurants });
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
  taxRateBps: { column: 'tax_rate_bps', value: (v) => Math.max(0, Math.min(10000, Math.round(Number(v) || 0))) },
};
function normalizeRestaurantCheckoutSettingsPatch(settings = {}) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {};
  const patch = {};
  if (settings.requireGuestNameForPickup !== undefined || settings.require_guest_name_for_pickup !== undefined) {
    patch.requireGuestNameForPickup = normalizeBoolean(
      settings.requireGuestNameForPickup ?? settings.require_guest_name_for_pickup,
      true
    );
  }
  if (settings.requireContactForUpdates !== undefined || settings.require_contact_for_updates !== undefined) {
    patch.requireContactForUpdates = normalizeBoolean(
      settings.requireContactForUpdates ?? settings.require_contact_for_updates,
      false
    );
  }
  return patch;
}

function normalizeFoodExternalPaymentSettingsPatch(settings = {}) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {};
  const patch = {};
  if (settings.externalPaymentEnabled !== undefined || settings.external_payment_enabled !== undefined) {
    patch.externalPaymentEnabled = normalizeBoolean(
      settings.externalPaymentEnabled ?? settings.external_payment_enabled,
      false
    );
  }
  if (settings.requireExternalPaymentProof !== undefined || settings.require_external_payment_proof !== undefined) {
    patch.requireExternalPaymentProof = normalizeBoolean(
      settings.requireExternalPaymentProof ?? settings.require_external_payment_proof,
      false
    );
  }
  if (settings.externalPaymentLabel !== undefined || settings.external_payment_label !== undefined) {
    patch.externalPaymentLabel = normalizeString(
      settings.externalPaymentLabel ?? settings.external_payment_label,
      120
    );
  }
  if (settings.externalPaymentHandle !== undefined || settings.external_payment_handle !== undefined) {
    patch.externalPaymentHandle = normalizeString(
      settings.externalPaymentHandle ?? settings.external_payment_handle,
      120
    );
  }
  if (settings.externalPaymentInstructions !== undefined || settings.external_payment_instructions !== undefined) {
    patch.externalPaymentInstructions = normalizeString(
      settings.externalPaymentInstructions ?? settings.external_payment_instructions,
      2000
    );
  }
  if (settings.externalPaymentReferenceHint !== undefined || settings.external_payment_reference_hint !== undefined) {
    patch.externalPaymentReferenceHint = normalizeString(
      settings.externalPaymentReferenceHint ?? settings.external_payment_reference_hint,
      255
    );
  }
  if (settings.externalPaymentQrUrl !== undefined || settings.external_payment_qr_url !== undefined) {
    patch.externalPaymentQrUrl = normalizeString(
      settings.externalPaymentQrUrl ?? settings.external_payment_qr_url,
      2000
    );
  }
  return patch;
}

function normalizeFoodExternalPaymentSubmission(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const proofInput = value.proof && typeof value.proof === 'object' && !Array.isArray(value.proof) ? value.proof : {};
  const method = normalizeString(value.method ?? value.paymentMethod ?? value.payment_method, 80);
  const attachmentUrl = normalizeString(
    value.attachmentUrl
      ?? value.attachment_url
      ?? value.receiptUrl
      ?? value.receipt_url
      ?? proofInput.attachmentUrl
      ?? proofInput.attachment_url
      ?? proofInput.url
      ?? proofInput.receiptUrl
      ?? proofInput.receipt_url,
    2000
  );
  const attachmentKey = normalizeString(
    value.attachmentKey
      ?? value.attachment_key
      ?? value.receiptKey
      ?? value.receipt_key
      ?? proofInput.attachmentKey
      ?? proofInput.attachment_key
      ?? proofInput.key
      ?? proofInput.receiptKey
      ?? proofInput.receipt_key,
    512
  );
  const attachmentName = normalizeString(
    value.attachmentName
      ?? value.attachment_name
      ?? value.receiptName
      ?? value.receipt_name
      ?? proofInput.attachmentName
      ?? proofInput.attachment_name
      ?? proofInput.name
      ?? proofInput.receiptName
      ?? proofInput.receipt_name,
    255
  );
  const attachmentType = normalizeString(
    value.attachmentType
      ?? value.attachment_type
      ?? value.receiptType
      ?? value.receipt_type
      ?? proofInput.attachmentType
      ?? proofInput.attachment_type
      ?? proofInput.type
      ?? proofInput.receiptType
      ?? proofInput.receipt_type,
    120
  );
  const reference = normalizeString(value.reference ?? value.paymentReference ?? value.payment_reference ?? value.confirmationNumber ?? value.confirmation_number, 120);
  const note = normalizeString(value.note ?? value.message ?? value.memo, 1000);
  const handle = normalizeString(value.handle ?? value.paymentHandle ?? value.payment_handle, 120);
  const label = normalizeString(value.label ?? value.paymentLabel ?? value.payment_label, 120);
  const instructions = normalizeString(value.instructions ?? value.paymentInstructions ?? value.payment_instructions, 2000);
  const referenceHint = normalizeString(value.referenceHint ?? value.reference_hint, 255);
  const qrUrl = normalizeString(value.qrUrl ?? value.qr_url, 2000);
  const proofRequiredRaw = value.proofRequired ?? value.proof_required;
  const receiptConfirmedRaw = value.receiptConfirmed ?? value.receipt_confirmed;
  const proofRequired = proofRequiredRaw === undefined || proofRequiredRaw === null
    ? null
    : normalizeBoolean(proofRequiredRaw, false);
  const receiptConfirmed = receiptConfirmedRaw === undefined || receiptConfirmedRaw === null
    ? null
    : normalizeBoolean(receiptConfirmedRaw, false);
  const attachmentSizeBytesRaw = value.attachmentSizeBytes
    ?? value.attachment_size_bytes
    ?? value.sizeBytes
    ?? value.size_bytes
    ?? proofInput.attachmentSizeBytes
    ?? proofInput.attachment_size_bytes
    ?? proofInput.sizeBytes
    ?? proofInput.size_bytes;
  const attachmentSizeBytes = attachmentSizeBytesRaw === undefined || attachmentSizeBytesRaw === null
    ? null
    : Number.isFinite(Number(attachmentSizeBytesRaw))
      ? Number(attachmentSizeBytesRaw)
      : null;
  const proof = {
    method,
    reference,
    note,
    handle,
    label,
    instructions,
    referenceHint,
    proofRequired,
    receiptConfirmed,
    qrUrl,
    attachmentUrl,
    attachmentKey,
    attachmentName,
    attachmentType,
    attachmentSizeBytes,
    ...(attachmentUrl ? {
      proof: {
        attachmentUrl,
        attachmentKey,
        attachmentName,
        attachmentType,
        attachmentSizeBytes,
      },
    } : {}),
  };
  if (!Object.values(proof).some((entry) => {
    if (entry === null || entry === undefined) return false;
    if (typeof entry === 'number') return true;
    return String(entry).trim() !== '';
  })) {
    return null;
  }
  return proof;
}
const OWNER_SETTABLE_STATUS = new Set(['draft', 'active', 'paused']);

exports.updateRestaurant = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurantAccess = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertRestaurantManage(restaurantAccess);

    const sets = [];
    const params = [];
    for (const [key, spec] of Object.entries(RESTAURANT_PATCH_FIELDS)) {
      const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      const raw = req.body[key] !== undefined ? req.body[key] : req.body[snake];
      if (raw === undefined) continue;
      params.push(spec.value(raw));
      sets.push(`${spec.column} = $${params.length}`);
    }
    const settingsInput = req.body.settings || req.body.restaurantSettings || req.body.restaurant_settings;
    const settingsPatch = {
      ...normalizeRestaurantCheckoutSettingsPatch(settingsInput),
      ...normalizeFoodExternalPaymentSettingsPatch(settingsInput),
    };
    if (Object.keys(settingsPatch).length > 0) {
      params.push(JSON.stringify(settingsPatch));
      sets.push(`settings = COALESCE(settings, '{}'::jsonb) || $${params.length}::jsonb`);
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
      sets.push(`discovery_status = ${status === 'active' ? "'visible'" : "'hidden'"}`);
    }
    if (sets.length === 0) {
      throw new AppError('Validation failed', 400, 'validation_failed', { body: 'No updatable fields provided' });
    }

    params.push(restaurantId);
    const restaurant = await withTransaction(pool, async (client) => {
      let updated;
      try {
        ({ rows: [updated] } = await client.query(
          `UPDATE food_restaurants SET ${sets.join(', ')}, updated_at = NOW()
            WHERE id = $${params.length}
            RETURNING *`,
          params
        ));
      } catch (updateErr) {
        const missingCol = updateErr && (
          updateErr.code === '42703'
          || /column .* does not exist/i.test(String(updateErr.message || ''))
        );
        const discoverySet = sets.some((s) => s.startsWith('discovery_status'));
        if (!missingCol || !discoverySet) throw updateErr;
        logger.warn('updateRestaurant: discovery_status missing; retrying without it', {
          restaurantId,
          err: updateErr.message,
          code: updateErr.code,
        });
        const fallbackSets = sets.filter((s) => !s.startsWith('discovery_status'));
        ({ rows: [updated] } = await client.query(
          `UPDATE food_restaurants SET ${fallbackSets.join(', ')}, updated_at = NOW()
            WHERE id = $${params.length}
            RETURNING *`,
          params
        ));
      }

      if (status === 'active') {
        const { rows: [readiness] } = await client.query(
          `SELECT COUNT(*)::int AS menu_item_count
             FROM food_menu_items
            WHERE restaurant_id = $1 AND is_available = TRUE`,
          [restaurantId]
        );
        const missing = [];
        if (!updated.display_name?.trim()) missing.push('name');
        if (!updated.address_city?.trim()) missing.push('location');
        if (Number(readiness?.menu_item_count || 0) < 1) missing.push('menu');
        if (missing.length) {
          throw new AppError('Complete restaurant setup before publishing', 409, 'restaurant_setup_incomplete', { missing });
        }
      }

      if (status && updated.business_id) {
        const active = status === 'active';
        const paused = status === 'paused';
        await client.query(
          `UPDATE businesses
              SET business_kind = 'restaurant', business_mode = 'food', industry_category = 'food',
                  setup_status = $1, is_active = TRUE, is_listed = $2,
                  published_at = CASE WHEN $2 THEN COALESCE(published_at, NOW()) ELSE published_at END,
                  profile_version = profile_version + 1,
                  updated_at = NOW()
            WHERE id = $3`,
          [active || paused ? 'active' : 'in_progress', active, updated.business_id]
        );
        await client.query(
          `INSERT INTO business_audit_log
             (business_id, actor_user_id, actor_role, action, target_type, target_id, after_state)
           VALUES ($1,$2,$3,$4,'restaurant',$5,$6::jsonb)`,
          [
            updated.business_id,
            req.user.id,
            restaurantAccess.effective_role,
            active ? 'business.published' : 'business.restaurant_status_changed',
            updated.id,
            JSON.stringify({ status }),
          ]
        );
      }
      return updated;
    }, 'restaurant_update');
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
    await assertRestaurantPermission(restaurant, ['menu.manage', 'restaurant.manage']);
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
    await assertRestaurantPermission(restaurant, ['menu.manage', 'restaurant.manage']);
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
    await assertRestaurantPermission(restaurant, ['menu.manage', 'restaurant.manage']);

    const sets = [];
    const params = [];
    const add = (column, value, cast = '') => {
      params.push(value);
      sets.push(`${column} = $${params.length}${cast}`);
    };
    const has = (...keys) => keys.some((key) => Object.prototype.hasOwnProperty.call(req.body, key));

    if (has('name')) {
      const name = normalizeString(req.body.name, 160);
      if (!name) throw new AppError('Validation failed', 400, 'validation_failed', { name: 'Name is required' });
      add('name', name);
    }
    if (has('description')) add('description', normalizeString(req.body.description, 2000));
    if (has('imageUrl', 'image_url')) add('image_url', normalizeString(req.body.imageUrl ?? req.body.image_url, 1000));
    if (has('priceCents', 'price_cents')) {
      add('price_cents', parseMoneyCents(req.body.priceCents ?? req.body.price_cents, 'priceCents'));
    }
    if (has('categoryId', 'category_id')) {
      add('category_id', parsePositiveInt(req.body.categoryId ?? req.body.category_id));
    }
    if (has('isAvailable', 'is_available')) {
      const available = req.body.isAvailable ?? req.body.is_available;
      if (typeof available !== 'boolean') {
        throw new AppError('Validation failed', 400, 'validation_failed', { isAvailable: 'Availability must be true or false' });
      }
      params.push(available);
      sets.push(`manual_available = $${params.length}`);
      sets.push(`is_available = $${params.length} AND inventory_available`);
    }
    if (has('sortOrder', 'sort_order')) {
      const sortOrder = Number(req.body.sortOrder ?? req.body.sort_order);
      if (!Number.isFinite(sortOrder)) {
        throw new AppError('Validation failed', 400, 'validation_failed', { sortOrder: 'Sort order must be a number' });
      }
      add('sort_order', Math.round(sortOrder));
    }
    if (has('tags')) add('tags', normalizeTextArray(req.body.tags, 20));
    if (has('allergens')) add('allergens', normalizeTextArray(req.body.allergens, 20));
    if (has('publicationStatus', 'publication_status')) {
      const status = req.body.publicationStatus ?? req.body.publication_status;
      if (!['draft', 'published'].includes(status)) {
        throw new AppError('Validation failed', 400, 'validation_failed', { publicationStatus: 'Use draft or published' });
      }
      add('publication_status', status);
    }
    if (has('archived')) {
      sets.push(req.body.archived ? 'archived_at = NOW()' : 'archived_at = NULL');
    }
    if (has('availabilitySchedule', 'availability_schedule')) {
      const schedule = req.body.availabilitySchedule ?? req.body.availability_schedule;
      if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) {
        throw new AppError('Validation failed', 400, 'validation_failed', { availabilitySchedule: 'Schedule must be an object' });
      }
      add('availability_schedule', JSON.stringify(schedule), '::jsonb');
    }

    if (!sets.length) {
      throw new AppError('Validation failed', 400, 'validation_failed', { body: 'No updatable fields provided' });
    }
    sets.push('updated_at = NOW()');
    params.push(itemId, restaurantId);
    const { rows: [item] } = await pool.query(
      `UPDATE food_menu_items SET ${sets.join(', ')}
        WHERE id = $${params.length - 1} AND restaurant_id = $${params.length}
        RETURNING *`,
      params
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
    await assertRestaurantPermission(restaurant, ['menu.manage', 'restaurant.manage']);
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
    await assertRestaurantPermission(restaurant, ['menu.manage', 'restaurant.manage']);
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

exports.updateModifierGroup = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const groupId = parsePositiveInt(req.params.groupId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertRestaurantPermission(restaurant, ['menu.manage', 'restaurant.manage']);
    const name = normalizeString(req.body.name, 120);
    if (!name) throw new AppError('Validation failed', 400, 'validation_failed', { name: 'Name is required' });
    const options = Array.isArray(req.body.options) ? req.body.options.slice(0, 30) : [];

    const group = await withTransaction(pool, async (client) => {
      const minSelect = Math.max(0, parsePositiveInt(req.body.minSelect ?? req.body.min_select, 0) || 0);
      const maxSelect = Math.max(minSelect, parsePositiveInt(req.body.maxSelect ?? req.body.max_select, 1) || 1);
      const { rows: [updated] } = await client.query(
        `UPDATE food_modifier_groups
            SET name = $1, min_select = $2, max_select = $3,
                is_required = $4, sort_order = $5
          WHERE id = $6 AND restaurant_id = $7
          RETURNING *`,
        [
          name,
          minSelect,
          maxSelect,
          req.body.isRequired === true || req.body.is_required === true,
          Number.parseInt(req.body.sortOrder || req.body.sort_order || 0, 10) || 0,
          groupId,
          restaurantId,
        ]
      );
      if (!updated) throw new AppError('Modifier group not found', 404, 'modifier_group_not_found');

      await client.query('DELETE FROM food_modifiers WHERE modifier_group_id = $1', [groupId]);
      const updatedOptions = [];
      for (let i = 0; i < options.length; i += 1) {
        const optionName = normalizeString(options[i]?.name, 120);
        if (!optionName) continue;
        const delta = Number(options[i]?.priceDeltaCents ?? options[i]?.price_delta_cents ?? 0);
        const { rows: [option] } = await client.query(
          `INSERT INTO food_modifiers
             (modifier_group_id, name, price_delta_cents, is_available, sort_order)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING *`,
          [
            groupId,
            optionName,
            Number.isFinite(delta) ? Math.round(delta) : 0,
            options[i]?.isAvailable !== false && options[i]?.is_available !== false,
            i,
          ]
        );
        updatedOptions.push(option);
      }
      return { ...updated, options: updatedOptions };
    }, 'food_update_modifier_group');

    res.json({ modifierGroup: group });
  } catch (err) {
    next(err);
  }
};

exports.duplicateMenuItem = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const itemId = parsePositiveInt(req.params.itemId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertRestaurantPermission(restaurant, ['menu.manage', 'restaurant.manage']);

    const item = await withTransaction(pool, async (client) => {
      const { rows: [source] } = await client.query(
        'SELECT * FROM food_menu_items WHERE id = $1 AND restaurant_id = $2',
        [itemId, restaurantId]
      );
      if (!source) throw new AppError('Menu item not found', 404, 'menu_item_not_found');
      const { rows: [created] } = await client.query(
        `INSERT INTO food_menu_items
           (restaurant_id, category_id, name, description, image_url, price_cents,
            currency_code, is_available, manual_available, inventory_available,
            inventory_availability_state, sort_order, tags, allergens, nutrition,
            publication_status, availability_schedule)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,TRUE,'available',$9,$10,$11,$12,'draft',$13)
         RETURNING *`,
        [
          restaurantId,
          source.category_id,
          normalizeString(req.body.name, 160) || `${source.name} copy`,
          source.description,
          source.image_url,
          source.price_cents,
          source.currency_code,
          source.manual_available !== false,
          Number(source.sort_order || 0) + 1,
          source.tags || [],
          source.allergens || [],
          source.nutrition || {},
          source.availability_schedule || {},
        ]
      );

      const { rows: groups } = await client.query(
        'SELECT * FROM food_modifier_groups WHERE menu_item_id = $1 ORDER BY sort_order, id',
        [itemId]
      );
      for (const sourceGroup of groups) {
        const { rows: [newGroup] } = await client.query(
          `INSERT INTO food_modifier_groups
             (restaurant_id, menu_item_id, name, min_select, max_select, is_required, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING *`,
          [restaurantId, created.id, sourceGroup.name, sourceGroup.min_select, sourceGroup.max_select, sourceGroup.is_required, sourceGroup.sort_order]
        );
        await client.query(
          `INSERT INTO food_modifiers
             (modifier_group_id, name, price_delta_cents, is_available, sort_order)
           SELECT $1, name, price_delta_cents, is_available, sort_order
             FROM food_modifiers
            WHERE modifier_group_id = $2`,
          [newGroup.id, sourceGroup.id]
        );
      }
      return created;
    }, 'food_duplicate_menu_item');

    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
};

exports.deleteModifierGroup = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const groupId = parsePositiveInt(req.params.groupId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertRestaurantPermission(restaurant, ['menu.manage', 'restaurant.manage']);
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
      `SELECT fr.id, fr.display_name, fr.logo_url, fr.settings
         FROM food_restaurants fr
         JOIN businesses b ON b.id = fr.business_id
        WHERE fr.id = $1
          AND fr.status IN ('active','paused')
                    AND fr.discovery_status = 'visible'
                    AND COALESCE(fr.is_hidden_by_admin, FALSE) = FALSE
          AND b.is_active = TRUE
          AND b.is_listed = TRUE
          AND COALESCE(b.setup_status, 'active') IN ('active', 'paused')
          AND COALESCE(b.business_kind, 'restaurant') = 'restaurant'
          AND b.deleted_at IS NULL`,
      [restaurantId]
    );
    if (!restaurants[0]) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');

    const { rows } = await pool.query(
      `SELECT queue_number, status, guest_name, table_label, fulfillment_type, promised_at,
              completed_at, handed_off_at, metadata
         FROM food_orders
        WHERE restaurant_id = $1
          AND (created_at AT TIME ZONE COALESCE(
            (SELECT timezone FROM food_restaurants WHERE id = $1), 'UTC'
          ))::date = (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(
            (SELECT timezone FROM food_restaurants WHERE id = $1), 'UTC'
          ))::date
          AND status IN ('received','accepted','preparing','ready','completed')
        ORDER BY queue_number ASC`,
      [restaurantId]
    );
    const queueSettings = restaurants[0].settings?.queueBoard
      || restaurants[0].settings?.queue_board
      || restaurants[0].settings?.kitchenPrep
      || {};
    const showGuestNames = queueSettings.showGuestNames ?? queueSettings.show_guest_names ?? false;
    const handoffDisplaySeconds = Math.max(0, Math.min(120, Number(
      queueSettings.handoffDisplaySeconds ?? queueSettings.handoff_display_seconds ?? 15
    ) || 0));
    const nowMs = Date.now();
    const visibleRows = rows.filter((row) => {
      if (row.status !== 'completed') return true;
      const handedOffAt = row.handed_off_at || row.completed_at;
      return handedOffAt && nowMs - new Date(handedOffAt).getTime() <= handoffDisplaySeconds * 1000;
    });
    res.json({
      restaurant: {
        id: restaurants[0].id,
        display_name: restaurants[0].display_name,
        logo_url: restaurants[0].logo_url,
      },
      externalPaymentCount: visibleRows.filter((r) => {
        const externalPayment = r.metadata && typeof r.metadata === 'object'
          ? r.metadata.externalPayment || r.metadata.external_payment || null
          : null;
        return Boolean(externalPayment);
      }).length,
      preparing: visibleRows.filter((r) => !['ready', 'completed'].includes(r.status)).map((r) => r.queue_number),
      ready: visibleRows.filter((r) => ['ready', 'completed'].includes(r.status)).map((r) => r.queue_number),
      preparingEntries: visibleRows
        .filter((r) => !['ready', 'completed'].includes(r.status))
        .map((r) => ({
          queueNumber: r.queue_number,
          guestLabel: publicQueueGuestLabel(r, { showGuestNames }),
          fulfillmentType: r.fulfillment_type,
          promisedAt: r.promised_at,
        })),
      readyEntries: visibleRows
        .filter((r) => ['ready', 'completed'].includes(r.status))
        .map((r) => ({
          queueNumber: r.queue_number,
          guestLabel: publicQueueGuestLabel(r, { showGuestNames }),
          fulfillmentType: r.fulfillment_type,
          promisedAt: r.promised_at,
        })),
      serverTime: new Date().toISOString(),
      handoffDisplaySeconds,
      nextPollAfterMs: visibleRows.length ? 2000 : 5000,
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
      `SELECT fo.id, fo.restaurant_id, fo.status, fo.payment_status,
              fo.order_source, fo.fulfillment_type, fo.subtotal_cents,
              fo.tax_cents, fo.service_fee_cents, fo.delivery_fee_cents,
              fo.tip_cents, fo.discount_cents, fo.total_cents, fo.currency_code,
              fo.table_label, fo.queue_number, fo.promised_at, fo.created_at,
              fo.updated_at, fo.accepted_at, fo.ready_at, fo.completed_at,
              fo.cancelled_at, fo.stripe_payment_intent_id,
              fr.display_name AS restaurant_name, fr.prep_time_min,
              EXISTS (SELECT 1 FROM food_reviews rv WHERE rv.order_id = fo.id) AS has_review,
              COALESCE(json_agg(json_build_object(
                'id', foi.id,
                'menuItemId', foi.menu_item_id,
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
    res.json({ order: publicTrackedOrder(order) });
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
      // H5: admin-hidden restaurants cannot be (re-)favorited.
      `SELECT id FROM food_restaurants
        WHERE id = $1
          AND status IN ('active', 'paused', 'draft')
          AND COALESCE(is_hidden_by_admin, FALSE) = FALSE`,
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
          AND fmi.publication_status = 'published'
          AND fmi.archived_at IS NULL
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
        WHERE id = $1
          AND restaurant_id = $2
          AND publication_status = 'published'
          AND archived_at IS NULL`,
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
              AND requested.menu_item_id = fmi.id
            WHERE fmi.publication_status = 'published'
              AND fmi.archived_at IS NULL`,
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
                'menuItemId', foi.menu_item_id,
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
                'menuItemId', foi.menu_item_id,
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
      let restaurant = null;
      try {
        restaurant = await requireRestaurantAccess(req.user?.id, order.restaurant_id);
      } catch (_) {
        throw new AppError('Order not found', 404, 'order_not_found');
      }
      // Staff must have orders.view (or kitchen.view for KDS). Membership alone
      // is not enough; this endpoint returns guest PII and payment fields.
      await assertRestaurantPermission(restaurant, ['orders.view', 'orders.manage', 'kitchen.view', 'kitchen.update']);

      // Mask sensitive fields for roles without orders.manage.
      const canSeeSensitive = await hasRestaurantPermission(restaurant, ['orders.manage']);
      if (!canSeeSensitive) {
        order = {
          ...order,
          guest_phone: order.guest_phone ? '***' : null,
          guest_email: order.guest_email ? '***' : null,
          stripe_payment_intent_id: undefined,
          metadata: undefined,
        };
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
        `SELECT p.id, p.code, p.title, p.description, p.discount_percent, p.discount_cents,
                p.min_subtotal_cents, p.valid_from, p.valid_until
           FROM food_restaurant_promotions p
           JOIN food_restaurants fr ON fr.id = p.restaurant_id
           JOIN businesses b ON b.id = fr.business_id
          WHERE p.restaurant_id = $1
            AND fr.status IN ('active', 'paused')
                      AND fr.discovery_status = 'visible'
                      AND COALESCE(fr.is_hidden_by_admin, FALSE) = FALSE
            AND b.is_active = TRUE
            AND b.is_listed = TRUE
            AND COALESCE(b.setup_status, 'active') IN ('active', 'paused')
            AND COALESCE(b.business_kind, 'restaurant') = 'restaurant'
            AND b.deleted_at IS NULL
            AND p.is_active = TRUE
            AND (p.valid_from IS NULL OR p.valid_from <= CURRENT_DATE)
            AND (p.valid_until IS NULL OR p.valid_until >= CURRENT_DATE)
          ORDER BY p.created_at DESC
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
    await assertRestaurantManage(restaurant);
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
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertRestaurantPermission(restaurant, ['settings.view', 'settings.manage', 'restaurant.manage']);
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
    await assertRestaurantManage(restaurant);

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
      `SELECT COUNT(*)::int AS count
         FROM food_menu_items
        WHERE restaurant_id = $1
          AND publication_status = 'published'
          AND archived_at IS NULL`,
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
    const access = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertRestaurantPermission(access, ['settings.view', 'settings.manage', 'restaurant.manage']);
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
        const access = await requireRestaurantAccess(req.user.id, restaurantId);
        await assertRestaurantPermission(access, ['settings.view', 'settings.manage', 'restaurant.manage']);
        isMerchant = true;
      } catch (_) {
        isMerchant = false;
      }
    }
    if (!isMerchant) {
      const { rows: restaurants } = await pool.query(
        `SELECT fr.id
           FROM food_restaurants fr
           JOIN businesses b ON b.id = fr.business_id
          WHERE fr.id = $1
            AND fr.status = 'active'
                      AND fr.discovery_status = 'visible'
                      AND COALESCE(fr.is_hidden_by_admin, FALSE) = FALSE
            AND b.is_active = TRUE
            AND b.is_listed = TRUE
            AND COALESCE(b.setup_status, 'active') = 'active'
            AND COALESCE(b.business_kind, 'restaurant') = 'restaurant'
            AND b.deleted_at IS NULL`,
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
    await assertRestaurantManage(restaurant);
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
    await assertRestaurantManage(restaurant);
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

exports.createRestaurantCustomerMessage = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) {
      throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    }

    const subject = normalizeString(req.body.subject, 160);
    const message = normalizeString(req.body.message || req.body.body, 2500);
    const clientMessageId = req.get('Idempotency-Key')
      || req.body.clientMessageId
      || req.body.client_message_id
      || null;
    if (!message) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        message: 'Message is required',
      });
    }
    if (clientMessageId && !isUuid(clientMessageId)) {
      throw new AppError('clientMessageId must be a valid UUID', 400, 'validation_failed');
    }

    const { rows: [restaurant] } = await pool.query(
      `SELECT fr.id, fr.business_id, fr.owner_user_id, fr.display_name, fr.status
         FROM food_restaurants fr
         JOIN businesses b ON b.id = fr.business_id
        WHERE fr.id = $1
          AND fr.status IN ('active', 'paused', 'draft')
          AND b.is_active = TRUE
          AND b.deleted_at IS NULL
          -- H5: admin-hidden restaurants are not contactable.
          AND COALESCE(fr.is_hidden_by_admin, FALSE) = FALSE`,
      [restaurantId]
    );
    if (!restaurant) {
      throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    }

    const cleanSubject = subject || `Question for ${restaurant.display_name}`;
    const chatContent = sanitizeMessage(
      cleanSubject ? `${cleanSubject}\n\n${message}` : message
    ).slice(0, 4000);
    const customerName = `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'OxSteed customer';
    const customerEmail = req.user.email || null;
    const canCreateInboxThread = restaurant.business_id
      && restaurant.owner_user_id
      && String(restaurant.owner_user_id) !== String(req.user.id);

    const result = await withTransaction(pool, async (client) => {
      if (clientMessageId) {
        const { rows: replayRows } = await client.query(
          `SELECT id, restaurant_id, business_id, customer_user_id, subject, message, status,
                  conversation_id, chat_message_id, created_at
             FROM food_restaurant_customer_messages
            WHERE restaurant_id = $1
              AND customer_user_id = $2
              AND client_message_id = $3`,
          [restaurant.id, req.user.id, clientMessageId]
        );
        if (replayRows[0]) {
          return {
            record: replayRows[0],
            conversationId: replayRows[0].conversation_id,
            chatMessageId: replayRows[0].chat_message_id,
            replayed: true,
          };
        }
      }

      let threadId = null;
      let messageId = null;

      if (canCreateInboxThread) {
        const existing = await client.query(
          `SELECT id
             FROM conversations
            WHERE customer_id = $1
              AND helper_id = $2
              AND job_id IS NULL
              AND business_id = $3
            LIMIT 1`,
          [req.user.id, restaurant.owner_user_id, restaurant.business_id]
        );

        if (existing.rows[0]) {
          threadId = existing.rows[0].id;
        } else {
          const insertedConversation = await client.query(
            `INSERT INTO conversations (customer_id, helper_id, job_id, business_id, last_message_at)
             VALUES ($1, $2, NULL, $3, NOW())
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [req.user.id, restaurant.owner_user_id, restaurant.business_id]
          );

          if (insertedConversation.rows[0]) {
            threadId = insertedConversation.rows[0].id;
          } else {
            const concurrent = await client.query(
              `SELECT id
                 FROM conversations
                WHERE customer_id = $1
                  AND helper_id = $2
                  AND job_id IS NULL
                  AND business_id = $3
                LIMIT 1`,
              [req.user.id, restaurant.owner_user_id, restaurant.business_id]
            );
            threadId = concurrent.rows[0] && concurrent.rows[0].id;
          }
        }

        if (!threadId) {
          throw new AppError('Failed to create restaurant conversation', 500, 'restaurant_conversation_failed');
        }

        const insertedMessage = await client.query(
          `INSERT INTO messages
             (conversation_id, sender_id, content, message_type, client_message_id)
           VALUES ($1, $2, $3, 'text', $4)
           ON CONFLICT (conversation_id, client_message_id)
           WHERE client_message_id IS NOT NULL DO NOTHING
           RETURNING id, conversation_id, sender_id, content, message_type, is_read, created_at`,
          [threadId, req.user.id, chatContent, clientMessageId]
        );
        messageId = insertedMessage.rows[0] && insertedMessage.rows[0].id;
        if (!messageId && clientMessageId) {
          const { rows: existingMessageRows } = await client.query(
            `SELECT id FROM messages
              WHERE conversation_id = $1 AND client_message_id = $2`,
            [threadId, clientMessageId]
          );
          messageId = existingMessageRows[0] && existingMessageRows[0].id;
        }

        await client.query(
          'UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1',
          [threadId]
        );
      }

      const insertedRecord = await client.query(
        `INSERT INTO food_restaurant_customer_messages
           (restaurant_id, business_id, customer_user_id, subject, message, metadata, conversation_id, chat_message_id, client_message_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (restaurant_id, customer_user_id, client_message_id)
         WHERE client_message_id IS NOT NULL DO NOTHING
         RETURNING id, restaurant_id, business_id, customer_user_id, subject, message, status,
                   conversation_id, chat_message_id, client_message_id, created_at`,
        [
          restaurant.id,
          restaurant.business_id,
          req.user.id,
          cleanSubject,
          message,
          JSON.stringify({
            source: 'oxsteed_main_ios',
            userAgent: req.get('user-agent') || null,
          }),
          threadId,
          messageId,
          clientMessageId,
        ]
      );

      if (!insertedRecord.rows[0] && clientMessageId) {
        const { rows: replayRows } = await client.query(
          `SELECT id, restaurant_id, business_id, customer_user_id, subject, message, status,
                  conversation_id, chat_message_id, client_message_id, created_at
             FROM food_restaurant_customer_messages
            WHERE restaurant_id = $1
              AND customer_user_id = $2
              AND client_message_id = $3`,
          [restaurant.id, req.user.id, clientMessageId]
        );
        if (!replayRows[0]) throw new AppError('Restaurant message retry could not be recovered', 409, 'message_retry_failed');
        return {
          record: replayRows[0],
          conversationId: replayRows[0].conversation_id,
          chatMessageId: replayRows[0].chat_message_id,
          replayed: true,
        };
      }

      return {
        record: insertedRecord.rows[0],
        conversationId: threadId,
        chatMessageId: messageId,
        replayed: false,
      };
    }, 'create_restaurant_customer_message');
    const { record, conversationId, chatMessageId } = result;

    if (conversationId && restaurant.business_id) {
      const businessConversationId = await ensureBusinessConversation({
        businessId: restaurant.business_id,
        legacyConversationId: conversationId,
        customerId: req.user.id,
        customerName,
        customerEmail,
        customerPhone: req.user.phone || null,
        subject: cleanSubject,
        createdById: req.user.id,
      });

      await mirrorMessage({
        businessConversationId,
        senderId: req.user.id,
        senderName: customerName,
        senderEmail: customerEmail,
        senderType: 'customer',
        content: chatContent,
        messageType: 'text',
        legacyMessageId: chatMessageId,
        clientMessageId,
      });
    }

    if (!result?.replayed && restaurant.business_id) {
      const recipientIds = new Set();
      if (restaurant.owner_user_id) recipientIds.add(String(restaurant.owner_user_id));
      try {
        const { rows: reps } = await pool.query(
          `SELECT member_id
             FROM business_members
            WHERE business_id = $1 AND status = 'active'`,
          [restaurant.business_id]
        );
        reps.forEach((row) => recipientIds.add(String(row.member_id)));
      } catch (repError) {
        logger.warn('Failed to load restaurant business representatives', {
          businessId: restaurant.business_id,
          error: repError.message,
        });
      }
      recipientIds.delete(String(req.user.id));

      if (conversationId && chatMessageId) {
        socketService.broadcastToConversation(conversationId, 'message:new', {
          conversationId,
          message: {
            id: chatMessageId,
            conversation_id: conversationId,
            sender_id: req.user.id,
            sender_name: customerName,
            content: chatContent,
            message_type: 'text',
            is_read: false,
            created_at: new Date().toISOString(),
          },
        });
        recipientIds.forEach((recipientId) => {
          socketService.broadcastToUser(recipientId, 'message:new', {
            conversationId,
            messageId: chatMessageId,
          });
        });
      }

      await Promise.allSettled([...recipientIds].map((recipientId) => notificationService.sendNotification({
        userId: recipientId,
        type: 'food_restaurant_message',
        title: 'New restaurant message',
        body: `A customer sent a message to ${restaurant.display_name}.`,
        data: {
          restaurantId: String(restaurant.id),
          businessId: String(restaurant.business_id),
          messageId: String(record.id),
          conversationId: conversationId ? String(conversationId) : null,
          chatMessageId: chatMessageId ? String(chatMessageId) : null,
        },
        action_url: conversationId ? `/messages/${conversationId}` : `/business/${restaurant.business_id}`,
        idempotencyKey: `restaurant-message:${record.id}:${recipientId}`,
      })));
    }

    res.status(result?.replayed ? 200 : 201).json({
      message: record,
      conversation: conversationId ? { id: conversationId } : null,
      conversationId,
    });
  } catch (err) {
    if (isMissingRelationError(err)) {
      return next(new AppError('Restaurant messaging is not available yet', 503, 'restaurant_messaging_unavailable'));
    }
    next(err);
  }
};

exports.createRestaurantReport = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) {
      throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    }

    const allowedReasons = new Set([
      'menu_inaccurate',
      'wrong_hours_location',
      'food_safety',
      'fraud',
      'inappropriate',
      'order_issue',
      'other',
    ]);
    const reason = normalizeString(req.body.reason, 40) || 'other';
    if (!allowedReasons.has(reason)) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        reason: 'Invalid report reason',
      });
    }
    const description = normalizeString(req.body.description || req.body.message, 2500);
    const clientRequestId = getClientRequestId(req);
    if (clientRequestId === false) {
      throw new AppError('clientRequestId must be a valid UUID', 400, 'validation_failed');
    }

    const { rows: [restaurant] } = await pool.query(
      `SELECT id, business_id, display_name, status
         FROM food_restaurants
        WHERE id = $1
          AND status IN ('active', 'paused', 'draft', 'suspended')`,
      [restaurantId]
    );
    if (!restaurant) {
      throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    }

    const { rows: [userProfile] } = await pool.query(
      'SELECT first_name, last_name, email FROM users WHERE id = $1 LIMIT 1',
      [req.user.id]
    );
    const reporterName = `${userProfile?.first_name || req.user.first_name || ''} ${userProfile?.last_name || req.user.last_name || ''}`.trim() || 'OxSteed user';
    const reporterEmail = userProfile?.email || req.user.email || 'support@oxsteed.com';
    const reportPriority = ['food_safety', 'fraud', 'inappropriate'].includes(reason) ? 'high' : 'normal';

    const result = await withTransaction(pool, async (client) => {
      const supportTicket = await createLinkedSupportTicket(client, {
        userId: req.user.id,
        name: reporterName,
        email: reporterEmail,
        subject: `Restaurant report: ${restaurant.display_name}`,
        category: `restaurant_${reason}`,
        priority: reportPriority,
        source: 'direct',
        metadata: {
          app: 'oxsteed-main-ios',
          source: 'restaurant_report',
          restaurantId: String(restaurant.id),
          businessId: restaurant.business_id ? String(restaurant.business_id) : null,
          reason,
        },
        initialMessage: [
          `Restaurant: ${restaurant.display_name}`,
          `Reason: ${reason}`,
          '',
          description || 'No additional details provided.',
        ].join('\n'),
        clientRequestId,
      });

      const { rows: [report] } = await client.query(
        `INSERT INTO food_restaurant_reports
           (restaurant_id, business_id, reporter_user_id, reason, description, metadata, support_ticket_id, client_request_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (client_request_id)
         WHERE client_request_id IS NOT NULL DO NOTHING
         RETURNING id, restaurant_id, business_id, reason, description, status, support_ticket_id, created_at`,
        [
          restaurant.id,
          restaurant.business_id,
          req.user.id,
          reason,
          description,
          JSON.stringify({
            source: 'oxsteed_main_ios',
            userAgent: req.get('user-agent') || null,
            supportTicketId: String(supportTicket.id),
          }),
          supportTicket.id,
          clientRequestId,
        ]
      );

      let record = report;
      let replayed = Boolean(supportTicket.replayed);
      if (!record && clientRequestId) {
        const existing = await client.query(
          `SELECT id, restaurant_id, business_id, reason, description, status, support_ticket_id, created_at
             FROM food_restaurant_reports
            WHERE reporter_user_id = $1 AND client_request_id = $2
            LIMIT 1`,
          [req.user.id, clientRequestId],
        );
        record = existing.rows[0];
        replayed = Boolean(record) || replayed;
      }
      if (!record) throw new AppError('Restaurant report could not be created or recovered', 500, 'processing_error');
      return { record, ticket: supportTicket, replayed };
    }, 'create_restaurant_report_with_support_ticket');

    if (!result.replayed) {
      scheduleSupportMessageNotifications({
        ticketId: result.ticket?.id,
        messageId: result.ticket?.messageId,
        body: description || `Restaurant report: ${reason}`,
        title: 'New restaurant report',
      });
    }

    res.status(result?.replayed ? 200 : 201).json({
      report: result.record,
      ticket: result.ticket ? {
        id: String(result.ticket.id),
        ticketNumber: Number(result.ticket.ticket_number),
        status: result.ticket.status,
        priority: result.ticket.priority,
        createdAt: result.ticket.created_at,
      } : null,
      idempotent: Boolean(result?.replayed),
    });
  } catch (err) {
    if (isMissingRelationError(err)) {
      return next(new AppError('Restaurant reporting is not available yet', 503, 'restaurant_reporting_unavailable'));
    }
    next(err);
  }
};

// ── Test seams (exported for unit tests) ────────────────────────────────
exports._refundFoodOrderStripePayment = refundFoodOrderStripePayment;
exports._clawBackFoodLoyaltyOnRefund = clawBackFoodLoyaltyOnRefund;
exports._safeReturnUrl = safeReturnUrl;
