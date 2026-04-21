/**
 * Public "Discover" unified search — helpers, jobs, businesses, tools, products.
 * GET /api/discover  (no auth)
 * Saved alerts: GET/POST/DELETE /api/discover/alerts (auth)
 */

const crypto = require('crypto');
const pool = require('../db');
const logger = require('../utils/logger');
const { sendEmail } = require('../utils/email');

const DEFAULT_RADIUS = 60;
const MAX_RADIUS = 150;
const MAX_RESULTS = 50;
const MAX_PATTERNS = 24;

/** Trade / category synonyms for broader matching (v1 heuristic). */
const SYNONYM_GROUPS = [
  ['plumber', 'plumbing', 'pipes', 'drain'],
  ['electric', 'electrical', 'wiring', 'outlet'],
  ['hvac', 'heating', 'cooling', 'air conditioning', 'ac repair', 'furnace'],
  ['clean', 'cleaning', 'maid', 'housekeeping'],
  ['landscape', 'landscaping', 'lawn', 'mowing'],
  ['paint', 'painting', 'painter'],
  ['roof', 'roofing', 'gutter'],
  ['move', 'moving', 'movers', 'relocation'],
  ['carpent', 'carpentry', 'woodwork', 'trim'],
  ['weld', 'welding', 'metalwork'],
  ['pest', 'exterminator', 'rodent'],
  ['pressure wash', 'power wash', 'pressure washer'],
];

function normalizeQuery(q) {
  return String(q || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 200);
}

function expandSearchTerms(raw) {
  const n = normalizeQuery(raw).toLowerCase();
  if (!n) return [];
  const tokens = n.split(/[^a-z0-9+]+/).filter((t) => t.length >= 2);
  const out = new Set();
  for (const t of tokens) {
    out.add(t);
    for (const group of SYNONYM_GROUPS) {
      if (group.some((g) => t.includes(g) || g.includes(t))) {
        group.forEach((g) => out.add(g));
      }
    }
  }
  return [...out].slice(0, 12);
}

