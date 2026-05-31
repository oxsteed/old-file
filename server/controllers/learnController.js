/**
 * learnController.js
 * Endpoints for Learn Mode: guide completions + XP + UGC submissions.
 */

const pool = require('../db');
const AppError = require('../utils/appError');

// ── Constants ─────────────────────────────────────────────────────────────────

const XP_BY_DIFFICULTY = { Easy: 10, Medium: 25, Hard: 50 };
const VALID_DIFFICULTIES = ['Easy', 'Medium', 'Hard'];

// Single source of truth for guide IDs/categories across web + API.
// This file is also used to generate the iOS Learn catalog.
const LearnGuidesData = require('../data/learnGuides.json');
const GUIDES = Array.isArray(LearnGuidesData?.guides) ? LearnGuidesData.guides : [];

const KNOWN_GUIDE_IDS = new Set(GUIDES.map((g) => String(g.id)));
const GUIDE_CATEGORY = Object.fromEntries(GUIDES.map((g) => [String(g.id), String(g.category)]));
const VALID_CATEGORIES = [...new Set(GUIDES.map((g) => String(g.category)))];

// Invert: category → [guide_ids]
const GUIDES_BY_CATEGORY = {};
for (const [id, cat] of Object.entries(GUIDE_CATEGORY)) {
  if (!GUIDES_BY_CATEGORY[cat]) GUIDES_BY_CATEGORY[cat] = [];
  GUIDES_BY_CATEGORY[cat].push(id);
}

// ── Guide catalog ─────────────────────────────────────────────────────────────

/**
 * GET /api/learn/guides
 * Public — no auth required.
 * Returns the Learn guide catalog so web + native stay in sync.
 */
exports.getGuides = async (_req, res) => {
  res.json({ guides: GUIDES });
};

// ── Public stats ──────────────────────────────────────────────────────────────

/**
 * GET /api/learn/stats
 * Public — no auth required.
 * Returns per-guide completion and view counts for social-proof display.
 * Fails open on missing tables (guide_view_events may not exist yet).
 */
exports.getGuideStats = async (req, res, next) => {
  try {
    const { rows: completionRows } = await pool.query(
      `SELECT guide_id, COUNT(*)::int AS completion_count
       FROM user_guide_completions
       GROUP BY guide_id`,
    );

    // guide_view_events may not exist yet — fail open
    let viewRows = [];
    try {
      ({ rows: viewRows } = await pool.query(
        `SELECT guide_id, COUNT(*)::int AS view_count
         FROM guide_view_events
         GROUP BY guide_id`,
      ));
    } catch (_) { /* table absent — views default to 0 */ }

    const stats = {};
    completionRows.forEach((r) => {
      stats[r.guide_id] = { completions: r.completion_count, views: 0 };
    });
    viewRows.forEach((r) => {
      if (!stats[r.guide_id]) stats[r.guide_id] = { completions: 0, views: 0 };
      stats[r.guide_id].views = r.view_count;
    });

    res.json({ stats });
  } catch (err) {
    next(new AppError('Failed to fetch guide stats', 500, 'fetch_stats_failed'));
  }
};

/**
 * POST /api/learn/views
 * Body: { guide_id }
 * Anonymous-friendly — records a guide view. Always returns 200 so the
 * client fire-and-forget call never surfaces an error to the user.
 * Unknown guide_ids are silently ignored.
 */
