"use strict";
// Pinned-model evaluation harness for the Demand & Sales Engine classifier.
// Design spec section 8.5: a model or prompt change ships only if top-1
// precision is >= 90% overall and >= 85% in every language, with no drop
// over 2 points in any intent with >= 30 examples, evaluated against a
// pinned model digest (see ../ollamaClient.js for the pinning convention:
// GROWTH_OLLAMA_MODEL / GROWTH_OLLAMA_DIGEST).
//
// The pipeline stages mirror ../classify.js exactly:
//   1. scoreRules() runs first (keyword only 0.7, category only 0.8,
//      keyword plus category 0.9).
//   2. When the rules do not settle (no best, or best confidence < 0.75),
//      Ollama is called with a closed candidate list: the nodes that share
//      the best guess's parent, plus the best guess itself, capped at 40
//      codes. When there is no best guess the candidate list is empty and
//      Ollama is never called. The whole tree is never offered.
//   3. The outcome is "review" whenever classify() would have queued the
//      item for review: no best, confidence < 0.6, an unsettled rules
//      result, or a rules/model disagreement. A labelled expectation of
//      "none" is scored as the same outcome as "review".
//
// Everything external is injectable (conn, ollama, env) so the pure
// scoring path runs in tests with no database and no Ollama server.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { assessAcceptance } = require("./acceptance");
const { scoreRules } = require("../classify");
const { scrubQuery } = require("../events/validate");

const PROMPT_VERSION = "growth-v1"; // matches ../ollamaClient.js
const GATE_OVERALL = 0.9;
const GATE_LANGUAGE = 0.85;
const GATE_INTENT_MIN_EXAMPLES = 30;
const GATE_INTENT_MAX_DROP = 0.02;
const MAX_CANDIDATES = 40;
const REVIEW = "review";

function normalizeExpected(code) {
  return code === "none" ? REVIEW : code;
}

// ---------------------------------------------------------------- dataset

function parseDataset(text) {
  const items = [];
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//"))
      continue;
    const item = JSON.parse(trimmed);
    if (
      !item.id ||
      !item.vertical ||
      !item.language ||
      typeof item.text !== "string" ||
      !item.expected_code
    )
      throw new Error(`invalid dataset item: ${trimmed.slice(0, 120)}`);
    items.push({ fields: {}, ...item });
  }
  return items;
}

function loadDataset(datasetPath) {
  return parseDataset(fs.readFileSync(datasetPath, "utf8"));
}

// -------------------------------------------------------------- taxonomy

// Loads active nodes and rules through an injectable conn exposing the
// same query(sql, params) shape as server/db.js. The rules query is the
// one classify() runs; the nodes query loads the active tree so the
// candidate list can be derived in memory (and in tests, without SQL
// semantics leaking into the fake).
async function loadTaxonomy(conn) {
  const { rows: rules } = await conn.query(
    `SELECT r.*,n.code,n.sensitive,n.status FROM demand_taxonomy_rules r JOIN demand_taxonomy_nodes n ON n.id=r.node_id WHERE n.status='active'`,
  );
  const { rows: nodes } = await conn.query(
    `SELECT code,id,parent_id,labels,sensitive,status FROM demand_taxonomy_nodes WHERE status='active' ORDER BY code`,
  );
  return { nodes, rules };
}

// Closed candidate list, mirroring the SQL in classify(): nodes whose
// parent_id equals the best guess's parent_id, plus the best guess
// itself, non-sensitive and active, capped at 40. SQL semantics are
// preserved for a null parent: parent_id = NULL matches nothing, so a
// root-level best guess yields only itself. No best guess yields an
// empty list, and Ollama must not be called with an empty list.
function candidateList(best, nodes) {
  if (!best) return [];
  const self = nodes.find((n) => n.code === best.code);
  if (!self) return [];
  const parentId = self.parent_id;
  return nodes
    .filter(
      (n) =>
        !n.sensitive &&
        n.status === "active" &&
        (n.code === best.code ||
          (parentId !== null && parentId !== undefined && n.parent_id === parentId)),
    )
    .sort((a, b) => a.code.localeCompare(b.code))
    .slice(0, MAX_CANDIDATES);
}

function nodeLabel(node) {
  if (!node) return null;
  if (typeof node.label === "string") return node.label;
  if (node.labels && typeof node.labels === "object")
    return node.labels.en || null;
  return null;
}

// -------------------------------------------------------------- pipeline

