const db = require('../db');
const logger = require('../utils/logger');
const { sendEmail } = require('../utils/email');
const escapeHtml = require('../utils/escapeHtml');
const { renderOxSteedEmail } = require('../utils/emailTemplate');
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

const VALID_PAYMENT_STATUSES = new Set([
  'unpaid',
  'proof_submitted',
  'confirmed',
  'partially_paid',
  'paid',
  'disputed',
  'refunded',
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

const CATALOG_SERVICE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CATALOG_SERVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeCatalogServiceSlug(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function catalogServiceSlugError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function normalizeCatalogServiceIds(value) {
  if (value === undefined || value === null || value === '') return [];
  const values = Array.isArray(value) ? value : [value];
  if (values.length > 25) throw catalogServiceSlugError('Too many catalog services selected');
  const ids = [];
  for (const item of values) {
    const id = typeof item === 'object' && item !== null ? item.id : item;
    if (typeof id !== 'string' || !CATALOG_SERVICE_ID_PATTERN.test(id.trim())) {
      throw catalogServiceSlugError('Selected catalog service is invalid');
    }
    const normalized = id.trim().toLowerCase();
    if (!ids.includes(normalized)) ids.push(normalized);
  }
  return ids;
}

function normalizeInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return null;
  // Security (audit finding #3): money fields must never go negative.
  if (parsed < 0) {
    throw Object.assign(new Error('Integer value must not be negative'), { statusCode: 400 });
  }
  return parsed;
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
  const catalogServiceNames = (Array.isArray(request.metadata?.catalogServices) ? request.metadata.catalogServices : [])
    .map((service) => cleanText(service?.name, 120))
    .filter(Boolean);
  const catalogServiceSummary = catalogServiceNames.length ? catalogServiceNames.join(', ') : '-';
  const details = [
    ['Name', `${request.first_name} ${request.last_name}`],
    ['Email', request.email],
    ['Phone', request.phone || '-'],
    ['Company', request.company_name || '-'],
    ['Service', request.service_category],
    ['Catalog services', catalogServiceSummary],
    ['Location', request.service_location],
    ['Budget', request.budget_range || '-'],
    ['Timeline', request.timeline || '-'],
    ['Contact preference', request.preferred_contact_method],
  ];
  const rendered = renderOxSteedEmail({
    language: request.metadata?.language || 'en',
    preheader: 'New OxSteed quote request',
    eyebrow: 'QUOTE REQUEST',
    title: 'New quote request',
    bodyHtml: `<p style="margin:0 0 16px;color:#334155;font-size:16px;line-height:1.65;">A customer submitted a new request for review.</p><h2 style="margin:22px 0 10px;color:#0f172a;font-size:17px;">Details</h2><p style="margin:0;color:#334155;font-size:15px;line-height:1.6;">${escapeHtml(request.details || '-').replace(/\n/g, '<br>')}</p>`,
    bodyText: `A customer submitted a new request for review.\n\nDetails:\n${request.details || '-'}`,
    details: details.map(([label, value]) => ({ label, value })),
    cta: { label: 'Open quote requests', url: '/dashboard' },
    footerText: 'This notification was sent to the OxSteed support team.',
  });
  await sendEmail({
    to: supportEmail,
    subject: `New OxSteed quote request from ${request.first_name} ${request.last_name}`,
    html: rendered.html,
    text: rendered.text,
    idempotencyKey: `quote-request:support:${request.id}`,
  });
}

async function sendConfirmationEmail(request) {
  const catalogServiceNames = (Array.isArray(request.metadata?.catalogServices) ? request.metadata.catalogServices : [])
    .map((service) => cleanText(service?.name, 120))
    .filter(Boolean);
  const catalogServiceSummary = catalogServiceNames.length ? catalogServiceNames.join(', ') : null;
  const rendered = renderOxSteedEmail({
    language: request.metadata?.language || 'en',
    preheader: 'We received your OxSteed quote request',
    eyebrow: 'QUOTE REQUEST RECEIVED',
    title: 'Thanks for reaching out to OxSteed',
    bodyHtml: `<p style="margin:0 0 16px;color:#334155;font-size:16px;line-height:1.65;">We received your quote request for <strong>${escapeHtml(request.service_category)}</strong>. Our team will review it and follow up soon.</p>`,
    bodyText: `We received your quote request for ${request.service_category}. Our team will review it and follow up soon.`,
    details: [
      { label: 'Catalog services', value: catalogServiceSummary || '-' },
      { label: 'Location', value: request.service_location },
      { label: 'ZIP code', value: request.service_zip_code || '-' },
      { label: 'Budget', value: request.budget_range || '-' },
      { label: 'Timeline', value: request.timeline || '-' },
      { label: 'Reference ID', value: request.public_reference || request.id },
    ],
    cta: { label: 'View OxSteed', url: '/dashboard' },
  });
  await sendEmail({
    to: request.email,
    subject: 'We received your OxSteed quote request',
    html: rendered.html,
    text: rendered.text,
    idempotencyKey: `quote-request:confirmation:${request.id}`,
  });
}

// Audit finding #17: notify the customer when an admin sets or updates the
// quoted amount. Fire-and-forget; email failures are logged, never fatal.
async function notifyCustomerOfQuote(request) {
  if (!request?.email || request.quote_amount_cents === null || request.quote_amount_cents === undefined) return;
  const amount = `${(Number(request.quote_amount_cents) / 100).toFixed(2)} ${request.quote_currency_code || 'USD'}`;
  try {
    const rendered = renderOxSteedEmail({
      language: request.metadata?.language || 'en',
      preheader: `Your OxSteed quote is ready: ${amount}`,
      eyebrow: 'QUOTE READY',
      title: 'Your quote is ready',
      bodyHtml: `<p style="margin:0 0 16px;color:#334155;font-size:16px;line-height:1.65;">Our team has prepared a quote for your request. The quoted amount is <strong>${escapeHtml(amount)}</strong>.</p>`,
      bodyText: `Our team has prepared a quote for your request. The quoted amount is ${amount}.`,
      details: [
        { label: 'Quoted amount', value: amount },
        { label: 'Service', value: request.service_category || '-' },
        { label: 'Reference ID', value: request.public_reference || request.id },
      ],
      footerText: 'You are receiving this message because you have an OxSteed Direct request.',
    });
    await sendEmail({
      to: request.email,
      subject: `Your OxSteed quote is ready: ${amount}`,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: `quote-request:quoted:${request.id}:${request.quote_amount_cents}`,
    });
  } catch (emailErr) {
    logger.warn('Quote-ready email notification failed', { requestId: request.id, error: emailErr.message });
  }
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
  const inputMetadata = normalizeJsonObject(req.body.metadata);
  const rawCatalogServiceIds = inputMetadata.serviceIds ?? inputMetadata.catalogServiceIds ?? inputMetadata.service_ids;
  let catalogServiceIds;
  try {
    catalogServiceIds = normalizeCatalogServiceIds(rawCatalogServiceIds);
    if (!catalogServiceIds.length && inputMetadata.serviceId !== undefined) {
      catalogServiceIds = normalizeCatalogServiceIds(inputMetadata.serviceId);
    }
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message });
  }
  const rawCatalogServiceSlug = inputMetadata.serviceSlug !== undefined
    ? inputMetadata.serviceSlug
    : inputMetadata.service_slug;
  const catalogServiceSlug = normalizeCatalogServiceSlug(rawCatalogServiceSlug);
  const hasCatalogServiceSlug = typeof rawCatalogServiceSlug === 'string'
    ? rawCatalogServiceSlug.trim().length > 0
    : rawCatalogServiceSlug !== undefined && rawCatalogServiceSlug !== null;
  if (hasCatalogServiceSlug && (catalogServiceSlug.length > 140 || !CATALOG_SERVICE_SLUG_PATTERN.test(catalogServiceSlug))) {
    return res.status(400).json({ error: 'Selected catalog service is invalid' });
  }
  const rawPhotoAttachments = inputMetadata.photoAttachments ?? inputMetadata.photos ?? [];
  const photoAttachmentList = Array.isArray(rawPhotoAttachments) ? rawPhotoAttachments : [];
  // Security (audit finding #53): cap unbounded metadata.photoAttachments on public creation.
  if (photoAttachmentList.length > 10) {
    return res.status(400).json({ error: 'Too many photo attachments (maximum 10)' });
  }
  const rawClientRequestId = req.body.client_request_id ?? req.body.clientRequestId;
  let clientRequestId = null;
  if (rawClientRequestId !== undefined && rawClientRequestId !== null && rawClientRequestId !== '') {
    // Security (audit finding #27): optional client idempotency key, validated server-side.
    if (typeof rawClientRequestId !== 'string') {
      return res.status(400).json({ error: 'Invalid client request id' });
    }
    const trimmedClientRequestId = rawClientRequestId.trim();
    if (!trimmedClientRequestId || trimmedClientRequestId.length > 64) {
      return res.status(400).json({ error: 'Invalid client request id' });
    }
    clientRequestId = trimmedClientRequestId;
  }
  const metadata = {
    ...inputMetadata,
    flow: cleanText(req.body.flow || req.body.case_flow || req.body.portal || 'direct', 40) || 'direct',
    serviceType: cleanText(req.body.service_type || req.body.serviceType || req.body.job_type || '', 120) || undefined,
    preferredDate: cleanText(req.body.preferred_date || req.body.preferredDate || '', 40) || undefined,
    preferredTimeWindow: cleanText(req.body.preferred_time_window || req.body.preferredTimeWindow || '', 80) || undefined,
    travelCity: cleanText(req.body.travel_city || req.body.travelCity || '', 120) || undefined,
    urgency: cleanText(req.body.urgency || req.body.request_urgency || '', 40) || undefined,
    photoAttachments: photoAttachmentList,
  };
  if (catalogServiceSlug) metadata.serviceSlug = catalogServiceSlug;
  delete metadata.service_slug;
  delete metadata.clientRequestId;
  // Security (audit finding #3): public submissions must never set money,
  // status, or lifecycle timestamps. The server forces safe defaults and
  // ignores any caller-supplied values for these fields.
  const quoteAmountCents = null;
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
  const paymentStatus = 'unpaid'; // forced server-side (audit finding #3)
  const paymentMethod = cleanText(req.body.payment_method || req.body.paymentMethod, 40) || null;
  const paymentReference = cleanText(req.body.payment_reference || req.body.paymentReference, 120) || null;
  const proofAttachment = normalizeJsonObject(req.body.proof_attachment || req.body.proofAttachment);
  const proofLink = cleanText(req.body.proof_link || req.body.proofLink, 2048) || null;
  const proofReceivedAt = null; // forced server-side (audit finding #3)
  const acceptedAt = null; // forced server-side (audit finding #3)
  const completedAt = null; // forced server-side (audit finding #3)
  const closedAt = null; // forced server-side (audit finding #3)

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

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // Security (audit finding #27): retried public submissions that carry the
    // same client_request_id within the last 10 minutes return the existing
    // row instead of inserting a duplicate. The key is stored on the row's
    // metadata (no suitable column exists on quote_requests and migrations are
    // owned by another worker).
    if (clientRequestId) {
      const duplicate = await client.query(
        `SELECT id, public_reference
           FROM quote_requests
          WHERE metadata->>'clientRequestId' = $1
            AND created_at > NOW() - INTERVAL '10 minutes'
          ORDER BY created_at DESC
          LIMIT 1`,
        [clientRequestId]
      );
      if (duplicate.rows.length) {
        await client.query('COMMIT');
        return res.status(200).json({
          success: true,
          duplicate: true,
          requestId: duplicate.rows[0].id,
          referenceId: duplicate.rows[0].public_reference,
          message: 'Your quote request has already been submitted.',
        });
      }
    }

    let catalogServices = [];
    if (catalogServiceIds.length) {
      const catalogResult = await client.query(
        `SELECT s.id, s.slug, s.name_i18n->>'en' AS service_name, c.slug AS category_slug
           FROM direct_catalog_services s
           JOIN direct_catalog_categories c ON c.id = s.category_id
          WHERE s.id = ANY($1::uuid[])
            AND s.is_active = TRUE
            AND s.is_published = TRUE
            AND s.lifecycle_status = 'live'
            AND s.is_operationally_available = TRUE
            AND c.is_active = TRUE
            AND c.is_published = TRUE
            AND c.lifecycle_status = 'live'`,
        [catalogServiceIds]
      );
      if (catalogResult.rows.length !== catalogServiceIds.length) {
        throw catalogServiceSlugError('Selected catalog service is not currently requestable');
      }
      const rowsById = new Map(catalogResult.rows.map((row) => [String(row.id).toLowerCase(), row]));
      catalogServices = catalogServiceIds.map((id) => rowsById.get(id));
      if (catalogServiceSlug && !catalogServices.some((service) => service.slug === catalogServiceSlug)) {
        throw catalogServiceSlugError('Selected catalog service is invalid');
      }
    } else if (catalogServiceSlug) {
      const catalogResult = await client.query(
        `SELECT s.slug, s.name_i18n->>'en' AS service_name
                , s.id, c.slug AS category_slug
           FROM direct_catalog_services s
           JOIN direct_catalog_categories c ON c.id = s.category_id
          WHERE s.slug = $1
            AND s.is_active = TRUE
            AND s.is_published = TRUE
            AND s.lifecycle_status = 'live'
            AND s.is_operationally_available = TRUE
            AND c.is_active = TRUE
            AND c.is_published = TRUE
            AND c.lifecycle_status = 'live'
          LIMIT 1`,
        [catalogServiceSlug]
      );
      const catalogService = catalogResult.rows[0];
      if (!catalogService) {
        throw catalogServiceSlugError('Selected catalog service is not currently requestable');
      }
      catalogServices = [catalogService];
    }
    if (catalogServices.length) {
      const canonicalServices = catalogServices.map((service) => ({
        id: String(service.id),
        slug: service.slug,
        name: cleanText(service.service_name, 120),
        categorySlug: service.category_slug,
      }));
      catalogServiceIds = canonicalServices.map((service) => service.id.toLowerCase());
      metadata.serviceIds = catalogServiceIds;
      metadata.catalogServiceIds = catalogServiceIds;
      metadata.catalogServices = canonicalServices;
      metadata.serviceId = canonicalServices[0].id;
      metadata.serviceSlug = canonicalServices[0].slug;
      metadata.serviceName = canonicalServices[0].name || metadata.serviceName;
    }

    const publicReference = generatePublicReference();
    if (clientRequestId) {
      metadata.clientRequestId = clientRequestId;
    }
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
               $24, $25, $26, $27, $28, $29, $30::jsonb, $31, $32, $33, $34, $35)
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

    if (catalogServices.length) {
      await client.query(
        `INSERT INTO quote_request_services (quote_request_id, service_id, service_name, category_slug)
         SELECT $1, item.id::uuid, item.name, item.category_slug
           FROM jsonb_to_recordset($2::jsonb) AS item(id text, name text, category_slug text)
         ON CONFLICT (quote_request_id, service_id) DO NOTHING`,
        [request.id, JSON.stringify(catalogServices.map((service) => ({
          id: String(service.id),
          name: cleanText(service.service_name, 120),
          category_slug: service.category_slug,
        })))]
      );
    }

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
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
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
  // Security (audit finding #3): negative amounts are rejected server-side.
  let quoteAmountCents;
  try {
    quoteAmountCents = normalizeInteger(req.body.quote_amount_cents ?? req.body.quoteAmountCents);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message });
  }
  // T12-F02: an omitted currency must stay NULL so COALESCE preserves the
  // stored value. Only an explicitly supplied currency is written, after
  // 3-letter validation.
  const quoteCurrencyProvided = req.body.quote_currency_code !== undefined
    || req.body.quoteCurrencyCode !== undefined;
  let quoteCurrencyCode = null;
  if (quoteCurrencyProvided) {
    const raw = req.body.quote_currency_code ?? req.body.quoteCurrencyCode;
    const code = String(raw === null ? '' : raw).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      return res.status(400).json({ error: 'Invalid currency code' });
    }
    quoteCurrencyCode = code;
  }
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

  // Security (audit finding #16): payment_status must come from the canonical
  // list enforced by the quote_requests_payment_status_check CHECK constraint.
  if (paymentStatus && !VALID_PAYMENT_STATUSES.has(paymentStatus)) {
    return res.status(400).json({ error: 'Invalid payment status' });
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
        `SELECT scheduled_start_at, scheduled_end_at, service_city, service_location, assigned_to
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
      const effectiveAssignee = assignmentProvided ? assignedTo : current.rows[0].assigned_to;
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
          `SELECT id, first_name, last_name, scheduled_start_at, scheduled_end_at, assigned_to
             FROM quote_requests
            WHERE id <> $1
              AND COALESCE(metadata->>'flow', 'direct') = 'direct'
              AND status NOT IN ('cancelled', 'closed', 'completed')
              AND assigned_to IS NOT DISTINCT FROM $4::uuid
              AND scheduled_start_at IS NOT NULL
              AND scheduled_end_at IS NOT NULL
              AND scheduled_start_at < $3
              AND scheduled_end_at > $2
            ORDER BY scheduled_start_at ASC
            LIMIT 1`,
          [id, effectiveStart, effectiveEnd, effectiveAssignee]
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

    // Security (audit finding #26): payment/amount transition guards. The
    // COALESCE-based update above must not silently allow money/status
    // regressions, so the current row is checked before any change.
    if (paymentStatus || quoteAmountCents !== null) {
      const currentPayment = await db.query(
        `SELECT payment_status, quote_amount_cents
           FROM quote_requests
          WHERE id = $1
          LIMIT 1`,
        [id]
      );
      if (!currentPayment.rows.length) {
        return res.status(404).json({ error: 'Quote request not found' });
      }
      const currentPaymentStatus = currentPayment.rows[0].payment_status || 'unpaid';
      const effectivePaymentStatus = paymentStatus || currentPaymentStatus;
      if (paymentStatus && currentPaymentStatus === 'paid' && paymentStatus === 'unpaid') {
        return res.status(400).json({
          error: 'A paid request cannot be moved back to unpaid',
          code: 'invalid_payment_transition',
        });
      }
      if (paymentStatus && currentPaymentStatus === 'cancelled' && paymentStatus === 'paid') {
        return res.status(400).json({
          error: 'A cancelled payment cannot be marked paid',
          code: 'invalid_payment_transition',
        });
      }
      const currentAmount = currentPayment.rows[0].quote_amount_cents === null
        ? null
        : Number(currentPayment.rows[0].quote_amount_cents);
      if (quoteAmountCents !== null && effectivePaymentStatus === 'confirmed' && quoteAmountCents !== currentAmount) {
        return res.status(400).json({
          error: 'The quote amount cannot change after payment is confirmed',
          code: 'invalid_amount_transition',
        });
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

    // Audit finding #17: the admin quote action lives here (PATCH
    // /admin/requests/:id). Notify the customer when the admin set or updated
    // the quoted amount in this call. Fire-and-forget.
    if (quoteAmountCents !== null) {
      notifyCustomerOfQuote(result.rows[0]).catch(() => {});
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
    if (err.code === '23P01' && err.message === 'Direct schedule overlaps an existing booking') {
      return res.status(409).json({ error: 'This assignee already has an overlapping booking.' });
    }
    logger.error('Error updating quote request', {
      error: err.message,
      id,
      adminId: req.user?.id,
    });
    return res.status(500).json({ error: 'Failed to update quote request' });
  }
};
