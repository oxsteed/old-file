'use strict';

// Restaurant network receipt printer (ESC/POS over TCP) — settings and
// fire-and-forget printing.
//
// HARD RULE: printing never touches order, payment, or ledger state.
// - getPrinterSettings / updatePrinterSettings read/write only the
//   restaurant_printer_settings configuration row.
// - printTestPage / printReceipt read settings + an order snapshot and send
//   bytes to the printer. They perform zero INSERT/UPDATE/DELETE on
//   food_orders, food_order_items, restaurant_pos_payments, or any money
//   table. A printer failure returns { ok: false, error } and can never
//   block, alter, or void an order or payment.

const pool = require('../db');
const AppError = require('../utils/appError');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const { validatePrinterHost } = require('../utils/printerHostValidation');
const escpos = require('../services/escposPrinter');

const MANAGE_ROLES = new Set(['owner', 'manager']);

function parsePositiveInt(value, fallback = null) {
  const n = Number.parseInt(value, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

function assertManage(restaurant) {
  if (!MANAGE_ROLES.has(restaurant.effective_role)) {
    throw new AppError('You do not have permission to manage this restaurant', 403, 'forbidden');
  }
}

function normalizeHost(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.length > 255) throw new AppError('Printer host is too long', 400, 'validation_failed');
  return s;
}

function normalizePort(value) {
  if (value == null || value === '') return 9100;
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new AppError('Printer port must be 1-65535', 400, 'validation_failed');
  }
  return n;
}

function settingsShape(row) {
  return {
    enabled: Boolean(row && row.enabled),
    host: row && row.host ? row.host : '',
    port: row && row.port != null ? Number(row.port) : 9100,
    drawerKickOnCash: row ? Boolean(row.drawer_kick_on_cash) : true,
  };
}

async function loadSettings(restaurantId) {
  const { rows } = await pool.query(
    `SELECT id, restaurant_id, host, port, enabled, drawer_kick_on_cash, updated_at
       FROM restaurant_printer_settings
      WHERE restaurant_id = $1`,
    [restaurantId]
  );
  return rows[0] || null;
}

function formatMoney(cents, currency) {
  const n = Number(cents || 0) / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(n);
  } catch (_) {
    return `$${n.toFixed(2)}`;
  }
}

/** Read-only order snapshot for the receipt. Same columns as reprintReceipt. */
async function loadOrderSnapshot(restaurantId, orderId) {
  const { rows: [order] } = await pool.query(
    `SELECT id, queue_number, guest_name, table_label, fulfillment_type,
            order_source, status, payment_status,
            subtotal_cents, discount_cents, tax_cents, service_fee_cents,
            delivery_fee_cents, tip_cents, total_cents, currency_code,
            created_at
       FROM food_orders
      WHERE id = $1 AND restaurant_id = $2`,
    [orderId, restaurantId]
  );
  if (!order) throw new AppError('Order not found', 404, 'order_not_found');
  const [{ rows: items }, { rows: modifiers }, { rows: payments }] = await Promise.all([
    pool.query(
      `SELECT id, item_name, quantity, unit_price_cents, line_total_cents, special_instructions
         FROM food_order_items
        WHERE order_id = $1
        ORDER BY id ASC`,
      [orderId]
    ),
    pool.query(
      `SELECT foim.order_item_id, foim.modifier_name, foim.price_delta_cents
         FROM food_order_item_modifiers foim
         JOIN food_order_items foi ON foi.id = foim.order_item_id
        WHERE foi.order_id = $1
        ORDER BY foim.order_item_id ASC, foim.id ASC`,
      [orderId]
    ),
    pool.query(
      `SELECT payment_type, amount_cents, status
         FROM restaurant_pos_payments
        WHERE restaurant_id = $1 AND food_order_id = $2
          AND status IN ('recorded', 'captured', 'refunded')
        ORDER BY created_at ASC, id ASC`,
      [restaurantId, orderId]
    ),
  ]);
  const modifiersByItem = new Map();
  for (const m of modifiers) {
    const key = String(m.order_item_id);
    if (!modifiersByItem.has(key)) modifiersByItem.set(key, []);
    modifiersByItem.get(key).push(m);
  }
  return { order, items, modifiersByItem, payments };
}

