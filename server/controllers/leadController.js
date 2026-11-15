const pool = require('../db');
const { sendError, sendSuccess } = require('../utils/apiError');
const { businessScopeSatisfies } = require('../middleware/scopeGates');
const logger = require('../utils/logger');
const { sendNotification } = require('../services/notificationService');

// Item 11: lead notifications used to be direct INSERTs inside the lead
// transaction, bypassing preferences/push/email/socket. Each handler now
// captures its notification and flushes it through sendNotification after
// COMMIT (a notify failure is non-critical and never fails the request).
async function flushPendingNotification(pending, context) {
  if (!pending) return;
  try {
    const result = await sendNotification(pending);
    if (result?.success === false) {
      logger.warn('Lead notification not delivered', { ...context, error: result.error || result.reason });
    }
  } catch (err) {
    logger.warn('Lead notification failed', { ...context, error: err.message });
  }
}

// ── Helper: Check if user can access business leads (owner, manager, or representative) ──
async function canAccessBusinessLeads(userId, businessId) {
  const { rows: [access] } = await pool.query(
    `SELECT b.id, b.user_id, b.business_name,
            CASE WHEN b.user_id = $1 THEN 'owner'
                 WHEN EXISTS(
                   SELECT 1 FROM business_members
                   WHERE business_id = b.id AND member_id = $1 AND status = 'active'
                 ) THEN 'member'
                 ELSE NULL END AS role
     FROM businesses b
     WHERE b.id = $2`,
    [userId, businessId]
  );
  return access && (access.role || access.user_id === userId) ? access : null;
}

// ── Create a lead (customer requests a quote) ──────────────────────────────
exports.createLead = async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId } = req.params;
    const { serviceIds, description, budgetMin, budgetMax } = req.body;
    const customerId = req.user.id;

    // Input validation
    if (!description || !description.trim()) {
      return sendError(res, 400, 'Description is required');
    }
    if (description.trim().length > 5000) {
      return sendError(res, 400, 'Description exceeds 5000 character limit');
    }
    if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
      return sendError(res, 400, 'At least one service must be selected');
    }
    if (serviceIds.length > 50) {
      return sendError(res, 400, 'Maximum 50 services allowed');
    }

    // Validate service IDs are positive integers with no duplicates
    const validServiceIds = serviceIds.filter((id, idx) => {
      if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return false;
      return serviceIds.indexOf(id) === idx;
    });
    if (validServiceIds.length !== serviceIds.length) {
      return sendError(res, 400, 'Invalid or duplicate service IDs');
    }

    // Validate budget range
    const min = budgetMin ? parseFloat(budgetMin) : null;
    const max = budgetMax ? parseFloat(budgetMax) : null;
    if ((min || max) && min && max && min > max) {
      return sendError(res, 400, 'Budget minimum cannot exceed maximum');
    }
    if ((min || max) && ((min && min < 0) || (max && max < 0))) {
      return sendError(res, 400, 'Budget values must be positive');
    }

    // Verify business exists
    const bizRes = await client.query(
      `SELECT b.id, b.user_id
         FROM businesses b
         JOIN users owner ON owner.id = b.user_id
        WHERE b.id = $1
          AND b.deleted_at IS NULL
          AND b.is_active = TRUE
          AND b.is_listed = TRUE
          AND COALESCE(b.is_hidden_by_admin, FALSE) = FALSE
          AND b.setup_status = 'active'
          AND b.business_kind = 'service'
          AND owner.deleted_at IS NULL
          AND owner.is_active = TRUE
          AND owner.email_verified = TRUE
          AND owner.onboarding_completed = TRUE`,
      [businessId]
    );
    if (!bizRes.rows[0]) return sendError(res, 404, 'Business not found');

    const bizOwnerId = bizRes.rows[0].user_id;

    // Validate all service IDs belong to this business
    const svcRes = await client.query(
      `SELECT COUNT(*) as cnt FROM business_services
       WHERE business_id = $1
         AND id = ANY($2)
         AND is_active = TRUE
         AND deleted_at IS NULL`,
      [businessId, validServiceIds]
    );
    if (parseInt(svcRes.rows[0].cnt, 10) !== validServiceIds.length) {
      return sendError(res, 400, 'One or more service IDs do not belong to this business');
    }

    await client.query('BEGIN');
    try {
      const result = await client.query(
        `INSERT INTO business_leads
         (business_id, customer_id, service_ids, description, budget_min, budget_max, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')
         RETURNING *`,
        [businessId, customerId, validServiceIds, description.trim(), min, max]
      );

      const lead = result.rows[0];

      // Capture the owner notification for post-COMMIT sendNotification
      // (non-critical failure) — see flushPendingNotification above.
      const pendingNotification = {
        userId: bizOwnerId,
        type: 'lead_received',
        title: 'New Service Request',
        body: `New lead request from customer: ${lead.lead_number}`,
        data: { reference_id: lead.id, reference_type: 'business_lead' },
        idempotencyKey: `lead-received:${lead.id}`,
      };

      await client.query('COMMIT');
      await flushPendingNotification(pendingNotification, { leadId: lead.id });
      sendSuccess(res, lead, 'Lead created successfully', 201);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } catch (err) {
    logger.error('createLead failed', { error: err.message, userId: req.user.id });
    sendError(res, 500, 'Failed to create lead');
  } finally {
    client.release();
  }
};

