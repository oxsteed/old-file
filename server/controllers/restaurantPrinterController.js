'use strict';

// Restaurant network receipt printer (ESC/POS) — settings and printing.
//
// F-05: the API server no longer dials restaurant LAN printers. A cloud
// server cannot reach a printer on the restaurant's private network, and
// dialing owner-configured private addresses from the API host is an SSRF
// surface. printTestPage / printReceipt instead enqueue a job into the
// claim-based restaurant_printer_jobs queue; a paired in-store device
// claims the job and prints on the local network. A direct server-side
// dial remains available ONLY behind the explicit operator opt-in
// RESTAURANT_SERVER_PRINTING_ENABLED=true (default off).
//
// HARD RULE: printing never touches order, payment, or ledger state.
// - getPrinterSettings / updatePrinterSettings read/write only the
//   restaurant_printer_settings configuration row.
// - printTestPage / printReceipt read settings + an order snapshot and
//   insert one restaurant_printer_jobs row (or, under the opt-in flag,
//   send bytes to the configured printer). They perform zero
//   INSERT/UPDATE/DELETE on food_orders, food_order_items,
//   restaurant_pos_payments, or any money table. A printer failure can
//   never block, alter, or void an order or payment.

const pool = require('../db');
const AppError = require('../utils/appError');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const permissionsService = require('../services/permissionsService');
const { validatePrinterHost } = require('../utils/printerHostValidation');
const escpos = require('../services/escposPrinter');
const restaurantLocationService = require('../services/restaurantLocationService');
const { assertLocationAccess } = require('../services/restaurantLocationAccessService');
const { logBusinessAction } = require('../services/businessAuditLog');

// Direct server-side dialing is an explicit operator opt-in for trusted
// single-host deployments. Off by default everywhere, production included.
function serverPrintingEnabled() {
  return process.env.RESTAURANT_SERVER_PRINTING_ENABLED === 'true';
}


