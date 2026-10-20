"use strict";
// Propensity v1: transparent scorecards (spec 10.4). No trained model;
// v2 stays deferred. Each model is a points table an admin can read:
// rules fire on domain facts, points sum to a 0..1 score, and the top 3
// contributing rules are stored as the score's reasons in
// propensity_scores (migration 933). Scores are only for choosing who an
// admin may offer something to; nothing here touches price, ranking,
// search visibility or eligibility.
//
// Calibration: propensity_scores keeps only the latest score per person
// per model, so the report compares the current snapshot's predicted
// decile against the share whose outcome is true now. Deciles with fewer
// than 5 people are suppressed (k=5), like every other growth count.
// Reports accumulate nightly in propensity_calibration_reports so the
// calibration trend survives score recomputation.
const MODEL_VERSION = "v1-scorecard-1";
const K = 5;

const MODELS = Object.freeze({
  helper_tier_upgrade: {
    label: "Helper likely to upgrade tier",
    factsSql: `SELECT u.id,
      (SELECT COUNT(*) FROM bids b WHERE b.helper_id=u.id AND b.created_at>=NOW()-interval '90 days')::int AS bids_90d,
      (SELECT COUNT(*) FROM bids b WHERE b.helper_id=u.id AND b.created_at>=NOW()-interval '90 days' AND b.status='accepted')::int AS bids_won_90d,
      (SELECT COUNT(*) FROM bids b WHERE b.helper_id=u.id AND b.created_at>=NOW()-interval '30 days')::int AS bids_30d,
      (SELECT COUNT(*) FROM jobs j WHERE j.assigned_helper_id=u.id AND j.status='completed')::int AS jobs_completed,
      COALESCE(hp.avg_rating,0)::float AS avg_rating
      FROM users u JOIN helper_profiles hp ON hp.user_id=u.id
      WHERE COALESCE(hp.tier,'free')='free' AND u.is_active AND NOT u.is_banned AND u.deleted_at IS NULL
      LIMIT 200000`,
    outcomeSql: `SELECT u.id, (COALESCE(hp.tier,'free')<>'free' OR COALESCE(u.tier,'free')<>'free') AS outcome
      FROM users u LEFT JOIN helper_profiles hp ON hp.user_id=u.id WHERE u.id=ANY($1::uuid[])`,
    rules: [
      { key: "bid_volume_90d", label: "High bid volume in 90 days", points: 30, test: (f) => f.bids_90d >= 20 },
      { key: "win_rate", label: "Win rate at least 30% on 10+ bids", points: 25, test: (f) => f.bids_90d >= 10 && f.bids_won_90d / f.bids_90d >= 0.3 },
      { key: "jobs_completed", label: "10+ completed jobs", points: 20, test: (f) => f.jobs_completed >= 10 },
      { key: "recent_bid_pace", label: "8+ bids in 30 days (near free-tier pace)", points: 15, test: (f) => f.bids_30d >= 8 },
      { key: "rating", label: "Average rating at least 4.5", points: 10, test: (f) => f.avg_rating >= 4.5 },
    ],
  },
  customer_to_helper: {
    label: "Customer likely to become a helper",
    factsSql: `SELECT u.id,
      (SELECT COUNT(*) FROM user_skills s WHERE s.user_id=u.id)::int AS skills,
      (SELECT COUNT(*) FROM guide_view_events g WHERE g.user_id=u.id AND g.viewed_at>=NOW()-interval '90 days')::int AS learn_views_90d,
      (SELECT COUNT(*) FROM saved_searches s WHERE s.user_id=u.id AND s.search_type='job')::int AS job_searches,
      (SELECT COUNT(*) FROM jobs j WHERE j.client_id=u.id)::int AS jobs_posted
      FROM users u
      WHERE u.role='customer' AND u.is_active AND NOT u.is_banned AND u.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM helper_profiles hp WHERE hp.user_id=u.id)
      LIMIT 200000`,
    outcomeSql: `SELECT u.id, EXISTS(SELECT 1 FROM helper_profiles hp WHERE hp.user_id=u.id) AS outcome
      FROM users u WHERE u.id=ANY($1::uuid[])`,
    rules: [
      { key: "skills_on_profile", label: "Skills listed on profile", points: 35, test: (f) => f.skills >= 1 },
      { key: "job_searches", label: "Saved searches for jobs", points: 25, test: (f) => f.job_searches >= 1 },
      { key: "learn_views", label: "3+ Learn guide views in 90 days", points: 20, test: (f) => f.learn_views_90d >= 3 },
      { key: "repeat_customer", label: "Posted 2+ jobs as a customer", points: 20, test: (f) => f.jobs_posted >= 2 },
    ],
  },
  business_invoicing_adoption: {
    label: "Business likely to adopt invoicing/booking",
    factsSql: `SELECT b.user_id AS id,
      (SELECT COUNT(*) FROM business_services s WHERE s.business_id=b.id AND s.is_active)::int AS services,
      (SELECT COUNT(*) FROM business_appointments a WHERE a.business_id=b.id AND a.created_at>=NOW()-interval '90 days')::int AS appointments_90d,
      (SELECT COUNT(*) FROM business_appointments a WHERE a.business_id=b.id AND a.created_at>=NOW()-interval '90 days' AND a.payment_status='pending')::int AS appointments_unpaid_90d
      FROM businesses b WHERE b.is_active=TRUE
      LIMIT 200000`,
    outcomeSql: `SELECT u.id, EXISTS(SELECT 1 FROM subscriptions s WHERE s.user_id=u.id AND s.status='active') AS outcome
      FROM users u WHERE u.id=ANY($1::uuid[])`,
    rules: [
      { key: "appointment_volume", label: "20+ appointments in 90 days", points: 30, test: (f) => f.appointments_90d >= 20 },
      { key: "manual_payments", label: "10+ appointments still on manual payment", points: 25, test: (f) => f.appointments_unpaid_90d >= 10 },
      { key: "service_catalog", label: "5+ active services listed", points: 25, test: (f) => f.services >= 5 },
      { key: "booking_steady", label: "5+ appointments in 90 days", points: 20, test: (f) => f.appointments_90d >= 5 },
    ],
  },
  restaurant_delivery_adoption: {
    label: "Restaurant likely to adopt delivery",
    eligible: (f) => f.delivery_orders === 0,
    factsSql: `SELECT r.owner_user_id AS id,
      (SELECT COUNT(*) FROM food_orders o WHERE o.restaurant_id=r.id AND o.created_at>=NOW()-interval '90 days' AND o.payment_status='paid')::int AS orders_90d,
      (SELECT COUNT(*) FROM food_orders o WHERE o.restaurant_id=r.id AND o.created_at>=NOW()-interval '90 days' AND o.payment_status='paid' AND o.fulfillment_type='pickup')::int AS pickup_90d,
      (SELECT COUNT(*) FROM food_orders o WHERE o.restaurant_id=r.id AND o.created_at>=NOW()-interval '30 days' AND o.payment_status='paid')::int AS orders_30d,
      (SELECT COUNT(*) FROM food_orders o WHERE o.restaurant_id=r.id AND o.created_at>=NOW()-interval '60 days' AND o.created_at<NOW()-interval '30 days' AND o.payment_status='paid')::int AS orders_prior_30d,
      (SELECT COUNT(*) FROM food_orders o WHERE o.restaurant_id=r.id AND o.fulfillment_type='delivery')::int AS delivery_orders,
      COALESCE(array_length(r.cuisine_tags,1),0)::int AS cuisine_count
      FROM food_restaurants r WHERE r.status='active' AND r.owner_user_id IS NOT NULL
      LIMIT 200000`,
    outcomeSql: `SELECT u.id, EXISTS(SELECT 1 FROM food_orders o JOIN food_restaurants r ON r.id=o.restaurant_id
        WHERE r.owner_user_id=u.id AND o.fulfillment_type='delivery' AND o.created_at>=NOW()-interval '90 days') AS outcome
      FROM users u WHERE u.id=ANY($1::uuid[])`,
    rules: [
      { key: "order_volume", label: "50+ paid orders in 90 days", points: 30, test: (f) => f.orders_90d >= 50 },
      { key: "pickup_heavy", label: "Pickup is 80%+ of orders, no delivery", points: 30, test: (f) => f.orders_90d >= 20 && f.pickup_90d / f.orders_90d >= 0.8 },
      { key: "order_growth", label: "Orders up 25%+ month over month", points: 25, test: (f) => f.orders_prior_30d >= 5 && f.orders_30d >= f.orders_prior_30d * 1.25 },
      { key: "cuisine_breadth", label: "2+ cuisine tags", points: 15, test: (f) => f.cuisine_count >= 2 },
    ],
  },
  customer_return: {
    label: "Customer likely to return",
    eligible: (f) => f.days_since_activity != null,
    factsSql: `SELECT u.id,
      (SELECT COUNT(*) FROM jobs j WHERE j.client_id=u.id AND j.status='completed')::int AS jobs_completed,
      (SELECT COUNT(*) FROM food_orders o WHERE o.customer_id=u.id AND o.payment_status='paid')::int AS orders_paid,
      (SELECT COUNT(*) FROM planned_needs p WHERE p.user_id=u.id AND p.status IN ('planned','funding','activating_soon'))::int AS planned_active,
      (SELECT COUNT(*) FROM saved_searches s WHERE s.user_id=u.id)::int AS saved_searches,
      (SELECT (EXTRACT(EPOCH FROM (NOW()-MAX(t)))/86400)::int FROM (
         SELECT created_at AS t FROM jobs WHERE client_id=u.id
         UNION ALL SELECT created_at FROM food_orders WHERE customer_id=u.id
         UNION ALL SELECT created_at FROM booking_requests WHERE customer_id=u.id) x) AS days_since_activity
      FROM users u
      WHERE u.role='customer' AND u.is_active AND NOT u.is_banned AND u.deleted_at IS NULL
      LIMIT 200000`,
    outcomeSql: `SELECT u.id, EXISTS(
        SELECT 1 FROM jobs j WHERE j.client_id=u.id AND j.created_at>=NOW()-interval '90 days'
        UNION ALL SELECT 1 FROM food_orders o WHERE o.customer_id=u.id AND o.created_at>=NOW()-interval '90 days'
        UNION ALL SELECT 1 FROM booking_requests br WHERE br.customer_id=u.id AND br.created_at>=NOW()-interval '90 days') AS outcome
      FROM users u WHERE u.id=ANY($1::uuid[])`,
    rules: [
      { key: "repeat_history", label: "3+ completed jobs or paid orders", points: 30, test: (f) => f.jobs_completed + f.orders_paid >= 3 },
      { key: "planned_need_active", label: "Has an active planned need", points: 25, test: (f) => f.planned_active >= 1 },
      { key: "dormant_window", label: "Last activity 30-90 days ago", points: 25, test: (f) => f.days_since_activity >= 30 && f.days_since_activity <= 90 },
      { key: "saved_searches", label: "2+ saved searches", points: 20, test: (f) => f.saved_searches >= 2 },
    ],
  },
});

