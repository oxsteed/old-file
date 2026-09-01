'use strict';

const db = require('../db');
const logger = require('../utils/logger');
const { sendEmail } = require('../utils/email');
const { uploadFile, getSignedDownloadUrl } = require('../utils/storage');

const DEFAULT_PROFILE = {
  id: '1',
  companyName: 'OxSteed',
  headline: 'Food, tools, and local service work under one company.',
  minimumPriceCents: 10000,
  availabilityText: 'Monday through Thursday',
  baseCity: 'Springfield, OH',
  publicNote: 'Company-run service portal for customers who want a direct quote, a scheduled visit, and in-app proof/history.',
  serviceAreas: ['Springfield', 'Dayton', 'Columbus', 'Beavercreek', 'Fairborn', 'Urbana'],
  tools: [
    'Truck and hauling gear',
    'Power drill and bit set',
    'Ladders and step stools',
    'Pressure washer',
    'Hand tools and repair kit',
    'Measuring and layout tools',
    'Cleanup and janitorial supplies',
    'Phone and photo inspection kit',
  ],
  travelDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'],
  travelCities: ['Springfield', 'Dayton', 'Columbus', 'Beavercreek', 'Fairborn', 'Urbana'],
  supportEmail: 'support@oxsteed.com',
  supportPhone: null,
};

const VALID_MESSAGE_ROLES = new Set(['customer', 'admin', 'staff', 'system']);

function cleanText(value, maxLen = 255) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function normalizeObject(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return normalizeObject(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function normalizeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => cleanText(String(item), 255)).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return normalizeArray(parsed);
    } catch {
      return value.split(',').map((item) => cleanText(item, 255)).filter(Boolean);
    }
  }
  return [];
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

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function isAdmin(user) {
  return user?.role === 'admin' || user?.role === 'super_admin';
}

function actorRoleFromUser(user) {
  if (isAdmin(user)) return user.role;
  return 'customer';
}

function attachmentFromJson(value) {
  const attachment = normalizeObject(value);
  const key = cleanText(attachment.key || '', 500);
  const url = cleanText(attachment.url || attachment.href || '', 2048);
  if (!key && !url) return null;
  return {
    key: key || null,
    url: url || null,
    name: cleanText(attachment.name || attachment.filename || '', 255) || null,
    type: cleanText(attachment.type || attachment.contentType || attachment.mimeType || '', 120) || null,
    sizeBytes: Number.isFinite(Number(attachment.sizeBytes ?? attachment.size_bytes ?? attachment.size)) ? Number(attachment.sizeBytes ?? attachment.size_bytes ?? attachment.size) : null,
  };
}

function attachmentListFromJson(value) {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : normalizeArray(value);
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => attachmentFromJson(item)).filter(Boolean);
}

async function signAttachment(attachment) {
  if (!attachment?.key) return attachment;
  const signedUrl = await getSignedDownloadUrl(attachment.key, 900);
  return {
    ...attachment,
    url: signedUrl || attachment.url || '',
  };
}

async function signAttachmentList(list) {
  const signed = [];
  for (const attachment of attachmentListFromJson(list)) {
    signed.push(await signAttachment(attachment));
  }
  return signed;
}

function serializeProfile(row) {
  if (!row) return { ...DEFAULT_PROFILE };
  return {
    id: String(row.id),
    companyName: row.company_name || DEFAULT_PROFILE.companyName,
    headline: row.headline || DEFAULT_PROFILE.headline,
    minimumPriceCents: Number(row.minimum_price_cents ?? DEFAULT_PROFILE.minimumPriceCents),
    availabilityText: row.availability_text || DEFAULT_PROFILE.availabilityText,
    baseCity: row.base_city || DEFAULT_PROFILE.baseCity,
    publicNote: row.public_note || DEFAULT_PROFILE.publicNote,
    serviceAreas: normalizeArray(row.service_areas),
    tools: normalizeArray(row.tools),
    travelDays: normalizeArray(row.travel_days),
    travelCities: normalizeArray(row.travel_cities),
    supportEmail: row.support_email || DEFAULT_PROFILE.supportEmail,
    supportPhone: row.support_phone || DEFAULT_PROFILE.supportPhone,
  };
}

function quoteTitle(row) {
  return row.service_category || row.metadata?.serviceType || row.metadata?.service_type || row.company_name || 'OxSteed Direct request';
}

function caseStatusLabel(status) {
  const key = String(status || 'new').toLowerCase();
  const labels = {
    new: 'Requested',
    reviewing: 'Reviewing',
    quoted: 'Quoted',
    contacted: 'Contacted',
    accepted: 'Accepted',
    scheduled: 'Scheduled',
    en_route: 'En route',
    started: 'Started',
    waiting_customer: 'Waiting on customer',
    completed: 'Completed',
    closed: 'Closed',
    cancelled: 'Cancelled',
  };
  return labels[key] || key;
}

