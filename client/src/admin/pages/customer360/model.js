import { getCreditMinorUnits } from "../../../lib/creditCurrency.js";
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
export function moneyMinor(value, currency, locale = "en") {
  if (value == null) return "—";
  if (!currency) return String(value);
  if (typeof value === "number" && !Number.isSafeInteger(value)) return "—";
  try {
    const amount = BigInt(String(value)),
      units = getCreditMinorUnits(currency),
      scale = 10n ** BigInt(units);
    const absolute = amount < 0n ? -amount : amount,
      whole = absolute / scale,
      remainder = absolute % scale;
    const language = locale === "ht" ? "fr-HT" : locale;
    const formatter = new Intl.NumberFormat(language, {
      style: "currency",
      currency,
      minimumFractionDigits: units,
      maximumFractionDigits: units,
    });
    const signed = amount < 0n ? (whole === 0n ? -0 : -whole) : whole;
    const fraction = units
      ? new Intl.NumberFormat(language, {
          useGrouping: false,
          minimumIntegerDigits: units,
          maximumFractionDigits: 0,
        }).format(Number(remainder))
      : "";
    return formatter
      .formatToParts(signed)
      .map((part) => (part.type === "fraction" ? fraction : part.value))
      .join("");
  } catch {
    return "—";
  }
}
export function moneyMajor(value, currency, locale = "en") {
  if (value == null) return "—";
  if (!currency) return String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!match) return "—";
  const units = getCreditMinorUnits(currency),
    fraction = match[3] || "";
  let minor =
    BigInt(match[2]) * 10n ** BigInt(units) +
    BigInt(fraction.slice(0, units).padEnd(units, "0") || "0");
  if (fraction.length > units && Number(fraction[units]) >= 5) minor += 1n;
  return moneyMinor(String(match[1] ? -minor : minor), currency, locale);
}
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
