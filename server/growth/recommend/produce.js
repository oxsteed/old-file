"use strict";
// Suggestion production (spec 12). Nightly: scan for opportunities, map
// each to eligible offers through offer_intent_map, score statistically,
// optionally re-rank the top 20 with the self-hosted Ollama model, and
// store pending_review suggestions for an admin to accept or reject.
//
// Privacy contract for the Ollama step: the payload contains aggregate
// facts only (counts, rates, intent labels, offer titles and prices from
// the feed). Never names, ids of people, or text written by users. The
// output is validated (ids must come from the input, length caps, banned
// claims, no price or rate that was not in the input); any failure keeps
// the statistical ranking with template rationale text.
const crypto = require("crypto");
const gate = require("../gate");
const insights = require("../insights");
const segments = require("../segments/compile");
const campaigns = require("../campaigns");
const { score: scorePrimitive } = require("./score");
const { ROLE_SQL } = require("../roles");

const GLOBAL_BOUNDARY = { global: true, regions: [] };
const MAX_OPPORTUNITIES = 10;
const MAX_CANDIDATES = 20;
const MAX_SUGGESTIONS_PER_OPPORTUNITY = 3;
const BANNED_PHRASES = ["guaranteed", "guarantee", "risk-free", "risk free"];

async function resolveAuthor(conn) {
  if (process.env.GROWTH_SUGGESTION_AUTHOR_ID) {
    const {
      rows: [u],
    } = await conn.query("SELECT id FROM users WHERE id=$1 AND is_active", [
      process.env.GROWTH_SUGGESTION_AUTHOR_ID,
    ]);
    if (u) return u.id;
  }
  const {
    rows: [admin],
  } = await conn.query(
    "SELECT id FROM users WHERE role='super_admin' AND is_active ORDER BY created_at LIMIT 1",
  );
  return admin?.id || null;
}

// Beta-Binomial style smoothed rates come from the existing scoring
// primitive; the priors are the observed intent x role x channel history,
// falling back to the global history when the cell is thin (<30 sent).
async function ratesFor(conn, { nodeId, role, channel }) {
  const HISTORY = `
    WITH hist AS (
      SELECT d.id AS delivery_id, d.channel, c.offer_id, ${ROLE_SQL} AS role
      FROM offer_campaign_deliveries d
      JOIN offer_campaigns c ON c.id=d.campaign_id
      JOIN offer_campaign_recipients r ON r.id=d.recipient_id
      JOIN users u ON u.id=r.user_id
      WHERE d.status='sent'
    ), scoped AS (
      SELECT * FROM hist WHERE TRUE`;
  const TAIL = `
    )
    SELECT (SELECT COUNT(*) FROM scoped)::int AS delivered,
      (SELECT COUNT(*) FROM offer_clicks oc JOIN scoped s ON s.delivery_id=oc.delivery_id)::int AS clicks,
      (SELECT COUNT(*) FROM affiliate_conversions ac
         JOIN offer_clicks oc ON oc.click_id=ac.click_id
         JOIN scoped s ON s.delivery_id=oc.delivery_id
        WHERE ac.status IN ('approved','paid'))::int AS conversions`;
  const {
    rows: [scoped],
  } = await conn.query(
    `${HISTORY} AND channel=$3 AND role=$2
       AND EXISTS(SELECT 1 FROM offer_intent_map m WHERE m.offer_id=hist.offer_id AND m.node_id=$1) ${TAIL}`,
    [nodeId, role, channel],
  );
  if (scoped && scoped.delivered >= 30)
    return { ...scoped, prior: "intent_role_channel" };
  const {
    rows: [global],
  } = await conn.query(`${HISTORY} ${TAIL}`, []);
  return { ...global, prior: "global" };
}

function valuePerConversion(offer, partner) {
  if (offer.type === "affiliate_product") {
    const rate = Number(partner?.commission_terms?.default_rate);
    const r = Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 0.04;
    return Math.round(Number(offer.value_minor) * r);
  }
  if (offer.type === "plan") return Number(offer.value_minor);
  return 0; // promos cost money; they rank on reach and exploration
}

