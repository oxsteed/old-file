// Agent Onboarding Controller
// Manages hiring process: applications, reviews, approvals, onboarding
// Employment is scoped to support_employers (business | helper | platform); business_id on agents is conversation context when set.

const { query } = require('../db');
const { sendError, sendValidationError } = require('../utils/apiError');
const logger = require('../utils/logger');
const supportEmployerService = require('../services/supportEmployerService');

async function applyToBeAgent(req, res) {
  try {
    const businessId = req.params.businessId || req.body.businessId;
    const { jobTitle, experienceLevel, languages, availability, resumeUrl, coverLetter } = req.body;

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

    const employerId = await supportEmployerService.ensureBusinessEmployer(businessId);

    const existing = await query(
      `SELECT * FROM agent_applications
       WHERE user_id = $1 AND employer_id = $2 AND status != 'rejected'`,
      [req.user.id, employerId]
    );
    if (existing.rows.length) {
      return sendError(res, 400, 'You have an active application for this employer');
    }

    const alreadyAgent = await query(
      'SELECT id FROM support_agents WHERE user_id = $1 AND employer_id = $2',
      [req.user.id, employerId]
    );
    if (alreadyAgent.rows.length) {
      return sendError(res, 400, 'You are already an agent for this employer');
    }

    const result = await query(
      `INSERT INTO agent_applications
       (employer_id, business_id, user_id, job_title, experience_level, languages, availability, resume_url, cover_letter, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
       RETURNING *`,
      [
        employerId,
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
      businessId,
      employerId
    });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error('applyToBeAgent error', { error: err.message });
    sendError(res, 500, 'Failed to submit application');
  }
}