function buildPatterns(terms) {
  const pats = [];
  for (const t of terms) {
    pats.push(`%${t}%`);
    if (pats.length >= MAX_PATTERNS) break;
  }
  return pats;
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  const R = 3958.8;
  const r1 = (lat1 * Math.PI) / 180;
  const r2 = (lat2 * Math.PI) / 180;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(r1) * Math.cos(r2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function fingerprintForResults(results) {
  const sig = results
    .map((r) => `${r.type}:${r.id}`)
    .sort()
    .join('|');
  return crypto.createHash('sha256').update(sig).digest('hex');
}

function alertFingerprint(userId, query, radius, lat, lng) {
  const base = [
    userId,
    normalizeQuery(query).toLowerCase(),
    String(radius),
    lat != null ? Number(lat).toFixed(4) : '',
    lng != null ? Number(lng).toFixed(4) : '',
  ].join('|');
  return crypto.createHash('sha256').update(base).digest('hex');
}

/**
 * Run unified discover search. Returns { results: DiscoverResult[] }.
 */
async function runDiscoverSearch({ query, lat, lng, radiusMiles = DEFAULT_RADIUS }) {
  const terms = expandSearchTerms(query);
  const patterns = buildPatterns(terms.length ? terms : [normalizeQuery(query).toLowerCase()].filter(Boolean));
  if (!patterns.length) {
    return { results: [], contentSignature: '' };
  }

  const latN = lat != null && !Number.isNaN(parseFloat(lat)) ? parseFloat(lat) : null;
  const lngN = lng != null && !Number.isNaN(parseFloat(lng)) ? parseFloat(lng) : null;
  const radius = Math.min(MAX_RADIUS, Math.max(5, parseInt(radiusMiles, 10) || DEFAULT_RADIUS));
  const hasGeo = latN != null && lngN != null;

  const results = [];

  try {
    // ── Helpers ─────────────────────────────────────────────────────────────
    const helperParams = [patterns];
    let helperGeo = '';
    if (hasGeo) {
      helperParams.push(latN, lngN, radius);
      helperGeo = ` AND (
        hp.service_lat IS NULL OR hp.service_lng IS NULL OR
        3958.8 * acos(
          GREATEST(-1.0, LEAST(1.0,
            sin(radians($${helperParams.length - 2}::float8)) * sin(radians(hp.service_lat::float8)) +
            cos(radians($${helperParams.length - 2}::float8)) * cos(radians(hp.service_lat::float8)) *
            cos(radians(hp.service_lng::float8 - $${helperParams.length - 1}::float8))
          ))
        ) <= $${helperParams.length}
      )`;
    }
    helperParams.push(12);
    const helperLimitIdx = helperParams.length;
    const { rows: helpers } = await pool.query(
      `SELECT u.id,
              TRIM(u.first_name || ' ' || u.last_name) AS title,
              COALESCE(hp.profile_headline, hp.bio_short, '') AS subtitle,
              hp.profile_photo_url AS image_url,
              hp.service_city, hp.service_state,
              hp.service_lat::float8 AS lat, hp.service_lng::float8 AS lng
       FROM users u
       JOIN helper_profiles hp ON hp.user_id = u.id
       WHERE u.deleted_at IS NULL AND u.role IN ('helper', 'helper_pro', 'broker')
         AND u.email_verified = TRUE AND u.onboarding_completed = TRUE
         AND COALESCE(hp.is_listed, TRUE) = TRUE
         AND (
           LOWER(TRIM(u.first_name || ' ' || u.last_name)) LIKE ANY($1::text[])
           OR LOWER(COALESCE(hp.bio_short, '')) LIKE ANY($1::text[])
           OR LOWER(COALESCE(hp.profile_headline, '')) LIKE ANY($1::text[])
           OR EXISTS (
             SELECT 1 FROM helper_skills hs
             WHERE hs.user_id = u.id AND LOWER(hs.skill_name) LIKE ANY($1::text[])
           )
         )
         ${helperGeo}
       ORDER BY hp.avg_rating DESC NULLS LAST
       LIMIT $${helperLimitIdx}`,
      helperParams,
    );
    for (const h of helpers) {
      const d = hasGeo && h.lat != null && h.lng != null ? haversineMiles(latN, lngN, h.lat, h.lng) : null;
      results.push({
        type: 'helper',
        id: String(h.id),
        title: h.title,
        subtitle: (h.subtitle || '').slice(0, 160),
        url: `/helpers/${h.id}`,
        imageUrl: h.image_url || null,
        meta: [h.service_city, h.service_state].filter(Boolean).join(', ') || null,
        distanceMiles: d,
      });
    }

    // ── Jobs ────────────────────────────────────────────────────────────────
    const jobParams = [patterns, 'published'];
    let jobGeo = '';
    if (hasGeo) {
      jobParams.push(latN, lngN, radius);
      jobGeo = ` AND j.location_approx_lat IS NOT NULL AND j.location_approx_lng IS NOT NULL
        AND (
          3958.8 * acos(
            GREATEST(-1.0, LEAST(1.0,
              sin(radians($${jobParams.length - 2}::float8)) * sin(radians(j.location_approx_lat::float8)) +
              cos(radians($${jobParams.length - 2}::float8)) * cos(radians(j.location_approx_lat::float8)) *
              cos(radians(j.location_approx_lng::float8 - $${jobParams.length - 1}::float8))
            ))
          ) <= $${jobParams.length}
        )`;
    }
    jobParams.push(10);
    const jobLimitIdx = jobParams.length;
    const { rows: jobs } = await pool.query(
      `SELECT j.id, j.title,
              COALESCE(j.category_name, '') AS category,
              j.location_city, j.location_state,
              j.location_approx_lat::float8 AS lat, j.location_approx_lng::float8 AS lng
       FROM jobs j
       JOIN users u ON j.client_id = u.id
       WHERE u.is_active = TRUE AND j.status = $2
         AND (
           LOWER(j.title) LIKE ANY($1::text[])
           OR LOWER(COALESCE(j.description, '')) LIKE ANY($1::text[])
           OR LOWER(COALESCE(j.category_name, '')) LIKE ANY($1::text[])
         )
         ${jobGeo}
       ORDER BY j.created_at DESC
       LIMIT $${jobLimitIdx}`,
      jobParams,
    );
    for (const j of jobs) {
      const d = hasGeo && j.lat != null && j.lng != null ? haversineMiles(latN, lngN, j.lat, j.lng) : null;
      results.push({
        type: 'job',
        id: String(j.id),
        title: j.title,
        subtitle: j.category || '',
        url: `/jobs/${j.id}`,
        meta: [j.location_city, j.location_state].filter(Boolean).join(', ') || null,
        distanceMiles: d,
      });
    }

    // ── Businesses ─────────────────────────────────────────────────────────
    const bizParams = [patterns];
    let bizGeo = '';
    if (hasGeo) {
      bizParams.push(latN, lngN, radius);
      bizGeo = ` AND (
        hp.service_lat IS NULL OR hp.service_lng IS NULL OR
        3958.8 * acos(
          GREATEST(-1.0, LEAST(1.0,
            sin(radians($${bizParams.length - 2}::float8)) * sin(radians(hp.service_lat::float8)) +
            cos(radians($${bizParams.length - 2}::float8)) * cos(radians(hp.service_lat::float8)) *
            cos(radians(hp.service_lng::float8 - $${bizParams.length - 1}::float8))
          ))
        ) <= $${bizParams.length}
      )`;
    }
    bizParams.push(8);
    const bizLimitIdx = bizParams.length;
    const { rows: businesses } = await pool.query(
      `SELECT b.id, b.business_name AS title,
              COALESCE(b.description, hp.profile_headline, '') AS subtitle,
              b.logo_url AS image_url,
              hp.service_city, hp.service_state,
              hp.service_lat::float8 AS lat, hp.service_lng::float8 AS lng
       FROM businesses b
       JOIN users u ON u.id = b.user_id AND u.is_active = TRUE
       LEFT JOIN helper_profiles hp ON hp.user_id = b.user_id
       WHERE b.is_active = TRUE
         AND (
           LOWER(b.business_name) LIKE ANY($1::text[])
           OR LOWER(COALESCE(b.description, '')) LIKE ANY($1::text[])
         )
         ${bizGeo}
       ORDER BY b.is_primary DESC NULLS LAST, b.created_at DESC
       LIMIT $${bizLimitIdx}`,
      bizParams,
    );
    for (const b of businesses) {
      const d = hasGeo && b.lat != null && b.lng != null ? haversineMiles(latN, lngN, b.lat, b.lng) : null;
      results.push({
        type: 'business',
        id: String(b.id),
        title: b.title,
        subtitle: (b.subtitle || '').slice(0, 160),
        url: `/business/${b.id}`,
        imageUrl: b.image_url || null,
        meta: [b.service_city, b.service_state].filter(Boolean).join(', ') || null,
        distanceMiles: d,
      });
    }

    // ── Tool rentals ────────────────────────────────────────────────────────
    const { rows: tools } = await pool.query(
      `SELECT t.id, t.name AS title,
              COALESCE(t.category, '') || CASE WHEN t.description IS NOT NULL AND LENGTH(t.description) > 0
                THEN ' · ' || LEFT(t.description, 120) ELSE '' END AS subtitle,
              t.location_city, t.location_state, t.category,
              t.daily_rate
       FROM tool_rentals t
       JOIN users u ON u.id = t.user_id AND u.is_active = TRUE
       WHERE t.is_available = TRUE
         AND (
           LOWER(t.name) LIKE ANY($1::text[])
           OR LOWER(COALESCE(t.description, '')) LIKE ANY($1::text[])
           OR LOWER(COALESCE(t.category, '')) LIKE ANY($1::text[])
         )
       ORDER BY t.created_at DESC
       LIMIT 10`,
      [patterns],
    );
    for (const t of tools) {
      results.push({
        type: 'tool',
        id: String(t.id),
        title: t.title,
        subtitle: (t.subtitle || '').slice(0, 160),
        url: `/tool-rentals?openTool=${t.id}`,
        meta: [t.location_city, t.location_state].filter(Boolean).join(', ') || null,
        priceHint: t.daily_rate != null ? `$${Number(t.daily_rate).toFixed(0)}/day` : null,
      });
    }

    // ── Helper products (public) ───────────────────────────────────────────
    const { rows: products } = await pool.query(
      `SELECT p.id, p.helper_id, p.name AS title,
              LEFT(COALESCE(p.description, ''), 140) AS subtitle,
              p.price_cents, p.category
       FROM helper_products p
       JOIN users u ON u.id = p.helper_id AND u.is_active = TRUE
       JOIN helper_profiles hp ON hp.user_id = p.helper_id
       WHERE p.is_available = TRUE
         AND COALESCE(hp.is_listed, TRUE) = TRUE
         AND u.role IN ('helper', 'helper_pro', 'broker')
         AND u.email_verified = TRUE AND u.onboarding_completed = TRUE
         AND (
           LOWER(p.name) LIKE ANY($1::text[])
           OR LOWER(COALESCE(p.description, '')) LIKE ANY($1::text[])
           OR LOWER(COALESCE(p.category, '')) LIKE ANY($1::text[])
         )
       ORDER BY p.created_at DESC
       LIMIT 10`,
      [patterns],
    );
    for (const p of products) {
      const price = p.price_cents ? `$${(p.price_cents / 100).toFixed(2)}` : null;
      results.push({
        type: 'product',
        id: String(p.id),
        title: p.title,
        subtitle: (p.subtitle || p.category || '').slice(0, 160),
        url: `/helpers/${p.helper_id}`,
        meta: price,
      });
    }
  } catch (err) {
    logger.error('[discover] search error', { err: err.message });
    throw err;
  }

  // Rank: text match density proxy + distance when geo
  const qlow = normalizeQuery(query).toLowerCase();
  const scoreRow = (r) => {
    let s = 0;
    const blob = `${r.title} ${r.subtitle}`.toLowerCase();
    if (qlow && blob.includes(qlow)) s += 50;
    terms.forEach((t) => {
      if (t && blob.includes(t)) s += 8;
    });
    if (r.distanceMiles != null && !Number.isNaN(r.distanceMiles)) {
      s += Math.max(0, 25 - Math.min(r.distanceMiles, 100) / 4);
    }
    if (r.type === 'helper') s += 3;
    return s;
  };

  results.sort((a, b) => scoreRow(b) - scoreRow(a));
  const trimmed = results.slice(0, MAX_RESULTS);
  const contentSignature = fingerprintForResults(trimmed);

  // Cross-links: for tool rows, suggest helpers with overlapping skill/category terms
  const toolRows = trimmed.filter((r) => r.type === 'tool');
  if (toolRows.length && patterns.length) {
    for (const tr of toolRows.slice(0, 3)) {
      try {
        const { rows: rel } = await pool.query(
          `SELECT u.id, TRIM(u.first_name || ' ' || u.last_name) AS title
           FROM users u
           JOIN helper_profiles hp ON hp.user_id = u.id
           JOIN helper_skills hs ON hs.user_id = u.id
           WHERE u.deleted_at IS NULL AND u.role = 'helper'
             AND u.email_verified AND u.onboarding_completed
             AND COALESCE(hp.is_listed, TRUE) = TRUE
             AND LOWER(hs.skill_name) LIKE ANY($1::text[])
           GROUP BY u.id, u.first_name, u.last_name
           LIMIT 4`,
          [patterns],
        );
        tr.related = rel.map((x) => ({
          type: 'helper',
          title: x.title,
          url: `/helpers/${x.id}`,
        }));
      } catch {
        tr.related = [];
      }
    }
  }

  return { results: trimmed, contentSignature };
}

exports.discoverSearch = async (req, res) => {
  try {
    const q = req.query.q || req.query.query || '';
    const lat = req.query.lat;
    const lng = req.query.lng;
    const radius = req.query.radius || DEFAULT_RADIUS;
    if (!normalizeQuery(q)) {
      return res.json({ results: [], query: '', contentSignature: '', expandedTerms: [] });
    }
    const { results, contentSignature } = await runDiscoverSearch({
      query: q,
      lat,
      lng,
      radiusMiles: radius,
    });
    return res.json({
      query: normalizeQuery(q),
      expandedTerms: expandSearchTerms(q),
      radiusMiles: Math.min(MAX_RADIUS, Math.max(5, parseInt(radius, 10) || DEFAULT_RADIUS)),
      results,
      contentSignature,
    });
  } catch (err) {
    logger.error('[discover] discoverSearch', { err: err.message });
    return res.status(500).json({ error: 'Search temporarily unavailable' });
  }
};

exports.listDiscoverAlerts = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, query, radius_miles, lat, lng, created_at, last_sent_at
       FROM discover_search_alerts WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id],
    );
    return res.json({ alerts: rows });
  } catch (err) {
    logger.error('[discover] list alerts', { err: err.message });
    return res.status(500).json({ error: 'Failed to load alerts' });
  }
};

