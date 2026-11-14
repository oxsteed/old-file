// Gap fill 9, 10, 13, 14 (PR #679 audit): ready-made oversight forms and
// translated action types, SAR draft editing and single anchor view, the
// public Credit terms page, and keyset paging in the business Customer 360.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { OVERSIGHT_TEMPLATES, actionTypeLabel, manualRateProblem, templateFor } from "../src/admin/pages/super/oxsteedCredit/licence/oversightTemplates.js";
import { pendingLegalApproval } from "../src/lib/creditTerms.js";

const client = new URL("../src/", import.meta.url);
const server = new URL("../../server/", import.meta.url);
const read = (base, p) => fs.readFileSync(new URL(p, base), "utf8");
const LANGS = fs.readdirSync(new URL("i18n/locales/", client)).filter((d) => fs.existsSync(new URL(`i18n/locales/${d}/credit.json`, client)));
const CORE = ["es", "fr", "ht", "ar"];
const credit = (l) => JSON.parse(read(client, `i18n/locales/${l}/credit.json`));
const legacy = (l) => JSON.parse(read(client, `locales/${l}.json`));
const common = (l) => JSON.parse(read(client, `i18n/locales/${l}/common.json`));

function registeredOversightTypes() {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory() && e.name !== "node_modules" && e.name !== "__tests__") walk(p);
      else if (e.name.endsWith(".js")) files.push(p);
    }
  };
  walk(new URL("services", server).pathname);
  const types = new Set();
  for (const f of files) for (const m of fs.readFileSync(f, "utf8").matchAll(/register\('(credit_[a-z_]+)'/g)) types.add(m[1]);
  return [...types].sort();
}

test("gap fill 9: every registered oversight type has a template and a translated label in all 20 locales", () => {
  const types = registeredOversightTypes();
  assert.ok(types.length >= 20, `found ${types.length}`);
  assert.equal(LANGS.length, 20);
  for (const type of types) {
    assert.ok(OVERSIGHT_TEMPLATES[type], `${type} template`);
    const en = credit("en").adminLicence.actionTypes[type];
    assert.equal(typeof en, "string", `en ${type}`);
    for (const l of LANGS) {
      const v = credit(l).adminLicence.actionTypes?.[type];
      assert.equal(typeof v, "string", `${l} ${type}`);
      if (CORE.includes(l)) assert.notEqual(v, en, `${l} ${type} is untranslated`);
    }
  }
  const t = (key, o) => (key === "adminLicence.actionTypes.credit_sar_approve" ? "Approve SAR" : o.defaultValue);
  assert.equal(actionTypeLabel(t, "credit_sar_approve"), "Approve SAR");
  assert.equal(actionTypeLabel(t, "credit_unknown_type"), "credit_unknown_type");
  const section = read(client, "admin/pages/super/oxsteedCredit/licence/OversightSection.jsx");
  assert.match(section, /<option key=\{type\} value=\{type\}>\{actionTypeLabel\(t, type\)\}<\/option>/);
  assert.match(section, /key: 'actionType', label: 'type', render: \(v\) => <span title=\{v\}>\{actionTypeLabel\(t, v\)\}/);
});

