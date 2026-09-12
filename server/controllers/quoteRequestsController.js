const db = require('../db');
const logger = require('../utils/logger');
const { sendEmail } = require('../utils/email');
const {
  generatePublicReference,
  normalizeZipCode,
} = require('../utils/directQuote');
const { recordDirectCalendarAudit } = require('../services/directCalendarAudit');

const VALID_CONTACT_METHODS = new Set(['email', 'phone', 'text', 'either']);
const VALID_STATUSES = new Set([
  'new',
  'reviewing',
  'quoted',
  'contacted',
  'accepted',
  'scheduled',
  'en_route',
  'started',
  'waiting_customer',
  'completed',
  'closed',
  'cancelled',
]);

function cleanText(value, maxLen = 255) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function cleanEmail(value) {
  return cleanText(value, 255).toLowerCase();
}

function normalizeJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return normalizeJsonObject(parsed);
    } catch {
      return {};
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function normalizeInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function notifySupport(request) {
  const supportEmail = process.env.SUPPORT_EMAIL || 'support@oxsteed.com';
  await sendEmail({
    to: supportEmail,
    subject: `New OxSteed quote request from ${request.first_name} ${request.last_name}`,
    html: `
      <h2>New quote request</h2>
      <p><strong>Name:</strong> ${request.first_name} ${request.last_name}</p>
      <p><strong>Email:</strong> ${request.email}</p>
      <p><strong>Phone:</strong> ${request.phone || '-'}</p>
      <p><strong>Company:</strong> ${request.company_name || '-'}</p>
      <p><strong>Service:</strong> ${request.service_category}</p>
      <p><strong>Location:</strong> ${request.service_location}</p>
      <p><strong>Budget:</strong> ${request.budget_range || '-'}</p>
      <p><strong>Timeline:</strong> ${request.timeline || '-'}</p>
      <p><strong>Contact preference:</strong> ${request.preferred_contact_method}</p>
      <p><strong>Details:</strong></p>
      <p>${request.details.replace(/\n/g, '<br />')}</p>
    `,
  });
}

async function sendConfirmationEmail(request) {
  await sendEmail({
    to: request.email,
    subject: 'We received your OxSteed quote request',
    html: `
      <h2>Thanks for reaching out to OxSteed</h2>
      <p>We received your quote request for <strong>${request.service_category}</strong>.</p>
      <p>Our team will review it and follow up soon.</p>
      <p><strong>Location:</strong> ${request.service_location}</p>
      <p><strong>ZIP code:</strong> ${request.service_zip_code || '-'}</p>
      <p><strong>Budget:</strong> ${request.budget_range || '-'}</p>
      <p><strong>Timeline:</strong> ${request.timeline || '-'}</p>
      <p>Reference ID: <code>${request.public_reference || request.id}</code></p>
    `,
  });
}

exports.createQuoteRequest = async (req, res) => {
  const firstName = cleanText(req.body.first_name, 100);
  const lastName = cleanText(req.body.last_name, 100);
  const email = cleanEmail(req.body.email);
  const phone = cleanText(req.body.phone, 40);
  const companyName = cleanText(req.body.company_name, 200);
  const serviceCategory = cleanText(req.body.service_category, 120);
  const serviceLocation = cleanText(req.body.service_location, 200);
  const serviceZipCode = normalizeZipCode(req.body.service_zip_code || req.body.serviceZipCode);
  const budgetRange = cleanText(req.body.budget_range, 80);
  const timeline = cleanText(req.body.timeline, 120);
  const preferredContactMethod = cleanText(req.body.preferred_contact_method, 20).toLowerCase() || 'email';
  const details = cleanText(req.body.details, 5000);
  const metadata = {
    ...normalizeJsonObject(req.body.metadata),
    flow: cleanText(req.body.flow || req.body.case_flow || req.body.portal || 'direct', 40) || 'direct',
    serviceType: cleanText(req.body.service_type || req.body.serviceType || req.body.job_type || '', 120) || undefined,
    preferredDate: cleanText(req.body.preferred_date || req.body.preferredDate || '', 40) || undefined,
    preferredTimeWindow: cleanText(req.body.preferred_time_window || req.body.preferredTimeWindow || '', 80) || undefined,
    travelCity: cleanText(req.body.travel_city || req.body.travelCity || '', 120) || undefined,
    urgency: cleanText(req.body.urgency || req.body.request_urgency || '', 40) || undefined,
    photoAttachments: normalizeJsonObject(req.body.metadata).photoAttachments || normalizeJsonObject(req.body.metadata).photos || [],
  };
  const quoteAmountCents = normalizeInteger(req.body.quote_amount_cents ?? req.body.quoteAmountCents);
  const quoteCurrencyCode = cleanText(req.body.quote_currency_code || req.body.quoteCurrencyCode || 'USD', 3).toUpperCase() || 'USD';
  const preferredDate = cleanText(req.body.preferred_date || req.body.preferredDate, 40) || null;
  const preferredTimeWindow = cleanText(req.body.preferred_time_window || req.body.preferredTimeWindow, 80) || null;
  const serviceAddress = cleanText(req.body.service_address || req.body.serviceAddress, 500) || null;
  const serviceCity = cleanText(req.body.service_city || req.body.serviceCity, 120) || null;
  const onSiteContactName = cleanText(req.body.on_site_contact_name || req.body.onSiteContactName, 120) || null;
  const onSiteContactPhone = cleanText(req.body.on_site_contact_phone || req.body.onSiteContactPhone, 40) || null;
  const accessNotes = cleanText(req.body.access_notes || req.body.accessNotes, 5000) || null;
  const scheduledStartAt = normalizeTimestamp(req.body.scheduled_start_at || req.body.scheduledStartAt);
  const scheduledEndAt = normalizeTimestamp(req.body.scheduled_end_at || req.body.scheduledEndAt);
  const paymentStatus = cleanText(req.body.payment_status || req.body.paymentStatus || 'unpaid', 24).toLowerCase() || 'unpaid';
  const paymentMethod = cleanText(req.body.payment_method || req.body.paymentMethod, 40) || null;
  const paymentReference = cleanText(req.body.payment_reference || req.body.paymentReference, 120) || null;
  const proofAttachment = normalizeJsonObject(req.body.proof_attachment || req.body.proofAttachment);
  const proofLink = cleanText(req.body.proof_link || req.body.proofLink, 2048) || null;
  const proofReceivedAt = normalizeTimestamp(req.body.proof_received_at || req.body.proofReceivedAt);
  const acceptedAt = normalizeTimestamp(req.body.accepted_at || req.body.acceptedAt);
  const completedAt = normalizeTimestamp(req.body.completed_at || req.body.completedAt);
  const closedAt = normalizeTimestamp(req.body.closed_at || req.body.closedAt);

  if (!firstName || !lastName || !email || !serviceCategory || !serviceLocation || !details) {
    return res.status(400).json({ error: 'First name, last name, email, service, location, and details are required' });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }

  if (!/^\d{5}$/.test(serviceZipCode)) {
    return res.status(400).json({ error: 'A valid 5-digit ZIP code is required' });
  }

  if (phone && phone.length > 40) {
    return res.status(400).json({ error: 'Phone number is too long' });
  }

  if (!VALID_CONTACT_METHODS.has(preferredContactMethod)) {
    return res.status(400).json({ error: 'Preferred contact method must be email, phone, text, or either' });
  }

  if (paymentStatus && !['unpaid', 'proof_submitted', 'confirmed', 'partially_paid', 'paid', 'disputed', 'refunded', 'cancelled'].includes(paymentStatus)) {
    return res.status(400).json({ error: 'Invalid payment status' });
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const publicReference = generatePublicReference();
    const result = await client.query(
      `INSERT INTO quote_requests
       (user_id, public_reference, first_name, last_name, email, phone, company_name, service_category,
        service_location, service_zip_code, budget_range, timeline, preferred_contact_method, details,
        status, metadata, quote_amount_cents, quote_currency_code, preferred_date,
        preferred_time_window, service_address, service_city, on_site_contact_name,
        on_site_contact_phone, access_notes, scheduled_start_at, scheduled_end_at,
        payment_status, payment_method, payment_reference, proof_attachment,
        proof_link, proof_received_at, accepted_at, completed_at, closed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               'new', $15::jsonb, $16, $17, $18, $19, $20, $21, $22, $23,
               $24, $25, $26, $27::jsonb, $28, $29, $30, $31, $32, $33, $34, $35)
       RETURNING *`,
      [
        req.user?.id || null,
        publicReference,
        firstName,
        lastName,
        email,
        phone || null,
        companyName || null,
        serviceCategory,
        serviceLocation,
        serviceZipCode,
        budgetRange || null,
        timeline || null,
        preferredContactMethod,
        details,
        JSON.stringify(metadata),
        quoteAmountCents,
        quoteCurrencyCode,
        preferredDate,
        preferredTimeWindow,
        serviceAddress,
        serviceCity,
        onSiteContactName,
        onSiteContactPhone,
        accessNotes,
        scheduledStartAt,
        scheduledEndAt,
        paymentStatus,
        paymentMethod,
        paymentReference,
        JSON.stringify(proofAttachment),
        proofLink,
        proofReceivedAt,
        acceptedAt,
        completedAt,
        closedAt,
      ]
    );

    const request = result.rows[0];

    try {
      await notifySupport(request);
    } catch (emailErr) {
      logger.warn('Failed to notify support of quote request', {
        quoteRequestId: request.id,
        error: emailErr.message,
      });
    }

    try {
      await sendConfirmationEmail(request);
    } catch (emailErr) {
      logger.warn('Failed to send quote request confirmation', {
        quoteRequestId: request.id,
        error: emailErr.message,
      });
    }

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      requestId: request.id,
      referenceId: request.public_reference || publicReference,
      message: 'Your quote request has been submitted. We will reach out soon.',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Error submitting quote request', {
      error: err.message,
      userId: req.user?.id || null,
      email,
    });
    return res.status(500).json({ error: 'Failed to submit quote request' });
  } finally {
    client.release();
  }
};

