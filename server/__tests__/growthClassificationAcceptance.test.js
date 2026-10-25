"use strict";

const { assessAcceptance, LANGUAGES, VERTICALS } = require("../growth/eval/acceptance");
const { runEvaluation } = require("../growth/eval/runner");

const hash = "b".repeat(64);
const pin = { name: "test-model", digest: `sha256:${"a".repeat(64)}` };

// Generated cases exercise validation only. They are never written as gold data
// and this mocked report is not evidence of classifier quality or human review.
function fixture() {
  const items = VERTICALS.flatMap((vertical) => LANGUAGES.flatMap((language) =>
    Array.from({ length: 300 }, (_, i) => ({
      id: `${vertical}-${language}-${i}`, vertical, language,
      text: `Validation case ${i}`, expected_code: `${vertical}.example`, fields: {},
    })),
  ));
  const per_intent = Object.fromEntries(VERTICALS.map((v) => [`${v}.example`, { examples: 1500, precision: 1 }]));
  return {
    items,
    nodes: VERTICALS.map((v) => ({ code: `${v}.example`, status: "active" })),
    report: { dataset: { sha256: hash }, model: pin, prompt_version: "growth-v1", per_intent,
      model_runs: { attempted: 6000, missing: 0, identities: [{ model: pin.name, digest: pin.digest, prompt_version: "growth-v1" }] },
      gates: { pass: true } },
    review: { dataset_sha256: hash, human_labelled: true, review_ref: "test-review", provenance_ref: "test-provenance", reviewed_at: "2026-10-25T00:00:00Z" },
    baseline: { dataset: { sha256: hash }, per_intent },
    pinned: pin,
  };
}

test("complete review evidence and coverage can satisfy acceptance validation", () => {
  const result = assessAcceptance(fixture());
  expect(result.pass).toBe(true);
  expect(result.coverage.customer.ar).toBe(300);
});

test.each([
  ["insufficient_coverage", (f) => { f.items.pop(); }],
  ["synthetic_data", (f) => { f.items[0]._synthetic = true; }],
  ["invalid_or_duplicate_id", (f) => { f.items[1].id = f.items[0].id; }],
  ["duplicate_content", (f) => { f.items[1].text = f.items[0].text; }],
  ["invalid_fields", (f) => { f.items[0].fields = { locale: "en" }; }],
  ["invalid_expected_code", (f) => { f.items[0].expected_code = "food.example"; }],
  ["human_review_evidence_missing_or_stale", (f) => { f.review.dataset_sha256 = "c".repeat(64); }],
  ["human_review_evidence_missing_or_stale", (f) => { f.review.human_labelled = false; }],
  ["baseline_missing_or_incomparable", (f) => { f.baseline = null; }],
  ["baseline_missing_or_incomparable", (f) => { f.baseline = { dataset: { sha256: hash }, per_intent: {} }; }],
  ["model_pin_missing_or_mismatched", (f) => { f.pinned = {}; }],
  ["pinned_model_run_unverified", (f) => { f.report.model_runs.missing = 1; }],
  ["pinned_model_run_unverified", (f) => { f.report.model_runs.identities.push({ model: "different-model" }); }],
  ["pinned_model_run_unverified", (f) => { f.report.model_runs.identities[0].prompt_version = "unreviewed-prompt"; }],
  ["quality_thresholds_failed", (f) => { f.report.gates.pass = false; }],
])("rejects %s", (reason, mutate) => {
  const f = fixture();
  mutate(f);
  expect(assessAcceptance(f)).toMatchObject({ pass: false, failures: expect.arrayContaining([reason]) });
});

test("a perfect single-language diagnostic run cannot become release acceptance", async () => {
  const nodes = [{ id: 1, code: "services.example", status: "active", sensitive: false }];
  const conn = { query: jest.fn(async (sql) => ({ rows: sql.includes("demand_taxonomy_rules") ? [] : nodes })) };
  const report = await runEvaluation({
    items: [{ id: "one", vertical: "services", language: "en", text: "Test", expected_code: "review" }],
    conn, ollama: jest.fn(), env: {}, acceptance: true,
  });
  expect(report.gates.pass).toBe(true);
  expect(report.dataset.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(report.acceptance.pass).toBe(false);
  expect(report.acceptance.failures).toEqual(expect.arrayContaining([
    "insufficient_coverage", "human_review_evidence_missing_or_stale",
    "model_pin_missing_or_mismatched", "baseline_missing_or_incomparable", "pinned_model_run_unverified",
  ]));
});

test("report records later model drift and missing responses instead of trusting the first call", async () => {
  const node = { id: 1, code: "services.example", status: "active", sensitive: false, parent_id: null };
  const rule = { ...node, node_id: 1, kind: "keyword", pattern: "clog", locale: "en", weight: 0.7 };
  const conn = { query: jest.fn(async (sql) => ({ rows: sql.includes("demand_taxonomy_rules") ? [rule] : [node] })) };
  const response = (model) => ({ model, digest: pin.digest, prompt_version: "growth-v1", output: { intent: node.code, confidence: 0.9 } });
  const ollama = jest.fn().mockResolvedValueOnce(response(pin.name))
    .mockResolvedValueOnce(response("changed-model")).mockResolvedValueOnce(null);
  const report = await runEvaluation({
    items: Array.from({ length: 3 }, (_, i) => ({ id: `case-${i}`, vertical: "services", language: "en", text: `clog case ${i}`, expected_code: node.code })),
    conn, ollama, env: {},
  });
  expect(report.model_runs).toMatchObject({ attempted: 3, missing: 1 });
  expect(report.model_runs.identities.map((v) => v.model)).toEqual([pin.name, "changed-model"]);
});

test("dataset hash stays bound to evaluated bytes when a file changes during evaluation", async () => {
  const fs = require("fs");
  const path = require("path");
  const crypto = require("crypto");
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "growth-eval-test-"));
  const datasetPath = path.join(dir, "items.jsonl");
  const original = JSON.stringify({ id: "one", vertical: "services", language: "en", text: "Test", expected_code: "review" }) + "\n";
  fs.writeFileSync(datasetPath, original);
  try {
    const conn = { query: jest.fn(async () => {
      fs.writeFileSync(datasetPath, "changed after input was loaded");
      return { rows: [] };
    }) };
    const report = await runEvaluation({ datasetPath, conn, ollama: jest.fn(), env: {} });
    expect(report.dataset.sha256).toBe(crypto.createHash("sha256").update(original).digest("hex"));
    expect(report.counts.total).toBe(1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
