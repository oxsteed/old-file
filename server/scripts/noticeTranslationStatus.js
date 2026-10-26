#!/usr/bin/env node
"use strict";
// D24: report or record professional review of the policy notice
// translations (email subject/body + in-app banner) in all 20 languages.
//
//   node server/scripts/noticeTranslationStatus.js                 # report
//   node server/scripts/noticeTranslationStatus.js --mark-reviewed=de --ref=VENDOR-PO-123
//
// --mark-reviewed records the CURRENT digest of that language's strings, so
// any later edit puts the language back into "needs professional review".
// Only run it after a professional translator has actually reviewed the
// exact strings; the change lands through a reviewed PR.
const fs = require("fs");
const t = require("../growth/noticeTranslations");

function main(argv = process.argv.slice(2)) {
  const lang = argv.find((a) => a.startsWith("--mark-reviewed="))?.split("=")[1];
  if (lang) {
    const ref = argv.find((a) => a.startsWith("--ref="))?.slice(6) || "";
    if (!t.LANGUAGES.includes(lang) || lang === "en") throw new Error("unknown or source language");
    if (ref.trim().length < 5) throw new Error("--ref with the reviewer/purchase reference is required");
    if (!t.bannerDigest(lang)) throw new Error("run from a full checkout: the banner strings live in client/src/locales");
    const status = t.loadStatus();
    status.languages[lang] = { status: "professionally_reviewed", review_ref: ref.trim(), reviewed_digest: t.digest(lang), reviewed_banner_digest: t.bannerDigest(lang), reviewed_on: new Date().toISOString().slice(0, 10) };
    fs.writeFileSync(t.STATUS_FILE, `${JSON.stringify(status, null, 2)}\n`);
  }
  return t.report();
}
if (require.main === module) {
  try {
    for (const r of main()) process.stdout.write(`${r.lang}\t${r.status}\t${r.needs_professional_review ? "NEEDS PROFESSIONAL REVIEW" : "ok"}${r.changed_since_review ? " (changed since review)" : ""}${r.complete ? "" : " INCOMPLETE"}\n`);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exitCode = 1;
  }
}
module.exports = { main };
