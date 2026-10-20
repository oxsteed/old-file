"use strict";
const { scrubQuery } = require("./events/validate");

// Supported classification locales (spec section 8.3 keyword tables).
const SUPPORTED_LOCALES = ["en", "es", "fr", "ht", "ar"];

function normalizeLocale(value) {
  if (value == null) return null;
  const primary = String(value).trim().toLowerCase().split(/[-_]/)[0];
  return primary || null;
}

// Specificity proxy for a taxonomy code: "services.plumbing.drain_clog"
// (depth 3) is more specific than its parent "services.plumbing" (depth 2).
function depthOf(code) {
  return String(code || "").split(".").filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Safe regex (spec 8.3 lists a "regex" rule kind).
//
// NOTE: migration 921's CHECK constraint on demand_taxonomy_rules.kind
// excludes 'regex' today, so no regex rule can be stored in the DB until a
// future migration extends that constraint. scoreRules still supports the
// kind (guarded by validateRegexPattern below) so the classifier is ready
// and unit-testable; do not add a migration here.
//
// The validator is deliberately conservative. It rejects:
//   - patterns longer than 200 chars
//   - backreferences (\1, \k<name>) and lookarounds (?= ?! ?<= ?<!)
//   - nested quantifiers: a group whose body already contains a quantifier
//     and which is itself quantified, e.g. (a+)+, (a*)*, (.+)+, (\w\s?)*
//   - stacked quantifiers on one atom, e.g. a++, a**, a{2}{3} (lazy forms
//     such as a+? or (abc)? stay allowed)
//   - anything that does not compile
// Residual risk: some exponential patterns without nested quantifiers
// (e.g. long alternations of overlapping prefixes) are not detectable by
// this syntactic check. Exposure is bounded because matching only ever runs
// against scrubQuery() output, which is capped at 100 chars.
// ---------------------------------------------------------------------------
function validateRegexPattern(pattern) {
  if (typeof pattern !== "string" || pattern.length === 0) return false;
  if (pattern.length > 200) return false;
  if (/\\[1-9]/.test(pattern) || /\\k</.test(pattern)) return false;
  if (/\(\?<?[=!]/.test(pattern)) return false;

  // Single scan that tracks escapes and character classes, records every
  // group (start, body, following char) and detects stacked quantifiers.
  const groups = [];
  const stack = [];
  let inClass = false;
  const isQuantifierAt = (i) => {
    const ch = pattern[i];
    if (ch === "+" || ch === "*") return true;
    if (ch === "{") return /^\{\d+(,\d*)?\}/.test(pattern.slice(i));
    return false;
  };
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\") {
      i++; // escaped char is a literal atom, never syntax
      continue;
    }
    if (inClass) {
      if (ch === "]") inClass = false;
      continue;
    }
    if (ch === "[") {
      inClass = true;
      continue;
    }
    if (ch === "(") {
      stack.push(i);
      continue;
    }
    if (ch === ")") {
      const start = stack.pop();
      if (start === undefined) return false; // unbalanced
      groups.push({ start, end: i, next: pattern[i + 1] || "" });
      continue;
    }
    if (ch === "+" || ch === "*" || ch === "{") {
      if (!isQuantifierAt(i)) continue; // "{" that is not a quantifier is a literal
      // Stacked quantifier: the previous significant char is itself a
      // quantifier end ("+", "*", "}" of a {..} quantifier). A following
      // "?" is the lazy marker and is consumed by the main loop check
      // below instead of being treated as a second quantifier.
      const prev = pattern[i - 1] || "";
      if (prev === "+" || prev === "*" || prev === "}") return false;
    }
    if (ch === "?") {
      const prev = pattern[i - 1] || "";
      // "a??" / "a+?" are lazy forms (allowed); "?" directly after ")"
      // quantifies the group and is judged by the group check below.
      if (prev === "?" ) return false;
    }
  }
  if (stack.length > 0 || inClass) return false; // unbalanced; compile also fails

  // Nested quantifiers: group body contains a quantifier AND the group
  // itself is quantified (+, *, ?, or {..}).
  for (const group of groups) {
    const quantified =
      group.next === "+" ||
      group.next === "*" ||
      group.next === "?" ||
      (group.next === "{" && /^\{\d+(,\d*)?\}/.test(pattern.slice(group.end + 1)));
    if (!quantified) continue;
    let body = pattern.slice(group.start + 1, group.end);
    body = body.replace(/^\?(?::|<[^>]*>)/, ""); // strip (?: / (?<name> prefix
    body = body.replace(/\\./g, "").replace(/\[[^\]]*\]/g, "");
    if (/[+*]|\{\d+(,|})|\?/.test(body)) return false;
  }

  try {
    new RegExp(pattern);
  } catch {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// detectLanguage(text): deterministic source-language heuristic over the
// five supported locales (en, es, fr, ht, ar).
//
// Method: Arabic is decided by script alone (no other supported language
// uses the Arabic block). The Latin-script languages are scored from
// stopword hits (words unique to one language weigh 2, shared words 0.5)
// plus small diacritic bonuses (n-tilde -> es, c-cedilla -> fr, o-grave
// -> ht, a/i/o/u-acute -> es, u-grave / circumflex vowels -> fr).
//
// Limits (known and accepted): this is a heuristic, not a language model.
// Very short texts (one or two words) are often ambiguous; French and
// Haitian Creole share much vocabulary, so ties resolve toward ht (Creole
// is the one most often misread as French) and a Creole text written with
// heavy French spelling can still land on fr. Mixed-language text is
// classified by its majority signal. Callers that know the language should
// pass an explicit locale, which always wins over detection.
// ---------------------------------------------------------------------------
const STOPWORDS = {
  en: new Set([
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with",
    "my", "i", "me", "we", "you", "it", "is", "are", "need", "please",
    "thanks", "have", "has", "plumber", "clogged",
  ]),
  es: new Set([
    "el", "la", "los", "las", "un", "una", "de", "en", "y", "que", "mi",
    "necesito", "quiero", "por", "favor", "gracias", "con", "está", "tengo",
    "para", "plomero", "destapar", "atascado", "desagüe",
  ]),
  fr: new Set([
    "le", "la", "les", "un", "une", "de", "des", "en", "et", "que", "je",
    "j", "mon", "ma", "besoin", "merci", "avec", "est", "pour", "plombier",
    "déboucher", "canalisation", "bouchée",
  ]),
  ht: new Set([
    "mwen", "bezwen", "tanpri", "yon", "nan", "ak", "pou", "se", "li",
    "yo", "nou", "ou", "kay", "kijan", "kote", "anpil", "dlo", "tiyo",
    "debouche", "bouche", "la",
  ]),
};
// token -> number of supported languages whose stopword set contains it
const TOKEN_SPREAD = new Map();
for (const words of Object.values(STOPWORDS))
  for (const word of words)
    TOKEN_SPREAD.set(word, (TOKEN_SPREAD.get(word) || 0) + 1);

function detectLanguage(text) {
  const raw = String(text || "");
  const arabicChars = (raw.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g) || []).length;
  if (arabicChars >= 2) return "ar";
  const letters = (raw.match(/\p{L}/gu) || []).length;
  if (arabicChars >= 1 && letters > 0 && arabicChars / letters >= 0.25)
    return "ar";

  const normalized = raw.normalize("NFKC").toLowerCase();
  const tokens = normalized.match(/\p{L}+/gu) || [];
  const scores = { en: 0, es: 0, fr: 0, ht: 0 };
  for (const token of tokens)
    for (const lang of Object.keys(scores))
      if (STOPWORDS[lang].has(token))
        scores[lang] += TOKEN_SPREAD.get(token) === 1 ? 2 : 0.5;

  // Diacritic bonuses, capped per marker so one repeated letter cannot
  // outweigh the word evidence.
  const bonus = (lang, marker, points) => {
    const hits = normalized.split(marker).length - 1;
    if (hits > 0) scores[lang] += Math.min(hits, 3) * points;
  };
  bonus("es", "ñ", 3);
  bonus("es", "¿", 3);
  bonus("es", "¡", 3);
  bonus("es", "á", 1.5);
  bonus("es", "í", 1.5);
  bonus("es", "ó", 1.5);
  bonus("es", "ú", 1.5);
  bonus("fr", "ç", 3);
  bonus("fr", "ù", 2);
  bonus("fr", "â", 1.5);
  bonus("fr", "ê", 1.5);
  bonus("fr", "î", 1.5);
  bonus("fr", "ô", 1.5);
  bonus("fr", "û", 1.5);
  bonus("ht", "ò", 2);

  // Deterministic tie order: ht first (see limits note), then fr, es, en.
  let best = "en";
  let bestScore = 0;
  for (const lang of ["ht", "fr", "es", "en"])
    if (scores[lang] > bestScore) {
      best = lang;
      bestScore = scores[lang];
    }
  return bestScore > 0 ? best : "en";
}

