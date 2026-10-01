/**
 * learnController.js
 * Endpoints for Learn Mode: guide completions + XP + UGC submissions.
 */

const pool = require('../db');
const AppError = require('../utils/appError');

// ── Constants ─────────────────────────────────────────────────────────────────

const XP_BY_DIFFICULTY = { Easy: 10, Medium: 25, Hard: 50 };
const VALID_DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
const IOS_SUBMISSION_CATEGORIES = [
  'plumbing', 'electrical', 'carpentry', 'hvac', 'painting', 'car-care',
  'landscaping', 'maintenance', 'management', 'customer', 'helper',
  'logistics', 'consulting', 'tool-rental', 'franchise', 'life',
];

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

// Map a learn_guides DB row to the public guide shape.
function dbRowToGuide(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    difficulty: row.difficulty,
    minutes: row.minutes,
    featured: !!row.featured,
    intro: row.intro,
    steps: Array.isArray(row.steps) ? row.steps : [],
    skills: Array.isArray(row.skills) ? row.skills : [],
    tools: Array.isArray(row.tools) ? row.tools : [],
    xp: row.xp,
    video_url: row.video_url || null,
    video_provider: row.video_provider || null,
  };
}

/**
 * GET /api/learn/guides
 * Public — no auth required.
 * Returns the Learn guide catalog so web + native stay in sync.
 * Reads published guides from learn_guides; falls back to the bundled
 * JSON catalog if the table is missing or empty (fail open).
 */
