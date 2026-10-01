'use strict';

/**
 * services/learnTagging.js — OpenRouter-assisted marketplace tagging for Learn guides.
 *
 * tagGuideWithAI(guideId) sends a guide's title/intro to OpenRouter and stores
 * tool / material / service suggestions in learn_guide_ai_suggestions for
 * admin review. It NEVER throws: every failure mode (missing key, timeout,
 * 429, bad JSON, DB unavailable) resolves to { skipped: <reason> } so
 * publishing can never break because of AI.
 *
 * The API key lives server-side only (OPENROUTER_API_KEY env) and is never
 * logged.
 */

const pool = require('../db');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_ITEMS = 8;

const LEARN_CATEGORIES = [
  'business', 'car-care', 'carpentry', 'consulting', 'customer', 'electrical',
  'franchise', 'helper', 'hvac', 'landscaping', 'life', 'logistics',
  'maintenance', 'management', 'painting', 'plumbing', 'sales', 'support',
  'tool-rental',
];

function getConfig() {
  return {
    key: process.env.OPENROUTER_API_KEY || '',
    model: process.env.OPENROUTER_MODEL || 'openrouter/free',
  };
}

function buildPrompt(guide) {
  const categoryList = LEARN_CATEGORIES.join(', ');
  return (
    'You are a DIY and home-services catalog assistant. Given a how-to guide, ' +
    'list the tools and materials a viewer needs, plus the pro-service category ' +
    'that matches the work. Respond with STRICT JSON only. No prose, no markdown fences, ' +
    'no explanations.\n\n' +
    `Schema: {"tools":[{"name":"string","purpose":"string","rent_search":"string","buy_search":"string"}],"materials":[{"name":"string","purpose":"string","buy_search":"string"}],"service":{"category":"one of: ${categoryList}","description":"string"}}\n\n` +
    `Limits: at most ${MAX_ITEMS} tools and ${MAX_ITEMS} materials. ` +
    'rent_search and buy_search are short web-search phrases for that item.\n\n' +
    `Guide title: ${guide.title}\n` +
    `Category: ${guide.category}\n` +
    `Intro: ${guide.intro || ''}`
  );
}

