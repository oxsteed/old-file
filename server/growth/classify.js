"use strict";
const { scrubQuery } = require("./events/validate");
function scoreRules(
  {
    text = "",
    locale = "en",
    category_id,
    job_type,
    skill_id,
    cuisine_tag,
    menu_tag,
  },
  rules,
) {
  const normalized = scrubQuery(text);
  const scores = new Map();
  for (const rule of rules) {
    if (rule.sensitive || rule.status !== "active") continue;
    const keyword = rule.kind === "keyword";
    const hit = keyword
      ? rule.locale === locale &&
        normalized.includes(rule.pattern.toLowerCase())
      : String(
          { category_id, job_type, skill_id, cuisine_tag, menu_tag }[
            rule.kind
          ] || "",
        ) === rule.pattern;
    if (!hit) continue;
    const item = scores.get(rule.code) || {
      code: rule.code,
      node_id: rule.node_id,
      keyword: false,
      category: false,
    };
    item[keyword ? "keyword" : "category"] = true;
    scores.set(rule.code, item);
  }
  return [...scores.values()]
    .map((s) => ({
      ...s,
      confidence: s.keyword && s.category ? 0.9 : s.category ? 0.8 : 0.7,
    }))
    .sort(
      (a, b) => b.confidence - a.confidence || a.code.localeCompare(b.code),
    );
}
async function classify(
  conn,
  { entity_type, entity_id, text, locale = "en", ...fields },
) {
  if (
    ![
      "job",
      "service",
      "restaurant",
      "search",
      "helper",
      "planned_need",
      "saved_search",
    ].includes(entity_type)
  )
    throw new Error("excluded_entity");
  const { rows: rules } = await conn.query(
    `SELECT r.*,n.code,n.sensitive,n.status FROM demand_taxonomy_rules r JOIN demand_taxonomy_nodes n ON n.id=r.node_id WHERE n.status='active'`,
  );
  const ranked = scoreRules({ text, locale, ...fields }, rules);
  let best = ranked[0],
    source = "rules",
    metadata = null;
  if (!best || best.confidence < 0.75) {
    const { rows: nodes } = await conn.query(
      `SELECT code,id,labels->>'en' AS label FROM demand_taxonomy_nodes
      WHERE NOT sensitive AND status='active' AND (parent_id=(SELECT parent_id FROM demand_taxonomy_nodes WHERE code=$1) OR code=$1)
      ORDER BY code LIMIT 40`,
      [best?.code || ""],
    );
    if (nodes.length) {
      const codes = nodes.map((n) => n.code);
      metadata = await require("./ollamaClient").generate({
        data: {
          text: scrubQuery(text),
          intents: nodes.map((n) => ({ code: n.code, label: n.label })),
        },
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["intent", "confidence"],
          properties: {
            intent: { enum: [...codes, "none"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      });
      const picked = nodes.find((n) => n.code === metadata?.output.intent);
      if (picked) {
        best = {
          code: picked.code,
          node_id: picked.id,
          confidence: metadata.output.confidence,
        };
        source = "ollama";
      }
    }
  }
  if (
    !best ||
    best.confidence < 0.6 ||
    (source === "rules" && best.confidence < 0.75) ||
    (source === "ollama" && ranked[0] && ranked[0].code !== best.code)
  ) {
    await conn.query(
      `INSERT INTO classification_review_queue(entity_type,entity_id,proposed_node_id,reason) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [
        entity_type,
        entity_id,
        best?.node_id || null,
        "low_confidence_or_disagreement",
      ],
    );
    return { review: true };
  }
  await conn.query(
    "UPDATE entity_intents SET superseded_at=NOW() WHERE entity_type=$1 AND entity_id=$2 AND superseded_at IS NULL",
    [entity_type, entity_id],
  );
  await conn.query(
    `INSERT INTO entity_intents(entity_type,entity_id,node_id,confidence,source,model,model_digest,prompt_version,prompt_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      entity_type,
      entity_id,
      best.node_id,
      best.confidence,
      source,
      metadata?.model,
      metadata?.digest,
      metadata?.prompt_version,
      metadata?.prompt_hash,
    ],
  );
  return { ...best, source };
}
module.exports = { scoreRules, classify };