function parsePositiveInt(value, fallback = null) {
  const n = Number.parseInt(value, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

// S-08: manage gates resolve through the permission catalog (role defaults
// + per-membership overrides) via permissionsService, the single resolver.
// MANAGE_PERMISSION_CODES reproduces the previous owner/manager-only gate
// for members without overrides; deny overrides now take effect here too.
const MANAGE_PERMISSION_CODES = ['settings.manage'];

async function assertManage(restaurant, userId) {
  const allowed = await permissionsService.hasRestaurantPermission(restaurant, userId, MANAGE_PERMISSION_CODES);
  if (!allowed) {
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
    ...(row && row.location_id != null ? { locationId: Number(row.location_id) } : {}),
  };
}

async function loadSettings(restaurantId, locationId = null) {
  const { rows } = await pool.query(
    `SELECT id, restaurant_id, location_id, host, port, enabled, drawer_kick_on_cash, updated_at
       FROM restaurant_printer_settings
      WHERE restaurant_id = $1
        AND ((location_id = $2) OR ($2::bigint IS NULL AND location_id IS NULL))`,
    [restaurantId, locationId]
  );
  return rows[0] || null;
}

async function resolvePrinterLocation(req, restaurant) {
  const requested = parsePositiveInt(
    req.body?.locationId ?? req.body?.location_id ?? req.query?.locationId ?? req.query?.location_id
  );
  const locationId = await restaurantLocationService.resolveLocationId(pool, {
    restaurantId: restaurant.id,
    requestedLocationId: requested,
  });
  if (locationId != null) await assertLocationAccess(restaurant, req.user.id, locationId);
  return locationId;
}

// F-24: receipts format money and dates in the restaurant's stored
// receipt locale when one is configured (settings.receiptLocale, a BCP-47
// tag such as 'es' or 'fr-CA'); otherwise the historical en-US rendering.
// Dates are rendered in the restaurant's own time zone, not the server's.
function receiptLocale(restaurant) {
  const settings = restaurant && typeof restaurant.settings === 'object' && restaurant.settings
    ? restaurant.settings
    : {};
  const raw = settings.receiptLocale || settings.receipt_locale;
  if (typeof raw !== 'string' || !raw.trim()) return 'en-US';
  try {
    return Intl.NumberFormat.supportedLocalesOf(raw.trim())[0] || 'en-US';
  } catch (_) {
    return 'en-US';
  }
}

function formatMoney(cents, currency, locale = 'en-US') {
  const n = Number(cents || 0) / 100;
  try {
    return new Intl.NumberFormat(locale, {
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
    `SELECT id, location_id, queue_number, guest_name, table_label, fulfillment_type,
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
      `SELECT foi.id, foi.item_name, foi.quantity, foi.unit_price_cents, foi.line_total_cents,
              foi.course_number, foi.seat_number, foi.special_instructions,
              COALESCE(fmi.allergens, ARRAY[]::text[]) AS allergens
         FROM food_order_items foi
         LEFT JOIN food_menu_items fmi
           ON fmi.id = foi.menu_item_id AND fmi.restaurant_id = $2
        WHERE foi.order_id = $1
        ORDER BY foi.course_number ASC, foi.id ASC`,
      [orderId, restaurantId]
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
  const locale = receiptLocale(restaurant);
  const money = (cents) => formatMoney(cents, currency, locale);
  const addressParts = [restaurant.address_street, restaurant.address_city, restaurant.address_state, restaurant.address_zip]
    .filter(Boolean)
    .join(', ');

  const headerLines = [restaurant.display_name || 'OxSteed Restaurant'];
  if (addressParts) headerLines.push(addressParts);
  if (restaurant.phone) headerLines.push(restaurant.phone);

  const metaLines = [
    `Order #${order.queue_number || order.id}`,
    `Date: ${order.created_at ? new Date(order.created_at).toLocaleString(locale, { timeZone: restaurant.timezone || 'UTC' }) : ''}`,
  ];
  if (order.guest_name) metaLines.push(`Guest: ${order.guest_name}`);
  if (order.table_label) metaLines.push(`Table: ${order.table_label}`);
  if (order.fulfillment_type) metaLines.push(`Type: ${order.fulfillment_type}`);

  const receiptItems = items.map((item) => {
    const mods = modifiersByItem.get(String(item.id)) || [];
    return {
      qty: item.quantity,
      name: item.item_name,
      amount: money(item.line_total_cents),
      subLines: [
        ...mods.map((m) => `+ ${m.modifier_name}${Number(m.price_delta_cents) ? ` (${money(m.price_delta_cents)})` : ''}`),
        ...(item.special_instructions ? [`* ${item.special_instructions}`] : []),
      ],
    };
  });

  const totals = [
    { label: 'Subtotal', amount: money(order.subtotal_cents) },
  ];
  if (Number(order.discount_cents) > 0) totals.push({ label: 'Discount', amount: `-${money(order.discount_cents)}` });
  if (Number(order.tax_cents) > 0) totals.push({ label: 'Tax', amount: money(order.tax_cents) });
  if (Number(order.service_fee_cents) > 0) totals.push({ label: 'Service fee', amount: money(order.service_fee_cents) });
  if (Number(order.delivery_fee_cents) > 0) totals.push({ label: 'Delivery fee', amount: money(order.delivery_fee_cents) });
  if (Number(order.tip_cents) > 0) totals.push({ label: 'Tip', amount: money(order.tip_cents) });
  totals.push({ label: 'TOTAL', amount: money(order.total_cents), grand: true });

  const paidTypes = payments.filter((p) => p.status !== 'refunded');
  if (paidTypes.length) {
    metaLines.push('');
    for (const p of paidTypes) {
      metaLines.push(`Paid (${p.payment_type}): ${money(p.amount_cents)}`);
    }
  }

  const hasCashPayment = paidTypes.some((p) => p.payment_type === 'cash');
  const kickDrawer = Boolean(settings.drawerKickOnCash) && hasCashPayment;
  const buffer = escpos.buildReceipt({
    headerLines,
    metaLines,
    items: receiptItems,
    totals,
    footerLines: ['Thank you for your business!'],
    kickDrawer,
  });
  return { buffer, kickDrawer };
}

function buildAllergenLabelReceipt({ restaurant, snapshot }) {
  const labels = snapshot.items
    .filter((item) => Array.isArray(item.allergens) && item.allergens.length)
    .map((item) => ({
      qty: item.quantity,
      name: item.item_name,
      amount: '',
      subLines: [`ALLERGENS: ${item.allergens.join(', ')}`, ...(item.seat_number ? [`Seat ${item.seat_number}`] : [])],
    }));
  if (!labels.length) {
    throw new AppError('No declared allergens found for this order', 409, 'allergen_labels_unavailable');
  }
  return escpos.buildReceipt({
    headerLines: [restaurant.display_name || 'OxSteed Restaurant'],
    metaLines: [`Order #${snapshot.order.queue_number || snapshot.order.id}`, 'ALLERGEN LABELS'],
    items: labels,
    totals: [],
    footerLines: ['Verify labels before service.'],
    kickDrawer: false,
  });
}

// ── handlers ────────────────────────────────────────────────────────────────

exports.getPrinterSettings = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    const restaurant = await resolveRestaurantAccess(req.user.id, restaurantId);
    const locationId = await resolvePrinterLocation(req, restaurant);
    const row = await loadSettings(restaurantId, locationId);
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
    await assertManage(restaurant, req.user.id);
    const locationId = await resolvePrinterLocation(req, restaurant);

    const body = req.body || {};
    const enabled = body.enabled === true || body.enabled === 'true';
    const host = normalizeHost(body.host);
    const port = normalizePort(body.port);
    const drawerKickOnCash = body.drawerKickOnCash !== false && body.drawer_kick_on_cash !== false;
    const previous = await loadSettings(restaurantId, locationId);

    if (enabled && !host) {
      throw new AppError('A printer host is required when printing is enabled', 400, 'validation_failed');
    }

    // The stored host configures the restaurant's in-store printer and is
    // the dial target on the opt-in server-printing path, so it must be a
    // LAN address (RFC1918 IPv4 or IPv6 unique-local). This save-time
    // check is the only validation point; the queued print path never
    // resolves or dials the host from the API server.
    const { host: validatedHost } = host ? await validatePrinterHost(host) : { host: null };

    const conflict = locationId == null
      ? 'ON CONFLICT (restaurant_id) WHERE location_id IS NULL'
      : 'ON CONFLICT (restaurant_id, location_id) WHERE location_id IS NOT NULL';
    const { rows: [saved] } = await pool.query(
      `INSERT INTO restaurant_printer_settings
         (restaurant_id, location_id, host, port, enabled, drawer_kick_on_cash, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ${conflict}
       DO UPDATE SET host = EXCLUDED.host,
                     port = EXCLUDED.port,
                     enabled = EXCLUDED.enabled,
                     drawer_kick_on_cash = EXCLUDED.drawer_kick_on_cash,
                     updated_at = NOW()
       RETURNING id, restaurant_id, location_id, host, port, enabled, drawer_kick_on_cash, updated_at`,
      [restaurantId, locationId, validatedHost, port, enabled, drawerKickOnCash]
    );
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      action: 'restaurant.printer_settings.updated',
      target_type: 'restaurant_printer_settings',
      target_id: saved.id,
      before_state: settingsShape(previous),
      after_state: settingsShape(saved),
      metadata: { restaurant_id: restaurantId },
    });
    res.json({ settings: settingsShape(saved) });
  } catch (err) {
    next(err);
  }
};

