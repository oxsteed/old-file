// server/controllers/helpersController.js
// Public helper discovery endpoints - no authentication required.
// Powers /helpers (directory) and /helpers/:id (profile page).

const pool          = require('../db');
const socketService = require('../services/socketService');
const logger        = require('../utils/logger');
const crypto        = require('crypto');
const redis         = require('../utils/redis');
const metricsService = require('../services/metricsService');
const { AppError }  = require('../middleware/errorHandler');
const { resolvePublicDisplayName } = require('../utils/publicDisplayName');
const availabilityService = require('../services/helperAvailabilityService');

const DIRECTORY_CACHE_TTL_SECONDS = 30;
const DIRECTORY_CACHE_TTL_MS = DIRECTORY_CACHE_TTL_SECONDS * 1000;
const directoryCache = new Map();

function directoryCacheKey(req) {
  const params = Object.fromEntries(Object.entries(req.query || {}).sort(([a], [b]) => a.localeCompare(b)));
  const input = JSON.stringify({ params, language: req.headers['accept-language'] || 'en' });
  return crypto.createHash('sha256').update(input).digest('hex');
}

function redisReady() {
  return Boolean(redis && redis.status === 'ready');
}

async function getDirectoryCache(key) {
  const memory = directoryCache.get(key);
  if (memory && memory.expiresAt > Date.now()) {
    metricsService.incrementCounter('directory.cache_hit', 1, { layer: 'memory' });
    return memory.value;
  }
  if (memory) directoryCache.delete(key);
  if (!redisReady()) {
    metricsService.incrementCounter('directory.cache_miss', 1, { layer: 'memory' });
    return null;
  }
  try {
    const raw = await redis.get(`directory:v1:${key}`);
    if (!raw) {
      metricsService.incrementCounter('directory.cache_miss', 1, { layer: 'redis' });
      return null;
    }
    const value = JSON.parse(raw);
    directoryCache.set(key, { value, expiresAt: Date.now() + DIRECTORY_CACHE_TTL_MS });
    metricsService.incrementCounter('directory.cache_hit', 1, { layer: 'redis' });
    return value;
  } catch {
    metricsService.incrementCounter('directory.cache_miss', 1, { layer: 'redis' });
    return null;
  }
}

function setDirectoryCache(key, value) {
  directoryCache.set(key, { value, expiresAt: Date.now() + DIRECTORY_CACHE_TTL_MS });
  while (directoryCache.size > 250) directoryCache.delete(directoryCache.keys().next().value);
  if (redisReady()) {
    redis.setex(`directory:v1:${key}`, DIRECTORY_CACHE_TTL_SECONDS, JSON.stringify(value)).catch(() => {});
  }
}

function sendDirectoryResponse(res, payload) {
  // Public directory data can be briefly reused by browsers and a reverse
  // proxy. Private/authenticated data is not routed through this controller.
  res.vary('Accept-Language');
  res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
  return res.json(payload);
}

function formatResponseTime(hours) {
  if (!hours) return 'Varies';
  if (hours < 1) return '< 1 hour';
  if (hours === 1) return '1 hour';
  if (hours < 24) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}

function parseJsonList(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
}

/** Normalize service price_unit for API + directory cards */
function sanitizeServicePriceUnit(u) {
  const v = String(u || 'flat').toLowerCase();
  if (v === 'flat' || v === 'hour' || v === 'starting_at' || v === 'quote') return v;
  return 'flat';
}

