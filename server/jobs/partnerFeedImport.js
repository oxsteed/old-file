"use strict";
// Nightly partner catalog feed import (spec 13.3).
//
// Fenced like every money-adjacent job. A feed is due when it has never run
// or its schedule_hours have elapsed; the worker schedule ticks hourly and
// this job picks up only due feeds of ACTIVE partners, so cadence stays
// nightly by default without a separate cron.
//
// Safety: fetching goes through growth/partners/feedFetch (HTTPS only,
// partner allowlist hosts, public DNS only, size/time caps). Prices come
// only from the feed. Images are fetched once, scanned, and stored under
// OxSteed's catalog prefix; partner URLs are never hot-linked. A failed or empty run never
// touches availability; a successful run marks items it did not see with
// feed_absent_runs + 1, and items absent for 2 consecutive runs become
// is_available = false.
const db = require("../db");
const { withFencedJobLock } = require("./jobLockingService");
const logger = require("../utils/logger");
const feedFetch = require("../growth/partners/feedFetch");
const feedParse = require("../growth/partners/feedParse");
const { storePartnerImage } = require("../growth/partners/imageStore");
const { resolveCategory } = require("../growth/partners/categoryMap");

const FORMAT_DEFAULT_MAPPINGS = {
  google_merchant: {
    id: "id",
    name: "title",
    description: "description",
    price: "price",
    url: "link",
    image_url: "image_link",
    category: "product_type",
    brand: "brand",
    gtin: "gtin",
    availability: "availability",
  },
};

async function loadFeed(runner, feedId) {
  const {
    rows: [feed],
  } = await runner.query(
    `SELECT f.*, p.code AS partner_code, p.status AS partner_status,
      p.link_domains_allowlist, p.currencies AS partner_currencies
     FROM partner_feeds f JOIN affiliate_partners p ON p.id = f.partner_id
     WHERE f.id = $1`,
    [feedId],
  );
  return feed || null;
}

function allowedHostsFor(feed) {
  const hosts = new Set(
    (feed.link_domains_allowlist || []).map((h) => String(h).toLowerCase()),
  );
  try {
    hosts.add(new URL(feed.url).hostname.toLowerCase());
  } catch {
    /* assertSafeUrl will reject the URL during fetch */
  }
  return [...hosts];
}

