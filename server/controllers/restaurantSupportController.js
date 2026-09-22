'use strict';

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;

const ISSUE_TYPES = new Set([
  'missing_item',
  'wrong_item',
  'food_quality',
  'late_order',
  'payment_problem',
  'restaurant_closed',
  'delivery_issue',
  'other',
]);
const STATUS = new Set([
  'new',
  'awaiting_restaurant',
  'awaiting_customer',
  'awaiting_oxsteed',
  'awaiting_runner',
  'investigating',
  'resolution_offered',
  'resolved',
  'closed',
  'reopened',
  'escalated',
  'canceled',
]);
const RESOLUTIONS = new Set([
  'refund',
  'partial_refund',
  'store_credit',
  'replacement_item',
  'remake_order',
  'discount_code',
  'apology_only',
  'no_action',
  'escalate_to_oxsteed',
]);
const MANAGE_ROLES = new Set(['owner', 'manager']);
const RESPOND_ROLES = new Set(['owner', 'manager', 'representative', 'employee', 'support_agent']);
const SENSITIVE_RE = /\b(allerg(?:y|ic|en)|illness|sick|vomit|poison|unsafe|raw|blood|chok(?:e|ing)|harass|threat|fraud|scam|duplicate charge|missing payment|payment dispute|driver safety)\b/i;

