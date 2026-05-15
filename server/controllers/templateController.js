// server/controllers/templateController.js
// Profile Template System — pricing, access, grant, activate

const pool   = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');

// ── Public: list all templates with pricing ────────────────────────────────
exports.listTemplates = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT slug, name, category, is_free,
              monthly_price_cents, lifetime_price_cents,
              bundle_monthly_cents, bundle_lifetime_cents,
              sort_order, is_active
       FROM template_pricing
       WHERE is_active = TRUE
       ORDER BY sort_order ASC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
};

// ── Auth: get templates the current user has access to ─────────────────────
exports.getMyAccess = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ta.id, ta.template_slug, ta.access_type, ta.grant_type,
              ta.start_date, ta.expiry_date, ta.status,
              tp.name, tp.category
       FROM template_access ta
       JOIN template_pricing tp ON tp.slug = ta.template_slug
       WHERE ta.user_id = $1 AND ta.status = 'active'
         AND (ta.expiry_date IS NULL OR ta.expiry_date > NOW())
       ORDER BY ta.created_at DESC`,
      [req.user.id]
    );
    // 'default' is always accessible
    const hasSlugs = rows.map(r => r.template_slug);
    if (!hasSlugs.includes('default')) {
      rows.unshift({ template_slug: 'default', name: 'Default', category: 'general', access_type: 'free', status: 'active', expiry_date: null });
    }
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
};

// ── Auth: get active template for helper profile or business ───────────────
exports.getActiveTemplate = async (req, res, next) => {
  try {
    const { type, bizId } = req.query; // 'helper' | 'business'
    let row;
    if (type === 'business') {
      if (bizId) {
        // Per-business: only the requested business; verify the caller has
        // owner/manager access to it.
        const { rows } = await pool.query(
          `SELECT b.active_template
             FROM businesses b
            WHERE b.id = $1
              AND b.is_active = TRUE
              AND (
                b.user_id = $2
                OR EXISTS (
                  SELECT 1 FROM business_members bm
                   WHERE bm.business_id = b.id
                     AND bm.member_id   = $2
                     AND bm.role IN ('manager','representative')
                     AND bm.status      = 'active'
                )
              )
            LIMIT 1`,
          [bizId, req.user.id]
        );
        row = rows[0];
      } else {
        const { rows } = await pool.query(
          `SELECT active_template FROM businesses WHERE user_id = $1 AND is_active = TRUE LIMIT 1`,
          [req.user.id]
        );
        row = rows[0];
      }
    } else {
      const { rows } = await pool.query(
        `SELECT active_template FROM helper_profiles WHERE user_id = $1 LIMIT 1`,
        [req.user.id]
      );
      row = rows[0];
    }
    res.json({ success: true, active_template: row?.active_template || 'default' });
  } catch (err) {
    next(err);
  }
};

// ── Auth: activate a template (must have access) ───────────────────────────
exports.activateTemplate = async (req, res, next) => {
  try {
    // type: 'helper' | 'business'
    // bizId: optional - when type=business, scopes the change to a single
    //                   business. If omitted, all of the user's active
    //                   businesses are updated (legacy bulk apply).
    const { slug, type, bizId } = req.body;

    if (!slug || !type) {
      throw new AppError('slug and type are required', 400, 'missing_fields');
    }
    if (!['helper', 'business'].includes(type)) {
      throw new AppError('type must be helper or business', 400, 'invalid_type');
    }

    // Verify slug exists
    const tplRes = await pool.query(
      `SELECT slug, is_free FROM template_pricing WHERE slug = $1 AND is_active = TRUE`,
      [slug]
    );
    if (!tplRes.rows.length) {
      throw new AppError('Template not found', 404, 'template_not_found');
    }

    const isFree = tplRes.rows[0].is_free || slug === 'default';

    // Check access (free templates are always accessible)
    if (!isFree) {
      const accessRes = await pool.query(
        `SELECT id FROM template_access
         WHERE user_id = $1 AND template_slug = $2 AND status = 'active'
           AND (expiry_date IS NULL OR expiry_date > NOW())
         LIMIT 1`,
        [req.user.id, slug]
      );
      if (!accessRes.rows.length) {
        throw new AppError('You do not have access to this template', 403, 'template_access_denied');
      }
    }

    // Apply
    if (type === 'business') {
      if (bizId) {
        // Per-business: only flip the chosen business; verify ownership / mgmt.
        const accessRes = await pool.query(
          `SELECT b.id FROM businesses b
            WHERE b.id = $1
              AND b.is_active = TRUE
              AND (
                b.user_id = $2
                OR EXISTS (
                  SELECT 1 FROM business_members bm
                   WHERE bm.business_id = b.id
                     AND bm.member_id   = $2
                     AND bm.role        = 'manager'
                     AND bm.status      = 'active'
                )
              )`,
          [bizId, req.user.id]
        );
        if (!accessRes.rows.length) {
          throw new AppError('Business not found or you cannot manage it', 404, 'business_not_found');
        }
        await pool.query(
          `UPDATE businesses SET active_template = $1, updated_at = NOW() WHERE id = $2`,
          [slug, bizId]
        );
      } else {
        await pool.query(
          `UPDATE businesses SET active_template = $1, updated_at = NOW()
           WHERE user_id = $2 AND is_active = TRUE`,
          [slug, req.user.id]
        );
      }
    } else {
      await pool.query(
        `UPDATE helper_profiles SET active_template = $1, updated_at = NOW()
         WHERE user_id = $2`,
        [slug, req.user.id]
      );
    }

    logger.info('Template activated', { userId: req.user.id, slug, type, bizId: bizId || null });
    res.json({ success: true, active_template: slug, bizId: bizId || null });
  } catch (err) {
    next(err);
  }
};

// ── Auth: purchase a template (DEPRECATED - lifetime deals removed)
// All templates now use monthly subscription model only
exports.purchaseLifetime = async (req, res, next) => {
  try {
    throw new AppError('Lifetime template purchases are no longer available. All templates are $0.99/month with 1-year free trial on signup.', 400, 'lifetime_deal_removed');
  } catch (err) {
    next(err);
  }
};

// ── Admin: update template pricing ────────────────────────────────────────
exports.adminUpdatePricing = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const {
      monthly_price_cents,
      lifetime_price_cents,
      bundle_monthly_cents,
      bundle_lifetime_cents,
      is_free,
    } = req.body;

    const tplRes = await pool.query(
      `SELECT id FROM template_pricing WHERE slug = $1`,
      [slug]
    );
    if (!tplRes.rows.length) throw new AppError('Template not found', 404, 'template_not_found');

    const { rows } = await pool.query(
      `UPDATE template_pricing SET
         monthly_price_cents   = COALESCE($1, monthly_price_cents),
         lifetime_price_cents  = COALESCE($2, lifetime_price_cents),
         bundle_monthly_cents  = COALESCE($3, bundle_monthly_cents),
         bundle_lifetime_cents = COALESCE($4, bundle_lifetime_cents),
         is_free               = COALESCE($5, is_free),
         updated_at            = NOW()
       WHERE slug = $6
       RETURNING *`,
      [
        monthly_price_cents  !== undefined ? monthly_price_cents  : null,
        lifetime_price_cents !== undefined ? lifetime_price_cents : null,
        bundle_monthly_cents !== undefined ? bundle_monthly_cents : null,
        bundle_lifetime_cents!== undefined ? bundle_lifetime_cents: null,
        is_free              !== undefined ? is_free              : null,
        slug,
      ]
    );

    logger.info('Template pricing updated', { adminId: req.user.id, slug });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
};

// ── Admin: bulk update all template prices ────────────────────────────────
exports.adminBulkUpdatePricing = async (req, res, next) => {
  try {
    // Expects { templates: [{ slug, monthly_price_cents, lifetime_price_cents, ... }] }
    const { templates } = req.body;
    if (!Array.isArray(templates) || templates.length === 0) {
      throw new AppError('templates array is required', 400, 'missing_fields');
    }

    const results = await withTransaction(pool, async (client) => {
      const updated = [];
      for (const t of templates) {
        if (!t.slug) continue;
        const { rows } = await client.query(
          `UPDATE template_pricing SET
             monthly_price_cents   = COALESCE($1, monthly_price_cents),
             lifetime_price_cents  = COALESCE($2, lifetime_price_cents),
             bundle_monthly_cents  = COALESCE($3, bundle_monthly_cents),
             bundle_lifetime_cents = COALESCE($4, bundle_lifetime_cents),
             is_free               = COALESCE($5, is_free),
             updated_at            = NOW()
           WHERE slug = $6
           RETURNING slug, monthly_price_cents, lifetime_price_cents`,
          [
            t.monthly_price_cents   ?? null,
            t.lifetime_price_cents  ?? null,
            t.bundle_monthly_cents  ?? null,
            t.bundle_lifetime_cents ?? null,
            t.is_free               ?? null,
            t.slug,
          ]
        );
        if (rows[0]) updated.push(rows[0]);
      }
      return updated;
    });

    logger.info('Bulk template pricing updated', { adminId: req.user.id, count: results.length });
    res.json({ success: true, updated: results });
  } catch (err) {
    next(err);
  }
};

// ── Admin: grant template access to a user ────────────────────────────────
exports.adminGrantAccess = async (req, res, next) => {
  try {
    const {
      user_id,
      template_slug,
      grant_type,     // 'timed' | 'permanent'
      start_date,
      expiry_date,    // required if grant_type === 'timed'
      internal_note,
    } = req.body;

    // Validation
    const fields = {};
    if (!user_id)        fields.user_id        = 'Required';
    if (!template_slug)  fields.template_slug  = 'Required';
    if (!grant_type)     fields.grant_type     = 'Required';
    if (!['timed','permanent'].includes(grant_type)) fields.grant_type = 'Must be timed or permanent';
    if (grant_type === 'timed' && !expiry_date) fields.expiry_date = 'Required for timed grants';
    if (Object.keys(fields).length) throw new AppError('Validation failed', 400, 'validation_failed', fields);

    // Verify template exists
    const tplRes = await pool.query(`SELECT slug FROM template_pricing WHERE slug = $1`, [template_slug]);
    if (!tplRes.rows.length) throw new AppError('Template not found', 404, 'template_not_found');

    // Verify user exists
    const userRes = await pool.query(`SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL`, [user_id]);
    if (!userRes.rows.length) throw new AppError('User not found', 404, 'user_not_found');

    const { rows } = await pool.query(
      `INSERT INTO template_access
         (user_id, template_slug, access_type, grant_type, granted_by,
          internal_note, start_date, expiry_date, status)
       VALUES ($1, $2, 'admin_grant', $3, $4, $5, $6, $7, 'active')
       RETURNING *`,
      [
        user_id,
        template_slug,
        grant_type,
        req.user.id,
        internal_note || null,
        start_date ? new Date(start_date) : new Date(),
        grant_type === 'permanent' ? null : new Date(expiry_date),
      ]
    );

    logger.info('Admin template access granted', {
      adminId: req.user.id, userId: user_id, slug: template_slug, grant_type,
    });
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
};

// ── Admin: revoke template access ────────────────────────────────────────
exports.adminRevokeAccess = async (req, res, next) => {
  try {
    const { accessId } = req.params;

    const { rows } = await pool.query(
      `UPDATE template_access
       SET status = 'revoked', updated_at = NOW()
       WHERE id = $1 AND status = 'active'
       RETURNING id, user_id, template_slug`,
      [accessId]
    );
    if (!rows.length) throw new AppError('Access record not found or already revoked', 404, 'not_found');

    const access = rows[0];

    // Revert user's active template to default if it was using this slug
    await pool.query(
      `UPDATE businesses SET active_template = 'default', updated_at = NOW()
       WHERE user_id = $1 AND active_template = $2`,
      [access.user_id, access.template_slug]
    );
    await pool.query(
      `UPDATE helper_profiles SET active_template = 'default', updated_at = NOW()
       WHERE user_id = $1 AND active_template = $2`,
      [access.user_id, access.template_slug]
    );

    logger.info('Template access revoked', { adminId: req.user.id, accessId, userId: access.user_id });
    res.json({ success: true, data: access });
  } catch (err) {
    next(err);
  }
};

// ── Admin: list all access grants ────────────────────────────────────────
exports.adminListGrants = async (req, res, next) => {
  try {
    const { user_id, slug, status = 'active', page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (user_id) { conditions.push(`ta.user_id = $${paramIdx++}`); params.push(user_id); }
    if (slug)    { conditions.push(`ta.template_slug = $${paramIdx++}`); params.push(slug); }
    if (status)  { conditions.push(`ta.status = $${paramIdx++}`); params.push(status); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(parseInt(limit), offset);

    const { rows } = await pool.query(
      `SELECT ta.*,
              u.first_name, u.last_name, u.email,
              g.first_name AS granted_by_first, g.last_name AS granted_by_last,
              tp.name AS template_name
       FROM template_access ta
       JOIN users u ON u.id = ta.user_id
       LEFT JOIN users g ON g.id = ta.granted_by
       JOIN template_pricing tp ON tp.slug = ta.template_slug
       ${where}
       ORDER BY ta.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params
    );

    res.json({ success: true, data: rows, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    next(err);
  }
};

