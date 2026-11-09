'use strict';

/**
 * Customer 360 upgrade 6: business-scoped Customer 360.
 *
 * A business or restaurant owner (or a member with the right permissions)
 * sees only the customer relationship that exists with THAT business:
 * its CRM client record, its appointments, its invoices and its restaurant
 * orders. Nothing from the platform profile (account email/phone, Credit,
 * KYC, support, other businesses) is ever returned.
 *
 * Authorization uses the production resolvers only:
 *   - requireBusinessAccess → permissionsService.getEffectivePermissions
 *     (catalog + per-membership overrides) for customers.* / calendar.* /
 *     invoices.view;
 *   - scopeModel.resolveRestaurantAccess → getRestaurantPermissions for
 *     orders.view, narrowed by restaurantLocationAccessService.getLocationScope
 *     (store boundary) per restaurant.
 */

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { hasAny, getRestaurantPermissions } = require('./permissionsService');
const { resolveRestaurantAccess } = require('./scopeModel');
const { getLocationScope } = require('./restaurantLocationAccessService');
const { logBusinessAction } = require('./businessAuditLog');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE = 50;
const SECTION_LIMIT = 20;

function parseKey(raw) {
  const s = String(raw || '');
  if (/^c-\d{1,18}$/.test(s)) return { type: 'client', id: s.slice(2) };
  if (s.startsWith('u-') && UUID.test(s.slice(2))) return { type: 'user', id: s.slice(2).toLowerCase() };
  throw new AppError('Invalid customer', 400, 'invalid_customer_key');
}

const RESTAURANT_BATCH = 200;

/** Yields every restaurant id of a business in id order, RESTAURANT_BATCH at a time. */
async function* businessRestaurantIds(businessId, db = pool, batch = RESTAURANT_BATCH) {
  let after = 0;
  for (;;) {
    const { rows } = await db.query(
      'SELECT id FROM food_restaurants WHERE business_id = $1 AND id > $2 ORDER BY id LIMIT $3', [businessId, after, batch]);
    for (const r of rows) yield r.id;
    if (rows.length < batch) return;
    after = rows[rows.length - 1].id;
  }
}

/*
 * Keyset cursor for the customer list: the last row's (last_at, rkey) in the
 * list order (last_at DESC NULLS LAST, rkey). Opaque base64url JSON.
 */
function encodeCursor(row) {
  return Buffer.from(JSON.stringify([row.last_at ? new Date(row.last_at).toISOString() : null, row.rkey])).toString('base64url');
}
function decodeCursor(raw) {
  if (raw == null || raw === '') return null;
  try {
    const [at, key] = JSON.parse(Buffer.from(String(raw).slice(0, 400), 'base64url').toString('utf8'));
    if (typeof key !== 'string' || !/^(u-[0-9a-f-]{36}|c-\d{1,18})$/i.test(key)) throw new Error('key');
    if (at !== null && (typeof at !== 'string' || Number.isNaN(Date.parse(at)))) throw new Error('at');
    return { at, key };
  } catch {
    throw new AppError('Invalid cursor', 400, 'invalid_cursor');
  }
}

/** Resolve what this caller may see for this business. Fails closed. */
async function scopeFor(req, db = pool) {
  const perms = req.permissions || new Set();
  const userId = req.user.id;
  const customers = hasAny(perms, ['customers.view_all']) ? 'all'
    : hasAny(perms, ['customers.view_assigned']) ? 'assigned' : null;
  const calendar = hasAny(perms, ['calendar.view_all']) ? 'all'
    : hasAny(perms, ['calendar.view_self']) ? 'self' : null;
  const invoices = hasAny(perms, ['invoices.view']);
  // Restaurant orders: per restaurant, production resolver + store scope.
  const orderRestaurants = [];
  const orderLocations = [];
  // Gap fill 14: every restaurant of the business, read in keyset pages
  // (no fixed cap), so large chains are covered completely.
  for await (const id of businessRestaurantIds(req.business.id, db)) {
    let restaurant;
    try {
      restaurant = await resolveRestaurantAccess(userId, id);
    } catch (err) {
      if (err.statusCode === 404 || err.status === 404) continue;
      throw err;
    }
    if (!restaurant?.effective_role || String(restaurant.business_id) !== String(req.business.id)) continue;
    const rp = await getRestaurantPermissions(restaurant, userId);
    if (!rp.has('*') && !hasAny(rp, ['orders.view', 'orders.manage'])) continue;
    const scope = await getLocationScope(restaurant, userId);
    if (scope.mode === 'all') orderRestaurants.push(Number(id));
    else orderLocations.push(...scope.location_ids);
  }
  return {
    userId, businessId: req.business.id, customers, calendar, invoices,
    orders: orderRestaurants.length || orderLocations.length ? { restaurants: orderRestaurants, locations: orderLocations } : null,
  };
}