async function eligibleOffers(conn, opportunity) {
  const { rows } = await conn.query(
    `SELECT o.*, m.relevance, p.commission_terms, p.status AS partner_status,
            p.allowed_channels AS partner_channels, p.countries_allowed AS partner_countries,
            p.currencies AS partner_currencies
     FROM offer_intent_map m JOIN offers o ON o.id=m.offer_id
     LEFT JOIN affiliate_partners p ON p.id=o.partner_id
     WHERE m.node_id=$1 AND o.status='active' AND o.expires_at>NOW()
     ORDER BY m.relevance DESC LIMIT 50`,
    [opportunity.node_id],
  );
  return rows.filter((o) => {
    if (!o.countries.includes(opportunity.country)) return false;
    if (o.type === "affiliate_product") {
      if (o.partner_status !== "active") return false;
      if (o.channels.some((ch) => !(o.partner_channels || []).includes(ch)))
        return false;
      if (!(o.partner_countries || []).includes(opportunity.country)) return false;
      if (!(o.partner_currencies || []).includes(o.currency)) return false;
    }
    try {
      campaigns.validateCopy(o.copy, o.channels, {
        affiliate: o.type === "affiliate_product",
      });
    } catch {
      return false; // copy (incl. disclosure) must exist in all 5 languages
    }
    return true;
  });
}

async function activePenalty(conn, offerId, nodeId) {
  const {
    rows: [row],
  } = await conn.query(
    `SELECT id FROM offer_pair_penalties WHERE offer_id=$1 AND (node_id=$2 OR node_id IS NULL)
      AND penalty_until>NOW() ORDER BY penalty_until DESC LIMIT 1`,
    [offerId, nodeId],
  );
  return Boolean(row);
}

async function alreadySuggested(conn, offerId, intentCode) {
  const {
    rows: [row],
  } = await conn.query(
    `SELECT s.id FROM offer_suggestions s
     JOIN growth_segment_versions v ON v.id=s.segment_version_id
     WHERE s.offer_id=$1 AND s.status='pending_review' AND s.created_at>NOW()-interval '7 days'
       AND v.definition->'intents'->0->>'code'=$2 LIMIT 1`,
    [offerId, intentCode],
  );
  return Boolean(row);
}

