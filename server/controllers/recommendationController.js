/**
 * recommendationController.js
 *
 * Flywheel recommendation engine. Queries every major data source
 * (guides, badges, jobs, tools, life dashboard, planned needs) and
 * returns a ranked list of "what to do next" cards personalised to
 * the user's role and current activity.
 *
 * GET /api/recommendations
 *
 * Response shape:
 *   { recommendations: Recommendation[], generated_at: ISO }
 *
 * Recommendation shape:
 *   {
 *     id:           string          — deterministic, stable per card type
 *     type:         RecommendationType
 *     priority:     number          — higher = show first (0–100)
 *     title:        string
 *     subtitle:     string
 *     action_url:   string
 *     action_label: string
 *     reason:       string          — human-readable "why you're seeing this"
 *     category:     string | null   — skill/guide category when relevant
 *     icon_hint:    string          — e.g. 'book', 'wrench', 'dollar', 'star'
 *     badge?:       string          — badge category when this is a badge CTA
 *   }
 *
 * RecommendationType:
 *   'guide' | 'post_job' | 'find_helper' | 'rent_tool' | 'list_tool' |
 *   'earn_income' | 'start_business' | 'get_consultant' | 'explore_franchise' |
 *   'activate_referral' | 'complete_profile' | 'upskill_badge'
 */

const pool   = require('../db');
const logger = require('../utils/logger');

// ── Constants ─────────────────────────────────────────────────────────────

/** Map guide categories to the job category names used in the marketplace */
const GUIDE_CAT_TO_JOB_CAT = {
  plumbing:     'Plumbing',
  electrical:   'Electrical',
  hvac:         'HVAC',
  painting:     'Painting',
  carpentry:    'Carpentry',
  landscaping:  'Landscaping',
  'car-care':   'Auto Repair',
  maintenance:  'General Maintenance',
  'tool-rental':'Tool Rental',
  logistics:    'Logistics',
  consulting:   'Consulting',
  business:     'Business Services',
  franchise:    'Franchise',
  helper:       'General Labor',
  customer:     'General Labor',
  management:   'Business Services',
  sales:        'Sales',
  life:         'General Labor',
  support:      'General Labor',
};

/** Life dashboard expense categories → related guide/job categories */
const EXPENSE_TO_CATEGORY = {
  // home
  home_repair:    'maintenance',
  plumbing:       'plumbing',
  electrical:     'electrical',
  hvac:           'hvac',
  painting:       'painting',
  landscaping:    'landscaping',
  // car
  auto:           'car-care',
  car:            'car-care',
  vehicle:        'car-care',
  // personal
  personal:       'life',
};

/** Icon hints by rec type */
const ICON_BY_TYPE = {
  guide:               'book',
  post_job:            'briefcase',
  find_helper:         'users',
  rent_tool:           'wrench',
  list_tool:           'dollar',
  earn_income:         'dollar',
  start_business:      'zap',
  get_consultant:      'star',
  explore_franchise:   'map',
  activate_referral:   'share',
  complete_profile:    'shield',
  upskill_badge:       'award',
  source_materials:    'truck',
  setup_procurement:   'package',
};

// ── Helpers ───────────────────────────────────────────────────────────────

function rec(type, id, priority, title, subtitle, action_url, action_label, reason, category = null, extra = {}) {
  return {
    id: `${type}:${id}`,
    type,
    priority,
    title,
    subtitle,
    action_url,
    action_label,
    reason,
    category,
    icon_hint: ICON_BY_TYPE[type] || 'zap',
    ...extra,
  };
}

/** Fail-open DB query — returns [] on error */
async function safeQuery(sql, params = []) {
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
  } catch (e) {
    logger.warn('[recommendations] query skipped', { msg: e.message, sql: sql.slice(0, 80) });
    return [];
  }
}

// ── Main builder ──────────────────────────────────────────────────────────