test("gap fill 9: the manual FX template and form send exactly the fields the server validates", () => {
  const svc = read(server, "services/fx/manualReferenceRate.js");
  const fields = Object.keys(OVERSIGHT_TEMPLATES.credit_fx_reference_rate_entry).sort();
  assert.deepEqual(fields, ["note", "quoteCurrency", "rateDate", "unitsPerUsd"]);
  for (const f of fields) assert.match(svc, new RegExp(`payload\\?\\.${f}`), f);
  assert.deepEqual(JSON.parse(templateFor("credit_fx_reference_rate_entry")), OVERSIGHT_TEMPLATES.credit_fx_reference_rate_entry);
  const ok = { quoteCurrency: "HTG", unitsPerUsd: "131.25", rateDate: "2026-11-02", note: "BRH taux de référence page" };
  assert.equal(manualRateProblem(ok), null);
  assert.equal(manualRateProblem({ ...ok, quoteCurrency: "USD" }), "fxManualBadCurrency");
  assert.equal(manualRateProblem({ ...ok, quoteCurrency: "HT" }), "fxManualBadCurrency");
  assert.equal(manualRateProblem({ ...ok, unitsPerUsd: "0" }), "fxManualBadRate");
  assert.equal(manualRateProblem({ ...ok, unitsPerUsd: "-1" }), "fxManualBadRate");
  assert.equal(manualRateProblem({ ...ok, unitsPerUsd: "1.123456789" }), "fxManualBadRate");
  assert.equal(manualRateProblem({ ...ok, rateDate: "" }), "fxManualBadDate");
  assert.equal(manualRateProblem({ ...ok, note: "BRH" }), "fxManualBadNote");
  const fx = read(client, "admin/pages/super/oxsteedCredit/licence/FxLimitsSection.jsx");
  assert.match(fx, /requestOversight\('credit_fx_reference_rate_entry', \{/);
  assert.doesNotMatch(fx, /adminApi\.post\(`\$\{LICENCE_API\}\/fx\/reference-rates/, "manual rates only go through the two-admin oversight queue");
});

test("gap fill 10: SAR drafts are edited with PATCH and one anchor opens with GET /audit-anchors/:date", () => {
  const c = read(client, "admin/pages/super/oxsteedCredit/licence/ComplianceSection.jsx");
  assert.match(c, /adminApi\.patch\(`\$\{LICENCE_API\}\/sar\/\$\{encodeURIComponent\(e\.id\)\}`, \{/);
  assert.match(c, /row\.status === 'draft' && <ActionButton disabled=\{action\.busy\} onClick=\{\(\) => startEdit\(row\)\}>/);
  const r = read(client, "admin/pages/super/oxsteedCredit/licence/ReportsSection.jsx");
  assert.match(r, /adminApi\.get\(`\$\{LICENCE_API\}\/audit-anchors\/\$\{encodeURIComponent\(row\.anchor_date\)\}`\)/);
  assert.match(r, /<pre dir="ltr"/);
  const routes = read(server, "routes/creditLicenceAdmin.js");
  assert.match(routes, /router\.patch\('\/sar\/:id'/);
  assert.match(routes, /actionType: 'credit\.audit_anchor\.viewed'/);
});

test("gap fill 13: public Credit terms page is routed, linked, translated and flags unapproved text", () => {
  const app = read(client, "App.jsx");
  assert.match(app, /<Route path="\/legal\/credit-terms" +element=\{<Guarded><CreditTermsPage \/><\/Guarded>\} \/>/);
  assert.doesNotMatch(app, /\/legal\/credit-terms"[^\n]*ProtectedRoute/, "readable before sign-in");
  const page = read(client, "pages/CreditTermsPage.jsx");
  assert.match(page, /api\.get\('\/payment-layers\/credit\/disclosures', \{ params: \{ lang, currency \}/);
  assert.doesNotMatch(page, /disclosures\/mine|disclosures\/accept/);
  assert.match(page, /noIndex=\{state\.status !== 'ready' \|\| pending\}/);
  assert.match(read(client, "components/Footer.jsx"), /<FooterLink to="\/legal\/credit-terms">\{t\('footer\.creditTerms'\)\}<\/FooterLink>/);
  const routes = read(server, "routes/paymentLayers.js");
  assert.match(routes, /router\.get\('\/credit\/disclosures', generalLimiter, licence\.getDisclosures\)/, "the public endpoint stays unauthenticated");
  assert.equal(pendingLegalApproval([{ placeholder: false, approved_reference: "LEG-1" }]), false);
  assert.equal(pendingLegalApproval([{ placeholder: false, approved_reference: "LEG-1" }, { placeholder: true, approved_reference: null }]), true);
  assert.equal(pendingLegalApproval([{ placeholder: false, approved_reference: null }]), true);
  const keys = Object.keys(legacy("en").creditTermsPage);
  assert.ok(keys.length >= 10);
  for (const l of LANGS) {
    for (const src of [legacy(l), common(l)]) {
      for (const k of keys) assert.equal(typeof src.creditTermsPage?.[k], "string", `${l} creditTermsPage.${k}`);
      assert.equal(typeof src.footer?.creditTerms, "string", `${l} footer.creditTerms`);
    }
    if (CORE.includes(l)) assert.notEqual(legacy(l).creditTermsPage.pendingBody, legacy("en").creditTermsPage.pendingBody);
  }
});

test("gap fill 14: business Customer 360 pages with an opaque cursor and reads every restaurant", () => {
  const svc = read(server, "services/businessCustomer360.js");
  assert.doesNotMatch(svc, /LIMIT 100/);
  assert.doesNotMatch(svc, /OFFSET \$\d/);
  assert.match(svc, /for await \(const id of businessRestaurantIds\(req\.business\.id, db\)\)/);
  const ui = read(client, "components/businessHub/BusinessCustomer360.jsx");
  assert.match(ui, /cursor: cursor \|\| undefined/);
  assert.match(ui, /list\.nextCursor &&/);
  assert.doesNotMatch(ui, /nextOffset/);
});

test("new admin copy is logical-direction safe (no physical left/right)", () => {
  for (const f of ["FxLimitsSection.jsx", "ComplianceSection.jsx", "ReportsSection.jsx", "OversightSection.jsx"]) {
    const s = read(client, `admin/pages/super/oxsteedCredit/licence/${f}`);
    assert.doesNotMatch(s, /\b(ml|mr|pl|pr|left|right)-\d|text-(left|right)\b/, f);
  }
  assert.doesNotMatch(read(client, "pages/CreditTermsPage.jsx"), /\b(ml|mr|pl|pr|left|right)-\d|text-(left|right)\b|marginLeft|marginRight|paddingLeft|paddingRight/);
});

test("domain 1 #9: BusinessCustomer360 paging failure keeps the list and shows an inline notice", () => {
  const ui = read(client, "components/businessHub/BusinessCustomer360.jsx");
  // A failed "Load more" must not flip the whole page to its error branch.
  assert.doesNotMatch(ui, /load\(list\.nextCursor\)\.catch\(\(\) => setState\('error'\)\)/);
  assert.match(ui, /load\(list\.nextCursor\)\.catch\(\(\) => setMoreError\(true\)\)/);
  assert.match(ui, /\{moreError && <p role="alert">\{copy\('moreFailed'\)\}<\/p>\}/);
  // The new copy exists in every legacy locale and is translated in the core four.
  const legacyLangs = fs.readdirSync(new URL("locales/", client)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  for (const l of legacyLangs) {
    assert.equal(typeof legacy(l).businessCustomer360.moreFailed, "string", `${l}: businessCustomer360.moreFailed`);
    assert.equal(typeof legacy(l).businessCustomer360.retry, "string", `${l}: businessCustomer360.retry`);
  }
  for (const l of CORE) {
    assert.notEqual(legacy(l).businessCustomer360.moreFailed, legacy("en").businessCustomer360.moreFailed, `${l}: moreFailed untranslated`);
    assert.notEqual(legacy(l).businessCustomer360.retry, legacy("en").businessCustomer360.retry, `${l}: retry untranslated`);
  }
});

test("domain 1 #17: BusinessCustomer360 detail-pane error offers a retry", () => {
  const ui = read(client, "components/businessHub/BusinessCustomer360.jsx");
  assert.match(ui, /detailState === 'error' && \([\s\S]{0,400}?copy\('retry'\)/);
  assert.match(ui, /onClick=\{\(\) => selected && open\(selected\)\}/);
});