// Opportunity scan: gap areas and rising intents from the exact-window
// cells, provider clusters from the cluster finder, and top propensity
// deciles grouped by interest and place.
async function scanOpportunities(conn) {
  const opportunities = [];
  const cells = await insights.computeCells(conn, GLOBAL_BOUNDARY);
  const seen = new Set();
  const pushCell = (kind, cell) => {
    const key = `${kind}:${cell.id}:${cell.node_id}`;
    if (seen.has(key) || opportunities.length >= MAX_OPPORTUNITIES) return;
    seen.add(key);
    opportunities.push({
      kind,
      node_id: cell.node_id,
      intent_code: cell.code,
      intent_label: cell.labels?.en || cell.code,
      country: cell.country,
      postal_ref: cell.id,
      place_name: cell.place_name,
      demand_people: cell.people,
      gap: cell.gap_raw,
      trend_pct: cell.trend_pct,
      trend_state: cell.trend_state,
      roles: ["customer", "helper"],
      segment: {
        roles: ["customer", "helper"],
        area: { type: "postal_list", ids: [cell.id] },
        intents: [{ code: cell.code, min_score: 0.5, window_days: 60 }],
      },
    });
  };
  for (const cell of cells.filter((c) => c.gap_raw >= 3)) pushCell("gap", cell);
  for (const cell of cells.filter(
    (c) => c.trend_state === "ok" && c.trend_pct >= 50,
  ))
    pushCell("rising_intent", cell);
  // Clusters: the strongest intents per country get a provider cluster.
  const clusterIntents = new Map();
  for (const cell of cells) {
    const key = `${cell.country}:${cell.node_id}`;
    const acc = clusterIntents.get(key) || { total: 0, cell };
    acc.total += cell.people;
    clusterIntents.set(key, acc);
  }
  const topIntents = [...clusterIntents.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);
  for (const { cell } of topIntents) {
    if (opportunities.length >= MAX_OPPORTUNITIES) break;
    try {
      const found = await require("../geo/clusters").find(
        conn,
        {
          intent: cell.code,
          role: "helper",
          country: cell.country,
          miles: 35,
          min_n: 5,
        },
        GLOBAL_BOUNDARY,
      );
      for (const cluster of found.slice(0, 2)) {
        if (opportunities.length >= MAX_OPPORTUNITIES) break;
        const clusterId = `c_${new Date().toISOString().slice(0, 10)}_${cell.country}_${cluster.anchor_id}_${cell.code.split(".").pop()}`;
        await conn.query(
          `INSERT INTO growth_clusters(id,intent_code,role,country,anchor_postal_ref,miles,postal_refs,member_count,definition)
           VALUES($1,$2,'helper',$3,$4,35,$5,$6,$7::jsonb) ON CONFLICT(id) DO NOTHING`,
          [
            clusterId,
            cell.code,
            cell.country,
            cluster.anchor_id,
            cluster.postal_refs,
            cluster.member_count,
            JSON.stringify({ source: "suggestion_producer" }),
          ],
        );
        opportunities.push({
          kind: "cluster",
          node_id: cell.node_id,
          intent_code: cell.code,
          intent_label: cell.labels?.en || cell.code,
          country: cell.country,
          demand_people: cluster.member_count,
          roles: ["helper"],
          segment: {
            roles: ["helper"],
            area: { type: "cluster", cluster_id: clusterId },
            intents: [{ code: cell.code, min_score: 0.5, window_days: 60 }],
          },
        });
      }
    } catch {
      // Cluster finder unavailable for this intent; other scans continue.
    }
  }
  // Propensity deciles: top-decile people per model, grouped by their
  // strongest interest and its postal reference.
  const MODELS = require("../propensity").MODELS;
  const MODEL_ROLES = {
    helper_tier_upgrade: ["helper"],
    customer_to_helper: ["customer"],
    business_invoicing_adoption: ["business"],
    restaurant_delivery_adoption: ["restaurant"],
    customer_return: ["customer"],
  };
  for (const model of Object.keys(MODELS)) {
    if (opportunities.length >= MAX_OPPORTUNITIES) break;
    const {
      rows: [threshold],
    } = await conn.query(
      `SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY score) AS p90, COUNT(*)::int AS n
       FROM propensity_scores WHERE model=$1`,
      [model],
    );
    if (!threshold?.p90 || threshold.n < 50) continue;
    const { rows: groups } = await conn.query(
      `SELECT p.node_id, n.code, n.labels, u.zip_code AS postal_code, g.id AS postal_ref,
              g.country, COUNT(DISTINCT ps.user_id)::int AS people
       FROM propensity_scores ps
       JOIN user_interest_profiles p ON p.user_id=ps.user_id
       JOIN demand_taxonomy_nodes n ON n.id=p.node_id AND n.status='active' AND NOT n.sensitive
       JOIN users u ON u.id=ps.user_id
       JOIN geo_postal_centroids g ON g.id=p.postal_ref
       WHERE ps.model=$1 AND ps.score>=$2 AND p.score>=0.5
       GROUP BY p.node_id, n.code, n.labels, u.zip_code, g.id, g.country
       HAVING COUNT(DISTINCT ps.user_id)>=5
       ORDER BY people DESC LIMIT 2`,
      [model, threshold.p90],
    );
    for (const g of groups) {
      if (opportunities.length >= MAX_OPPORTUNITIES) break;
      opportunities.push({
        kind: "propensity",
        node_id: g.node_id,
        intent_code: g.code,
        intent_label: g.labels?.en || g.code,
        country: g.country,
        demand_people: g.people,
        roles: MODEL_ROLES[model],
        segment: {
          roles: MODEL_ROLES[model],
          propensity: { model, min_decile: 9 },
          intents: [{ code: g.code, min_score: 0.5, window_days: 60 }],
        },
      });
    }
  }
  return opportunities;
}

const RANK_SCHEMA = {
  type: "object",
  properties: {
    ranking: { type: "array", items: { type: "integer" }, maxItems: 20 },
    rationale: { type: "string", maxLength: 600 },
    risks: { type: "string", maxLength: 600 },
  },
  required: ["ranking", "rationale"],
  additionalProperties: false,
};