// ── Get leads for a business ──────────────────────────────────────────────
exports.getBusinessLeads = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { status, page = 1, limit = 20 } = req.query;

    const access = businessScopeSatisfies(req, businessId, 'any') || await canAccessBusinessLeads(req.user.id, businessId);
    if (!access) return sendError(res, 403, 'Access denied');

    // Validate pagination
    let parsedPage = parseInt(page, 10);
    let parsedLimit = parseInt(limit, 10);
    if (!Number.isInteger(parsedPage) || parsedPage < 1) parsedPage = 1;
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) parsedLimit = 20;

    // Validate status if provided
    const validStatuses = ['pending', 'quoted', 'accepted', 'rejected', 'completed', 'cancelled'];
    if (status && !validStatuses.includes(status)) {
      return sendError(res, 400, 'Invalid status filter');
    }

    let query = `
      SELECT l.*, u.first_name, u.last_name, u.email
      FROM business_leads l
      JOIN users u ON u.id = l.customer_id
      WHERE l.business_id = $1
    `;
    const params = [businessId];

    if (status) {
      query += ` AND l.status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY l.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parsedLimit, (parsedPage - 1) * parsedLimit);

    const result = await pool.query(query, params);
    const countRes = await pool.query(
      `SELECT COUNT(*) as total FROM business_leads WHERE business_id = $1 ${status ? `AND status = $2` : ''}`,
      status ? [businessId, status] : [businessId]
    );

    sendSuccess(res, {
      leads: result.rows,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total: parseInt(countRes.rows[0].total, 10),
      },
    });
  } catch (err) {
    logger.error('getBusinessLeads failed', { error: err.message, businessId: req.params.businessId });
    sendError(res, 500, 'Failed to fetch leads');
  }
};

// ── Get customer's leads ──────────────────────────────────────────────────
exports.getMyLeads = async (req, res) => {
  try {
    const customerId = req.user.id;
    const { status, page = 1, limit = 20 } = req.query;

    // Validate pagination
    let parsedPage = parseInt(page, 10);
    let parsedLimit = parseInt(limit, 10);
    if (!Number.isInteger(parsedPage) || parsedPage < 1) parsedPage = 1;
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) parsedLimit = 20;

    // Validate status if provided
    const validStatuses = ['pending', 'quoted', 'accepted', 'rejected', 'completed', 'cancelled'];
    if (status && !validStatuses.includes(status)) {
      return sendError(res, 400, 'Invalid status filter');
    }

    let query = `
      SELECT l.*, b.business_name, b.logo_url
      FROM business_leads l
      JOIN businesses b ON b.id = l.business_id
      WHERE l.customer_id = $1
    `;
    const params = [customerId];

    if (status) {
      query += ` AND l.status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY l.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parsedLimit, (parsedPage - 1) * parsedLimit);

    const result = await pool.query(query, params);
    const countRes = await pool.query(
      `SELECT COUNT(*) as total FROM business_leads WHERE customer_id = $1 ${status ? `AND status = $2` : ''}`,
      status ? [customerId, status] : [customerId]
    );

    sendSuccess(res, {
      leads: result.rows,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total: parseInt(countRes.rows[0].total, 10),
      },
    });
  } catch (err) {
    logger.error('getMyLeads failed', { error: err.message, userId: customerId });
    sendError(res, 500, 'Failed to fetch leads');
  }
};