async function presentRequest(row, { includeMessages = false, includeEvents = false } = {}) {
  if (!row) return null;
  const metadata = normalizeObject(row.metadata);
  const proofAttachment = await signAttachment(attachmentFromJson(row.proof_attachment || metadata.proofAttachment || metadata.proof_attachment));
  const photoAttachments = await signAttachmentList(metadata.photoAttachments || metadata.photo_attachments || []);
  const result = {
    id: String(row.id),
    userId: row.user_id ? String(row.user_id) : null,
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    email: row.email || '',
    phone: row.phone || '',
    companyName: row.company_name || '',
    serviceCategory: row.service_category || '',
    serviceLocation: row.service_location || '',
    budgetRange: row.budget_range || '',
    timeline: row.timeline || '',
    preferredContactMethod: row.preferred_contact_method || 'email',
    details: row.details || '',
    status: row.status || 'new',
    statusLabel: caseStatusLabel(row.status),
    adminNotes: row.admin_notes || '',
    quoteAmountCents: row.quote_amount_cents === null || row.quote_amount_cents === undefined ? null : Number(row.quote_amount_cents),
    quoteCurrencyCode: row.quote_currency_code || 'USD',
    preferredDate: row.preferred_date || metadata.preferredDate || metadata.preferred_date || null,
    preferredTimeWindow: row.preferred_time_window || metadata.preferredTimeWindow || metadata.preferred_time_window || null,
    serviceAddress: row.service_address || metadata.serviceAddress || metadata.service_address || null,
    serviceCity: row.service_city || metadata.serviceCity || metadata.service_city || null,
    onSiteContactName: row.on_site_contact_name || metadata.onSiteContactName || metadata.on_site_contact_name || null,
    onSiteContactPhone: row.on_site_contact_phone || metadata.onSiteContactPhone || metadata.on_site_contact_phone || null,
    accessNotes: row.access_notes || metadata.accessNotes || metadata.access_notes || null,
    scheduledStartAt: row.scheduled_start_at || metadata.scheduledStartAt || metadata.scheduled_start_at || null,
    scheduledEndAt: row.scheduled_end_at || metadata.scheduledEndAt || metadata.scheduled_end_at || null,
    paymentStatus: row.payment_status || 'unpaid',
    paymentMethod: row.payment_method || metadata.paymentMethod || metadata.payment_method || null,
    paymentReference: row.payment_reference || metadata.paymentReference || metadata.payment_reference || null,
    proofAttachment,
    proofLink: row.proof_link || metadata.proofLink || metadata.proof_link || proofAttachment?.url || null,
    proofReceivedAt: row.proof_received_at || metadata.proofReceivedAt || metadata.proof_received_at || null,
    acceptedAt: row.accepted_at || metadata.acceptedAt || metadata.accepted_at || null,
    completedAt: row.completed_at || metadata.completedAt || metadata.completed_at || null,
    closedAt: row.closed_at || metadata.closedAt || metadata.closed_at || null,
    metadata,
    photoAttachments,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };

  if (includeMessages) {
    const { rows: messages } = await db.query(
      `SELECT id, quote_request_id, sender_user_id, sender_role, message, created_at
         FROM direct_request_messages
        WHERE quote_request_id = $1
        ORDER BY created_at ASC`,
      [row.id]
    );
    result.messages = messages.map((message) => ({
      id: String(message.id),
      quoteRequestId: String(message.quote_request_id),
      senderUserId: message.sender_user_id ? String(message.sender_user_id) : null,
      senderRole: message.sender_role,
      message: message.message,
      createdAt: message.created_at,
    }));
  }

  if (includeEvents) {
    const { rows: events } = await db.query(
      `SELECT id, quote_request_id, actor_user_id, actor_role, event_type, title, details, payload, created_at
         FROM direct_request_events
        WHERE quote_request_id = $1
        ORDER BY created_at ASC`,
      [row.id]
    );
    result.events = events.map((event) => ({
      id: String(event.id),
      quoteRequestId: String(event.quote_request_id),
      actorUserId: event.actor_user_id ? String(event.actor_user_id) : null,
      actorRole: event.actor_role,
      eventType: event.event_type,
      title: event.title,
      details: event.details || '',
      payload: normalizeObject(event.payload),
      createdAt: event.created_at,
    }));
  }

  return result;
}

async function appendEvent({ quoteRequestId, actorUserId = null, actorRole = 'system', eventType, title, details = '', payload = {} }) {
  await db.query(
    `INSERT INTO direct_request_events
       (quote_request_id, actor_user_id, actor_role, event_type, title, details, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [quoteRequestId, actorUserId, actorRole, eventType, title, details || null, JSON.stringify(payload || {})]
  );
}

async function loadRequestOr404(id) {
  const result = await db.query('SELECT * FROM quote_requests WHERE id = $1', [id]);
  return result.rows[0] || null;
}

function canAccessRequest(request, user) {
  if (!request) return false;
  if (isAdmin(user)) return true;
  return user?.id && request.user_id && String(user.id) === String(request.user_id);
}

async function loadProfileRow() {
  const { rows } = await db.query('SELECT * FROM direct_service_profiles WHERE id = 1 LIMIT 1');
  return rows[0] || null;
}

async function sendSupportEmail(subject, html) {
  const supportEmail = process.env.SUPPORT_EMAIL || 'support@oxsteed.com';
  await sendEmail({ to: supportEmail, subject, html });
}

async function sendRequestConfirmationEmail(request) {
  await sendEmail({
    to: request.email,
    subject: 'We received your OxSteed Direct request',
    html: `
      <h2>Thanks for choosing OxSteed Direct</h2>
      <p>We received your request for <strong>${request.serviceCategory}</strong>.</p>
      <p><strong>Reference:</strong> ${request.id}</p>
      <p><strong>Location:</strong> ${request.serviceLocation}</p>
      <p><strong>Budget:</strong> ${request.budgetRange || '-'}</p>
      <p><strong>Timeline:</strong> ${request.timeline || '-'}</p>
      <p>We’ll review it and follow up with the next step.</p>
    `,
  });
}

exports.getProfile = async (_req, res) => {
  try {
    const profile = await loadProfileRow();
    return res.json({ profile: serializeProfile(profile) });
  } catch (err) {
    logger.error('getProfile error', { error: err.message });
    return res.status(500).json({ error: 'Failed to load Direct profile' });
  }
};

exports.uploadDirectAsset = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'A file is required' });
    }

    const purpose = cleanText(req.body.purpose || req.query.purpose || 'quote', 40) || 'quote';
    const draftId = cleanText(req.body.draftId || req.query.draftId || req.body.draft_id || req.query.draft_id || 'public', 120) || 'public';
    const requestId = cleanText(req.body.requestId || req.query.requestId || req.body.request_id || req.query.request_id || '', 120);
    const folder = requestId
      ? `direct-request-assets/${requestId}/${purpose}`
      : `direct-draft-assets/${draftId}/${purpose}`;

    const key = await uploadFile(
      req.file.buffer,
      folder,
      req.file.originalname || `${purpose}-${Date.now()}`,
      req.file.mimetype
    );

    if (!key) {
      return res.status(503).json({ error: 'Secure file storage is not configured' });
    }

    const signedUrl = await getSignedDownloadUrl(key, 900);

    return res.status(201).json({
      attachment: {
        key,
        url: signedUrl || '',
        name: req.file.originalname || null,
        type: req.file.mimetype || null,
        sizeBytes: req.file.size || null,
        purpose,
        draftId: requestId ? null : draftId,
        requestId: requestId || null,
      },
    });
  } catch (err) {
    logger.error('uploadDirectAsset error', { error: err.message });
    return res.status(500).json({ error: 'Failed to upload file' });
  }
};

exports.getHistory = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT qr.*
         FROM quote_requests qr
        WHERE qr.user_id = $1
          AND COALESCE(qr.metadata->>'flow', 'direct') = 'direct'
        ORDER BY qr.created_at DESC
        LIMIT 100`,
      [req.user.id]
    );

    const requests = [];
    for (const row of rows) {
      const request = await presentRequest(row, { includeMessages: false, includeEvents: false });
      const { rows: counts } = await db.query(
        `SELECT
           COUNT(*)::int AS message_count,
           MAX(created_at) AS last_message_at
         FROM direct_request_messages
         WHERE quote_request_id = $1`,
        [row.id]
      );
      requests.push({
        ...request,
        messageCount: counts[0]?.message_count || 0,
        lastMessageAt: counts[0]?.last_message_at || request.updatedAt || request.createdAt,
      });
    }

    return res.json({ requests });
  } catch (err) {
    logger.error('getHistory error', { error: err.message, userId: req.user?.id });
    return res.status(500).json({ error: 'Failed to load Direct history' });
  }
};

