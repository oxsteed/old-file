/**
 * helperContext.js
 *
 * Builds per-helper / per-business AI system prompts + structured rawContext
 * for transparency (GET /api/chat/profile-context).
 *
 * Cache keys (v3): helper-context:v3:{id}, business-context:v3:{id}
 * TTL: 5 minutes. Busted via invalidateHelperContext on profile updates.
 */

const pool   = require('../db');
const redis  = require('../utils/redis');
const logger = require('../utils/logger');
const { ROLES } = require('../constants/roles');

const CONTEXT_TTL = 5 * 60;
const CACHE_VER = 'v3';

function cacheKeyHelper(id) {
  return `helper-context:${CACHE_VER}:${id}`;
}
function cacheKeyBusiness(id) {
  return `business-context:${CACHE_VER}:${id}`;
}

const DAY_ORDER = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_LABEL = {
  sunday: 'Sunday', monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
  thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday',
};

/** Human-readable weekly schedule from availability_json */
function summarizeAvailability(availabilityJson) {
  if (!availabilityJson || typeof availabilityJson !== 'object') {
    return 'No weekly hours on file.';
  }
  const lines = [];
  for (const key of DAY_ORDER) {
    const alt = DAY_LABEL[key];
    const dayData = availabilityJson[key] || availabilityJson[alt] || null;
    if (!dayData || dayData.closed) {
      lines.push(`${DAY_LABEL[key]}: closed`);
    } else {
      const open = dayData.start || dayData.open || '—';
      const close = dayData.end || dayData.close || '—';
      lines.push(`${DAY_LABEL[key]}: ${open} - ${close}`);
    }
  }
  return lines.join('\n');
}

async function fetchHelperFAQs(userId) {
  try {
    const { rows } = await pool.query(
      `SELECT id, question, answer FROM helper_faqs WHERE user_id = $1 ORDER BY sort_order, id LIMIT 25`,
      [userId]
    );
    return rows;
  } catch {
    return [];
  }
}

async function fetchBusinessFAQs(businessId) {
  try {
    const { rows } = await pool.query(
      `SELECT id, question, answer FROM business_faqs WHERE business_id = $1 ORDER BY sort_order, id LIMIT 25`,
      [businessId]
    );
    return rows;
  } catch {
    return [];
  }
}

async function fetchHelperProducts(userId) {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, description, price_cents, category, is_available
         FROM helper_products
        WHERE helper_id = $1 AND is_available = true
        ORDER BY category, name LIMIT 30`,
      [userId]
    );
    return rows;
  } catch {
    return [];
  }
}

function faqBlockForPrompt(faqs) {
  if (!faqs.length) return '';
  return faqs
    .map((f, i) => `Q${i + 1}: ${f.question}\nA${i + 1}: ${f.answer}`)
    .join('\n\n');
}

function productsBlockForPrompt(products) {
  if (!products.length) return '';
  return products
    .map(p => {
      const price = p.price_cents ? `$${(p.price_cents / 100).toFixed(2)}` : '';
      return `- ${p.name}${price ? ` (${price})` : ''}${p.description ? `: ${String(p.description).slice(0, 120)}` : ''}`;
    })
    .join('\n');
}

function buildSafetySuffix() {
  return `

## CRITICAL RULES (must follow)
- You are an **AI assistant** for this profile only. Be clear you are not the human provider.
- **Never** tell the customer an appointment or booking is **confirmed**. All bookings are **requests** until the provider contacts them (message, email, or call).
- If you do not have exact pricing or availability for a specific time, say so honestly and suggest they leave contact details or message the provider.
- **Owner-provided knowledge** (below) is factual claims from the business/helper — do not contradict it, but still never promise legal/medical outcomes.
- If the user wants to book a specific time window, you may output a machine-readable block AFTER your normal reply using EXACTLY this format on its own lines:
\`\`\`action
{"type":"booking_request","guest_name":"...","guest_email":"...","guest_phone":"","service_description":"...","scheduled_start_time":"ISO8601","scheduled_end_time":"ISO8601","customer_notes":""}
\`\`\`
Only include this block when the user clearly wants a time-based booking request and has provided a valid email (and name if possible). Use ISO 8601 UTC for times. Omit the block if information is missing — ask for email instead.
`;
}

