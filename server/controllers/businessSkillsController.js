const { pool } = require('../db');
const { sendError, sendSuccess } = require('../utils/apiError');
const logger = require('../utils/logger');
const { canManageBusinessFinance } = require('../utils/businessOwnership');

// ── List business's required skills ──────────────────────────────────────────
exports.listBusinessSkills = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Verify business exists
    const bizRes = await pool.query(
      'SELECT id FROM businesses WHERE id = $1',
      [businessId]
    );
    if (!bizRes.rows[0]) {
      return sendError(res, 404, 'Business not found');
    }

    // Validate pagination
    let parsedPage = parseInt(page, 10);
    let parsedLimit = parseInt(limit, 10);
    if (!Number.isInteger(parsedPage) || parsedPage < 1) parsedPage = 1;
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) parsedLimit = 50;

    // Fetch business skills with skill details
    const result = await pool.query(
      `SELECT
         bs.id, bs.business_id, bs.skill_id, bs.is_required, bs.min_years_experience,
         sl.name as skill_name, sl.category,
         bs.created_at, bs.updated_at
       FROM business_skills bs
       JOIN skills_lookup sl ON bs.skill_id = sl.id
       WHERE bs.business_id = $1
       ORDER BY bs.created_at DESC
       LIMIT $2 OFFSET $3`,
      [businessId, parsedLimit, (parsedPage - 1) * parsedLimit]
    );

    // Get total count
    const countRes = await pool.query(
      'SELECT COUNT(*) FROM business_skills WHERE business_id = $1',
      [businessId]
    );
    const total = parseInt(countRes.rows[0].count, 10);

    sendSuccess(res, {
      skills: result.rows,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
      },
    });
  } catch (err) {
    logger.error('listBusinessSkills failed', { error: err.message, businessId: req.params.businessId });
    sendError(res, 500, 'Failed to fetch business skills');
  }
};

// ── Add skill to business ────────────────────────────────────────────────────
exports.addBusinessSkill = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { skillId, isRequired = true, minYearsExperience } = req.body;

    // Validate input
    if (!skillId || !Number.isInteger(parseInt(skillId, 10))) {
      return sendError(res, 400, 'Valid skill ID is required');
    }
    if (minYearsExperience && (!Number.isInteger(minYearsExperience) || minYearsExperience < 0)) {
      return sendError(res, 400, 'min_years_experience must be a non-negative integer');
    }

    // Verify business exists and user has access (owner or manager)
    const biz = await canManageBusinessFinance(req.user.id, businessId);
    if (!biz) {
      return sendError(res, 403, 'You do not have permission to manage this business');
    }

    // Verify skill exists
    const skillRes = await pool.query(
      'SELECT id, name, category FROM skills_lookup WHERE id = $1',
      [skillId]
    );
    if (!skillRes.rows[0]) {
      return sendError(res, 404, 'Skill not found');
    }

    const skill = skillRes.rows[0];

    // Check if skill already assigned
    const existingRes = await pool.query(
      'SELECT id FROM business_skills WHERE business_id = $1 AND skill_id = $2',
      [businessId, skillId]
    );
    if (existingRes.rows[0]) {
      return sendError(res, 409, 'This skill is already assigned to the business');
    }

    // Insert skill
    const result = await pool.query(
      `INSERT INTO business_skills (business_id, skill_id, is_required, min_years_experience)
       VALUES ($1, $2, $3, $4)
       RETURNING id, business_id, skill_id, is_required, min_years_experience, created_at, updated_at`,
      [businessId, skillId, isRequired, minYearsExperience || null]
    );

    const businessSkill = result.rows[0];

    sendSuccess(
      res,
      {
        ...businessSkill,
        skill_name: skill.name,
        category: skill.category,
      },
      'Skill added to business',
      201
    );
  } catch (err) {
    logger.error('addBusinessSkill failed', { error: err.message, userId: req.user.id });
    sendError(res, 500, 'Failed to add skill');
  }
};