exports.getGuides = async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, category, difficulty, minutes, featured, intro,
              steps, skills, tools, xp, video_url, video_provider
         FROM learn_guides
        WHERE status = 'published'
        ORDER BY featured DESC, created_at ASC`
    );
    if (rows.length) return res.json({ guides: rows.map(dbRowToGuide) });
  } catch (_) {
    // Table missing — fall through to the JSON catalog.
  }
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
      // Award XP to pulse score (learn_guide category).
      // IMPORTANT: a failed statement aborts the ENTIRE Postgres transaction, so
      // a bare `.catch(() => {})` does NOT "fail open" — the subsequent COMMIT is
      // silently turned into a ROLLBACK and the completion above is discarded.
      // Guard each optional write with a SAVEPOINT so a missing/failing table
      // rolls back only that statement and the completion still commits.
      try {
        await client.query('SAVEPOINT sp_pulse');
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
        );
        await client.query('RELEASE SAVEPOINT sp_pulse');
      } catch (_xpErr) {
        // Pulse table missing or insert failed — undo just this statement.
        await client.query('ROLLBACK TO SAVEPOINT sp_pulse').catch(() => {});
      }

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
          // All guides in this category done — award badge (savepoint-guarded).
          try {
            await client.query('SAVEPOINT sp_badge');
            await client.query(
              `INSERT INTO skill_badges (user_id, category)
               VALUES ($1, $2)
               ON CONFLICT DO NOTHING`,
              [req.user.id, category],
            );
            await client.query('RELEASE SAVEPOINT sp_badge');
            badgeAwarded = category;
          } catch (_badgeErr) {
            await client.query('ROLLBACK TO SAVEPOINT sp_badge').catch(() => {});
          }
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
    intro, summary, steps, skills, tools, media_urls, video_url, license_note,
  } = req.body;
  const submissionIntro = intro || summary;
  const estimatedMinutes = Number.isInteger(estimated_minutes)
    ? estimated_minutes
    : Math.min(1440, Math.max(5, (Array.isArray(steps) ? steps.length : 2) * 3));
  const categoryAllowed = VALID_CATEGORIES.includes(category) || IOS_SUBMISSION_CATEGORIES.includes(category);
  const normalizedSkills = Array.isArray(skills) && skills.length > 0
    ? skills
    : [category].filter(Boolean);

  // Validate required fields
  if (!title?.trim())             return next(new AppError('Title is required', 400, 'validation_failed'));
  if (!categoryAllowed)
    return next(new AppError('Invalid category', 400, 'validation_failed'));
  if (!VALID_DIFFICULTIES.includes(difficulty))
    return next(new AppError('Difficulty must be Easy, Medium, or Hard', 400, 'validation_failed'));
  if (!Number.isInteger(estimatedMinutes) || estimatedMinutes < 1 || estimatedMinutes > 1440)
    return next(new AppError('estimated_minutes must be 1–1440', 400, 'validation_failed'));
  if (!submissionIntro?.trim())   return next(new AppError('Intro is required', 400, 'validation_failed'));
  if (!Array.isArray(steps) || steps.length < 2)
    return next(new AppError('At least 2 steps are required', 400, 'validation_failed'));
  if (!Array.isArray(normalizedSkills) || normalizedSkills.length < 1)
    return next(new AppError('At least 1 skill is required', 400, 'validation_failed'));

  // Sanitize
  const cleanSteps  = steps.map(String).filter(Boolean).slice(0, 20);
  const cleanSkills = normalizedSkills.map(String).filter(Boolean).slice(0, 10);
  const cleanTools  = Array.isArray(tools)
    ? tools.slice(0, 12).map((t) => (typeof t === 'string' ? {
        name: t.slice(0, 120),
        buy_url: null,
        rent_url: null,
      } : {
        name: String(t.name || '').slice(0, 120),
        buy_url: t.buy_url ? String(t.buy_url).slice(0, 300) : null,
        rent_url: t.rent_url ? String(t.rent_url).slice(0, 300) : null,
      }))
    : null;
  const mediaNote = Array.isArray(media_urls) && media_urls.length
    ? `Media: ${media_urls.map(String).slice(0, 10).join(', ')}`
    : null;
  const finalLicenseNote = [license_note, mediaNote].filter(Boolean).join('\n').slice(0, 1000) || null;

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
        estimatedMinutes,
        submissionIntro.trim().slice(0, 2000),
        JSON.stringify(cleanSteps),
        JSON.stringify(cleanSkills),
        cleanTools ? JSON.stringify(cleanTools) : null,
        video_url ? String(video_url).slice(0, 500) : null,
        finalLicenseNote,
      ],
    );

    res.status(201).json({ ok: true, success: true, submission: rows[0] });
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: subRows } = await client.query(
      `SELECT id, title, category, difficulty, estimated_minutes, intro,
              steps, skills, tools, video_url
         FROM guide_submissions WHERE id = $1`,
      [id]
    );
    if (!subRows.length) {
      await client.query('ROLLBACK');
      return next(new AppError('Submission not found', 404, 'not_found'));
    }
    const sub = subRows[0];

    const { rows } = await client.query(
      `UPDATE guide_submissions
       SET status = $1, reviewer_id = $2, reviewed_at = NOW(),
           reviewer_note = $3
       WHERE id = $4
       RETURNING id, status`,
      [status, req.user.id, reviewer_note?.trim() || null, id],
    );

    // On approval, also publish the guide to the catalog. Savepoint-guarded:
    // a publish failure never breaks the approval itself.
    let publishedGuideId = null;
    if (status === 'approved') {
      try {
        await client.query('SAVEPOINT sp_publish');
        publishedGuideId = await publishSubmissionAsGuide(client, sub);
        await client.query('RELEASE SAVEPOINT sp_publish');
      } catch (_pubErr) {
        await client.query('ROLLBACK TO SAVEPOINT sp_publish').catch(() => {});
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, submission: rows[0], published_guide_id: publishedGuideId });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(new AppError('Failed to review submission', 500, 'review_failed'));
  } finally {
    client.release();
  }
};

/**
 * Publish an approved UGC submission into the learn_guides catalog.
 * Generates a URL-safe id from the title, uniquifying on collision.
 * Returns the new guide id, or null when the catalog table is absent.
 */
async function publishSubmissionAsGuide(client, sub) {
  const base = String(sub.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'guide';
  let guideId = base;
  for (let n = 2; ; n += 1) {
    const { rows } = await client.query('SELECT 1 FROM learn_guides WHERE id = $1', [guideId]);
    if (!rows.length) break;
    guideId = `${base}-${n}`;
    if (n > 99) throw new Error('could not uniquify guide id');
  }
  const skills = Array.isArray(sub.skills) ? sub.skills.map(String).slice(0, 20) : [];
  const videoUrl = sub.video_url ? String(sub.video_url).slice(0, 500) : null;
  const { rows } = await client.query(
    `INSERT INTO learn_guides
       (id, title, category, difficulty, minutes, featured, intro, steps,
        skills, tools, xp, video_url, video_provider, status)
     VALUES ($1,$2,$3,$4,$5,FALSE,$6,$7::jsonb,$8,$9::jsonb,$10,$11,$12,'published')
     RETURNING id`,
    [
      guideId,
      String(sub.title).slice(0, 300),
      String(sub.category).slice(0, 50),
      sub.difficulty,
      sub.estimated_minutes,
      sub.intro ? String(sub.intro).slice(0, 4000) : null,
      JSON.stringify(Array.isArray(sub.steps) ? sub.steps.slice(0, 40) : []),
      skills,
      JSON.stringify(Array.isArray(sub.tools) ? sub.tools.slice(0, 20) : []),
      XP_BY_DIFFICULTY[sub.difficulty] ?? 10,
      videoUrl,
      detectVideoProvider(videoUrl),
    ]
  );
  return rows[0]?.id || null;
}

function detectVideoProvider(url) {
  if (!url) return null;
  const u = url.toLowerCase();
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('vimeo.com')) return 'vimeo';
  return 'embed';
}

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

// ── Admin guide catalog CRUD ──────────────────────────────────────────────────

const GUIDE_ID_RE = /^[a-z0-9-]+$/;
const GUIDE_COLUMNS = `id, title, category, difficulty, minutes, featured, intro,
  steps, skills, tools, xp, video_url, video_provider, status, created_at, updated_at`;

function validateGuideBody(body, { requireId = true } = {}) {
  const errors = [];
  if (requireId && !GUIDE_ID_RE.test(String(body.id || ''))) {
    errors.push('id must match /^[a-z0-9-]+$/');
  }
  if (body.title !== undefined && !String(body.title).trim()) errors.push('title is required');
  if (body.category !== undefined && !String(body.category).trim()) errors.push('category is required');
  if (body.difficulty !== undefined && !VALID_DIFFICULTIES.includes(body.difficulty)) {
    errors.push('difficulty must be Easy, Medium, or Hard');
  }
  if (body.minutes !== undefined && body.minutes !== null &&
      (!Number.isInteger(body.minutes) || body.minutes < 1)) {
    errors.push('minutes must be a positive integer');
  }
  if (body.steps !== undefined && !Array.isArray(body.steps)) errors.push('steps must be an array');
  if (body.skills !== undefined && !Array.isArray(body.skills)) errors.push('skills must be an array');
  if (body.tools !== undefined && !Array.isArray(body.tools)) errors.push('tools must be an array');
  if (body.xp !== undefined && (!Number.isInteger(body.xp) || body.xp < 0)) {
    errors.push('xp must be a non-negative integer');
  }
  if (body.status !== undefined && !['published', 'draft'].includes(body.status)) {
    errors.push("status must be 'published' or 'draft'");
  }
  if (body.video_url !== undefined && body.video_url !== null &&
      typeof body.video_url === 'string' && body.video_url.length > 500) {
    errors.push('video_url must be 500 characters or fewer');
  }
  return errors;
}

function guideInsertValues(body) {
  return [
    String(body.id),
    String(body.title).trim().slice(0, 300),
    String(body.category).trim().slice(0, 50),
    body.difficulty || 'Easy',
    body.minutes ?? null,
    body.featured === true,
    body.intro ? String(body.intro).slice(0, 4000) : null,
    JSON.stringify(Array.isArray(body.steps) ? body.steps.slice(0, 40) : []),
    (Array.isArray(body.skills) ? body.skills : []).map(String).slice(0, 20),
    JSON.stringify(Array.isArray(body.tools) ? body.tools.slice(0, 20) : []),
    Number.isInteger(body.xp) ? body.xp : (XP_BY_DIFFICULTY[body.difficulty] ?? 10),
    body.video_url ? String(body.video_url).slice(0, 500) : null,
    body.video_provider ? String(body.video_provider).slice(0, 20) : null,
    body.status || 'published',
  ];
}

/**
 * GET /api/admin/learn/guides
 * Admin — all guides including drafts.
 */
exports.adminListGuides = async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${GUIDE_COLUMNS} FROM learn_guides ORDER BY created_at DESC`
    );
    res.json({ guides: rows.map(dbRowToGuide) });
  } catch (err) {
    next(new AppError('Failed to list guides', 500, 'list_guides_failed'));
  }
};