exports.createDiscoverAlert = async (req, res) => {
  try {
    const { query, radius_miles = 25, lat, lng } = req.body || {};
    const qn = normalizeQuery(query);
    if (!qn) return res.status(400).json({ error: 'query is required' });
    const r = Math.min(200, Math.max(1, parseInt(radius_miles, 10) || 25));
    const latN = lat != null && !Number.isNaN(parseFloat(lat)) ? parseFloat(lat) : null;
    const lngN = lng != null && !Number.isNaN(parseFloat(lng)) ? parseFloat(lng) : null;
    const fp = alertFingerprint(req.user.id, qn, r, latN, lngN);
    const { contentSignature } = await runDiscoverSearch({
      query: qn,
      lat: latN,
      lng: lngN,
      radiusMiles: r,
    });

    const { rows } = await pool.query(
      `INSERT INTO discover_search_alerts (user_id, query, radius_miles, lat, lng, fingerprint, last_signature)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, fingerprint) DO UPDATE
         SET query = EXCLUDED.query,
             radius_miles = EXCLUDED.radius_miles,
             lat = EXCLUDED.lat,
             lng = EXCLUDED.lng
       RETURNING *`,
      [req.user.id, qn, r, latN, lngN, fp, contentSignature || ''],
    );
    return res.status(201).json({ alert: rows[0] });
  } catch (err) {
    logger.error('[discover] create alert', { err: err.message });
    return res.status(500).json({ error: 'Failed to save alert' });
  }
};

