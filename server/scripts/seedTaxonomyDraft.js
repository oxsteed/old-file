#!/usr/bin/env node
"use strict";
/**
 * scripts/seedTaxonomyDraft.js: Track 3, Slice 1.
 *
 * Drafts demand_taxonomy_nodes (spec docs/growth/design-spec.md §8.1) from
 * the platform's real taxonomies. Every node is inserted with
 * status='draft' and ON CONFLICT (code) DO NOTHING, so re-running is a
 * no-op and nothing here can activate a node. Keyword rules (§8.3) are out
 * of scope for this slice: nodes only.
 *
 * Sources (§8.1):
 *   DB (read at runtime through an injectable conn):
 *     categories, skills_lookup, direct_catalog_categories,
 *     job_kit_definitions.job_type, food_restaurants.cuisine_tags,
 *     food_menu_items.tags (common values only)
 *   JS (required modules):
 *     services/businessCategories.js subtypes,
 *     services/learnTagging.js LEARN_CATEGORIES
 *
 * Sensitive flags follow §8.6: health / religion / ethnicity / sexuality /
 * politics / pregnancy / financial-distress concepts are sensitive=true and
 * are never drafted as person-level nodes (they only ever appear as
 * service, business or restaurant nodes). Cuisine tags live under
 * food.cuisine.* at restaurant level; a cuisine name itself (haitian,
 * mexican, ...) is sensitive=false, while halal / kosher are sensitive=true
 * because they imply religion, still restaurant-level only.
 */

// ---------------------------------------------------------------------------
// Slug + labels
// ---------------------------------------------------------------------------

function slugify(value) {
  const slug = String(value == null ? "" : value)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return slug || "item";
}

