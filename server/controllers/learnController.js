/**
 * learnController.js
 * Endpoints for Learn Mode: guide completions + XP + UGC submissions.
 */

const pool = require('../db');
const AppError = require('../utils/AppError');

// ── Constants ─────────────────────────────────────────────────────────────────

const XP_BY_DIFFICULTY = { Easy: 10, Medium: 25, Hard: 50 };
const VALID_CATEGORIES = [
  'plumbing', 'electrical', 'carpentry', 'hvac',
  'painting', 'car-care', 'landscaping', 'maintenance',
];
const VALID_DIFFICULTIES = ['Easy', 'Medium', 'Hard'];

// Guide IDs that exist in the static dataset — prevents spurious completions.
const KNOWN_GUIDE_IDS = new Set([
  'fix-leaky-faucet', 'unclog-drain', 'fix-running-toilet',
  'replace-light-switch', 'install-ceiling-fan', 'reset-gfci',
  'replace-hvac-filter', 'clean-condensate-drain',
  'patch-drywall', 'install-door-handle',
  'paint-a-wall', 'change-oil', 'replace-wipers',
  'mulch-garden-bed', 'caulk-bathtub',
]);

// ── Completions ────────────────────────────────────────────────────────────────

/**
 * GET /api/learn/completions
 * Returns the authenticated user's completed guide IDs + total XP.
 */
exports.getCompletions = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT guide_id, completed_at
       FROM user_guide_completions
       WHERE user_id = $1
       ORDER BY completed_at DESC`,
      [req.user.id],
    );
    res.json({ completions: rows });
  } catch (err) {
    next(new AppError('Failed to fetch completions', 500, 'fetch_completions_failed'));
  }
};

/**
 * POST /api/learn/completions
 * Body: { guide_id, difficulty }
 * Records a guide completion and awards XP to the user's pulse score.
 * Idempotent — duplicate calls return 200 without re-awarding XP.
 */
exports.recordCompletion = async (req, res, next) => {
  const { guide_id, difficulty } = req.body;

  if (!guide_id || typeof guide_id !== 'string') {
    return next(new AppError('guide_id is required', 400, 'validation_failed'));
  }
  if (!KNOWN_GUIDE_IDS.has(guide_id)) {
    return next(new AppError('Unknown guide_id', 400, 'unknown_guide'));
  }

  const xp = XP_BY_DIFFICULTY[difficulty] ?? 10;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Idempotent insert — ignore on conflict
    const result = await client.query(
      `INSERT INTO user_guide_completions (user_id, guide_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, guide_id) DO NOTHING
       RETURNING id`,
      [req.user.id, guide_id],
    );

    const isNew = result.rows.length > 0;

    if (isNew) {
      // Award XP to pulse score (learn_guide category)
      // pulse_score_events table may not exist yet — fail open so completions
      // are never blocked by a missing pulse table.
      await client.query(
        `INSERT INTO pulse_score_events
               (user_id, event_type, source, source_id, xp_awarded, metadata)
         VALUES ($1, 'learn_guide_completion', 'learn', $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [
          req.user.id,
          guide_id,
          xp,
          JSON.stringify({ guide_id, difficulty: difficulty || 'Easy' }),
        ],
      ).catch(() => {}); // fail open if table absent
    }

    await client.query('COMMIT');
    res.json({ success: true, xp_awarded: isNew ? xp : 0, already_completed: !isNew });
  } catch (err) {
    await client.query('ROLLBACK');
    next(new AppError('Failed to record completion', 500, 'record_completion_failed'));
  } finally {
    client.release();
  }
};

// ── UGC Submissions ───────────────────────────────────────────────────────────

/**
 * POST /api/learn/submissions
 * Authenticated Helpers or Consultants submit a guide for review.
 */
exports.submitGuide = async (req, res, next) => {
  const {
    title, category, difficulty, estimated_minutes,
    intro, steps, skills, tools, video_url, license_note,
  } = req.body;

  // Validate required fields
  if (!title?.trim())             return next(new AppError('Title is required', 400, 'validation_failed'));
  if (!VALID_CATEGORIES.includes(category))
    return next(new AppError('Invalid category', 400, 'validation_failed'));
  if (!VALID_DIFFICULTIES.includes(difficulty))
    return next(new AppError('Difficulty must be Easy, Medium, or Hard', 400, 'validation_failed'));
  if (!Number.isInteger(estimated_minutes) || estimated_minutes < 1 || estimated_minutes > 1440)
    return next(new AppError('estimated_minutes must be 1–1440', 400, 'validation_failed'));
  if (!intro?.trim())             return next(new AppError('Intro is required', 400, 'validation_failed'));
  if (!Array.isArray(steps) || steps.length < 2)
    return next(new AppError('At least 2 steps are required', 400, 'validation_failed'));
  if (!Array.isArray(skills) || skills.length < 1)
    return next(new AppError('At least 1 skill is required', 400, 'validation_failed'));

  // Sanitize
  const cleanSteps  = steps.map(String).filter(Boolean).slice(0, 20);
  const cleanSkills = skills.map(String).filter(Boolean).slice(0, 10);
  const cleanTools  = Array.isArray(tools)
    ? tools.slice(0, 12).map((t) => ({
        name: String(t.name || '').slice(0, 120),
        buy_url: t.buy_url ? String(t.buy_url).slice(0, 300) : null,
        rent_url: t.rent_url ? String(t.rent_url).slice(0, 300) : null,
      }))
    : null;

  try {
    const { rows } = await pool.query(
      `INSERT INTO guide_submissions
         (user_id, title, category, difficulty, estimated_minutes,
          intro, steps, skills, tools, video_url, license_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, submitted_at`,
      [
        req.user.id,
        title.trim().slice(0, 200),
        category,
        difficulty,
        estimated_minutes,
        intro.trim().slice(0, 2000),
        JSON.stringify(cleanSteps),
        JSON.stringify(cleanSkills),
        cleanTools ? JSON.stringify(cleanTools) : null,
        video_url ? String(video_url).slice(0, 500) : null,
        license_note ? String(license_note).slice(0, 1000) : null,
      ],
    );

    res.status(201).json({ success: true, submission: rows[0] });
  } catch (err) {
    next(new AppError('Failed to submit guide', 500, 'submit_guide_failed'));
  }
};

