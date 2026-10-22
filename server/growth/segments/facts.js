"use strict";
// Reviewed fact templates for the segment DSL (spec 11.1). This list is
// fixed on purpose: a segment may only use a fact that exists here, each
// fact compiles to a parameterized SQL fragment over domain tables, and
// values are always bound, never interpolated. Adding a fact is a code
// review decision, like adding a governed metric.
//
// Fact entry shape: { fact, op, value, window_days? }
// - numeric facts: value is a finite number; ops >=, <=, >, <, =
// - tier: value is a tier string; op = only
// - boolean facts (has_subscription, has_delivery): value true/false; op =
// window_days (1..395) is allowed only on windowed count facts.
const OPS = [">=", "<=", ">", "<", "="];

function countFragment(selectCount) {
  return ({ bind, op, value, window }) =>
    `(${selectCount(window ? ` AND ${window.col}>=NOW()-make_interval(days=>${bind(window.days)}::int)` : "")}) ${op} ${bind(value)}`;
}
const win = (col) => ({ col });

const TEMPLATES = Object.freeze({
  jobs_posted: {
    type: "number",
    ops: OPS,
    windowed: true,
    sql: countFragment(
      (w) =>
        `SELECT COUNT(*) FROM jobs j WHERE j.client_id=u.id AND j.deleted_at IS NULL${w}`,
    ),
  },
  jobs_completed: {
    type: "number",
    ops: OPS,
    windowed: true,
    sql: countFragment(
      (w) =>
        `SELECT COUNT(*) FROM jobs j WHERE (j.client_id=u.id OR j.assigned_helper_id=u.id) AND j.status='completed' AND j.deleted_at IS NULL${w}`,
    ),
  },
  bids_placed: {
    type: "number",
    ops: OPS,
    windowed: true,
    sql: countFragment((w) => `SELECT COUNT(*) FROM bids b WHERE b.helper_id=u.id${w}`),
  },
  bids_won: {
    type: "number",
    ops: OPS,
    windowed: true,
    sql: countFragment(
      (w) => `SELECT COUNT(*) FROM bids b WHERE b.helper_id=u.id AND b.status='accepted'${w}`,
    ),
  },
  bookings_made: {
    type: "number",
    ops: OPS,
    windowed: true,
    sql: countFragment(
      (w) =>
        `SELECT (SELECT COUNT(*) FROM booking_requests br WHERE br.customer_id=u.id${w}) + (SELECT COUNT(*) FROM business_appointments ba WHERE ba.customer_id=u.id${w})`,
    ),
  },
  orders_paid: {
    type: "number",
    ops: OPS,
    windowed: true,
    sql: countFragment(
      (w) =>
        `SELECT COUNT(*) FROM food_orders o WHERE o.customer_id=u.id AND o.payment_status='paid'${w}`,
    ),
  },
  marketplace_orders: {
    type: "number",
    ops: OPS,
    windowed: true,
    sql: countFragment(
      (w) =>
        `SELECT COUNT(*) FROM marketplace_orders o WHERE o.customer_id=u.id AND o.status IN ('paid','processing','completed')${w}`,
    ),
  },
  guides_completed: {
    type: "number",
    ops: OPS,
    windowed: true,
    sql: ({ bind, op, value, window }) =>
      `(SELECT COUNT(*) FROM user_guide_completions gc WHERE gc.user_id=u.id${window ? ` AND gc.completed_at>=NOW()-make_interval(days=>${bind(window.days)}::int)` : ""}) ${op} ${bind(value)}`,
  },
  menu_size: {
    type: "number",
    ops: OPS,
    windowed: false,
    sql: ({ bind, op, value }) =>
      `(SELECT COALESCE(MAX(cnt),0) FROM (SELECT COUNT(*) AS cnt FROM food_menu_items mi
         JOIN food_restaurants r ON r.id=mi.restaurant_id WHERE r.owner_user_id=u.id GROUP BY r.id) s) ${op} ${bind(value)}`,
  },
  tier: {
    type: "enum",
    ops: ["="],
    windowed: false,
    values: ["free", "pro", "broker", "premium"],
    sql: ({ bind, value }) =>
      `COALESCE((SELECT hp.tier FROM helper_profiles hp WHERE hp.user_id=u.id), u.tier, 'free') = ${bind(value)}`,
  },
  has_subscription: {
    type: "boolean",
    ops: ["="],
    windowed: false,
    sql: ({ bind, value }) =>
      `EXISTS(SELECT 1 FROM subscriptions s WHERE s.user_id=u.id AND s.status='active') = ${bind(value)}::boolean`,
  },
  has_delivery: {
    type: "boolean",
    ops: ["="],
    windowed: false,
    sql: ({ bind, value }) =>
      `EXISTS(SELECT 1 FROM food_restaurants r WHERE r.owner_user_id=u.id
         AND EXISTS(SELECT 1 FROM food_orders o WHERE o.restaurant_id=r.id AND o.fulfillment_type='delivery')) = ${bind(value)}::boolean`,
  },
});

// Window column per fact (created_at of the counted rows). The fragment
// builders above receive the window descriptor through this map keyed by
// the alias used inside each template; to keep templates simple the
// window predicate is expressed against the primary alias per fact:
const WINDOW_COLUMNS = Object.freeze({
  jobs_posted: "j.created_at",
  jobs_completed: "j.created_at",
  bids_placed: "b.created_at",
  bids_won: "b.created_at",
  bookings_made: "created_at",
  orders_paid: "o.created_at",
  marketplace_orders: "o.created_at",
  guides_completed: "gc.completed_at",
});

function validateFact(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  if (
    Object.keys(entry).some(
      (k) => !["fact", "op", "value", "window_days"].includes(k),
    )
  )
    return false;
  const t = TEMPLATES[entry.fact];
  if (!t || !t.ops.includes(entry.op)) return false;
  if (entry.window_days != null) {
    if (!t.windowed) return false;
    if (
      !Number.isInteger(entry.window_days) ||
      entry.window_days < 1 ||
      entry.window_days > 395
    )
      return false;
  }
  if (t.type === "number")
    return Number.isFinite(entry.value) && entry.value >= 0 && entry.value <= 1e9;
  if (t.type === "enum") return t.values.includes(entry.value);
  if (t.type === "boolean") return typeof entry.value === "boolean";
  return false;
}

// bookings_made counts two tables; its window predicate must reference
// each subquery's own alias, so it is handled specially at compile time.
function compileFact(bind, entry) {
  const t = TEMPLATES[entry.fact];
  const window =
    entry.window_days != null
      ? { col: WINDOW_COLUMNS[entry.fact], days: entry.window_days }
      : null;
  if (entry.fact === "bookings_made") {
    const w = window
      ? {
          br: ` AND br.created_at>=NOW()-make_interval(days=>${bind(window.days)}::int)`,
          ba: ` AND ba.created_at>=NOW()-make_interval(days=>${bind(window.days)}::int)`,
        }
      : { br: "", ba: "" };
    return `((SELECT COUNT(*) FROM booking_requests br WHERE br.customer_id=u.id${w.br}) + (SELECT COUNT(*) FROM business_appointments ba WHERE ba.customer_id=u.id${w.ba})) ${entry.op} ${bind(entry.value)}`;
  }
  return t.sql({
    bind,
    op: entry.op,
    value: entry.value,
    window: window ? { col: window.col, days: window.days } : null,
  });
}

module.exports = { TEMPLATES, WINDOW_COLUMNS, validateFact, compileFact };
