"use strict";

// Release evidence is stricter than a smoke/diagnostic metrics pass. A review
// reference records a human attestation; this check cannot perform that review.
const LANGUAGES = ["en", "es", "fr", "ht", "ar"];
const VERTICALS = ["services", "food", "business", "customer"];
const MIN_ITEMS = 300;
const FIELDS = new Set(["category_id", "job_type", "skill_id", "cuisine_tag", "menu_tag"]);
const digest = (value) => String(value || "").replace(/^sha256:/, "");
const reference = (value) => typeof value === "string" && value.trim().length > 0;

function assessAcceptance({ items, nodes, report, review, baseline, pinned }) {
  const failures = new Set();
  const coverage = Object.fromEntries(VERTICALS.map((v) => [v,
    Object.fromEntries(LANGUAGES.map((l) => [l, 0])),
  ]));
  const active = new Set(nodes.filter((n) => n.status === "active").map((n) => n.code));
  const ids = new Set();
  const content = new Set();
  for (const item of items) {
    if (typeof item.id !== "string" || !item.id.trim() || ids.has(item.id)) failures.add("invalid_or_duplicate_id");
    ids.add(item.id);
    const fields = item.fields || {};
    if (!fields || typeof fields !== "object" || Array.isArray(fields) ||
        Object.keys(fields).some((key) => !FIELDS.has(key))) failures.add("invalid_fields");
    const identity = JSON.stringify([item.vertical, item.language,
      String(item.text || "").normalize("NFKC").trim().replace(/\s+/g, " "),
      Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)),
    ]);
    if (content.has(identity)) failures.add("duplicate_content");
    content.add(identity);
    if (item._synthetic !== undefined && item._synthetic !== false) failures.add("synthetic_data");
    if (!VERTICALS.includes(item.vertical) || !LANGUAGES.includes(item.language)) {
      failures.add("unsupported_vertical_or_language");
      continue;
    }
    coverage[item.vertical][item.language] += 1;
    if (!["none", "review"].includes(item.expected_code) &&
        (!active.has(item.expected_code) || !item.expected_code.startsWith(`${item.vertical}.`))) {
      failures.add("invalid_expected_code");
    }
  }
  if (Object.values(coverage).some((languages) => Object.values(languages).some((n) => n < MIN_ITEMS))) {
    failures.add("insufficient_coverage");
  }
  if (!review || review.human_labelled !== true || !reference(review.review_ref) ||
      !reference(review.provenance_ref) || !Number.isFinite(Date.parse(review.reviewed_at)) ||
      !/^[a-f0-9]{64}$/.test(review.dataset_sha256 || "") ||
      review.dataset_sha256 !== report.dataset.sha256) failures.add("human_review_evidence_missing_or_stale");
  if (!reference(pinned?.name) || !/^[a-f0-9]{64}$/.test(digest(pinned?.digest)) ||
      report.model.name !== pinned.name || digest(report.model.digest) !== digest(pinned.digest)) {
    failures.add("model_pin_missing_or_mismatched");
  }
  if (!report.model_runs?.attempted || report.model_runs.missing ||
      report.model_runs.identities.length !== 1 || report.model_runs.identities.some((v) =>
        v.model !== pinned?.name || digest(v.digest) !== digest(pinned?.digest) ||
        v.prompt_version !== report.prompt_version)) failures.add("pinned_model_run_unverified");
  if (!baseline || baseline.dataset?.sha256 !== report.dataset.sha256 ||
      !baseline.per_intent || Object.entries(report.per_intent).some(([code, value]) =>
        value.examples >= 30 && (!Number.isFinite(baseline.per_intent[code]?.precision) ||
          baseline.per_intent[code].examples !== value.examples))) {
    failures.add("baseline_missing_or_incomparable");
  }
  if (!report.gates.pass) failures.add("quality_thresholds_failed");
  return { pass: failures.size === 0, min_items_per_vertical_language: MIN_ITEMS,
    coverage, review_ref: review?.review_ref || null, failures: [...failures].sort() };
}

module.exports = { assessAcceptance, LANGUAGES, VERTICALS, MIN_ITEMS };