// Runs one labelled item through the real pipeline stages. Returns the
// predicted label ("review" when classify() would queue for review),
// the stage that produced it, and any model metadata the ollama call
// returned.
async function predictOne({ item, nodes, rules, ollama }) {
  const ranked = scoreRules(
    { text: item.text, locale: item.language, ...(item.fields || {}) },
    rules,
  );
  let best = ranked[0] || null;
  let source = "rules";
  let metadata = null;
  let modelAttempted = false;
  if (!best || best.confidence < 0.75) {
    const candidates = candidateList(best, nodes);
    if (candidates.length && typeof ollama === "function") {
      modelAttempted = true;
      const codes = candidates.map((n) => n.code);
      metadata = await ollama({
        data: {
          text: scrubQuery(item.text),
          intents: candidates.map((n) => ({ code: n.code, label: nodeLabel(n) })),
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
  const needsReview =
    !best ||
    best.confidence < 0.6 ||
    (source === "rules" && best.confidence < 0.75) ||
    (source === "ollama" && ranked[0] && ranked[0].code !== best.code);
  return {
    predicted_code: needsReview ? REVIEW : best.code,
    source,
    confidence: best ? best.confidence : null,
    metadata: metadata || null,
    modelAttempted,
  };
}

// --------------------------------------------------------------- metrics

function bump(bucket, key, correct) {
  const entry = bucket[key] || { total: 0, correct: 0, precision: 0 };
  entry.total += 1;
  if (correct) entry.correct += 1;
  entry.precision = entry.total ? entry.correct / entry.total : 0;
  bucket[key] = entry;
}

function computeMetrics(results) {
  const per_language = {};
  const per_vertical = {};
  const perIntent = new Map();
  const confusionMap = new Map();
  let correct = 0;
  for (const r of results) {
    if (r.correct) correct += 1;
    bump(per_language, r.language, r.correct);
    bump(per_vertical, r.vertical, r.correct);
    const intent = perIntent.get(r.expected_code) || {
      examples: 0,
      correct: 0,
      precision: 0,
      predicted: 0,
    };
    intent.examples += 1;
    if (r.correct) intent.correct += 1;
    intent.precision = intent.examples ? intent.correct / intent.examples : 0;
    perIntent.set(r.expected_code, intent);
    const predictedEntry = perIntent.get(r.predicted_code);
    if (predictedEntry) predictedEntry.predicted += 1;
    if (!r.correct) {
      const key = `${r.expected_code} -> ${r.predicted_code}`;
      const pair = confusionMap.get(key) || {
        expected: r.expected_code,
        predicted: r.predicted_code,
        count: 0,
      };
      pair.count += 1;
      confusionMap.set(key, pair);
    }
  }
  const per_intent = {};
  for (const [code, entry] of [...perIntent.entries()].sort()) {
    // "predicted" counts predictions of a code that is also an expected
    // code somewhere in the dataset; keep it only as a diagnostic.
    per_intent[code] = {
      examples: entry.examples,
      correct: entry.correct,
      precision: entry.precision,
    };
  }
  return {
    counts: { total: results.length, correct, incorrect: results.length - correct },
    overall_precision: results.length ? correct / results.length : 0,
    per_language,
    per_vertical,
    per_intent,
    confusion: [...confusionMap.values()].sort(
      (a, b) => b.count - a.count || a.expected.localeCompare(b.expected),
    ).slice(0, 20),
  };
}

// ----------------------------------------------------------------- gates

function evaluateGates(metrics, baseline) {
  const languageFailures = Object.entries(metrics.per_language)
    .filter(([, v]) => v.precision < GATE_LANGUAGE)
    .map(([language, v]) => ({ language, precision: v.precision, total: v.total }));
  const regressionFailures = [];
  if (baseline && baseline.per_intent) {
    for (const [code, current] of Object.entries(metrics.per_intent)) {
      if (current.examples < GATE_INTENT_MIN_EXAMPLES) continue;
      const base = baseline.per_intent[code];
      if (!base || typeof base.precision !== "number") continue;
      const drop = base.precision - current.precision;
      if (drop > GATE_INTENT_MAX_DROP + 1e-9)
        regressionFailures.push({
          code,
          examples: current.examples,
          baseline_precision: base.precision,
          current_precision: current.precision,
          drop,
        });
    }
  }
  const gates = {
    overall: {
      pass: metrics.overall_precision >= GATE_OVERALL,
      threshold: GATE_OVERALL,
      actual: metrics.overall_precision,
    },
    per_language: {
      pass: languageFailures.length === 0,
      threshold: GATE_LANGUAGE,
      failures: languageFailures,
    },
    per_intent_regression: {
      pass: regressionFailures.length === 0,
      max_drop_points: GATE_INTENT_MAX_DROP,
      min_examples: GATE_INTENT_MIN_EXAMPLES,
      baseline_provided: Boolean(baseline),
      failures: regressionFailures,
    },
  };
  gates.pass =
    gates.overall.pass && gates.per_language.pass && gates.per_intent_regression.pass;
  return gates;
}

// -------------------------------------------------------------- evaluate

// Pure scoring path: no database, no network. Takes already loaded
// items, taxonomy nodes and rules, plus an injectable ollama function
// with the ../ollamaClient.js generate signature
// ({ data, schema }) -> { output: { intent, confidence }, model, digest,
// prompt_version, prompt_hash } | null.
async function evaluateDataset({ items, nodes, rules, ollama, baseline = null }) {
  const results = [];
  let seenMetadata = null;
  const modelRuns = { attempted: 0, missing: 0, identities: [] };
  for (const item of items) {
    const prediction = await predictOne({ item, nodes, rules, ollama });
    if (prediction.modelAttempted) {
      modelRuns.attempted += 1;
      if (!prediction.metadata) modelRuns.missing += 1;
      else {
        const { model, digest, prompt_version } = prediction.metadata;
        if (!modelRuns.identities.some((v) => v.model === model && v.digest === digest && v.prompt_version === prompt_version)) {
          modelRuns.identities.push({ model, digest, prompt_version });
        }
      }
    }
    if (prediction.metadata && !seenMetadata) seenMetadata = prediction.metadata;
    const expected = normalizeExpected(item.expected_code);
    results.push({
      id: item.id,
      vertical: item.vertical,
      language: item.language,
      expected_code: expected,
      expected_code_raw: item.expected_code,
      predicted_code: prediction.predicted_code,
      correct: prediction.predicted_code === expected,
      source: prediction.source,
      confidence: prediction.confidence,
    });
  }
  const metrics = computeMetrics(results);
  return { metrics, gates: evaluateGates(metrics, baseline), results, seenMetadata, modelRuns };
}

// Pinned model identity, mirroring ../ollamaClient.js env conventions.
function getPinnedModel(env = process.env) {
  return {
    name: env.GROWTH_OLLAMA_MODEL || null,
    digest: env.GROWTH_OLLAMA_DIGEST || null,
  };
}

function defaultOllama() {
  const { generate } = require("../ollamaClient");
  return (args) => generate({ ...args, task: "classify" });
}

async function runEvaluation({
  datasetPath,
  items: providedItems,
  baseline = null,
  baselinePath = null,
  conn = null,
  ollama = null,
  env = process.env,
  acceptance = false,
  review = null,
} = {}) {
  // Hash the exact bytes being evaluated, before potentially long model calls.
  const datasetContent = providedItems
    ? JSON.stringify(providedItems)
    : fs.readFileSync(datasetPath, "utf8");
  const items = providedItems || parseDataset(datasetContent);
  let baselineReport = baseline;
  if (!baselineReport && baselinePath)
    baselineReport = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const connection = conn || require("../../db");
  const { nodes, rules } = await loadTaxonomy(connection);
  const { metrics, gates, results, seenMetadata, modelRuns } = await evaluateDataset({
    items,
    nodes,
    rules,
    ollama: ollama || defaultOllama(),
    baseline: baselineReport,
  });
  const pinned = getPinnedModel(env);
  const report = {
    evaluation_mode: acceptance ? "acceptance" : "diagnostic",
    dataset: {
      path: datasetPath ? path.resolve(datasetPath) : null,
      count: items.length,
      sha256: crypto.createHash("sha256").update(datasetContent).digest("hex"),
    },
    model: {
      name: seenMetadata?.model || pinned.name,
      digest: seenMetadata?.digest || pinned.digest,
    },
    prompt_version: PROMPT_VERSION,
    model_runs: modelRuns,
    counts: metrics.counts,
    overall_precision: metrics.overall_precision,
    per_language: metrics.per_language,
    per_vertical: metrics.per_vertical,
    per_intent: metrics.per_intent,
    confusion: metrics.confusion,
    gates,
    results,
  };
  if (acceptance) report.acceptance = assessAcceptance({
    items, nodes, report, review, baseline: baselineReport, pinned,
  });
  return report;
}

// ------------------------------------------------------------------- CLI

function parseArgs(argv) {
  const args = { dataset: null, baseline: null, out: null, acceptance: false, review: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dataset") args.dataset = argv[++i];
    else if (argv[i] === "--baseline") args.baseline = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--acceptance") args.acceptance = true;
    else if (argv[i] === "--review") args.review = argv[++i];
    else if (!argv[i].startsWith("--") && !args.dataset) args.dataset = argv[i];
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.dataset) {
    console.error(
      "usage: node server/growth/eval/runner.js --dataset <items.jsonl> [--baseline <report.json>] [--out <report.json>] [--acceptance --review <review.json>]",
    );
    return 2;
  }
  const conn = require("../../db");
  try {
    const report = await runEvaluation({
      datasetPath: args.dataset,
      baselinePath: args.baseline,
      conn,
      acceptance: args.acceptance,
      review: args.review ? JSON.parse(fs.readFileSync(args.review, "utf8")) : null,
    });
    const json = JSON.stringify(report, null, 2);
    if (args.out) fs.writeFileSync(args.out, `${json}\n`);
    console.log(json);
    return (args.acceptance ? report.acceptance.pass : report.gates.pass) ? 0 : 1;
  } finally {
    if (typeof conn.end === "function") await conn.end().catch(() => {});
  }
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`eval runner failed: ${error.message}`);
      process.exitCode = 2;
    });
}

module.exports = {
  REVIEW,
  PROMPT_VERSION,
  GATE_OVERALL,
  GATE_LANGUAGE,
  GATE_INTENT_MIN_EXAMPLES,
  GATE_INTENT_MAX_DROP,
  MAX_CANDIDATES,
  parseDataset,
  loadDataset,
  loadTaxonomy,
  candidateList,
  predictOne,
  computeMetrics,
  evaluateGates,
  evaluateDataset,
  getPinnedModel,
  runEvaluation,
};