async function buildRecommendations(userId, userRole) {
  const recs = [];
  const role = userRole || 'customer';

  // ── 1. Fetch context in parallel ────────────────────────────────────────
  const [
    completions,
    badges,
    recentJobs,          // jobs this user posted (customer) or bid on (helper)
    recentBids,
    toolListings,        // tools the user has listed for rental
    recentRentals,       // tools the user has rented
    plannedNeeds,
    recentExpenses,
    helperProfile,
    referralInfo,
  ] = await Promise.all([
    // guide completions
    safeQuery(
      `SELECT guide_id FROM user_guide_completions WHERE user_id = $1`,
      [userId],
    ),
    // skill badges
    safeQuery(
      `SELECT category FROM skill_badges WHERE user_id = $1`,
      [userId],
    ),
    // jobs posted by this user (customer view)
    safeQuery(
      `SELECT id, title, category_name, status, created_at
       FROM jobs WHERE client_id = $1 AND created_at > NOW() - INTERVAL '90 days'
       ORDER BY created_at DESC LIMIT 10`,
      [userId],
    ),
    // bids placed by this user (helper view)
    safeQuery(
      `SELECT b.id, b.job_id, j.title, j.category_name, b.status
       FROM bids b JOIN jobs j ON j.id = b.job_id
       WHERE b.helper_id = $1 AND b.created_at > NOW() - INTERVAL '90 days'
       ORDER BY b.created_at DESC LIMIT 10`,
      [userId],
    ),
    // tools listed by this user
    safeQuery(
      `SELECT id, name, category, is_available FROM tool_rentals WHERE user_id = $1 LIMIT 10`,
      [userId],
    ),
    // tools recently rented by this user
    safeQuery(
      `SELECT tb.id, tr.name, tr.category
       FROM tool_bookings tb JOIN tool_rentals tr ON tr.id = tb.tool_id
       WHERE tb.renter_id = $1 AND tb.created_at > NOW() - INTERVAL '90 days'
       ORDER BY tb.created_at DESC LIMIT 5`,
      [userId],
    ),
    // upcoming planned needs
    safeQuery(
      `SELECT id, title, category, status, estimated_cost, due_date
       FROM planned_needs WHERE user_id = $1 AND status IN ('planned','funding','activating_soon')
       ORDER BY due_date ASC NULLS LAST LIMIT 5`,
      [userId],
    ),
    // recent expense categories (life dashboard signal)
    safeQuery(
      `SELECT DISTINCT LOWER(category) AS category
       FROM expenses WHERE user_id = $1 AND occurred_at > NOW() - INTERVAL '60 days'
       LIMIT 20`,
      [userId],
    ),
    // helper profile (rating, total_reviews, completion stats)
    safeQuery(
      `SELECT avg_rating, total_reviews, is_identity_verified, is_background_checked,
              profile_headline, bio_short
       FROM helper_profiles WHERE user_id = $1 LIMIT 1`,
      [userId],
    ),
    // referral code (to surface earn-via-referral)
    safeQuery(
      `SELECT code FROM referral_codes WHERE user_id = $1 LIMIT 1`,
      [userId],
    ),
  ]);

  const completedGuideIds = new Set(completions.map((r) => r.guide_id));
  const earnedBadgeCategories = new Set(badges.map((r) => r.category));
  const hp = helperProfile[0] || null;

  // ── 2. Derive active categories from user activity ────────────────────

  const activeCategories = new Set();

  // From jobs posted
  for (const j of recentJobs) {
    const cat = Object.entries(GUIDE_CAT_TO_JOB_CAT).find(([, v]) => v === j.category_name)?.[0];
    if (cat) activeCategories.add(cat);
  }

  // From bids/completed jobs (helper)
  for (const b of recentBids) {
    const cat = Object.entries(GUIDE_CAT_TO_JOB_CAT).find(([, v]) => v === b.category_name)?.[0];
    if (cat) activeCategories.add(cat);
  }

  // From tool rentals
  for (const r of recentRentals) {
    if (r.category) activeCategories.add(r.category.toLowerCase());
  }

  // From expense categories
  for (const e of recentExpenses) {
    const mapped = EXPENSE_TO_CATEGORY[e.category] || null;
    if (mapped) activeCategories.add(mapped);
  }

  // ── 3. Load guide catalog once (used by multiple rules) ──────────────

  let allGuides = [];
  try {
    const data = require('../data/learnGuides.json');
    allGuides = Array.isArray(data?.guides) ? data.guides : [];
  } catch (_) { /* fail open */ }

  // Group by category
  const guidesByCategory = {};
  for (const g of allGuides) {
    if (!guidesByCategory[g.category]) guidesByCategory[g.category] = [];
    guidesByCategory[g.category].push(g);
  }

  // ── 4. Rule engine ───────────────────────────────────────────────────

  // ────────────────────────────────────────────────────────────────────
  // RULE A: Guide series not yet started in active categories
  // "You just posted a painting job — here's the painting guide series"
  // ────────────────────────────────────────────────────────────────────
  for (const cat of activeCategories) {
    const guides = guidesByCategory[cat] || [];
    const unfinished = guides.filter((g) => !completedGuideIds.has(String(g.id)));
    if (unfinished.length === 0) continue;

    const next = unfinished[0];
    const doneCount = guides.length - unfinished.length;
    const isStarted = doneCount > 0;

    recs.push(rec(
      'guide',
      `${cat}-next`,
      isStarted ? 72 : 60,
      isStarted
        ? `Continue ${cat} guides (${doneCount}/${guides.length} done)`
        : `Learn ${cat}: "${next.title}"`,
      isStarted
        ? `${unfinished.length} guide${unfinished.length > 1 ? 's' : ''} left to earn the ${cat} badge`
        : `${next.minutes} min · ${next.difficulty}`,
      `/learn?category=${encodeURIComponent(cat)}&guide=${encodeURIComponent(next.id)}`,
      isStarted ? 'Continue' : 'Start guide',
      isStarted
        ? `You're active in ${cat} — keep going to earn the badge`
        : `Based on your recent ${cat} activity`,
      cat,
    ));
  }

  // ────────────────────────────────────────────────────────────────────
  // RULE B: Badge earned — surface it on profile / suggest next action
  // "You earned the Plumbing badge — add it to your helper profile"
  // ────────────────────────────────────────────────────────────────────
  for (const cat of earnedBadgeCategories) {
    const isHelper = ['helper', 'helper_pro', 'broker'].includes(role);

    if (isHelper) {
      recs.push(rec(
        'upskill_badge',
        `badge-profile-${cat}`,
        85,
        `You earned the ${cat} badge!`,
        'Customers can see your verified skills on your public profile',
        `/helper/profile?highlight=badges`,
        'View profile',
        `Your ${cat} badge is live — make sure your profile highlights it`,
        cat,
        { badge: cat },
      ));
    } else {
      // Customer with badge — nudge toward becoming a helper
      recs.push(rec(
        'earn_income',
        `badge-helper-${cat}`,
        70,
        `You know ${cat} — earn with it`,
        'Your completed guides qualify you to offer services on OxSteed',
        `/become-helper`,
        'Become a Helper',
        `You earned the ${cat} badge — helpers with verified skills earn more`,
        cat,
        { badge: cat },
      ));
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // RULE C: Planned needs approaching — nudge to post the job
  // "Your car service is due next month — post the job now"
  // ────────────────────────────────────────────────────────────────────
  for (const pn of plannedNeeds) {
    const jobCat = GUIDE_CAT_TO_JOB_CAT[EXPENSE_TO_CATEGORY[pn.category]] || 'General Labor';
    recs.push(rec(
      'post_job',
      `planned-${pn.id}`,
      80,
      `Post job: "${pn.title}"`,
      pn.due_date
        ? `Due ${new Date(pn.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
        : 'Planned need ready to activate',
      `/post-job?from_planned=${pn.id}`,
      'Post job',
      'Your planned need is ready — find a helper now',
      jobCat,
    ));
  }

  // ────────────────────────────────────────────────────────────────────
  // RULE D: Helper with completed jobs in a category → suggest tools
  // "You've done 3 electrical jobs — rent a multimeter for the next one"
  // ────────────────────────────────────────────────────────────────────
  if (['helper', 'helper_pro', 'broker'].includes(role) && activeCategories.size > 0) {
    for (const cat of activeCategories) {
      const jobCat = GUIDE_CAT_TO_JOB_CAT[cat] || cat;
      recs.push(rec(
        'rent_tool',
        `tool-for-${cat}`,
        55,
        `Rent ${cat} tools`,
        `Browse tools for your ${jobCat} jobs`,
        `/tool-rentals?category=${encodeURIComponent(cat)}`,
        'Browse tools',
        `You have active ${cat} jobs — renting tools can increase your margin`,
        cat,
      ));
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // RULE E: User has tools sitting idle — nudge to list them
  // ────────────────────────────────────────────────────────────────────
  const idleTools = toolListings.filter((t) => !t.is_available);
  if (idleTools.length > 0) {
    recs.push(rec(
      'list_tool',
      'idle-tools',
      65,
      `${idleTools.length} tool${idleTools.length > 1 ? 's' : ''} not listed for rental`,
      'Earn passive income when you're not using them',
      `/tool-owner`,
      'List tools',
      'Your tools are sitting idle — list them to earn rental income',
      null,
    ));
  }

  // ────────────────────────────────────────────────────────────────────
  // RULE F: High-performing helper → suggest starting a business
  // "4.8 rating across 20+ jobs — you're ready to launch a business"
  // ────────────────────────────────────────────────────────────────────
  if (
    role === 'helper' &&
    hp &&
    parseFloat(hp.avg_rating) >= 4.5 &&
    parseInt(hp.total_reviews) >= 10
  ) {
    recs.push(rec(
      'start_business',
      'launch-business',
      90,
      'Launch your own business',
      `${hp.avg_rating} rating, ${hp.total_reviews} reviews — you're ready`,
      '/business/launch',
      'Get started',
      'High-rated helpers who launch a business earn 3× more on average',
      null,
    ));
  }

  // ────────────────────────────────────────────────────────────────────
  // RULE G: Active business owner → suggest consulting
  // ────────────────────────────────────────────────────────────────────
  if (['business_owner', 'business_manager', 'broker'].includes(role)) {
    recs.push(rec(
      'get_consultant',
      'consulting-cta',
      75,
      'Get expert consulting',
      'Scale faster with a dedicated OxSteed consultant',
      '/consulting',
      'Book a session',
      'OxSteed consultants specialize in local service businesses',
      null,
    ));
  }

  // ────────────────────────────────────────────────────────────────────
  // RULE H: Life dashboard expense signal → suggest relevant helper
  // "You have car expenses — find an auto helper near you"
  // ────────────────────────────────────────────────────────────────────
  for (const e of recentExpenses) {
    const guideCat = EXPENSE_TO_CATEGORY[e.category];
    if (!guideCat) continue;
    const jobCat = GUIDE_CAT_TO_JOB_CAT[guideCat] || 'General Labor';

    // Only push if we haven't already pushed a guide for this category
    const alreadyHasGuideRec = recs.some((r) => r.type === 'guide' && r.category === guideCat);
    if (alreadyHasGuideRec) continue;

    recs.push(rec(
      'find_helper',
      `expense-helper-${guideCat}`,
      50,
      `Find a ${jobCat} helper`,
      'Based on your recent expenses — let a pro handle it',
      `/discover?q=${encodeURIComponent(jobCat)}`,
      'Find helpers',
      `You have ${e.category} expenses — a helper could save you time`,
      guideCat,
    ));
  }

  // ────────────────────────────────────────────────────────────────────
  // RULE I: New user / no activity → starter guide for their role
  // ────────────────────────────────────────────────────────────────────
  if (completedGuideIds.size === 0 && recentJobs.length === 0 && recentBids.length === 0) {
    const roleGuideMap = {
      customer:        { cat: 'customer',  label: 'Get started as a customer' },
      helper:          { cat: 'helper',    label: 'Get started as a helper' },
      helper_pro:      { cat: 'helper',    label: 'Level up as a helper' },
      broker:          { cat: 'helper',    label: 'Get started as a broker' },
      business_owner:  { cat: 'business',  label: 'Grow your business' },
      consultant:      { cat: 'consulting',label: 'Get consulting clients' },
      franchise_owner: { cat: 'franchise', label: 'Launch your franchise' },
      investor:        { cat: 'business',  label: 'Understand the market' },
    };
    const entry = roleGuideMap[role] || roleGuideMap.customer;
    const guides = guidesByCategory[entry.cat] || [];
    if (guides.length > 0) {
      recs.push(rec(
        'guide',
        `onboarding-${role}`,
        95,
        entry.label,
        `Start with "${guides[0].title}" — ${guides[0].minutes} min`,
        `/learn?category=${encodeURIComponent(entry.cat)}&guide=${encodeURIComponent(guides[0].id)}`,
        'Start now',
        'Complete your first guide to unlock more features',
        entry.cat,
      ));
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // RULE J: Referral code exists but user hasn't referred anyone recently
  // ────────────────────────────────────────────────────────────────────
  if (referralInfo.length > 0) {
    const code = referralInfo[0].code;
    // Check if they've had any referral conversions recently
    const recent = await safeQuery(
      `SELECT COUNT(*) AS cnt FROM referral_conversions
       WHERE referrer_id = $1 AND created_at > NOW() - INTERVAL '30 days'`,
      [userId],
    );
    const recentCount = parseInt(recent[0]?.cnt || 0);
    if (recentCount === 0) {
      recs.push(rec(
        'activate_referral',
        'referral-cta',
        45,
        'Earn by referring friends',
        `Your referral code: ${code}`,
        '/settings?tab=referrals',
        'Share your code',
        'Every successful referral earns you rewards',
        null,
      ));
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // RULE K: Helper profile incomplete — nudge to finish it
  // ────────────────────────────────────────────────────────────────────
  if (['helper', 'helper_pro', 'broker'].includes(role) && hp) {
    const missing = [];
    if (!hp.profile_headline && !hp.bio_short) missing.push('bio');
    if (!hp.is_identity_verified) missing.push('ID verification');
    if (!hp.is_background_checked) missing.push('background check');
    if (missing.length > 0) {
      recs.push(rec(
        'complete_profile',
        'profile-incomplete',
        88,
        'Complete your profile',
        `Missing: ${missing.slice(0, 2).join(', ')}`,
        '/helper/profile/edit',
        'Complete now',
        'Helpers with complete profiles get 4× more bookings',
        null,
      ));
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // RULE L: Logistics sourcing — surface for active helpers & business owners
  //
  // Helpers bidding/working jobs in a category can source materials through
  // the logistics platform. Business owners get a procurement nudge.
  // We check for open campaigns matching active categories.
  // ────────────────────────────────────────────────────────────────────

  if (['helper', 'helper_pro', 'broker'].includes(role) && activeCategories.size > 0) {
    // Find open logistics campaigns matching any of the user's active categories
    const catList = Array.from(activeCategories);
    const jobCatList = catList.map((c) => GUIDE_CAT_TO_JOB_CAT[c] || c);

    const matchingCampaigns = await safeQuery(
      `SELECT id, title, category
       FROM pooled_orders
       WHERE status = 'open'
         AND category = ANY($1::text[])
       ORDER BY created_at DESC
       LIMIT 3`,
      [jobCatList],
    );

    if (matchingCampaigns.length > 0) {
      const c = matchingCampaigns[0];
      recs.push(rec(
        'source_materials',
        `logistics-campaign-${c.id}`,
        62,
        `Source ${c.category} materials at volume pricing`,
        `${matchingCampaigns.length} open campaign${matchingCampaigns.length > 1 ? 's' : ''} match your active job categories`,
        `/logistics/campaigns?category=${encodeURIComponent(c.category)}`,
        'View campaigns',
        `You have active ${c.category} jobs — source materials through OxSteed Logistics`,
        c.category,
      ));
    } else if (catList.length > 0) {
      // No open campaigns yet — still surface logistics as a sourcing option
      const topCat = GUIDE_CAT_TO_JOB_CAT[catList[0]] || catList[0];
      recs.push(rec(
        'source_materials',
        `logistics-sourcing-${catList[0]}`,
        40,
        `Source ${topCat} materials through logistics`,
        'Create a sourcing request to get volume pricing on supplies',
        `/logistics/requests/new?category=${encodeURIComponent(topCat)}`,
        'Create request',
        `Based on your active ${topCat} jobs`,
        topCat,
      ));
    }
  }

  if (['business_owner', 'business_manager', 'broker'].includes(role)) {
    // Check if they have any active recurring procurement programs
    const hasPrograms = await safeQuery(
      `SELECT 1 FROM logistics_recurring_procurement_programs
       WHERE created_by = $1 AND status = 'active'
       LIMIT 1`,
      [userId],
    );

    if (hasPrograms.length === 0) {
      recs.push(rec(
        'setup_procurement',
        'logistics-procurement-cta',
        68,
        'Set up recurring procurement',
        'Automate restocking with scheduled sourcing programs',
        '/business-hub?tab=procurement',
        'Set up now',
        'Business owners who set up recurring programs reduce supply costs by 15–30%',
        null,
      ));
    }
  }

  // ── 5. Sort by priority descending, deduplicate by id, cap at 12 ────

  const seen = new Set();
  const ranked = recs
    .sort((a, b) => b.priority - a.priority)
    .filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    })
    .slice(0, 12);

  return ranked;
}

// ── Controller ────────────────────────────────────────────────────────────

exports.getRecommendations = async (req, res) => {
  try {
    const userId   = req.user.id;
    const userRole = req.user.role;
    const recs = await buildRecommendations(userId, userRole);
    return res.json({
      recommendations: recs,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('[recommendations] getRecommendations error', { err: err.message });
    return res.status(500).json({ error: 'Failed to generate recommendations' });
  }
};
