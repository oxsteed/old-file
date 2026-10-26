"use strict";
// D24 / D-ENG-09: the policy notice email (subject + body) and the in-app
// banner exist in all 20 policy languages. English is the source. Every
// other language is a MACHINE DRAFT until a professional translator reviews
// it. This module tracks that per language, against a digest of the exact
// strings reviewed, and blocks scheduling the notice while any language is
// unreviewed or has changed since its review. Nothing here can mark a
// translation as reviewed by itself.
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const LANGUAGES = ["en", "es", "fr", "ht", "ar", "de", "it", "pt", "zh", "ja", "ko", "ru", "id", "sw", "vi", "hi", "bn", "ur", "tr", "th"];
const RTL = new Set(["ar", "ur"]);
const BANNER_KEYS = ["changesOn", "changedOn", "policy", "dismiss"];
const STATUS_FILE = path.join(__dirname, "noticeTranslationStatus.json");
const CLIENT_LOCALES = path.join(__dirname, "..", "..", "client", "src", "locales");

function bannerStrings(lang, localesDir = CLIENT_LOCALES) {
  try {
    const catalog = JSON.parse(fs.readFileSync(path.join(localesDir, `${lang}.json`), "utf8"));
    return Object.fromEntries(BANNER_KEYS.map((k) => [k, catalog?.growthInsights?.[k] ?? null]));
  } catch {
    return null; // client catalogs are not shipped with every server image
  }
}

function surfaces(lang, { localesDir } = {}) {
  return {
    email_subject: require("./policyNoticeSubjects.json")[lang] ?? null,
    email_body: require("./policyCopy.json")[lang] ?? null,
    banner: bannerStrings(lang, localesDir),
  };
}

const sha = (v) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
// Email digest always; banner digest only where the client catalogs are
// present (the repo and CI). A server image without client files still
// verifies the email strings it actually sends.
function digest(lang, opts) {
  const s = surfaces(lang, opts);
  return sha([s.email_subject, s.email_body]);
}
function bannerDigest(lang, opts) {
  const b = surfaces(lang, opts).banner;
  return b ? sha(b) : null;
}

function loadStatus(file = STATUS_FILE) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Per-language report: present on every surface, review state, drift. */
function report({ status = loadStatus(), localesDir } = {}) {
  return LANGUAGES.map((lang) => {
    const s = surfaces(lang, { localesDir });
    const entry = status.languages?.[lang] || { status: "missing" };
    const current = digest(lang, { localesDir });
    const banner = bannerDigest(lang, { localesDir });
    const complete = Boolean(s.email_subject) && Array.isArray(s.email_body) && s.email_body.length >= 2 &&
      (s.banner === null || BANNER_KEYS.every((k) => typeof s.banner[k] === "string" && s.banner[k].trim()));
    const reviewed = entry.status === "source" ||
      (entry.status === "professionally_reviewed" && entry.reviewed_digest === current &&
        (banner === null || entry.reviewed_banner_digest === banner) &&
        typeof entry.review_ref === "string" && entry.review_ref.length >= 5);
    return {
      lang,
      rtl: RTL.has(lang),
      complete,
      status: entry.status,
      needs_professional_review: !reviewed,
      changed_since_review: entry.status === "professionally_reviewed" &&
        (entry.reviewed_digest !== current || (banner !== null && entry.reviewed_banner_digest !== banner)),
      digest: current,
    };
  });
}

function assertReadyToSchedule(opts) {
  const rows = report(opts);
  const blocked = rows.filter((r) => !r.complete || r.needs_professional_review).map((r) => r.lang);
  if (blocked.length)
    throw Object.assign(new Error("notice_translations_need_professional_review"), {
      statusCode: 409,
      code: "notice_translations_need_professional_review",
      fields: { languages: blocked },
    });
  return rows;
}

module.exports = { LANGUAGES, RTL, BANNER_KEYS, surfaces, digest, bannerDigest, report, assertReadyToSchedule, loadStatus, STATUS_FILE };