// ── GET /api/helpers ──────────────────────────────────────────────────────────
// Query params (all optional):
//   query, categories (comma-separated), skills (comma-separated, skill names),
//   requiredSkillIds (comma-separated, skill IDs - from job requirements),
//   verified, backgroundChecked, availableToday,
//   minRating, minPrice, maxPrice,
//   lat, lng, radius (miles, default 60) - haversine distance filter,
//   sort (best_match|highest_rated|most_reviews|lowest_price|fastest_response|newest),
//   page, limit
async function listHelpers(req, res, next) {
  try {
    const cacheKey = directoryCacheKey(req);
    const cached = await getDirectoryCache(cacheKey);
    if (cached) return sendDirectoryResponse(res, cached);

    const {
      query = '',
      categories = '',
      skills = '',
      requiredSkillIds = '',
      verified = '',
      backgroundChecked = '',
      availableToday = '',
      minRating = 0,
      minPrice = 0,
      maxPrice = 0,
      sort = 'best_match',
      page = 1,
      limit = 9,
      lat,
      lng,
      radius,
    } = req.query;

    const pageNum  = Math.max(1, parseInt(page)  || 1);
    // SECURITY: Reduced from 50 to 25 to prevent bulk enumeration of helpers
    // Attacker needs 400+ requests instead of 200+ to enumerate all 10K helpers
    const limitNum = Math.min(25, Math.max(1, parseInt(limit) || 9));
    const offset   = (pageNum - 1) * limitNum;

    const conditions = [
      'u.deleted_at IS NULL',
      'u.is_active = TRUE',
      'u.role = $1',
      'u.email_verified = TRUE',
      'u.onboarding_completed = TRUE',
      'COALESCE(hp.is_listed, TRUE) = TRUE',
    ];
    const params     = ['helper'];
    let pIdx         = 2;

    if (query) {
      params.push(`%${query.toLowerCase()}%`);
      conditions.push(`(
        (
          CASE
            WHEN u.display_name_preference = 'full_name' THEN LOWER(TRIM(u.first_name || ' ' || u.last_name))
            WHEN u.display_name_preference = 'business_name'
              AND pb.business_name IS NOT NULL AND TRIM(pb.business_name) <> ''
              THEN LOWER(TRIM(pb.business_name))
            ELSE LOWER(TRIM(u.first_name))
          END
        ) LIKE $${pIdx}
        OR LOWER(COALESCE(hp.bio_short, '')) LIKE $${pIdx}
        OR LOWER(COALESCE(hp.profile_headline, '')) LIKE $${pIdx}
      )`);
      pIdx++;
    }

    if (verified === 'true') {
      conditions.push('hp.is_identity_verified = TRUE');
    }

    if (backgroundChecked === 'true') {
      conditions.push('hp.is_background_checked = TRUE');
    }

    if (availableToday === 'true') {
      conditions.push('hp.is_available_now = TRUE');
    }

    const minR = parseFloat(minRating);
    if (minR > 0) {
      params.push(minR);
      conditions.push(`hp.avg_rating >= $${pIdx++}`);
    }

    const minP = parseFloat(minPrice);
    if (minP > 0) {
      params.push(minP);
      conditions.push(`hp.hourly_rate_min >= $${pIdx++}`);
    }

    const maxP = parseFloat(maxPrice);
    if (maxP > 0) {
      params.push(maxP);
      conditions.push(`(hp.hourly_rate_min <= $${pIdx++} OR hp.hourly_rate_min IS NULL)`);
    }

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const radiusMiles = parseFloat(radius) || 60;
    if (!isNaN(userLat) && !isNaN(userLng)) {
      params.push(userLat, userLng, radiusMiles);
      // Helpers with no coords are included (they may still be local); only exclude
      // helpers whose coords are known AND outside the radius.
      conditions.push(`(
        hp.service_lat IS NULL OR hp.service_lng IS NULL OR
        3958.8 * acos(
          GREATEST(-1.0, LEAST(1.0,
            sin(radians($${pIdx}::float8))   * sin(radians(hp.service_lat::float8)) +
            cos(radians($${pIdx}::float8))   * cos(radians(hp.service_lat::float8)) *
            cos(radians(hp.service_lng::float8 - $${pIdx + 1}::float8))
          ))
        ) <= $${pIdx + 2}
      )`);
      pIdx += 3;
    }

    // ── Category & Skills filter: prepare server-side filtering ────────────────────────────────
    const categoryList = categories ? categories.split(',').map((c) => c.trim()).filter(Boolean) : [];
    const skillList    = skills     ? skills.split(',').map((s)     => s.trim()).filter(Boolean) : [];
    const skillIdList  = requiredSkillIds ? requiredSkillIds.split(',').map((id) => parseInt(id, 10)).filter(Number.isInteger) : [];
    let categoryJoinClause = '';
    let skillJoinClause = '';

    // Category filter: ANY-of logic (helper has at least one selected category)
    if (categoryList.length > 0) {
      params.push(categoryList);
      categoryJoinClause = `
        JOIN (
          SELECT DISTINCT user_id FROM helper_skills
          WHERE skill_name IN (
            SELECT skill_name FROM skills_lookup WHERE category = ANY($${pIdx})
          )
        ) hs_cat ON hs_cat.user_id = u.id
      `;
      pIdx++;
    }

    // Skills filter by name: ALL-of logic (helper must have EVERY selected skill)
    if (skillList.length > 0) {
      params.push(skillList);
      skillJoinClause = `
        JOIN (
          SELECT user_id FROM helper_skills
          WHERE skill_name = ANY($${pIdx})
          GROUP BY user_id
          HAVING COUNT(DISTINCT skill_name) = ${skillList.length}
        ) hs_filter ON hs_filter.user_id = u.id
      `;
      pIdx++;
    }

    // Skills filter by ID (from job requirements): ALL-of logic (helper must have EVERY required skill)
    // If both skill name and skill ID filters are provided, chain both JOINs
    if (skillIdList.length > 0) {
      params.push(skillIdList);
      const skillIdJoin = `
        JOIN (
          SELECT user_id FROM helper_skills hs
          WHERE hs.skill_id = ANY($${pIdx}::int[])
          GROUP BY user_id
          HAVING COUNT(DISTINCT hs.skill_id) = ${skillIdList.length}
        ) hs_req ON hs_req.user_id = u.id
      `;
      skillJoinClause = skillJoinClause ? skillJoinClause + skillIdJoin : skillIdJoin;
      pIdx++;
    }

    const whereClause = conditions.join(' AND ');

    const sortMap = {
      best_match:      'hp.search_rank_boost DESC, hp.avg_rating DESC',
      highest_rated:   'hp.avg_rating DESC, hp.total_reviews DESC',
      most_reviews:    'hp.total_reviews DESC, hp.avg_rating DESC',
      lowest_price:    'hp.hourly_rate_min ASC NULLS LAST',
      fastest_response:'hp.response_time_hours ASC NULLS LAST',
      newest:          'u.created_at DESC',
    };
    const orderBy = sortMap[sort] || sortMap.best_match;

    // Count for pagination (uses same WHERE and JOINs but no LIMIT/OFFSET)
    const countParams = [...params];
    const { rows: [{ count }] } = await pool.query(
      `SELECT COUNT(DISTINCT u.id) FROM users u
       LEFT JOIN helper_profiles hp ON hp.user_id = u.id
       LEFT JOIN businesses pb ON pb.user_id = u.id AND pb.is_primary = TRUE AND pb.is_active = TRUE
       ${categoryJoinClause}
       ${skillJoinClause}
       WHERE ${whereClause}`,
      countParams,
    );

    // Main fetch
    params.push(limitNum, offset);
    const { rows: helpers } = await pool.query(
      `SELECT
         u.id, u.first_name, u.last_name, u.created_at AS member_since,
         u.display_name_preference,
         pb.business_name AS primary_business_name,
         hp.profile_headline, hp.bio_short,
         hp.profile_photo_url,
         hp.service_city, hp.service_state, hp.service_radius_miles,
         hp.service_lat, hp.service_lng,
         hp.hourly_rate_min, hp.flat_rate_available,
         hp.avg_rating, hp.total_reviews, hp.completed_jobs_count,
         hp.response_time_hours,
         hp.is_identity_verified, hp.is_background_checked,
         hp.insurance_details, hp.license_details,
         hp.is_available_now,
         hp.search_rank_boost,
         hp.profile_slug
       FROM users u
       LEFT JOIN helper_profiles hp ON hp.user_id = u.id
       LEFT JOIN businesses pb ON pb.user_id = u.id AND pb.is_primary = TRUE AND pb.is_active = TRUE
       ${categoryJoinClause}
       ${skillJoinClause}
       WHERE ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${pIdx} OFFSET $${pIdx + 1}`,
      params,
    );

    if (helpers.length === 0) {
      const payload = { helpers: [], total: parseInt(count), page: pageNum };
      setDirectoryCache(cacheKey, payload);
      return sendDirectoryResponse(res, payload);
    }

    // Skills + categories for the fetched helpers
    const helperIds = helpers.map((h) => h.id);
    const { rows: skillRows } = await pool.query(
      `SELECT hs.user_id, hs.skill_name, c.name AS category_name
       FROM helper_skills hs
       JOIN categories c ON c.id = hs.category_id
       WHERE hs.user_id = ANY($1)
       ORDER BY c.name, hs.skill_name`,
      [helperIds],
    );

    const skillsByUser      = {};
    const categoriesByUser  = {};
    for (const row of skillRows) {
      (skillsByUser[row.user_id]     ||= new Set()).add(row.skill_name);
      (categoriesByUser[row.user_id] ||= new Set()).add(row.category_name);
    }

    // Skill badges (Learn certifications) for directory cards
    const badgesByUser = {};
    if (helperIds.length > 0) {
      try {
        const { rows: badgeRows } = await pool.query(
          `SELECT user_id, category, earned_at
           FROM skill_badges
           WHERE user_id = ANY($1)
           ORDER BY user_id, earned_at DESC`,
          [helperIds],
        );
        for (const row of badgeRows) {
          (badgesByUser[row.user_id] ||= []).push({ category: row.category, earnedAt: row.earned_at });
        }
      } catch (_) {
        // skill_badges table may not exist in all envs — fail open
      }
    }

    // Service titles for directory cards (helper-owned + primary business)
    const topServicesByUser = {};
    if (helperIds.length > 0) {
      const { rows: legacySvcRows } = await pool.query(
        `SELECT user_id, name, price, price_unit, sort_order, id
         FROM helper_services
         WHERE user_id = ANY($1) AND is_active = TRUE AND COALESCE(is_legacy, FALSE) = FALSE
         ORDER BY user_id, sort_order NULLS LAST, id`,
        [helperIds],
      );
      const { rows: bizSvcRows } = await pool.query(
        `SELECT b.user_id, bs.name, bs.price, bs.price_unit, bs.sort_order, bs.id
         FROM business_services bs
         JOIN businesses b ON b.id = bs.business_id AND b.is_active = TRUE
         WHERE b.user_id = ANY($1) AND bs.is_active = TRUE
         ORDER BY b.user_id, bs.sort_order, bs.id`,
        [helperIds],
      );
      const addSvcRow = (uid, row) => {
        if (!row?.name || !String(row.name).trim()) return;
        const list = (topServicesByUser[uid] ||= []);
        if (list.length >= 4) return;
        const n = String(row.name).trim();
        if (list.some((s) => s.name === n)) return;
        const rawPrice = row.price != null ? parseFloat(row.price) : 0;
        const price = Number.isFinite(rawPrice) ? rawPrice : 0;
        list.push({
          name: n,
          price,
          priceUnit: sanitizeServicePriceUnit(row.price_unit),
        });
      };
      for (const r of legacySvcRows) addSvcRow(r.user_id, r);
      for (const r of bizSvcRows) addSvcRow(r.user_id, r);
    }

    // Note: Category & Skills filtering now done server-side in the main query (above)
    // No client-side post-filtering needed anymore

    const mapped = helpers.map((h) => {
      const responseHours   = h.response_time_hours;
      const responseMinutes = responseHours ? Math.round(responseHours * 60) : 480;
      const displayName = resolvePublicDisplayName(h);
      return {
        id:               h.id,
        profileUrl:       h.profile_slug ? `/h/${h.profile_slug}` : `/helpers/${h.id}`,
        businessName:     displayName,
        ownerName:        displayName,
        avatar:           h.profile_photo_url || '',
        rating:           parseFloat(h.avg_rating)       || 0,
        reviewCount:      h.total_reviews                || 0,
        jobsCompleted:    h.completed_jobs_count         || 0,
        memberSince:      h.member_since,
        verified:         !!h.is_identity_verified,
        backgroundChecked:!!h.is_background_checked,
        categories:       categoriesByUser[h.id] ? [...categoriesByUser[h.id]] : [],
        skills:           skillsByUser[h.id]     ? [...skillsByUser[h.id]]     : [],
        licenses:         parseJsonList(h.license_details),
        insurance:        parseJsonList(h.insurance_details),
        topServices:      topServicesByUser[h.id] ? [...topServicesByUser[h.id]] : [],
        startingPrice:    h.hourly_rate_min ? parseFloat(h.hourly_rate_min) : 0,
        startingPriceUnit:h.flat_rate_available ? 'flat' : 'hour',
        responseTime:     formatResponseTime(responseHours),
        responseMinutes,
        city:             h.service_city  || '',
        state:            h.service_state || '',
        location_lat:     h.service_lat != null ? parseFloat(h.service_lat) : null,
        location_lng:     h.service_lng != null ? parseFloat(h.service_lng) : null,
        serviceRadius:    h.service_radius_miles || 10,
        availableToday:   !!h.is_available_now,
        shortBio:         h.bio_short || h.profile_headline || '',
        skillBadges:      badgesByUser[h.id] || [],
      };
    });

    // ── Businesses: fetch active businesses for the helpers grid ──────────────
    // Businesses appear mixed into the directory alongside individual helpers.
    // Only fetch on page 1 (they are always shown at their natural insertion point).
    // Apply the same location/category filters from the main helpers search.
    let businesses = [];
    if (pageNum === 1) {
      const bizConditions = [
        'b.is_active = TRUE',
        "COALESCE(b.setup_status, 'active') = 'active'",
        "COALESCE(b.business_kind, CASE WHEN b.business_mode = 'food' THEN 'restaurant' ELSE 'service' END) = 'service'",
        `(b.business_mode IN ('services_marketplace', 'retail')
          OR (b.business_mode IS NULL AND COALESCE(b.industry_category, 'services') != 'food'))`,
        // Visibility is controlled by the business's own flag - independent of
        // the owner's helper_profile.is_listed. See migration 214.
        'COALESCE(b.is_listed, TRUE) = TRUE',
        "b.business_name IS NOT NULL",
        "b.business_name != ''",
        'u.deleted_at IS NULL',
        'u.is_active = TRUE',
        'u.email_verified = TRUE',
      ];
      const bizParams = [];
      let bIdx = 1;

      // Location filter: use the business's own service coords (per migration
      // 214). The COALESCE keeps backwards compatibility while businesses
      // without their own coords are being backfilled.
      if (!isNaN(userLat) && !isNaN(userLng)) {
        bizParams.push(userLat, userLng, radiusMiles);
        bizConditions.push(`(
          COALESCE(b.service_lat, hp.service_lat) IS NULL OR COALESCE(b.service_lng, hp.service_lng) IS NULL OR
          3958.8 * acos(
            GREATEST(-1.0, LEAST(1.0,
              sin(radians($${bIdx}::float8))   * sin(radians(COALESCE(b.service_lat, hp.service_lat)::float8)) +
              cos(radians($${bIdx}::float8))   * cos(radians(COALESCE(b.service_lat, hp.service_lat)::float8)) *
              cos(radians(COALESCE(b.service_lng, hp.service_lng)::float8 - $${bIdx + 1}::float8))
            ))
          ) <= $${bIdx + 2}
        )`);
        bIdx += 3;
      }

      // Category filter: check if owner has skills in the requested categories
      if (categoryList.length > 0) {
        bizParams.push(categoryList);
        const categoryParamIndex = bIdx++;
        bizParams.push(categoryList.map((category) => category.toLowerCase()));
        const subtypeParamIndex = bIdx++;
        bizConditions.push(`(
          EXISTS (
            SELECT 1 FROM helper_skills hs
            JOIN categories c ON c.id = hs.category_id
            WHERE hs.user_id = b.user_id AND c.name = ANY($${categoryParamIndex})
          )
          OR LOWER(COALESCE(b.business_type, '')) = ANY($${subtypeParamIndex})
        )`);
      }

      const bizWhere = bizConditions.join(' AND ');
      // Discovery cards for businesses are now fully independent of the owner's
      // helper_profile. We read tagline, location, rating, reviews, and the
      // verification badge from the businesses row itself (per migration 214).
      const { rows: bizRows } = await pool.query(
        `SELECT
           b.id, b.business_name, b.business_type, b.industry_category, b.business_mode,
           b.profile_headline AS tagline,
           b.description       AS about,
           b.logo_url          AS profile_photo_url,
           COALESCE(b.address_city,  b.service_city)  AS city,
           COALESCE(b.address_state, b.service_state) AS state,
           COALESCE(b.avg_rating, 0)    AS avg_rating,
           COALESCE(b.total_reviews, 0) AS total_reviews,
           COALESCE(b.is_business_verified, FALSE) AS is_verified,
           u.id AS owner_id, u.first_name AS owner_first, u.last_name AS owner_last,
           u.display_name_preference,
           pb_owner.business_name AS primary_business_name,
           b.profile_slug
         FROM businesses b
         JOIN users u ON u.id = b.user_id
         LEFT JOIN helper_profiles hp ON hp.user_id = b.user_id
         LEFT JOIN businesses pb_owner ON pb_owner.user_id = u.id AND pb_owner.is_primary = TRUE AND pb_owner.is_active = TRUE
         WHERE ${bizWhere}
         ORDER BY b.avg_rating DESC NULLS LAST, b.total_reviews DESC NULLS LAST, b.created_at DESC
         LIMIT 20`,
        bizParams
      );

      // Fetch categories for business owners so client-side filtering works
      const bizOwnerIds = bizRows.map(b => b.owner_id);
      let bizCategoriesByOwner = {};
      let bizSkillsByOwner = {};
      if (bizOwnerIds.length > 0) {
        const { rows: bizSkillRows } = await pool.query(
          `SELECT hs.user_id, c.name AS category_name
           FROM helper_skills hs
           JOIN categories c ON c.id = hs.category_id
           WHERE hs.user_id = ANY($1)`,
          [bizOwnerIds]
        );
        for (const row of bizSkillRows) {
          (bizCategoriesByOwner[row.user_id] ||= new Set()).add(row.category_name);
        }
        const { rows: bizSkillNameRows } = await pool.query(
          `SELECT hs.user_id, hs.skill_name
           FROM helper_skills hs
           WHERE hs.user_id = ANY($1)
           ORDER BY hs.user_id, hs.skill_name`,
          [bizOwnerIds],
        );
        for (const row of bizSkillNameRows) {
          const list = (bizSkillsByOwner[row.user_id] ||= []);
          if (list.length < 8) list.push(row.skill_name);
        }
      }

      const bizIds = bizRows.map((r) => r.id);
      const servicesByBusinessId = {};
      if (bizIds.length > 0) {
        const { rows: bsRows } = await pool.query(
          `SELECT business_id, name, price, price_unit FROM business_services
           WHERE business_id = ANY($1) AND is_active = TRUE
           ORDER BY business_id, sort_order, id`,
          [bizIds],
        );
        for (const row of bsRows) {
          const list = (servicesByBusinessId[row.business_id] ||= []);
          if (list.length >= 4) continue;
          if (!row.name || !String(row.name).trim()) continue;
          const rawPrice = row.price != null ? parseFloat(row.price) : 0;
          const price = Number.isFinite(rawPrice) ? rawPrice : 0;
          list.push({
            name: String(row.name).trim(),
            price,
            priceUnit: sanitizeServicePriceUnit(row.price_unit),
          });
        }
      }

      businesses = bizRows.map((b) => ({
        id:               `biz_${b.id}`,
        businessId:       b.id,
        type:             'business',
        profileUrl:       b.profile_slug ? `/b/${b.profile_slug}` : `/businesses/public/${b.id}`,
        businessName:     b.business_name,
        ownerName:        resolvePublicDisplayName(b),
        avatar:           b.profile_photo_url || '',
        rating:           parseFloat(b.avg_rating) || 0,
        reviewCount:      b.total_reviews          || 0,
        jobsCompleted:    0,
        verified:         !!b.is_verified,
        backgroundChecked:false,
        categories:       bizCategoriesByOwner[b.owner_id] ? [...bizCategoriesByOwner[b.owner_id]] : [b.business_type].filter(Boolean),
        skills:           bizSkillsByOwner[b.owner_id] ? [...bizSkillsByOwner[b.owner_id]] : [b.business_type].filter(Boolean),
        licenses:         [],
        insurance:        [],
        topServices:      servicesByBusinessId[b.id] ? [...servicesByBusinessId[b.id]] : [],
        startingPrice:    0,
        startingPriceUnit:'hour',
        responseTime:     'Varies',
        responseMinutes:  480,
        city:             b.city  || '',
        state:            b.state || '',
        serviceRadius:    50,
        availableToday:   false,
        shortBio:         b.tagline || b.about || '',
      }));
    }

    const payload = { helpers: mapped, businesses, total: parseInt(count), page: pageNum };
    setDirectoryCache(cacheKey, payload);
    return sendDirectoryResponse(res, payload);
  } catch (err) {
    next(err);
  }
}

