/**
 * franchiseTerritoryController.js
 *
 * Territory-scoped KPIs for launched franchise operators.
 *
 * G12-B4 (D-648): the rollup is the operator's OWN territory — helpers
 * are the territory roster, jobs are the territory's locations, royalties
 * are this territory's accruals — never the city marketplace snapshot.
 * Each KPI source tracks its own failure: a missing table or a thrown
 * query marks the source in `data_unavailable` instead of silently
 * returning a zero the operator would read as "none".
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

// G12-B4 (D-648): per-request tracked variant of safeQuery for the stats
// endpoint. A failed source records its name in `unavailable` so the
// response can say the number is unknown instead of showing a 0.
const makeTrackedQuery = (unavailable) => async (source, sql, params = []) => {
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
  } catch (e) {
    logger.warn('[franchise-territory] query skipped', { source, msg: e.message });
    unavailable.add(source);
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

// Mirrors superAdminController.parseRevenueCurrency: a validated 3-letter
// ISO code, default USD. Territory revenue must name one currency; summing
// cents across currencies as dollars is meaningless.
const parseTerritoryCurrency = (query) => {
  const currency = String(query && query.currency ? query.currency : 'usd').toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) {
    return { error: 'Invalid currency. Use a 3-letter ISO code.' };
  }
  return { currency };
};

// ── GET /api/franchise/territory-stats ───────────────────────────────────────
exports.getTerritoryStats = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });

    // G-26: resolve per application id from the URL (?application_id=)
    // instead of newest-wins. Without it the newest launched application
    // is still the default, so existing clients keep working.
    const requestedApplicationId = typeof req.query?.application_id === 'string'
      && /^[0-9a-f-]{36}$/i.test(req.query.application_id)
      ? req.query.application_id
      : null;
    if (req.query?.application_id && !requestedApplicationId) {
      return res.status(400).json({ error: 'Invalid application_id.' });
    }

    // Resolve the user's launched franchise application
    const appParams = [userId];
    let applicationFilter = '';
    if (requestedApplicationId) {
      appParams.push(requestedApplicationId);
      applicationFilter = `AND fa.id = $${appParams.length}`;
    }
    // G12-B4 (D-648): the application row is a direct query, not
    // safeQuery. A failure here is a database error, and answering
    // has_territory:false for it would tell the operator they have no
    // franchise when the lookup itself failed. The outer catch turns
    // it into a 500; the KPI sources below stay fail-open, tracked.
    const { rows: appRows } = await pool.query(`
      SELECT fa.id, fa.desired_country, fa.desired_region, fa.desired_city,
             fa.status, fa.agreement_status, fa.training_status,
             fa.launch_readiness_status, fa.linked_business_id,
             fa.desired_brand_name, fa.current_company_name,
             fa.acceptance_status,
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
       -- G12-B1 (D-638): approved/launched territories resolve by owner
       -- only. The applicant leg used to keep serving the rollup to the
       -- outgoing operator after an approved handoff.
       WHERE fa.owner_user_id = $1
         AND fa.status IN ('approved','launched')
         ${applicationFilter}
       ORDER BY fa.submitted_at DESC
       LIMIT 1
    `, appParams);
    const [appRow] = appRows;

    if (!appRow) {
      return res.json({
        has_territory: false,
        message: 'No active or launched franchise found for this user.',
      });
    }

    // Group 12 Slice 3b (606, D-307): the operator surface unlocks only
    // after the operator accepts the assignment. While an offer is
    // outstanding or declined the territory stays locked; legacy
    // applications with no offer yet (not_offered) keep the existing
    // behaviour, and the grant still mints at launch (unchanged).
    if (['offered', 'declined'].includes(appRow.acceptance_status)) {
      return res.json({
        has_territory: false,
        acceptance_status: appRow.acceptance_status,
        message: 'Territory assignment is awaiting your acceptance.',
      });
    }

    const country = appRow.desired_country;
    const region  = appRow.desired_region;
    const city    = appRow.desired_city;

    // G12-B4 (D-648): per-source failure tracking for this response.
    // A source that cannot be read lands in `data_unavailable` and the
    // page shows an "unavailable" state for its tiles instead of a 0.
    const unavailable = new Set();
    const trackedQuery = makeTrackedQuery(unavailable);

    // ── Territory locations ──────────────────────────────────────
    // The territory's own footprint: every job and per-location row is
    // scoped to these locations, never to the application's desired
    // city/region. A location with no city falls back to a region/state
    // match; a job's state is a 2-letter code while a region is a full
    // name ('TX' vs 'Texas'), so the state leg only fires when there
    // is no city to match on.
    const [hasLocations, hasHP, hasJobs, hasLedger, hasAgreements, hasFeeAccruals] = await Promise.all([
      tableExists('franchise_locations'),
      tableExists('helper_profiles'),
      tableExists('jobs'),
      tableExists('platform_ledger'),
      tableExists('franchise_agreements'),
      tableExists('franchise_marketing_fee_accruals'),
    ]);
    if (!hasLocations) unavailable.add('locations');
    if (!hasHP) unavailable.add('helpers');
    if (!hasJobs) unavailable.add('jobs');
    if (!hasLedger) unavailable.add('revenue');
    if (!hasAgreements || !hasFeeAccruals) unavailable.add('royalties');

    let locations = [];
    if (hasLocations) {
      locations = await trackedQuery('locations', `
        SELECT id, name, city, region, country, status
          FROM franchise_locations
         WHERE application_id = $1
         ORDER BY created_at ASC
      `, [appRow.id]);
    }
    const locationRows = locations.map((loc) => ({
      location_id: loc.id,
      location_name: loc.name,
      city: loc.city,
      region: loc.region,
      country: loc.country,
      status: loc.status,
      jobs_posted_30d: 0,
      jobs_completed_30d: 0,
      jobs_cancelled_30d: 0,
      jobs_active: 0,
      completion_rate: null,
    }));
    // A job belongs to a location when its city matches the location's
    // city (case-insensitive), or — only when the location has no city —
    // when its state matches the location's region. The old rollup
    // compared a job's state to the application's desired city, a
    // disjunct that could never match; it is gone.
    const locationJobPredicate = `
      (
        (fl.city IS NOT NULL AND j.location_city IS NOT NULL
         AND LOWER(j.location_city) = LOWER(fl.city))
        OR
        (fl.city IS NULL AND fl.region IS NOT NULL AND j.location_state IS NOT NULL
         AND LOWER(j.location_state) = LOWER(fl.region))
      )
    `;

    // ── Territory helpers: the roster, not the city ──────────────
    // G12-B4 (D-648): helpers_total used to count every profiled helper
    // in the application's desired city, so two operators in one city
    // saw identical numbers including competitors' helpers. It now
    // counts the territory's own team: opening-team members plus
    // accepted invitees, restricted to members who hold a helper
    // profile (an invitee without one is a manager or contact, not a
    // helper). Inactive or deleted users drop out of the count.
    let helpers_total = 0, helpers_verified = 0, avg_rating = null;
    if (hasHP) {
      const [hr] = await trackedQuery('helpers', `
        SELECT
          COUNT(*)                                                         AS total,
          COUNT(*) FILTER (WHERE hp.is_identity_verified OR hp.is_background_checked) AS verified,
          ROUND(AVG(hp.avg_rating) FILTER (WHERE hp.total_reviews >= 3), 2) AS avg_rating
          FROM (
            SELECT helper_user_id AS user_id
              FROM franchise_opening_team_members
             WHERE application_id = $1
            UNION
            SELECT u.id
              FROM franchise_territory_invitations i
              JOIN users u ON LOWER(u.email) = LOWER(i.email)
             WHERE i.application_id = $1 AND i.status = 'accepted'
          ) roster
          JOIN users u ON u.id = roster.user_id AND u.is_active = TRUE AND u.deleted_at IS NULL
          JOIN helper_profiles hp ON hp.user_id = roster.user_id
      `, [appRow.id]);
      helpers_total    = safeInt(hr?.total);
      helpers_verified = safeInt(hr?.verified);
      avg_rating       = hr?.avg_rating ? safeFlt(hr.avg_rating) : null;
    }

    // ── Territory jobs: the locations, one window ────────────────
    // G12-B4 (D-648): jobs used to be every job in the desired city
    // with a lifetime completed/cancelled count against a 30-day posted
    // count, so the completion rate mixed windows and the numbers were
    // the city's, not the territory's. Jobs are now the territory's
    // locations only, and completed/cancelled/posted all share the
    // 30-day window, so completion_rate is a 30-day rate. jobs_active
    // stays a live in_progress count with no window.
    let jobs_posted = 0, jobs_completed = 0, jobs_active = 0, completion_rate = null;
    if (hasJobs && locations.length > 0) {
      const [jr] = await trackedQuery('jobs', `
        SELECT
          COUNT(*) FILTER (WHERE j.created_at >= now() - interval '30 days') AS posted_30d,
          COUNT(*) FILTER (WHERE j.status = 'completed' AND j.created_at >= now() - interval '30 days') AS completed_30d,
          COUNT(*) FILTER (WHERE j.status = 'cancelled' AND j.created_at >= now() - interval '30 days') AS cancelled_30d,
          COUNT(*) FILTER (WHERE j.status = 'in_progress') AS active
          FROM jobs j
         WHERE EXISTS (
           SELECT 1 FROM franchise_locations fl
            WHERE fl.application_id = $1 AND ${locationJobPredicate}
         )
      `, [appRow.id]);
      jobs_posted    = safeInt(jr?.posted_30d);
      jobs_active    = safeInt(jr?.active);
      jobs_completed = safeInt(jr?.completed_30d);
      const fin = safeInt(jr?.completed_30d) + safeInt(jr?.cancelled_30d);
      completion_rate = fin > 0 ? Math.round((safeInt(jr?.completed_30d) / fin) * 100) : null;

      // Per-location breakdown: one row per location, so the operator
      // sees which location earned what instead of a single city number.
      const perLocation = await trackedQuery('jobs', `
        SELECT fl.id AS location_id,
               COUNT(j.id) FILTER (WHERE j.created_at >= now() - interval '30 days') AS posted_30d,
               COUNT(j.id) FILTER (WHERE j.status = 'completed' AND j.created_at >= now() - interval '30 days') AS completed_30d,
               COUNT(j.id) FILTER (WHERE j.status = 'cancelled' AND j.created_at >= now() - interval '30 days') AS cancelled_30d,
               COUNT(j.id) FILTER (WHERE j.status = 'in_progress') AS active
          FROM franchise_locations fl
          LEFT JOIN jobs j ON ${locationJobPredicate}
         WHERE fl.application_id = $1
         GROUP BY fl.id
      `, [appRow.id]);
      const byLocation = new Map(perLocation.map((row) => [String(row.location_id), row]));
      for (const row of locationRows) {
        const agg = byLocation.get(String(row.location_id));
        if (!agg) continue;
        row.jobs_posted_30d = safeInt(agg.posted_30d);
        row.jobs_completed_30d = safeInt(agg.completed_30d);
        row.jobs_cancelled_30d = safeInt(agg.cancelled_30d);
        row.jobs_active = safeInt(agg.active);
        const locFin = row.jobs_completed_30d + row.jobs_cancelled_30d;
        row.completion_rate = locFin > 0
          ? Math.round((row.jobs_completed_30d / locFin) * 100)
          : null;
      }
    }

    // ── Revenue (linked business, 30d) ───────────────────────────
    // Currency-scoped (default USD): previously all currencies were summed
    // as dollars. The caller selects via ?currency=; the response names the
    // currency so the tile cannot be read as dollars when it is not.
    const { currency: revenueCurrency, error: revenueCurrencyError } = parseTerritoryCurrency(req.query);
    if (revenueCurrencyError) {
      return res.status(400).json({ error: revenueCurrencyError });
    }
    let revenue_30d_cents = 0, revenue_total_cents = 0;
    let available_revenue_currencies = [];
    if (hasLedger && appRow.linked_business_id) {
      const [rv] = await trackedQuery('revenue', `
        SELECT
          COALESCE(SUM(amount_cents) FILTER (WHERE amount_cents > 0 AND created_at >= now() - interval '30 days'), 0) AS rev_30d,
          COALESCE(SUM(amount_cents) FILTER (WHERE amount_cents > 0), 0)                                               AS rev_total
        FROM platform_ledger
        WHERE reference_id = $1 AND UPPER(currency) = UPPER($2)
      `, [appRow.linked_business_id, revenueCurrency]);
      revenue_30d_cents   = safeInt(rv?.rev_30d);
      revenue_total_cents = safeInt(rv?.rev_total);
      // Distinct ledger currencies for this business, so the page's currency
      // selector offers real options instead of guessing. Fail-open: an
      // empty list just leaves the selector on the USD default.
      const currencyRows = await trackedQuery('revenue', `
        SELECT DISTINCT UPPER(currency) AS currency
          FROM platform_ledger
         WHERE reference_id = $1 AND currency IS NOT NULL
         ORDER BY currency ASC
      `, [appRow.linked_business_id]);
      available_revenue_currencies = currencyRows
        .map((row) => String(row?.currency || '').toUpperCase())
        .filter((code) => /^[A-Z]{3}$/.test(code));
    }

    // ── Royalties and marketing fees (read-only) ─────────────────
    // G12-B4 (D-648): the operator could not see what their territory
    // owed or had accrued anywhere on the operator side; royalty data
    // lived only in admin surfaces. This is a read-only surface over
    // the same accrual records the royalty service writes — no money
    // moves here and no payment rail is added (D-291: franchise money
    // is record-only).
    let royalties = null;
    if (hasAgreements && hasFeeAccruals) {
      const [agreement] = await trackedQuery('royalties', `
        SELECT id, royalty_bps, marketing_fee_bps,
               marketing_fee_accrued_cents, currency
          FROM franchise_agreements
         WHERE application_id = $1
      `, [appRow.id]);
      // The agreement row is created with the application, so a missing
      // row is a data gap, not "no terms": it lands in data_unavailable.
      if (!agreement) {
        unavailable.add('royalties');
      } else {
        let royalty_30d_cents = 0, royalty_total_cents = 0, marketing_fee_30d_cents = 0;
        if (hasLedger) {
          // Royalty credits land in the owner's ledger with
          // type='franchise_royalty' and the application id in the
          // metadata. No currency filter: the accrual insert never
          // stamps currency, so the rows carry the 'usd' column default
          // whatever currency the revenue event was in; filtering by
          // the agreement currency would zero out every non-USD
          // territory. The sums are reported in the agreement
          // currency; stamping currency on the accrual insert is a
          // follow-up if Emile wants exact currency scoping.
          const [roy] = await trackedQuery('royalties', `
            SELECT
              COALESCE(SUM(amount_cents) FILTER (WHERE created_at >= now() - interval '30 days'), 0) AS roy_30d,
              COALESCE(SUM(amount_cents), 0) AS roy_total
              FROM platform_ledger
             WHERE user_id = $1 AND type = 'franchise_royalty'
               AND metadata->>'application_id' = $2
          `, [userId, String(appRow.id)]);
          royalty_30d_cents = safeInt(roy?.roy_30d);
          royalty_total_cents = safeInt(roy?.roy_total);
        } else {
          unavailable.add('royalties');
        }
        const [fee] = await trackedQuery('royalties', `
          SELECT COALESCE(SUM(marketing_cents), 0) AS fee_30d
            FROM franchise_marketing_fee_accruals
           WHERE agreement_id = $1 AND created_at >= now() - interval '30 days'
        `, [agreement.id]);
        marketing_fee_30d_cents = safeInt(fee?.fee_30d);
        royalties = {
          royalty_bps: agreement.royalty_bps == null ? null : safeInt(agreement.royalty_bps),
          marketing_fee_bps: agreement.marketing_fee_bps == null ? null : safeInt(agreement.marketing_fee_bps),
          royalty_30d_cents,
          royalty_total_cents,
          marketing_fee_30d_cents,
          marketing_fee_total_cents: safeInt(agreement.marketing_fee_accrued_cents),
          currency_code: String(agreement.currency || 'USD').toUpperCase(),
        };
      }
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
        revenue_currency_code: revenueCurrency.toUpperCase(),
        available_revenue_currencies,
      },
      // G12-B4 (D-648): per-location job rows, this territory's royalty
      // and marketing-fee accruals (read-only), and the sources that
      // could not be read. A source in data_unavailable means its
      // numbers are unknown, not zero.
      locations: locationRows,
      royalties,
      data_unavailable: [...unavailable].sort(),
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

    // G-26: same per-application resolution as getTerritoryStats.
    const requestedApplicationId = typeof req.query?.application_id === 'string'
      && /^[0-9a-f-]{36}$/i.test(req.query.application_id)
      ? req.query.application_id
      : null;
    if (req.query?.application_id && !requestedApplicationId) {
      return res.status(400).json({ error: 'Invalid application_id.' });
    }
    const appParams = [userId];
    let applicationFilter = '';
    if (requestedApplicationId) {
      appParams.push(requestedApplicationId);
      applicationFilter = `AND fa.id = $${appParams.length}`;
    }

    const [appRow] = await safeQuery(`
      SELECT fa.id, desired_country, desired_region, desired_city, acceptance_status
        FROM franchise_applications fa
       -- G12-B1 (D-638): owner only on approved/launched, same as stats.
       WHERE owner_user_id = $1
         AND status IN ('approved','launched')
         ${applicationFilter}
       ORDER BY submitted_at DESC LIMIT 1
    `, appParams);

    if (!appRow) return res.json({ helpers: [] });

    // Group 12 Slice 3b (606, D-307): same acceptance lock as
    // getTerritoryStats — no helper roster while the offer is unanswered.
    if (['offered', 'declined'].includes(appRow.acceptance_status)) {
      return res.json({ helpers: [], acceptance_status: appRow.acceptance_status });
    }

    const { desired_region: region, desired_city: city } = appRow;

    // G12-B4 (D-648): this endpoint deliberately stays city-scoped. It
    // is the discovery pool the operator designates opening-team members
    // from (612, D-312), not the 626 performance rollup: scoping it to
    // the existing roster would leave the operator unable to find new
    // helpers to add. The stats rollup in getTerritoryStats is the
    // surface that had to become roster-scoped.
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
        COALESCE(hp.service_city, u.city) AS city,
        COALESCE(hp.service_state, u.state)                  AS state
      FROM helper_profiles hp
      JOIN users u ON u.id = hp.user_id AND u.is_active = TRUE AND u.deleted_at IS NULL
      WHERE ($1::text IS NULL
             OR LOWER(COALESCE(hp.service_city,''))  = LOWER($1)
             OR LOWER(COALESCE(u.city,''))               = LOWER($1))
        AND ($2::text IS NULL
             OR LOWER(COALESCE(hp.service_state,'')) = LOWER($2)
             OR LOWER(COALESCE(u.state,''))              = LOWER($2))
      ORDER BY hp.avg_rating DESC NULLS LAST, hp.total_reviews DESC
      LIMIT 50
    `, [city, region]);

    // Group 12 Slice 3c (612, D-312): opening-team designation rides the
    // roster — each helper carries whether they are on the opening team,
    // with which role and for which location (null = whole territory).
    // A missing opening-team table reads as no designation, never a
    // failure, like the rest of this controller.
    const teamRows = await safeQuery(`
      SELECT id, helper_user_id, location_id, role
        FROM franchise_opening_team_members
       WHERE application_id = $1
    `, [appRow.id]);
    // One helper can hold a territory-wide designation and a
    // location-scoped one; the location-scoped row is the one the roster
    // shows, since the roster is read per location launch.
    const teamByHelper = new Map();
    for (const row of teamRows) {
      const key = String(row.helper_user_id);
      const existing = teamByHelper.get(key);
      if (!existing || (existing.location_id === null && row.location_id !== null)) {
        teamByHelper.set(key, row);
      }
    }
    res.json({
      helpers: helpers.map((helper) => {
        const designation = teamByHelper.get(String(helper.user_id));
        return {
          ...helper,
          opening_team: Boolean(designation),
          opening_team_member_id: designation?.id || null,
          opening_team_role: designation?.role || null,
          opening_team_location_id: designation?.location_id || null,
        };
      }),
    });
  } catch (err) {
    logger.error('[franchise-territory] getTerritoryHelpers error', { err: err.message });
    res.status(500).json({ error: 'Failed to load territory helpers.' });
  }
};