// Draft translations for well-known terms. Anything not listed falls back to
// the English label in every locale (still present, still a draft for admin
// review on the §15 page). Keys are the lower-cased English source name.
const DRAFT_TRANSLATIONS = {
  plumbing: { es: "Plomería", fr: "Plomberie", ht: "Plonbri", ar: "السباكة" },
  electrical: { es: "Electricidad", fr: "Électricité", ht: "Elektrisite", ar: "كهرباء" },
  cleaning: { es: "Limpieza", fr: "Nettoyage", ht: "Netwayaj", ar: "تنظيف" },
  "home cleaning": { es: "Limpieza del hogar", fr: "Nettoyage domestique", ht: "Netwayaj kay", ar: "تنظيف المنازل" },
  carpentry: { es: "Carpintería", fr: "Menuiserie", ht: "Chapant", ar: "نجارة" },
  painting: { es: "Pintura", fr: "Peinture", ht: "Penti", ar: "دهان" },
  landscaping: { es: "Paisajismo", fr: "Aménagement paysager", ht: "Amenajman jaden", ar: "تنسيق الحدائق" },
  handyman: { es: "Mantenimiento general", fr: "Bricolage", ht: "Brikolaj", ar: "أعمال صيانة عامة" },
  roofing: { es: "Techado", fr: "Toiture", ht: "Twati", ar: "تسقيف" },
  flooring: { es: "Pisos", fr: "Revêtements de sol", ht: "Planche", ar: "أرضيات" },
  hvac: { es: "Climatización", fr: "Chauffage et climatisation", ht: "Klimatizasyon", ar: "التدفئة والتبريد" },
  "heating & cooling": { es: "Calefacción y aire acondicionado", fr: "Chauffage et climatisation", ht: "Chofaj ak klimatizasyon", ar: "التدفئة والتبريد" },
  "appliance repair": { es: "Reparación de electrodomésticos", fr: "Réparation d'appareils", ht: "Reparasyon aparèy", ar: "إصلاح الأجهزة المنزلية" },
  "pest control": { es: "Control de plagas", fr: "Lutte antiparasitaire", ht: "Kontwòl ensèk nuizib", ar: "مكافحة الحشرات" },
  locksmith: { es: "Cerrajería", fr: "Serrurerie", ht: "Seruri", ar: "خدمات الأقفال" },
  moving: { es: "Mudanzas", fr: "Déménagement", ht: "Demenajman", ar: "النقل" },
  automotive: { es: "Automóviles", fr: "Automobile", ht: "Machin", ar: "سيارات" },
  "auto repair": { es: "Reparación de autos", fr: "Réparation automobile", ht: "Reparasyon machin", ar: "إصلاح السيارات" },
  "car care & repair": { es: "Cuidado y reparación de autos", fr: "Entretien et réparation automobile", ht: "Antretyen ak reparasyon machin", ar: "صيانة وإصلاح السيارات" },
  "tech support": { es: "Soporte técnico", fr: "Assistance technique", ht: "Sipò teknik", ar: "الدعم التقني" },
  tutoring: { es: "Tutoría", fr: "Tutorat", ht: "Leson prive", ar: "دروس خصوصية" },
  "pet care": { es: "Cuidado de mascotas", fr: "Soins pour animaux", ht: "Swen bèt kay", ar: "رعاية الحيوانات الأليفة" },
  photography: { es: "Fotografía", fr: "Photographie", ht: "Fotografi", ar: "التصوير" },
  "event planning": { es: "Planificación de eventos", fr: "Planification d'événements", ht: "Planifikasyon evènman", ar: "تنظيم الفعاليات" },
  "personal training": { es: "Entrenamiento personal", fr: "Entraînement personnel", ht: "Antrènman pèsonèl", ar: "تدريب شخصي" },
  "mental health": { es: "Salud mental", fr: "Santé mentale", ht: "Sante mantal", ar: "الصحة النفسية" },
  healthcare: { es: "Atención médica", fr: "Soins de santé", ht: "Swen sante", ar: "الرعاية الصحية" },
  health: { es: "Salud", fr: "Santé", ht: "Sante", ar: "الصحة" },
  restaurant: { es: "Restaurante", fr: "Restaurant", ht: "Restoran", ar: "مطعم" },
  bakery: { es: "Panadería", fr: "Boulangerie", ht: "Boulanjri", ar: "مخبز" },
  catering: { es: "Catering", fr: "Traiteur", ht: "Sèvis traiteur", ar: "تموين" },
  halal: { es: "Halal", fr: "Halal", ht: "Halal", ar: "حلال" },
  kosher: { es: "Kosher", fr: "Casher", ht: "Kosher", ar: "كوشر" },
  haitian: { es: "Haitiana", fr: "Haïtienne", ht: "Ayisyen", ar: "هايتية" },
  mexican: { es: "Mexicana", fr: "Mexicaine", ht: "Meksiken", ar: "مكسيكية" },
  italian: { es: "Italiana", fr: "Italienne", ht: "Italyen", ar: "إيطالية" },
  chinese: { es: "China", fr: "Chinoise", ht: "Chinwa", ar: "صينية" },
  american: { es: "Americana", fr: "Américaine", ht: "Ameriken", ar: "أمريكية" },
  services: { es: "Servicios", fr: "Services", ht: "Sèvis", ar: "الخدمات" },
  food: { es: "Comida", fr: "Alimentation", ht: "Manje", ar: "الطعام" },
  cuisine: { es: "Cocina", fr: "Cuisine", ht: "Kizin", ar: "المطبخ" },
  business: { es: "Negocios", fr: "Entreprises", ht: "Biznis", ar: "الأعمال" },
  learn: { es: "Aprender", fr: "Apprendre", ht: "Aprann", ar: "التعلم" },
};

const LOCALES = ["en", "es", "fr", "ht", "ar"];

function makeLabels(enName) {
  const en = String(enName == null ? "" : enName).trim() || "Unnamed";
  const draft = DRAFT_TRANSLATIONS[en.toLowerCase()];
  const labels = { en };
  for (const locale of LOCALES.slice(1)) {
    labels[locale] = (draft && draft[locale]) || en;
  }
  return labels;
}

// ---------------------------------------------------------------------------
// Sensitive classification (§8.6)
// ---------------------------------------------------------------------------