/**
 * POST /api/admin/learn/guides
 * Admin — create a guide.
 */
exports.adminCreateGuide = async (req, res, next) => {
  const errors = validateGuideBody(req.body || {}, { requireId: true });
  if (!req.body?.title?.trim() || !req.body?.category?.trim()) {
    errors.push('title and category are required');
  }
  if (errors.length) return next(new AppError(errors.join('; '), 400, 'validation_failed'));
  try {
    const { rows } = await pool.query(
      `INSERT INTO learn_guides
         (id, title, category, difficulty, minutes, featured, intro, steps,
          skills, tools, xp, video_url, video_provider, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13,$14)
       RETURNING ${GUIDE_COLUMNS}`,
      guideInsertValues(req.body)
    );
    res.status(201).json({ success: true, guide: dbRowToGuide(rows[0]) });
  } catch (err) {
    if (err.code === '23505') return next(new AppError('A guide with this id already exists', 409, 'duplicate_guide_id'));
    next(new AppError('Failed to create guide', 500, 'create_guide_failed'));
  }
};

/**
 * PUT /api/admin/learn/guides/:id
 * Admin — update a guide (partial update; only provided fields change).
 */
exports.adminUpdateGuide = async (req, res, next) => {
  const errors = validateGuideBody(req.body || {}, { requireId: false });
  if (errors.length) return next(new AppError(errors.join('; '), 400, 'validation_failed'));

  const sets = [];
  const values = [];
  let idx = 1;
  const field = (col, val, cast = '') => {
    sets.push(`${col} = $${idx++}${cast}`);
    values.push(val);
  };
  const b = req.body;
  if (b.title !== undefined) field('title', String(b.title).trim().slice(0, 300));
  if (b.category !== undefined) field('category', String(b.category).trim().slice(0, 50));
  if (b.difficulty !== undefined) field('difficulty', b.difficulty);
  if (b.minutes !== undefined) field('minutes', b.minutes);
  if (b.featured !== undefined) field('featured', b.featured === true);
  if (b.intro !== undefined) field('intro', b.intro ? String(b.intro).slice(0, 4000) : null);
  if (b.steps !== undefined) field('steps', JSON.stringify(b.steps.slice(0, 40)), '::jsonb');
  if (b.skills !== undefined) field('skills', b.skills.map(String).slice(0, 20));
  if (b.tools !== undefined) field('tools', JSON.stringify(b.tools.slice(0, 20)), '::jsonb');
  if (b.xp !== undefined) field('xp', b.xp);
  if (b.video_url !== undefined) field('video_url', b.video_url ? String(b.video_url).slice(0, 500) : null);
  if (b.video_provider !== undefined) field('video_provider', b.video_provider ? String(b.video_provider).slice(0, 20) : null);
  if (b.status !== undefined) field('status', b.status);
  if (!sets.length) return next(new AppError('Nothing to update', 400, 'validation_failed'));

  try {
    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE learn_guides SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${idx} RETURNING ${GUIDE_COLUMNS}`,
      values
    );
    if (!rows.length) return next(new AppError('Guide not found', 404, 'not_found'));
    res.json({ success: true, guide: dbRowToGuide(rows[0]) });
  } catch (err) {
    next(new AppError('Failed to update guide', 500, 'update_guide_failed'));
  }
};

/**
 * DELETE /api/admin/learn/guides/:id
 * Admin — hard delete a guide.
 */
exports.adminDeleteGuide = async (req, res, next) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM learn_guides WHERE id = $1', [req.params.id]);
    if (!rowCount) return next(new AppError('Guide not found', 404, 'not_found'));
    res.json({ success: true, deleted: true, id: req.params.id });
  } catch (err) {
    next(new AppError('Failed to delete guide', 500, 'delete_guide_failed'));
  }
};