function buildHelperSystemPrompt(helper, skills, faqs, products, availabilitySummary, aiKnowledge) {
  const skillList = skills.length
    ? skills.map(s => `${s.skill_name}${s.hourly_rate ? ` ($${parseFloat(s.hourly_rate).toFixed(0)}/hr)` : ''}`).join(', ')
    : 'Not listed yet';

  const faqText = faqBlockForPrompt(faqs);
  const prodText = productsBlockForPrompt(products);
  const ownerBlock = aiKnowledge && String(aiKnowledge).trim()
    ? `\n## Owner-provided knowledge (trusted for Q&A)\n<<<OWNER_KNOWLEDGE\n${String(aiKnowledge).trim().slice(0, 8000)}\nOWNER_KNOWLEDGE>>>`
    : '';

  return `You are an AI assistant representing ${helper.first_name} ${helper.last_name}, a helper on the OxSteed local services marketplace.

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
- Marked available now (flag): ${helper.is_available_now ? 'Yes' : 'No'}

## Weekly hours (from profile; may not reflect same-day exceptions)
${availabilitySummary}
${faqText ? `\n## FAQs\n${faqText}` : ''}
${prodText ? `\n## Listed products (helper storefront)\n${prodText}` : ''}
${ownerBlock}

## Your Role
- Answer questions about this helper's services, area, and policies using the facts above.
- Invite the customer to message the helper for anything uncertain.
- Keep replies concise (2-5 sentences) unless more detail is clearly needed.
- If asked about unrelated topics, politely redirect.${buildSafetySuffix()}`;
}

function buildBusinessSystemPrompt(business, skills, faqs, products, availabilitySummary, aiKnowledge) {
  const skillList = skills.length
    ? skills.map(s => `${s.skill_name}${s.hourly_rate ? ` ($${parseFloat(s.hourly_rate).toFixed(0)}/hr)` : ''}`).join(', ')
    : 'Not listed yet';

  const faqText = faqBlockForPrompt(faqs);
  const prodText = productsBlockForPrompt(products);
  const ownerBlock = aiKnowledge && String(aiKnowledge).trim()
    ? `\n## Owner-provided knowledge (trusted for Q&A)\n<<<OWNER_KNOWLEDGE\n${String(aiKnowledge).trim().slice(0, 8000)}\nOWNER_KNOWLEDGE>>>`
    : '';

  return `You are an AI assistant representing ${business.business_name}, a business on the OxSteed local services marketplace.

## About This Business
- Business name: ${business.business_name}
- Description: ${business.description || 'A local service business available for hire.'}
- Location: ${[business.address_city, business.address_state].filter(Boolean).join(', ') || 'Local area'}
- Services offered (from team skills): ${skillList}
- Marked available now (owner flag): ${business.is_available_now ? 'Yes' : 'No'}

## Weekly hours (owner schedule on file; may not reflect same-day exceptions)
${availabilitySummary}
${faqText ? `\n## FAQs\n${faqText}` : ''}
${prodText ? `\n## Listed products (owner helper storefront)\n${prodText}` : ''}
${ownerBlock}

## Your Role
- Answer questions about this business's services and policies using the facts above.
- Invite the customer to message the business for anything uncertain.
- Keep replies concise (2-5 sentences) unless more detail is clearly needed.
- If asked about unrelated topics, politely redirect.${buildSafetySuffix()}`;
}

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

/**
 * @returns {Promise<{ systemPrompt: string, rawContext: object }|null>}
 */
async function getHelperContext(helperId) {
  const cacheKey = cacheKeyHelper(helperId);
  const cached = await readCache(cacheKey);
  if (cached) return cached;

  const helperRes = await pool.query(
    `SELECT u.id, u.first_name, u.last_name,
            hp.profile_headline, hp.bio_long, hp.bio_short,
            hp.service_city, hp.service_state, hp.service_radius_miles,
            hp.is_identity_verified, hp.is_background_checked,
            hp.avg_rating, hp.completed_jobs_count,
            hp.availability_json, hp.is_available_now, hp.ai_knowledge
       FROM users u
       JOIN helper_profiles hp ON hp.user_id = u.id
      WHERE u.id = $1
        AND u.role IN ($2, $3, $4)
        AND u.deleted_at IS NULL`,
    [helperId, ROLES.HELPER_FREE, ROLES.HELPER_PRO, ROLES.HELPER_BROKER]
  );
  if (!helperRes.rows.length) return null;

  const h = helperRes.rows[0];
  const [skillsRes, faqs, products] = await Promise.all([
    pool.query(
      `SELECT skill_name, hourly_rate FROM user_skills
        WHERE user_id = $1 AND is_available = true LIMIT 20`,
      [helperId]
    ).catch(() => ({ rows: [] })),
    fetchHelperFAQs(helperId),
    fetchHelperProducts(helperId),
  ]);

  let availabilityJson = h.availability_json;
  if (typeof availabilityJson === 'string') {
    try { availabilityJson = JSON.parse(availabilityJson); } catch { availabilityJson = {}; }
  }
  const availabilitySummary = summarizeAvailability(availabilityJson || {});

  const rawContext = {
    profileType: 'helper',
    name: `${h.first_name} ${h.last_name}`.trim(),
    location: [h.service_city, h.service_state].filter(Boolean).join(', ') || null,
    isAvailableNow: !!h.is_available_now,
    availabilitySummary,
    skills: skillsRes.rows.map(r => ({ skill_name: r.skill_name, hourly_rate: r.hourly_rate })),
    faqs: faqs.map(f => ({ id: f.id, question: f.question, answer: f.answer })),
    products: products.map(p => ({
      id: p.id, name: p.name, description: p.description, price_cents: p.price_cents, category: p.category,
    })),
    aiKnowledge: h.ai_knowledge || null,
  };

  const systemPrompt = buildHelperSystemPrompt(h, skillsRes.rows, faqs, products, availabilitySummary, h.ai_knowledge);
  const ctx = { systemPrompt, rawContext };
  await writeCache(cacheKey, ctx);
  return ctx;
}

/**
 * @returns {Promise<{ systemPrompt: string, rawContext: object }|null>}
 */
async function getBusinessContext(businessId, ownerId) {
  const cacheKey = cacheKeyBusiness(businessId);
  const cached = await readCache(cacheKey);
  if (cached) return cached;

  const [bizRes, hpRes, skillsRes] = await Promise.all([
    pool.query(
      `SELECT id, business_name, description, address_city, address_state, ai_knowledge
         FROM businesses WHERE id = $1 AND is_active = TRUE`,
      [businessId]
    ),
    pool.query(
      `SELECT availability_json, is_available_now, ai_knowledge
         FROM helper_profiles WHERE user_id = $1`,
      [ownerId]
    ).catch(() => ({ rows: [] })),
    pool.query(
      `SELECT skill_name, hourly_rate FROM user_skills
        WHERE user_id = $1 AND is_available = true LIMIT 20`,
      [ownerId]
    ).catch(() => ({ rows: [] })),
  ]);

  if (!bizRes.rows.length) return null;

  const b = bizRes.rows[0];
  const hp = hpRes.rows[0] || {};
  let availabilityJson = hp.availability_json;
  if (typeof availabilityJson === 'string') {
    try { availabilityJson = JSON.parse(availabilityJson); } catch { availabilityJson = {}; }
  }
  const availabilitySummary = summarizeAvailability(availabilityJson || {});

  const [faqs, products] = await Promise.all([
    fetchBusinessFAQs(businessId),
    fetchHelperProducts(ownerId),
  ]);

  const bizKnowledge = (b.ai_knowledge && String(b.ai_knowledge).trim()) ? b.ai_knowledge : null;
  const ownerHpKnowledge = (hp.ai_knowledge && String(hp.ai_knowledge).trim()) ? hp.ai_knowledge : null;
  const mergedKnowledge = bizKnowledge || ownerHpKnowledge || null;

  const rawContext = {
    profileType: 'business',
    businessId,
    name: b.business_name,
    location: [b.address_city, b.address_state].filter(Boolean).join(', ') || null,
    isAvailableNow: !!hp.is_available_now,
    availabilitySummary,
    skills: skillsRes.rows.map(r => ({ skill_name: r.skill_name, hourly_rate: r.hourly_rate })),
    faqs: faqs.map(f => ({ id: f.id, question: f.question, answer: f.answer })),
    products: products.map(p => ({
      id: p.id, name: p.name, description: p.description, price_cents: p.price_cents, category: p.category,
    })),
    aiKnowledge: mergedKnowledge,
    aiKnowledgeSource: bizKnowledge ? 'business' : (ownerHpKnowledge ? 'owner_helper_profile' : null),
  };

  const businessRow = {
    business_name: b.business_name,
    description: b.description,
    address_city: b.address_city,
    address_state: b.address_state,
    is_available_now: !!hp.is_available_now,
  };

  const systemPrompt = buildBusinessSystemPrompt(
    businessRow,
    skillsRes.rows,
    faqs,
    products,
    availabilitySummary,
    mergedKnowledge
  );
  const ctx = { systemPrompt, rawContext };
  await writeCache(cacheKey, ctx);
  return ctx;
}

async function invalidateHelperContext(helperId, businessId) {
  if (!redis) return;
  const keys = [cacheKeyHelper(helperId)];
  if (businessId) keys.push(cacheKeyBusiness(businessId));
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
  summarizeAvailability,
};