async function requireEnabledSettings(restaurantId, locationId) {
  const row = await loadSettings(restaurantId, locationId);
  const settings = settingsShape(row);
  if (!settings.enabled) {
    throw new AppError('Receipt printing is not enabled for this restaurant', 409, 'printer_disabled');
  }
  if (!settings.host) {
    throw new AppError('No printer host configured', 409, 'printer_not_configured');
  }
  // Host validation happens once, at settings-save time (see
  // updatePrinterSettings). The stored host now describes the in-store
  // printer for the paired device that claims the job; the API server
  // does not resolve or dial it on the queued path.
  return settings;
}

// Enqueue one receipt job for the restaurant's paired in-store devices.
// The payload carries the exact ESC/POS bytes (base64) plus the target
// printer from settings, so the claiming device prints on the LAN
// without the API server ever opening a socket to it.
async function enqueuePrintJob({ restaurantId, orderId, locationId, kind, buffer, kickDrawer, settings, createdBy }) {
  const payload = {
    kind,
    printer: { host: settings.host, port: settings.port },
    escpos_base64: buffer.toString('base64'),
    kick_drawer: Boolean(kickDrawer),
  };
  // F-02 phase 1: a receipt job belongs to the order's store; an
  // order-less job (test page) belongs to the primary store.
  let jobLocationId = locationId || null;
  if (orderId) {
    const { rows: [order] } = await pool.query(
      `SELECT location_id FROM food_orders WHERE id = $1 AND restaurant_id = $2`,
      [orderId, restaurantId]
    );
    jobLocationId = order?.location_id || null;
  }
  if (jobLocationId === null) {
    jobLocationId = await restaurantLocationService.resolveLocationId(pool, { restaurantId });
  }
  const { rows: [job] } = await pool.query(
    `INSERT INTO restaurant_printer_jobs
       (restaurant_id, station_id, food_order_id, job_type, payload, created_by, location_id)
     VALUES ($1, NULL, $2, 'receipt', $3, $4, $5)
     RETURNING id, status`,
    [restaurantId, orderId || null, JSON.stringify(payload), createdBy || null, jobLocationId]
  );
  return job;
}

// Direct-dial path, reachable only when the operator explicitly opts in
// via RESTAURANT_SERVER_PRINTING_ENABLED=true. The host is re-validated
// here because this path still opens a socket from the API server: the
// dial uses the validated resolved address, never the raw hostname.
// Raw socket errors never reach the client.
async function dialPrinter(settings, buffer) {
  const { dialHost } = await validatePrinterHost(settings.host);
  const result = await escpos.sendToPrinter(dialHost || settings.host, settings.port, buffer);
  return result.ok ? { ok: true, error: null } : { ok: false, error: 'printer_unreachable' };
}