async function getApplications(req, res) {
  try {
    const { businessId } = req.params;
    const { status, limit = 50 } = req.query;

    const can = await supportEmployerService.userCanManageBusiness(businessId, req.user.id);
    if (!can) return sendError(res, 403, 'Access denied');

    let sql = `
      SELECT
        aa.id, aa.employer_id, aa.business_id, aa.user_id,
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
    params.push(parseInt(limit, 10));

    const result = await query(sql, params);

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getApplications error', { error: err.message });
    sendError(res, 500, 'Failed to get applications');
  }
}

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

    const canManage = await supportEmployerService.userCanManageEmployer(
      app.employer_id,
      req.user.id,
      req.user.role
    );
    if (!canManage && req.user.id !== app.user_id) {
      return sendError(res, 403, 'Access denied');
    }

    res.json({ success: true, data: app });
  } catch (err) {
    logger.error('getApplication error', { error: err.message });
    sendError(res, 500, 'Failed to get application');
  }
}

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

    const appResult = await query(
      'SELECT * FROM agent_applications WHERE id = $1',
      [applicationId]
    );

    if (!appResult.rows.length) return sendError(res, 404, 'Application not found');

    const app = appResult.rows[0];

    const canManage = await supportEmployerService.userCanManageEmployer(
      app.employer_id,
      req.user.id,
      req.user.role
    );
    if (!canManage) return sendError(res, 403, 'Access denied');

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

async function approveAndHire(req, res) {
  try {
    const { applicationId } = req.params;
    const { role = 'agent', department, maxConcurrentChats = 3 } = req.body;

    const appResult = await query(
      'SELECT * FROM agent_applications WHERE id = $1',
      [applicationId]
    );

    if (!appResult.rows.length) return sendError(res, 404, 'Application not found');

    const app = appResult.rows[0];

    const canManage = await supportEmployerService.userCanManageEmployer(
      app.employer_id,
      req.user.id,
      req.user.role
    );
    if (!canManage) return sendError(res, 403, 'Access denied');

    if (app.status !== 'pending') {
      return sendError(res, 400, 'Application already processed');
    }

    const existing = await query(
      'SELECT id FROM support_agents WHERE user_id = $1 AND employer_id = $2',
      [app.user_id, app.employer_id]
    );
    if (existing.rows.length) {
      return sendError(res, 400, 'User is already an agent for this employer');
    }

    const contextBusinessId =
      app.business_id ||
      (await supportEmployerService.getEmployerById(app.employer_id))?.business_id ||
      null;

    const agentResult = await query(
      `INSERT INTO support_agents
       (employer_id, business_id, user_id, hire_date, status, role, department, max_concurrent_chats)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, 'active', $4, $5, $6)
       RETURNING *`,
      [app.employer_id, contextBusinessId, app.user_id, role, department || null, parseInt(maxConcurrentChats, 10)]
    );

    await query(
      `UPDATE agent_applications
       SET status = 'hired', reviewed_by = $1, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [req.user.id, applicationId]
    );

    logger.info('Agent hired from application', {
      agentId: agentResult.rows[0].id,
      userId: app.user_id,
      applicationId,
      employerId: app.employer_id
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

async function getMyApplicationStatus(req, res) {
  try {
    const businessId = req.params.businessId;

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

async function getApplicationStats(req, res) {
  try {
    const { businessId } = req.params;

    const can = await supportEmployerService.userCanManageBusiness(businessId, req.user.id);
    if (!can) return sendError(res, 403, 'Access denied');

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

/** Employers the current user may hire for (API + admin UI pickers). */
async function listMySupportEmployers(req, res) {
  try {
    const data = await supportEmployerService.listEmployersForUser(req.user.id, req.user.role);
    res.json({ success: true, data });
  } catch (err) {
    logger.error('listMySupportEmployers error', { error: err.message });
    sendError(res, 500, 'Failed to list employers');
  }
}

async function onboardAgent(req, res) {
  try {
    const {
      first_name,
      last_name,
      email,
      phone,
      timezone,
      availability_start,
      availability_end,
      skills = [],
      languages = [],
      experience_level = 'junior',
      service_business_id,
    } = req.body;

    const validationErrors = {};

    if (!first_name) validationErrors.first_name = 'First name is required';
    if (!last_name) validationErrors.last_name = 'Last name is required';
    if (!email) validationErrors.email = 'Email is required';
    if (!timezone) validationErrors.timezone = 'Timezone is required';
    if (!availability_start) validationErrors.availability_start = 'Start time is required';
    if (!availability_end) validationErrors.availability_end = 'End time is required';
    if (!Array.isArray(skills) || skills.length === 0) {
      validationErrors.skills = 'At least one skill must be selected';
    }

    if (Object.keys(validationErrors).length > 0) {
      return sendValidationError(res, validationErrors);
    }

    let employerId;
    try {
      employerId = await supportEmployerService.resolveEmployerIdFromBody(req.body, req.user.id, req.user.role);
    } catch (e) {
      if (e.code === 'FORBIDDEN_EMPLOYER' || e.code === 'FORBIDDEN_BUSINESS' || e.code === 'FORBIDDEN_PLATFORM' || e.code === 'FORBIDDEN_HELPER_EMPLOYER') {
        return sendError(res, 403, 'You do not have permission to hire for this employer');
      }
      if (e.code === 'BUSINESS_ID_REQUIRED') {
        return sendValidationError(res, { business_id: 'Required when employer_kind is business' });
      }
      throw e;
    }

    const employer = await supportEmployerService.getEmployerById(employerId);
    let contextBusinessId = null;
    if (employer.kind === 'business') {
      contextBusinessId = employer.business_id;
    } else if (service_business_id) {
      const can = await supportEmployerService.userCanManageBusiness(service_business_id, req.user.id);
      if (!can && req.user.role !== 'super_admin' && req.user.role !== 'admin') {
        return sendError(res, 403, 'Invalid service_business_id for conversation context');
      }
      contextBusinessId = service_business_id;
    }

    const existingAgent = await query(
      `SELECT sa.id FROM support_agents sa
       JOIN users u ON sa.user_id = u.id
       WHERE sa.employer_id = $1 AND u.email = $2`,
      [employerId, email]
    );

    if (existingAgent.rows.length) {
      return sendError(res, 400, 'An agent with this email already exists for this employer');
    }

    let userResult = await query('SELECT id FROM users WHERE email = $1', [email]);

    let userId;
    if (userResult.rows.length) {
      userId = userResult.rows[0].id;
    } else {
      const newUserResult = await query(
        `INSERT INTO users (name, email, password_hash, role, is_active)
         VALUES ($1, $2, $3, 'agent', true)
         RETURNING id`,
        [
          `${first_name} ${last_name}`,
          email,
          'PLACEHOLDER'
        ]
      );
      userId = newUserResult.rows[0].id;
    }

    const agentResult = await query(
      `INSERT INTO support_agents
       (employer_id, business_id, user_id, hire_date, status, timezone, availability_start, availability_end, skills, languages, experience_level)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, 'active', $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        employerId,
        contextBusinessId,
        userId,
        timezone,
        availability_start,
        availability_end,
        JSON.stringify(skills),
        JSON.stringify(languages),
        experience_level
      ]
    );

    await query(
      `UPDATE users SET phone = $1 WHERE id = $2`,
      [phone || null, userId]
    );

    logger.info('Agent onboarded successfully', {
      agentId: agentResult.rows[0].id,
      userId,
      employerId,
      adminId: req.user.id
    });

    res.json({
      success: true,
      data: {
        agent: agentResult.rows[0],
        message: 'Agent onboarded successfully'
      }
    });
  } catch (err) {
    logger.error('onboardAgent error', {
      error: err.message,
      code: err.code,
      detail: err.detail,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });

    if (err.code === '23505') {
      return sendError(res, 400, 'This email is already registered in the system');
    }

    if (err.code === '23503') {
      return sendError(res, 400, 'Invalid business ID or reference');
    }

    sendError(res, 500, 'Failed to onboard agent. Please try again.');
  }
}

/** Ensure the current user has a helper-scoped support employer row (idempotent). */
async function ensureMyHelperEmployer(req, res) {
  try {
    const id = await supportEmployerService.ensureHelperEmployer(
      req.user.id,
      req.body?.display_name || null
    );
    const row = await supportEmployerService.getEmployerById(id);
    res.json({ success: true, data: row });
  } catch (err) {
    logger.error('ensureMyHelperEmployer error', { error: err.message });
    sendError(res, 500, 'Failed to create employer');
  }
}

module.exports = {
  applyToBeAgent,
  getApplications,
  getApplication,
  reviewApplication,
  approveAndHire,
  getMyApplicationStatus,
  getApplicationStats,
  listMySupportEmployers,
  ensureMyHelperEmployer,
  onboardAgent
};