// ── Get single lead details ───────────────────────────────────────────────
exports.getLead = async (req, res) => {
  try {
    const { leadId } = req.params;
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT l.*, b.business_name, b.logo_url, u.first_name, u.last_name, u.email
       FROM business_leads l
       JOIN businesses b ON b.id = l.business_id
       JOIN users u ON u.id = l.customer_id
       WHERE l.id = $1
         AND (l.customer_id = $2 OR EXISTS(
           SELECT 1 FROM businesses WHERE id = l.business_id AND user_id = $2
         ) OR EXISTS(
           SELECT 1 FROM business_members
           WHERE business_id = l.business_id AND member_id = $2 AND status = 'active'
         ))`,
      [leadId, userId]
    );

    if (!result.rows[0]) return sendError(res, 404, 'Lead not found');

    const lead = result.rows[0];

    // Fetch associated quotes (limit to last 100 to prevent abuse)
    const quotesRes = await pool.query(
      `SELECT id, lead_id, business_id, quote_number, amount, currency, description, timeline,
              expires_at, status, accepted_at, created_at, updated_at
       FROM lead_quotes
       WHERE lead_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [leadId]
    );

    sendSuccess(res, {
      ...lead,
      quotes: quotesRes.rows,
    });
  } catch (err) {
    logger.error('getLead failed', { error: err.message, userId: req.user.id });
    sendError(res, 500, 'Failed to fetch lead');
  }
};

