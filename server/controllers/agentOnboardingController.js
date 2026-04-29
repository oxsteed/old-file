// Agent Onboarding Controller
// Manages hiring process: applications, reviews, approvals, onboarding

const { query } = require('../utils/db');
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');

// User applies to be an agent
async function applyToBeAgent(req, res) {
  try {
    const { businessId, jobTitle, experienceLevel, languages, availability, resumeUrl, coverLetter } = req.body;

    if (!businessId || !jobTitle) {
      return sendValidationError(res, {
        businessId: 'Required',
        jobTitle: 'Required'
      });
    }

    const validLevels = ['entry', 'intermediate', 'expert'];
    if (experienceLevel && !validLevels.includes(experienceLevel)) {
      return sendValidationError(res, { experienceLevel: 'Invalid level' });
    }

    // Check if already applied or hired
    const existing = await query(
      `SELECT * FROM agent_applications
       WHERE user_id = $1 AND business_id = $2 AND status != 'rejected'`,
      [req.user.id, businessId]
    );
    if (existing.rows.length) {
      return sendError(res, 400, 'You have an active application for this business');
    }

    const alreadyAgent = await query(
      'SELECT id FROM support_agents WHERE user_id = $1 AND business_id = $2',
      [req.user.id, businessId]
    );
    if (alreadyAgent.rows.length) {
      return sendError(res, 400, 'You are already an agent for this business');
    }

    // Create application
    const result = await query(
      `INSERT INTO agent_applications
       (business_id, user_id, job_title, experience_level, languages, availability, resume_url, cover_letter, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       RETURNING *`,
      [
        businessId,
        req.user.id,
        jobTitle,
        experienceLevel || 'intermediate',
        languages ? JSON.stringify(languages) : null,
        availability || null,
        resumeUrl || null,
        coverLetter || null
      ]
    );

    logger.info('Agent application created', {
      applicationId: result.rows[0].id,
      userId: req.user.id,
      businessId
    });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('applyToBeAgent error', { error: err.message });
    sendError(res, 500, 'Failed to submit application');
  }
}

// Get applications for a business (for review)
async function getApplications(req, res) {
  try {
    const { businessId } = req.params;
    const { status, limit = 50 } = req.query;

    // Verify access (business owner/admin only)
    const access = await query(
      'SELECT id FROM businesses WHERE id = $1 AND owner_id = $2 OR admin_user_ids @> $3',
      [businessId, req.user.id, JSON.stringify([req.user.id])]
    );
    if (!access.rows.length) return sendError(res, 403, 'Access denied');

    let sql = `
      SELECT
        aa.id, aa.business_id, aa.user_id,
        u.name, u.email, u.avatar_url,
        aa.job_title, aa.experience_level, aa.languages, aa.availability,
        aa.resume_url, aa.cover_letter,
        aa.status, aa.reviewed_by, aa.review_notes,
        aa.created_at, aa.updated_at, aa.reviewed_at
      FROM agent_applications aa
      LEFT JOIN users u ON aa.user_id = u.id
      WHERE aa.business_id = $1
    `;

    const params = [businessId];

    if (status) {
      sql += ` AND aa.status = $${params.length + 1}`;
      params.push(status);
    }

    sql += ` ORDER BY aa.created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const result = await query(sql, params);

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getApplications error', { error: err.message });
    sendError(res, 500, 'Failed to get applications');
  }
}

// Get single application
async function getApplication(req, res) {
  try {
    const { applicationId } = req.params;

    const result = await query(
      `SELECT
        aa.*,
        u.name, u.email, u.avatar_url
      FROM agent_applications aa
      LEFT JOIN users u ON aa.user_id = u.id
      WHERE aa.id = $1`,
      [applicationId]
    );

    if (!result.rows.length) return sendError(res, 404, 'Application not found');

    const app = result.rows[0];

    // Verify access
    const access = await query(
      'SELECT id FROM businesses WHERE id = $1 AND owner_id = $2 OR admin_user_ids @> $3',
      [app.business_id, req.user.id, JSON.stringify([req.user.id])]
    );
    if (!access.rows.length && req.user.id !== app.user_id) {
      return sendError(res, 403, 'Access denied');
    }

    res.json({ success: true, data: app });
  } catch (err) {
    logger.error('getApplication error', { error: err.message });
    sendError(res, 500, 'Failed to get application');
  }
}

// Review application (approve/reject)
async function reviewApplication(req, res) {
  try {
    const { applicationId } = req.params;
    const { status, reviewNotes } = req.body;

    if (!status) {
      return sendValidationError(res, { status: 'Required' });
    }

    const validStatuses = ['approved', 'rejected'];
    if (!validStatuses.includes(status)) {
      return sendValidationError(res, { status: 'Invalid status' });
    }

    // Get application
    const appResult = await query(
      'SELECT * FROM agent_applications WHERE id = $1',
      [applicationId]
    );

    if (!appResult.rows.length) return sendError(res, 404, 'Application not found');

    const app = appResult.rows[0];

    // Verify access
    const access = await query(
      'SELECT id FROM businesses WHERE id = $1 AND owner_id = $2 OR admin_user_ids @> $3',
      [app.business_id, req.user.id, JSON.stringify([req.user.id])]
    );
    if (!access.rows.length) return sendError(res, 403, 'Access denied');

    // Update application
    const result = await query(
      `UPDATE agent_applications
       SET status = $1, reviewed_by = $2, review_notes = $3, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [status, req.user.id, reviewNotes || null, applicationId]
    );

    logger.info('Application reviewed', {
      applicationId,
      status,
      reviewedBy: req.user.id
    });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('reviewApplication error', { error: err.message });
    sendError(res, 500, 'Failed to review application');
  }
}