function requireCustomers(scope) {
  if (!scope.customers) throw new AppError('You do not have access to customers', 403, 'business_customer360_forbidden');
}

/*
 * Relationship rows visible to this caller. $1 business, $2 caller,
 * $3 assigned-only flag, $4 calendar mode, $5 order restaurants, $6 order
 * locations. "Assigned" customers are those the caller created in the CRM or
 * serves through an appointment.
 */
const REL_CTE = `
  rel AS (
    SELECT bc.customer_id AS user_id, bc.id AS client_id, bc.display_name AS name,
           GREATEST(bc.last_job_at, bc.updated_at) AS last_at, 'crm' AS via
      FROM business_clients bc
     WHERE bc.business_id = $1 AND bc.deleted_at IS NULL
       AND (NOT $3 OR bc.created_by = $2 OR (bc.customer_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM business_appointments x WHERE x.business_id = $1 AND x.customer_id = bc.customer_id AND x.staff_id = $2)))
    UNION ALL
    SELECT a.customer_id, NULL, MAX(a.customer_name), MAX(a.start_time), 'appointment'
      FROM business_appointments a
     WHERE a.business_id = $1 AND a.customer_id IS NOT NULL
       AND ($4 = 'all' OR ($4 = 'self' AND a.staff_id = $2))
       AND (NOT $3 OR a.staff_id = $2)
     GROUP BY a.customer_id
    UNION ALL
    SELECT o.customer_id, NULL, MAX(o.guest_name), MAX(o.created_at), 'order'
      FROM food_orders o
     WHERE o.business_id = $1 AND o.customer_id IS NOT NULL
       AND (o.restaurant_id = ANY($5::bigint[]) OR o.location_id = ANY($6::bigint[]))
       AND NOT $3
     GROUP BY o.customer_id
  ),
  merged AS (
    SELECT COALESCE('u-' || user_id::text, 'c-' || client_id::text) AS rkey,
           MAX(user_id::text) AS user_id, MIN(client_id) AS client_id,
           (ARRAY_AGG(name ORDER BY (via = 'crm') DESC, last_at DESC NULLS LAST) FILTER (WHERE name IS NOT NULL))[1] AS name,
           MAX(last_at) AS last_at, ARRAY_AGG(DISTINCT via) AS via
      FROM rel GROUP BY 1
  )`;

function relParams(scope) {
  return [scope.businessId, scope.userId, scope.customers === 'assigned', scope.calendar || 'none',
    scope.orders?.restaurants || [], scope.orders?.locations || []];
}

function displayName(row) {
  if (row.name) return row.name;
  if (row.first_name) return `${row.first_name}${row.last_name ? ` ${row.last_name[0]}.` : ''}`;
  return null;
}