const SENSITIVE_PATTERNS = [
  /\bmental health\b/i,
  /\bhealth(care)?\b/i,
  /\bmedical\b/i,
  /\bclinic\b/i,
  /\bdental\b/i,
  /\bpharmacy\b/i,
  /\btherap(y|ist)\b/i,
  /\bcounsel(l)?ing\b/i,
  /\bpsych/i,
  /\bpregnan/i,
  /\bfertility\b/i,
  /\bsubstance abuse\b/i,
  /\baddiction\b/i,
  /\bnursing\b/i,
  /\bsenior care\b/i,
  /\bhome health\b/i,
  /\bwellness\b/i,
  /\bpersonal care\b/i,
  /\bmassage\b/i,
  /\bhalal\b/i,
  /\bkosher\b/i,
  /\brelig(ion|ious)\b/i,
  /\bmosque\b/i,
  /\bchurch\b/i,
  /\bsynagogue\b/i,
  /\blgbt/i,
  /\bsexual orientation\b/i,
  /\bpolitic/i,
  /\bbankrupt/i,
  /\bdebt (relief|consolidation)\b/i,
  /\bforeclosure\b/i,
  /\bpayday loan\b/i,
  /\bethnic/i,
];

// Cuisine names that describe a nationality are restaurant-level cuisine
// labels, not person-level ethnicity inferences (§8.6): not sensitive.
function isSensitive(name, source) {
  const text = String(name == null ? "" : name);
  if (source === "cuisine_tags") {
    return /\bhalal\b/i.test(text) || /\bkosher\b/i.test(text);
  }
  return SENSITIVE_PATTERNS.some((re) => re.test(text));
}

// ---------------------------------------------------------------------------
// Node draft helpers
// ---------------------------------------------------------------------------

function draft(code, parentCode, enName, source, sourceRef) {
  return {
    code,
    parent_code: parentCode || null,
    labels: makeLabels(enName),
    sensitive: isSensitive(enName, source),
    source,
    source_ref: sourceRef == null ? null : String(sourceRef),
  };
}

const ROOT_NODES = [
  draft("services", null, "Services", "root", "root"),
  draft("food", null, "Food", "root", "root"),
  draft("food.cuisine", "food", "Cuisine", "root", "root"),
  draft("food.menu", "food", "Menu tags", "root", "root"),
  draft("business", null, "Business", "root", "root"),
  draft("learn", null, "Learn", "root", "root"),
  draft("customer", null, "Customer projects", "root", "root"),
];

// Deterministic collision handling: within one converter output, the first
// node keeps the code; later distinct source_refs get _2, _3, ... in input
// order (converters sort their inputs, so this is stable across runs).
function uniquify(nodes) {
  const seen = new Map();
  for (const node of nodes) {
    const count = (seen.get(node.code) || 0) + 1;
    seen.set(node.code, count);
    if (count > 1) node.code = `${node.code}_${count}`;
  }
  return nodes;
}

function byCode(a, b) {
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Source converters (pure: raw rows/values -> node drafts)
// ---------------------------------------------------------------------------

// categories: { id, name, slug, parent_id }: hierarchical via parent_id.
function nodesFromCategories(rows) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  const slugById = new Map();
  for (const row of list) {
    if (row && row.id != null) slugById.set(row.id, slugify(row.slug || row.name));
  }
  const nodes = list
    .filter((r) => r && (r.slug || r.name))
    .map((row) => {
      const slug = slugify(row.slug || row.name);
      const parentSlug = row.parent_id != null ? slugById.get(row.parent_id) : null;
      return draft(
        `services.${slug}`,
        parentSlug ? `services.${parentSlug}` : "services",
        row.name || row.slug,
        "categories",
        row.id != null ? row.id : row.slug,
      );
    });
  return uniquify(nodes.sort(byCode));
}

// skills_lookup: { id, name, category }. Skills group under a
// services.<category> node (emitted here as a stub so the parent exists);
// the stub dedupes against the matching categories/direct node on merge.
function nodesFromSkills(rows) {
  const list = (Array.isArray(rows) ? rows.slice() : []).filter((r) => r && r.name);
  list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const nodes = [];
  const stubbed = new Set();
  for (const row of list) {
    const categorySlug = row.category ? slugify(row.category) : null;
    const parentCode = categorySlug ? `services.${categorySlug}` : "services";
    if (categorySlug && !stubbed.has(categorySlug)) {
      stubbed.add(categorySlug);
      nodes.push(
        draft(parentCode, "services", row.category, "skills_lookup_category", row.category),
      );
    }
    nodes.push(
      draft(
        `${parentCode}.${slugify(row.name)}`,
        parentCode,
        row.name,
        "skills_lookup",
        row.id != null ? row.id : row.name,
      ),
    );
  }
  return uniquify(nodes);
}

