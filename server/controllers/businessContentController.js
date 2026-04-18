const db = require('../db');
const { apiError, sendError, sendSuccess } = require('../utils/apiError');
const logger = require('../utils/logger');
const { canAccessBusiness } = require('../utils/businessOwnership');

// ─── SERVICES ────────────────────────────────────────────────────────────────

exports.getBusinessServices = async (req, res) => {
  try {
    const { businessId } = req.params;
    const client = await db.connect();

    try {
      const result = await client.query(
        `SELECT id, name, description, price, price_unit, duration, popular, category, sort_order, is_active, created_at
         FROM business_services
         WHERE business_id = $1 AND is_active = true
         ORDER BY sort_order ASC, created_at DESC`,
        [businessId]
      );

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
    const { name, description, price, price_unit = 'flat', duration, popular = false, category = 'General' } = req.body;

    // Validate access
    const hasAccess = await canAccessBusiness(req.user.id, businessId, ['owner', 'manager']);
    if (!hasAccess) return sendError(res, 403, 'Access denied');

    // Validate required fields
    if (!name || !price) return sendError(res, 400, 'Name and price are required');

    const client = await db.connect();
    try {
      const result = await client.query(
        `INSERT INTO business_services (business_id, name, description, price, price_unit, duration, popular, category)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [businessId, name, description || null, price, price_unit, duration || null, popular, category]
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
    const { name, description, price, price_unit, duration, popular, category, is_active } = req.body;

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
             updated_at = NOW()
         WHERE id = $9 AND business_id = $10
         RETURNING *`,
        [name, description, price, price_unit, duration, popular, category, is_active, serviceId, businessId]
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
