/**
 * seedLearnProductLinks.js
 * Populates learn_product_links from the existing learnGuides.json catalog.
 *
 * Strategy:
 *   - A tool that appears in multiple guides gets ONE global row (guide_id = NULL).
 *   - A tool that appears in only one guide gets a guide-scoped row.
 *   - Rows already in the table (matched by tool_name + guide_id) are skipped (idempotent).
 *   - link_type is inferred from the buy URL:
 *       amazon.com  → amazon_affiliate
 *       no buy URL  → rental (rent URL only)
 *
 * Usage:
 *   node scripts/seedLearnProductLinks.js
 *   DATABASE_URL=... node scripts/seedLearnProductLinks.js
 */

require('dotenv').config();
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function run() {
  const guidesPath = path.join(__dirname, '../data/learnGuides.json');
  const { guides } = JSON.parse(fs.readFileSync(guidesPath, 'utf8'));

  // Collect all tool occurrences: Map<toolName, Set<guideId>>
  // Also track the canonical buy/rent URLs per tool name (first occurrence wins).
  const toolGuides  = new Map(); // toolName → Set<guideId>
  const toolBuyURL  = new Map(); // toolName → buy url
  const toolRentURL = new Map(); // toolName → rent url

  for (const guide of guides) {
    for (const tool of (guide.tools ?? [])) {
      const name = tool.name?.trim();
      if (!name) continue;

      if (!toolGuides.has(name)) {
        toolGuides.set(name, new Set());
        // Prefer non-null URLs from first occurrence
        toolBuyURL.set(name,  tool.buy  ?? tool.buyURL  ?? null);
        toolRentURL.set(name, tool.rent ?? tool.rentURL ?? null);
      }
      toolGuides.get(name).add(guide.id);

      // If a later guide has a buy URL where the first didn't, fill it in
      if (!toolBuyURL.get(name) && (tool.buy ?? tool.buyURL)) {
        toolBuyURL.set(name, tool.buy ?? tool.buyURL);
      }
      if (!toolRentURL.get(name) && (tool.rent ?? tool.rentURL)) {
        toolRentURL.set(name, tool.rent ?? tool.rentURL);
      }
    }
  }

  // Build insert rows
  const rows = [];
  for (const [name, guideSet] of toolGuides.entries()) {
    const buyURL  = toolBuyURL.get(name);
    const rentURL = toolRentURL.get(name);

    let linkType;
    if (buyURL?.includes('amazon.com')) {
      linkType = 'amazon_affiliate';
    } else if (buyURL) {
      linkType = 'partner';
    } else {
      linkType = 'rental';
    }

    // Global row if tool appears in >1 guide; scoped row otherwise
    const guideId = guideSet.size === 1 ? [...guideSet][0] : null;

    rows.push({ name, guideId, linkType, buyURL, rentURL });
  }

  console.log(`Found ${rows.length} unique tools across ${guides.length} guides.`);

  const client = await pool.connect();
  let inserted = 0, skipped = 0;

  try {
    for (const row of rows) {
      // Idempotent: skip if a row already exists for this tool + scope
      const { rowCount: existing } = await client.query(
        `SELECT 1 FROM learn_product_links
         WHERE LOWER(tool_name) = LOWER($1)
           AND (guide_id = $2 OR (guide_id IS NULL AND $2 IS NULL))
         LIMIT 1`,
        [row.name, row.guideId],
      );

      if (existing > 0) {
        skipped++;
        continue;
      }

      await client.query(
        `INSERT INTO learn_product_links
           (guide_id, tool_name, link_type, buy_url, rent_url, affiliate_tag, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
        [
          row.guideId,
          row.name,
          row.linkType,
          row.buyURL   || null,
          row.rentURL  || null,
          row.linkType === 'amazon_affiliate' ? 'oxsteed-20' : null,
        ],
      );
      inserted++;
    }
  } finally {
    client.release();
  }

  console.log(`Done. Inserted: ${inserted}, Skipped (already exist): ${skipped}`);
  await pool.end();
}

run().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