async function list(req, { search = '', cursor = null } = {}) {
  const scope = await scopeFor(req);
  requireCustomers(scope);
  const q = String(search || '').trim().slice(0, 80).toLowerCase();
  const after = decodeCursor(cursor);
  // Gap fill 14: keyset paging instead of a capped OFFSET, so every customer
  // is reachable and pages never repeat or skip when new activity arrives.
  // Order: last_at DESC NULLS LAST, rkey ASC. Rows after the cursor are
  // those with an older last_at, the same last_at and a larger key, or (once
  // past the dated rows) a NULL last_at.
  const params = [...relParams(scope), q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null, PAGE + 1,
    after ? after.at : null, after ? after.key : null, Boolean(after)];
  const { rows } = await pool.query(
    `WITH ${REL_CTE}
     SELECT m.rkey, m.client_id, m.name, m.last_at, m.via, u.first_name, u.last_name
       FROM merged m LEFT JOIN users u ON u.id = m.user_id::uuid
      WHERE ($7::text IS NULL OR lower(COALESCE(m.name, u.first_name || ' ' || COALESCE(u.last_name, ''), '')) LIKE $7)
        AND (NOT $11::boolean
             OR ($9::timestamptz IS NOT NULL AND (m.last_at < $9::timestamptz OR m.last_at IS NULL OR (m.last_at = $9::timestamptz AND m.rkey > $10)))
             OR ($9::timestamptz IS NULL AND m.last_at IS NULL AND m.rkey > $10))
      ORDER BY m.last_at DESC NULLS LAST, m.rkey
      LIMIT $8`, params);
  const page = rows.slice(0, PAGE);
  const customers = page.map((r) => ({
    key: r.rkey, clientId: r.client_id ? String(r.client_id) : null, name: displayName(r), lastAt: r.last_at, via: r.via,
  }));
  await logBusinessAction(req, {
    action: 'customer360.customers_listed', target_type: 'business', target_id: req.business.id, throwOnError: true,
    metadata: { count: customers.length, searched: !!q, paged: Boolean(after), scope: scope.customers },
  });
  return { customers, nextCursor: rows.length > PAGE ? encodeCursor(page[page.length - 1]) : null, access: accessSummary(scope) };
}

function accessSummary(scope) {
  return { customers: scope.customers, appointments: scope.calendar, invoices: scope.invoices, orders: !!scope.orders };
}