exports.getAccount = async (req, res) => {
  try {
    const profile = await loadProfileRow();
    const { rows: locations } = await db.query(
      `SELECT *
         FROM direct_customer_locations
        WHERE user_id = $1
        ORDER BY is_default DESC, created_at DESC`,
      [req.user.id]
    );

    return res.json({
      profile: serializeProfile(profile),
      locations: locations.map((location) => ({
        id: String(location.id),
        label: location.label,
        addressLine1: location.address_line1,
        addressLine2: location.address_line2 || '',
        city: location.city,
        region: location.region || '',
        postalCode: location.postal_code || '',
        countryCode: location.country_code || 'US',
        notes: location.notes || '',
        isDefault: !!location.is_default,
        createdAt: location.created_at,
        updatedAt: location.updated_at,
      })),
    });
  } catch (err) {
    logger.error('getAccount error', { error: err.message, userId: req.user?.id });
    return res.status(500).json({ error: 'Failed to load account data' });
  }
};

exports.saveLocation = async (req, res) => {
  const label = cleanText(req.body.label, 120);
  const addressLine1 = cleanText(req.body.address_line1 || req.body.addressLine1, 500);
  const addressLine2 = cleanText(req.body.address_line2 || req.body.addressLine2, 500);
  const city = cleanText(req.body.city, 120);
  const region = cleanText(req.body.region, 120);
  const postalCode = cleanText(req.body.postal_code || req.body.postalCode, 20);
  const countryCode = cleanText(req.body.country_code || req.body.countryCode || 'US', 2).toUpperCase() || 'US';
  const notes = cleanText(req.body.notes, 2000);
  const isDefault = req.body.is_default === true || req.body.isDefault === true || req.body.is_default === 'true' || req.body.isDefault === 'true';
  const locationId = normalizeInteger(req.params.locationId || req.body.locationId || req.body.location_id);

  if (!label || !addressLine1 || !city) {
    return res.status(400).json({ error: 'Label, address, and city are required' });
  }

  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      if (isDefault) {
        await client.query(
          'UPDATE direct_customer_locations SET is_default = FALSE, updated_at = NOW() WHERE user_id = $1',
          [req.user.id]
        );
      }

      let saved;
      if (locationId) {
        const result = await client.query(
          `UPDATE direct_customer_locations
              SET label = $1,
                  address_line1 = $2,
                  address_line2 = $3,
                  city = $4,
                  region = $5,
                  postal_code = $6,
                  country_code = $7,
                  notes = $8,
                  is_default = $9,
                  updated_at = NOW()
            WHERE id = $10
              AND user_id = $11
            RETURNING *`,
          [label, addressLine1, addressLine2 || null, city, region || null, postalCode || null, countryCode, notes || null, isDefault, locationId, req.user.id]
        );
        saved = result.rows[0] || null;
      } else {
        const result = await client.query(
          `INSERT INTO direct_customer_locations
             (user_id, label, address_line1, address_line2, city, region, postal_code, country_code, notes, is_default)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [req.user.id, label, addressLine1, addressLine2 || null, city, region || null, postalCode || null, countryCode, notes || null, isDefault]
        );
        saved = result.rows[0] || null;
      }

      if (!saved) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Location not found' });
      }

      await client.query('COMMIT');

      return res.status(locationId ? 200 : 201).json({
        location: {
          id: String(saved.id),
          label: saved.label,
          addressLine1: saved.address_line1,
          addressLine2: saved.address_line2 || '',
          city: saved.city,
          region: saved.region || '',
          postalCode: saved.postal_code || '',
          countryCode: saved.country_code || 'US',
          notes: saved.notes || '',
          isDefault: !!saved.is_default,
          createdAt: saved.created_at,
          updatedAt: saved.updated_at,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('saveLocation error', { error: err.message, userId: req.user?.id });
    return res.status(500).json({ error: 'Failed to save location' });
  }
};

exports.deleteLocation = async (req, res) => {
  const locationId = normalizeInteger(req.params.locationId);
  if (!locationId) {
    return res.status(400).json({ error: 'Valid location ID is required' });
  }

  try {
    const result = await db.query(
      `DELETE FROM direct_customer_locations
        WHERE id = $1
          AND user_id = $2
        RETURNING id`,
      [locationId, req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Location not found' });
    }

    return res.json({ success: true });
  } catch (err) {
    logger.error('deleteLocation error', { error: err.message, userId: req.user?.id });
    return res.status(500).json({ error: 'Failed to delete location' });
  }
};

exports.getRequestDetail = async (req, res) => {
  try {
    const request = await loadRequestOr404(req.params.id);
    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }
    if (!canAccessRequest(request, req.user)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const present = await presentRequest(request, { includeMessages: true, includeEvents: true });
    return res.json({ request: present });
  } catch (err) {
    logger.error('getRequestDetail error', { error: err.message, id: req.params.id, userId: req.user?.id });
    return res.status(500).json({ error: 'Failed to load request' });
  }
};

exports.getRequestMessages = async (req, res) => {
  try {
    const request = await loadRequestOr404(req.params.id);
    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }
    if (!canAccessRequest(request, req.user)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { rows } = await db.query(
      `SELECT id, quote_request_id, sender_user_id, sender_role, message, created_at
         FROM direct_request_messages
        WHERE quote_request_id = $1
        ORDER BY created_at ASC`,
      [req.params.id]
    );

    return res.json({
      messages: rows.map((message) => ({
        id: String(message.id),
        quoteRequestId: String(message.quote_request_id),
        senderUserId: message.sender_user_id ? String(message.sender_user_id) : null,
        senderRole: message.sender_role,
        message: message.message,
        createdAt: message.created_at,
      })),
    });
  } catch (err) {
    logger.error('getRequestMessages error', { error: err.message, id: req.params.id });
    return res.status(500).json({ error: 'Failed to load messages' });
  }
};

exports.addMessage = async (req, res) => {
  const message = cleanText(req.body.message, 5000);
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    const request = await loadRequestOr404(req.params.id);
    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }
    if (!canAccessRequest(request, req.user)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const senderRole = isAdmin(req.user) ? actorRoleFromUser(req.user) : 'customer';
    const { rows } = await db.query(
      `INSERT INTO direct_request_messages
         (quote_request_id, sender_user_id, sender_role, message)
       VALUES ($1, $2, $3, $4)
       RETURNING id, quote_request_id, sender_user_id, sender_role, message, created_at`,
      [request.id, req.user.id, VALID_MESSAGE_ROLES.has(senderRole) ? senderRole : 'customer', message]
    );

    await db.query('UPDATE quote_requests SET updated_at = NOW() WHERE id = $1', [request.id]);
    await appendEvent({
      quoteRequestId: request.id,
      actorUserId: req.user.id,
      actorRole: senderRole,
      eventType: 'message_added',
      title: `${caseStatusLabel(request.status)} message added`,
      details: message.slice(0, 300),
      payload: { senderRole },
    });

    return res.status(201).json({
      message: {
        id: String(rows[0].id),
        quoteRequestId: String(rows[0].quote_request_id),
        senderUserId: rows[0].sender_user_id ? String(rows[0].sender_user_id) : null,
        senderRole: rows[0].sender_role,
        message: rows[0].message,
        createdAt: rows[0].created_at,
      },
    });
  } catch (err) {
    logger.error('addMessage error', { error: err.message, id: req.params.id, userId: req.user?.id });
    return res.status(500).json({ error: 'Failed to send message' });
  }
};

async function updateRequestRecord(requestId, updates, event, actor) {
  const setClauses = [];
  const params = [];
  let index = 1;

  const add = (sqlValue) => {
    params.push(sqlValue);
    return `$${index++}`;
  };

  if (updates.status !== undefined) setClauses.push(`status = ${add(updates.status)}`);
  if (updates.quoteAmountCents !== undefined) setClauses.push(`quote_amount_cents = ${add(updates.quoteAmountCents)}`);
  if (updates.quoteCurrencyCode !== undefined) setClauses.push(`quote_currency_code = ${add(updates.quoteCurrencyCode)}`);
  if (updates.preferredDate !== undefined) setClauses.push(`preferred_date = ${add(updates.preferredDate)}`);
  if (updates.preferredTimeWindow !== undefined) setClauses.push(`preferred_time_window = ${add(updates.preferredTimeWindow)}`);
  if (updates.serviceAddress !== undefined) setClauses.push(`service_address = ${add(updates.serviceAddress)}`);
  if (updates.serviceCity !== undefined) setClauses.push(`service_city = ${add(updates.serviceCity)}`);
  if (updates.onSiteContactName !== undefined) setClauses.push(`on_site_contact_name = ${add(updates.onSiteContactName)}`);
  if (updates.onSiteContactPhone !== undefined) setClauses.push(`on_site_contact_phone = ${add(updates.onSiteContactPhone)}`);
  if (updates.accessNotes !== undefined) setClauses.push(`access_notes = ${add(updates.accessNotes)}`);
  if (updates.scheduledStartAt !== undefined) setClauses.push(`scheduled_start_at = ${add(updates.scheduledStartAt)}`);
  if (updates.scheduledEndAt !== undefined) setClauses.push(`scheduled_end_at = ${add(updates.scheduledEndAt)}`);
  if (updates.paymentStatus !== undefined) setClauses.push(`payment_status = ${add(updates.paymentStatus)}`);
  if (updates.paymentMethod !== undefined) setClauses.push(`payment_method = ${add(updates.paymentMethod)}`);
  if (updates.paymentReference !== undefined) setClauses.push(`payment_reference = ${add(updates.paymentReference)}`);
  if (updates.proofAttachment !== undefined) setClauses.push(`proof_attachment = ${add(JSON.stringify(updates.proofAttachment))}::jsonb`);
  if (updates.proofLink !== undefined) setClauses.push(`proof_link = ${add(updates.proofLink)}`);
  if (updates.proofReceivedAt !== undefined) setClauses.push(`proof_received_at = ${add(updates.proofReceivedAt)}`);
  if (updates.acceptedAt !== undefined) setClauses.push(`accepted_at = ${add(updates.acceptedAt)}`);
  if (updates.completedAt !== undefined) setClauses.push(`completed_at = ${add(updates.completedAt)}`);
  if (updates.closedAt !== undefined) setClauses.push(`closed_at = ${add(updates.closedAt)}`);
  if (updates.metadata !== undefined) setClauses.push(`metadata = COALESCE(metadata, '{}'::jsonb) || ${add(JSON.stringify(updates.metadata))}::jsonb`);

  if (setClauses.length === 0) {
    const row = await loadRequestOr404(requestId);
    return row;
  }

  params.push(requestId);
  const result = await db.query(
    `UPDATE quote_requests
        SET ${setClauses.join(', ')},
            updated_at = NOW()
      WHERE id = $${index}
      RETURNING *`,
    params
  );
  const request = result.rows[0] || null;
  if (request && event) {
    await appendEvent({
      quoteRequestId: requestId,
      actorUserId: actor?.id || null,
      actorRole: actor?.role || 'system',
      eventType: event.eventType,
      title: event.title,
      details: event.details || '',
      payload: event.payload || {},
    });
  }
  return request;
}

exports.acceptRequest = async (req, res) => {
  try {
    const request = await loadRequestOr404(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (!canAccessRequest(request, req.user)) return res.status(403).json({ error: 'Unauthorized' });

    const updated = await updateRequestRecord(
      request.id,
      { status: 'accepted', acceptedAt: new Date().toISOString() },
      { eventType: 'request_accepted', title: 'Quote accepted', details: 'The customer accepted the Direct quote.' },
      req.user
    );

    return res.json({ request: await presentRequest(updated, { includeMessages: true, includeEvents: true }) });
  } catch (err) {
    logger.error('acceptRequest error', { error: err.message, id: req.params.id });
    return res.status(500).json({ error: 'Failed to accept request' });
  }
};

exports.rejectRequest = async (req, res) => {
  try {
    const request = await loadRequestOr404(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (!canAccessRequest(request, req.user)) return res.status(403).json({ error: 'Unauthorized' });

    const reason = cleanText(req.body.reason || req.body.message || '', 500);
    const updated = await updateRequestRecord(
      request.id,
      {
        status: 'cancelled',
        closedAt: new Date().toISOString(),
        metadata: { declinedReason: reason || null, declinedAt: new Date().toISOString() },
      },
      { eventType: 'request_rejected', title: 'Request rejected', details: reason || 'The request was declined.' },
      req.user
    );

    return res.json({ request: await presentRequest(updated, { includeMessages: true, includeEvents: true }) });
  } catch (err) {
    logger.error('rejectRequest error', { error: err.message, id: req.params.id });
    return res.status(500).json({ error: 'Failed to reject request' });
  }
};

exports.scheduleRequest = async (req, res) => {
  try {
    const request = await loadRequestOr404(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (!canAccessRequest(request, req.user)) return res.status(403).json({ error: 'Unauthorized' });

    const updates = {
      status: 'scheduled',
      preferredDate: normalizeDate(req.body.preferredDate || req.body.preferred_date),
      preferredTimeWindow: cleanText(req.body.preferredTimeWindow || req.body.preferred_time_window, 80) || null,
      serviceAddress: cleanText(req.body.serviceAddress || req.body.service_address, 500) || null,
      serviceCity: cleanText(req.body.serviceCity || req.body.service_city, 120) || null,
      onSiteContactName: cleanText(req.body.onSiteContactName || req.body.on_site_contact_name, 120) || null,
      onSiteContactPhone: cleanText(req.body.onSiteContactPhone || req.body.on_site_contact_phone, 40) || null,
      accessNotes: cleanText(req.body.accessNotes || req.body.access_notes, 5000) || null,
      scheduledStartAt: normalizeTimestamp(req.body.scheduledStartAt || req.body.scheduled_start_at),
      scheduledEndAt: normalizeTimestamp(req.body.scheduledEndAt || req.body.scheduled_end_at),
      metadata: normalizeObject(req.body.metadata),
    };

    const updated = await updateRequestRecord(
      request.id,
      updates,
      { eventType: 'request_scheduled', title: 'Visit scheduled', details: 'The Direct job was scheduled.' },
      req.user
    );

    return res.json({ request: await presentRequest(updated, { includeMessages: true, includeEvents: true }) });
  } catch (err) {
    logger.error('scheduleRequest error', { error: err.message, id: req.params.id });
    return res.status(500).json({ error: 'Failed to schedule request' });
  }
};

exports.changeRequest = async (req, res) => {
  try {
    const request = await loadRequestOr404(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (!canAccessRequest(request, req.user)) return res.status(403).json({ error: 'Unauthorized' });

    const action = cleanText(req.body.action || 'reschedule', 20).toLowerCase();
    if (action === 'cancel') {
      const updated = await updateRequestRecord(
        request.id,
        {
          status: 'cancelled',
          closedAt: new Date().toISOString(),
          metadata: {
            changeReason: cleanText(req.body.reason || req.body.note || '', 500) || null,
            changeAction: 'cancel',
          },
        },
        { eventType: 'request_cancelled', title: 'Request cancelled', details: cleanText(req.body.reason || req.body.note || 'Customer requested cancellation.', 500) },
        req.user
      );
      return res.json({ request: await presentRequest(updated, { includeMessages: true, includeEvents: true }) });
    }

    const updated = await updateRequestRecord(
      request.id,
      {
        status: request.status === 'accepted' ? 'scheduled' : request.status,
        preferredDate: normalizeDate(req.body.preferredDate || req.body.preferred_date || request.preferred_date),
        preferredTimeWindow: cleanText(req.body.preferredTimeWindow || req.body.preferred_time_window || request.preferred_time_window || '', 80) || null,
        scheduledStartAt: normalizeTimestamp(req.body.scheduledStartAt || req.body.scheduled_start_at || request.scheduled_start_at),
        scheduledEndAt: normalizeTimestamp(req.body.scheduledEndAt || req.body.scheduled_end_at || request.scheduled_end_at),
        serviceAddress: cleanText(req.body.serviceAddress || req.body.service_address || request.service_address || '', 500) || null,
        serviceCity: cleanText(req.body.serviceCity || req.body.service_city || request.service_city || '', 120) || null,
        accessNotes: cleanText(req.body.accessNotes || req.body.access_notes || request.access_notes || '', 5000) || null,
        metadata: normalizeObject(req.body.metadata),
      },
      { eventType: 'request_rescheduled', title: 'Request rescheduled', details: 'The Direct job schedule was changed.' },
      req.user
    );

    return res.json({ request: await presentRequest(updated, { includeMessages: true, includeEvents: true }) });
  } catch (err) {
    logger.error('changeRequest error', { error: err.message, id: req.params.id });
    return res.status(500).json({ error: 'Failed to update request' });
  }
};

exports.submitProof = async (req, res) => {
  try {
    const request = await loadRequestOr404(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (!canAccessRequest(request, req.user)) return res.status(403).json({ error: 'Unauthorized' });

    const proofLink = cleanText(req.body.proofLink || req.body.proof_link, 2048) || null;
    const confirmationCode = cleanText(req.body.confirmationCode || req.body.confirmation_code, 120) || null;
    const paymentMethod = cleanText(req.body.paymentMethod || req.body.payment_method, 40) || null;
    const paymentReference = cleanText(req.body.paymentReference || req.body.payment_reference, 120) || null;
    const note = cleanText(req.body.note || '', 1000) || null;
    const proofAttachment = attachmentFromJson(req.body.proofAttachment || req.body.proof_attachment);

    if (!proofLink && !confirmationCode && !proofAttachment) {
      return res.status(400).json({ error: 'Upload proof or provide a receipt reference' });
    }

    const updated = await updateRequestRecord(
      request.id,
      {
        paymentStatus: 'proof_submitted',
        paymentMethod,
        paymentReference,
        proofAttachment,
        proofLink,
        proofReceivedAt: new Date().toISOString(),
        metadata: {
          proofNote: note,
          confirmationCode,
          proofSubmittedAt: new Date().toISOString(),
          proofSubmittedByUserId: String(req.user.id),
        },
      },
      { eventType: 'proof_submitted', title: 'Payment proof submitted', details: 'Payment proof was attached to the Direct request.' },
      req.user
    );

    return res.json({ request: await presentRequest(updated, { includeMessages: true, includeEvents: true }) });
  } catch (err) {
    logger.error('submitProof error', { error: err.message, id: req.params.id });
    return res.status(500).json({ error: 'Failed to submit payment proof' });
  }
};

exports.confirmProof = async (req, res) => {
  try {
    const request = await loadRequestOr404(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (!canAccessRequest(request, req.user)) return res.status(403).json({ error: 'Unauthorized' });

    const note = cleanText(req.body.note || '', 1000) || null;
    const updated = await updateRequestRecord(
      request.id,
      {
        paymentStatus: 'confirmed',
        completedAt: request.completed_at || new Date().toISOString(),
        metadata: {
          proofConfirmedAt: new Date().toISOString(),
          proofConfirmedByUserId: String(req.user.id),
          proofConfirmedNote: note,
        },
      },
      { eventType: 'proof_confirmed', title: 'Payment proof confirmed', details: note || 'The payment proof was confirmed.' },
      req.user
    );

    return res.json({ request: await presentRequest(updated, { includeMessages: true, includeEvents: true }) });
  } catch (err) {
    logger.error('confirmProof error', { error: err.message, id: req.params.id });
    return res.status(500).json({ error: 'Failed to confirm proof' });
  }
};

exports.getSettings = async (_req, res) => {
  try {
    const profile = await loadProfileRow();
    return res.json({ settings: serializeProfile(profile) });
  } catch (err) {
    logger.error('getSettings error', { error: err.message });
    return res.status(500).json({ error: 'Failed to load settings' });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const profile = {
      company_name: cleanText(req.body.companyName || req.body.company_name || DEFAULT_PROFILE.companyName, 200) || DEFAULT_PROFILE.companyName,
      headline: cleanText(req.body.headline || DEFAULT_PROFILE.headline, 240) || DEFAULT_PROFILE.headline,
      minimum_price_cents: normalizeInteger(req.body.minimumPriceCents || req.body.minimum_price_cents) || DEFAULT_PROFILE.minimumPriceCents,
      availability_text: cleanText(req.body.availabilityText || req.body.availability_text || DEFAULT_PROFILE.availabilityText, 200) || DEFAULT_PROFILE.availabilityText,
      base_city: cleanText(req.body.baseCity || req.body.base_city || DEFAULT_PROFILE.baseCity, 120) || DEFAULT_PROFILE.baseCity,
      public_note: cleanText(req.body.publicNote || req.body.public_note || DEFAULT_PROFILE.publicNote, 2000) || DEFAULT_PROFILE.publicNote,
      service_areas: JSON.stringify(normalizeArray(req.body.serviceAreas || req.body.service_areas)),
      tools: JSON.stringify(normalizeArray(req.body.tools)),
      travel_days: JSON.stringify(normalizeArray(req.body.travelDays || req.body.travel_days)),
      travel_cities: JSON.stringify(normalizeArray(req.body.travelCities || req.body.travel_cities)),
      support_email: cleanText(req.body.supportEmail || req.body.support_email || '', 255) || null,
      support_phone: cleanText(req.body.supportPhone || req.body.support_phone || '', 40) || null,
    };

    await db.query(
      `INSERT INTO direct_service_profiles
         (id, company_name, headline, minimum_price_cents, availability_text, base_city, public_note, service_areas, tools, travel_days, travel_cities, support_email, support_phone, updated_at)
       VALUES
         (1, $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, NOW())
       ON CONFLICT (id)
       DO UPDATE SET
         company_name = EXCLUDED.company_name,
         headline = EXCLUDED.headline,
         minimum_price_cents = EXCLUDED.minimum_price_cents,
         availability_text = EXCLUDED.availability_text,
         base_city = EXCLUDED.base_city,
         public_note = EXCLUDED.public_note,
         service_areas = EXCLUDED.service_areas,
         tools = EXCLUDED.tools,
         travel_days = EXCLUDED.travel_days,
         travel_cities = EXCLUDED.travel_cities,
         support_email = EXCLUDED.support_email,
         support_phone = EXCLUDED.support_phone,
         updated_at = NOW()`,
      [
        profile.company_name,
        profile.headline,
        profile.minimum_price_cents,
        profile.availability_text,
        profile.base_city,
        profile.public_note,
        profile.service_areas,
        profile.tools,
        profile.travel_days,
        profile.travel_cities,
        profile.support_email,
        profile.support_phone,
      ]
    );

    const updated = await loadProfileRow();
    return res.json({ settings: serializeProfile(updated) });
  } catch (err) {
    logger.error('updateSettings error', { error: err.message });
    return res.status(500).json({ error: 'Failed to save settings' });
  }
};

exports.getAdminDashboard = async (_req, res) => {
  try {
    const [{ rows: totals }, { rows: upcoming }, { rows: unpaid }] = await Promise.all([
      db.query(
        `SELECT
           COUNT(*)::int AS total_requests,
           COUNT(*) FILTER (WHERE status IN ('new', 'reviewing'))::int AS intake_requests,
           COUNT(*) FILTER (WHERE status = 'quoted')::int AS quoted_requests,
           COUNT(*) FILTER (WHERE status = 'scheduled')::int AS scheduled_requests,
           COUNT(*) FILTER (WHERE status IN ('started', 'en_route', 'waiting_customer'))::int AS active_requests,
           COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_requests,
           COUNT(*) FILTER (WHERE payment_status IN ('unpaid', 'proof_submitted'))::int AS unpaid_requests
         FROM quote_requests
        WHERE COALESCE(metadata->>'flow', 'direct') = 'direct'`
      ),
      db.query(
        `SELECT id, first_name, last_name, service_category, service_city, scheduled_start_at, status, quote_amount_cents, quote_currency_code
           FROM quote_requests
          WHERE COALESCE(metadata->>'flow', 'direct') = 'direct'
            AND scheduled_start_at IS NOT NULL
          ORDER BY scheduled_start_at ASC
          LIMIT 10`
      ),
      db.query(
        `SELECT id, first_name, last_name, service_category, service_location, payment_status, status, quote_amount_cents, quote_currency_code
           FROM quote_requests
          WHERE COALESCE(metadata->>'flow', 'direct') = 'direct'
            AND payment_status IN ('unpaid', 'proof_submitted', 'disputed')
          ORDER BY created_at DESC
          LIMIT 10`
      ),
    ]);

    return res.json({
      totals: totals[0] || {},
      upcoming: upcoming.rows || [],
      unpaid: unpaid.rows || [],
    });
  } catch (err) {
    logger.error('getAdminDashboard error', { error: err.message });
    return res.status(500).json({ error: 'Failed to load dashboard' });
  }
};

exports.getAdminCustomer = async (req, res) => {
  try {
    const userId = req.params.userId;
    const { rows: requests } = await db.query(
      `SELECT *
         FROM quote_requests
        WHERE user_id = $1
          AND COALESCE(metadata->>'flow', 'direct') = 'direct'
        ORDER BY created_at DESC
        LIMIT 50`,
      [userId]
    );
    const { rows: locations } = await db.query(
      `SELECT *
         FROM direct_customer_locations
        WHERE user_id = $1
        ORDER BY is_default DESC, created_at DESC`,
      [userId]
    );

    return res.json({
      customer: {
        userId,
        requests: await Promise.all(requests.map((request) => presentRequest(request, { includeMessages: false, includeEvents: false }))),
        locations: locations.map((location) => ({
          id: String(location.id),
          label: location.label,
          addressLine1: location.address_line1,
          addressLine2: location.address_line2 || '',
          city: location.city,
          region: location.region || '',
          postalCode: location.postal_code || '',
          countryCode: location.country_code || 'US',
          notes: location.notes || '',
          isDefault: !!location.is_default,
          createdAt: location.created_at,
          updatedAt: location.updated_at,
        })),
      },
    });
  } catch (err) {
    logger.error('getAdminCustomer error', { error: err.message, userId: req.params.userId });
    return res.status(500).json({ error: 'Failed to load customer profile' });
  }
};

exports.getReports = async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         COUNT(*)::int AS total_requests,
         COUNT(*) FILTER (WHERE status = 'new')::int AS requested_requests,
         COUNT(*) FILTER (WHERE status = 'quoted')::int AS quoted_requests,
         COUNT(*) FILTER (WHERE status = 'accepted')::int AS accepted_requests,
         COUNT(*) FILTER (WHERE status = 'scheduled')::int AS scheduled_requests,
         COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_requests,
         COUNT(*) FILTER (WHERE payment_status = 'confirmed')::int AS confirmed_payments,
         COUNT(*) FILTER (WHERE payment_status IN ('unpaid', 'proof_submitted'))::int AS outstanding_payments
       FROM quote_requests
      WHERE COALESCE(metadata->>'flow', 'direct') = 'direct'`
    );

    return res.json({ report: rows[0] || {} });
  } catch (err) {
    logger.error('getReports error', { error: err.message });
    return res.status(500).json({ error: 'Failed to load reports' });
  }
};

