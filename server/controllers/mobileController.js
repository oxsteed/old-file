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

async function getPayableBooking(bookingId, user) {
  const { rows } = await pool.query(
    `SELECT br.*, h.email AS helper_email
       FROM booking_requests br
       JOIN users h ON h.id = br.helper_id
      WHERE br.id = $1
        AND br.customer_id = $2`,
    [bookingId, user.id]
  );
  return rows[0] || null;
}

exports.createBookingPaymentIntent = async (req, res, next) => {
  try {
    requireStripe();
    const booking = await getPayableBooking(req.params.bookingId, req.user);
    if (!booking) {
      throw new AppError('Booking request not found', 404, 'booking_not_found');
    }
    if (!['pending', 'accepted'].includes(booking.status)) {
      throw new AppError('Booking is not payable in its current state', 409, 'booking_not_payable');
    }
    if (booking.payment_status === 'paid') {
      throw new AppError('Booking is already paid', 409, 'booking_already_paid');
    }

    const amountCents = Math.round(Number(req.body.amountCents || req.body.amount_cents || 0));
    const paymentRequirement = normalizeString(req.body.paymentRequirement || req.body.payment_requirement, 20) || 'deposit';
    if (!['deposit', 'full'].includes(paymentRequirement)) {
      throw new AppError('Payment requirement must be deposit or full', 400, 'validation_failed', {
        paymentRequirement: 'Must be deposit or full',
      });
    }
    if (!Number.isFinite(amountCents) || amountCents < 50 || amountCents > 5000000) {
      throw new AppError('Payment amount must be between $0.50 and $50,000', 400, 'validation_failed', {
        amountCents: 'Invalid amount',
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      receipt_email: req.user.email || undefined,
      metadata: {
        booking_request_id: String(booking.id),
        customer_id: String(req.user.id),
        helper_id: String(booking.helper_id),
        payment_requirement: paymentRequirement,
        source: 'mobile_booking',
      },
    });

    await pool.query(
      `UPDATE booking_requests
          SET payment_requirement = $1,
              payment_amount_cents = $2,
              payment_status = 'requires_payment',
              stripe_payment_intent_id = $3,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $4`,
      [paymentRequirement, amountCents, paymentIntent.id, booking.id]
    );

    res.json({
      success: true,
      data: {
        bookingId: booking.id,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amountCents,
        paymentRequirement,
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.confirmBookingPayment = async (req, res, next) => {
  try {
    requireStripe();
    const booking = await getPayableBooking(req.params.bookingId, req.user);
    if (!booking) {
      throw new AppError('Booking request not found', 404, 'booking_not_found');
    }

    const paymentIntentId = normalizeString(req.body.paymentIntentId, 255) || booking.stripe_payment_intent_id;
    if (!paymentIntentId) {
      throw new AppError('Payment intent is required', 400, 'validation_failed', {
        paymentIntentId: 'Required',
      });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.metadata?.booking_request_id && String(paymentIntent.metadata.booking_request_id) !== String(booking.id)) {
      throw new AppError('Payment does not belong to this booking', 403, 'payment_booking_mismatch');
    }
    if (paymentIntent.status !== 'succeeded') {
      await pool.query(
        `UPDATE booking_requests
            SET payment_status = $1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $2`,
        [paymentIntent.status === 'processing' ? 'processing' : 'failed', booking.id]
      );
      return res.status(409).json({
        success: false,
        error: `Payment status: ${paymentIntent.status}`,
        status: paymentIntent.status,
      });
    }

    const { rows } = await pool.query(
      `UPDATE booking_requests
          SET payment_status = 'paid',
              payment_amount_cents = GREATEST(payment_amount_cents, $1),
              stripe_payment_intent_id = $2,
              paid_at = COALESCE(paid_at, NOW()),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        RETURNING *`,
      [paymentIntent.amount_received || paymentIntent.amount || 0, paymentIntentId, booking.id]
    );

    res.json({ success: true, data: { booking: rows[0], paymentIntentId, status: 'paid' } });
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
                service_location, status, payment_status, payment_amount_cents,
                payment_requirement, expires_at, created_at
           FROM booking_requests
          WHERE customer_id = $1
          ORDER BY created_at DESC
          LIMIT 5`,
        [userId]
      ),
      safeQuery(
        `SELECT br.id, br.service_name, br.requested_date, br.requested_start_time,
                br.requested_end_time, br.service_location, br.status,
                br.payment_status, br.payment_amount_cents, br.payment_requirement,
                br.expires_at, br.created_at, u.first_name || ' ' || u.last_name AS customer_name
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

exports.getNearby = async (req, res, next) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const city = normalizeString(req.query.city, 100);
    const category = normalizeString(req.query.category, 120);
    const q = normalizeString(req.query.q, 120);

    const jobParams = [];
    const jobWhere = [`j.deleted_at IS NULL`, `j.status IN ('published', 'matched')`];
    if (city) {
      jobParams.push(`%${city}%`);
      jobWhere.push(`j.location_city ILIKE $${jobParams.length}`);
    }
    if (category) {
      jobParams.push(category);
      jobWhere.push(`j.category_name = $${jobParams.length}`);
    }
    if (q) {
      jobParams.push(`%${q}%`);
      jobWhere.push(`(j.title ILIKE $${jobParams.length} OR j.description ILIKE $${jobParams.length})`);
    }
    jobParams.push(limit);

    const toolParams = [];
    const toolWhere = [`t.is_available = TRUE`];
    if (city) {
      toolParams.push(`%${city}%`);
      toolWhere.push(`t.location_city ILIKE $${toolParams.length}`);
    }
    if (category) {
      toolParams.push(`%${category}%`);
      toolWhere.push(`t.category ILIKE $${toolParams.length}`);
    }
    if (q) {
      toolParams.push(`%${q}%`);
      toolWhere.push(`(t.name ILIKE $${toolParams.length} OR t.description ILIKE $${toolParams.length})`);
    }
    toolParams.push(limit);

    const helperParams = [];
    const helperWhere = [`u.is_active = TRUE`, `u.deleted_at IS NULL`, `u.role IN ('helper', 'helper_pro', 'broker')`];
    if (city) {
      helperParams.push(`%${city}%`);
      helperWhere.push(`hp.service_city ILIKE $${helperParams.length}`);
    }
    if (q) {
      helperParams.push(`%${q}%`);
      helperWhere.push(`(u.first_name ILIKE $${helperParams.length} OR u.last_name ILIKE $${helperParams.length} OR hp.profile_headline ILIKE $${helperParams.length})`);
    }
    helperParams.push(limit);

    const [jobs, tools, helpers] = await Promise.all([
      safeQuery(
        `SELECT j.id, j.title, j.description, j.category_name, j.budget_min, j.budget_max,
                j.location_city, j.location_state, j.is_urgent, j.created_at
           FROM jobs j
          WHERE ${jobWhere.join(' AND ')}
          ORDER BY j.created_at DESC
          LIMIT $${jobParams.length}`,
        jobParams
      ),
      safeQuery(
        `SELECT t.id, t.name, t.category, t.description, t.daily_rate, t.hourly_rate,
                t.deposit_amount, t.requires_deposit, t.location_city, t.location_state,
                t.image_gallery, t.user_id AS owner_id, u.first_name || ' ' || u.last_name AS owner_name
           FROM tool_rentals t
           JOIN users u ON u.id = t.user_id
          WHERE ${toolWhere.join(' AND ')}
          ORDER BY t.created_at DESC
          LIMIT $${toolParams.length}`,
        toolParams
      ),
      safeQuery(
        `SELECT u.id, u.first_name || ' ' || u.last_name AS owner_name,
                hp.profile_headline, hp.bio_short, hp.service_city, hp.service_state,
                hp.avg_rating, hp.total_reviews, hp.is_background_checked, hp.is_identity_verified,
                hp.profile_photo_url
           FROM users u
           JOIN helper_profiles hp ON hp.user_id = u.id
          WHERE ${helperWhere.join(' AND ')}
          ORDER BY hp.avg_rating DESC NULLS LAST, u.created_at DESC
          LIMIT $${helperParams.length}`,
        helperParams
      ),
    ]);

    res.json({ success: true, data: { jobs, tools, helpers } });
  } catch (err) {
    next(err);
  }
};

exports.offlineSync = async (req, res, next) => {
  try {
    const actions = Array.isArray(req.body.actions) ? req.body.actions : [];
    if (actions.length > 50) {
      throw new AppError('Too many offline actions in one sync', 400, 'validation_failed');
    }
    const results = [];
    for (const action of actions) {
      const type = normalizeString(action.type, 80);
      const payload = action.payload && typeof action.payload === 'object' ? action.payload : {};
      const clientId = normalizeString(action.clientId || action.client_id, 120) || `offline-${Date.now()}-${results.length}`;
      try {
        const { rows } = await pool.query(
          `INSERT INTO mobile_offline_actions (user_id, client_action_id, action_type, payload, status)
           VALUES ($1, $2, $3, $4::jsonb, 'queued')
           ON CONFLICT (user_id, client_action_id)
           DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
           RETURNING id, client_action_id, action_type, status`,
          [req.user.id, clientId, type || 'unknown', JSON.stringify(payload)]
        );
        results.push({ clientId, status: 'queued', serverId: rows[0].id });
      } catch (err) {
        results.push({ clientId, status: 'failed', error: err.message });
      }
    }
    res.json({ success: true, data: { results } });
  } catch (err) {
    next(err);
  }
};

exports.getBusinessMobileSummary = async (req, res, next) => {
  try {
    const businessId = req.params.businessId || req.params.id;
    const access = await pool.query(
      `SELECT b.id, b.business_name, b.business_type, b.active_template, b.user_id
         FROM businesses b
        WHERE b.id = $1
          AND b.is_active = TRUE
          AND (
            b.user_id = $2 OR EXISTS (
              SELECT 1 FROM business_members bm
               WHERE bm.business_id = b.id AND bm.member_id = $2 AND bm.status = 'active'
            )
          )`,
      [businessId, req.user.id]
    );
    if (!access.rows.length) {
      throw new AppError('Business not found', 404, 'business_not_found');
    }

    const [appointments, invoices, messages, products, healthRows] = await Promise.all([
      safeQuery(
        `SELECT id, title, status, scheduled_start_time, scheduled_end_time
           FROM appointments
          WHERE business_id = $1 AND scheduled_start_time >= NOW() - interval '1 day'
          ORDER BY scheduled_start_time ASC
          LIMIT 10`,
        [businessId]
      ),
      safeQuery(
        `SELECT id, invoice_number, client_name, client_email, status, total, amount_paid, due_at, created_at
           FROM business_invoices
          WHERE business_id = $1
          ORDER BY created_at DESC
          LIMIT 10`,
        [businessId]
      ),
      safeQuery(
        `SELECT c.id, c.last_message_at, c.status,
                COUNT(m.id) FILTER (WHERE m.is_read = FALSE AND m.sender_id <> $2) AS unread_count,
                lm.content AS last_message
           FROM conversations c
           LEFT JOIN LATERAL (
             SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
           ) lm ON TRUE
           LEFT JOIN messages m ON m.conversation_id = c.id
          WHERE c.business_id = $1
          GROUP BY c.id, lm.content
          ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
          LIMIT 10`,
        [businessId, req.user.id]
      ),
      safeQuery(
        `SELECT p.id, p.name, p.category, p.price_cents, p.is_active,
                COALESCE(SUM(pi.stock_quantity), 0) AS total_stock
           FROM business_products p
           LEFT JOIN business_product_variants pv ON pv.product_id = p.id
           LEFT JOIN business_product_inventory pi ON pi.variant_id = pv.id
          WHERE p.business_id = $1 AND p.deleted_at IS NULL
          GROUP BY p.id
          ORDER BY p.created_at DESC
          LIMIT 10`,
        [businessId]
      ),
      safeQuery(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('sent', 'overdue', 'partial')) AS open_invoices,
           COALESCE(SUM(total) FILTER (WHERE status = 'paid'), 0) AS paid_revenue,
           COALESCE(SUM(total - COALESCE(amount_paid, 0)) FILTER (WHERE status <> 'paid'), 0) AS outstanding
          FROM business_invoices
         WHERE business_id = $1`,
        [businessId],
        [{ open_invoices: 0, paid_revenue: 0, outstanding: 0 }]
      ),
    ]);

    const health = healthRows[0] || {};
    const profileCompleteness = [
      access.rows[0].business_name,
      access.rows[0].business_type,
      products.length > 0,
      invoices.length > 0,
      appointments.length > 0,
    ].filter(Boolean).length * 20;

    res.json({
      success: true,
      data: {
        business: access.rows[0],
        overview: {
          openInvoices: Number(health.open_invoices || 0),
          paidRevenue: Number(health.paid_revenue || 0),
          outstanding: Number(health.outstanding || 0),
          unreadMessages: messages.reduce((sum, msg) => sum + (Number(msg.unread_count) || 0), 0),
          profileCompleteness,
        },
        appointments,
        invoices,
        messages,
        products,
        health: [
          { label: 'Profile completeness', value: profileCompleteness, status: profileCompleteness >= 80 ? 'good' : 'needs_work' },
          { label: 'Products listed', value: products.length, status: products.length ? 'good' : 'needs_work' },
          { label: 'Open invoices', value: Number(health.open_invoices || 0), status: Number(health.open_invoices || 0) ? 'watch' : 'good' },
        ],
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
