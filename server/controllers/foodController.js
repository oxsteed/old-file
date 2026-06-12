'use strict';

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const socketService = require('../services/socketService');

const VALID_FULFILLMENT = new Set(['pickup', 'dine_in', 'delivery', 'kiosk']);
const VALID_ORDER_SOURCES = new Set(['mobile', 'web', 'kiosk', 'counter', 'tablet']);
const VALID_STATUS = new Set(['received', 'accepted', 'preparing', 'ready', 'completed', 'cancelled', 'refunded']);

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

    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (items.length === 0) {
      throw new AppError('Validation failed', 400, 'validation_failed', { items: 'At least one item is required' });
    }

    const order = await withTransaction(pool, async (client) => {
      const { rows: restaurants } = await client.query(
        `SELECT * FROM food_restaurants WHERE id = $1 AND status = 'active'`,
        [restaurantId]
      );
      const restaurant = restaurants[0];
      if (!restaurant) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
      if (!restaurant.accepts_online_orders && req.body.orderSource !== 'kiosk' && req.body.order_source !== 'kiosk') {
        throw new AppError('Restaurant is not accepting online orders', 409, 'restaurant_not_accepting_orders');
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
          total > 0 ? 'requires_payment' : 'paid',
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
          req.body.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {},
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

      return created;
    }, 'food_create_order');

    emitRestaurantOrder(order.business_id, 'food:order:created', { order });
    res.status(201).json({ order });
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
    res.json({ orders: rows });
  } catch (err) {
    next(err);
  }
};

exports.updateOrderStatus = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const orderId = parsePositiveInt(req.params.orderId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const status = normalizeString(req.body.status, 24);
    if (!VALID_STATUS.has(status)) {
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
        WHERE id = $2 AND restaurant_id = $3
        RETURNING *`,
      [status, orderId, restaurantId]
    );
    if (!order) throw new AppError('Order not found', 404, 'order_not_found');

    emitRestaurantOrder(order.business_id, 'food:order:updated', { order });
    res.json({ order });
  } catch (err) {
    next(err);
  }
};