/** Strip markdown code fences and extract the JSON object from model output. */
function extractJson(text) {
  if (!text || typeof text !== 'string') return null;
  let cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function cleanName(v) {
  return typeof v === 'string' ? v.trim().slice(0, 120) : '';
}

function cleanText(v, max = 500) {
  return typeof v === 'string' ? v.trim().slice(0, max) : null;
}

/**
 * Fuzzy-match an item name against the Direct tool-rental catalog.
 * Returns { slug, confidence } or null.
 */
async function matchRentalTool(name) {
  const pattern = `%${name.replace(/[%_\\]/g, '\\$&')}%`;
  const { rows } = await pool.query(
    `SELECT slug, name_i18n ->> 'en' AS en_name
       FROM direct_catalog_tools
      WHERE is_active AND is_published
        AND (name_i18n ->> 'en' ILIKE $1 OR slug ILIKE $1)
      ORDER BY CASE WHEN LOWER(name_i18n ->> 'en') = LOWER($2) THEN 0 ELSE 1 END
      LIMIT 1`,
    [pattern, name]
  );
  if (!rows.length) return null;
  const exact = String(rows[0].en_name || '').toLowerCase() === name.toLowerCase();
  return { slug: rows[0].slug, confidence: exact ? 0.95 : 0.7 };
}

/**
 * Look up an existing admin-managed product link for an item name.
 * Guide-scoped rows win over global rows. Returns { buy_url, rent_url } or null.
 */
async function matchProductLink(guideId, name) {
  const { rows } = await pool.query(
    `SELECT buy_url, rent_url
       FROM learn_product_links
      WHERE is_active
        AND (guide_id = $1 OR guide_id IS NULL)
        AND LOWER(tool_name) = LOWER($2)
      ORDER BY guide_id NULLS LAST
      LIMIT 1`,
    [guideId, name]
  );
  if (rows.length) return { buy_url: rows[0].buy_url, rent_url: rows[0].rent_url };
  const pattern = `%${name.replace(/[%_\\]/g, '\\$&')}%`;
  const fuzzy = await pool.query(
    `SELECT buy_url, rent_url
       FROM learn_product_links
      WHERE is_active
        AND (guide_id = $1 OR guide_id IS NULL)
        AND tool_name ILIKE $2
      ORDER BY guide_id NULLS LAST
      LIMIT 1`,
    [guideId, pattern]
  );
  return fuzzy.rows.length
    ? { buy_url: fuzzy.rows[0].buy_url, rent_url: fuzzy.rows[0].rent_url }
    : null;
}

/** Fuzzy-match an AI category string against the 19 Learn category slugs. */
function matchLearnCategory(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const norm = raw.toLowerCase().replace(/[\s_]+/g, '-');
  if (LEARN_CATEGORIES.includes(norm)) return { slug: norm, confidence: 0.95 };
  const compact = norm.replace(/-/g, '');
  const hit = LEARN_CATEGORIES.find((c) => c.replace(/-/g, '') === compact);
  return hit ? { slug: hit, confidence: 0.8 } : null;
}

async function insertSuggestion(s) {
  const { rowCount } = await pool.query(
    `INSERT INTO learn_guide_ai_suggestions
       (guide_id, kind, name, detail, suggested_rent_url, suggested_buy_url,
        matched_rental_slug, matched_direct_category, confidence, raw_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     ON CONFLICT (guide_id, kind, LOWER(name)) WHERE status = 'pending' DO NOTHING`,
    [
      s.guide_id, s.kind, s.name, s.detail, s.suggested_rent_url,
      s.suggested_buy_url, s.matched_rental_slug, s.matched_direct_category,
      s.confidence, JSON.stringify(s.raw_json || null),
    ]
  );
  return rowCount;
}

/**
 * Tag a guide with AI. Never throws; resolves { ok, created, ... } or
 * { skipped: <reason> }.
 */
async function tagGuideWithAI(guideId) {
  try {
    const { key, model } = getConfig();
    if (!key) return { skipped: 'no-key' };

    let guide;
    try {
      const { rows } = await pool.query(
        'SELECT id, title, category, intro FROM learn_guides WHERE id = $1',
        [String(guideId)]
      );
      guide = rows[0];
    } catch {
      return { skipped: 'db-unavailable' };
    }
    if (!guide) return { skipped: 'guide-not-found' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          'HTTP-Referer': 'https://oxsteed.com',
          'X-Title': 'OxSteed Learn',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You output strict JSON only.' },
            { role: 'user', content: buildPrompt(guide) },
          ],
          temperature: 0.2,
          max_tokens: 1200,
        }),
      });
    } catch (err) {
      return { skipped: err && err.name === 'AbortError' ? 'timeout' : 'network-error' };
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429) return { skipped: 'rate-limited' };
    if (!res.ok) return { skipped: `http-${res.status}` };

    let payload;
    try {
      payload = await res.json();
    } catch {
      return { skipped: 'bad-json' };
    }
    const content = payload?.choices?.[0]?.message?.content;
    const parsed = extractJson(content);
    if (!parsed) return { skipped: 'bad-json' };

    let created = 0;
    const kinds = [
      ['tool', asArray(parsed.tools)],
      ['material', asArray(parsed.materials)],
    ];
    for (const [kind, items] of kinds) {
      for (const item of items.slice(0, MAX_ITEMS)) {
        const name = cleanName(item?.name);
        if (!name) continue;
        let rental = null;
        let link = null;
        try {
          rental = await matchRentalTool(name);
        } catch { /* fail soft: keep suggestion without a rental match */ }
        try {
          link = await matchProductLink(guide.id, name);
        } catch { /* fail soft */ }
        const suggestedRent =
          rental ? `/tool-rentals?search=${encodeURIComponent(rental.slug)}`
                 : link?.rent_url || null;
        created += await insertSuggestion({
          guide_id: guide.id,
          kind,
          name,
          detail: cleanText(item?.purpose, 500),
          suggested_rent_url: suggestedRent,
          suggested_buy_url: link?.buy_url || null,
          matched_rental_slug: rental?.slug || null,
          matched_direct_category: null,
          confidence: rental ? rental.confidence : link ? 0.7 : 0.5,
          raw_json: item,
        });
      }
    }

    if (parsed.service && typeof parsed.service === 'object') {
      const svcName = cleanName(parsed.service.category);
      const match = matchLearnCategory(svcName);
      created += await insertSuggestion({
        guide_id: guide.id,
        kind: 'service',
        name: svcName || 'service',
        detail: cleanText(parsed.service.description, 500),
        suggested_rent_url: null,
        suggested_buy_url: null,
        matched_rental_slug: null,
        matched_direct_category: match?.slug || null,
        confidence: match ? match.confidence : 0.5,
        raw_json: parsed.service,
      });
    }

    return { ok: true, guide_id: guide.id, created };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[learnTagging] unexpected failure', err && err.message);
    return { skipped: 'error' };
  }
}

/** Fire-and-forget wrapper for publishing paths: never blocks, never throws. */
function tagGuideInBackground(guideId) {
  setImmediate(() => {
    tagGuideWithAI(guideId).catch(() => {});
  });
}

module.exports = {
  tagGuideWithAI,
  tagGuideInBackground,
  extractJson,
  matchLearnCategory,
  LEARN_CATEGORIES,
};