async function profile(req, rawKey) {
  const key = parseKey(rawKey);
  const scope = await scopeFor(req);
  requireCustomers(scope);
  const params = relParams(scope);
  // The customer must be inside this caller's visible relationship set.
  const { rows: [m] } = await pool.query(
    `WITH ${REL_CTE}
     SELECT m.*, u.first_name, u.last_name FROM merged m LEFT JOIN users u ON u.id = m.user_id::uuid
      WHERE ${key.type === 'user' ? 'm.user_id = $7' : 'm.client_id = $7::bigint'}`, [...params, key.id]);
  if (!m) throw new AppError('Customer not found', 404, 'customer_not_found');
  const userId = m.user_id;
  const { rows: [client] } = await pool.query(
    `SELECT id, display_name, email, phone, city, country, status, tags, preferred_contact, internal_notes,
            lifetime_value_cents, total_jobs, first_seen_at, last_job_at
       FROM business_clients WHERE business_id = $1 AND deleted_at IS NULL
        AND (id = $2::bigint OR ($3::uuid IS NOT NULL AND customer_id = $3::uuid))
      ORDER BY (id = $2::bigint) DESC LIMIT 1`,
    [scope.businessId, m.client_id || null, userId]);

  const sections = {};
  if (scope.calendar && userId) {
    const { rows } = await pool.query(
      `SELECT a.id, a.start_time, a.status, a.payment_status, a.final_price_cents, s.name AS service_name,
              COUNT(*) OVER () AS total, COUNT(*) FILTER (WHERE a.status = 'no_show') OVER () AS no_shows
         FROM business_appointments a LEFT JOIN business_services s ON s.id = a.service_id
        WHERE a.business_id = $1 AND a.customer_id = $2::uuid AND ($3 = 'all' OR a.staff_id = $4)
        ORDER BY a.start_time DESC LIMIT ${SECTION_LIMIT}`, [scope.businessId, userId, scope.calendar, scope.userId]);
    sections.appointments = { state: 'ready', total: Number(rows[0]?.total || 0), noShows: Number(rows[0]?.no_shows || 0),
      items: rows.map((r) => ({ id: r.id, at: r.start_time, status: r.status, paymentStatus: r.payment_status, priceCents: Number(r.final_price_cents), service: r.service_name })) };
  } else sections.appointments = { state: scope.calendar ? 'none' : 'restricted' };

  if (scope.orders && userId) {
    const { rows } = await pool.query(
      `SELECT o.id, o.created_at, o.status, o.fulfillment_type, o.total_cents, o.currency_code, r.display_name AS restaurant,
              COUNT(*) OVER () AS total,
              SUM(o.total_cents) FILTER (WHERE o.payment_status = 'paid') OVER () AS spent
         FROM food_orders o JOIN food_restaurants r ON r.id = o.restaurant_id
        WHERE o.business_id = $1 AND o.customer_id = $2::uuid
          AND (o.restaurant_id = ANY($3::bigint[]) OR o.location_id = ANY($4::bigint[]))
        ORDER BY o.created_at DESC LIMIT ${SECTION_LIMIT}`,
      [scope.businessId, userId, scope.orders.restaurants, scope.orders.locations]);
    sections.orders = { state: 'ready', total: Number(rows[0]?.total || 0), paidCents: Number(rows[0]?.spent || 0),
      partialStores: scope.orders.locations.length > 0,
      items: rows.map((r) => ({ id: String(r.id), at: r.created_at, status: r.status, fulfillment: r.fulfillment_type, totalCents: r.total_cents, currency: r.currency_code, restaurant: r.restaurant })) };
  } else sections.orders = { state: scope.orders ? 'none' : 'restricted' };

  // Invoices match only on contact details this business itself recorded.
  if (scope.invoices) {
    const { rows: emails } = await pool.query(
      `SELECT DISTINCT lower(e) AS e FROM (
         SELECT email AS e FROM business_clients WHERE business_id = $1 AND deleted_at IS NULL AND (id = $2::bigint OR ($3::uuid IS NOT NULL AND customer_id = $3::uuid))
         UNION ALL SELECT customer_email FROM business_appointments WHERE business_id = $1 AND $3::uuid IS NOT NULL AND customer_id = $3::uuid
       ) x WHERE e IS NOT NULL AND e <> '' LIMIT 10`, [scope.businessId, client?.id || null, userId]);
    const list = emails.map((r) => r.e);
    const { rows } = list.length ? await pool.query(
      `SELECT id, invoice_number, status, issue_date, due_date, total, amount_paid,
              COUNT(*) OVER () AS n, SUM(GREATEST(total - amount_paid, 0)) FILTER (WHERE status NOT IN ('paid', 'cancelled', 'draft')) OVER () AS outstanding
         FROM business_invoices WHERE business_id = $1 AND lower(client_email) = ANY($2::text[])
        ORDER BY issue_date DESC, id DESC LIMIT ${SECTION_LIMIT}`, [scope.businessId, list]) : { rows: [] };
    sections.invoices = { state: rows.length ? 'ready' : 'none', total: Number(rows[0]?.n || 0), outstanding: Number(rows[0]?.outstanding || 0),
      items: rows.map((r) => ({ id: String(r.id), number: r.invoice_number, status: r.status, issued: r.issue_date, due: r.due_date, total: Number(r.total), paid: Number(r.amount_paid) })) };
  } else sections.invoices = { state: 'restricted' };

  const customer = {
    key: m.rkey, name: client?.display_name || displayName(m), via: m.via, lastAt: m.last_at,
    client: client ? {
      id: String(client.id), status: client.status, tags: client.tags, preferredContact: client.preferred_contact,
      email: client.email, phone: client.phone, city: client.city, country: client.country, notes: client.internal_notes,
      lifetimeValueCents: Number(client.lifetime_value_cents), totalJobs: client.total_jobs, firstSeenAt: client.first_seen_at,
    } : null,
  };
  await logBusinessAction(req, {
    action: 'customer360.customer_viewed', target_type: 'customer', target_id: m.rkey, throwOnError: true,
    metadata: { sections: Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, v.state])), scope: scope.customers },
  });
  return { customer, sections, access: accessSummary(scope) };
}

module.exports = { list, profile, scopeFor, parseKey, businessRestaurantIds, encodeCursor, decodeCursor, PAGE, RESTAURANT_BATCH };