function scoreFacts(model, facts) {
  const def = MODELS[model];
  if (!def) throw new Error("unknown_propensity_model");
  if (def.eligible && !def.eligible(facts)) return null;
  const fired = def.rules.filter((r) => {
    try {
      return r.test(facts);
    } catch {
      return false;
    }
  });
  const max = def.rules.reduce((sum, r) => sum + r.points, 0);
  const total = fired.reduce((sum, r) => sum + r.points, 0);
  const score = max ? Math.min(1, total / max) : 0;
  const reasons = [...fired]
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((r) => ({ key: r.key, label: r.label, points: r.points }));
  return { score: Math.round(score * 10000) / 10000, reasons };
}

async function computeModel(conn, model) {
  const def = MODELS[model];
  const { rows } = await conn.query(def.factsSql);
  let scored = 0;
  const values = [];
  for (const facts of rows) {
    const result = scoreFacts(model, facts);
    if (!result || result.score <= 0) continue;
    values.push([facts.id, model, result.score, JSON.stringify(result.reasons)]);
    scored++;
  }
  for (let i = 0; i < values.length; i += 500) {
    const chunk = values.slice(i, i + 500);
    const params = [];
    const tuples = chunk
      .map((v, j) => {
        params.push(...v, MODEL_VERSION);
        const b = j * 5;
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4}::jsonb,$${b + 5})`;
      })
      .join(",");
    await conn.query(
      `INSERT INTO propensity_scores(user_id,model,score,reasons,model_version,computed_at)
       VALUES ${tuples}
       ON CONFLICT(user_id,model) DO UPDATE SET score=EXCLUDED.score,reasons=EXCLUDED.reasons,
         model_version=EXCLUDED.model_version,computed_at=NOW()`,
      params,
    );
  }
  return scored;
}

// Predicted vs actual by decile over the current score snapshot.
async function calibration(conn, model) {
  const def = MODELS[model];
  if (!def) throw new Error("unknown_propensity_model");
  const { rows: scores } = await conn.query(
    "SELECT user_id,score FROM propensity_scores WHERE model=$1",
    [model],
  );
  const outcomes = new Map();
  for (let i = 0; i < scores.length; i += 500) {
    const chunk = scores.slice(i, i + 500);
    const { rows } = await conn.query(def.outcomeSql, [
      chunk.map((s) => s.user_id),
    ]);
    for (const r of rows) outcomes.set(r.id, r.outcome === true);
  }
  const deciles = Array.from({ length: 10 }, (_, d) => ({
    decile: d + 1,
    n: 0,
    predicted: 0,
    actual: 0,
  }));
  for (const s of scores) {
    const d = Math.min(9, Math.floor(Number(s.score) * 10));
    deciles[d].n++;
    deciles[d].predicted += Number(s.score);
    if (outcomes.get(s.user_id)) deciles[d].actual++;
  }
  return {
    model,
    method: "current_snapshot",
    model_version: MODEL_VERSION,
    total: scores.length,
    deciles: deciles.map((d) =>
      d.n >= K
        ? {
            decile: d.decile,
            n: d.n,
            predicted: Math.round((d.predicted / d.n) * 1000) / 1000,
            actual: Math.round((d.actual / d.n) * 1000) / 1000,
          }
        : { decile: d.decile, n: null, predicted: null, actual: null, suppressed: true },
    ),
  };
}

async function computeAll(conn) {
  const summary = {};
  for (const model of Object.keys(MODELS)) {
    try {
      summary[model] = await computeModel(conn, model);
      const report = await calibration(conn, model);
      await conn.query(
        "INSERT INTO propensity_calibration_reports(model,report) VALUES($1,$2::jsonb)",
        [model, JSON.stringify(report)],
      );
    } catch (err) {
      summary[model] = `error:${err.code || err.message || "unknown"}`;
    }
  }
  return summary;
}

module.exports = { MODELS, MODEL_VERSION, scoreFacts, computeModel, calibration, computeAll };