exports.listQuoteRequests = async (req, res) => {
  const { page = 1, limit = 20, status, search } = req.query;
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * Math.max(parseInt(limit, 10) || 20, 1);

  try {
    const where = [];
    const params = [];
    let idx = 1;

    if (status && VALID_STATUSES.has(status)) {
      where.push(`status = $${idx++}`);
      params.push(status);
    }

    if (search) {
      where.push(`(first_name ILIKE $${idx} OR last_name ILIKE $${idx} OR email ILIKE $${idx} OR company_name ILIKE $${idx} OR service_category ILIKE $${idx} OR service_location ILIKE $${idx})`);
      params.push(`%${cleanText(search, 120)}%`);
      idx++;
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countResult = await db.query(`SELECT COUNT(*) AS total FROM quote_requests ${whereClause}`, params);
    const total = Number(countResult.rows[0]?.total || 0);

    params.push(Math.max(parseInt(limit, 10) || 20, 1));
    params.push(Math.max(offset, 0));

    const result = await db.query(
      `SELECT *
       FROM quote_requests
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      params
    );

    return res.json({ requests: result.rows, total, page: Math.max(parseInt(page, 10) || 1, 1), limit: Math.max(parseInt(limit, 10) || 20, 1) });
  } catch (err) {
    logger.error('Error listing quote requests', { error: err.message });
    return res.status(500).json({ error: 'Failed to list quote requests' });
  }
};

exports.getMyQuoteRequests = async (req, res) => {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const result = await db.query(
      `SELECT *
       FROM quote_requests
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.user.id]
    );

    return res.json({ requests: result.rows });
  } catch (err) {
    logger.error('Error fetching user quote requests', { error: err.message, userId: req.user?.id });
    return res.status(500).json({ error: 'Failed to fetch quote requests' });
  }
};