/**
 * GET /api/learn/submissions/mine
 * Returns the caller's own submissions.
 */
exports.getMySubmissions = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, category, difficulty, status, reviewer_note, submitted_at, updated_at
       FROM guide_submissions
       WHERE user_id = $1
       ORDER BY submitted_at DESC`,
      [req.user.id],
    );
    res.json({ submissions: rows });
  } catch (err) {
    next(new AppError('Failed to fetch submissions', 500, 'fetch_submissions_failed'));
  }
};

// ── Admin ──────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/learn/submissions
 * Admin/super-admin view of all submissions.
 */
exports.adminListSubmissions = async (req, res, next) => {
  const status = req.query.status || 'pending';
  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const offset = parseInt(req.query.offset, 10) || 0;

  const validStatuses = ['pending', 'approved', 'rejected', 'all'];
  if (!validStatuses.includes(status)) {
    return next(new AppError('Invalid status filter', 400, 'validation_failed'));
  }

  try {
    const whereClause = status === 'all' ? '' : 'WHERE gs.status = $1';
    const params      = status === 'all' ? [limit, offset] : [status, limit, offset];
    const limitIdx    = status === 'all' ? 1 : 2;

    const { rows } = await pool.query(
      `SELECT
         gs.id, gs.title, gs.category, gs.difficulty,
         gs.estimated_minutes, gs.status, gs.submitted_at, gs.updated_at,
         gs.reviewer_note,
         u.first_name || ' ' || u.last_name AS submitter_name,
         u.email AS submitter_email,
         rv.first_name || ' ' || rv.last_name AS reviewer_name
       FROM guide_submissions gs
       JOIN users u  ON u.id  = gs.user_id
       LEFT JOIN users rv ON rv.id = gs.reviewer_id
       ${whereClause}
       ORDER BY gs.submitted_at DESC
       LIMIT $${limitIdx} OFFSET $${limitIdx + 1}`,
      params,
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) FROM guide_submissions gs ${whereClause}`,
      status === 'all' ? [] : [status],
    );

    res.json({ submissions: rows, total: parseInt(countRows[0].count, 10), limit, offset });
  } catch (err) {
    next(new AppError('Failed to fetch submissions', 500, 'fetch_submissions_failed'));
  }
};

/**
 * GET /api/admin/learn/submissions/:id
 * Full detail of a single submission.
 */
exports.adminGetSubmission = async (req, res, next) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT gs.*,
         u.first_name || ' ' || u.last_name AS submitter_name,
         u.email AS submitter_email,
         u.profile_photo_url AS submitter_photo
       FROM guide_submissions gs
       JOIN users u ON u.id = gs.user_id
       WHERE gs.id = $1`,
      [id],
    );
    if (!rows.length) return next(new AppError('Submission not found', 404, 'not_found'));
    res.json({ submission: rows[0] });
  } catch (err) {
    next(new AppError('Failed to fetch submission', 500, 'fetch_submission_failed'));
  }
};

/**
 * PATCH /api/admin/learn/submissions/:id
 * Body: { action: 'approve'|'reject', reviewer_note? }
 */
exports.adminReviewSubmission = async (req, res, next) => {
  const { id } = req.params;
  const { action, reviewer_note } = req.body;

  if (!['approve', 'reject'].includes(action)) {
    return next(new AppError("action must be 'approve' or 'reject'", 400, 'validation_failed'));
  }

  const status = action === 'approve' ? 'approved' : 'rejected';

  try {
    const { rows } = await pool.query(
      `UPDATE guide_submissions
       SET status = $1, reviewer_id = $2, reviewed_at = NOW(),
           reviewer_note = $3
       WHERE id = $4
       RETURNING id, status`,
      [status, req.user.id, reviewer_note?.trim() || null, id],
    );
    if (!rows.length) return next(new AppError('Submission not found', 404, 'not_found'));
    res.json({ success: true, submission: rows[0] });
  } catch (err) {
    next(new AppError('Failed to review submission', 500, 'review_failed'));
  }
};