// ── Update business skill ────────────────────────────────────────────────────
exports.updateBusinessSkill = async (req, res) => {
  try {
    const { businessId, skillId } = req.params;
    const { isRequired, minYearsExperience } = req.body;

    // Verify user has access (owner or manager)
    const biz = await canManageBusinessFinance(req.user.id, businessId);
    if (!biz) {
      return sendError(res, 403, 'You do not have permission to manage this business');
    }

    // Verify skill assignment exists
    const existingRes = await pool.query(
      `SELECT bs.id, bs.is_required, bs.min_years_experience, sl.name, sl.category
       FROM business_skills bs
       JOIN skills_lookup sl ON bs.skill_id = sl.id
       WHERE bs.business_id = $1 AND bs.skill_id = $2`,
      [businessId, skillId]
    );

    if (!existingRes.rows[0]) {
      return sendError(res, 404, 'Skill assignment not found');
    }

    const existing = existingRes.rows[0];

    // Update
    const result = await pool.query(
      `UPDATE business_skills
       SET is_required = $1, min_years_experience = $2, updated_at = NOW()
       WHERE business_id = $3 AND skill_id = $4
       RETURNING id, business_id, skill_id, is_required, min_years_experience, created_at, updated_at`,
      [
        isRequired !== undefined ? isRequired : existing.is_required,
        minYearsExperience !== undefined ? minYearsExperience : existing.min_years_experience,
        businessId,
        skillId,
      ]
    );

    sendSuccess(
      res,
      {
        ...result.rows[0],
        skill_name: existing.name,
        category: existing.category,
      },
      'Skill updated'
    );
  } catch (err) {
    logger.error('updateBusinessSkill failed', { error: err.message, userId: req.user.id });
    sendError(res, 500, 'Failed to update skill');
  }
};

// ── Remove skill from business ───────────────────────────────────────────────
exports.removeBusinessSkill = async (req, res) => {
  try {
    const { businessId, skillId } = req.params;

    // Verify user has access (owner or manager)
    const biz = await canManageBusinessFinance(req.user.id, businessId);
    if (!biz) {
      return sendError(res, 403, 'You do not have permission to manage this business');
    }

    // Verify assignment exists
    const existingRes = await pool.query(
      'SELECT id FROM business_skills WHERE business_id = $1 AND skill_id = $2',
      [businessId, skillId]
    );

    if (!existingRes.rows[0]) {
      return sendError(res, 404, 'Skill assignment not found');
    }

    // Delete with RETURNING to verify deletion
    const delResult = await pool.query(
      'DELETE FROM business_skills WHERE business_id = $1 AND skill_id = $2 RETURNING id',
      [businessId, skillId]
    );

    if (!delResult.rows.length) {
      return sendError(res, 500, 'Delete failed unexpectedly');
    }

    sendSuccess(res, null, 'Skill removed from business');
  } catch (err) {
    logger.error('removeBusinessSkill failed', { error: err.message, userId: req.user.id });
    sendError(res, 500, 'Failed to remove skill');
  }
};

// ── Search skills not yet assigned to business ───────────────────────────────
exports.searchSkillsForBusiness = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { q = '', limit = 20 } = req.query;

    // Verify business exists
    const bizRes = await pool.query(
      'SELECT id FROM businesses WHERE id = $1',
      [businessId]
    );
    if (!bizRes.rows[0]) {
      return sendError(res, 404, 'Business not found');
    }

    // Validate limit
    let parsedLimit = parseInt(limit, 10);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) parsedLimit = 20;

    // Search for skills not yet assigned
    const result = await pool.query(
      `SELECT sl.id, sl.name, sl.category
       FROM skills_lookup sl
       WHERE sl.is_active = true
         AND sl.name ILIKE $1
         AND sl.id NOT IN (
           SELECT skill_id FROM business_skills WHERE business_id = $2
         )
       ORDER BY sl.name
       LIMIT $3`,
      [`%${q}%`, businessId, parsedLimit]
    );

    sendSuccess(res, { skills: result.rows });
  } catch (err) {
    logger.error('searchSkillsForBusiness failed', { error: err.message, businessId: req.params.businessId });
    sendError(res, 500, 'Failed to search skills');
  }
};
