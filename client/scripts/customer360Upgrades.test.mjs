import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { AREAS } from "../src/admin/pages/customer360/model.js";
import { changeRows, eventLabel } from "../src/admin/pages/customer360/upgrades/model.js";

const root = new URL("../src/", import.meta.url);
const LANGS = fs.readdirSync(new URL("locales/", root)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
const CORE = ["en", "es", "fr", "ht", "ar"];
const walk = (o, p = "") => Object.entries(o || {}).flatMap(([k, v]) => (typeof v === "string" ? [p + k] : walk(v, `${p}${k}.`)));
const legacy = (l) => JSON.parse(fs.readFileSync(new URL(`locales/${l}.json`, root)));

test("event changes render without inventing redacted values", () => {
  assert.deepEqual(changeRows({ status: { from: "open", to: "closed" }, email: { changed: true, redacted: true }, meta: { changed: true }, role: "payer" }), [
    { field: "status", kind: "value", from: "open", to: "closed" },
    { field: "email", kind: "redacted" },
    { field: "meta", kind: "changed" },
  ]);
  assert.deepEqual(changeRows(null), []);
  const copy = (key, o) => (key === "events.types.payment" ? `Payment ${o.action}` : o.defaultValue);
  assert.equal(eventLabel({ event_type: "payment.captured" }, copy), "Payment captured");
  assert.equal(eventLabel({ event_type: "unknown.thing_done" }, copy), "unknown thing done");
});

test("every upgrade area and key exists in all 20 legacy locales with core translations", () => {
  const en = legacy("en").customerWorkspace;
  const upgradeRoots = ["events", "health", "ai"];
  const keys = walk(Object.fromEntries(upgradeRoots.map((k) => [k, en[k]])));
  assert.ok(keys.length > 30);
  for (const l of LANGS) {
    const cw = legacy(l).customerWorkspace;
    for (const key of keys) assert.equal(typeof key.split(".").reduce((a, k) => a?.[k], cw), "string", `${l}: ${key}`);
    for (const a of AREAS) if (upgradeRoots.includes(a)) assert.equal(typeof cw.areas?.[a], "string", `${l}: areas.${a}`);
  }
  for (const l of CORE.filter((x) => x !== "en")) {
    const cw = legacy(l).customerWorkspace;
    const same = keys.filter((key) => key.split(".").reduce((a, k) => a?.[k], cw) === key.split(".").reduce((a, k) => a?.[k], en));
    // Cognates ("Points", "Factor") are fine; whole untranslated blocks are not.
    assert.ok(same.length <= Math.ceil(keys.length * 0.05), `${l} has untranslated upgrade copy: ${same.join(", ")}`);
  }
});

test("upgrade panels use logical CSS only", () => {
  const css = fs.readFileSync(new URL("admin/pages/customer360/workspace.css", root), "utf8");
  const upgrade = css.slice(css.indexOf("/* Customer 360 upgrade panels"));
  assert.ok(upgrade.length > 100);
  assert.doesNotMatch(upgrade, /\b(margin|padding|border)-(left|right)\b|\b(left|right)\s*:|text-align:\s*(left|right)/);
});