exports.getQuoteRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT * FROM quote_requests WHERE id = $1', [id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Quote request not found' });
    }

    const request = result.rows[0];
    const isOwner = req.user?.id && request.user_id && String(request.user_id) === String(req.user.id);
    const isPrivileged = req.user?.role === 'admin' || req.user?.role === 'super_admin';

    if (!isOwner && !isPrivileged) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    return res.json(request);
  } catch (err) {
    logger.error('Error fetching quote request', { error: err.message, id: req.params.id });
    return res.status(500).json({ error: 'Failed to fetch quote request' });
  }
};

exports.updateQuoteRequestAdmin = async (req, res) => {
  const { id } = req.params;
  const status = cleanText(req.body.status, 32).toLowerCase();
  const adminNotes = cleanText(req.body.admin_notes, 10000);
  const quoteAmountCents = normalizeInteger(req.body.quote_amount_cents ?? req.body.quoteAmountCents);
  const quoteCurrencyCode = cleanText(req.body.quote_currency_code || req.body.quoteCurrencyCode || 'USD', 3).toUpperCase() || 'USD';
  const paymentStatus = cleanText(req.body.payment_status || req.body.paymentStatus || '', 24).toLowerCase();
  const scheduledStartAt = normalizeTimestamp(req.body.scheduled_start_at || req.body.scheduledStartAt);
  const scheduledEndAt = normalizeTimestamp(req.body.scheduled_end_at || req.body.scheduledEndAt);
  const serviceAddress = cleanText(req.body.service_address || req.body.serviceAddress, 500) || null;
  const serviceCity = cleanText(req.body.service_city || req.body.serviceCity, 120) || null;
  const onSiteContactName = cleanText(req.body.on_site_contact_name || req.body.onSiteContactName, 120) || null;
  const onSiteContactPhone = cleanText(req.body.on_site_contact_phone || req.body.onSiteContactPhone, 40) || null;
  const accessNotes = cleanText(req.body.access_notes || req.body.accessNotes, 5000) || null;
  const paymentMethod = cleanText(req.body.payment_method || req.body.paymentMethod, 40) || null;
  const paymentReference = cleanText(req.body.payment_reference || req.body.paymentReference, 120) || null;
  const proofLink = cleanText(req.body.proof_link || req.body.proofLink, 2048) || null;
  const metadata = normalizeJsonObject(req.body.metadata);
  const assignmentProvided = Object.prototype.hasOwnProperty.call(req.body, 'assigned_to')
    || Object.prototype.hasOwnProperty.call(req.body, 'assignedTo');
  const assignedTo = cleanText(req.body.assigned_to || req.body.assignedTo, 64) || null;

  if (!VALID_STATUSES.has(status)) {
    return res.status(400).json({ error: 'A valid status is required' });
  }

  if (scheduledStartAt && scheduledEndAt && new Date(scheduledEndAt).getTime() <= new Date(scheduledStartAt).getTime()) {
    return res.status(400).json({ error: 'Scheduled end must be after scheduled start' });
  }
  if (assignmentProvided && assignedTo && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assignedTo)) {
    return res.status(400).json({ error: 'A valid assignee is required' });
  }

  let auditBefore = null;
  try {
    if (assignmentProvided && assignedTo) {
      const assignee = await db.query(
        `SELECT id
           FROM users
          WHERE id = $1
            AND is_active = TRUE
            AND deleted_at IS NULL
            AND role IN ('helper', 'helper_pro', 'broker', 'admin', 'super_admin')
          LIMIT 1`,
        [assignedTo]
      );
      if (!assignee.rows.length) return res.status(400).json({ error: 'Assignee is not an active dispatch member' });
    }
    if (scheduledStartAt || scheduledEndAt || assignmentProvided) {
      const current = await db.query(
        `SELECT scheduled_start_at, scheduled_end_at, service_city, service_location
           FROM quote_requests
          WHERE id = $1
          LIMIT 1`,
        [id]
      );
      if (!current.rows.length) {
        return res.status(404).json({ error: 'Quote request not found' });
      }
      auditBefore = current.rows[0];
      const effectiveStart = scheduledStartAt || current.rows[0].scheduled_start_at;
      const effectiveEnd = scheduledEndAt || current.rows[0].scheduled_end_at;
      if (effectiveStart && effectiveEnd && new Date(effectiveEnd).getTime() <= new Date(effectiveStart).getTime()) {
        return res.status(400).json({ error: 'Scheduled end must be after scheduled start' });
      }
      if (effectiveStart && effectiveEnd) {
        const block = await db.query(
          `SELECT id, block_type, title, starts_at, ends_at, city
             FROM direct_calendar_blocks
            WHERE block_type IN ('unavailable', 'holiday', 'blackout')
              AND starts_at < $3
              AND ends_at > $2
              AND (city IS NULL OR LOWER(city) = LOWER(COALESCE($4, '')))
            ORDER BY starts_at ASC
            LIMIT 1`,
          [id, effectiveStart, effectiveEnd, current.rows[0].service_city || current.rows[0].service_location || null]
        );
        if (block.rows.length) {
          const item = block.rows[0];
          return res.status(409).json({
            error: `Schedule falls within ${item.block_type} block: ${item.title}`,
            calendarBlock: item,
          });
        }
        const conflict = await db.query(
          `SELECT id, first_name, last_name, scheduled_start_at, scheduled_end_at
             FROM quote_requests
            WHERE id <> $1
              AND COALESCE(metadata->>'flow', 'direct') = 'direct'
              AND status NOT IN ('cancelled', 'closed', 'completed')
              AND scheduled_start_at IS NOT NULL
              AND scheduled_end_at IS NOT NULL
              AND scheduled_start_at < $3
              AND scheduled_end_at > $2
            ORDER BY scheduled_start_at ASC
            LIMIT 1`,
          [id, effectiveStart, effectiveEnd]
        );
        if (conflict.rows.length) {
          const item = conflict.rows[0];
          return res.status(409).json({
            error: `Schedule overlaps request #${item.id} for ${item.first_name || ''} ${item.last_name || ''}`.trim(),
            conflict: item,
          });
        }
      }
    }

    const updateParams = [
      status,
      adminNotes || null,
      quoteAmountCents,
      quoteCurrencyCode,
      paymentStatus || null,
      scheduledStartAt,
      scheduledEndAt,
      serviceAddress,
      serviceCity,
      onSiteContactName,
      onSiteContactPhone,
      accessNotes,
      paymentMethod,
      paymentReference,
      proofLink,
      JSON.stringify(metadata),
    ];
    const assignmentClause = assignmentProvided
      ? `assigned_to = $17::uuid,
           assigned_at = CASE
             WHEN $17::uuid IS NULL THEN NULL
             WHEN assigned_to IS DISTINCT FROM $17::uuid THEN NOW()
             ELSE assigned_at
           END,`
      : '';
    if (assignmentProvided) updateParams.push(assignedTo);
    const idParam = updateParams.length + 1;
    updateParams.push(id);

    const result = await db.query(
      `UPDATE quote_requests
       SET status = $1,
           admin_notes = $2,
           quote_amount_cents = COALESCE($3, quote_amount_cents),
           quote_currency_code = COALESCE($4, quote_currency_code),
           payment_status = COALESCE(NULLIF($5, ''), payment_status),
           scheduled_start_at = COALESCE($6, scheduled_start_at),
           scheduled_end_at = COALESCE($7, scheduled_end_at),
           service_address = COALESCE($8, service_address),
           service_city = COALESCE($9, service_city),
           on_site_contact_name = COALESCE($10, on_site_contact_name),
           on_site_contact_phone = COALESCE($11, on_site_contact_phone),
           access_notes = COALESCE($12, access_notes),
           payment_method = COALESCE($13, payment_method),
           payment_reference = COALESCE($14, payment_reference),
           proof_link = COALESCE($15, proof_link),
           metadata = COALESCE(metadata, '{}'::jsonb) || $16::jsonb,
           ${assignmentClause}
           updated_at = NOW()
       WHERE id = $${idParam}
       RETURNING *`,
      updateParams
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Quote request not found' });
    }

    if (auditBefore) {
      await recordDirectCalendarAudit({
        requestId: id,
        action: assignmentProvided && (scheduledStartAt || scheduledEndAt) ? 'request_rescheduled_and_assigned'
          : assignmentProvided ? 'request_assignment_changed' : 'request_rescheduled',
        actorId: req.user?.id,
        beforeData: auditBefore,
        afterData: result.rows[0],
      });
    }

    return res.json({ request: result.rows[0] });
  } catch (err) {
    logger.error('Error updating quote request', {
      error: err.message,
      id,
      adminId: req.user?.id,
    });
    return res.status(500).json({ error: 'Failed to update quote request' });
  }
};