exports.deleteDiscoverAlert = async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM discover_search_alerts WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id],
    );
    if (!rowCount) return res.status(404).json({ error: 'Alert not found' });
    return res.json({ ok: true });
  } catch (err) {
    logger.error('[discover] delete alert', { err: err.message });
    return res.status(500).json({ error: 'Failed to delete alert' });
  }
};

/**
 * Cron: compare content signatures and email users when discover results change.
 */
exports.runDiscoverDigestTick = async () => {
  const { rows: alerts } = await pool.query(
    `SELECT a.*, u.email, u.first_name
     FROM discover_search_alerts a
     JOIN users u ON u.id = a.user_id AND u.is_active = TRUE`,
  );
  let sent = 0;
  for (const a of alerts) {
    try {
      const { results, contentSignature } = await runDiscoverSearch({
        query: a.query,
        lat: a.lat,
        lng: a.lng,
        radiusMiles: a.radius_miles,
      });
      if (!contentSignature) continue;
      if (!a.last_signature) {
        await pool.query(
          `UPDATE discover_search_alerts SET last_signature = $2 WHERE id = $1`,
          [a.id, contentSignature],
        );
        continue;
      }
      if (a.last_signature === contentSignature) continue;

      const lines = results.slice(0, 12).map((r) => `• ${r.title} (${r.type}) — ${r.url}`);
      const subject = `OxSteed: new matches for "${a.query}"`;
      const text = `Hi ${a.first_name},

We found updates for your saved Discover search "${a.query}" (within ~${a.radius_miles} mi).

${lines.join('\n')}

Open OxSteed to see more: ${process.env.APP_URL || process.env.CLIENT_URL || 'https://oxsteed.com'}/discover?q=${encodeURIComponent(a.query)}

— OxSteed`;

      const mail = await sendEmail({
        to: a.email,
        subject,
        text,
        html: `<p>Hi ${a.first_name},</p><p>Updates for your saved search <strong>${a.query}</strong> (≈${a.radius_miles} mi).</p><ul>${results
          .slice(0, 12)
          .map((r) => `<li><a href="${process.env.APP_URL || process.env.CLIENT_URL || 'https://oxsteed.com'}${r.url}">${r.title}</a> <small>(${r.type})</small></li>`)
          .join('')}</ul>`,
      });

      if (!mail.success) continue;

      await pool.query(
        `UPDATE discover_search_alerts SET last_signature = $2, last_sent_at = NOW() WHERE id = $1`,
        [a.id, contentSignature],
      );
      sent++;
    } catch (e) {
      logger.error('[discover] digest row failed', { alertId: a.id, err: e.message });
    }
  }
  logger.info('[discover] digest complete', { checked: alerts.length, emailsSent: sent });
};

module.exports = {
  discoverSearch: exports.discoverSearch,
  listDiscoverAlerts: exports.listDiscoverAlerts,
  createDiscoverAlert: exports.createDiscoverAlert,
  deleteDiscoverAlert: exports.deleteDiscoverAlert,
  runDiscoverDigestTick: exports.runDiscoverDigestTick,
  runDiscoverSearch,
};