function parsePositiveInt(value) {
  const n = Number.parseInt(String(value), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizeString(value, max = 255) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

function normalizeIssueType(value) {
  const raw = normalizeString(value, 80);
  if (!raw) return null;
  const normalized = raw
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
  const aliases = {
    missing: 'missing_item',
    missing_item: 'missing_item',
    wrong: 'wrong_item',
    wrong_item: 'wrong_item',
    food_quality_issue: 'food_quality',
    food_quality: 'food_quality',
    order_was_late: 'late_order',
    late_order: 'late_order',
    payment_issue: 'payment_problem',
    payment_problem: 'payment_problem',
    restaurant_was_closed: 'restaurant_closed',
    restaurant_closed: 'restaurant_closed',
    delivery: 'delivery_issue',
    delivery_issue: 'delivery_issue',
    something_else: 'other',
    other: 'other',
  };
  return aliases[normalized] || (ISSUE_TYPES.has(normalized) ? normalized : null);
}

function normalizeEnum(value, allowed, fallback) {
  const raw = normalizeString(value, 80);
  return raw && allowed.has(raw) ? raw : fallback;
}

function normalizeLanguage(value) {
  const raw = normalizeString(value, 12);
  return raw || 'en';
}

function normalizeCountry(value) {
  const raw = normalizeString(value, 2);
  return raw ? raw.toUpperCase() : 'US';
}

function normalizeCurrency(value) {
  const raw = normalizeString(value, 3);
  return raw ? raw.toUpperCase() : 'USD';
}

function cents(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function addMinutes(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function publicCaseNumber() {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `RS-${stamp}-${random}`;
}

function isSensitiveText(...parts) {
  return SENSITIVE_RE.test(parts.filter(Boolean).join(' '));
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function routeIssue(issueType, { description, issueSubtype, cause, requestedResolution } = {}) {
  const sensitiveText = isSensitiveText(issueType, description, issueSubtype, cause, requestedResolution);
  switch (issueType) {
    case 'missing_item':
      return {
        ownerType: 'restaurant',
        status: 'awaiting_restaurant',
        priority: 'normal',
        severity: 'moderate',
        dueAt: addMinutes(30),
        isEscalated: false,
        escalationReason: null,
      };
    case 'wrong_item':
      return {
        ownerType: 'restaurant',
        status: 'awaiting_restaurant',
        priority: 'normal',
        severity: 'moderate',
        dueAt: addMinutes(30),
        isEscalated: false,
        escalationReason: null,
      };
    case 'food_quality':
      return {
        ownerType: sensitiveText ? 'oxsteed' : 'shared',
        status: sensitiveText ? 'awaiting_oxsteed' : 'awaiting_restaurant',
        priority: sensitiveText ? 'urgent' : 'high',
        severity: sensitiveText ? 'safety_sensitive' : 'serious',
        dueAt: addMinutes(30),
        isEscalated: sensitiveText,
        escalationReason: sensitiveText ? 'Safety-sensitive food quality language detected' : 'OxSteed oversight required',
      };
    case 'late_order': {
      const delivery = /\b(delivery|driver|runner|drop[-\s]?off|address)\b/i.test(String(cause || description || ''));
      return {
        ownerType: delivery ? 'runner' : 'restaurant',
        status: delivery ? 'awaiting_runner' : 'awaiting_restaurant',
        priority: 'high',
        severity: 'moderate',
        dueAt: addMinutes(20),
        isEscalated: delivery,
        escalationReason: delivery ? 'Delivery delay requires runner/OxSteed review' : null,
      };
    }
    case 'payment_problem':
      return {
        ownerType: 'oxsteed',
        status: 'awaiting_oxsteed',
        priority: 'high',
        severity: 'payment_sensitive',
        dueAt: addMinutes(24 * 60),
        isEscalated: true,
        escalationReason: 'Payment issue requires OxSteed oversight',
      };
    case 'restaurant_closed':
      return {
        ownerType: 'shared',
        status: 'awaiting_restaurant',
        priority: 'high',
        severity: 'serious',
        dueAt: addMinutes(60),
        isEscalated: true,
        escalationReason: 'Closed restaurant report affects platform trust',
      };
    case 'delivery_issue':
      return {
        ownerType: 'runner',
        status: 'awaiting_runner',
        priority: 'high',
        severity: sensitiveText ? 'safety_sensitive' : 'moderate',
        dueAt: addMinutes(30),
        isEscalated: true,
        escalationReason: sensitiveText ? 'Safety-sensitive delivery issue' : 'Delivery issue requires runner/OxSteed review',
      };
    default:
      return {
        ownerType: 'oxsteed',
        status: 'awaiting_oxsteed',
        priority: sensitiveText ? 'high' : 'normal',
        severity: sensitiveText ? 'safety_sensitive' : 'moderate',
        dueAt: addMinutes(24 * 60),
        isEscalated: sensitiveText,
        escalationReason: sensitiveText ? 'Sensitive language detected' : null,
      };
  }
}

async function requireRestaurantAccess(userId, restaurantId) {
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const { rows } = await pool.query(
    `SELECT fr.id, fr.business_id, fr.display_name, fr.owner_user_id, fr.currency_code, fr.address_country,
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

function assertManage(restaurant) {
  if (!MANAGE_ROLES.has(restaurant.effective_role)) {
    throw new AppError('Owner or manager access required', 403, 'forbidden');
  }
}

function assertRespond(restaurant) {
  if (!RESPOND_ROLES.has(restaurant.effective_role)) {
    throw new AppError('You do not have permission to respond for this restaurant', 403, 'forbidden');
  }
}

function isAdmin(req) {
  return req.isAdmin || req.isSuperAdmin || ['admin', 'super_admin'].includes(req.user?.role);
}

async function loadCase(client, caseId) {
  const { rows } = await client.query(
    `SELECT rsc.*, fr.display_name AS restaurant_name, fr.business_id
       FROM restaurant_support_cases rsc
       JOIN food_restaurants fr ON fr.id = rsc.restaurant_id
      WHERE rsc.id = $1 AND rsc.archived_at IS NULL`,
    [caseId]
  );
  return rows[0] || null;
}

async function assertCaseCustomer(client, caseId, userId) {
  const supportCase = await loadCase(client, caseId);
  if (!supportCase || supportCase.customer_user_id !== userId) {
    throw new AppError('Support case not found', 404, 'case_not_found');
  }
  return supportCase;
}

async function assertCaseRestaurant(client, caseId, restaurantId, userId, { manage = false, respond = false } = {}) {
  const supportCase = await loadCase(client, caseId);
  if (!supportCase || Number(supportCase.restaurant_id) !== Number(restaurantId)) {
    throw new AppError('Support case not found', 404, 'case_not_found');
  }
  const restaurant = await requireRestaurantAccess(userId, restaurantId);
  if (manage) assertManage(restaurant);
  if (respond) assertRespond(restaurant);
  return { supportCase, restaurant };
}

async function logEvent(client, caseId, { actorUserId = null, actorType = 'system', eventType, oldValue = null, newValue = null, metadata = {} }) {
  await client.query(
    `INSERT INTO restaurant_support_case_events
       (case_id, actor_user_id, actor_type, event_type, old_value, new_value, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [caseId, actorUserId, actorType, eventType, oldValue, newValue, JSON.stringify(metadata || {})]
  );
}

async function enqueueNotification(client, caseId, recipientType, eventType, payload = {}, recipientUserId = null) {
  await client.query(
    `INSERT INTO restaurant_support_notification_events
       (case_id, recipient_user_id, recipient_type, event_type, payload)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [caseId, recipientUserId, recipientType, eventType, JSON.stringify(payload || {})]
  );
}

async function addMessage(client, supportCase, {
  senderUserId,
  senderType,
  message,
  internalNote = false,
  language = 'en',
  clientMessageId = null,
  returnReplay = false,
}) {
  const { rows: [row] } = await client.query(
    `INSERT INTO restaurant_support_case_messages
       (case_id, sender_user_id, sender_type, message, internal_note, language, client_message_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (case_id, client_message_id)
     WHERE client_message_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [supportCase.id, senderUserId, senderType, message, internalNote, language, clientMessageId]
  );
  const replayed = !row && clientMessageId;
  if (replayed) {
    const replay = await client.query(
      `SELECT * FROM restaurant_support_case_messages
        WHERE case_id = $1 AND client_message_id = $2`,
      [supportCase.id, clientMessageId]
    );
    if (!replay.rows[0]) throw new AppError('Message retry could not be recovered', 409, 'message_retry_failed');
    return returnReplay ? { row: replay.rows[0], replayed: true } : replay.rows[0];
  }
  await logEvent(client, supportCase.id, {
    actorUserId: senderUserId,
    actorType: senderType,
    eventType: internalNote ? 'internal_note_added' : 'message_added',
    metadata: { messageId: row.id },
  });
  return returnReplay ? { row, replayed: false } : row;
}

async function getCaseDetails(client, supportCase, view = 'customer') {
  const internalAllowed = view !== 'customer';
  const { rows: messages } = await client.query(
    `SELECT *
       FROM restaurant_support_case_messages
      WHERE case_id = $1
        AND ($2::boolean OR internal_note = FALSE)
      ORDER BY created_at ASC, id ASC`,
    [supportCase.id, internalAllowed]
  );
  const { rows: attachments } = await client.query(
    `SELECT *
       FROM restaurant_support_case_attachments
      WHERE case_id = $1
      ORDER BY created_at ASC, id ASC`,
    [supportCase.id]
  );
  let events = [];
  if (internalAllowed) {
    const result = await client.query(
      `SELECT *
         FROM restaurant_support_case_events
        WHERE case_id = $1
        ORDER BY created_at ASC, id ASC`,
      [supportCase.id]
    );
    events = result.rows;
  }
  return { case: supportCase, messages, attachments, events };
}

async function getOrderForCase(client, orderId, userId, trackingToken = null) {
  if (!orderId) return null;
  const { rows } = await client.query(
    `SELECT fo.*, fr.address_country, fr.currency_code AS restaurant_currency_code, fr.display_name AS restaurant_name
       FROM food_orders fo
       JOIN food_restaurants fr ON fr.id = fo.restaurant_id
      WHERE fo.id = $1`,
    [orderId]
  );
  const order = rows[0];
  if (!order) throw new AppError('Order not found', 404, 'order_not_found');
  const orderTrackingToken = normalizeString(
    order.metadata?.trackingToken || order.metadata?.tracking_token,
    255
  );
  const isOwnedOrder = order.customer_id && order.customer_id === userId;
  const isVerifiedGuestOrder = !order.customer_id
    && orderTrackingToken
    && trackingToken
    && orderTrackingToken === trackingToken;
  if (!isOwnedOrder && !isVerifiedGuestOrder) {
    throw new AppError('Order not found', 404, 'order_not_found');
  }
  return order;
}

async function loadOrderItems(client, orderId) {
  if (!orderId) return [];
  const { rows } = await client.query(
    `SELECT id, menu_item_id, item_name, quantity, unit_price_cents, line_total_cents
       FROM food_order_items
      WHERE order_id = $1
      ORDER BY id ASC`,
    [orderId]
  );
  return rows;
}

exports.createCase = async (req, res, next) => {
  try {
    const issueType = normalizeIssueType(req.body.issueType || req.body.issue_type);
    const description = normalizeString(req.body.description || req.body.message, 5000);
    if (!issueType) throw new AppError('Validation failed', 400, 'validation_failed', { issueType: 'Supported issue type is required' });
    if (!description) throw new AppError('Validation failed', 400, 'validation_failed', { description: 'Description is required' });
    const clientRequestId = req.get('Idempotency-Key')
      || req.body.clientRequestId
      || req.body.client_request_id
      || null;
    if (clientRequestId && !isUuid(clientRequestId)) {
      throw new AppError('clientRequestId must be a valid UUID', 400, 'validation_failed');
    }

    const result = await withTransaction(pool, async (client) => {
      const orderId = parsePositiveInt(req.body.orderId || req.body.order_id);
      const trackingToken = normalizeString(req.body.trackingToken || req.body.tracking_token, 255);
      const order = await getOrderForCase(client, orderId, req.user.id, trackingToken);
      const restaurantId = order?.restaurant_id || parsePositiveInt(req.body.restaurantId || req.body.restaurant_id);
      if (!restaurantId) throw new AppError('Validation failed', 400, 'validation_failed', { restaurantId: 'Restaurant or order is required' });

      const { rows: [restaurant] } = await client.query(
        `SELECT id, display_name, address_country, currency_code
           FROM food_restaurants
          WHERE id = $1`,
        [restaurantId]
      );
      if (!restaurant) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');

      const issueSubtype = normalizeString(req.body.issueSubtype || req.body.issue_subtype, 120);
      const requestedResolution = normalizeEnum(req.body.requestedResolution || req.body.requested_resolution, RESOLUTIONS, null);
      const route = routeIssue(issueType, {
        description,
        issueSubtype,
        cause: req.body.cause,
        requestedResolution,
      });
      const orderItems = await loadOrderItems(client, order?.id);
      const orderSnapshot = order ? {
        id: order.id,
        queueNumber: order.queue_number,
        status: order.status,
        fulfillmentType: order.fulfillment_type,
        paymentStatus: order.payment_status,
        totalCents: order.total_cents,
        currencyCode: order.currency_code,
        createdAt: order.created_at,
      } : {};
      const title = normalizeString(req.body.title, 240) || issueType.replace(/_/g, ' ');
      const language = normalizeLanguage(req.body.language || req.body.sender_language || req.user.preferred_language);
      const countryCode = normalizeCountry(req.body.countryCode || req.body.country_code || restaurant.address_country);
      const currencyCode = normalizeCurrency(req.body.currencyCode || req.body.currency_code || order?.currency_code || restaurant.currency_code);

      const { rows: [supportCase] } = await client.query(
        `INSERT INTO restaurant_support_cases
           (public_case_number, order_id, restaurant_id, customer_user_id, issue_type, issue_subtype,
            title, description, status, priority, severity, owner_type, source, language,
            customer_locale, country_code, currency_code, requested_resolution,
            requested_refund_amount_cents, refund_status, credit_status, order_snapshot,
            involved_order_items, is_escalated, escalated_at, escalation_reason, due_at, metadata, client_request_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23::jsonb,$24,$25,$26,$27,$28::jsonb,$29)
         ON CONFLICT (client_request_id)
         WHERE client_request_id IS NOT NULL DO NOTHING
         RETURNING *`,
        [
          publicCaseNumber(),
          order?.id || null,
          restaurantId,
          req.user.id,
          issueType,
          issueSubtype,
          title,
          description,
          route.status,
          route.priority,
          route.severity,
          route.ownerType,
          normalizeString(req.body.source, 40) || 'customer_app',
          language,
          normalizeString(req.body.customerLocale || req.body.customer_locale, 32),
          countryCode,
          currencyCode,
          requestedResolution,
          cents(req.body.requestedRefundAmountCents || req.body.requested_refund_amount_cents),
          requestedResolution && requestedResolution.includes('refund') ? 'requested' : 'not_requested',
          requestedResolution === 'store_credit' ? 'offered' : 'not_requested',
          JSON.stringify(orderSnapshot),
          JSON.stringify(orderItems),
          route.isEscalated,
          route.isEscalated ? new Date() : null,
          route.escalationReason,
          route.dueAt,
          JSON.stringify({ lowerTrust: !order, customerAppVersion: req.body.appVersion || req.body.app_version || null }),
          clientRequestId,
        ]
      );

      if (!supportCase && clientRequestId) {
        const replay = await client.query(
          `SELECT * FROM restaurant_support_cases WHERE client_request_id = $1`,
          [clientRequestId]
        );
        if (!replay.rows[0]) throw new AppError('Support case retry could not be recovered', 409, 'support_request_retry_failed');
        return { case: replay.rows[0], replayed: true };
      }

      await addMessage(client, supportCase, {
        senderUserId: req.user.id,
        senderType: 'customer',
        message: description,
        language,
        clientMessageId: clientRequestId,
      });
      await logEvent(client, supportCase.id, {
        actorUserId: req.user.id,
        actorType: 'customer',
        eventType: 'case_created',
        newValue: supportCase.status,
        metadata: { issueType, ownerType: route.ownerType, orderId: order?.id || null },
      });
      await client.query(
        `INSERT INTO restaurant_support_case_assignments
           (case_id, assigned_to_type, assigned_to_restaurant_id, reason)
         VALUES ($1,$2,$3,$4)`,
        [supportCase.id, route.ownerType, route.ownerType === 'restaurant' || route.ownerType === 'shared' ? restaurantId : null, route.escalationReason]
      );
      await enqueueNotification(client, supportCase.id, 'customer', 'case_created', { publicCaseNumber: supportCase.public_case_number }, req.user.id);
      await enqueueNotification(client, supportCase.id, route.ownerType === 'runner' ? 'runner' : route.ownerType === 'oxsteed' ? 'oxsteed' : 'restaurant', 'new_case_created', {
        publicCaseNumber: supportCase.public_case_number,
        issueType,
        priority: route.priority,
      });
      if (route.isEscalated || route.ownerType === 'shared') {
        await enqueueNotification(client, supportCase.id, 'oxsteed', 'case_escalated', {
          reason: route.escalationReason,
          issueType,
        });
      }
      return { case: supportCase, replayed: false };
    }, 'restaurant_support_create_case');

    res.status(result.replayed ? 200 : 201).json({
      case: result.case,
      expectedResponseTime: result.case.due_at,
      reviewingParty: result.case.owner_type,
    });
  } catch (err) {
    next(err);
  }
};

exports.listMyCases = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT rsc.*, fr.display_name AS restaurant_name
         FROM restaurant_support_cases rsc
         JOIN food_restaurants fr ON fr.id = rsc.restaurant_id
        WHERE rsc.customer_user_id = $1 AND rsc.archived_at IS NULL
        ORDER BY rsc.created_at DESC, rsc.id DESC
        LIMIT 100`,
      [req.user.id]
    );
    res.json({ cases: rows });
  } catch (err) {
    next(err);
  }
};

exports.getMyCase = async (req, res, next) => {
  try {
    const caseId = parsePositiveInt(req.params.caseId);
    const supportCase = await assertCaseCustomer(pool, caseId, req.user.id);
    res.json(await getCaseDetails(pool, supportCase, 'customer'));
  } catch (err) {
    next(err);
  }
};

exports.addCustomerMessage = async (req, res, next) => {
  try {
    const caseId = parsePositiveInt(req.params.caseId);
    const message = normalizeString(req.body.message || req.body.content, 5000);
    if (!message) throw new AppError('Validation failed', 400, 'validation_failed', { message: 'Message is required' });
    const clientMessageId = req.get('Idempotency-Key')
      || req.body.clientMessageId
      || req.body.client_message_id
      || null;
    if (clientMessageId && !isUuid(clientMessageId)) {
      throw new AppError('clientMessageId must be a valid UUID', 400, 'validation_failed');
    }
    const result = await withTransaction(pool, async (client) => {
      const supportCase = await assertCaseCustomer(client, caseId, req.user.id);
      const messageResult = await addMessage(client, supportCase, {
        senderUserId: req.user.id,
        senderType: 'customer',
        message,
        language: normalizeLanguage(req.body.language || req.user.preferred_language),
        clientMessageId,
        returnReplay: true,
      });
      if (messageResult.replayed) return messageResult;
      const row = messageResult.row;
      const nextStatus = supportCase.owner_type === 'restaurant' || supportCase.owner_type === 'shared'
        ? 'awaiting_restaurant'
        : supportCase.owner_type === 'runner' ? 'awaiting_runner' : 'awaiting_oxsteed';
      await client.query(
        `UPDATE restaurant_support_cases
            SET status = $2, reopened_at = CASE WHEN status IN ('resolved','closed') THEN NOW() ELSE reopened_at END
          WHERE id = $1`,
        [supportCase.id, nextStatus]
      );
      await enqueueNotification(client, supportCase.id, supportCase.owner_type === 'runner' ? 'runner' : supportCase.owner_type === 'oxsteed' ? 'oxsteed' : 'restaurant', 'customer_replied', { messageId: row.id });
      return { row, replayed: false };
    }, 'restaurant_support_customer_message');
    res.status(result.replayed ? 200 : 201).json({ message: result.row });
  } catch (err) {
    next(err);
  }
};

exports.addAttachment = async (req, res, next) => {
  try {
    const caseId = parsePositiveInt(req.params.caseId);
    const fileUrl = normalizeString(req.body.fileUrl || req.body.file_url, 2000);
    if (!fileUrl) throw new AppError('Validation failed', 400, 'validation_failed', { fileUrl: 'File URL is required' });
    const result = await withTransaction(pool, async (client) => {
      const supportCase = await assertCaseCustomer(client, caseId, req.user.id);
      const { rows: [attachment] } = await client.query(
        `INSERT INTO restaurant_support_case_attachments
           (case_id, uploaded_by_user_id, file_url, file_type, file_name, file_size, attachment_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          supportCase.id,
          req.user.id,
          fileUrl,
          normalizeString(req.body.fileType || req.body.file_type, 120),
          normalizeString(req.body.fileName || req.body.file_name, 255),
          parsePositiveInt(req.body.fileSize || req.body.file_size),
          normalizeEnum(req.body.attachmentType || req.body.attachment_type, new Set(['photo', 'receipt', 'document', 'proof']), 'photo'),
        ]
      );
      await logEvent(client, supportCase.id, {
        actorUserId: req.user.id,
        actorType: 'customer',
        eventType: 'attachment_added',
        metadata: { attachmentId: attachment.id },
      });
      return attachment;
    }, 'restaurant_support_attachment');
    res.status(201).json({ attachment: result });
  } catch (err) {
    next(err);
  }
};

exports.reopenCase = async (req, res, next) => {
  try {
    const caseId = parsePositiveInt(req.params.caseId);
    const reason = normalizeString(req.body.reason || req.body.message, 2000) || 'Customer reopened case';
    const result = await withTransaction(pool, async (client) => {
      const supportCase = await assertCaseCustomer(client, caseId, req.user.id);
      if (!['resolved', 'closed'].includes(supportCase.status)) {
        throw new AppError('Only resolved or closed cases can be reopened', 409, 'case_not_reopenable');
      }
      const { rows: [updated] } = await client.query(
        `UPDATE restaurant_support_cases
            SET status = 'reopened',
                is_escalated = TRUE,
                escalated_at = COALESCE(escalated_at, NOW()),
                escalation_reason = COALESCE(escalation_reason, $2),
                reopened_at = NOW(),
                owner_type = CASE WHEN owner_type = 'restaurant' THEN 'shared' ELSE owner_type END
          WHERE id = $1
          RETURNING *`,
        [supportCase.id, reason]
      );
      await logEvent(client, supportCase.id, {
        actorUserId: req.user.id,
        actorType: 'customer',
        eventType: 'case_reopened',
        oldValue: supportCase.status,
        newValue: 'reopened',
        metadata: { reason },
      });
      await enqueueNotification(client, supportCase.id, 'oxsteed', 'case_reopened', { reason });
      return updated;
    }, 'restaurant_support_reopen');
    res.json({ case: result });
  } catch (err) {
    next(err);
  }
};

exports.acceptResolution = async (req, res, next) => {
  try {
    const caseId = parsePositiveInt(req.params.caseId);
    const { rows: [caseForPayment] } = await pool.query(`
      SELECT rsc.*, fo.total_cents, fo.payment_status, fo.stripe_payment_intent_id,
             fr.stripe_account_id
      FROM restaurant_support_cases rsc
      LEFT JOIN food_orders fo ON fo.id = rsc.order_id
      LEFT JOIN food_restaurants fr ON fr.id = rsc.restaurant_id
      WHERE rsc.id = $1 AND rsc.customer_user_id = $2
    `, [caseId, req.user.id]);
    if (!caseForPayment) throw new AppError('Support case not found', 404, 'case_not_found');
    if (caseForPayment.status !== 'resolution_offered') {
      throw new AppError('No resolution is currently awaiting acceptance', 409, 'no_resolution_offered');
    }

    const needsRefund = ['refund', 'partial_refund'].includes(caseForPayment.final_resolution);
    let processorRefundId = caseForPayment.refund_status === 'processed'
      ? caseForPayment.payment_transaction_id
      : null;
    let refundAmountCents = null;
    if (needsRefund && !processorRefundId) {
      if (caseForPayment.refund_status !== 'approved') {
        throw new AppError('Refund approval is still pending', 409, 'refund_not_approved');
      }
      if (!stripe) throw new AppError('Refund processing is not configured', 503, 'stripe_not_configured');
      if (caseForPayment.payment_status !== 'paid' || !caseForPayment.stripe_payment_intent_id) {
        throw new AppError('The order payment is not refundable', 409, 'payment_not_refundable');
      }
      const originalCents = Number(caseForPayment.total_cents);
      refundAmountCents = caseForPayment.final_resolution === 'partial_refund'
        ? Number(caseForPayment.approved_refund_amount_cents)
        : originalCents;
      if (!Number.isInteger(originalCents) || originalCents <= 0 || !Number.isInteger(refundAmountCents)
        || refundAmountCents <= 0 || refundAmountCents > originalCents) {
        throw new AppError('Refund amount is invalid', 400, 'invalid_refund_amount');
      }
      try {
        const refund = await stripe.refunds.create({
          payment_intent: caseForPayment.stripe_payment_intent_id,
          ...(refundAmountCents === originalCents ? {} : { amount: refundAmountCents }),
        }, {
          idempotencyKey: `restaurant-support-refund-${caseId}-${refundAmountCents}`,
          ...(caseForPayment.stripe_account_id ? { stripeAccount: caseForPayment.stripe_account_id } : {}),
        });
        processorRefundId = refund.id;
      } catch (stripeError) {
        logger.error('Restaurant support refund failed at payment processor', {
          caseId,
          error: stripeError.message,
        });
        throw new AppError('Refund failed with payment processor. The resolution was not accepted.', 502, 'stripe_error');
      }
    }

    const result = await withTransaction(pool, async (client) => {
      const supportCase = await assertCaseCustomer(client, caseId, req.user.id);
      if (supportCase.status !== 'resolution_offered') {
        throw new AppError('No resolution is currently awaiting acceptance', 409, 'no_resolution_offered');
      }
      const { rows: [updated] } = await client.query(
        `UPDATE restaurant_support_cases
            SET status = 'resolved',
                resolved_at = NOW(),
                refund_status = CASE WHEN $2 IS NOT NULL THEN 'processed' ELSE refund_status END,
                payment_transaction_id = COALESCE($2, payment_transaction_id)
          WHERE id = $1
          RETURNING *`,
        [supportCase.id, processorRefundId]
      );
      if (processorRefundId && supportCase.final_resolution === 'refund' && supportCase.order_id) {
        await client.query(
          `UPDATE food_orders
              SET status = 'refunded', payment_status = 'refunded', updated_at = NOW()
            WHERE id = $1 AND payment_status = 'paid'`,
          [supportCase.order_id]
        );
      }
      await logEvent(client, supportCase.id, {
        actorUserId: req.user.id,
        actorType: 'customer',
        eventType: 'resolution_accepted',
        oldValue: supportCase.status,
        newValue: 'resolved',
        metadata: processorRefundId ? { stripeRefundId: processorRefundId, refundAmountCents } : {},
      });
      await enqueueNotification(client, supportCase.id, 'restaurant', 'resolution_accepted', {});
      return updated;
    }, 'restaurant_support_accept_resolution');
    res.json({ case: result });
  } catch (err) {
    next(err);
  }
};

exports.listRestaurantCases = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const status = normalizeString(req.query.status, 40);
    const values = [restaurantId];
    let where = 'rsc.restaurant_id = $1 AND rsc.archived_at IS NULL';
    if (status && STATUS.has(status)) {
      values.push(status);
      where += ` AND rsc.status = $${values.length}`;
    }
    const { rows } = await pool.query(
      `SELECT rsc.*, u.email AS customer_email, u.first_name AS customer_first_name, u.last_name AS customer_last_name
         FROM restaurant_support_cases rsc
         LEFT JOIN users u ON u.id = rsc.customer_user_id
        WHERE ${where}
        ORDER BY rsc.due_at ASC NULLS LAST, rsc.created_at DESC
        LIMIT 200`,
      values
    );
    res.json({ cases: rows });
  } catch (err) {
    next(err);
  }
};