// businessCategories.js: [{ id, title, subtypes: [name, ...] }]
function nodesFromBusinessCategories(categories) {
  const list = Array.isArray(categories) ? categories : [];
  const nodes = [];
  for (const category of list) {
    if (!category || !category.id) continue;
    const parentCode = `business.${slugify(category.id)}`;
    nodes.push(
      draft(parentCode, "business", category.title || category.id, "business_categories", category.id),
    );
    for (const subtype of category.subtypes || []) {
      nodes.push(
        draft(
          `${parentCode}.${slugify(subtype)}`,
          parentCode,
          subtype,
          "business_categories",
          `${category.id}:${subtype}`,
        ),
      );
    }
  }
  return uniquify(nodes.sort(byCode));
}

// direct_catalog_categories: { slug, name_i18n }: kept under
// services.direct.* so catalog groupings never silently merge with job
// categories that happen to share a slug.
function nodesFromDirectCatalog(rows) {
  const list = (Array.isArray(rows) ? rows.slice() : []).filter((r) => r && r.slug);
  const nodes = list.map((row) => {
    const i18n = row.name_i18n && typeof row.name_i18n === "object" ? row.name_i18n : {};
    const node = draft(
      `services.direct.${slugify(row.slug)}`,
      "services",
      i18n.en || row.slug,
      "direct_catalog_categories",
      row.slug,
    );
    // The catalog already ships reviewed 5-language names: prefer them.
    for (const locale of LOCALES) {
      if (i18n[locale]) node.labels[locale] = String(i18n[locale]);
    }
    node.sensitive = isSensitive(node.labels.en, node.source);
    return node;
  });
  return uniquify(nodes.sort(byCode));
}

// LEARN_CATEGORIES: flat slug list from learnTagging.js.
function nodesFromLearnCategories(slugs) {
  const list = (Array.isArray(slugs) ? slugs.slice() : []).filter(Boolean).sort();
  return list.map((slug) => {
    const name = String(slug).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return draft(`learn.${slugify(slug)}`, "learn", name, "learn_categories", slug);
  });
}

const JOB_TYPE_PARENTS = [
  { parent: "services.plumbing", re: /toilet|faucet|disposal|tub|leak|drain|pipe|water|sewer|sink|shower/ },
  { parent: "services.electrical", re: /ceiling_fan|fan|wiring|outlet|panel|charger|light/ },
  { parent: "services.handyman", re: /door|lock|drywall|mount|assembly/ },
];

// job_kit_definitions.job_type distinct values (e.g. "toilet-replacement").
// Placed under the matching services category where one is sensible, else
// directly under the services root.
function nodesFromJobTypes(values) {
  const list = [...new Set((Array.isArray(values) ? values : []).filter(Boolean).map(String))].sort();
  const nodes = [];
  const stubbed = new Set();
  for (const jobType of list) {
    const slug = slugify(jobType);
    const hit = JOB_TYPE_PARENTS.find((p) => p.re.test(slug));
    const parentCode = hit ? hit.parent : "services";
    if (hit && !stubbed.has(parentCode)) {
      stubbed.add(parentCode);
      const parentName = parentCode.split(".").pop().replace(/_/g, " ");
      nodes.push(draft(parentCode, "services", parentName, "job_kit_parent", parentCode));
    }
    const name = jobType.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    nodes.push(draft(`${parentCode}.${slug}`, parentCode, name, "job_kit_definitions", jobType));
  }
  return uniquify(nodes);
}

// food_restaurants.cuisine_tags distinct values: restaurant level only.
function nodesFromCuisineTags(tags) {
  const list = [...new Set((Array.isArray(tags) ? tags : []).filter(Boolean).map(String))].sort();
  return list.map((tag) =>
    draft(`food.cuisine.${slugify(tag)}`, "food.cuisine", tag, "cuisine_tags", tag),
  );
}