// Approve application and hire agent
async function approveAndHire(req, res) {
  try {
    const { applicationId } = req.params;
    const { role = 'agent', department, maxConcurrentChats = 3 } = req.body;

    // Get application
    const appResult = await query(
      'SELECT * FROM agent_applications WHERE id = $1',
      [applicationId]
    );

    if (!appResult.rows.length) return sendError(res, 404, 'Application not found');

    const app = appResult.rows[0];

    // Verify access
    const access = await query(
      'SELECT id FROM businesses WHERE id = $1 AND owner_id = $2 OR admin_user_ids @> $3',
      [app.business_id, req.user.id, JSON.stringify([req.user.id])]
    );
    if (!access.rows.length) return sendError(res, 403, 'Access denied');

    if (app.status !== 'pending') {
      return sendError(res, 400, 'Application already processed');
    }

    // Check if already hired
    const existing = await query(
      'SELECT id FROM support_agents WHERE user_id = $1 AND business_id = $2',
      [app.user_id, app.business_id]
    );
    if (existing.rows.length) {
      return sendError(res, 400, 'User is already an agent');
    }

    // Create agent
    const agentResult = await query(
      `INSERT INTO support_agents
       (business_id, user_id, hire_date, status, role, department, max_concurrent_chats)
       VALUES ($1, $2, CURRENT_TIMESTAMP, 'active', $3, $4, $5)
       RETURNING *`,
      [app.business_id, app.user_id, role, department || null, parseInt(maxConcurrentChats)]
    );

    // Update application
    await query(
      `UPDATE agent_applications
       SET status = 'hired', reviewed_by = $1, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [req.user.id, applicationId]
    );

    logger.info('Agent hired from application', {
      agentId: agentResult.rows[0].id,
      userId: app.user_id,
      applicationId
    });

    res.json({
      success: true,
      data: {
        agent: agentResult.rows[0],
        application: { ...app, status: 'hired' }
      }
    });
  } catch (err) {
    logger.error('approveAndHire error', { error: err.message });
    sendError(res, 500, 'Failed to hire agent');
  }
}

// Get user's application status
async function getMyApplicationStatus(req, res) {
  try {
    const { businessId } = req.params;

    const result = await query(
      `SELECT * FROM agent_applications
       WHERE user_id = $1 AND business_id = $2
       ORDER BY created_at DESC`,
      [req.user.id, businessId]
    );

    res.json({
      success: true,
      data: result.rows.length ? result.rows[0] : null
    });
  } catch (err) {
    logger.error('getMyApplicationStatus error', { error: err.message });
    sendError(res, 500, 'Failed to get application status');
  }
}

// Get application statistics for business
async function getApplicationStats(req, res) {
  try {
    const { businessId } = req.params;

    // Verify access
    const access = await query(
      'SELECT id FROM businesses WHERE id = $1 AND owner_id = $2 OR admin_user_ids @> $3',
      [businessId, req.user.id, JSON.stringify([req.user.id])]
    );
    if (!access.rows.length) return sendError(res, 403, 'Access denied');

    const result = await query(
      `SELECT
        COUNT(*) as total_applications,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_applications,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_applications,
        SUM(CASE WHEN status = 'hired' THEN 1 ELSE 0 END) as hired_count,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_count,
        COUNT(DISTINCT experience_level) as experience_levels_applied
      FROM agent_applications
      WHERE business_id = $1`,
      [businessId]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('getApplicationStats error', { error: err.message });
    sendError(res, 500, 'Failed to get application stats');
  }
}

module.exports = {
  applyToBeAgent,
  getApplications,
  getApplication,
  reviewApplication,
  approveAndHire,
  getMyApplicationStatus,
  getApplicationStats
};