exports.getRestaurantCase = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const caseId = parsePositiveInt(req.params.caseId);
    const { supportCase } = await assertCaseRestaurant(pool, caseId, restaurantId, req.user.id);
    res.json(await getCaseDetails(pool, supportCase, 'restaurant'));
  } catch (err) {
    next(err);
  }
};

exports.restaurantRespond = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const caseId = parsePositiveInt(req.params.caseId);
    const message = normalizeString(req.body.message || req.body.content, 5000);
    if (!message) throw new AppError('Validation failed', 400, 'validation_failed', { message: 'Message is required' });
    const clientMessageId = req.get('Idempotency-Key')
      || req.body.clientMessageId
      || req.body.client_message_id
      || null;
    if (clientMessageId && !isUuid(clientMessageId)) {
      throw new AppError('clientMessageId must be a valid UUID', 400, 'validation_failed');
    }
    const result = await withTransaction(pool, async (client) => {
      const { supportCase } = await assertCaseRestaurant(client, caseId, restaurantId, req.user.id, { respond: true });
      const messageResult = await addMessage(client, supportCase, {
        senderUserId: req.user.id,
        senderType: 'restaurant',
        message,
        language: normalizeLanguage(req.body.language),
        clientMessageId,
        returnReplay: true,
      });
      if (messageResult.replayed) return { message: messageResult.row, replayed: true };
      const row = messageResult.row;
      const { rows: [updated] } = await client.query(
        `UPDATE restaurant_support_cases
            SET status = 'awaiting_customer',
                first_response_at = COALESCE(first_response_at, NOW())
          WHERE id = $1
          RETURNING *`,
        [supportCase.id]
      );
      await logEvent(client, supportCase.id, {
        actorUserId: req.user.id,
        actorType: 'restaurant',
        eventType: 'restaurant_responded',
        metadata: { messageId: row.id },
      });
      await enqueueNotification(client, supportCase.id, 'customer', 'restaurant_responded', { messageId: row.id }, supportCase.customer_user_id);
      return { updated, message: row, replayed: false };
    }, 'restaurant_support_restaurant_respond');
    res.json({ case: result.updated || null, message: result.message });
  } catch (err) {
    next(err);
  }
};

