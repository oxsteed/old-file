const db = require('../db');
const logger = require('../utils/logger');
const { sendEmail } = require('../utils/email');

/**
 * Submit a Business Launch Program intake form
 * POST /api/consulting/business-launch/submit
 */
async function submitBusinessLaunchRequest(req, res) {
  const {
    email,
    first_name,
    last_name,
    phone,
    referral_source,
    skill_description,
    target_market,
    has_revenue,
    business_name_decided,
    business_name,
    operating_state,
    setup_items_selected,
    select_all_chosen,
    current_phase,
    additional_notes,
    urgency,
    package_selected,
    package_price,
  } = req.body;

  // Validation
  if (!email || !first_name || !last_name || !phone) {
    return res.status(400).json({ error: 'Name, email, and phone are required' });
  }

  if (!skill_description || !target_market || !operating_state || !package_selected) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const client = await db.connect();

    try {
      await client.query('BEGIN');

      // Insert the consulting request
      const result = await client.query(
        `INSERT INTO consulting_requests (
          user_id, email, first_name, last_name, phone, referral_source,
          skill_description, target_market, has_revenue, business_name_decided,
          business_name, operating_state, setup_items_selected, select_all_chosen,
          current_phase, additional_notes, urgency, package_selected, package_price,
          status
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, 'pending'
        ) RETURNING id, created_at`,
        [
          req.user?.id || null,
          email,
          first_name,
          last_name,
          phone,
          referral_source,
          skill_description,
          target_market,
          has_revenue,
          business_name_decided,
          business_name || null,
          operating_state,
          JSON.stringify(setup_items_selected || []),
          select_all_chosen || false,
          current_phase || null,
          additional_notes || null,
          urgency,
          package_selected,
          package_price,
        ]
      );

      const requestId = result.rows[0].id;
      const createdAt = result.rows[0].created_at;

      await client.query('COMMIT');

      // Send confirmation email to client (non-blocking)
      sendClientConfirmationEmail(
        email,
        first_name,
        package_selected,
        package_price,
        setup_items_selected,
        select_all_chosen
      ).catch(err => {
        logger.error('Failed to send confirmation email', { requestId, email, err });
      });

      // Send admin notification (non-blocking)
      notifyAdminOfNewRequest({
        requestId,
        name: `${first_name} ${last_name}`,
        email,
        phone,
        package_selected,
        urgency,
        operating_state,
        setup_items_selected: select_all_chosen ? 'All items' : setup_items_selected.length,
        createdAt,
      }).catch(err => {
        logger.error('Failed to send admin notification', { requestId, err });
      });

      logger.info('Business launch request submitted', {
        requestId,
        email,
        package_selected,
        urgency,
      });

      return res.status(201).json({
        success: true,
        requestId,
        message: 'Your request has been submitted. Check your email for confirmation.',
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error submitting business launch request', { err });
    return res.status(500).json({ error: 'Failed to submit request. Please try again.' });
  }
}

/**
 * Get all consulting requests (admin only, paginated)
 * GET /api/consulting/business-launch/requests?page=1&limit=20&status=pending&package=launch
 */
async function getBusinessLaunchRequests(req, res) {
  const { page = 1, limit = 20, status, package: pkg, urgency, state } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    let whereConditions = [];
    let params = [];
    let paramIndex = 1;

    if (status) {
      whereConditions.push(`status = $${paramIndex++}`);
      params.push(status);
    }

    if (pkg) {
      whereConditions.push(`package_selected = $${paramIndex++}`);
      params.push(pkg);
    }

    if (urgency) {
      whereConditions.push(`urgency = $${paramIndex++}`);
      params.push(urgency);
    }

    if (state) {
      whereConditions.push(`operating_state = $${paramIndex++}`);
      params.push(state);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get total count
    const countResult = await db.query(
      `SELECT COUNT(*) as total FROM consulting_requests ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total);

    // Get paginated results
    params.push(parseInt(limit));
    params.push(offset);

    const result = await db.query(
      `SELECT
        id, email, first_name, last_name, phone, referral_source,
        skill_description, target_market, has_revenue, business_name,
        operating_state, setup_items_selected, select_all_chosen,
        current_phase, urgency, package_selected, package_price, status,
        created_at, updated_at
      FROM consulting_requests
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      params
    );

    return res.json({
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    logger.error('Error fetching business launch requests', { err });
    return res.status(500).json({ error: 'Failed to fetch requests' });
  }
}

/**
 * Get a single consulting request by ID
 * GET /api/consulting/business-launch/requests/:id
 */
async function getBusinessLaunchRequest(req, res) {
  const { id } = req.params;

  try {
    const result = await db.query(
      `SELECT * FROM consulting_requests WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error fetching business launch request', { id, err });
    return res.status(500).json({ error: 'Failed to fetch request' });
  }
}

/**
 * Update consulting request status
 * PATCH /api/consulting/business-launch/requests/:id
 */
async function updateBusinessLaunchRequestStatus(req, res) {
  const { id } = req.params;
  const { status, notes } = req.body;

  const validStatuses = ['pending', 'contacted', 'kickoff_scheduled', 'in_progress', 'completed', 'cancelled'];

  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const client = await db.connect();

    try {
      await client.query('BEGIN');

      // Get current status
      const currentResult = await client.query(
        `SELECT status FROM consulting_requests WHERE id = $1`,
        [id]
      );

      if (currentResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Request not found' });
      }

      const oldStatus = currentResult.rows[0].status;

      // Update status
      const updateResult = await client.query(
        `UPDATE consulting_requests
         SET status = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [status, id]
      );

      // Log the change
      await client.query(
        `INSERT INTO consulting_request_audit_log (request_id, admin_id, old_status, new_status, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, req.user?.id || null, oldStatus, status, notes || null]
      );

      await client.query('COMMIT');

      logger.info('Business launch request status updated', {
        requestId: id,
        oldStatus,
        newStatus: status,
        adminId: req.user?.id,
      });

      return res.json({
        message: 'Status updated successfully',
        request: updateResult.rows[0],
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error updating business launch request status', { id, err });
    return res.status(500).json({ error: 'Failed to update status' });
  }
}

/**
 * Send confirmation email to client
 */
async function sendClientConfirmationEmail(
  email,
  firstName,
  packageSelected,
  packagePrice,
  setupItems,
  selectAllChosen
) {
  const packageNames = {
    foundation: 'Business Foundation',
    launch: 'Business Launch',
    accelerator: 'Business Accelerator',
  };

  const packageName = packageNames[packageSelected] || packageSelected;

  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
      <div style="background: linear-gradient(135deg, #F97316 0%, #FB923C 100%); padding: 2rem; border-radius: 12px 12px 0 0; color: white; text-align: center;">
        <h1 style="margin: 0; font-size: 28px; font-weight: 700;">OxSteed Business Launch</h1>
        <p style="margin: 0.5rem 0 0; font-size: 16px; opacity: 0.95;">Your Business Setup Journey Begins</p>
      </div>

      <div style="background: white; padding: 2rem; border: 1px solid #e5e7eb;">
        <p style="margin-top: 0; font-size: 16px;">Hi ${firstName},</p>

        <p style="color: #666; line-height: 1.6;">
          Thank you for submitting your OxSteed Business Launch request! We're excited to help you turn your skill into a real business.
        </p>

        <div style="background: #f9fafb; padding: 1.5rem; border-radius: 8px; margin: 1.5rem 0; border-left: 4px solid #F97316;">
          <h3 style="margin: 0 0 0.5rem; color: #1f2937;">Your Selected Package</h3>
          <p style="margin: 0.5rem 0; font-size: 18px; font-weight: 600; color: #F97316;">${packageName}</p>
          <p style="margin: 0; color: #666; font-size: 16px;">$${packagePrice}</p>
        </div>

        <h3 style="margin: 1.5rem 0 1rem; color: #1f2937; font-weight: 600;">What Happens Next</h3>
        <ol style="color: #666; line-height: 1.8; padding-left: 1.5rem;">
          <li>We review your request (usually within 24 hours)</li>
          <li>You'll receive a scheduling link to book your kickoff call</li>
          <li>We send you a pre-kickoff questionnaire to complete</li>
          <li>Your setup work begins after the kickoff call</li>
        </ol>

        <h3 style="margin: 1.5rem 0 1rem; color: #1f2937; font-weight: 600;">Before Your Kickoff Call, Please Prepare</h3>
        <ul style="color: #666; line-height: 1.8; padding-left: 1.5rem;">
          <li>Your government-issued ID (for identity verification during LLC filing)</li>
          <li>3 business name options you like (if you don't have one yet)</li>
          <li>A brief description of your top 1–2 services</li>
          <li>Any existing accounts you want to connect (Google, Apple ID, existing domain, etc.)</li>
        </ul>

        <p style="color: #666; margin-top: 1.5rem; line-height: 1.6;">
          Have any questions? Reach out to <strong>support@oxsteed.com</strong> anytime.
        </p>

        <p style="color: #999; font-size: 14px; margin-top: 2rem; border-top: 1px solid #e5e7eb; padding-top: 1rem;">
          <strong>Important:</strong> OxSteed Business Launch provides business setup implementation support only. We do not provide legal, tax, or financial advice. For questions involving legal entity selection, tax obligations, or regulated financial matters, please consult a licensed professional.
        </p>
      </div>

      <div style="background: #f3f4f6; padding: 1.5rem; border-radius: 0 0 12px 12px; text-align: center; font-size: 12px; color: #666;">
        <p style="margin: 0;">© ${new Date().getFullYear()} OxSteed. All rights reserved.</p>
        <p style="margin: 0.5rem 0 0;">Made for people turning their skills into real businesses.</p>
      </div>
    </div>
  `;

  try {
    await sendEmail({
      to: email,
      subject: 'Your OxSteed Business Launch Request Has Been Received',
      html,
    });
  } catch (err) {
    logger.error('Failed to send confirmation email', { email, err });
    throw err;
  }
}

/**
 * Notify admins of new consulting request
 */
async function notifyAdminOfNewRequest(data) {
  const {
    requestId,
    name,
    email,
    phone,
    package: pkg,
    urgency,
    operating_state,
    setup_items_selected,
  } = data;

  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
      <div style="background: #F97316; padding: 1.5rem; color: white; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0; font-size: 20px;">New Business Launch Request</h2>
      </div>

      <div style="background: white; padding: 1.5rem; border: 1px solid #e5e7eb; border-top: none;">
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Package:</strong> ${pkg}</p>
        <p><strong>State:</strong> ${operating_state}</p>
        <p><strong>Urgency:</strong> ${urgency}</p>
        <p><strong>Setup Items:</strong> ${setup_items_selected}</p>

        <p style="margin-top: 1.5rem;">
          <a href="https://oxsteed.com/admin/consulting/business-launch/requests/${requestId}" style="background: #F97316; color: white; padding: 0.75rem 1.5rem; text-decoration: none; border-radius: 6px; display: inline-block;">
            View Full Request →
          </a>
        </p>
      </div>
    </div>
  `;

  try {
    // Send to admin email (would be configured in environment)
    const adminEmail = process.env.ADMIN_EMAIL || 'support@oxsteed.com';
    await sendEmail({
      to: adminEmail,
      subject: `[Business Launch] New Request from ${name}`,
      html,
    });
  } catch (err) {
    logger.error('Failed to send admin notification', { err });
    throw err;
  }
}

module.exports = {
  submitBusinessLaunchRequest,
  getBusinessLaunchRequests,
  getBusinessLaunchRequest,
  updateBusinessLaunchRequestStatus,
};