function buildOrderReceipt({ restaurant, settings, snapshot }) {
  const { order, items, modifiersByItem, payments } = snapshot;
  const currency = order.currency_code || 'USD';
  const addressParts = [restaurant.address_street, restaurant.address_city, restaurant.address_state, restaurant.address_zip]
    .filter(Boolean)
    .join(', ');

  const headerLines = [restaurant.display_name || 'OxSteed Restaurant'];
  if (addressParts) headerLines.push(addressParts);
  if (restaurant.phone) headerLines.push(restaurant.phone);

  const metaLines = [
    `Order #${order.queue_number || order.id}`,
    `Date: ${order.created_at ? new Date(order.created_at).toLocaleString() : ''}`,
  ];
  if (order.guest_name) metaLines.push(`Guest: ${order.guest_name}`);
  if (order.table_label) metaLines.push(`Table: ${order.table_label}`);
  if (order.fulfillment_type) metaLines.push(`Type: ${order.fulfillment_type}`);

  const receiptItems = items.map((item) => {
    const mods = modifiersByItem.get(String(item.id)) || [];
    return {
      qty: item.quantity,
      name: item.item_name,
      amount: formatMoney(item.line_total_cents, currency),
      subLines: [
        ...mods.map((m) => `+ ${m.modifier_name}${Number(m.price_delta_cents) ? ` (${formatMoney(m.price_delta_cents, currency)})` : ''}`),
        ...(item.special_instructions ? [`* ${item.special_instructions}`] : []),
      ],
    };
  });

  const totals = [
    { label: 'Subtotal', amount: formatMoney(order.subtotal_cents, currency) },
  ];
  if (Number(order.discount_cents) > 0) totals.push({ label: 'Discount', amount: `-${formatMoney(order.discount_cents, currency)}` });
  if (Number(order.tax_cents) > 0) totals.push({ label: 'Tax', amount: formatMoney(order.tax_cents, currency) });
  if (Number(order.service_fee_cents) > 0) totals.push({ label: 'Service fee', amount: formatMoney(order.service_fee_cents, currency) });
  if (Number(order.delivery_fee_cents) > 0) totals.push({ label: 'Delivery fee', amount: formatMoney(order.delivery_fee_cents, currency) });
  if (Number(order.tip_cents) > 0) totals.push({ label: 'Tip', amount: formatMoney(order.tip_cents, currency) });
  totals.push({ label: 'TOTAL', amount: formatMoney(order.total_cents, currency), grand: true });

  const paidTypes = payments.filter((p) => p.status !== 'refunded');
  if (paidTypes.length) {
    metaLines.push('');
    for (const p of paidTypes) {
      metaLines.push(`Paid (${p.payment_type}): ${formatMoney(p.amount_cents, currency)}`);
    }
  }

  const hasCashPayment = paidTypes.some((p) => p.payment_type === 'cash');
  return escpos.buildReceipt({
    headerLines,
    metaLines,
    items: receiptItems,
    totals,
    footerLines: ['Thank you for your business!'],
    kickDrawer: Boolean(settings.drawerKickOnCash) && hasCashPayment,
  });
}

// ── handlers ────────────────────────────────────────────────────────────────

exports.getPrinterSettings = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    await resolveRestaurantAccess(req.user.id, restaurantId);
    const row = await loadSettings(restaurantId);
    res.json({ settings: settingsShape(row) });
  } catch (err) {
    next(err);
  }
};