exports.restaurantInternalNote = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const caseId = parsePositiveInt(req.params.caseId);
    const message = normalizeString(req.body.message || req.body.note, 5000);
    if (!message) throw new AppError('Validation failed', 400, 'validation_failed', { message: 'Note is required' });
    const result = await withTransaction(pool, async (client) => {
      const { supportCase } = await assertCaseRestaurant(client, caseId, restaurantId, req.user.id, { respond: true });
      return addMessage(client, supportCase, {
        senderUserId: req.user.id,
        senderType: 'restaurant',
        message,
        internalNote: true,
      });
    }, 'restaurant_support_internal_note');
    res.status(201).json({ message: result });
  } catch (err) {
    next(err);
  }
};

exports.restaurantAssign = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const caseId = parsePositiveInt(req.params.caseId);
    const assignedToUserId = normalizeString(req.body.assignedToUserId || req.body.assigned_to_user_id, 80);
    const reason = normalizeString(req.body.reason, 1000);
    const result = await withTransaction(pool, async (client) => {
      const { supportCase } = await assertCaseRestaurant(client, caseId, restaurantId, req.user.id, { manage: true });
      const { rows: [updated] } = await client.query(
        `UPDATE restaurant_support_cases SET assigned_to_user_id = $2 WHERE id = $1 RETURNING *`,
        [supportCase.id, assignedToUserId || null]
      );
      await client.query(
        `INSERT INTO restaurant_support_case_assignments
           (case_id, assigned_to_type, assigned_to_user_id, assigned_to_restaurant_id, assigned_by_user_id, reason)
         VALUES ($1,'restaurant',$2,$3,$4,$5)`,
        [supportCase.id, assignedToUserId || null, restaurantId, req.user.id, reason]
      );
      await logEvent(client, supportCase.id, {
        actorUserId: req.user.id,
        actorType: 'restaurant',
        eventType: 'case_assigned',
        oldValue: supportCase.assigned_to_user_id,
        newValue: assignedToUserId,
        metadata: { reason },
      });
      return updated;
    }, 'restaurant_support_assign');
    res.json({ case: result });
  } catch (err) {
    next(err);
  }
};

