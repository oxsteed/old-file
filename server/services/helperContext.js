/**
 * helperContext.js
 *
 * Builds the per-helper AI system prompt and caches it in Redis for 5 minutes.
 * Called by chatController on every profile-message when in AI mode.
 *
 * Cache keys:
 *   helper-context:{helperId}    — JSON { systemPrompt }
 *   business-context:{businessId} — JSON { systemPrompt }
 *
 * TTL: 5 minutes (CONTEXT_TTL). Busted immediately when the helper updates
 * their profile via PUT /api/helper-profile/core (call invalidateHelperContext).
 */

const pool   = require('../db');
const redis  = require('../utils/redis');
const logger = require('../utils/logger');
const { ROLES } = require('../constants/roles');

const CONTEXT_TTL = 5 * 60; // seconds

// ── Prompt builders ──────────────────────────────────────────────────────────

function buildHelperSystemPrompt(helper, skills) {
  const skillList = skills.length
    ? skills
        .map(s => `${s.skill_name}${s.hourly_rate ? ` ($${parseFloat(s.hourly_rate).toFixed(0)}/hr)` : ''}`)
        .join(', ')
    : 'Not listed yet';

  return `You are an AI assistant representing ${helper.first_name} ${helper.last_name}, a helper on the OxSteed local services marketplace. Answer questions as if you are their assistant — knowledgeable, helpful, and professional.

## About This Helper
- Name: ${helper.first_name} ${helper.last_name}
- Headline: ${helper.profile_headline || 'Skilled local helper'}
- Bio: ${helper.bio_long || helper.bio_short || 'Experienced local professional available for hire.'}
- Location: ${[helper.service_city, helper.service_state].filter(Boolean).join(', ') || 'Local area'}
- Service radius: ${helper.service_radius_miles || 10} miles
- Skills: ${skillList}
- Identity verified: ${helper.is_identity_verified ? 'Yes' : 'Not yet'}
- Background checked: ${helper.is_background_checked ? 'Yes' : 'Not yet'}
- Average rating: ${helper.avg_rating ? `${parseFloat(helper.avg_rating).toFixed(1)} / 5` : 'New helper'}
- Jobs completed: ${helper.completed_jobs_count || 0}

## Your Role
- Answer questions about this helper's availability, skills, pricing, and experience
- If asked about booking or pricing specifics you don't know, invite the customer to send a message to the helper directly
- Be warm, professional, and represent this helper well
- Keep responses concise (2-4 sentences unless detail is clearly needed)
- If asked about things unrelated to this helper or OxSteed, politely redirect`;
}

function buildBusinessSystemPrompt(business, skills) {
  const skillList = skills.length
    ? skills
        .map(s => `${s.skill_name}${s.hourly_rate ? ` ($${parseFloat(s.hourly_rate).toFixed(0)}/hr)` : ''}`)
        .join(', ')
    : 'Not listed yet';

  return `You are an AI assistant representing ${business.business_name}, a business on the OxSteed local services marketplace. Answer questions as if you are the business's virtual assistant — knowledgeable, helpful, and professional.

## About This Business
- Business name: ${business.business_name}
- Description: ${business.description || 'A local service business available for hire.'}
- Location: ${[business.address_city, business.address_state].filter(Boolean).join(', ') || 'Local area'}
- Services offered: ${skillList}

## Your Role
- Answer questions about this business's services, availability, and pricing
- If asked about booking or pricing specifics you don't know, invite the customer to send a message directly
- Be warm, professional, and represent this business well
- Keep responses concise (2-4 sentences unless detail is clearly needed)
- If asked about things unrelated to this business or OxSteed, politely redirect`;
}

// ── Cache helpers ────────────────────────────────────────────────────────────

async function readCache(key) {
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.warn('[HelperContext] Cache read failed', { key, message: err.message });
    return null;
  }
}

async function writeCache(key, value) {
  if (!redis) return;
  try {
    await redis.setex(key, CONTEXT_TTL, JSON.stringify(value));
  } catch (err) {
    logger.warn('[HelperContext] Cache write failed', { key, message: err.message });
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns { systemPrompt } for a helper, using the 5-minute Redis cache.
 * Returns null when the helper is not found or is not a helper role.
 */
async function getHelperContext(helperId) {
  const cacheKey = `helper-context:${helperId}`;

  const cached = await readCache(cacheKey);
  if (cached) return cached;

  const helperRes = await pool.query(
    `SELECT u.id, u.first_name, u.last_name,
            hp.profile_headline, hp.bio_long, hp.bio_short,
            hp.service_city, hp.service_state, hp.service_radius_miles,
            hp.is_identity_verified, hp.is_background_checked,
            hp.avg_rating, hp.completed_jobs_count
       FROM users u
       JOIN helper_profiles hp ON hp.user_id = u.id
      WHERE u.id = $1
        AND u.role IN ($2, $3, $4)
        AND u.deleted_at IS NULL`,
    [helperId, ROLES.HELPER_FREE, ROLES.HELPER_PRO, ROLES.HELPER_BROKER]
  );
  if (!helperRes.rows.length) return null;

  const skillsRes = await pool.query(
    `SELECT skill_name, hourly_rate FROM user_skills
      WHERE user_id = $1 AND is_available = true LIMIT 20`,
    [helperId]
  ).catch(() => ({ rows: [] }));

  const systemPrompt = buildHelperSystemPrompt(helperRes.rows[0], skillsRes.rows);
  const ctx = { systemPrompt };
  await writeCache(cacheKey, ctx);
  return ctx;
}

/**
 * Returns { systemPrompt } for a business profile, using the 5-minute Redis cache.
 * Falls back to the business owner's helper context if the business row isn't found.
 * `ownerId` is the resolved helper user ID (for skill lookup).
 */
async function getBusinessContext(businessId, ownerId) {
  const cacheKey = `business-context:${businessId}`;

  const cached = await readCache(cacheKey);
  if (cached) return cached;

  const [bizRes, skillsRes] = await Promise.all([
    pool.query(
      `SELECT business_name, description, address_city, address_state
         FROM businesses WHERE id = $1 AND is_active = TRUE`,
      [businessId]
    ),
    pool.query(
      `SELECT skill_name, hourly_rate FROM user_skills
        WHERE user_id = $1 AND is_available = true LIMIT 20`,
      [ownerId]
    ).catch(() => ({ rows: [] })),
  ]);

  if (!bizRes.rows.length) return null;

  const systemPrompt = buildBusinessSystemPrompt(bizRes.rows[0], skillsRes.rows);
  const ctx = { systemPrompt };
  await writeCache(cacheKey, ctx);
  return ctx;
}

/**
 * Deletes the cached context for a helper (and their primary business if provided).
 * Call this whenever the helper updates their profile.
 */
async function invalidateHelperContext(helperId, businessId) {
  if (!redis) return;
  const keys = [`helper-context:${helperId}`];
  if (businessId) keys.push(`business-context:${businessId}`);
  try {
    await redis.del(...keys);
    logger.info('[HelperContext] Cache invalidated', { helperId, businessId });
  } catch (err) {
    logger.warn('[HelperContext] Cache invalidation failed', { helperId, message: err.message });
  }
}

module.exports = {
  getHelperContext,
  getBusinessContext,
  invalidateHelperContext,
};