// ── GET /api/helpers/:id/profile ──────────────────────────────────────────────
// :id accepts either the helper's user UUID or their vanity profile_slug.
async function getHelperProfile(req, res, next) {
  try {
    let { id } = req.params;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) {
      const slugRow = await pool.query(
        'SELECT user_id FROM helper_profiles WHERE profile_slug = $1',
        [String(id).toLowerCase()]
      );
      if (!slugRow.rows[0]) throw new AppError('Helper not found', 404, 'not_found');
      id = slugRow.rows[0].user_id;
    }

    const [helperRes, skillRes, reviewRes, svcRes, faqRes, polRes, galRes, rateRes, badgeRes] = await Promise.all([
      pool.query(
        `SELECT
           u.id, u.first_name, u.last_name, u.created_at AS member_since,
           u.display_name_preference,
           pb.business_name AS primary_business_name,
           hp.profile_headline, hp.bio_short, hp.bio_long,
           hp.profile_photo_url,
           COALESCE(hp.cover_image_url, hp.cover_photo_url) AS cover_photo_url,
           hp.service_city, hp.service_state, hp.service_zip, hp.service_radius_miles,
           hp.service_lat, hp.service_lng,
           hp.hourly_rate_min, hp.hourly_rate_max, hp.rate_preference,
           hp.flat_rate_available, hp.contact_for_pricing,
           hp.avg_rating, hp.total_reviews, hp.completed_jobs_count,
           hp.response_time_hours, hp.response_rate,
           hp.is_identity_verified, hp.is_background_checked,
           hp.is_insured, hp.is_licensed,
           hp.insurance_details, hp.license_details,
           hp.is_available_now,
           hp.profile_slug,
           COALESCE(hp.show_services, TRUE) AS show_services,
           COALESCE(hp.show_faqs, TRUE) AS show_faqs,
           COALESCE(hp.show_policies, TRUE) AS show_policies,
           COALESCE(hp.show_gallery, TRUE) AS show_gallery,
           COALESCE(hp.show_hours, TRUE) AS show_hours,
           COALESCE(hp.allow_guest_contact, TRUE) AS allow_guest_contact,
           COALESCE(hp.allow_live_chat, TRUE) AS allow_live_chat,
           COALESCE(hp.allow_booking, TRUE) AS allow_booking,
           COALESCE(hp.allow_scheduling, TRUE) AS allow_scheduling,
           COALESCE(hp.active_template, 'default') AS active_template
         FROM users u
         JOIN helper_profiles hp ON hp.user_id = u.id
         LEFT JOIN businesses pb ON pb.user_id = u.id AND pb.is_primary = TRUE AND pb.is_active = TRUE
         WHERE u.id = $1
           AND u.deleted_at IS NULL
           AND u.is_active = TRUE
           AND u.role IN ('helper', 'helper_pro', 'broker')
           AND u.email_verified = TRUE
           AND u.onboarding_completed = TRUE
           AND COALESCE(hp.is_listed, TRUE) = TRUE`,
        [id],
      ),
      pool.query(
        `SELECT hs.skill_name, c.name AS category_name
         FROM helper_skills hs
         JOIN categories c ON c.id = hs.category_id
         WHERE hs.user_id = $1 ORDER BY c.name, hs.skill_name`,
        [id],
      ),
      pool.query(
        `SELECT r.id, r.rating, r.comment, r.created_at, r.response, r.response_at,
                u.first_name, u.last_name
         FROM reviews r JOIN users u ON u.id = r.reviewer_id
         WHERE r.reviewee_id = $1 ORDER BY r.created_at DESC LIMIT 20`,
        [id],
      ),
      pool.query(
        `SELECT id, name, description, price, price_unit, duration, popular, category, sort_order
         FROM helper_services WHERE user_id=$1 AND is_active=true ORDER BY sort_order,id`,
        [id],
      ),
      pool.query(
        `SELECT id, question, answer FROM helper_faqs WHERE user_id=$1 ORDER BY sort_order,id`,
        [id],
      ),
      pool.query(
        `SELECT id, title, content, icon FROM helper_policies WHERE user_id=$1 ORDER BY sort_order,id`,
        [id],
      ),
      pool.query(
        `SELECT id, url, caption FROM helper_gallery WHERE user_id=$1 ORDER BY sort_order,id`,
        [id],
      ),
      pool.query(
        `SELECT
           CASE WHEN total = 0 THEN NULL
             ELSE ROUND((replied::FLOAT / total) * 100)::INTEGER
           END AS response_rate
         FROM (
           SELECT
             COUNT(DISTINCT c.id) AS total,
             COUNT(DISTINCT CASE WHEN EXISTS(
               SELECT 1 FROM messages m2
               WHERE m2.conversation_id = c.id AND m2.sender_id = $1
             ) THEN c.id END) AS replied
           FROM conversations c
           WHERE c.helper_id = $1
             AND EXISTS(
               SELECT 1 FROM messages m
               WHERE m.conversation_id = c.id AND m.sender_id = c.customer_id
             )
         ) sub`,
        [id],
      ),
      // Skill badges from Learn completions — fail open if table absent
      pool.query(
        `SELECT category, awarded_at FROM skill_badges WHERE user_id = $1 ORDER BY awarded_at ASC`,
        [id],
      ).catch(() => ({ rows: [] })),
    ]);

    const h = helperRes.rows[0];
    if (!h) throw new AppError('Helper not found', 404, 'not_found');

    const categories = [...new Set(skillRes.rows.map((r) => r.category_name))];

    const reviews = reviewRes.rows.map((r) => ({
      id:          String(r.id),
      authorName:  `${r.first_name} ${r.last_name[0]}.`,
      rating:      r.rating,
      date:        r.created_at,
      serviceUsed: '',
      content:     r.comment || '',
      helpfulCount:0,
      verified:    true,
      helperReply: r.response ? { content: r.response, date: r.response_at } : undefined,
    }));

    const services = svcRes.rows.map((s) => ({
      id:          String(s.id),
      name:        s.name,
      description: s.description || '',
      price:       parseFloat(s.price) || 0,
      priceUnit:   s.price_unit,
      duration:    s.duration || '',
      popular:     !!s.popular,
      category:    s.category,
    }));

    const faqs = faqRes.rows.map((f) => ({
      id:       String(f.id),
      question: f.question,
      answer:   f.answer,
    }));

    const policies = polRes.rows.map((p) => ({
      id:      String(p.id),
      title:   p.title,
      content: p.content,
      icon:    p.icon || 'file-text',
    }));

    const gallery = galRes.rows.map((g) => ({
      id:      String(g.id),
      url:     g.url,
      caption: g.caption || '',
      alt:     g.caption || 'Gallery photo',
      type:    'photo',
    }));

    // Badges — trust signals
    const badges = [];
    if (h.is_background_checked) badges.push({ id: 'bg',   label: 'Background Checked', icon: 'shield-check', variant: 'verified'       });
    if (h.is_identity_verified)  badges.push({ id: 'id',   label: 'ID Verified',         icon: 'badge-check',  variant: 'verified'       });
    if (h.is_licensed)           badges.push({ id: 'lic',  label: 'Licensed',            icon: 'award',        variant: 'trusted'        });
    if (h.is_insured)            badges.push({ id: 'ins',  label: 'Insured',             icon: 'shield',       variant: 'trusted'        });
    if (h.response_time_hours && h.response_time_hours < 2)
                                 badges.push({ id: 'fast', label: 'Fast Responder',      icon: 'zap',          variant: 'fast_responder' });
    if (h.avg_rating >= 4.8 && h.total_reviews >= 10)
                                 badges.push({ id: 'top',  label: 'Top Rated',           icon: 'star',         variant: 'top_rated'      });

    // Skill badges from Learn completions
    const skillBadges = (badgeRes.rows || []).map((b) => ({
      id:          `skill_${b.category.toLowerCase().replace(/\s+/g, '_')}`,
      label:       `${b.category} Certified`,
      icon:        'graduation-cap',
      variant:     'skill',
      category:    b.category,
      awarded_at:  b.awarded_at,
    }));

    // Hours from the unified weekly template (helper_availability).
    // Dated exceptions (availability_blocks) are NOT folded into this weekly
    // view; the true day-by-day availability comes from computeAvailability.
    const template = await availabilityService.getTemplate(pool, h.id);
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const hours = DAY_NAMES.map((day, idx) => {
      const wins = template.byDay[idx] || [];
      if (wins.length === 0) {
        return { day, open: '9:00 AM', close: '5:00 PM', closed: true };
      }
      return {
        day,
        open:   availabilityService.formatTime(wins[0].start),
        close:  availabilityService.formatTime(wins[wins.length - 1].end),
        closed: false,
      };
    });

    const responseHours = h.response_time_hours;

    // Calculate years in business
    const memberDate = new Date(h.member_since);
    const yearsInBusiness = Math.floor((Date.now() - memberDate.getTime()) / (1000 * 60 * 60 * 24 * 365));

    // Calculate completion rate
    const totalJobsCount = h.completed_jobs_count || 0; // simplified; ideally total_jobs - cancelled
    const completionRate = totalJobsCount > 0 ? 100 : 0; // 100% if they completed any jobs, 0% if none

    // Determine availability status
    const isOnlineNow = h.is_available_now || socketService.isOnline(h.id);
    const availabilityStatus = isOnlineNow ? 'online' : 'offline';

    const publicDisplayName = resolvePublicDisplayName(h);

    return res.json({
      helper: {
        id:           h.id,
        profileSlug:  h.profile_slug || null,
        profileUrl:   h.profile_slug ? `/h/${h.profile_slug}` : `/helpers/${h.id}`,
        businessName: publicDisplayName,
        ownerName:    publicDisplayName,
        tagline:      h.profile_headline || '',
        bio:          h.bio_long || h.bio_short || '',
        avatar:       h.profile_photo_url || '',
        coverImage:   h.cover_photo_url || '',
        rating:       parseFloat(h.avg_rating) || 0,
        reviewCount:  h.total_reviews          || 0,
        jobsCompleted:h.completed_jobs_count   || 0,
        memberSince:  h.member_since,
        allowGuestContact: !!h.allow_guest_contact,
        allowLiveChat: !!h.allow_live_chat,
        allowBooking: !!h.allow_booking,
        allowScheduling: !!h.allow_scheduling,
        verified:     !!h.is_identity_verified,
        responseTime: formatResponseTime(responseHours),
        responseRate: rateRes.rows[0]?.response_rate ?? 0,
        badges,
        skillBadges,
        categories,
        city:         h.service_city  || '',
        state:        h.service_state || '',

        // Trust signals (self-reported)
        hasLicense:        !!h.is_licensed,
        hasInsurance:      !!h.is_insured,
        yearsInBusiness,
        isAvailableNow:    !!h.is_available_now,
        specializations:   categories,
        availabilityStatus,
        totalJobs:         totalJobsCount,
        completionRate,
      },
      services,
      gallery,
      hours,
      location: {
        city:          h.service_city  || '',
        state:         h.service_state || '',
        zip:           h.service_zip   || '',
        serviceRadius: h.service_radius_miles || 10,
        radiusUnit:    'miles',
        servesRemotely:false,
        serviceLat:    h.service_lat != null ? parseFloat(h.service_lat) : null,
        serviceLng:    h.service_lng != null ? parseFloat(h.service_lng) : null,
      },
      policies,
      reviews,
      faqs,
      visibility: {
        services: !!h.show_services,
        gallery:  !!h.show_gallery,
        hours:    !!h.show_hours,
        policies: !!h.show_policies,
        faqs:     !!h.show_faqs,
      },
      chatSession: {
        id:            `session_${id}`,
        destination:   'helper',
        status:        (h.is_available_now || socketService.isOnline(id)) ? 'live' : 'ai_assistant',
        helperStatus:  (h.is_available_now || socketService.isOnline(id)) ? 'live' : 'ai_assistant',
        oxsteedStatus: 'ai_assistant',
        timeline:      [],
        typing:        null,
      },
      activeTemplate: h.active_template || 'default',
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/helpers/skills?q=&limit= ────────────────────────────────────────
async function searchSkills(req, res, next) {
  try {
    const q     = (req.query.q     || '').trim();
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));

    let rows;
    if (q) {
      ({ rows } = await pool.query(
        `SELECT id, name, category FROM skills_lookup
         WHERE is_active = TRUE AND name ILIKE $1
         ORDER BY name ASC LIMIT $2`,
        [`%${q}%`, limit],
      ));
    } else {
      ({ rows } = await pool.query(
        `SELECT id, name, category FROM skills_lookup
         WHERE is_active = TRUE
         ORDER BY name ASC LIMIT $1`,
        [limit],
      ));
    }
    return res.json({ skills: rows });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/helpers/licenses?q=&limit= ──────────────────────────────────────
async function searchLicenses(req, res, next) {
  try {
    const q     = (req.query.q     || '').trim();
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));

    let rows;
    if (q) {
      ({ rows } = await pool.query(
        `SELECT id, name, category FROM licenses_lookup
         WHERE is_active = TRUE AND name ILIKE $1
         ORDER BY name ASC LIMIT $2`,
        [`%${q}%`, limit],
      ));
    } else {
      ({ rows } = await pool.query(
        `SELECT id, name, category FROM licenses_lookup
         WHERE is_active = TRUE
         ORDER BY name ASC LIMIT $1`,
        [limit],
      ));
    }
    return res.json({ licenses: rows });
  } catch (err) {
    next(err);
  }
}

// GET /api/helpers/:id/status - real-time online status (no auth required)
async function getHelperStatus(req, res, next) {
  try {
    const { id } = req.params;
    // Check is_available_now first (manual toggle), then fall back to Socket.IO status
    const { rows: [hp] } = await pool.query(
      `SELECT hp.is_available_now FROM helper_profiles hp
       JOIN users u ON u.id = hp.user_id
       WHERE hp.user_id = $1 AND u.deleted_at IS NULL`,
      [id]
    );
    const available = hp ? hp.is_available_now : false;
    const online = available || socketService.isOnline(id);
    res.json({
      helperId:     id,
      online,
      helperStatus: online ? 'live' : 'ai_assistant',
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/helpers/:id/availability ────────────────────────────────────────
// Dynamic endpoint: returns live availability data (fetched client-side after page load).
// Computed from the ONE availability system (weekly template + dated blocks +
// appointments) via helperAvailabilityService.
async function getHelperAvailability(req, res, next) {
  try {
    const { id } = req.params;
    const { rows: [hp] } = await pool.query(
      `SELECT hp.is_available_now, hp.response_time_hours
       FROM helper_profiles hp
       JOIN users u ON u.id = hp.user_id
       WHERE hp.user_id = $1
         AND u.deleted_at IS NULL
         AND u.email_verified = TRUE`,
      [id]
    );
    if (!hp) throw new AppError('Helper not found', 404, 'not_found');

    const template = await availabilityService.getTemplate(pool, id);
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const schedule = DAY_NAMES.map((day, idx) => {
      const wins = template.byDay[idx] || [];
      if (wins.length === 0) {
        return { day, open: null, close: null, closed: true };
      }
      return {
        day,
        open: availabilityService.formatTime(wins[0].start),
        close: availabilityService.formatTime(wins[wins.length - 1].end),
        closed: false,
        windows: wins.map((w) => ({
          open: availabilityService.formatTime(w.start),
          close: availabilityService.formatTime(w.end),
        })),
      };
    });

    // True availability summary for the coming week (blocks + appointments applied).
    const todayISO = availabilityService.localTodayISO();
    const { summary, hasTemplate } = await availabilityService.computeAvailability(
      id,
      todayISO,
      availabilityService.addDaysISO(todayISO, 6)
    );

    // "Open now" = inside a truly free window right now AND the helper's live toggle is on.
    const isOpenNow = summary.state === 'open-now' && !!hp.is_available_now;

    const online = socketService.isOnline(id);

    return res.json({
      schedule,
      isAvailableNow: !!hp.is_available_now,
      isOpenNow,
      isOnline: online,
      responseTime: formatResponseTime(hp.response_time_hours),
      responseTimeHours: hp.response_time_hours,
      hasTemplate,
      summary,
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/helpers/:id/availability/summary ──────────────────────────────────
// True availability for the coming days: weekly template − dated blocks −
// appointments. Powers the profile's availability display.
async function getHelperAvailabilitySummary(req, res, next) {
  try {
    const { id } = req.params;
    const days = Math.max(1, Math.min(14, parseInt(req.query.days, 10) || 7));

    const { rows: [hp] } = await pool.query(
      `SELECT hp.is_available_now, hp.response_time_hours
         FROM helper_profiles hp
         JOIN users u ON u.id = hp.user_id
        WHERE hp.user_id = $1
          AND u.deleted_at IS NULL
          AND u.email_verified = TRUE`,
      [id]
    );
    if (!hp) throw new AppError('Helper not found', 404, 'not_found');

    const todayISO = availabilityService.localTodayISO();
    const result = await availabilityService.computeAvailability(
      id,
      todayISO,
      availabilityService.addDaysISO(todayISO, days - 1)
    );
    result.isOnline = !!(hp.is_available_now || socketService.isOnline(id));
    result.responseTime = formatResponseTime(hp.response_time_hours);
    return res.json(result);
  } catch (err) {
    next(err);
  }
};

// ── GET /api/helpers/:id/pricing ─────────────────────────────────────────────
// Dynamic endpoint: returns current pricing info (fetched client-side after page load)
async function getHelperPricing(req, res, next) {
  try {
    const { id } = req.params;
    const { rows: [hp] } = await pool.query(
      `SELECT hp.hourly_rate_min, hp.hourly_rate_max,
             hp.rate_preference, hp.flat_rate_available,
             hp.contact_for_pricing
       FROM helper_profiles hp
       JOIN users u ON u.id = hp.user_id
       WHERE hp.user_id = $1
         AND u.deleted_at IS NULL
         AND u.email_verified = TRUE`,
      [id]
    );
    if (!hp) throw new AppError('Helper not found', 404, 'not_found');

    // Skill rows list categories (per-skill rates live on helper_services / profile tiers, not helper_skills)
    const { rows: serviceRows } = await pool.query(
      `SELECT hs.skill_name, c.name AS category_name
       FROM helper_skills hs
       JOIN categories c ON c.id = hs.category_id
       WHERE hs.user_id = $1
       ORDER BY c.name, hs.skill_name`,
      [id]
    );

    const servicePricing = serviceRows.map((s) => ({
      name: s.skill_name,
      category: s.category_name,
      hourlyRate: null,
      flatRate: null,
    }));

    return res.json({
      hourlyRateMin: hp.hourly_rate_min ? parseFloat(hp.hourly_rate_min) : null,
      hourlyRateMax: hp.hourly_rate_max ? parseFloat(hp.hourly_rate_max) : null,
      ratePreference: hp.rate_preference || 'hourly',
      flatRateAvailable: !!hp.flat_rate_available,
      contactForPricing: !!hp.contact_for_pricing,
      servicePricing,
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/helpers/:id/slots ───────────────────────────────────────────────
// Dynamic endpoint: true availability for the coming week, computed from the
// ONE availability system (weekly template − dated blocks − appointments).
async function getHelperSlots(req, res, next) {
  try {
    const { id } = req.params;

    const { rows: [hp] } = await pool.query(
      `SELECT 1 FROM helper_profiles hp
       JOIN users u ON u.id = hp.user_id
       WHERE hp.user_id = $1
         AND u.deleted_at IS NULL
         AND u.email_verified = TRUE`,
      [id]
    );
    if (!hp) throw new AppError('Helper not found', 404, 'not_found');

    const todayISO = availabilityService.localTodayISO();
    const { days, summary, hasTemplate } = await availabilityService.computeAvailability(
      id,
      todayISO,
      availabilityService.addDaysISO(todayISO, 6)
    );

    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const slots = days.map((d) => ({
      date: d.date,
      dayName: DAY_NAMES[d.dayOfWeek],
      // legacy shape (kept for existing clients)
      open: d.templateWindows[0]?.start || null,
      close: d.templateWindows[d.templateWindows.length - 1]?.end || null,
      bookedCount: d.bookedCount,
      hasOpenings: d.status === 'available' || d.status === 'limited',
      // true-availability shape
      status: d.status,
      windows: d.windows,
    }));

    return res.json({
      slots,
      summary,
      hasTemplate,
      weekOf: todayISO,
      totalOpenDays: slots.filter((s) => s.hasOpenings).length,
    });
  } catch (err) {
    next(err);
  }
};

// ── PUT /api/helpers/me/listing ───────────────────────────────────────────
// Toggle the logged-in helper's directory visibility (is_listed).
// Body: { is_listed: boolean }
async function toggleListing(req, res, next) {
  try {
    const { is_listed } = req.body;
    const fields = {};
    if (typeof is_listed !== 'boolean') {
      fields.is_listed = 'is_listed must be a boolean';
    }
    if (Object.keys(fields).length) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
    }

    const { rows } = await pool.query(
      `UPDATE helper_profiles
       SET is_listed = $1, updated_at = NOW()
       WHERE user_id = $2
       RETURNING is_listed`,
      [is_listed, req.user.id],
    );

    if (!rows[0]) {
      throw new AppError('Helper profile not found - switch to helper mode first', 404, 'not_found');
    }

    return res.json({ success: true, is_listed: rows[0].is_listed });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/helpers/me/status ────────────────────────────────────────────
// Returns the logged-in helper's own listing status.
async function getMyListingStatus(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT is_listed FROM helper_profiles WHERE user_id = $1`,
      [req.user.id],
    );

    const is_listed = rows[0] ? rows[0].is_listed : false;
    return res.json({ is_listed });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/helpers/me/availability ───────────────────────────────────────
// Returns whether the logged-in helper is currently available for live chat
async function getMyAvailability(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT is_available_now FROM helper_profiles WHERE user_id = $1`,
      [req.user.id],
    );

    const is_available_now = rows[0] ? rows[0].is_available_now : false;
    return res.json({ is_available_now });
  } catch (err) {
    next(err);
  }
}

// ── PUT /api/helpers/me/availability ───────────────────────────────────────
// Toggle live chat availability (is_available_now)
async function toggleAvailability(req, res, next) {
  try {
    const { is_available_now } = req.body;

    const fields = {};
    if (typeof is_available_now !== 'boolean') {
      fields.is_available_now = 'is_available_now must be a boolean';
    }
    if (Object.keys(fields).length) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
    }

    const { rows } = await pool.query(
      `UPDATE helper_profiles
       SET is_available_now = $1
       WHERE user_id = $2
       RETURNING is_available_now`,
      [is_available_now, req.user.id],
    );

    if (!rows[0]) {
      throw new AppError('Helper profile not found', 404, 'not_found');
    }

    return res.json({ is_available_now: rows[0].is_available_now });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/admin/helpers/:id/remove-credential ─────────────────────────────
// Admin removes a self-reported credential (license, insurance) with reason
// Logs removal and triggers in-app notification to helper
async function removeCredential(req, res, next) {
  try {
    const { id } = req.params;
    const { credential_type, removal_reason, notes } = req.body;

    // Validation
    const validCredentials = ['license', 'insurance'];
    const validReasons = ['unverified', 'expired', 'false_claim', 'user_report', 'other'];

    const fields = {};
    if (!validCredentials.includes(credential_type)) {
      fields.credential_type = 'Invalid credential_type';
    }
    if (!validReasons.includes(removal_reason)) {
      fields.removal_reason = 'Invalid removal_reason';
    }
    if (Object.keys(fields).length) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
    }

    // Map credential type to column name
    const columnMap = {
      license: 'is_licensed',
      insurance: 'is_insured',
    };
    const columnName = columnMap[credential_type];

    // Check if credential is actually claimed
    const checkRes = await pool.query(
      `SELECT ${columnName} FROM helper_profiles WHERE user_id = $1`,
      [id],
    );

    if (!checkRes.rows[0]) {
      throw new AppError('Helper not found', 404, 'not_found');
    }

    if (!checkRes.rows[0][columnName]) {
      throw new AppError('Credential not claimed by this helper', 409, 'already_exists');
    }

    // Remove credential and log removal
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update helper profile
      await client.query(
        `UPDATE helper_profiles SET ${columnName} = false WHERE user_id = $1`,
        [id],
      );

      // Log removal in audit table
      await client.query(
        `INSERT INTO helper_credential_removals
         (helper_id, credential_type, removal_reason, notes, removed_by_admin_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, credential_type, removal_reason, notes || null, req.user.id],
      );

      // Create in-app notification for helper
      const notificationMessage = `Your ${credential_type} was removed because: ${removal_reason.replace(/_/g, ' ')}`;
      await client.query(
        `INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
         VALUES ($1, 'credential_removed', 'Credential Removed', $2, 'credential', $3)`,
        [id, notificationMessage, credential_type],
      );

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    return res.json({
      message: `${credential_type} removed successfully`,
      credential_type,
      removal_reason,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { listHelpers, getHelperProfile, getHelperStatus, searchSkills, searchLicenses, getHelperAvailability,
  getHelperAvailabilitySummary, getHelperPricing, getHelperSlots, toggleListing, getMyListingStatus, getMyAvailability, toggleAvailability, removeCredential };