exports.restaurantOfferResolution = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const caseId = parsePositiveInt(req.params.caseId);
    const resolution = normalizeEnum(req.body.resolution || req.body.finalResolution || req.body.final_resolution, RESOLUTIONS, null);
    if (!resolution) throw new AppError('Validation failed', 400, 'validation_failed', { resolution: 'Supported resolution is required' });
    const amount = cents(req.body.amountCents || req.body.amount_cents || req.body.resolutionAmountCents);
    const result = await withTransaction(pool, async (client) => {
      const { supportCase } = await assertCaseRestaurant(client, caseId, restaurantId, req.user.id, { manage: true });
      if (['payment_sensitive', 'fraud_sensitive'].includes(supportCase.severity) || supportCase.issue_type === 'payment_problem') {
        throw new AppError('OxSteed approval is required for payment-sensitive cases', 403, 'oxsteed_approval_required');
      }
      const { rows: [updated] } = await client.query(
        `UPDATE restaurant_support_cases
            SET status = 'resolution_offered',
                final_resolution = $2,
                resolution_amount_cents = $3,
                credit_status = CASE WHEN $2 = 'store_credit' THEN 'offered' ELSE credit_status END,
                refund_status = CASE WHEN $2 IN ('refund','partial_refund') THEN 'pending_approval' ELSE refund_status END
          WHERE id = $1
          RETURNING *`,
        [supportCase.id, resolution, amount]
      );
      await logEvent(client, supportCase.id, {
        actorUserId: req.user.id,
        actorType: 'restaurant',
        eventType: 'resolution_offered',
        oldValue: supportCase.final_resolution,
        newValue: resolution,
        metadata: { amountCents: amount },
      });
      await enqueueNotification(client, supportCase.id, 'customer', 'resolution_offered', { resolution, amountCents: amount }, supportCase.customer_user_id);
      return updated;
    }, 'restaurant_support_offer_resolution');
    res.json({ case: result });
  } catch (err) {
    next(err);
  }
};

