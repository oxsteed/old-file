/**
 * franchiseTerritoryController.js
 *
 * Territory-scoped KPIs for launched franchise operators.
 * All queries are fail-open (missing tables → zeros).
 *
 * Routes (all under /api/franchise):
 *   GET /territory-stats   — KPIs scoped to the user's franchise territory
 *   GET /territory-helpers — Paginated helper list in territory
 */

const pool   = require('../db');
const logger = require('../utils/logger');

const safeQuery = async (sql, params = []) => {
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
  } catch (e) {
    logger.warn('[franchise-territory] query skipped', { msg: e.message });
    return [];
  }
};

const tableExists = async (name) => {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1`,
    [name],
  ).catch(() => ({ rows: [] }));
  return rows.length > 0;
};

const safeInt = (v) => parseInt(v ?? 0, 10) || 0;
const safeFlt = (v) => parseFloat(v ?? 0) || 0;

// ── GET /api/franchise/territory-stats ───────────────────────────────────────
exports.getTerritoryStats = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });

    // Resolve the user's launched franchise application
    const [appRow] = await safeQuery(`
      SELECT fa.id, fa.desired_country, fa.desired_region, fa.desired_city,
             fa.status, fa.agreement_status, fa.training_status,
             fa.launch_readiness_status, fa.linked_business_id,
             fa.desired_brand_name, fa.current_company_name,
             fa.checklist_completed, fa.checklist_total,
             COALESCE(progress.completed_count, 0) AS checklist_done,
             COALESCE(progress.total_count, 0)     AS checklist_all
        FROM franchise_applications fa
        LEFT JOIN (
          SELECT application_id,
                 COUNT(*) AS total_count,
                 COUNT(*) FILTER (WHERE status IN ('completed','waived')) AS completed_count
            FROM franchise_application_checklist_items
           GROUP BY application_id
        ) progress ON progress.application_id = fa.id
       WHERE (fa.applicant_user_id = $1 OR fa.owner_user_id = $1)
         AND fa.status IN ('approved','launched')
       ORDER BY fa.submitted_at DESC
       LIMIT 1
    `, [userId]);

    if (!appRow) {
      return res.json({
        has_territory: false,
        message: 'No active or launched franchise found for this user.',
      });
    }

    const country = appRow.desired_country;
    const region  = appRow.desired_region;
    const city    = appRow.desired_city;

    // ── Territory helpers ────────────────────────────────────────
    const [hasHP, hasJobs, hasLedger] = await Promise.all([
      tableExists('helper_profiles'),
      tableExists('jobs'),
      tableExists('platform_ledger'),
    ]);

    let helpers_total = 0, helpers_verified = 0, avg_rating = null;
    if (hasHP) {
      // Match helpers by profile location fields (best-effort geo match)
      const [hr] = await safeQuery(`
        SELECT
          COUNT(*)                                                         AS total,
          COUNT(*) FILTER (WHERE is_identity_verified OR is_background_checked) AS verified,
          ROUND(AVG(avg_rating) FILTER (WHERE total_reviews >= 3), 2)     AS avg_rating
        FROM helper_profiles hp
        JOIN users u ON u.id = hp.user_id
        WHERE ($1::text IS NULL OR LOWER(COALESCE(hp.service_area_city,'')) = LOWER($1)
               OR LOWER(COALESCE(u.city,'')) = LOWER($1)
               OR LOWER(COALESCE(hp.location_city,'')) = LOWER($1))
          AND ($2::text IS NULL OR LOWER(COALESCE(hp.service_area_state,'')) = LOWER($2)
               OR LOWER(COALESCE(u.state,'')) = LOWER($2))
      `, [city, region]);
      helpers_total    = safeInt(hr?.total);
      helpers_verified = safeInt(hr?.verified);
      avg_rating       = hr?.avg_rating ? safeFlt(hr.avg_rating) : null;
    }

    // ── Territory jobs (30-day window) ───────────────────────────
    let jobs_posted = 0, jobs_completed = 0, jobs_active = 0, completion_rate = null;
    if (hasJobs) {
      const [jr] = await safeQuery(`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days')              AS posted_30d,
          COUNT(*) FILTER (WHERE status = 'completed')                                   AS completed,
          COUNT(*) FILTER (WHERE status = 'in_progress')                                 AS active,
          COUNT(*) FILTER (WHERE status = 'cancelled')                                   AS cancelled
        FROM jobs
        WHERE ($1::text IS NULL OR LOWER(COALESCE(location_city,'')) = LOWER($1)
               OR LOWER(COALESCE(location_state,'')) = LOWER($1))
          AND ($2::text IS NULL OR LOWER(COALESCE(location_state,'')) = LOWER($2))
      `, [city || region, region]);
      jobs_posted    = safeInt(jr?.posted_30d);
      jobs_active    = safeInt(jr?.active);
      jobs_completed = safeInt(jr?.completed);
      const fin = safeInt(jr?.completed) + safeInt(jr?.cancelled);
      completion_rate = fin > 0 ? Math.round((safeInt(jr?.completed) / fin) * 100) : null;
    }

    // ── Revenue (linked business, 30d) ───────────────────────────
    let revenue_30d_cents = 0, revenue_total_cents = 0;
    if (hasLedger && appRow.linked_business_id) {
      const [rv] = await safeQuery(`
        SELECT
          COALESCE(SUM(amount_cents) FILTER (WHERE amount_cents > 0 AND created_at >= now() - interval '30 days'), 0) AS rev_30d,
          COALESCE(SUM(amount_cents) FILTER (WHERE amount_cents > 0), 0)                                               AS rev_total
        FROM platform_ledger
        WHERE reference_id = $1
      `, [appRow.linked_business_id]);
      revenue_30d_cents   = safeInt(rv?.rev_30d);
      revenue_total_cents = safeInt(rv?.rev_total);
    }

    // ── Compliance score ─────────────────────────────────────────
    const checklist_done = safeInt(appRow.checklist_done);
    const checklist_all  = safeInt(appRow.checklist_all);
    const compliance_pct = checklist_all > 0
      ? Math.round((checklist_done / checklist_all) * 100)
      : null;

    res.json({
      has_territory: true,
      application: {
        id: appRow.id,
        status: appRow.status,
        agreement_status: appRow.agreement_status,
        training_status: appRow.training_status,
        launch_readiness_status: appRow.launch_readiness_status,
        linked_business_id: appRow.linked_business_id,
        brand_name: appRow.desired_brand_name || appRow.current_company_name,
        country,
        region,
        city,
        checklist_done,
        checklist_all,
        compliance_pct,
      },
      territory_kpis: {
        helpers_total,
        helpers_verified,
        avg_rating,
        jobs_posted_30d:   jobs_posted,
        jobs_active,
        jobs_completed,
        completion_rate,
        revenue_30d_cents,
        revenue_total_cents,
      },
    });
  } catch (err) {
    logger.error('[franchise-territory] getTerritoryStats error', { err: err.message });
    res.status(500).json({ error: 'Failed to load territory stats.' });
  }
};

// ── GET /api/franchise/territory-helpers ─────────────────────────────────────
exports.getTerritoryHelpers = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });

    const [appRow] = await safeQuery(`
      SELECT desired_country, desired_region, desired_city
        FROM franchise_applications
       WHERE (applicant_user_id = $1 OR owner_user_id = $1)
         AND status IN ('approved','launched')
       ORDER BY submitted_at DESC LIMIT 1
    `, [userId]);

    if (!appRow) return res.json({ helpers: [] });

    const { desired_region: region, desired_city: city } = appRow;

    const hasHP = await tableExists('helper_profiles');
    if (!hasHP) return res.json({ helpers: [] });

    const helpers = await safeQuery(`
      SELECT
        hp.user_id,
        hp.avg_rating,
        hp.total_reviews,
        hp.is_identity_verified,
        hp.is_background_checked,
        hp.is_available_now,
        u.first_name,
        u.last_name,
        u.email,
        COALESCE(hp.service_area_city, u.city, hp.location_city) AS city,
        COALESCE(hp.service_area_state, u.state)                  AS state
      FROM helper_profiles hp
      JOIN users u ON u.id = hp.user_id
      WHERE ($1::text IS NULL
             OR LOWER(COALESCE(hp.service_area_city,''))  = LOWER($1)
             OR LOWER(COALESCE(u.city,''))               = LOWER($1)
             OR LOWER(COALESCE(hp.location_city,''))     = LOWER($1))
        AND ($2::text IS NULL
             OR LOWER(COALESCE(hp.service_area_state,'')) = LOWER($2)
             OR LOWER(COALESCE(u.state,''))              = LOWER($2))
      ORDER BY hp.avg_rating DESC NULLS LAST, hp.total_reviews DESC
      LIMIT 50
    `, [city, region]);

    res.json({ helpers });
  } catch (err) {
    logger.error('[franchise-territory] getTerritoryHelpers error', { err: err.message });
    res.status(500).json({ error: 'Failed to load territory helpers.' });
  }
};
