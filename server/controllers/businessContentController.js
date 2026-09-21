const db = require('../db');
const { sendError, sendSuccess } = require('../utils/apiError');
const logger = require('../utils/logger');
const { canAccessBusiness } = require('../utils/businessOwnership');

function parsePositiveInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseNonNegativeInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function coerceServiceFields(body = {}) {
  let price = body.price;
  let basePriceCents = body.base_price_cents;
  if ((basePriceCents === undefined || basePriceCents === null || basePriceCents === '')
      && price !== undefined && price !== null && price !== '') {
    const dollars = parseFloat(price);
    if (!Number.isNaN(dollars)) basePriceCents = Math.round(dollars * 100);
  }
  if ((price === undefined || price === null || price === '')
      && basePriceCents !== undefined && basePriceCents !== null && basePriceCents !== '') {
    const cents = parseInt(basePriceCents, 10);
    if (!Number.isNaN(cents)) price = cents / 100;
  }

  let duration = body.duration;
  let durationMinutes = parsePositiveInt(body.duration_minutes);
  if (durationMinutes == null && duration != null && String(duration).trim() !== '') {
    const parsed = parseInt(String(duration), 10);
    if (Number.isFinite(parsed) && parsed > 0) durationMinutes = parsed;
  }
  if ((duration === undefined || duration === null || duration === '') && durationMinutes != null) {
    duration = String(durationMinutes);
  }

  return {
    name: body.name != null ? String(body.name).trim() : undefined,
    description: body.description,
    price,
    price_unit: body.price_unit,
    duration,
    popular: body.popular,
    category: body.category,
    is_active: body.is_active,
    duration_minutes: durationMinutes,
    base_price_cents: parseNonNegativeInt(basePriceCents),
    max_capacity: parsePositiveInt(body.max_capacity),
    min_notice_hours: parseNonNegativeInt(body.min_notice_hours),
    cancellation_policy_hours: parseNonNegativeInt(body.cancellation_policy_hours),
  };
}

const SERVICE_SELECT = `id, name, description, price, price_unit, duration, popular, category, sort_order, is_active,
         duration_minutes, base_price_cents, max_capacity, min_notice_hours, cancellation_policy_hours,
         created_at, updated_at`;

// ─── SERVICES ────────────────────────────────────────────────────────────────