exports.restaurantResolve = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const caseId = parsePositiveInt(req.params.caseId);
    const note = normalizeString(req.body.note || req.body.resolutionNote || req.body.resolution_note, 3000);
    const result = await withTransaction(pool, async (client) => {
      const { supportCase } = await assertCaseRestaurant(client, caseId, restaurantId, req.user.id, { manage: true });
      if (supportCase.is_escalated && supportCase.owner_type === 'oxsteed') {
        throw new AppError('OxSteed owns this escalated case', 403, 'oxsteed_owned_case');
      }
      const { rows: [updated] } = await client.query(
        `UPDATE restaurant_support_cases
            SET status = 'resolved',
                resolved_at = NOW(),
                final_resolution = COALESCE(final_resolution, $2)
          WHERE id = $1
          RETURNING *`,
        [supportCase.id, note ? 'apology_only' : supportCase.final_resolution]
      );
      await logEvent(client, supportCase.id, {
        actorUserId: req.user.id,
        actorType: 'restaurant',
        eventType: 'case_resolved',
        oldValue: supportCase.status,
        newValue: 'resolved',
        metadata: { note },
      });
      if (note) {
        await addMessage(client, supportCase, {
          senderUserId: req.user.id,
          senderType: 'restaurant',
          message: note,
        });
      }
      await enqueueNotification(client, supportCase.id, 'customer', 'case_resolved', {}, supportCase.customer_user_id);
      return updated;
    }, 'restaurant_support_resolve');
    res.json({ case: result });
  } catch (err) {
    next(err);
  }
};

exports.restaurantEscalate = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const caseId = parsePositiveInt(req.params.caseId);
    const reason = normalizeString(req.body.reason, 2000) || 'Restaurant escalated to OxSteed';
    const result = await withTransaction(pool, async (client) => {
      const { supportCase } = await assertCaseRestaurant(client, caseId, restaurantId, req.user.id, { respond: true });
      const { rows: [updated] } = await client.query(
        `UPDATE restaurant_support_cases
            SET status = 'escalated',
                owner_type = 'oxsteed',
                is_escalated = TRUE,
                escalated_at = COALESCE(escalated_at, NOW()),
                escalation_reason = $2
          WHERE id = $1
          RETURNING *`,
        [supportCase.id, reason]
      );
      await logEvent(client, supportCase.id, {
        actorUserId: req.user.id,
        actorType: 'restaurant',
        eventType: 'escalated',
        oldValue: supportCase.owner_type,
        newValue: 'oxsteed',
        metadata: { reason },
      });
      await enqueueNotification(client, supportCase.id, 'oxsteed', 'case_escalated', { reason });
      return updated;
    }, 'restaurant_support_escalate');
    res.json({ case: result });
  } catch (err) {
    next(err);
  }
};