exports.recordView = async (req, res) => {
  const { guide_id } = req.body;
  if (!guide_id || !KNOWN_GUIDE_IDS.has(String(guide_id))) {
    return res.json({ success: true });
  }
  const userId = req.user?.id ?? null;
  // Fire-and-forget — guide_view_events may not exist yet
  pool.query(
    `INSERT INTO guide_view_events (guide_id, user_id) VALUES ($1, $2)`,
    [guide_id, userId],
  ).catch(() => {});
  res.json({ success: true });
};

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

    let badgeAwarded = null;

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

      // Check for category badge — all guides in the category now complete?
      const category = GUIDE_CATEGORY[guide_id];
      const categoryGuides = category ? GUIDES_BY_CATEGORY[category] : null;
      if (categoryGuides) {
        const { rows: completedRows } = await client.query(
          `SELECT guide_id FROM user_guide_completions
           WHERE user_id = $1 AND guide_id = ANY($2)`,
          [req.user.id, categoryGuides],
        );
        if (completedRows.length === categoryGuides.length) {
          // All guides in this category done — award badge (fail open)
          await client.query(
            `INSERT INTO skill_badges (user_id, category)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [req.user.id, category],
          ).catch(() => {});
          badgeAwarded = category;
        }
      }
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      xp_awarded: isNew ? xp : 0,
      already_completed: !isNew,
      badge_awarded: badgeAwarded,
    });
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

// ── Badges ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/learn/badges
 * Returns the authenticated user's earned skill badges.
 * Fails open if skill_badges table is absent (migration 284 not yet applied).
 */
exports.getBadges = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT category, awarded_at FROM skill_badges WHERE user_id = $1 ORDER BY awarded_at DESC`,
      [req.user.id],
    );
    res.json({ badges: rows });
  } catch (err) {
    // Table may not exist yet — return empty array so the client degrades gracefully
    res.json({ badges: [] });
  }
};

// ── Product link overrides ────────────────────────────────────────────────────
// Admin manages rows in learn_product_links; the iOS app overlays them on the
// hardcoded LearnGuideCatalog at startup. No app update required to change a URL.

const VALID_LINK_TYPES = ['amazon_affiliate', 'own_inventory', 'partner', 'rental'];

/**
 * GET /api/learn/product-links
 * Public — no auth. Returns all active overrides.
 * The iOS app calls this on every refresh; returns [] gracefully if table absent.
 */
