import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  AREAS,
  connectionState,
  moneyMinor,
  moneyMajor,
  recordRoute,
  sectionTimeline,
  selectedRecords,
} from "../src/admin/pages/customer360/model.js";
const root = new URL("../src/", import.meta.url);
test("timeline uses only authorized ready sources and sorts chronologically", () => {
  const sections = {
    a: {
      key: "jobs",
      state: "ready",
      records: [
        { id: "1", occurred_at: "2026-01-01" },
        { id: "2", occurred_at: "2026-10-18" },
      ],
    },
    b: { state: "restricted", records: [{ id: "secret" }] },
  };
  assert.deepEqual(
    sectionTimeline(sections).map((r) => r.id),
    ["2", "1"],
  );
  assert.equal(selectedRecords({ sections }, "all", "a").length, 0);
});
test("currency formatting respects zero, two and three decimal currencies and refuses unsafe rounding", () => {
  assert.match(moneyMinor(1200, "JPY", "en"), /1,200/);
  assert.match(moneyMinor(1200, "USD", "en"), /12\.00/);
  assert.match(moneyMinor(1200, "KWD", "en"), /1\.200/);
  assert.equal(moneyMinor("9007199254740993", "USD"), "$90,071,992,547,409.93");
  assert.equal(moneyMinor(1200, null), "1200");
  assert.equal(moneyMinor(null, "USD"), "—");
});
test("device connectivity uses heartbeat rather than a successful old sync", () => {
  const now = Date.now();
  assert.equal(
    connectionState(
      { status: "paired", last_seen_at: new Date(now - 44999) },
      now,
    ),
    "online",
  );
  assert.equal(
    connectionState(
      { status: "paired", last_seen_at: new Date(now - 45000) },
      now,
    ),
    "degraded",
  );
  assert.equal(
    connectionState(
      {
        status: "paired",
        last_seen_at: new Date(now - 60000),
        last_sync_at: new Date(now),
      },
      now,
    ),
    "offline",
  );
});
test("record destinations preserve the selected customer and currency", () => {
  assert.equal(
    recordRoute({ key: "foodOrders" }, { id: 12 }, "u"),
    "/admin/food-orders/12",
  );
  assert.match(
    recordRoute({ area: "credit" }, { id: 1, currency_code: "HTG" }, "u"),
    /customerId=u&currencyCode=HTG/,
  );
});
test("all workspace translations have legacy and namespaced parity in five languages", () => {
  const walk = (o) =>
    Object.entries(o).flatMap(([k, v]) =>
      typeof v === "string" ? [k] : walk(v).map((s) => `${k}.${s}`),
    );
  let expected;
  for (const l of ["en", "es", "fr", "ht", "ar"]) {
    const legacy = JSON.parse(
      fs.readFileSync(new URL(`locales/${l}.json`, root)),
    ).customerWorkspace;
    const namespaced = JSON.parse(
      fs.readFileSync(new URL(`i18n/locales/${l}/common.json`, root)),
    ).customerWorkspace;
    assert.deepEqual(legacy, namespaced);
    const keys = walk(legacy).sort();
    if (!expected) expected = keys;
    assert.deepEqual(keys, expected);
    for (const a of AREAS) assert.equal(typeof legacy.areas[a], "string");
  }
});

test("major-unit sources and negative fractional amounts remain exact", () => {
  assert.equal(
    moneyMajor("90071992547409.93", "USD", "en"),
    "$90,071,992,547,409.93",
  );
  assert.equal(moneyMinor("-1", "USD", "en"), "-$0.01");
  assert.match(moneyMajor("1.234", "KWD", "en"), /1\.234/);
});
