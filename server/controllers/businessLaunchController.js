const db = require('../db');
const logger = require('../utils/logger');
const { sendEmail } = require('../utils/email');

function sanitizeCountry(code) {
  const value = String(code || '').trim().toUpperCase();
  return value.length === 2 ? value : null;
}

/**
 * Submit a Founder Development Program intake form
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
    operating_country,
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

  if (!skill_description || !target_market || !operating_country || !operating_state || !package_selected) {
    return res.status(400).json({ error: 'Missing required fields (country and state/city required)' });
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
          business_name, operating_country, operating_state, setup_items_selected, select_all_chosen,
          current_phase, additional_notes, urgency, package_selected, package_price,
          status
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, 'pending'
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
          operating_country,
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
  const { page = 1, limit = 20, status, package: pkg, urgency, state, country, search } = req.query;
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

    if (country) {
      whereConditions.push(`operating_country = $${paramIndex++}`);
      params.push(String(country).trim().toUpperCase());
    }

    if (search) {
      whereConditions.push(`(first_name ILIKE $${paramIndex} OR last_name ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
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
        operating_country, operating_state, setup_items_selected, select_all_chosen,
        current_phase, urgency, package_selected, package_price, status,
        consultant_assigned_id, consultant_assignment_status,
        consultant_assigned_at, consultant_follow_up_at,
        assigned_oxsteed_cut_bps, assigned_consultant_cut_bps,
        estimated_oxsteed_share_cents, estimated_consultant_share_cents,
        cu.first_name AS consultant_first_name,
        cu.last_name AS consultant_last_name,
        cp.headline AS consultant_headline,
        created_at, updated_at
      FROM consulting_requests cr
      LEFT JOIN users cu ON cr.consultant_assigned_id = cu.id
      LEFT JOIN consultant_contractor_profiles cp ON cp.user_id = cr.consultant_assigned_id
      ${whereClause}
      ORDER BY cr.created_at DESC
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
      `SELECT
         cr.*,
         cu.first_name AS consultant_first_name,
         cu.last_name AS consultant_last_name,
         cu.email AS consultant_email,
         cp.headline AS consultant_headline,
         cp.home_country AS consultant_home_country,
         cp.home_region AS consultant_home_region,
         cp.home_city AS consultant_home_city,
         cp.languages AS consultant_languages,
         cp.specialties AS consultant_specialties,
         cp.accepts_virtual_consulting
       FROM consulting_requests cr
       LEFT JOIN users cu ON cr.consultant_assigned_id = cu.id
       LEFT JOIN consultant_contractor_profiles cp ON cp.user_id = cr.consultant_assigned_id
       WHERE cr.id = $1`,
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

async function getMatchedConsultants(req, res) {
  const country = sanitizeCountry(req.query.country);
  const region = String(req.query.region || '').trim();
  const packagePriceCents = Math.max(0, Math.round(Number(req.query.package_price || 0) * 100));

  try {
    const result = await db.query(
      `SELECT
         p.user_id,
         u.first_name,
         u.last_name,
         u.email,
         p.headline,
         p.bio,
         p.home_country,
         p.home_region,
         p.home_city,
         p.coverage_countries,
         p.coverage_regions,
         p.languages,
         p.specialties,
         p.years_experience,
         p.default_oxsteed_cut_bps,
         p.minimum_package_price_cents,
         p.active_referral_limit,
         p.accepts_new_referrals,
         p.accepts_virtual_consulting,
         p.timezone,
         COUNT(cr.id) FILTER (
           WHERE cr.consultant_assigned_id = p.user_id
             AND cr.consultant_assignment_status NOT IN ('unassigned', 'lost', 'completed')
         ) AS active_referrals,
         CASE
           WHEN $1::text IS NOT NULL AND $1 = ANY(p.coverage_countries) AND $2::text <> '' AND $2 = ANY(p.coverage_regions) THEN 3
           WHEN $1::text IS NOT NULL AND $1 = ANY(p.coverage_countries) THEN 2
           WHEN p.accepts_virtual_consulting = TRUE THEN 1
           ELSE 0
         END AS match_score
       FROM consultant_contractor_profiles p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN consulting_requests cr ON cr.consultant_assigned_id = p.user_id
       WHERE p.is_active = TRUE
         AND p.accepts_new_referrals = TRUE
         AND ($3::integer = 0 OR p.minimum_package_price_cents <= $3)
         AND (
           $1::text IS NULL
           OR $1 = ANY(p.coverage_countries)
           OR p.accepts_virtual_consulting = TRUE
         )
       GROUP BY p.user_id, u.id
       HAVING COUNT(cr.id) FILTER (
         WHERE cr.consultant_assigned_id = p.user_id
           AND cr.consultant_assignment_status NOT IN ('unassigned', 'lost', 'completed')
       ) < p.active_referral_limit
       ORDER BY match_score DESC, active_referrals ASC, p.updated_at DESC
       LIMIT 40`,
      [country, region, packagePriceCents]
    );

    return res.json({ consultants: result.rows });
  } catch (err) {
    logger.error('Error fetching matched consultants', { err });
    return res.status(500).json({ error: 'Failed to fetch consultants' });
  }
}

async function assignConsultant(req, res) {
  const { id } = req.params;
  const {
    consultant_user_id,
    assigned_oxsteed_cut_bps,
    note_text,
  } = req.body;

  if (!consultant_user_id) {
    return res.status(400).json({ error: 'consultant_user_id is required' });
  }

  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const requestResult = await client.query(
        `SELECT * FROM consulting_requests WHERE id = $1 FOR UPDATE`,
        [id]
      );

      if (!requestResult.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Request not found' });
      }

      const launchRequest = requestResult.rows[0];
      const consultantResult = await client.query(
        `SELECT
           p.*,
           u.first_name,
           u.last_name,
           u.email
         FROM consultant_contractor_profiles p
         JOIN users u ON u.id = p.user_id
         WHERE p.user_id = $1
           AND p.is_active = TRUE
           AND p.accepts_new_referrals = TRUE`,
        [consultant_user_id]
      );

      if (!consultantResult.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Consultant profile not found or inactive.' });
      }

      const consultant = consultantResult.rows[0];
      const totalPriceCents = Math.max(0, Math.round(Number(launchRequest.package_price || 0) * 100));

      const activeReferralCountResult = await client.query(
        `SELECT COUNT(*)::int AS active_referrals
         FROM consulting_requests
         WHERE consultant_assigned_id = $1
           AND consultant_assignment_status NOT IN ('unassigned', 'lost', 'completed')`,
        [consultant_user_id]
      );

      if (consultant.active_referral_limit >= 0 && activeReferralCountResult.rows[0].active_referrals >= consultant.active_referral_limit) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Consultant is already at their active referral limit.' });
      }

      if (consultant.minimum_package_price_cents > totalPriceCents) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Consultant minimum package requirement is higher than this launch package.' });
      }

      const oxsteedCutBps = Math.max(
        0,
        Math.min(
          10000,
          parseInt(assigned_oxsteed_cut_bps ?? consultant.default_oxsteed_cut_bps ?? 0, 10) || 0
        )
      );
      const oxsteedShareCents = Math.round(totalPriceCents * (oxsteedCutBps / 10000));
      const consultantShareCents = Math.max(0, totalPriceCents - oxsteedShareCents);

      const updateResult = await client.query(
        `UPDATE consulting_requests
         SET consultant_assigned_id = $1,
             consultant_assignment_status = 'assigned',
             consultant_assigned_at = NOW(),
             assigned_oxsteed_cut_bps = $2,
             assigned_consultant_cut_bps = $3,
             estimated_total_price_cents = $4,
             estimated_oxsteed_share_cents = $5,
             estimated_consultant_share_cents = $6,
             consultant_status_notes = COALESCE($7, consultant_status_notes),
             updated_at = NOW()
         WHERE id = $8
         RETURNING *`,
        [
          consultant_user_id,
          oxsteedCutBps,
          Math.max(0, 10000 - oxsteedCutBps),
          totalPriceCents,
          oxsteedShareCents,
          consultantShareCents,
          note_text?.trim() || null,
          id,
        ]
      );

      await client.query(
        `INSERT INTO consulting_request_referral_log (request_id, actor_id, event_type, note_text, metadata)
         VALUES ($1, $2, 'consultant_assigned', $3, $4::jsonb)`,
        [
          id,
          req.user?.id || null,
          note_text?.trim() || null,
          JSON.stringify({
            consultant_user_id,
            oxsteed_cut_bps: oxsteedCutBps,
            consultant_share_cents: consultantShareCents,
            oxsteed_share_cents: oxsteedShareCents,
          }),
        ]
      );

      await client.query('COMMIT');

      sendEmail({
        to: consultant.email,
        subject: 'New OxSteed local consulting referral assigned',
        html: `
          <p>Hi ${consultant.first_name},</p>
          <p>OxSteed assigned you a new business-launch referral for ${launchRequest.first_name} ${launchRequest.last_name}.</p>
          <p><strong>Market:</strong> ${launchRequest.operating_country || '-'} / ${launchRequest.operating_state || '-'}</p>
          <p><strong>Package:</strong> ${launchRequest.package_selected || '-'} (${launchRequest.package_price || 0})</p>
          <p><strong>Your estimated share:</strong> $${(consultantShareCents / 100).toFixed(2)}</p>
          <p>Log in to your contractor dashboard to review the lead and continue the introduction.</p>
        `,
      }).catch((err) => {
        logger.warn('Failed to send consultant assignment email', { id, consultant_user_id, err: err.message });
      });

      sendEmail({
        to: launchRequest.email,
        subject: 'OxSteed matched you with a local consultant',
        html: `
          <p>Hi ${launchRequest.first_name},</p>
          <p>OxSteed has matched your business-launch request with ${consultant.first_name} ${consultant.last_name}${consultant.home_city ? ` in ${consultant.home_city}` : ''}.</p>
          <p>Your consultant will continue the introduction and next-step planning through the platform.</p>
          <p><strong>Consultant:</strong> ${consultant.first_name} ${consultant.last_name}</p>
          <p><strong>Specialties:</strong> ${(consultant.specialties || []).join(', ') || 'Business launch support'}</p>
        `,
      }).catch((err) => {
        logger.warn('Failed to send client consultant intro email', { id, err: err.message });
      });

      return res.json({
        message: 'Consultant assigned successfully.',
        request: updateResult.rows[0],
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error assigning consultant to business launch request', { id, err });
    return res.status(500).json({ error: 'Failed to assign consultant.' });
  }
}

/**
 * Update consulting request status
 * PATCH /api/consulting/business-launch/requests/:id
 */