// food_menu_items.tags common values: restaurant level only.
function nodesFromMenuTags(tags) {
  const list = [...new Set((Array.isArray(tags) ? tags : []).filter(Boolean).map(String))].sort();
  return list.map((tag) => draft(`food.menu.${slugify(tag)}`, "food.menu", tag, "menu_tags", tag));
}

// ---------------------------------------------------------------------------
// Merge / dedupe + summary
// ---------------------------------------------------------------------------

// First writer wins for labels and parent; sensitive is OR-ed so a flag
// from any source is never lost in a merge.
function mergeNodes(lists) {
  const byCodeMap = new Map();
  for (const list of lists || []) {
    for (const node of list || []) {
      if (!node || !node.code) continue;
      const existing = byCodeMap.get(node.code);
      if (!existing) {
        byCodeMap.set(node.code, { ...node, labels: { ...node.labels } });
      } else {
        existing.sensitive = Boolean(existing.sensitive || node.sensitive);
        if (!existing.parent_code && node.parent_code) existing.parent_code = node.parent_code;
      }
    }
  }
  return [...byCodeMap.values()].sort(byCode);
}

function summarize(nodes, extras = {}) {
  const perSource = { ...(extras.perSource || {}) };
  const perNamespace = {};
  let sensitive = 0;
  for (const node of nodes || []) {
    if (!extras.perSource) perSource[node.source] = (perSource[node.source] || 0) + 1;
    const ns = String(node.code).split(".")[0];
    perNamespace[ns] = (perNamespace[ns] || 0) + 1;
    if (node.sensitive) sensitive += 1;
  }
  return {
    total: (nodes || []).length,
    sensitive,
    perSource,
    perNamespace,
    errors: extras.errors || [],
  };
}

// ---------------------------------------------------------------------------
// DB collection (injectable conn; failures become summary errors, never throw)
// ---------------------------------------------------------------------------

async function tryQuery(conn, source, sql, params) {
  try {
    const result = await conn.query(sql, params);
    return { rows: (result && result.rows) || [], error: null };
  } catch (err) {
    return { rows: [], error: { source, error: String((err && err.message) || err) } };
  }
}