// Strict output validation beyond the JSON schema: ids must come from the
// input, no banned claims, and no price or percentage that was not in the
// aggregate input (the model may not invent numbers).
function validateRanking(output, candidates) {
  if (!output || !Array.isArray(output.ranking)) return null;
  const allowedIds = new Set(candidates.map((c) => Number(c.offer_id)));
  const ranking = output.ranking.map(Number);
  if (
    !ranking.length ||
    ranking.some((id) => !allowedIds.has(id)) ||
    new Set(ranking).size !== ranking.length
  )
    return null;
  const text = `${output.rationale || ""} ${output.risks || ""}`.toLowerCase();
  if (BANNED_PHRASES.some((p) => text.includes(p))) return null;
  const hasFreeOffer = candidates.some((c) => Number(c.value_minor) === 0);
  if (!hasFreeOffer && /\bfree\b/.test(text)) return null;
  const allowedNumbers = new Set();
  for (const c of candidates) {
    allowedNumbers.add(String(Number(c.value_minor)));
    allowedNumbers.add((Number(c.value_minor) / 100).toFixed(2));
    allowedNumbers.add(String(Math.round(c.ctr * 100)));
    allowedNumbers.add(String(Math.round(c.cvr * 100)));
  }
  for (const m of text.matchAll(/\$?\s?(\d+(?:\.\d{1,2})?)\s?%?/g)) {
    const token = m[1];
    if (
      token.length >= 2 &&
      !allowedNumbers.has(token) &&
      !allowedNumbers.has(String(Number(token)))
    )
      return null;
  }
  return {
    ranking,
    rationale: String(output.rationale).slice(0, 600),
    risks: String(output.risks || "").slice(0, 600),
  };
}

async function rerank(opportunity, candidates) {
  const facts = {
    opportunity: {
      kind: opportunity.kind,
      intent: opportunity.intent_label,
      country: opportunity.country,
      people: opportunity.demand_people,
      gap: opportunity.gap ? Math.round(opportunity.gap * 100) / 100 : null,
      trend_pct: opportunity.trend_pct,
    },
    candidates: candidates.map((c) => ({
      offer_id: Number(c.offer_id),
      title: c.title,
      price_minor: Number(c.value_minor),
      currency: c.currency,
      ctr_pct: Math.round(c.ctr * 100),
      cvr_pct: Math.round(c.cvr * 100),
      expected_minor: Math.round(c.expected_minor),
    })),
  };
  let ai = null;
  try {
    ai = await require("../ollamaClient").generate({
      data: facts,
      schema: RANK_SCHEMA,
      task: "rank",
    });
  } catch {
    ai = null;
  }
  const validated = ai ? validateRanking(ai.output, candidates) : null;
  if (!validated) return { order: candidates, ai: null };
  const byId = new Map(candidates.map((c) => [Number(c.offer_id), c]));
  const ordered = validated.ranking
    .map((id) => byId.get(id))
    .filter(Boolean);
  for (const c of candidates) if (!ordered.includes(c)) ordered.push(c);
  return {
    order: ordered,
    ai: { ...validated, model: ai.model, prompt_version: ai.prompt_version },
  };
}

