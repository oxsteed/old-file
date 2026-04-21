// server/controllers/helpersController.js
// Public helper discovery endpoints — no authentication required.
// Powers /helpers (directory) and /helpers/:id (profile page).

const pool          = require('../db');
const socketService = require('../services/socketService');
const logger        = require('../utils/logger');

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

// ── GET /api/helpers ──────────────────────────────────────────────────────────
// Query params (all optional):
//   query, categories (comma-separated), skills (comma-separated, skill names),
//   requiredSkillIds (comma-separated, skill IDs — from job requirements),
//   verified, backgroundChecked, availableToday,
//   minRating, minPrice, maxPrice,
//   lat, lng, radius (miles, default 60) — haversine distance filter,
//   sort (best_match|highest_rated|most_reviews|lowest_price|fastest_response|newest),
//   page, limit
async function listHelpers(req, res) {
  try {
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
    const limitNum = Math.min(50, Math.max(1, parseInt(limit) || 9));
    const offset   = (pageNum - 1) * limitNum;

    const conditions = [
      'u.deleted_at IS NULL',
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
        LOWER(u.first_name || ' ' || u.last_name) LIKE $${pIdx}
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
    if (skillIdList.length > 0) {
      params.push(skillIdList);
      skillJoinClause = `
        JOIN (
          SELECT user_id FROM helper_skills hs
          WHERE hs.skill_id = ANY($${pIdx}::int[])
          GROUP BY user_id
          HAVING COUNT(DISTINCT hs.skill_id) = ${skillIdList.length}
        ) hs_req ON hs_req.user_id = u.id
      `;
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
         hp.profile_headline, hp.bio_short,
         hp.profile_photo_url,
         hp.service_city, hp.service_state, hp.service_radius_miles,
         hp.hourly_rate_min, hp.flat_rate_available,
         hp.avg_rating, hp.total_reviews, hp.completed_jobs_count,
         hp.response_time_hours,
         hp.is_identity_verified, hp.is_background_checked,
         hp.insurance_details, hp.license_details,
         hp.is_available_now,
         hp.search_rank_boost
       FROM users u
       LEFT JOIN helper_profiles hp ON hp.user_id = u.id
       ${categoryJoinClause}
       ${skillJoinClause}
       WHERE ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${pIdx} OFFSET $${pIdx + 1}`,
      params,
    );

    if (helpers.length === 0) {
      return res.json({ helpers: [], total: parseInt(count), page: pageNum });
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

    // Service titles for directory cards (helper-owned + primary business)
    const topServicesByUser = {};
    if (helperIds.length > 0) {
      const { rows: legacySvcRows } = await pool.query(
        `SELECT user_id, name, sort_order, id
         FROM helper_services
         WHERE user_id = ANY($1) AND is_active = TRUE AND COALESCE(is_legacy, FALSE) = FALSE
         ORDER BY user_id, sort_order NULLS LAST, id`,
        [helperIds],
      );
      const { rows: bizSvcRows } = await pool.query(
        `SELECT b.user_id, bs.name, bs.sort_order, bs.id
         FROM business_services bs
         JOIN businesses b ON b.id = bs.business_id AND b.is_active = TRUE
         WHERE b.user_id = ANY($1) AND bs.is_active = TRUE
         ORDER BY b.user_id, bs.sort_order, bs.id`,
        [helperIds],
      );
      const addSvc = (uid, name) => {
        if (!name || !String(name).trim()) return;
        const list = (topServicesByUser[uid] ||= []);
        if (list.length >= 4) return;
        const n = String(name).trim();
        if (!list.includes(n)) list.push(n);
      };
      for (const r of legacySvcRows) addSvc(r.user_id, r.name);
      for (const r of bizSvcRows) addSvc(r.user_id, r.name);
    }

    // Note: Category & Skills filtering now done server-side in the main query (above)
    // No client-side post-filtering needed anymore

    const mapped = helpers.map((h) => {
      const responseHours   = h.response_time_hours;
      const responseMinutes = responseHours ? Math.round(responseHours * 60) : 480;
      return {
        id:               h.id,
        profileUrl:       `/helpers/${h.id}`,
        businessName:     `${h.first_name} ${h.last_name}`,
        ownerName:        `${h.first_name} ${h.last_name}`,
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
        serviceRadius:    h.service_radius_miles || 10,
        availableToday:   !!h.is_available_now,
        shortBio:         h.bio_short || h.profile_headline || '',
      };
    });

    // ── Businesses: fetch active businesses for the helpers grid ──────────────
    // Businesses appear mixed into the directory alongside individual helpers.
    // Only fetch on page 1 (they are always shown at their natural insertion point).
    // Apply the same location/category filters from the main helpers search.
    let businesses = [];
    if (pageNum === 1) {
      const bizConditions = [
        'TRUE = TRUE',
        "b.business_name IS NOT NULL",
        "b.business_name != ''",
      ];
      const bizParams = [];
      let bIdx = 1;

      // Location filter: use the owner's helper_profile lat/lng
      if (!isNaN(userLat) && !isNaN(userLng)) {
        bizParams.push(userLat, userLng, radiusMiles);
        bizConditions.push(`(
          hp.service_lat IS NULL OR hp.service_lng IS NULL OR
          3958.8 * acos(
            GREATEST(-1.0, LEAST(1.0,
              sin(radians($${bIdx}::float8))   * sin(radians(hp.service_lat::float8)) +
              cos(radians($${bIdx}::float8))   * cos(radians(hp.service_lat::float8)) *
              cos(radians(hp.service_lng::float8 - $${bIdx + 1}::float8))
            ))
          ) <= $${bIdx + 2}
        )`);
        bIdx += 3;
      }

      // Category filter: check if owner has skills in the requested categories
      if (categoryList.length > 0) {
        bizParams.push(categoryList);
        bizConditions.push(`EXISTS (
          SELECT 1 FROM helper_skills hs
          JOIN categories c ON c.id = hs.category_id
          WHERE hs.user_id = b.user_id AND c.name = ANY($${bIdx})
        )`);
        bIdx++;
      }

      const bizWhere = bizConditions.join(' AND ');
      const { rows: bizRows } = await pool.query(
        `SELECT
           b.id, b.business_name, hp.profile_headline AS tagline, b.description AS about,
           b.logo_url AS profile_photo_url,
           NULL AS city, NULL AS state,
           0 AS avg_rating, 0 AS total_reviews,
           FALSE AS is_verified,
           u.id AS owner_id, u.first_name AS owner_first, u.last_name AS owner_last
         FROM businesses b
         JOIN users u ON u.id = b.user_id
         LEFT JOIN helper_profiles hp ON hp.user_id = b.user_id
         WHERE ${bizWhere}
                 ORDER BY hp.avg_rating DESC NULLS LAST, hp.total_reviews DESC NULLS LAST
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
          `SELECT business_id, name FROM business_services
           WHERE business_id = ANY($1) AND is_active = TRUE
           ORDER BY business_id, sort_order, id`,
          [bizIds],
        );
        for (const row of bsRows) {
          const list = (servicesByBusinessId[row.business_id] ||= []);
          if (list.length < 4) list.push(row.name);
        }
      }

      businesses = bizRows.map((b) => ({
        id:               `biz_${b.id}`,
        businessId:       b.id,
        type:             'business',
        profileUrl:       `/business/${b.id}`,
        businessName:     b.business_name,
        ownerName:        `${b.owner_first} ${b.owner_last}`,
        avatar:           b.profile_photo_url || '',
        rating:           parseFloat(b.avg_rating) || 0,
        reviewCount:      b.total_reviews          || 0,
        jobsCompleted:    0,
        verified:         !!b.is_verified,
        backgroundChecked:false,
        categories:       bizCategoriesByOwner[b.owner_id] ? [...bizCategoriesByOwner[b.owner_id]] : [],
        skills:           bizSkillsByOwner[b.owner_id] ? [...bizSkillsByOwner[b.owner_id]] : [],
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

    return res.json({ helpers: mapped, businesses, total: parseInt(count), page: pageNum });
  } catch (err) {
    logger.error('[listHelpers] error', { err });
    return res.status(500).json({ error: 'Failed to load helpers' });
  }
}

// ── GET /api/helpers/:id/profile ──────────────────────────────────────────────
async function getHelperProfile(req, res) {
  try {
    const { id } = req.params;

    const [helperRes, skillRes, reviewRes, svcRes, faqRes, polRes, galRes, rateRes] = await Promise.all([
      pool.query(
        `SELECT
           u.id, u.first_name, u.last_name, u.created_at AS member_since,
           hp.profile_headline, hp.bio_short, hp.bio_long,
           hp.profile_photo_url, hp.cover_photo_url,
           hp.service_city, hp.service_state, hp.service_zip, hp.service_radius_miles,
           hp.hourly_rate_min, hp.hourly_rate_max, hp.rate_preference,
           hp.flat_rate_available, hp.contact_for_pricing,
           hp.avg_rating, hp.total_reviews, hp.completed_jobs_count,
           hp.response_time_hours, hp.response_rate,
           hp.is_identity_verified, hp.is_background_checked,
           hp.is_insured, hp.is_licensed,
           hp.insurance_details, hp.license_details,
           hp.availability_json, hp.is_available_now,
           COALESCE(hp.show_services, TRUE) AS show_services,
           COALESCE(hp.show_faqs, TRUE) AS show_faqs,
           COALESCE(hp.show_policies, TRUE) AS show_policies,
           COALESCE(hp.show_gallery, TRUE) AS show_gallery,
           COALESCE(hp.show_hours, TRUE) AS show_hours,
           COALESCE(hp.allow_guest_contact, TRUE) AS allow_guest_contact
         FROM users u
         JOIN helper_profiles hp ON hp.user_id = u.id
         WHERE u.id = $1 AND u.deleted_at IS NULL AND u.email_verified = TRUE AND u.onboarding_completed = TRUE`,
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
    ]);

    const h = helperRes.rows[0];
    if (!h) return res.status(404).json({ error: 'Helper not found' });

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

    // Badges
    const badges = [];
    if (h.is_background_checked) badges.push({ id: 'bg',   label: 'Background Checked', icon: 'shield-check', variant: 'verified'       });
    if (h.is_identity_verified)  badges.push({ id: 'id',   label: 'ID Verified',         icon: 'badge-check',  variant: 'verified'       });
    if (h.is_licensed)           badges.push({ id: 'lic',  label: 'Licensed',            icon: 'award',        variant: 'trusted'        });
    if (h.is_insured)            badges.push({ id: 'ins',  label: 'Insured',             icon: 'shield',       variant: 'trusted'        });
    if (h.response_time_hours && h.response_time_hours < 2)
                                 badges.push({ id: 'fast', label: 'Fast Responder',      icon: 'zap',          variant: 'fast_responder' });
    if (h.avg_rating >= 4.8 && h.total_reviews >= 10)
                                 badges.push({ id: 'top',  label: 'Top Rated',           icon: 'star',         variant: 'top_rated'      });

    // Hours from availability_json
    const avail = h.availability_json || {};
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const hours = DAY_NAMES.map((day) => {
      const key     = day.toLowerCase();
      const dayData = avail[key] || avail[day] || null;
      if (!dayData || dayData.closed) {
        return { day, open: '9:00 AM', close: '5:00 PM', closed: true };
      }
      return {
        day,
        open:   dayData.start || dayData.open  || '9:00 AM',
        close:  dayData.end   || dayData.close || '5:00 PM',
        closed: false,
      };
    });

    const responseHours = h.response_time_hours;

    return res.json({
      helper: {
        id:           h.id,
        businessName: `${h.first_name} ${h.last_name}`.trim(),
        ownerName:    `${h.first_name} ${h.last_name}`.trim(),
        tagline:      h.profile_headline || '',
        bio:          h.bio_long || h.bio_short || '',
        avatar:       h.profile_photo_url || '',
        coverImage:   h.cover_photo_url   || '',
        rating:       parseFloat(h.avg_rating) || 0,
        reviewCount:  h.total_reviews          || 0,
        jobsCompleted:h.completed_jobs_count   || 0,
        memberSince:  h.member_since,
        allowGuestContact: !!h.allow_guest_contact,
        verified:     !!h.is_identity_verified,
        responseTime: formatResponseTime(responseHours),
        responseRate: rateRes.rows[0]?.response_rate ?? 0,
        badges,
        categories,
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
        status:        socketService.isOnline(id) ? 'live' : 'ai_assistant',
        helperStatus:  socketService.isOnline(id) ? 'live' : 'ai_assistant',
        oxsteedStatus: 'ai_assistant',
        timeline:      [],
        typing:        null,
      },
    });
  } catch (err) {
    logger.error('[getHelperProfile] error', { err });
    return res.status(500).json({ error: 'Failed to load helper profile' });
  }
}

// ── GET /api/helpers/skills?q=&limit= ────────────────────────────────────────
async function searchSkills(req, res) {
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
    logger.error('[searchSkills] error', { err });
    return res.status(500).json({ error: 'Failed to search skills' });
  }
}

// ── GET /api/helpers/licenses?q=&limit= ──────────────────────────────────────
async function searchLicenses(req, res) {
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
    logger.error('[searchLicenses] error:', { err: err });
    return res.status(500).json({ error: 'Failed to search licenses' });
  }
}

// GET /api/helpers/:id/status — real-time online status (no auth required)
async function getHelperStatus(req, res) {
  try {
    const { id } = req.params;
    const online  = socketService.isOnline(id);
    res.json({
      helperId:     id,
      online,
      helperStatus: online ? 'live' : 'ai_assistant',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get helper status' });
  }
}

// ── GET /api/helpers/:id/availability ────────────────────────────────────────
// Dynamic endpoint: returns live availability data (fetched client-side after page load)
async function getHelperAvailability(req, res) {
  try {
    const { id } = req.params;
    const { rows: [hp] } = await pool.query(
      `SELECT hp.availability_json, hp.is_available_now, hp.response_time_hours
       FROM helper_profiles hp
       JOIN users u ON u.id = hp.user_id
       WHERE hp.user_id = $1
         AND u.deleted_at IS NULL
         AND u.email_verified = TRUE`,
      [id]
    );
    if (!hp) return res.status(404).json({ error: 'Helper not found' });

    const avail = hp.availability_json || {};
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const schedule = DAY_NAMES.map((day) => {
      const key = day.toLowerCase();
      const dayData = avail[key] || avail[day] || null;
      if (!dayData || dayData.closed) {
        return { day, open: null, close: null, closed: true };
      }
      return {
        day,
        open: dayData.start || dayData.open || '9:00 AM',
        close: dayData.end || dayData.close || '5:00 PM',
        closed: false,
      };
    });

    // Determine if currently within business hours
    const now = new Date();
    const todayIdx = now.getDay();
    const todaySchedule = schedule[todayIdx];
    const isOpenNow = !todaySchedule.closed && !!hp.is_available_now;

    const online = socketService.isOnline(id);

    return res.json({
      schedule,
      isAvailableNow: !!hp.is_available_now,
      isOpenNow,
      isOnline: online,
      responseTime: formatResponseTime(hp.response_time_hours),
      responseTimeHours: hp.response_time_hours,
    });
  } catch (err) {
    logger.error('[getHelperAvailability] error:', { err: err });
    return res.status(500).json({ error: 'Failed to load availability' });
  }
}

// ── GET /api/helpers/:id/pricing ─────────────────────────────────────────────
// Dynamic endpoint: returns current pricing info (fetched client-side after page load)
async function getHelperPricing(req, res) {
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
    if (!hp) return res.status(404).json({ error: 'Helper not found' });

    // Fetch service-level pricing from helper_skills if available
    const { rows: serviceRows } = await pool.query(
      `SELECT hs.skill_name, hs.hourly_rate, hs.flat_rate,
             c.name AS category_name
       FROM helper_skills hs
       JOIN categories c ON c.id = hs.category_id
       WHERE hs.user_id = $1
       ORDER BY c.name, hs.skill_name`,
      [id]
    );

    const servicePricing = serviceRows.map((s) => ({
      name: s.skill_name,
      category: s.category_name,
      hourlyRate: s.hourly_rate ? parseFloat(s.hourly_rate) : null,
      flatRate: s.flat_rate ? parseFloat(s.flat_rate) : null,
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
    logger.error('[getHelperPricing] error:', { err: err });
    return res.status(500).json({ error: 'Failed to load pricing' });
  }
}

// ── GET /api/helpers/:id/slots ───────────────────────────────────────────────
// Dynamic endpoint: returns available booking slots for the current week
async function getHelperSlots(req, res) {
  try {
    const { id } = req.params;

    // Get helper's availability schedule
    const { rows: [hp] } = await pool.query(
      `SELECT hp.availability_json, hp.is_available_now
       FROM helper_profiles hp
       JOIN users u ON u.id = hp.user_id
       WHERE hp.user_id = $1
         AND u.deleted_at IS NULL
         AND u.email_verified = TRUE`,
      [id]
    );
    if (!hp) return res.status(404).json({ error: 'Helper not found' });

    // Get existing bookings for this week to subtract from available slots
    const now = new Date();
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const { rows: bookedSlots } = await pool.query(
      `SELECT j.scheduled_date, j.scheduled_time, j.estimated_hours
       FROM jobs j
       WHERE j.helper_id = $1
         AND j.status IN ('accepted', 'in_progress')
         AND j.scheduled_date >= $2
         AND j.scheduled_date <= $3
       ORDER BY j.scheduled_date, j.scheduled_time`,
      [id, now.toISOString().split('T')[0], weekEnd.toISOString().split('T')[0]]
    );

    const avail = hp.availability_json || {};
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // Generate slots for the next 7 days
    const slots = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() + i);
      const dayName = DAY_NAMES[date.getDay()];
      const key = dayName.toLowerCase();
      const dayData = avail[key] || avail[dayName] || null;

      if (!dayData || dayData.closed) continue;

      const dateStr = date.toISOString().split('T')[0];
      const dayBookings = bookedSlots.filter(
        (b) => b.scheduled_date && b.scheduled_date.toISOString().split('T')[0] === dateStr
      );

      slots.push({
        date: dateStr,
        dayName,
        open: dayData.start || dayData.open || '9:00 AM',
        close: dayData.end || dayData.close || '5:00 PM',
        bookedCount: dayBookings.length,
        hasOpenings: dayBookings.length < 4,
      });
    }

    return res.json({
      slots,
      weekOf: now.toISOString().split('T')[0],
      totalOpenDays: slots.length,
      totalBookedSlots: bookedSlots.length,
    });
  } catch (err) {
    logger.error('[getHelperSlots] error:', { err: err });
    return res.status(500).json({ error: 'Failed to load slots' });
  }
}

// ── PUT /api/helpers/me/listing ───────────────────────────────────────────
// Toggle the logged-in helper's directory visibility (is_listed).
// Body: { is_listed: boolean }
async function toggleListing(req, res) {
  try {
    const { is_listed } = req.body;
    if (typeof is_listed !== 'boolean') {
      return res.status(400).json({ error: 'is_listed must be a boolean' });
    }

    const { rows } = await pool.query(
      `UPDATE helper_profiles
       SET is_listed = $1, updated_at = NOW()
       WHERE user_id = $2
       RETURNING is_listed`,
      [is_listed, req.user.id],
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'Helper profile not found — switch to helper mode first' });
    }

    return res.json({ success: true, is_listed: rows[0].is_listed });
  } catch (err) {
    logger.error('[toggleListing] error:', { err: err });
    return res.status(500).json({ error: 'Failed to update listing status' });
  }
}

// ── GET /api/helpers/me/status ────────────────────────────────────────────
// Returns the logged-in helper's own listing status.
async function getMyListingStatus(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT is_listed FROM helper_profiles WHERE user_id = $1`,
      [req.user.id],
    );

    const is_listed = rows[0] ? rows[0].is_listed : false;
    return res.json({ is_listed });
  } catch (err) {
    logger.error('[getMyListingStatus] error:', { err: err });
    return res.status(500).json({ error: 'Failed to fetch listing status' });
  }
}

module.exports = { listHelpers, getHelperProfile, getHelperStatus, searchSkills, searchLicenses, getHelperAvailability, getHelperPricing, getHelperSlots, toggleListing, getMyListingStatus };