// Resolve the effective locale for one item: an explicit locale/language
// (anything but "auto") always wins; otherwise detect from the text.
function resolveLocale({ locale, language, text }) {
  const explicit = [locale, language]
    .map(normalizeLocale)
    .find((value) => value && value !== "auto");
  return explicit || detectLanguage(text);
}

// ---------------------------------------------------------------------------
// buildCandidateList(nodes, bestCode): the CLOSED Ollama candidate list
// (spec 8.4). Candidates are the children of the best guess's category
// node: if the best guess is a leaf, its parent is the category; if the
// best guess is itself a category (it has children), its children are the
// candidates. Active, non-sensitive nodes only, sorted by code for
// determinism, capped at 40.
//
// Returns [] (meaning: never call Ollama, go straight to the review queue)
// when there is no best guess, when the best guess is unknown, or when its
// category node is missing from the active node list. It NEVER falls back
// to the whole tree.
// ---------------------------------------------------------------------------
function englishLabel(node) {
  if (node.label) return node.label;
  let labels = node.labels;
  if (typeof labels === "string") {
    try {
      labels = JSON.parse(labels);
    } catch {
      labels = null;
    }
  }
  return (labels && (labels.en || labels.en_US)) || node.code;
}

function buildCandidateList(nodes, bestCode) {
  if (!bestCode || !Array.isArray(nodes)) return [];
  const active = nodes.filter(
    (n) => n && n.code && !n.sensitive && (n.status == null || n.status === "active"),
  );
  const byCode = new Map(active.map((n) => [n.code, n]));
  const byId = new Map(active.map((n) => [String(n.id), n]));
  const best = byCode.get(bestCode);
  if (!best) return [];
  const childrenOf = (parent) =>
    active.filter(
      (n) => n.parent_id != null && String(n.parent_id) === String(parent.id),
    );
  let category = null;
  if (childrenOf(best).length > 0) category = best;
  else if (best.parent_id != null) category = byId.get(String(best.parent_id)) || null;
  if (!category) return [];
  return childrenOf(category)
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code))
    .slice(0, 40)
    .map((n) => ({ ...n, label: englishLabel(n) }));
}