// ── Submit a quote for a lead ────────────────────────────────────────────
exports.submitQuote = async (req, res) => {
  const client = await pool.connect();
  try {
    const { leadId } = req.params;
    const { amount, description, timeline, expiresAt } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
      return sendError(res, 400, 'Quote amount must be greater than zero');
    }

    const parsedAmount = parseFloat(amount);
    if (!Number.isFinite(parsedAmount)) {
      return sendError(res, 400, 'Invalid quote amount');
    }

    if (description && description.length > 5000) {
      return sendError(res, 400, 'Quote description exceeds 5000 character limit');
    }

    if (timeline && timeline.length > 200) {
      return sendError(res, 400, 'Timeline exceeds 200 character limit');
    }

    // Validate expiration date is in the future
    if (expiresAt) {
      const expiryTime = new Date(expiresAt).getTime();
      const nowTime = Date.now();
      if (expiryTime <= nowTime) {
        return sendError(res, 400, 'Quote expiration date must be in the future');
      }
    }

    await client.query('BEGIN');
    try {
      // Verify lead exists and get business_id
      const leadRes = await client.query(
        `SELECT l.id, l.business_id, l.customer_id, l.status
         FROM business_leads l
         WHERE l.id = $1`,
        [leadId]
      );

      if (!leadRes.rows[0]) {
        await client.query('ROLLBACK');
        return sendError(res, 404, 'Lead not found');
      }

      const lead = leadRes.rows[0];

      // Verify user owns the business that this lead was sent to
      const businessRes = await client.query(
        `SELECT id, user_id FROM businesses WHERE id = $1 AND user_id = $2`,
        [lead.business_id, req.user.id]
      );

      if (!businessRes.rows[0]) {
        await client.query('ROLLBACK');
        return sendError(res, 403, 'You do not have permission to quote on this lead');
      }

      // Check if quote already exists from this business for this lead
      const existingQuote = await client.query(
        `SELECT id FROM lead_quotes WHERE lead_id = $1 AND business_id = $2 AND status != 'rejected'`,
        [leadId, lead.business_id]
      );

      if (existingQuote.rows[0]) {
        await client.query('ROLLBACK');
        return sendError(res, 409, 'A quote for this lead has already been submitted');
      }

      const result = await client.query(
        `INSERT INTO lead_quotes
         (lead_id, business_id, amount, currency, description, timeline, expires_at, status)
         VALUES ($1, $2, $3, 'USD', $4, $5, $6, 'pending')
         RETURNING *`,
        [
          leadId,
          lead.business_id,
          parsedAmount,
          description ? description.trim() : null,
          timeline ? timeline.trim() : null,
          expiresAt ? new Date(expiresAt) : null,
        ]
      );

      const quote = result.rows[0];

      // Update lead status to 'quoted'
      await client.query(
        `UPDATE business_leads SET status = 'quoted', updated_at = NOW() WHERE id = $1`,
        [leadId]
      );

      // Capture the customer notification for post-COMMIT sendNotification.
      const pendingNotification = {
        userId: lead.customer_id,
        type: 'quote_received',
        title: 'New Quote Received',
        body: `Quote ${quote.quote_number} for your service request`,
        data: { reference_id: quote.id, reference_type: 'lead_quote' },
        idempotencyKey: `quote-received:${quote.id}`,
      };

      await client.query('COMMIT');
      await flushPendingNotification(pendingNotification, { quoteId: quote.id });
      sendSuccess(res, quote, 'Quote submitted successfully', 201);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } catch (err) {
    logger.error('submitQuote failed', { error: err.message, userId: req.user.id });
    sendError(res, 500, 'Failed to submit quote');
  } finally {
    client.release();
  }
};