exports.updatePrinterSettings = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    const restaurant = await resolveRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);

    const body = req.body || {};
    const enabled = body.enabled === true || body.enabled === 'true';
    const host = normalizeHost(body.host);
    const port = normalizePort(body.port);
    const drawerKickOnCash = body.drawerKickOnCash !== false && body.drawer_kick_on_cash !== false;

    if (enabled && !host) {
      throw new AppError('A printer host is required when printing is enabled', 400, 'validation_failed');
    }

    // SSRF guard: the transport dials this host, so it must be a LAN address
    // (RFC1918 IPv4 or IPv6 unique-local). Validated again at print time.
    // The original hostname is stored (DHCP-friendly); print time dials the
    // validated resolved address to close the DNS-rebinding window.
    const { host: validatedHost } = host ? await validatePrinterHost(host) : { host: null };

    const { rows: [saved] } = await pool.query(
      `INSERT INTO restaurant_printer_settings
         (restaurant_id, host, port, enabled, drawer_kick_on_cash, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (restaurant_id)
       DO UPDATE SET host = EXCLUDED.host,
                     port = EXCLUDED.port,
                     enabled = EXCLUDED.enabled,
                     drawer_kick_on_cash = EXCLUDED.drawer_kick_on_cash,
                     updated_at = NOW()
       RETURNING id, restaurant_id, host, port, enabled, drawer_kick_on_cash, updated_at`,
      [restaurantId, validatedHost, port, enabled, drawerKickOnCash]
    );
    res.json({ settings: settingsShape(saved) });
  } catch (err) {
    next(err);
  }
};

async function requireEnabledSettings(restaurantId) {
  const row = await loadSettings(restaurantId);
  const settings = settingsShape(row);
  if (!settings.enabled) {
    throw new AppError('Receipt printing is not enabled for this restaurant', 409, 'printer_disabled');
  }
  if (!settings.host) {
    throw new AppError('No printer host configured', 409, 'printer_not_configured');
  }
  // Re-validate on every print: DNS records can change after save, and rows
  // written before the save-time check must never dial arbitrary hosts.
  // The dial uses the validated resolved address (dialHost), not the
  // hostname, so DNS cannot be flipped between validation and connect.
  // Validation only gates the TCP dial destination; it touches no money state.
  const { host, dialHost } = await validatePrinterHost(settings.host);
  return { ...settings, host, dialHost };
}

exports.printTestPage = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    const restaurant = await resolveRestaurantAccess(req.user.id, restaurantId);
    const settings = await requireEnabledSettings(restaurantId);
    // Fire-and-forget: escpos.sendToPrinter never throws; the result is
    // reported to the caller and never touches order/payment state.
    const buffer = escpos.buildTestPage({
      title: restaurant.display_name || 'PRINTER TEST',
      lines: [`${settings.host}:${settings.port}`],
    });
    // Dial the validated resolved address, never the raw hostname.
    const result = await escpos.sendToPrinter(settings.dialHost || settings.host, settings.port, buffer);
    res.json({ ok: result.ok, error: result.ok ? null : result.error });
  } catch (err) {
    next(err);
  }
};

exports.printReceipt = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    const orderId = parsePositiveInt(req.body && (req.body.order_id ?? req.body.orderId));
    if (!orderId) throw new AppError('order_id is required', 400, 'validation_failed');
    const restaurant = await resolveRestaurantAccess(req.user.id, restaurantId);
    const settings = await requireEnabledSettings(restaurantId);
    // Read-only snapshot: SELECTs only. Nothing here writes to food_orders,
    // food_order_items, restaurant_pos_payments, or any ledger.
    const snapshot = await loadOrderSnapshot(restaurantId, orderId);
    const buffer = buildOrderReceipt({ restaurant, settings, snapshot });
    // Dial the validated resolved address, never the raw hostname.
    const result = await escpos.sendToPrinter(settings.dialHost || settings.host, settings.port, buffer);
    res.json({ ok: result.ok, error: result.ok ? null : result.error, orderId });
  } catch (err) {
    next(err);
  }
};