exports.getBusinessServices = async (req, res) => {
  try {
    const { businessId } = req.params;
    const showAll = req.query.all === 'true'; // For Business Hub editing: show all services including inactive

    const client = await db.connect();

    try {
      // If requesting all services (for Business Hub editing), require auth and ownership check
      if (showAll) {
        const hasAccess = await canAccessBusiness(req.user?.id, businessId, ['owner', 'manager']);
        if (!hasAccess) return sendError(res, 403, 'Access denied');
      }

      const query = `SELECT ${SERVICE_SELECT}
         FROM business_services
         WHERE business_id = $1
         ${!showAll ? 'AND is_active = true' : ''}
         ORDER BY sort_order ASC, created_at DESC`;

      const result = await client.query(query, [businessId]);
      sendSuccess(res, result.rows);
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('getBusinessServices failed', { error: err.message });
    sendError(res, 500, 'Failed to fetch services');
  }
};

exports.createBusinessService = async (req, res) => {
  try {
    const { businessId } = req.params;
    const fields = coerceServiceFields(req.body);

    // Validate access
    const hasAccess = await canAccessBusiness(req.user.id, businessId, ['owner', 'manager']);
    if (!hasAccess) return sendError(res, 403, 'Access denied');

    // Validate required fields
    if (!fields.name) return sendError(res, 400, 'Name is required');
    if (fields.price === undefined || fields.price === null) return sendError(res, 400, 'Price is required');

    // Validate price is numeric and non-negative
    const priceNum = parseFloat(fields.price);
    if (isNaN(priceNum) || priceNum < 0 || priceNum > 999999.99) {
      return sendError(res, 400, 'Price must be a number between 0 and 999999.99');
    }

    // Validate business ID is numeric
    if (isNaN(parseInt(businessId, 10))) {
      return sendError(res, 400, 'Invalid business ID');
    }

    const client = await db.connect();
    try {
      const result = await client.query(
        `INSERT INTO business_services (
            business_id, name, description, price, price_unit, duration, popular, category,
            duration_minutes, base_price_cents, max_capacity, min_notice_hours,
            cancellation_policy_hours, created_by_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING *`,
        [
          parseInt(businessId, 10),
          fields.name,
          fields.description || null,
          priceNum,
          fields.price_unit || 'flat',
          fields.duration || null,
          fields.popular || false,
          fields.category || 'General',
          fields.duration_minutes,
          fields.base_price_cents != null ? fields.base_price_cents : Math.round(priceNum * 100),
          fields.max_capacity || 1,
          fields.min_notice_hours != null ? fields.min_notice_hours : 24,
          fields.cancellation_policy_hours != null ? fields.cancellation_policy_hours : 24,
          req.user?.id || null,
        ]
      );

      sendSuccess(res, result.rows[0], 201);
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('createBusinessService failed', { error: err.message });
    sendError(res, 500, 'Failed to create service');
  }
};

exports.updateBusinessService = async (req, res) => {
  try {
    const { businessId, serviceId } = req.params;
    const fields = coerceServiceFields(req.body);

    // Validate access
    const hasAccess = await canAccessBusiness(req.user.id, businessId, ['owner', 'manager']);
    if (!hasAccess) return sendError(res, 403, 'Access denied');

    const client = await db.connect();
    try {
      const result = await client.query(
        `UPDATE business_services
         SET name = COALESCE($1, name),
             description = COALESCE($2, description),
             price = COALESCE($3, price),
             price_unit = COALESCE($4, price_unit),
             duration = COALESCE($5, duration),
             popular = COALESCE($6, popular),
             category = COALESCE($7, category),
             is_active = COALESCE($8, is_active),
             duration_minutes = COALESCE($9, duration_minutes),
             base_price_cents = COALESCE($10, base_price_cents),
             max_capacity = COALESCE($11, max_capacity),
             min_notice_hours = COALESCE($12, min_notice_hours),
             cancellation_policy_hours = COALESCE($13, cancellation_policy_hours),
             updated_at = NOW()
         WHERE id = $14 AND business_id = $15
         RETURNING *`,
        [
          fields.name || null,
          fields.description,
          fields.price,
          fields.price_unit,
          fields.duration,
          fields.popular,
          fields.category,
          fields.is_active,
          fields.duration_minutes,
          fields.base_price_cents,
          fields.max_capacity,
          fields.min_notice_hours,
          fields.cancellation_policy_hours,
          serviceId,
          businessId,
        ]
      );

      if (result.rows.length === 0) return sendError(res, 404, 'Service not found');
      sendSuccess(res, result.rows[0]);
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('updateBusinessService failed', { error: err.message });
    sendError(res, 500, 'Failed to update service');
  }
};

exports.deleteBusinessService = async (req, res) => {
  try {
    const { businessId, serviceId } = req.params;

    // Validate access
    const hasAccess = await canAccessBusiness(req.user.id, businessId, ['owner', 'manager']);
    if (!hasAccess) return sendError(res, 403, 'Access denied');

    const client = await db.connect();
    try {
      await client.query(
        `DELETE FROM business_services WHERE id = $1 AND business_id = $2`,
        [serviceId, businessId]
      );

      sendSuccess(res, { deleted: true });
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('deleteBusinessService failed', { error: err.message });
    sendError(res, 500, 'Failed to delete service');
  }
};

// ─── GALLERY ──────────────────────────────────────────────────────────────────

exports.getBusinessGallery = async (req, res) => {
  try {
    const { businessId } = req.params;
    const client = await db.connect();

    try {
      const result = await client.query(
        `SELECT id, url, caption, alt, sort_order, created_at
         FROM business_gallery
         WHERE business_id = $1
         ORDER BY sort_order ASC, created_at DESC`,
        [businessId]
      );

      sendSuccess(res, result.rows);
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('getBusinessGallery failed', { error: err.message });
    sendError(res, 500, 'Failed to fetch gallery');
  }
};

exports.addBusinessGalleryPhoto = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { url, caption = null, alt = null } = req.body;

    // Validate access
    const hasAccess = await canAccessBusiness(req.user.id, businessId, ['owner', 'manager']);
    if (!hasAccess) return sendError(res, 403, 'Access denied');

    if (!url) return sendError(res, 400, 'URL is required');

    const client = await db.connect();
    try {
      const result = await client.query(
        `INSERT INTO business_gallery (business_id, url, caption, alt)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [businessId, url, caption, alt]
      );

      sendSuccess(res, result.rows[0], 201);
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('addBusinessGalleryPhoto failed', { error: err.message });
    sendError(res, 500, 'Failed to add photo');
  }
};

exports.updateBusinessGalleryPhoto = async (req, res) => {
  try {
    const { businessId, photoId } = req.params;
    const { caption, alt, sort_order } = req.body;

    // Validate access
    const hasAccess = await canAccessBusiness(req.user.id, businessId, ['owner', 'manager']);
    if (!hasAccess) return sendError(res, 403, 'Access denied');

    const client = await db.connect();
    try {
      const result = await client.query(
        `UPDATE business_gallery
         SET caption = COALESCE($1, caption),
             alt = COALESCE($2, alt),
             sort_order = COALESCE($3, sort_order),
             updated_at = NOW()
         WHERE id = $4 AND business_id = $5
         RETURNING *`,
        [caption, alt, sort_order, photoId, businessId]
      );

      if (result.rows.length === 0) return sendError(res, 404, 'Photo not found');
      sendSuccess(res, result.rows[0]);
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('updateBusinessGalleryPhoto failed', { error: err.message });
    sendError(res, 500, 'Failed to update photo');
  }
};

exports.deleteBusinessGalleryPhoto = async (req, res) => {
  try {
    const { businessId, photoId } = req.params;

    // Validate access
    const hasAccess = await canAccessBusiness(req.user.id, businessId, ['owner', 'manager']);
    if (!hasAccess) return sendError(res, 403, 'Access denied');

    const client = await db.connect();
    try {
      await client.query(
        `DELETE FROM business_gallery WHERE id = $1 AND business_id = $2`,
        [photoId, businessId]
      );

      sendSuccess(res, { deleted: true });
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('deleteBusinessGalleryPhoto failed', { error: err.message });
    sendError(res, 500, 'Failed to delete photo');
  }
};

// ─── POLICIES ─────────────────────────────────────────────────────────────────

exports.getBusinessPolicies = async (req, res) => {
  try {
    const { businessId } = req.params;
    const client = await db.connect();

    try {
      const result = await client.query(
        `SELECT id, title, content, icon, sort_order, created_at
         FROM business_policies
         WHERE business_id = $1
         ORDER BY sort_order ASC, created_at DESC`,
        [businessId]
      );

      sendSuccess(res, result.rows);
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('getBusinessPolicies failed', { error: err.message });
    sendError(res, 500, 'Failed to fetch policies');
  }
};

exports.createBusinessPolicy = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { title, content, icon = 'file-text' } = req.body;

    // Validate access
    const hasAccess = await canAccessBusiness(req.user.id, businessId, ['owner', 'manager']);
    if (!hasAccess) return sendError(res, 403, 'Access denied');

    if (!title || !content) return sendError(res, 400, 'Title and content are required');

    const client = await db.connect();
    try {
      const result = await client.query(
        `INSERT INTO business_policies (business_id, title, content, icon)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [businessId, title, content, icon]
      );

      sendSuccess(res, result.rows[0], 201);
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('createBusinessPolicy failed', { error: err.message });
    sendError(res, 500, 'Failed to create policy');
  }
};

exports.updateBusinessPolicy = async (req, res) => {
  try {
    const { businessId, policyId } = req.params;
    const { title, content, icon } = req.body;

    // Validate access
    const hasAccess = await canAccessBusiness(req.user.id, businessId, ['owner', 'manager']);
    if (!hasAccess) return sendError(res, 403, 'Access denied');

    const client = await db.connect();
    try {
      const result = await client.query(
        `UPDATE business_policies
         SET title = COALESCE($1, title),
             content = COALESCE($2, content),
             icon = COALESCE($3, icon),
             updated_at = NOW()
         WHERE id = $4 AND business_id = $5
         RETURNING *`,
        [title, content, icon, policyId, businessId]
      );

      if (result.rows.length === 0) return sendError(res, 404, 'Policy not found');
      sendSuccess(res, result.rows[0]);
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('updateBusinessPolicy failed', { error: err.message });
    sendError(res, 500, 'Failed to update policy');
  }
};

exports.deleteBusinessPolicy = async (req, res) => {
  try {
    const { businessId, policyId } = req.params;

    // Validate access
    const hasAccess = await canAccessBusiness(req.user.id, businessId, ['owner', 'manager']);
    if (!hasAccess) return sendError(res, 403, 'Access denied');

    const client = await db.connect();
    try {
      await client.query(
        `DELETE FROM business_policies WHERE id = $1 AND business_id = $2`,
        [policyId, businessId]
      );

      sendSuccess(res, { deleted: true });
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('deleteBusinessPolicy failed', { error: err.message });
    sendError(res, 500, 'Failed to delete policy');
  }
};

// ─── FAQs ─────────────────────────────────────────────────────────────────────

exports.getBusinessFAQs = async (req, res) => {
  try {
    const { businessId } = req.params;
    const client = await db.connect();

    try {
      const result = await client.query(
        `SELECT id, question, answer, sort_order, created_at
         FROM business_faqs
         WHERE business_id = $1
         ORDER BY sort_order ASC, created_at DESC`,
        [businessId]
      );

      sendSuccess(res, result.rows);
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('getBusinessFAQs failed', { error: err.message });
    sendError(res, 500, 'Failed to fetch FAQs');
  }
};

exports.createBusinessFAQ = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { question, answer } = req.body;

    // Validate access
    const hasAccess = await canAccessBusiness(req.user.id, businessId, ['owner', 'manager']);
    if (!hasAccess) return sendError(res, 403, 'Access denied');

    if (!question || !answer) return sendError(res, 400, 'Question and answer are required');

    const client = await db.connect();
    try {
      const result = await client.query(
        `INSERT INTO business_faqs (business_id, question, answer)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [businessId, question, answer]
      );

      sendSuccess(res, result.rows[0], 201);
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('createBusinessFAQ failed', { error: err.message });
    sendError(res, 500, 'Failed to create FAQ');
  }
};

exports.updateBusinessFAQ = async (req, res) => {
  try {
    const { businessId, faqId } = req.params;
    const { question, answer, sort_order } = req.body;

    // Validate access
    const hasAccess = await canAccessBusiness(req.user.id, businessId, ['owner', 'manager']);
    if (!hasAccess) return sendError(res, 403, 'Access denied');

    const client = await db.connect();
    try {
      const result = await client.query(
        `UPDATE business_faqs
         SET question = COALESCE($1, question),
             answer = COALESCE($2, answer),
             sort_order = COALESCE($3, sort_order),
             updated_at = NOW()
         WHERE id = $4 AND business_id = $5
         RETURNING *`,
        [question, answer, sort_order, faqId, businessId]
      );

      if (result.rows.length === 0) return sendError(res, 404, 'FAQ not found');
      sendSuccess(res, result.rows[0]);
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('updateBusinessFAQ failed', { error: err.message });
    sendError(res, 500, 'Failed to update FAQ');
  }
};

exports.deleteBusinessFAQ = async (req, res) => {
  try {
    const { businessId, faqId } = req.params;

    // Validate access
    const hasAccess = await canAccessBusiness(req.user.id, businessId, ['owner', 'manager']);
    if (!hasAccess) return sendError(res, 403, 'Access denied');

    const client = await db.connect();
    try {
      await client.query(
        `DELETE FROM business_faqs WHERE id = $1 AND business_id = $2`,
        [faqId, businessId]
      );

      sendSuccess(res, { deleted: true });
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('deleteBusinessFAQ failed', { error: err.message });
    sendError(res, 500, 'Failed to delete FAQ');
  }
};

// ─── HOURS ────────────────────────────────────────────────────────────────────

exports.getBusinessHours = async (req, res) => {
  try {
    const { businessId } = req.params;
    const client = await db.connect();

    try {
      const result = await client.query(
        `SELECT id, day_of_week, start_time, end_time, is_closed, created_at
         FROM business_hours
         WHERE business_id = $1
         ORDER BY day_of_week ASC`,
        [businessId]
      );

      sendSuccess(res, result.rows);
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('getBusinessHours failed', { error: err.message });
    sendError(res, 500, 'Failed to fetch hours');
  }
};

exports.updateBusinessHours = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { day_of_week, start_time, end_time, is_closed } = req.body;

    // Validate access
    const hasAccess = await canAccessBusiness(req.user.id, businessId, ['owner', 'manager']);
    if (!hasAccess) return sendError(res, 403, 'Access denied');

    if (day_of_week === undefined) return sendError(res, 400, 'Day of week is required');

    const client = await db.connect();
    try {
      const result = await client.query(
        `INSERT INTO business_hours (business_id, day_of_week, start_time, end_time, is_closed)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (business_id, day_of_week) DO UPDATE
         SET start_time = COALESCE($3, business_hours.start_time),
             end_time = COALESCE($4, business_hours.end_time),
             is_closed = COALESCE($5, business_hours.is_closed),
             updated_at = NOW()
         RETURNING *`,
        [businessId, day_of_week, start_time || null, end_time || null, is_closed || false]
      );

      sendSuccess(res, result.rows[0]);
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('updateBusinessHours failed', { error: err.message });
    sendError(res, 500, 'Failed to update hours');
  }
};