// ── Admin: get full template pricing table ────────────────────────────────
exports.adminGetPricing = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM template_pricing ORDER BY sort_order ASC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
};

// ── Utility: grant 1-year free trial on all paid templates to a user ──────
// Called after registration and by migration 167 backfill.
async function grantFreeTrialToUser(userId) {
  try {
    const trialExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO template_access
         (user_id, template_slug, access_type, grant_type,
          start_date, expiry_date, status, internal_note)
       SELECT $1, slug, 'free_trial', 'timed',
              NOW(), $2, 'active', '1-year free trial'
       FROM template_pricing
       WHERE is_free = FALSE AND is_active = TRUE
         AND NOT EXISTS (
           SELECT 1 FROM template_access ta
           WHERE ta.user_id = $1 AND ta.template_slug = template_pricing.slug
             AND ta.access_type = 'free_trial'
         )`,
      [userId, trialExpiry]
    );
    logger.info('Free trial templates granted', { userId });
  } catch (err) {
    logger.error('Failed to grant free trial templates', { userId, error: err.message });
  }
}
exports.grantFreeTrialToUser = grantFreeTrialToUser;

// ── Admin: get stats per template ─────────────────────────────────────────
exports.adminTemplateStats = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         ta.template_slug,
         tp.name,
         COUNT(*) FILTER (WHERE ta.status = 'active') AS active_users,
         COUNT(*) FILTER (WHERE ta.access_type = 'admin_grant' AND ta.status = 'active') AS admin_grants,
         COUNT(*) FILTER (WHERE ta.access_type IN ('purchase_lifetime','purchase_monthly') AND ta.status = 'active') AS purchases,
         (SELECT COUNT(*) FROM businesses b WHERE b.active_template = ta.template_slug) AS business_active,
         (SELECT COUNT(*) FROM helper_profiles hp WHERE hp.active_template = ta.template_slug) AS helper_active
       FROM template_access ta
       JOIN template_pricing tp ON tp.slug = ta.template_slug
       GROUP BY ta.template_slug, tp.name
       ORDER BY active_users DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
};
