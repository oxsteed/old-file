"use strict";
// D21: Amazon Associates wiring (in-app and push only, never email).
//
// - Links: Amazon receives only the campaign's tracking tag (or the
//   configured associate tag). No per-click id, subid or user data is ever
//   added to an Amazon URL (spec §13.4, D10).
// - Items: an Amazon offer is pinned to one ASIN (amazon_offer_items). The
//   refresh job re-reads price/availability via GetItems; an item that is
//   missing, unavailable or older than 24 hours is never delivered or
//   redirected to.
// - Reports: Amazon reports by tracking tag only. Imports are immutable
//   (report_ref + content hash) and roll up into amazon_campaign_results.
const amazon = require("./amazonProducts");

const AMAZON_NETWORK = "amazon_associates";
const FRESH_MS = 24 * 60 * 60 * 1000;
const TAG_RE = /^[A-Za-z0-9-]{1,64}$/;

const isAmazon = (network) => String(network || "").toLowerCase() === AMAZON_NETWORK;

function amazonDestination(raw, domains, trackingTag) {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" || url.username || url.password || url.port ||
    !domains.includes(url.hostname.toLowerCase())
  )
    throw new Error("partner_destination_denied");
  if (!TAG_RE.test(String(trackingTag || ""))) throw new Error("amazon_tracking_tag_required");
  for (const key of [...url.searchParams.keys()])
    if (/^(tag|subid|ascsubtag|linkid|linkcode|ref_?|clickid)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.set("tag", trackingTag);
  return url.href;
}

function trackingTagFor(campaignTag, env = process.env) {
  if (campaignTag && TAG_RE.test(campaignTag)) return campaignTag;
  const fallback = env.GROWTH_AMAZON_ASSOCIATE_TAG;
  return fallback && TAG_RE.test(fallback) ? fallback : null;
}

function itemFresh(item, now = Date.now()) {
  if (!item) return false;
  const at = item.last_refreshed_at ? new Date(item.last_refreshed_at).getTime() : NaN;
  return item.available === true && Number.isFinite(at) && now - at <= FRESH_MS;
}

// ── report import ──────────────────────────────────────────────────────
const norm = (h) => String(h || "").toLowerCase().replace(/[^a-z]/g, "");
function money(value) {
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
function count(value) {
  const n = Number.parseInt(String(value ?? "").replace(/[^0-9-]/g, ""), 10);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}
function pick(row, ...prefixes) {
  for (const [k, v] of Object.entries(row)) if (prefixes.some((p) => norm(k).startsWith(p))) return v;
  return undefined;
}
function summarizeReport(csv) {
  const byTag = new Map();
  for (const row of amazon.parseReport(csv)) {
    const tag = String(pick(row, "trackingid") || "").trim();
    if (!TAG_RE.test(tag)) continue;
    const agg = byTag.get(tag) || { tracking_tag: tag, clicks: 0, ordered_items: 0, shipped_items: 0, revenue_minor: 0, earnings_minor: 0 };
    agg.clicks += count(pick(row, "clicks"));
    agg.ordered_items += count(pick(row, "itemsordered", "ordereditems"));
    agg.shipped_items += Number.parseInt(String(pick(row, "itemsshipped", "shippeditems") ?? "0"), 10) || 0;
    agg.revenue_minor += money(pick(row, "revenue", "shippedrevenue"));
    agg.earnings_minor += money(pick(row, "earnings", "advertisingfees", "totalearnings"));
    byTag.set(tag, agg);
  }
  return [...byTag.values()];
}

async function importReport(conn, { reportRef, csv, periodStart = null, periodEnd = null, currency = "USD", actorId = null }) {
  if (typeof reportRef !== "string" || !/^[\w.:-]{3,120}$/.test(reportRef)) throw Object.assign(new Error("amazon_report_ref_invalid"), { statusCode: 400, code: "amazon_report_ref_invalid" });
  if (!/^[A-Z]{3}$/.test(currency)) throw Object.assign(new Error("amazon_report_currency_invalid"), { statusCode: 400, code: "amazon_report_currency_invalid" });
  const evidence = amazon.reportEvidence(reportRef, csv);
  const { rows: [dupe] } = await conn.query(
    "SELECT id, report_ref FROM amazon_associate_reports WHERE report_ref=$1 OR content_sha256=$2 LIMIT 1",
    [reportRef, evidence.content_sha256],
  );
  if (dupe) return { duplicate: true, report_id: dupe.id };
  const { rows: [report] } = await conn.query(
    `INSERT INTO amazon_associate_reports (report_ref, content_sha256, row_count, evidence, period_start, period_end, imported_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [reportRef, evidence.content_sha256, evidence.row_count, JSON.stringify({ currency }), periodStart, periodEnd, actorId],
  );
  const rows = summarizeReport(csv);
  let mapped = 0;
  for (const r of rows) {
    const { rows: campaigns } = await conn.query(
      "SELECT id FROM offer_campaigns WHERE amazon_tracking_tag=$1 LIMIT 2",
      [r.tracking_tag],
    );
    const campaignId = campaigns.length === 1 ? campaigns[0].id : null;
    if (campaignId) mapped += 1;
    await conn.query(
      `INSERT INTO amazon_campaign_results (report_id, tracking_tag, campaign_id, clicks, ordered_items, shipped_items, revenue_minor, earnings_minor, currency)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [report.id, r.tracking_tag, campaignId, r.clicks, r.ordered_items, r.shipped_items, r.revenue_minor, r.earnings_minor, currency],
    );
  }
  return { duplicate: false, report_id: report.id, tags: rows.length, mapped, unmapped: rows.length - mapped, row_count: evidence.row_count };
}