exports.getProductLinks = async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, guide_id, tool_name, link_type, buy_url, rent_url, affiliate_tag, is_active
       FROM learn_product_links
       WHERE is_active = TRUE
       ORDER BY guide_id NULLS LAST, LOWER(tool_name)`,
    );
    res.json({ products: rows });
  } catch (_err) {
    // Migration not yet applied — fail open so the app uses its hardcoded catalog
    res.json({ products: [] });
  }
};

/**
 * GET /api/admin/learn/product-links
 * Admin — returns all rows (active + inactive) with audit fields.
 */
exports.adminListProductLinks = async (req, res, next) => {
  try {
    const { guide_id, link_type, is_active } = req.query;
    const conditions = [];
    const values = [];

    if (guide_id)  { values.push(guide_id);  conditions.push(`guide_id = $${values.length}`); }
    if (link_type) { values.push(link_type); conditions.push(`link_type = $${values.length}`); }
    if (is_active !== undefined) {
      values.push(is_active === 'true');
      conditions.push(`is_active = $${values.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT l.*, u.email AS created_by_email
       FROM learn_product_links l
       LEFT JOIN users u ON u.id = l.created_by
       ${where}
       ORDER BY l.guide_id NULLS LAST, LOWER(l.tool_name), l.created_at DESC`,
      values,
    );
    res.json({ products: rows });
  } catch (err) {
    next(new AppError('Failed to list product links', 500, 'list_failed'));
  }
};

/**
 * POST /api/admin/learn/product-links
 * Admin — create a new product link override.
 */
exports.adminCreateProductLink = async (req, res, next) => {
  try {
    const { guide_id, tool_name, link_type, buy_url, rent_url, affiliate_tag, is_active } = req.body;

    if (!tool_name?.trim()) return next(new AppError('tool_name is required', 400, 'validation'));
    if (!VALID_LINK_TYPES.includes(link_type)) {
      return next(new AppError(`link_type must be one of: ${VALID_LINK_TYPES.join(', ')}`, 400, 'validation'));
    }

    // Enforce no-cloaking compliance for Amazon links
    if (link_type === 'amazon_affiliate' && buy_url) {
      if (!/^https?:\/\/(www\.)?amazon\.(com|ca|co\.uk|com\.au|de|fr|it|es|co\.jp)/i.test(buy_url)) {
        return next(new AppError(
          'Amazon affiliate links must go directly to an amazon.com domain. No redirects or URL shorteners are allowed per Amazon Associates policy.',
          400, 'compliance_violation',
        ));
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO learn_product_links
         (guide_id, tool_name, link_type, buy_url, rent_url, affiliate_tag, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        guide_id?.trim() || null,
        tool_name.trim(),
        link_type,
        buy_url?.trim() || null,
        rent_url?.trim() || null,
        affiliate_tag?.trim() || null,
        is_active !== false,
        req.user.id,
      ],
    );
    res.status(201).json({ product: rows[0] });
  } catch (err) {
    next(new AppError('Failed to create product link', 500, 'create_failed'));
  }
};

/**
 * PUT /api/admin/learn/product-links/:id
 * Admin — update any field. Partial updates supported.
 */
exports.adminUpdateProductLink = async (req, res, next) => {
  try {
    const { id } = req.params;
    const allowed = ['guide_id', 'tool_name', 'link_type', 'buy_url', 'rent_url', 'affiliate_tag', 'is_active'];
    const updates = [];
    const values = [];

    for (const field of allowed) {
      if (field in req.body) {
        values.push(field === 'guide_id' && req.body[field] === '' ? null : req.body[field]);
        updates.push(`${field} = $${values.length}`);
      }
    }

    if (!updates.length) return next(new AppError('No fields to update', 400, 'validation'));

    // Enforce compliance if buy_url or link_type is being changed
    const newLinkType = req.body.link_type;
    const newBuyUrl   = req.body.buy_url;
    if ((newLinkType === 'amazon_affiliate' || (!newLinkType)) && newBuyUrl) {
      // Fetch current link_type if not in body
      const { rows: cur } = await pool.query('SELECT link_type FROM learn_product_links WHERE id=$1', [id]);
      const effectiveType = newLinkType || cur[0]?.link_type;
      if (effectiveType === 'amazon_affiliate' &&
          !/^https?:\/\/(www\.)?amazon\.(com|ca|co\.uk|com\.au|de|fr|it|es|co\.jp)/i.test(newBuyUrl)) {
        return next(new AppError(
          'Amazon affiliate links must go directly to an amazon.com domain.',
          400, 'compliance_violation',
        ));
      }
    }

    values.push(id);
    const { rows } = await pool.query(
      `UPDATE learn_product_links SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length} RETURNING *`,
      values,
    );
    if (!rows.length) return next(new AppError('Product link not found', 404, 'not_found'));
    res.json({ product: rows[0] });
  } catch (err) {
    next(new AppError('Failed to update product link', 500, 'update_failed'));
  }
};

/**
 * DELETE /api/admin/learn/product-links/:id
 * Admin — soft-delete by default (sets is_active = false).
 * Pass ?permanent=true to hard-delete.
 */
exports.adminDeleteProductLink = async (req, res, next) => {
  try {
    const { id } = req.params;
    const permanent = req.query.permanent === 'true';

    if (permanent) {
      const { rowCount } = await pool.query('DELETE FROM learn_product_links WHERE id = $1', [id]);
      if (!rowCount) return next(new AppError('Product link not found', 404, 'not_found'));
      return res.json({ success: true, deleted: true });
    }

    const { rows } = await pool.query(
      `UPDATE learn_product_links SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 RETURNING id, tool_name, is_active`,
      [id],
    );
    if (!rows.length) return next(new AppError('Product link not found', 404, 'not_found'));
    res.json({ success: true, product: rows[0] });
  } catch (err) {
    next(new AppError('Failed to delete product link', 500, 'delete_failed'));
  }
};