// ---------------------------------------------------------------------------
// scoreRules(input, rules): pure, synchronous rule scoring.
//
// Rule objects may carry parent info (parent_code / parent_id, plus the
// aliases parent_node_id and optional parent_sensitive / parent_status),
// as selected by classify()'s self-join. Rules without parent fields are
// treated as roots (backward compatible: no inheritance is produced).
//
// Parent inheritance (spec 8.3 design decision): a hit on a child intent
// also credits its ancestors, because the evidence supports the broader
// category even when the leaf is wrong.
//   - ancestor inheriting a category-kind hit: 0.8 (the spec's
//     "category only gives the parent node at 0.8")
//   - ancestor inheriting keyword/regex evidence only: 0.6 (discounted
//     from the keyword-only 0.7, because the parent is less specific)
//   - each further ancestor level subtracts another 0.1 (floor 0.4)
// A directly hit ancestor keeps the better of its direct and inherited
// scores. Ranking sorts by confidence, then by specificity (deeper code
// first), then by code, so a child always ranks above its parent for the
// same hit and classify() picks the most specific node.
// ---------------------------------------------------------------------------
function scoreRules(
  {
    text = "",
    locale,
    language,
    category_id,
    job_type,
    skill_id,
    cuisine_tag,
    menu_tag,
  },
  rules,
) {
  const effectiveLocale = resolveLocale({ locale, language, text });
  const normalized = scrubQuery(text);
  const fields = { category_id, job_type, skill_id, cuisine_tag, menu_tag };
  const direct = new Map();
  const parentOf = new Map(); // child code -> { code, id } of its parent
  const nodeIdOf = new Map();

  for (const rule of rules || []) {
    if (!rule || rule.sensitive || rule.status !== "active") continue;
    if (rule.code && rule.node_id != null) nodeIdOf.set(rule.code, rule.node_id);

    const parentCode = rule.parent_code || null;
    const parentId =
      rule.parent_node_id != null ? rule.parent_node_id : rule.parent_id;
    if (parentCode && parentId != null) nodeIdOf.set(parentCode, parentId);
    if (
      rule.code &&
      parentCode &&
      !rule.parent_sensitive &&
      (rule.parent_status == null || rule.parent_status === "active")
    )
      parentOf.set(rule.code, { code: parentCode, id: parentId });

    const keyword = rule.kind === "keyword";
    const regex = rule.kind === "regex";
    let hit = false;
    if (keyword) {
      hit =
        rule.locale === effectiveLocale &&
        normalized.includes(String(rule.pattern || "").toLowerCase());
    } else if (regex) {
      // Guarded support: invalid or dangerous patterns are skipped silently.
      if (rule.locale === effectiveLocale && validateRegexPattern(rule.pattern)) {
        try {
          hit = new RegExp(rule.pattern, "i").test(normalized);
        } catch {
          hit = false;
        }
      }
    } else {
      hit = String(fields[rule.kind] || "") === String(rule.pattern);
    }
    if (!hit) continue;
    const item = direct.get(rule.code) || {
      code: rule.code,
      node_id: rule.node_id,
      keyword: false,
      category: false,
      regex: false,
    };
    if (keyword) item.keyword = true;
    else if (regex) item.regex = true;
    else item.category = true;
    direct.set(rule.code, item);
  }

  const keywordLike = (entry) => entry.keyword || entry.regex;
  const directConfidence = (entry) =>
    keywordLike(entry) && entry.category ? 0.9 : entry.category ? 0.8 : 0.7;
  const inheritedConfidence = (entry, distance) => {
    const base = entry.category ? 0.8 : 0.6;
    return Math.max(0.4, Math.round((base - (distance - 1) * 0.1) * 100) / 100);
  };

  // Walk each direct hit up its ancestor chain, accumulating inherited flags.
  const inherited = new Map();
  for (const entry of direct.values()) {
    let current = entry.code;
    let distance = 0;
    const seen = new Set([current]);
    while (parentOf.has(current)) {
      const parent = parentOf.get(current);
      if (seen.has(parent.code)) break; // cycle guard
      seen.add(parent.code);
      distance += 1;
      const acc = inherited.get(parent.code) || {
        code: parent.code,
        node_id: nodeIdOf.get(parent.code) ?? parent.id ?? null,
        keyword: false,
        category: false,
        regex: false,
        distance,
      };
      acc.keyword = acc.keyword || entry.keyword;
      acc.category = acc.category || entry.category;
      acc.regex = acc.regex || entry.regex;
      acc.distance = Math.min(acc.distance, distance);
      inherited.set(parent.code, acc);
      current = parent.code;
    }
  }

  const merged = new Map();
  for (const entry of direct.values())
    merged.set(entry.code, {
      ...entry,
      inherited: false,
      confidence: directConfidence(entry),
    });
  for (const entry of inherited.values()) {
    const confidence = inheritedConfidence(entry, entry.distance);
    const existing = merged.get(entry.code);
    if (existing) {
      existing.confidence = Math.max(existing.confidence, confidence);
    } else {
      const { distance, ...rest } = entry;
      merged.set(entry.code, {
        ...rest,
        inherited: true,
        inherited_distance: distance,
        confidence,
      });
    }
  }

  return [...merged.values()].sort(
    (a, b) =>
      b.confidence - a.confidence ||
      depthOf(b.code) - depthOf(a.code) ||
      a.code.localeCompare(b.code),
  );
}