async function importFeed(runner, feed, deps = {}) {
  const fetch = deps.fetchFeed || feedFetch.fetchFeed;
  const {
    rows: [run],
  } = await runner.query(
    `INSERT INTO partner_feed_runs(feed_id, partner_id) VALUES($1,$2) RETURNING id, started_at`,
    [feed.id, feed.partner_id],
  );
  const finish = async (status, counts, error) => {
    await runner.query(
      `UPDATE partner_feed_runs SET status=$2, finished_at=NOW(), rows_seen=$3,
       rows_upserted=$4, rows_deactivated=$5, error=$6 WHERE id=$1`,
      [
        run.id,
        status,
        counts.seen || 0,
        counts.upserted || 0,
        counts.deactivated || 0,
        error || null,
      ],
    );
    await runner.query(
      `UPDATE partner_feeds SET last_run_at=NOW(), counts=$2, last_error=$3 WHERE id=$1`,
      [
        feed.id,
        JSON.stringify({ ...counts, status, at: new Date().toISOString() }),
        error || null,
      ],
    );
    return { runId: run.id, status, ...counts, error: error || undefined };
  };
  try {
    const { body } = await fetch(feed.url, {
      allowedHosts: allowedHostsFor(feed),
      lookup: deps.lookup,
      transport: deps.transport,
      maxBytes: deps.maxBytes,
      timeoutMs: deps.timeoutMs,
    });
    const records = feedParse.parseFeed(body, feed.format);
    if (!records.length) throw new Error("feed_empty");
    const mapping = {
      ...(FORMAT_DEFAULT_MAPPINGS[feed.format] || {}),
      ...(feed.field_mapping || {}),
    };
    const { rows: mappings } = await runner.query(
      "SELECT category_path, node_id FROM partner_category_map WHERE partner_id=$1",
      [feed.partner_id],
    );
    const items = [];
    let rejected = 0;
    for (const record of records) {
      const { item, error } = feedParse.normalizeItem(record, mapping, {
        currency: feed.partner_currencies?.[0],
      });
      if (error) {
        rejected++;
        continue;
      }
      const resolved = item.categoryPath
        ? resolveCategory(mappings, item.categoryPath)
        : null;
      let productImageUrl = null;
      if (item.imageUrl) {
        try {
          const stored = await (deps.storeImage || storePartnerImage)(item.imageUrl, {
            allowedHosts: allowedHostsFor(feed),
            lookup: deps.lookup,
            transport: deps.transport,
            timeoutMs: deps.imageTimeoutMs || deps.timeoutMs,
            fetchImage: deps.fetchImage,
            scan: deps.scanImage,
            upload: deps.uploadImage,
            publicUrl: deps.publicImageUrl,
          });
          productImageUrl = stored?.url || null;
        } catch (imageError) {
          logger.warn("partner feed image skipped", {
            feedId: feed.id,
            feedItemId: item.feedItemId,
            error: imageError.message,
          });
        }
      }
      items.push({ ...item, productImageUrl, taxonomyNodeId: resolved?.nodeId || null });
    }
    if (!items.length) throw new Error("feed_no_valid_items");
    let upserted = 0;
    // marketplace_products.source is VARCHAR(20); partner codes can be up to
    // 31 chars. partner_id is the authoritative link, so long codes fall
    // back to the generic 'partner' source label instead of failing.
    const source =
      feed.partner_code.length <= 20 ? feed.partner_code : "partner";
    const upsert = async (conn) => {
      for (const item of items) {
        await conn.query(
          `INSERT INTO marketplace_products(
             source, external_id, name, description, category, price_cents,
             currency, affiliate_url, is_active, is_available, partner_id,
             feed_item_id, country_codes, last_seen_at, brand, gtin,
             category_path, taxonomy_node_id, feed_absent_runs, updated_at,
             product_image_url)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9,$10,$11,$12,NOW(),$13,$14,$15,$16,0,NOW(),$17)
           ON CONFLICT (partner_id, feed_item_id) WHERE partner_id IS NOT NULL
           DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description,
             category=EXCLUDED.category, price_cents=EXCLUDED.price_cents,
             currency=EXCLUDED.currency, affiliate_url=EXCLUDED.affiliate_url,
             country_codes=EXCLUDED.country_codes, brand=EXCLUDED.brand,
             gtin=EXCLUDED.gtin, category_path=EXCLUDED.category_path,
             taxonomy_node_id=EXCLUDED.taxonomy_node_id,
             product_image_url=COALESCE(EXCLUDED.product_image_url, marketplace_products.product_image_url),
             is_available=EXCLUDED.is_available, last_seen_at=NOW(),
             feed_absent_runs=0, updated_at=NOW()`,
          [
            source,
            item.feedItemId,
            item.name,
            item.description,
            item.categoryPath ? item.categoryPath.slice(0, 100) : null,
            item.priceCents,
            item.currency,
            item.affiliateUrl,
            item.available,
            feed.partner_id,
            item.feedItemId,
            item.countryCodes,
            item.brand,
            item.gtin,
            item.categoryPath,
            item.taxonomyNodeId,
            item.productImageUrl,
          ],
        );
        upserted++;
      }
      await conn.query(
        `UPDATE marketplace_products SET feed_absent_runs = feed_absent_runs + 1,
           updated_at = NOW()
         WHERE partner_id=$1 AND feed_item_id IS NOT NULL
           AND (last_seen_at IS NULL OR last_seen_at < $2)`,
        [feed.partner_id, run.started_at],
      );
      const { rowCount: deactivated } = await conn.query(
        `UPDATE marketplace_products SET is_available=FALSE, updated_at=NOW()
         WHERE partner_id=$1 AND feed_absent_runs>=2 AND is_available=TRUE`,
        [feed.partner_id],
      );
      return deactivated;
    };
    const deactivated =
      typeof runner.tx === "function"
        ? await runner.tx(upsert)
        : await upsert(runner);
    return finish(
      "succeeded",
      { seen: records.length, upserted, deactivated, rejected },
      null,
    );
  } catch (error) {
    logger.warn("partner feed import failed", {
      feedId: feed.id,
      partnerId: feed.partner_id,
      error: error.message,
    });
    return finish(
      "failed",
      { seen: 0, upserted: 0, deactivated: 0, rejected: 0 },
      String(error.message || "feed_failed").slice(0, 500),
    );
  }
}

async function runDue(deps = {}) {
  if (process.env.GROWTH_PARTNER_OFFERS_ENABLED !== "true")
    return { skipped: true };
  return withFencedJobLock(
    "growth-partner-feed-import",
    async (fence) => {
      const { rows: feeds } = await fence.db.query(
        `SELECT f.id FROM partner_feeds f JOIN affiliate_partners p ON p.id=f.partner_id
         WHERE p.status='active'
           AND (f.last_run_at IS NULL
             OR f.last_run_at < NOW() - (f.schedule_hours || ' hours')::interval)
         ORDER BY f.id`,
      );
      const results = [];
      for (const row of feeds) {
        fence.assertActive();
        const feed = await loadFeed(fence.db, row.id);
        if (feed)
          results.push(
            await importFeed(
              { query: fence.db.query, tx: fence.fencedTransaction },
              feed,
              deps,
            ),
          );
      }
      return { processed: results.length, results };
    },
    1800,
  );
}

async function runFeed(feedId, deps = {}) {
  if (process.env.GROWTH_PARTNER_OFFERS_ENABLED !== "true")
    return { skipped: true };
  return withFencedJobLock(
    "growth-partner-feed-import",
    async (fence) => {
      const feed = await loadFeed(fence.db, feedId);
      if (!feed) throw new Error("feed_not_found");
      if (feed.partner_status !== "active") throw new Error("partner_inactive");
      return importFeed(
        { query: fence.db.query, tx: fence.fencedTransaction },
        feed,
        deps,
      );
    },
    1800,
  );
}

module.exports = { run: runDue, runDue, runFeed, importFeed, loadFeed, allowedHostsFor };