// ── Accept a quote ────────────────────────────────────────────────────────
exports.acceptQuote = async (req, res) => {
  const client = await pool.connect();
  try {
    const { quoteId } = req.params;
    const customerId = req.user.id;

    await client.query('BEGIN');
    try {
      // Get quote and verify ownership and status
      const quoteRes = await client.query(
        `SELECT q.id, q.status, q.expires_at, q.quote_number, q.business_id, l.id as lead_id, l.customer_id
         FROM lead_quotes q
         JOIN business_leads l ON l.id = q.lead_id
         WHERE q.id = $1 AND l.customer_id = $2`,
        [quoteId, customerId]
      );

      if (!quoteRes.rows[0]) {
        await client.query('ROLLBACK');
        return sendError(res, 404, 'Quote not found');
      }

      const quote = quoteRes.rows[0];

      // Verify quote is in pending status
      if (quote.status !== 'pending') {
        await client.query('ROLLBACK');
        return sendError(res, 409, `Cannot accept a quote with status: ${quote.status}`);
      }

      // Verify quote has not expired
      if (quote.expires_at && new Date(quote.expires_at) < new Date()) {
        await client.query('ROLLBACK');
        return sendError(res, 410, 'This quote has expired');
      }

      // Update quote status
      const updatedQuote = await client.query(
        `UPDATE lead_quotes
         SET status = 'accepted', accepted_at = NOW(), accepted_by_id = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [customerId, quoteId]
      );

      // Update lead status to 'accepted'
      await client.query(
        `UPDATE business_leads SET status = 'accepted', updated_at = NOW() WHERE id = $1`,
        [quote.lead_id]
      );

      // Reject all other quotes for this lead (non-critical failure)
      try {
        await client.query(
          `UPDATE lead_quotes SET status = 'rejected', updated_at = NOW()
           WHERE lead_id = $1 AND id != $2 AND status = 'pending'`,
          [quote.lead_id, quoteId]
        );
      } catch (rejectErr) {
        logger.warn('Failed to reject competing quotes', { leadId: quote.lead_id, error: rejectErr.message });
      }

      // Notify business owner (non-critical failure, post-COMMIT).
      let pendingNotification = null;
      try {
        const bizOwnerRes = await client.query(
          `SELECT user_id FROM businesses WHERE id = $1`,
          [quote.business_id]
        );

        if (bizOwnerRes.rows[0]) {
          pendingNotification = {
            userId: bizOwnerRes.rows[0].user_id,
            type: 'lead_accepted',
            title: 'Quote Accepted',
            body: `Your quote ${quote.quote_number} has been accepted!`,
            data: { reference_id: quoteId, reference_type: 'lead_quote' },
            idempotencyKey: `quote-accepted:${quoteId}`,
          };
        }
      } catch (notifErr) {
        logger.warn('Failed to prepare quote acceptance notification', { quoteId, error: notifErr.message });
      }

      await client.query('COMMIT');
      await flushPendingNotification(pendingNotification, { quoteId });
      sendSuccess(res, updatedQuote.rows[0], 'Quote accepted successfully');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } catch (err) {
    logger.error('acceptQuote failed', { error: err.message, userId: req.user.id });
    sendError(res, 500, 'Failed to accept quote');
  } finally {
    client.release();
  }
};

// ── Reject a lead ─────────────────────────────────────────────────────────
exports.rejectLead = async (req, res) => {
  const client = await pool.connect();
  try {
    const { leadId } = req.params;

    await client.query('BEGIN');
    try {
      const leadRes = await client.query(
        `SELECT l.id, l.status, l.customer_id FROM business_leads l
         WHERE l.id = $1 AND l.business_id IN (
           SELECT id FROM businesses WHERE user_id = $2
         )`,
        [leadId, req.user.id]
      );

      if (!leadRes.rows[0]) {
        await client.query('ROLLBACK');
        return sendError(res, 404, 'Lead not found');
      }

      const lead = leadRes.rows[0];

      // Can only reject pending leads
      if (lead.status !== 'pending') {
        await client.query('ROLLBACK');
        return sendError(res, 409, `Cannot reject a lead with status: ${lead.status}`);
      }

      const result = await client.query(
        `UPDATE business_leads SET status = 'rejected', updated_at = NOW() WHERE id = $1 RETURNING *`,
        [leadId]
      );

      // Capture the customer notification for post-COMMIT sendNotification.
      const pendingNotification = {
        userId: lead.customer_id,
        type: 'lead_rejected',
        title: 'Request Update',
        body: 'Your service request was not accepted',
        data: { reference_id: leadId, reference_type: 'business_lead' },
        idempotencyKey: `lead-rejected:${leadId}`,
      };

      await client.query('COMMIT');
      await flushPendingNotification(pendingNotification, { leadId });
      sendSuccess(res, result.rows[0], 'Lead rejected');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } catch (err) {
    logger.error('rejectLead failed', { error: err.message, userId: req.user.id });
    sendError(res, 500, 'Failed to reject lead');
  } finally {
    client.release();
  }
};

// ── Complete a lead ───────────────────────────────────────────────────────
exports.completeLead = async (req, res) => {
  try {
    const { leadId } = req.params;

    const leadRes = await pool.query(
      `SELECT l.id, l.status FROM business_leads l
       WHERE l.id = $1 AND l.business_id IN (
         SELECT id FROM businesses WHERE user_id = $2
       )`,
      [leadId, req.user.id]
    );

    if (!leadRes.rows[0]) {
      return sendError(res, 404, 'Lead not found');
    }

    const lead = leadRes.rows[0];

    // Can only complete accepted leads
    if (lead.status !== 'accepted') {
      return sendError(res, 409, `Cannot complete a lead with status: ${lead.status}`);
    }

    const result = await pool.query(
      `UPDATE business_leads
       SET status = 'completed', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [leadId]
    );

    sendSuccess(res, result.rows[0], 'Lead marked as complete');
  } catch (err) {
    logger.error('completeLead failed', { error: err.message, userId: req.user.id });
    sendError(res, 500, 'Failed to complete lead');
  }
};