async function classify(
  conn,
  { entity_type, entity_id, text, locale, language, ...fields },
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
  // Source-language handling: explicit locale/language wins, "auto" or a
  // missing value falls back to detection from the item's own text.
  const effectiveLocale = resolveLocale({ locale, language, text });
  const { rows: rules } = await conn.query(
    `SELECT r.*,n.code,n.sensitive,n.status,
            p.code AS parent_code, p.id AS parent_id,
            p.sensitive AS parent_sensitive, p.status AS parent_status
       FROM demand_taxonomy_rules r
       JOIN demand_taxonomy_nodes n ON n.id=r.node_id
       LEFT JOIN demand_taxonomy_nodes p ON p.id=n.parent_id
      WHERE n.status='active'`,
  );
  const ranked = scoreRules({ text, locale: effectiveLocale, ...fields }, rules);
  let best = ranked[0],
    source = "rules",
    metadata = null;
  if (!best || best.confidence < 0.75) {
    // Closed candidate list (spec 8.4): one query for the active tree, then
    // the pure builder narrows it to the best guess's category children.
    // No best guess (or unknown category) yields an empty list, which means
    // no Ollama call at all: the item goes straight to the review queue.
    const { rows: allNodes } = await conn.query(
      `SELECT id,code,parent_id,sensitive,status,labels
         FROM demand_taxonomy_nodes WHERE status='active'`,
    );
    const candidates = buildCandidateList(allNodes, best?.code);
    if (candidates.length) {
      const codes = candidates.map((n) => n.code);
      metadata = await require("./ollamaClient").generate({
        data: {
          text: scrubQuery(text),
          intents: candidates.map((n) => ({ code: n.code, label: n.label })),
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
      const picked = candidates.find((n) => n.code === metadata?.output?.intent);
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
module.exports = {
  scoreRules,
  classify,
  buildCandidateList,
  detectLanguage,
  validateRegexPattern,
};