exports.printTestPage = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    const restaurant = await resolveRestaurantAccess(req.user.id, restaurantId);
    // F-05/F-31: printing is a manager action, not mere membership.
    await assertManage(restaurant, req.user.id);
    const locationId = await resolvePrinterLocation(req, restaurant);
    const settings = await requireEnabledSettings(restaurantId, locationId);
    const buffer = escpos.buildTestPage({
      title: restaurant.display_name || 'PRINTER TEST',
      lines: [`${settings.host}:${settings.port}`],
    });
    if (serverPrintingEnabled()) {
      const result = await dialPrinter(settings, buffer);
      return res.json({ ok: result.ok, error: result.error });
    }
    const job = await enqueuePrintJob({
      restaurantId,
      orderId: null,
      locationId,
      kind: 'test_page',
      buffer,
      kickDrawer: false,
      settings,
      createdBy: req.user.id,
    });
    return res.status(202).json({ ok: true, queued: true, jobId: job.id, jobStatus: job.status });
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
    // F-05/F-31: printing is a manager action, not mere membership.
    await assertManage(restaurant, req.user.id);
    const requestedLocationId = await resolvePrinterLocation(req, restaurant);
    // Read-only snapshot: SELECTs only. Nothing here writes to food_orders,
    // food_order_items, restaurant_pos_payments, or any ledger; the only
    // write is the printer job row itself.
    const snapshot = await loadOrderSnapshot(restaurantId, orderId);
    const orderLocationId = snapshot.order.location_id == null ? requestedLocationId : Number(snapshot.order.location_id);
    if (requestedLocationId != null && orderLocationId != null && requestedLocationId !== orderLocationId) {
      throw new AppError('The order belongs to another store', 409, 'printer_location_mismatch');
    }
    const settings = await requireEnabledSettings(restaurantId, orderLocationId);
    const { buffer, kickDrawer } = buildOrderReceipt({ restaurant, settings, snapshot });
    if (serverPrintingEnabled()) {
      const result = await dialPrinter(settings, buffer);
      return res.json({ ok: result.ok, error: result.error, orderId });
    }
    const job = await enqueuePrintJob({
      restaurantId,
      orderId,
      locationId: orderLocationId,
      kind: 'receipt',
      buffer,
      kickDrawer,
      settings,
      createdBy: req.user.id,
    });
    return res.status(202).json({ ok: true, queued: true, jobId: job.id, jobStatus: job.status, orderId });
  } catch (err) {
    next(err);
  }
};

// Allergen labels use the same claim-based in-store printer queue as receipts.
// The API only reads the order/menu snapshot and enqueues ESC/POS bytes; it
// never changes order, inventory, payment, or ledger state.
exports.printAllergenLabels = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    const orderId = parsePositiveInt(req.body && (req.body.order_id ?? req.body.orderId));
    if (!orderId) throw new AppError('order_id is required', 400, 'validation_failed');
    const restaurant = await resolveRestaurantAccess(req.user.id, restaurantId);
    await assertManage(restaurant, req.user.id);
    const requestedLocationId = await resolvePrinterLocation(req, restaurant);
    const snapshot = await loadOrderSnapshot(restaurantId, orderId);
    const orderLocationId = snapshot.order.location_id == null ? requestedLocationId : Number(snapshot.order.location_id);
    if (requestedLocationId != null && orderLocationId != null && requestedLocationId !== orderLocationId) {
      throw new AppError('The order belongs to another store', 409, 'printer_location_mismatch');
    }
    const settings = await requireEnabledSettings(restaurantId, orderLocationId);
    const buffer = buildAllergenLabelReceipt({ restaurant, snapshot });
    if (serverPrintingEnabled()) {
      const result = await dialPrinter(settings, buffer);
      return res.json({ ok: result.ok, error: result.error, orderId });
    }
    const job = await enqueuePrintJob({
      restaurantId,
      orderId,
      locationId: orderLocationId,
      kind: 'allergen_labels',
      buffer,
      kickDrawer: false,
      settings,
      createdBy: req.user.id,
    });
    return res.status(202).json({ ok: true, queued: true, jobId: job.id, jobStatus: job.status, orderId });
  } catch (err) {
    next(err);
  }
};

// Exported for the pure ESC/POS rendering test; the handler above owns all
// authorization, store scoping, and queue side effects.
exports.buildAllergenLabelReceipt = buildAllergenLabelReceipt;