async function produce(conn, { authorId = null } = {}) {
  if (!gate.rolloutAllows(await gate.runtimePolicy(conn)).allowed)
    return { skipped: true, reason: "rollout_not_effective" };
  const author = authorId || (await resolveAuthor(conn));
  if (!author) return { skipped: true, reason: "suggestion_author_unavailable" };
  const opportunities = await scanOpportunities(conn);
  const summary = { opportunities: opportunities.length, stored: 0, skipped: 0 };
  for (const opportunity of opportunities) {
    const offers = await eligibleOffers(conn, opportunity);
    if (!offers.length) {
      summary.skipped++;
      continue;
    }
    // Freeze the draft segment first: suggestions pin a segment version,
    // exactly like campaigns do.
    const definition = segments.validate(opportunity.segment);
    const {
      rows: [seg],
    } = await conn.query(
      "INSERT INTO growth_segments(name,created_by) VALUES($1,$2) RETURNING id",
      [
        `Auto: ${opportunity.kind} ${opportunity.intent_code} ${opportunity.country}`.slice(0, 120),
        author,
      ],
    );
    const {
      rows: [version],
    } = await conn.query(
      "INSERT INTO growth_segment_versions(segment_id,version,definition,created_by) VALUES($1,1,$2::jsonb,$3) RETURNING id",
      [seg.id, JSON.stringify(definition), author],
    );
    let members = [];
    try {
      members = await segments.evaluate(
        conn,
        definition,
        GLOBAL_BOUNDARY,
        "activity_offers",
      );
    } catch {
      members = [];
    }
    const reach = members.length;
    if (!reach) {
      summary.skipped++;
      continue;
    }
    const memberIds = members.map((m) => m.id);
    const {
      rows: [fatigueRow],
    } = await conn.query(
      `SELECT COALESCE(AVG(cnt),0)::float AS fatigue FROM (
         SELECT COUNT(*) AS cnt FROM marketing_contact_log
         WHERE user_id=ANY($1::uuid[]) AND contacted_at>=NOW()-interval '7 days'
         GROUP BY user_id) t`,
      [memberIds],
    );
    const {
      rows: [overlapRow],
    } = await conn.query(
      `SELECT COUNT(DISTINCT r.user_id)::int AS overlapped FROM offer_campaign_recipients r
       JOIN offer_campaigns c ON c.id=r.campaign_id
       WHERE r.user_id=ANY($1::uuid[]) AND c.status IN ('approved','scheduled','queued','sending')`,
      [memberIds],
    );
    const fatigue = Number(fatigueRow?.fatigue || 0);
    const overlap = reach ? Number(overlapRow?.overlapped || 0) / reach : 0;
    const primaryRole = opportunity.roles[0];
    const candidates = [];
    for (const offer of offers.slice(0, MAX_CANDIDATES)) {
      if (await alreadySuggested(conn, offer.id, opportunity.intent_code))
        continue;
      const channel = offer.channels[0];
      const rates = await ratesFor(conn, {
        nodeId: opportunity.node_id,
        role: primaryRole,
        channel,
      });
      const penalized = await activePenalty(conn, offer.id, opportunity.node_id);
      const scored = scorePrimitive({
        reach,
        clicks: rates.clicks,
        delivered: rates.delivered,
        conversions: rates.conversions,
        commission_minor: valuePerConversion(offer, {
          commission_terms: offer.commission_terms,
        }),
        fatigue,
        overlap,
      });
      candidates.push({
        offer_id: offer.id,
        title: offer.title,
        value_minor: offer.value_minor,
        currency: offer.currency,
        ctr: scored.ctr,
        cvr: scored.cvr,
        expected_minor: scored.expected_minor,
        score: penalized ? scored.score * 0.2 : scored.score,
        penalized,
        prior: rates.prior,
      });
    }
    if (!candidates.length) {
      summary.skipped++;
      continue;
    }
    candidates.sort((a, b) => b.score - a.score);
    const { order, ai } = await rerank(
      opportunity,
      candidates.slice(0, MAX_CANDIDATES),
    );
    for (const candidate of order.slice(0, MAX_SUGGESTIONS_PER_OPPORTUNITY)) {
      const rationale = [
        `${opportunity.kind} opportunity: ${opportunity.demand_people} people, intent ${opportunity.intent_code}, ${opportunity.country}.`,
        `Rates from ${candidate.prior} history (Beta-Binomial smoothed). Fatigue ${fatigue.toFixed(2)}, overlap ${Math.round(overlap * 100)}%.`,
        candidate.penalized
          ? "Lowered: this offer x intent pair was rejected by an admin within the last 30 days."
          : null,
        ai
          ? `AI-written, check before use: ${ai.rationale}${ai.risks ? ` Risks: ${ai.risks}` : ""}`
          : scorePrimitive({
              reach,
              clicks: 0,
              delivered: 0,
              conversions: 0,
              commission_minor: 0,
              fatigue: 0,
              overlap: 0,
            }).rationale,
      ]
        .filter(Boolean)
        .join(" ");
      await conn.query(
        `INSERT INTO offer_suggestions(offer_id,segment_version_id,predicted_reach,score,rationale,model,prompt_version,status)
         VALUES($1,$2,$3,$4,$5,$6,$7,'pending_review')`,
        [
          candidate.offer_id,
          version.id,
          reach,
          Math.round(candidate.score * 10000) / 10000,
          rationale.slice(0, 4000),
          ai ? ai.model : "statistical",
          ai ? ai.prompt_version : "template-v1",
        ],
      );
      summary.stored++;
    }
  }
  return summary;
}

module.exports = {
  produce,
  scanOpportunities,
  ratesFor,
  eligibleOffers,
  validateRanking,
  valuePerConversion,
  RANK_SCHEMA,
};