async function campaignResults(conn, campaignId, { finance = false } = {}) {
  const { rows } = await conn.query(
    `SELECT r.currency, SUM(r.clicks)::int AS clicks, SUM(r.ordered_items)::int AS ordered_items,
            SUM(r.shipped_items)::int AS shipped_items, SUM(r.revenue_minor)::bigint AS revenue_minor,
            SUM(r.earnings_minor)::bigint AS earnings_minor, COUNT(DISTINCT r.report_id)::int AS reports,
            MAX(a.period_end) AS through
       FROM amazon_campaign_results r JOIN amazon_associate_reports a ON a.id=r.report_id
      WHERE r.campaign_id=$1 GROUP BY r.currency`,
    [campaignId],
  );
  return rows.map((r) => (finance ? r : { currency: r.currency, clicks: r.clicks, ordered_items: r.ordered_items, shipped_items: r.shipped_items, reports: r.reports, through: r.through }));
}

// ── item pinning and refresh ───────────────────────────────────────────
async function pinItem(conn, { offerId, item, host, actorId }) {
  if (!/^[A-Z0-9]{10}$/.test(String(item?.asin || ""))) throw Object.assign(new Error("amazon_asin_invalid"), { statusCode: 400, code: "amazon_asin_invalid" });
  const price = item.price == null ? null : Math.round(Number(item.price) * 100);
  await conn.query(
    `INSERT INTO amazon_offer_items (offer_id, asin, marketplace_host, title, price_minor, currency, available, last_refreshed_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8)
     ON CONFLICT (offer_id) DO UPDATE SET asin=EXCLUDED.asin, marketplace_host=EXCLUDED.marketplace_host,
       title=EXCLUDED.title, price_minor=EXCLUDED.price_minor, currency=EXCLUDED.currency,
       available=EXCLUDED.available, last_refreshed_at=NOW(), unavailable_reason=NULL`,
    [offerId, item.asin, host, String(item.title || "").slice(0, 500), Number.isSafeInteger(price) ? price : null, item.currency || null, item.available !== false, actorId],
  );
}

/**
 * Refreshes items older than `olderThanMs` (default 20h so the 24h limit is
 * never reached between hourly runs). Items Amazon no longer returns are
 * marked unavailable. A failed API call leaves rows untouched; they then go
 * stale and stop being delivered on their own.
 */
async function refreshDue(conn, { olderThanMs = 20 * 60 * 60 * 1000, limit = 100, deps = {} } = {}) {
  const { rows } = await conn.query(
    `SELECT i.offer_id, i.asin FROM amazon_offer_items i JOIN offers o ON o.id=i.offer_id
      WHERE o.status <> 'retired'
        AND (i.last_refreshed_at IS NULL OR i.last_refreshed_at < NOW() - ($1::bigint * interval '1 millisecond'))
      ORDER BY i.last_refreshed_at NULLS FIRST LIMIT $2`,
    [olderThanMs, limit],
  );
  const summary = { checked: rows.length, refreshed: 0, unavailable: 0, failed: 0 };
  for (let i = 0; i < rows.length; i += 10) {
    const batch = rows.slice(i, i + 10);
    let result;
    try {
      result = await (deps.getItems || amazon.getItems)(batch.map((r) => r.asin), deps.options || {});
    } catch {
      summary.failed += batch.length;
      continue;
    }
    if (!result.enabled) return { ...summary, skipped: "amazon_not_configured" };
    const byAsin = new Map(result.items.map((it) => [it.asin, it]));
    for (const row of batch) {
      const it = byAsin.get(row.asin);
      if (!it || it.available === false) {
        await conn.query(
          "UPDATE amazon_offer_items SET available=FALSE, unavailable_reason=$2, last_refreshed_at=NOW() WHERE offer_id=$1",
          [row.offer_id, it ? "not_buyable" : "not_returned"],
        );
        summary.unavailable += 1;
      } else {
        const price = it.price == null ? null : Math.round(Number(it.price) * 100);
        await conn.query(
          `UPDATE amazon_offer_items SET available=TRUE, unavailable_reason=NULL, title=$2, price_minor=$3,
             currency=$4, last_refreshed_at=NOW() WHERE offer_id=$1`,
          [row.offer_id, String(it.title || "").slice(0, 500), Number.isSafeInteger(price) ? price : null, it.currency || null],
        );
        summary.refreshed += 1;
      }
    }
  }
  return summary;
}

module.exports = {
  AMAZON_NETWORK,
  FRESH_MS,
  isAmazon,
  amazonDestination,
  trackingTagFor,
  itemFresh,
  summarizeReport,
  importReport,
  campaignResults,
  pinItem,
  refreshDue,
  disclosure: amazon.disclosure,
};