exports.getTeam = async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, first_name, last_name, email, role, default_mode, created_at
         FROM users
        WHERE role IN ('admin', 'super_admin')
        ORDER BY created_at ASC`
    );
    return res.json({
      members: rows.map((row) => ({
        id: String(row.id),
        firstName: row.first_name || '',
        lastName: row.last_name || '',
        email: row.email || '',
        role: row.role || '',
        defaultMode: row.default_mode || '',
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    logger.error('getTeam error', { error: err.message });
    return res.status(500).json({ error: 'Failed to load team list' });
  }
};

exports.getAdminInbox = async (req, res) => {
  const status = cleanText(req.query.status || '', 32).toLowerCase();
  const search = cleanText(req.query.search || '', 120);
  const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || '20'), 10) || 20, 1), 100);
  const page = Math.max(Number.parseInt(String(req.query.page || '1'), 10) || 1, 1);
  const offset = (page - 1) * limit;

  try {
    const where = [`COALESCE(metadata->>'flow', 'direct') = 'direct'`];
    const params = [];
    let idx = 1;
    if (status) {
      where.push(`status = $${idx++}`);
      params.push(status);
    }
    if (search) {
      where.push(`(
        first_name ILIKE $${idx}
        OR last_name ILIKE $${idx}
        OR email ILIKE $${idx}
        OR company_name ILIKE $${idx}
        OR service_category ILIKE $${idx}
        OR service_location ILIKE $${idx}
        OR service_city ILIKE $${idx}
      )`);
      params.push(`%${search}%`);
      idx++;
    }

    const whereClause = `WHERE ${where.join(' AND ')}`;
    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM quote_requests ${whereClause}`, params);
    const total = Number(countResult.rows[0]?.total || 0);

    params.push(limit);
    params.push(offset);
    const result = await db.query(
      `SELECT *
         FROM quote_requests
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
      params
    );

    return res.json({
      requests: await Promise.all(result.rows.map((row) => presentRequest(row, { includeMessages: false, includeEvents: false }))),
      total,
      page,
      limit,
    });
  } catch (err) {
    logger.error('getAdminInbox error', { error: err.message });
    return res.status(500).json({ error: 'Failed to load inbox' });
  }
};

function isValidEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

exports.sendAdminTestEmail = async (req, res) => {
  try {
    const recipientEmail = cleanText(req.body?.recipientEmail || req.user?.email || '', 255);
    const subject = cleanText(req.body?.subject || 'OxSteed email test', 180) || 'OxSteed email test';
    const message = cleanText(
      req.body?.message || 'If you received this message, the OxSteed email system is working.',
      4000
    ) || 'If you received this message, the OxSteed email system is working.';
    const senderName = [cleanText(req.user?.first_name || '', 120), cleanText(req.user?.last_name || '', 120)]
      .filter(Boolean)
      .join(' ')
      .trim() || req.user?.email || 'OxSteed staff';

    if (!isValidEmailAddress(recipientEmail)) {
      return res.status(400).json({ error: 'A valid recipient email is required.' });
    }

    const timestamp = new Date().toISOString();
    const result = await sendEmail({
      to: recipientEmail,
      subject,
      text: `${message}\n\nSent by ${senderName} at ${timestamp}.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
          <div style="font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #f97316;">OxSteed email test</div>
          <h1 style="margin: 12px 0 0; font-size: 28px; line-height: 1.2; color: #0f172a;">${subject}</h1>
          <p style="margin: 20px 0 0; font-size: 16px; line-height: 1.7; color: #334155;">${message}</p>
          <div style="margin-top: 24px; padding: 16px; border: 1px solid #e2e8f0; border-radius: 16px; background: #f8fafc;">
            <div style="font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #64748b;">Sent by</div>
            <div style="margin-top: 6px; font-size: 15px; color: #0f172a;">${senderName}</div>
            <div style="margin-top: 8px; font-size: 13px; color: #64748b;">${timestamp}</div>
          </div>
        </div>
      `,
      fromName: 'OxSteed Direct',
    });

    if (!result?.success) {
      const statusCode = result?.error === 'Email not configured' ? 503 : 502;
      return res.status(statusCode).json({
        error: result?.error || 'Email send failed',
      });
    }

    return res.json({
      success: true,
      recipientEmail,
      subject,
      providerMessageId: result.id || null,
    });
  } catch (err) {
    logger.error('sendAdminTestEmail error', {
      error: err.message,
      adminId: req.user?.id,
      recipientEmail: req.body?.recipientEmail,
    });
    return res.status(500).json({ error: 'Failed to send test email' });
  }
};