async function updateBusinessLaunchRequestStatus(req, res) {
  const { id } = req.params;
  const { status, notes } = req.body;

  const validStatuses = ['pending', 'contacted', 'kickoff_scheduled', 'in_progress', 'completed', 'cancelled', 'archived'];

  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const client = await db.connect();

    try {
      await client.query('BEGIN');

      // Get current status and request details
      const currentResult = await client.query(
        `SELECT * FROM consulting_requests WHERE id = $1`,
        [id]
      );

      if (currentResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Request not found' });
      }

      const request = currentResult.rows[0];
      const oldStatus = request.status;

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

      // Send notification email to customer (non-blocking)
      sendStatusUpdateEmail(request, status).catch(err => {
        logger.error('Failed to send status update email', { requestId: id, email: request.email, err });
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
 * Send status update email to customer
 */
async function sendStatusUpdateEmail(request, newStatus) {
  const statusMessages = {
    pending: {
      subject: 'We received your Founder Development Program application',
      message: 'We have received your intake form and are reviewing it. Our team will reach out within 24 hours.',
    },
    contacted: {
      subject: 'Next steps for your Founder Development Program',
      message: 'We have reviewed your submission and will be reaching out shortly with next steps and to schedule your kickoff call.',
    },
    kickoff_scheduled: {
      subject: 'Your Founder Development Program kickoff is scheduled!',
      message: 'Your kickoff call is now scheduled. Check your email for the calendar invite and preparation materials.',
    },
    in_progress: {
      subject: 'Your Business Launch implementation has begun!',
      message: 'We are now implementing your business setup. You will receive updates as each component is completed.',
    },
    completed: {
      subject: 'Congratulations! Your Business Launch is complete',
      message: 'Your business is now fully set up and ready to launch. We wish you success in your new venture!',
    },
    cancelled: {
      subject: 'Your Founder Development Program request has been cancelled',
      message: 'Your intake form request has been cancelled. If you have any questions, please contact support.',
    },
  };

  const { subject, message } = statusMessages[newStatus] || {
    subject: 'Founder Development Program Status Update',
    message: 'Your request status has been updated.',
  };

  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
      <div style="background: linear-gradient(135deg, #F97316 0%, #FB923C 100%); padding: 2rem; border-radius: 12px 12px 0 0; color: white; text-align: center;">
        <h1 style="margin: 0; font-size: 28px; font-weight: 700;">OxSteed Business Launch</h1>
        <p style="margin: 0.5rem 0 0; font-size: 16px; opacity: 0.95;">Program Update</p>
      </div>

      <div style="background: white; padding: 2rem; border: 1px solid #e5e7eb;">
        <p style="margin-top: 0; font-size: 16px;">Hi ${request.first_name},</p>

        <p style="color: #666; line-height: 1.6;">
          ${message}
        </p>

        <div style="background: #f9fafb; padding: 1.5rem; border-radius: 8px; margin: 1.5rem 0; border-left: 4px solid #F97316;">
          <h3 style="margin: 0 0 0.5rem; color: #1f2937;">Current Status</h3>
          <p style="margin: 0.5rem 0; font-size: 18px; font-weight: 600; color: #F97316;">${newStatus.replace('_', ' ').toUpperCase()}</p>
        </div>

        <h3 style="margin: 1.5rem 0 1rem; color: #1f2937; font-weight: 600;">Your Business Launch Details</h3>
        <ul style="color: #666; line-height: 1.8; padding-left: 1.5rem;">
          <li><strong>Package:</strong> ${request.package_selected}</li>
          <li><strong>Business Focus:</strong> ${request.skill_description}</li>
          <li><strong>Target Market:</strong> ${request.target_market}</li>
          ${request.business_name ? `<li><strong>Business Name:</strong> ${request.business_name}</li>` : ''}
        </ul>

        <p style="color: #666; margin-top: 1.5rem; line-height: 1.6;">
          Have any questions? Reach out to <strong>support@oxsteed.com</strong> anytime.
        </p>

        <p style="color: #999; font-size: 14px; margin-top: 2rem; border-top: 1px solid #e5e7eb; padding-top: 1rem;">
          <strong>Manage Your Progress:</strong> <a href="${process.env.APP_URL || 'https://oxsteed.com'}/business-launch-status" style="color: #F97316; text-decoration: none;">View your application status</a>
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
      to: request.email,
      subject,
      html,
    });
  } catch (err) {
    logger.error('Failed to send status update email', { email: request.email, err });
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

/**
 * Get user's own Business Launch requests
 * GET /api/consulting/business-launch/my-requests
 */
async function getUserBusinessLaunchRequests(req, res) {
  const userId = req.user?.id;
  const email = req.user?.email;

  if (!userId && !email) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // Get requests for logged-in user (by user_id or email)
    const result = await db.query(
      `SELECT * FROM consulting_requests
       WHERE (user_id = $1 OR email = $2)
       ORDER BY created_at DESC`,
      [userId || null, email]
    );

    return res.json(result.rows);
  } catch (err) {
    logger.error('Error fetching user business launch requests', { userId, email, err });
    return res.status(500).json({ error: 'Failed to fetch requests' });
  }
}

/**
 * Search Business Launch requests by email (public)
 * GET /api/consulting/business-launch/search?email=
 */
async function searchBusinessLaunchRequests(req, res) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { email } = req.query;
  if (!email) {
    return res.status(400).json({ error: 'Email parameter required' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Authorization: non-admins can only search their own email.
  // Prevents enumeration of other users' business intake details.
  const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
  const requesterEmail = (req.user.email || '').toLowerCase().trim();
  if (!isAdmin && requesterEmail !== normalizedEmail) {
    return res.status(403).json({ error: 'Can only search your own email' });
  }

  try {
    const result = await db.query(
      `SELECT id, email, first_name, last_name, business_name, package_selected,
              package_price, status, created_at, updated_at, current_phase,
              skill_description, target_market, operating_state, urgency,
              setup_items_selected
       FROM consulting_requests
       WHERE LOWER(email) = $1
       ORDER BY created_at DESC`,
      [normalizedEmail]
    );

    return res.json(result.rows);
  } catch (err) {
    logger.error('Error searching business launch requests', { err: err.message });
    return res.status(500).json({ error: 'Failed to search requests' });
  }
}

module.exports = {
  submitBusinessLaunchRequest,
  getBusinessLaunchRequests,
  getBusinessLaunchRequest,
  updateBusinessLaunchRequestStatus,
  getUserBusinessLaunchRequests,
  searchBusinessLaunchRequests,
  getMatchedConsultants,
  assignConsultant,
};