function commonValues(rowsOfArrays, minCount) {
  const counts = new Map();
  for (const arr of rowsOfArrays || []) {
    for (const value of Array.isArray(arr) ? arr : []) {
      const v = String(value).trim();
      if (v) counts.set(v, (counts.get(v) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= minCount)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 200)
    .map(([v]) => v);
}

async function collectFromDb(conn) {
  const lists = [];
  const errors = [];
  const run = async (source, sql, convert) => {
    const { rows, error } = await tryQuery(conn, source, sql);
    if (error) errors.push(error);
    else lists.push(convert(rows));
  };
  await run("categories", "SELECT id, name, slug, parent_id FROM categories ORDER BY id", nodesFromCategories);
  await run("skills_lookup", "SELECT id, name, category FROM skills_lookup ORDER BY id", nodesFromSkills);
  await run(
    "direct_catalog_categories",
    "SELECT slug, name_i18n FROM direct_catalog_categories ORDER BY slug",
    nodesFromDirectCatalog,
  );
  await run(
    "job_kit_definitions",
    "SELECT DISTINCT job_type FROM job_kit_definitions ORDER BY job_type",
    (rows) => nodesFromJobTypes(rows.map((r) => (typeof r === "string" ? r : r.job_type))),
  );
  await run("cuisine_tags", "SELECT cuisine_tags FROM food_restaurants", (rows) =>
    nodesFromCuisineTags(commonValues(rows.map((r) => r.cuisine_tags), 1)),
  );
  await run("menu_tags", "SELECT tags FROM food_menu_items", (rows) =>
    nodesFromMenuTags(commonValues(rows.map((r) => r.tags), 2)),
  );
  return { lists, errors };
}

function collectFromJs(sources = {}) {
  const lists = [];
  const errors = [];
  try {
    const business =
      sources.businessCategories ||
      require("../services/businessCategories").listBusinessCategories();
    lists.push(nodesFromBusinessCategories(business));
  } catch (err) {
    errors.push({ source: "business_categories", error: String((err && err.message) || err) });
  }
  try {
    const learn =
      sources.learnCategories || require("../services/learnTagging").LEARN_CATEGORIES;
    lists.push(nodesFromLearnCategories(learn));
  } catch (err) {
    errors.push({ source: "learn_categories", error: String((err && err.message) || err) });
  }
  return { lists, errors };
}

// Full draft set: roots + every source, merged. `conn` may be null, in
// which case only the JS sources are collected.
async function collectDrafts(conn, jsSources) {
  const js = collectFromJs(jsSources);
  const lists = [ROOT_NODES, ...js.lists];
  const errors = [...js.errors];
  if (conn) {
    const db = await collectFromDb(conn);
    lists.push(...db.lists);
    errors.push(...db.errors);
  }
  const perSource = {};
  for (const list of lists) {
    for (const node of list) perSource[node.source] = (perSource[node.source] || 0) + 1;
  }
  const nodes = mergeNodes(lists);
  return { nodes, summary: summarize(nodes, { perSource, errors }) };
}

// ---------------------------------------------------------------------------
// Apply (idempotent: draft-only, ON CONFLICT DO NOTHING)
// ---------------------------------------------------------------------------

const APPLY_SQL = `INSERT INTO demand_taxonomy_nodes (code, parent_id, labels, sensitive, status)
VALUES ($1, (SELECT id FROM demand_taxonomy_nodes WHERE code = $2), $3::jsonb, $4, 'draft')
ON CONFLICT (code) DO NOTHING`;

function depth(code) {
  return String(code).split(".").length;
}

// Parents are inserted before children (sorted by code depth) so the
// parent_id subquery resolves inside the same run.
async function applyNodes(conn, nodes) {
  const ordered = (nodes || []).slice().sort((a, b) => depth(a.code) - depth(b.code) || byCode(a, b));
  let inserted = 0;
  for (const node of ordered) {
    const result = await conn.query(APPLY_SQL, [
      node.code,
      node.parent_code || null,
      JSON.stringify(node.labels),
      Boolean(node.sensitive),
    ]);
    inserted += (result && result.rowCount) || 0;
  }
  return inserted;
}

async function seed(conn, jsSources) {
  const db = conn || require("../db");
  const { nodes, summary } = await collectDrafts(db, jsSources);
  const inserted = await applyNodes(db, nodes);
  return { ...summary, inserted };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(argv) {
  const dryRun = (argv || []).includes("--dry-run");
  if (dryRun) {
    // JS sources always; DB sources only when a database is configured.
    let conn = null;
    const errors = [];
    if (process.env.DATABASE_URL) {
      try {
        conn = require("../db");
      } catch (err) {
        errors.push({ source: "db", error: String((err && err.message) || err) });
      }
    } else {
      errors.push({ source: "db", error: "DATABASE_URL not set; DB sources skipped in dry-run" });
    }
    const { summary } = await collectDrafts(conn, undefined);
    summary.errors = [...errors, ...summary.errors];
    console.log(JSON.stringify(summary, null, 2));
    if (conn && typeof conn.end === "function") await conn.end();
    return summary;
  }
  const result = await seed();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then(async () => {
      try {
        await require("../db").end();
      } catch {
        /* pool may never have been created */
      }
    })
    .catch((err) => {
      console.error(`seedTaxonomyDraft failed: ${(err && err.message) || err}`);
      process.exitCode = 1;
    });
}

module.exports = {
  slugify,
  makeLabels,
  isSensitive,
  draft,
  ROOT_NODES,
  APPLY_SQL,
  nodesFromCategories,
  nodesFromSkills,
  nodesFromBusinessCategories,
  nodesFromDirectCatalog,
  nodesFromLearnCategories,
  nodesFromJobTypes,
  nodesFromCuisineTags,
  nodesFromMenuTags,
  mergeNodes,
  summarize,
  commonValues,
  collectFromDb,
  collectFromJs,
  collectDrafts,
  applyNodes,
  seed,
  main,
};
