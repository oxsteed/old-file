// server/controllers/helpersController.js
// Public helper discovery endpoints — no authentication required.
// Powers /helpers (directory) and /helpers/:id (profile page).

const pool          = require('../db');
const socketService = require('../services/socketService');

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
//   query, categories (comma-separated), skills (comma-separated),
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
          LEAST(1.0,
            sin(radians($${pIdx}::float8))   * sin(radians(hp.service_lat::float8)) +
            cos(radians($${pIdx}::float8))   * cos(radians(hp.service_lat::float8)) *
            cos(radians(hp.service_lng::float8 - $${pIdx + 1}::float8))
          )
        ) <= $${pIdx + 2}
      )`);
      pIdx += 3;
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

    // Count for pagination (uses same WHERE but no LIMIT/OFFSET)
    const countParams = [...params];
    const { rows: [{ count }] } = await pool.query(
      `SELECT COUNT(*) FROM users u
       LEFT JOIN helper_profiles hp ON hp.user_id = u.id
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

    // Client-side category/skill post-filter (server WHERE can't do array-ANY cheaply)
    const categoryList = categories ? categories.split(',').map((c) => c.trim()).filter(Boolean) : [];
    const skillList    = skills     ? skills.split(',').map((s)     => s.trim()).filter(Boolean) : [];

    let result = helpers;

    if (categoryList.length > 0) {
      result = result.filter((h) => {
        const cats = categoriesByUser[h.id];
        return cats && categoryList.some((c) => cats.has(c));
      });
    }

    if (skillList.length > 0) {
      result = result.filter((h) => {
        const sk = skillsByUser[h.id];
        return sk && skillList.every((s) => sk.has(s));
      });
    }

    const mapped = result.map((h) => {
      const responseHours   = h.response_time_hours;
      const responseMinutes = responseHours ? Math.round(responseHours * 60) : 480;
      return {
        id:               h.id,
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
        topServices:      [],
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

    return res.json({ helpers: mapped, total: parseInt(count), page: pageNum });
  } catch (err) {
    console.error('[listHelpers] error:', err);
    return res.status(500).json({ error: 'Failed to load helpers' });
  }
}

// ── GET /api/helpers/:id/profile ──────────────────────────────────────────────
async function getHelperProfile(req, res) {
  try {
    const { id } = req.params;

    const { rows: [h] } = await pool.query(
      `SELECT
         u.id, u.first_name, u.last_name, u.created_at AS member_since,
         hp.profile_headline, hp.bio_short, hp.bio_long,
         hp.profile_photo_url,
         hp.service_city, hp.service_state, hp.service_zip, hp.service_radius_miles,
         hp.hourly_rate_min, hp.hourly_rate_max, hp.rate_preference,
         hp.flat_rate_available, hp.contact_for_pricing,
         hp.avg_rating, hp.total_reviews, hp.completed_jobs_count,
         hp.response_time_hours,
         hp.is_identity_verified, hp.is_background_checked,
         hp.is_insured, hp.is_licensed,
         hp.insurance_details, hp.license_details,
         hp.availability_json, hp.is_available_now
       FROM users u
       JOIN helper_profiles hp ON hp.user_id = u.id
       WHERE u.id = $1 AND u.deleted_at IS NULL AND u.email_verified = TRUE AND u.onboarding_completed = TRUE`,
      [id],
    );

    if (!h) return res.status(404).json({ error: 'Helper not found' });

    // Skills + categories
    const { rows: skillRows } = await pool.query(
      `SELECT hs.skill_name, c.name AS category_name
       FROM helper_skills hs
       JOIN categories c ON c.id = hs.category_id
       WHERE hs.user_id = $1
       ORDER BY c.name, hs.skill_name`,
      [id],
    );
    const categories = [...new Set(skillRows.map((r) => r.category_name))];

    // Reviews (most recent 20)
    const { rows: reviewRows } = await pool.query(
      `SELECT r.id, r.rating, r.comment, r.created_at, r.response, r.response_at,
              u.first_name, u.last_name
       FROM reviews r
       JOIN users u ON u.id = r.reviewer_id
       WHERE r.reviewee_id = $1
       ORDER BY r.created_at DESC
       LIMIT 20`,
      [id],
    );

    const reviews = reviewRows.map((r) => ({
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
        businessName: `${h.first_name} ${h.last_name}`,
        ownerName:    `${h.first_name} ${h.last_name}`,
        tagline:      h.profile_headline || '',
        bio:          h.bio_long || h.bio_short || '',
        avatar:       h.profile_photo_url || '',
        coverImage:   '',
        rating:       parseFloat(h.avg_rating) || 0,
        reviewCount:  h.total_reviews          || 0,
        jobsCompleted:h.completed_jobs_count   || 0,
        memberSince:  h.member_since,
        verified:     !!h.is_identity_verified,
        responseTime: formatResponseTime(responseHours),
        responseRate: 95,
        badges,
        categories,
      },
      services:  [],
      gallery:   [],
      hours,
      location: {
        city:          h.service_city  || '',
        state:         h.service_state || '',
        zip:           h.service_zip   || '',
        serviceRadius: h.service_radius_miles || 10,
        radiusUnit:    'miles',
        servesRemotely:false,
      },
      policies: [],
      reviews,
      faqs: [],
      chatSession: {
        id:            `session_${id}`,
        destination:   socketService.isOnline(id) ? 'helper' : 'helper',
        status:        socketService.isOnline(id) ? 'live' : 'ai_assistant',
        helperStatus:  socketService.isOnline(id) ? 'live' : 'ai_assistant',
        oxsteedStatus: 'ai_assistant',
        timeline:      [],
        typing:        null,
      },
    });
  } catch (err) {
    console.error('[getHelperProfile] error:', err);
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
    console.error('[searchSkills] error:', err);
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
    console.error('[searchLicenses] error:', err);
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
    console.error('[getHelperAvailability] error:', err);
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
    console.error('[getHelperPricing] error:', err);
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
    console.error('[getHelperSlots] error:', err);
    return res.status(500).json({ error: 'Failed to load slots' });
  }
}

module.exports = { listHelpers, getHelperProfile, getHelperStatus, searchSkills, searchLicenses, getHelperAvailability, getHelperPricing, getHelperSlots };