exports.getRestaurantSummary = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const { rows: [counts] } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('new','awaiting_restaurant','reopened'))::int AS new_cases,
         COUNT(*) FILTER (WHERE due_at < NOW() AND status NOT IN ('resolved','closed','canceled'))::int AS overdue_cases,
         COUNT(*) FILTER (WHERE is_escalated = TRUE)::int AS escalated_cases,
         COUNT(*) FILTER (WHERE priority IN ('high','urgent') AND status NOT IN ('resolved','closed','canceled'))::int AS high_priority_cases,
         COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed','canceled'))::int AS unresolved_cases
       FROM restaurant_support_cases
       WHERE restaurant_id = $1 AND archived_at IS NULL`,
      [restaurantId]
    );
    const { rows: byIssueType } = await pool.query(
      `SELECT issue_type, COUNT(*)::int AS count
         FROM restaurant_support_cases
        WHERE restaurant_id = $1 AND archived_at IS NULL
        GROUP BY issue_type
        ORDER BY count DESC`,
      [restaurantId]
    );
    const { rows: [response] } = await pool.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60.0) AS average_response_minutes
         FROM restaurant_support_cases
        WHERE restaurant_id = $1 AND first_response_at IS NOT NULL`,
      [restaurantId]
    );
    res.json({
      summary: {
        ...counts,
        average_response_minutes: response?.average_response_minutes ? Number(response.average_response_minutes) : null,
        by_issue_type: byIssueType,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.adminListCases = async (req, res, next) => {
  try {
    const values = [];
    const where = ['rsc.archived_at IS NULL'];
    for (const [key, column] of [
      ['status', 'rsc.status'],
      ['issueType', 'rsc.issue_type'],
      ['ownerType', 'rsc.owner_type'],
      ['severity', 'rsc.severity'],
    ]) {
      const value = normalizeString(req.query[key] || req.query[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)], 80);
      if (value) {
        values.push(value);
        where.push(`${column} = $${values.length}`);
      }
    }
    const restaurantId = parsePositiveInt(req.query.restaurantId || req.query.restaurant_id);
    if (restaurantId) {
      values.push(restaurantId);
      where.push(`rsc.restaurant_id = $${values.length}`);
    }
    const { rows } = await pool.query(
      `SELECT rsc.*, fr.display_name AS restaurant_name, u.email AS customer_email
         FROM restaurant_support_cases rsc
         JOIN food_restaurants fr ON fr.id = rsc.restaurant_id
         LEFT JOIN users u ON u.id = rsc.customer_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY rsc.created_at DESC
        LIMIT 300`,
      values
    );
    res.json({ cases: rows });
  } catch (err) {
    next(err);
  }
};

exports.adminGetCase = async (req, res, next) => {
  try {
    const supportCase = await loadCase(pool, parsePositiveInt(req.params.caseId));
    if (!supportCase) throw new AppError('Support case not found', 404, 'case_not_found');
    res.json(await getCaseDetails(pool, supportCase, 'admin'));
  } catch (err) {
    next(err);
  }
};

exports.adminAssign = async (req, res, next) => {
  try {
    const result = await adminUpdateOwnership(req, {
      ownerType: normalizeEnum(req.body.ownerType || req.body.owner_type, new Set(['restaurant', 'oxsteed', 'runner', 'shared']), 'oxsteed'),
      status: normalizeEnum(req.body.status, STATUS, null),
      eventType: 'case_assigned',
    });
    res.json({ case: result });
  } catch (err) {
    next(err);
  }
};

exports.adminEscalate = async (req, res, next) => {
  try {
    const result = await adminUpdateOwnership(req, {
      ownerType: 'oxsteed',
      status: 'escalated',
      isEscalated: true,
      reason: normalizeString(req.body.reason, 2000) || 'OxSteed escalated case',
      eventType: 'escalated',
    });
    res.json({ case: result });
  } catch (err) {
    next(err);
  }
};

exports.adminDeescalate = async (req, res, next) => {
  try {
    const result = await adminUpdateOwnership(req, {
      ownerType: 'restaurant',
      status: 'awaiting_restaurant',
      isEscalated: false,
      reason: normalizeString(req.body.reason, 2000) || 'Returned to restaurant',
      eventType: 'deescalated',
    });
    res.json({ case: result });
  } catch (err) {
    next(err);
  }
};

async function adminUpdateOwnership(req, { ownerType, status, isEscalated = null, reason = null, eventType }) {
  if (!isAdmin(req)) throw new AppError('Admin access required', 403, 'admin_required');
  const caseId = parsePositiveInt(req.params.caseId);
  return withTransaction(pool, async (client) => {
    const supportCase = await loadCase(client, caseId);
    if (!supportCase) throw new AppError('Support case not found', 404, 'case_not_found');
    const nextStatus = status || (ownerType === 'restaurant' ? 'awaiting_restaurant' : ownerType === 'runner' ? 'awaiting_runner' : 'awaiting_oxsteed');
    const assignedToUserId = normalizeString(req.body.assignedToUserId || req.body.assigned_to_user_id, 80);
    const { rows: [updated] } = await client.query(
      `UPDATE restaurant_support_cases
          SET owner_type = $2,
              status = $3,
              assigned_to_user_id = $4,
              owner_oxsteed_user_id = CASE WHEN $2 = 'oxsteed' THEN COALESCE($4, $5) ELSE owner_oxsteed_user_id END,
              is_escalated = COALESCE($6, is_escalated),
              escalated_at = CASE WHEN COALESCE($6, is_escalated) = TRUE THEN COALESCE(escalated_at, NOW()) ELSE escalated_at END,
              escalation_reason = COALESCE($7, escalation_reason)
        WHERE id = $1
        RETURNING *`,
      [supportCase.id, ownerType, nextStatus, assignedToUserId || null, req.user.id, isEscalated, reason]
    );
    await client.query(
      `INSERT INTO restaurant_support_case_assignments
         (case_id, assigned_to_type, assigned_to_user_id, assigned_to_restaurant_id, assigned_by_user_id, reason)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [supportCase.id, ownerType, assignedToUserId || null, ownerType === 'restaurant' || ownerType === 'shared' ? supportCase.restaurant_id : null, req.user.id, reason]
    );
    await logEvent(client, supportCase.id, {
      actorUserId: req.user.id,
      actorType: 'oxsteed',
      eventType,
      oldValue: supportCase.owner_type,
      newValue: ownerType,
      metadata: { reason, status: nextStatus },
    });
    await enqueueNotification(client, supportCase.id, ownerType === 'runner' ? 'runner' : ownerType === 'restaurant' ? 'restaurant' : 'oxsteed', eventType, { reason });
    return updated;
  }, `restaurant_support_admin_${eventType}`);
}

exports.adminApproveResolution = async (req, res, next) => {
  try {
    const caseId = parsePositiveInt(req.params.caseId);
    const resolution = normalizeEnum(req.body.resolution || req.body.finalResolution || req.body.final_resolution, RESOLUTIONS, null);
    if (!resolution) throw new AppError('Validation failed', 400, 'validation_failed', { resolution: 'Supported resolution is required' });
    const amount = cents(req.body.amountCents || req.body.amount_cents || req.body.approvedRefundAmountCents);
    const result = await withTransaction(pool, async (client) => {
      const supportCase = await loadCase(client, caseId);
      if (!supportCase) throw new AppError('Support case not found', 404, 'case_not_found');
      const { rows: [updated] } = await client.query(
        `UPDATE restaurant_support_cases
            SET status = 'resolution_offered',
                final_resolution = $2,
                resolution_amount_cents = $3,
                approved_refund_amount_cents = CASE WHEN $2 IN ('refund','partial_refund') THEN $3 ELSE approved_refund_amount_cents END,
                refund_status = CASE WHEN $2 IN ('refund','partial_refund') THEN 'approved' ELSE refund_status END,
                refund_approved_by = CASE WHEN $2 IN ('refund','partial_refund') THEN $4 ELSE refund_approved_by END,
                refund_approved_at = CASE WHEN $2 IN ('refund','partial_refund') THEN NOW() ELSE refund_approved_at END,
                credit_status = CASE WHEN $2 = 'store_credit' THEN 'offered' ELSE credit_status END,
                store_credit_amount_cents = CASE WHEN $2 = 'store_credit' THEN $3 ELSE store_credit_amount_cents END
          WHERE id = $1
          RETURNING *`,
        [supportCase.id, resolution, amount, req.user.id]
      );
      await logEvent(client, supportCase.id, {
        actorUserId: req.user.id,
        actorType: 'oxsteed',
        eventType: 'refund_approved',
        oldValue: supportCase.final_resolution,
        newValue: resolution,
        metadata: { amountCents: amount },
      });
      await enqueueNotification(client, supportCase.id, 'customer', 'resolution_offered', { resolution, amountCents: amount }, supportCase.customer_user_id);
      return updated;
    }, 'restaurant_support_admin_approve_resolution');
    res.json({ case: result });
  } catch (err) {
    next(err);
  }
};

exports.adminClose = async (req, res, next) => {
  try {
    res.json({ case: await adminSetStatus(req, 'closed', 'case_closed') });
  } catch (err) {
    next(err);
  }
};

exports.adminReopen = async (req, res, next) => {
  try {
    res.json({ case: await adminSetStatus(req, 'reopened', 'case_reopened') });
  } catch (err) {
    next(err);
  }
};

async function adminSetStatus(req, status, eventType) {
  const caseId = parsePositiveInt(req.params.caseId);
  const note = normalizeString(req.body.reason || req.body.note, 2000);
  return withTransaction(pool, async (client) => {
    const supportCase = await loadCase(client, caseId);
    if (!supportCase) throw new AppError('Support case not found', 404, 'case_not_found');
    const timestampField = status === 'closed' ? 'closed_at' : status === 'reopened' ? 'reopened_at' : null;
    const { rows: [updated] } = await client.query(
      `UPDATE restaurant_support_cases
          SET status = $2,
              closed_at = CASE WHEN $3 = 'closed_at' THEN NOW() ELSE closed_at END,
              reopened_at = CASE WHEN $3 = 'reopened_at' THEN NOW() ELSE reopened_at END
        WHERE id = $1
        RETURNING *`,
      [supportCase.id, status, timestampField]
    );
    await logEvent(client, supportCase.id, {
      actorUserId: req.user.id,
      actorType: 'oxsteed',
      eventType,
      oldValue: supportCase.status,
      newValue: status,
      metadata: { note },
    });
    await enqueueNotification(client, supportCase.id, 'customer', eventType, { note }, supportCase.customer_user_id);
    return updated;
  }, `restaurant_support_admin_${eventType}`);
}

exports.adminMetrics = async (_req, res, next) => {
  try {
    const { rows: [counts] } = await pool.query(
      `SELECT
         COUNT(*)::int AS total_cases,
         COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed','canceled'))::int AS open_cases,
         COUNT(*) FILTER (WHERE is_escalated = TRUE)::int AS escalated_cases,
         COUNT(*) FILTER (WHERE due_at < NOW() AND status NOT IN ('resolved','closed','canceled'))::int AS sla_missed,
         COUNT(*) FILTER (WHERE severity IN ('safety_sensitive','payment_sensitive','fraud_sensitive'))::int AS sensitive_cases
       FROM restaurant_support_cases
       WHERE archived_at IS NULL`
    );
    const { rows: byRestaurant } = await pool.query(
      `SELECT fr.id AS restaurant_id, fr.display_name, COUNT(*)::int AS cases,
              COUNT(*) FILTER (WHERE rsc.status NOT IN ('resolved','closed','canceled'))::int AS open_cases,
              COUNT(*) FILTER (WHERE rsc.is_escalated = TRUE)::int AS escalated_cases
         FROM restaurant_support_cases rsc
         JOIN food_restaurants fr ON fr.id = rsc.restaurant_id
        WHERE rsc.created_at >= NOW() - INTERVAL '30 days'
        GROUP BY fr.id, fr.display_name
        ORDER BY cases DESC
        LIMIT 50`
    );
    const { rows: byIssueType } = await pool.query(
      `SELECT issue_type, COUNT(*)::int AS count
         FROM restaurant_support_cases
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY issue_type
        ORDER BY count DESC`
    );
    res.json({ metrics: { ...counts, by_restaurant: byRestaurant, by_issue_type: byIssueType } });
  } catch (err) {
    next(err);
  }
};
