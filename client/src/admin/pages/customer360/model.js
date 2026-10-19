export const AREAS = [
  "all",
  "attention",
  "timeline",
  "work",
  "finance",
  "credit",
  "restaurantCredit",
  "restaurants",
  "commerce",
  "business",
  "devices",
  "documents",
  "subscriptions",
  "logistics",
  "support",
  "communications",
  "privacy",
  "security",
  "trust",
  "cases",
  "eligibility",
  "guides",
  "assistant",
  "exports",
  "experience",
  "quality",
];
export const ISSUE_STATUSES = new Set([
  "failed",
  "past_due",
  "overdue",
  "under_review",
  "open",
  "pending",
  "conflict",
  "unpaid_review",
  "blocked",
  "needs_review",
]);
export function sectionTimeline(sections) {
  return Object.values(sections || {})
    .filter((s) => s.state === "ready")
    .flatMap((s) =>
      s.records.map((r) => ({ ...r, source: s.key, area: s.area })),
    )
    .sort(
      (a, b) =>
        new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0) ||
        String(a.id).localeCompare(String(b.id)),
    );
}
export function connectionState(record, now = Date.now()) {
  if (record.status !== "paired") return record.status || "unknown";
  const age = now - new Date(record.last_seen_at || 0).getTime();
  return age >= 60000 ? "offline" : age >= 45000 ? "degraded" : "online";
}
export { moneyMinor, moneyMajor } from "../../../lib/moneyExact.js";

export function recordRoute(section, record, userId) {
  if (section.key === "jobs")
    return `/admin/jobs/${encodeURIComponent(record.id)}`;
  if (section.key === "foodOrders")
    return `/admin/food-orders/${encodeURIComponent(record.id)}`;
  if (section.key === "businesses")
    return `/admin/businesses/${encodeURIComponent(record.id)}/360`;
  if (section.area === "credit")
    return `/admin/super/oxsteed-credit/customers?customerId=${encodeURIComponent(userId)}&currencyCode=${encodeURIComponent(record.currency_code || "")}`;
  return section.route || null;
}
export function selectedRecords(data, area, source) {
  return Object.values(data?.sections || {}).filter(
    (s) => (!source || s.key === source) && (area === "all" || s.area === area),
  );
}
