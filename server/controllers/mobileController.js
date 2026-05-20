const pool = require('../db');
const AppError = require('../utils/appError');
const { uploadFile, getPublicUrl } = require('../utils/storage');

const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

const VALID_PROVIDERS = new Set(['apns', 'fcm']);
const VALID_PLATFORMS = new Set(['ios', 'android', 'web']);

function normalizeString(value, maxLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

async function safeQuery(sql, params = [], fallback = []) {
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
  } catch (err) {
    return fallback;
  }
}

function firstNumber(rows, key, fallback = 0) {
  const value = rows?.[0]?.[key];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requireStripe() {
  if (!stripe || !process.env.STRIPE_PUBLISHABLE_KEY) {
    throw new AppError('Stripe payments are not configured', 503, 'stripe_not_configured');
  }
}

function invoiceBalanceCents(invoice) {
  const totalCents = Math.round(Number(invoice.total || 0) * 100);
  const paidCents = Math.round(Number(invoice.amount_paid || 0) * 100);
  return Math.max(0, totalCents - paidCents);
}

async function getPayableInvoice(invoiceId, user) {
  const { rows } = await pool.query(
    `SELECT bi.*, b.business_name
       FROM business_invoices bi
       LEFT JOIN businesses b ON b.id = bi.business_id
      WHERE bi.id = $1
        AND (
          bi.user_id = $2
          OR LOWER(COALESCE(bi.client_email, '')) = LOWER($3)
        )`,
    [invoiceId, user.id, user.email || '']
  );
  return rows[0] || null;
}

exports.getPaymentConfig = async (req, res, next) => {
  try {
    requireStripe();
    res.json({
      success: true,
      data: {
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.createInvoicePaymentIntent = async (req, res, next) => {
  try {
    requireStripe();
    const invoice = await getPayableInvoice(req.params.invoiceId, req.user);
    if (!invoice) {
      throw new AppError('Invoice not found', 404, 'invoice_not_found');
    }

    const balanceCents = invoiceBalanceCents(invoice);
    if (balanceCents <= 0 || invoice.status === 'paid') {
      throw new AppError('Invoice is already paid', 409, 'invoice_already_paid');
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: balanceCents,
      currency: 'usd',
      receipt_email: req.user.email || invoice.client_email || undefined,
      metadata: {
        invoice_id: String(invoice.id),
        payer_id: String(req.user.id),
        invoice_type: invoice.business_id ? 'business_invoice' : 'helper_invoice',
      },
    });

    res.json({
      success: true,
      data: {
        invoiceId: invoice.id,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amountCents: balanceCents,
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.confirmInvoicePayment = async (req, res, next) => {
  try {
    requireStripe();
    const invoice = await getPayableInvoice(req.params.invoiceId, req.user);
    if (!invoice) {
      throw new AppError('Invoice not found', 404, 'invoice_not_found');
    }

    const paymentIntentId = normalizeString(req.body.paymentIntentId, 255);
    if (!paymentIntentId) {
      throw new AppError('Payment intent is required', 400, 'validation_failed', {
        paymentIntentId: 'Required',
      });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.metadata?.invoice_id && String(paymentIntent.metadata.invoice_id) !== String(invoice.id)) {
      throw new AppError('Payment does not belong to this invoice', 403, 'payment_invoice_mismatch');
    }
    if (paymentIntent.status !== 'succeeded') {
      return res.status(409).json({
        success: false,
        error: `Payment status: ${paymentIntent.status}`,
        status: paymentIntent.status,
      });
    }

    const amountPaid = Number(paymentIntent.amount_received || paymentIntent.amount || 0) / 100;
    const { rows } = await pool.query(
      `UPDATE business_invoices
          SET status = CASE WHEN total <= COALESCE(amount_paid, 0) + $1 THEN 'paid' ELSE 'partial' END,
              amount_paid = LEAST(total, COALESCE(amount_paid, 0) + $1),
              paid_at = CASE WHEN total <= COALESCE(amount_paid, 0) + $1 THEN NOW() ELSE paid_at END,
              updated_at = NOW()
        WHERE id = $2
        RETURNING *`,
      [amountPaid, invoice.id]
    );

    res.json({
      success: true,
      data: {
        invoice: rows[0],
        paymentIntentId,
        status: rows[0]?.status,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.getFeed = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [
      myJobs,
      availableJobs,
      sentBookings,
      incomingBookings,
      appointments,
      plannedNeeds,
      conversations,
      orderStats,
      recentOrders,
      businesses,
      unreadNotifications,
    ] = await Promise.all([
      safeQuery(
        `SELECT id, title, status, category_name, budget_min, budget_max, created_at
           FROM jobs
          WHERE client_id = $1
          ORDER BY created_at DESC
          LIMIT 5`,
        [userId]
      ),
      safeQuery(
        `SELECT id, title, status, category_name, budget_min, budget_max, location_city, location_state, created_at
           FROM jobs
          WHERE status IN ('open', 'published', 'bidding')
            AND (client_id IS NULL OR client_id <> $1)
          ORDER BY created_at DESC
          LIMIT 8`,
        [userId]
      ),
      safeQuery(
        `SELECT id, service_name, requested_date, requested_start_time, requested_end_time,
                service_location, status, expires_at, created_at
           FROM booking_requests
          WHERE customer_id = $1
          ORDER BY created_at DESC
          LIMIT 5`,
        [userId]
      ),
      safeQuery(
        `SELECT br.id, br.service_name, br.requested_date, br.requested_start_time,
                br.requested_end_time, br.service_location, br.status, br.expires_at,
                br.created_at, u.first_name || ' ' || u.last_name AS customer_name
           FROM booking_requests br
           JOIN users u ON u.id = br.customer_id
          WHERE br.helper_id = $1
          ORDER BY br.created_at DESC
          LIMIT 5`,
        [userId]
      ),
      safeQuery(
        `SELECT id, status, scheduled_start_time, scheduled_end_time, title, job_id,
                customer_id, helper_id, business_id
           FROM appointments
          WHERE (customer_id = $1 OR helper_id = $1)
            AND scheduled_start_time >= NOW() - interval '1 day'
          ORDER BY scheduled_start_time ASC
          LIMIT 6`,
        [userId]
      ),
      safeQuery(
        `SELECT id, title, category, status, due_date, estimated_cost, reserved_amount
           FROM planned_needs
          WHERE user_id = $1
            AND status IN ('planned', 'funding', 'activating_soon')
          ORDER BY due_date ASC
          LIMIT 5`,
        [userId]
      ),
      safeQuery(
        `SELECT c.id, c.job_id, c.status, c.last_message_at, j.title AS job_title,
                lm.content AS last_message,
                COUNT(um.id) FILTER (WHERE um.is_read = FALSE AND um.sender_id <> $1) AS unread_count
           FROM conversations c
           LEFT JOIN jobs j ON j.id = c.job_id
           LEFT JOIN LATERAL (
             SELECT content FROM messages m
              WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC
              LIMIT 1
           ) lm ON TRUE
           LEFT JOIN messages um ON um.conversation_id = c.id
          WHERE c.customer_id = $1 OR c.helper_id = $1
          GROUP BY c.id, j.title, lm.content
          ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
          LIMIT 6`,
        [userId]
      ),
      safeQuery(
        `SELECT
            COUNT(*) AS total_orders,
            SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS completed_orders,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_orders,
            SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_orders,
            COALESCE(SUM(total_cents), 0) AS total_spent_cents
           FROM marketplace_orders
          WHERE customer_id = $1`,
        [userId],
        [{ total_orders: 0, completed_orders: 0, pending_orders: 0, cancelled_orders: 0, total_spent_cents: 0 }]
      ),
      safeQuery(
        `SELECT id, status, total_cents, created_at
           FROM marketplace_orders
          WHERE customer_id = $1
          ORDER BY created_at DESC
          LIMIT 5`,
        [userId]
      ),
      safeQuery(
        `SELECT id, business_name, business_type, active_template, is_primary
           FROM businesses
          WHERE user_id = $1 AND is_active = TRUE
          ORDER BY is_primary DESC, created_at DESC
          LIMIT 5`,
        [userId]
      ),
      safeQuery(
        `SELECT COUNT(*) AS unread
           FROM notifications
          WHERE user_id = $1 AND is_read = FALSE`,
        [userId],
        [{ unread: 0 }]
      ),
    ]);

    const openJobCount = firstNumber(
      await safeQuery(
        `SELECT COUNT(*) AS count
           FROM jobs
          WHERE client_id = $1 AND status IN ('open', 'published', 'bidding', 'assigned', 'in_progress')`,
        [userId],
        [{ count: 0 }]
      ),
      'count'
    );
    const incomingBookingCount = firstNumber(
      await safeQuery(
        `SELECT COUNT(*) AS count
           FROM booking_requests
          WHERE helper_id = $1 AND status IN ('pending', 'expired')`,
        [userId],
        [{ count: 0 }]
      ),
      'count'
    );
    const unreadMessageCount = conversations.reduce(
      (sum, row) => sum + (Number(row.unread_count) || 0),
      0
    );

    res.json({
      success: true,
      data: {
        user: {
          id: req.user.id,
          first_name: req.user.first_name,
          last_name: req.user.last_name,
          email: req.user.email,
          role: req.user.role,
        },
        summary: {
          open_jobs: openJobCount,
          incoming_booking_requests: incomingBookingCount,
          unread_messages: unreadMessageCount,
          unread_notifications: firstNumber(unreadNotifications, 'unread'),
          total_orders: firstNumber(orderStats, 'total_orders'),
          total_spent_cents: firstNumber(orderStats, 'total_spent_cents'),
          owned_businesses: businesses.length,
        },
        jobs: {
          mine: myJobs,
          available: availableJobs,
        },
        bookings: {
          sent: sentBookings,
          incoming: incomingBookings,
        },
        appointments,
        planned_needs: plannedNeeds,
        conversations,
        orders: {
          stats: orderStats[0] || {},
          recent: recentOrders,
        },
        businesses,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.registerPushToken = async (req, res, next) => {
  try {
    const token = normalizeString(req.body.token, 4096);
    const provider = normalizeString(req.body.provider, 20);
    const platform = normalizeString(req.body.platform, 20);
    const deviceId = normalizeString(req.body.device_id, 512);
    const appVersion = normalizeString(req.body.app_version, 64);
    const device = req.body.device && typeof req.body.device === 'object' ? req.body.device : {};

    if (!token) {
      throw new AppError('Push token is required', 400, 'validation_failed', {
        token: 'Required',
      });
    }
    if (!VALID_PROVIDERS.has(provider)) {
      throw new AppError('Provider must be apns or fcm', 400, 'validation_failed', {
        provider: 'Must be apns or fcm',
      });
    }
    if (platform && !VALID_PLATFORMS.has(platform)) {
      throw new AppError('Platform must be ios, android, or web', 400, 'validation_failed', {
        platform: 'Must be ios, android, or web',
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO mobile_push_tokens (
         user_id, token, provider, platform, device_id, app_version, device,
         enabled, disabled_at, updated_at, last_seen_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, TRUE, NULL, NOW(), NOW())
       ON CONFLICT (token)
       DO UPDATE SET
         user_id = EXCLUDED.user_id,
         provider = EXCLUDED.provider,
         platform = EXCLUDED.platform,
         device_id = EXCLUDED.device_id,
         app_version = EXCLUDED.app_version,
         device = EXCLUDED.device,
         enabled = TRUE,
         disabled_at = NULL,
         updated_at = NOW(),
         last_seen_at = NOW()
       RETURNING id, provider, platform, enabled, last_seen_at`,
      [
        req.user.id,
        token,
        provider,
        platform,
        deviceId,
        appVersion,
        JSON.stringify(device),
      ]
    );

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.unregisterPushToken = async (req, res, next) => {
  try {
    const token = normalizeString(req.body.token, 4096);
    if (!token) {
      throw new AppError('Push token is required', 400, 'validation_failed', {
        token: 'Required',
      });
    }

    await pool.query(
      `UPDATE mobile_push_tokens
       SET enabled = FALSE, disabled_at = NOW(), updated_at = NOW()
       WHERE user_id = $1 AND token = $2`,
      [req.user.id, token]
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

exports.uploadHelperGallery = async (req, res, next) => {
  try {
    if (!['helper', 'helper_pro', 'broker'].includes(req.user.role)) {
      throw new AppError('Helper access required', 403, 'forbidden');
    }
    if (!req.file) {
      throw new AppError('Gallery image is required', 400, 'validation_failed', {
        file: 'Required',
      });
    }

    const caption = normalizeString(req.body.caption, 200);
    const key = await uploadFile(
      req.file.buffer,
      `helper-gallery/${req.user.id}`,
      req.file.originalname,
      req.file.mimetype
    );
    if (!key) {
      throw new AppError('File storage is not configured', 503, 'storage_not_configured');
    }

    const url = getPublicUrl(key);
    const { rows } = await pool.query(
      `INSERT INTO helper_gallery (user_id, url, caption, sort_order)
       VALUES ($1, $2, $3, 0)
       RETURNING id, user_id, url, caption, sort_order, created_at`,
      [req.user.id, url, caption]
    );

    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
};
