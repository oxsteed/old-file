"use strict";
/*
 * growthTaxonomyGeo.test.js — Track 3 (taxonomy and geography) test suites for
 * the OxSteed Demand & Sales Engine finish work.
 *
 * Sections:
 *   1. GeoNames cities/admin1 imports + normalized postal matching + resolver
 *      fallbacks (server/scripts/importPostalCentroids.js, growth/geo/resolve.js)
 *   2. Taxonomy draft seeding (server/scripts/seedTaxonomyDraft.js)
 *   3. Classifier: parent inheritance, closed candidate lists, language
 *      detection, safe regex (server/growth/classify.js)
 *   4. Evaluation harness (server/growth/eval/runner.js)
 *   5. Clusters: incremental greedy, stable IDs, persistence, segment linkage
 *      (server/growth/geo/clusters.js, migration 937)
 *
 * Each section is block-scoped so its helpers stay independent. All database
 * access is faked; no live DB or Ollama is used.
 */
jest.mock("../db", () => ({ query: jest.fn(), connect: jest.fn(), end: jest.fn() }));


// ===== Section 1: GeoNames imports, postal normalization, resolver =====
{
// Slice 4 (Track 3): GeoNames cities/admin1 imports, normalized postal
// matching, and resolver fallbacks. Standalone: no real DB. The resolver is
// exercised against a fake conn that pattern-matches the SQL resolve() issues
// and emulates the geo_postal_centroids / geo_admin1_names tables in memory.

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  parse,
  parseCitiesLine,
  importCitiesFile,
  parseAdmin1Line,
  importAdmin1File,
} = require("../scripts/importPostalCentroids");
const { resolve, normalizePostal } = require("../growth/geo/resolve");

const VERSION = "geonames-2026-10-01";

function citiesLine(overrides = {}) {
  const cols = [
    "2988507", // geonameid
    "Paris", // name
    "Paris", // asciiname
    "", // alternatenames
    "48.85341", // lat
    "2.3488", // lng
    "P", // feature class
    "PPLC", // feature code
    "FR", // country
    "", // cc2
    "11", // admin1 code
    "75", // admin2
    "", // admin3
    "", // admin4
    "2138551", // population
    "", // elevation
    "35", // dem
    "Europe/Paris", // timezone
    "2026-01-01", // modification date
  ];
  for (const [idx, value] of Object.entries(overrides)) cols[Number(idx)] = value;
  return cols.join("\t");
}

describe("parseCitiesLine", () => {
  test("valid populated-place row becomes a place-centroid row with empty postal_code", () => {
    const row = parseCitiesLine(citiesLine(), VERSION);
    expect(row).not.toBeNull();
    expect(row[0]).toBe("FR"); // country
    expect(row[1]).toBe(""); // postal_code: place rows are stored with ''
    expect(row[2]).toBe("Paris"); // place_name = name
    expect(row[3]).toBe("11"); // admin1 CODE from the file
    expect(row[4]).toBe("75"); // admin2
    expect(row[5]).toBeCloseTo(48.85341);
    expect(row[6]).toBeCloseTo(2.3488);
    expect(typeof row[7]).toBe("string"); // h3_r5
    expect(typeof row[8]).toBe("string"); // h3_r7
    expect(row[9]).toBe(VERSION);
  });

  test("falls back to asciiname when name is empty", () => {
    const row = parseCitiesLine(citiesLine({ 1: "", 2: "Port-au-Prince" }), VERSION);
    expect(row[2]).toBe("Port-au-Prince");
  });

  test("rejects non-populated feature classes", () => {
    expect(parseCitiesLine(citiesLine({ 6: "A" }), VERSION)).toBeNull();
    expect(parseCitiesLine(citiesLine({ 6: "H" }), VERSION)).toBeNull();
  });

  test("rejects bad country, bad coordinates, and short lines", () => {
    expect(parseCitiesLine(citiesLine({ 8: "FRA" }), VERSION)).toBeNull();
    expect(parseCitiesLine(citiesLine({ 8: "" }), VERSION)).toBeNull();
    expect(parseCitiesLine(citiesLine({ 4: "999" }), VERSION)).toBeNull();
    expect(parseCitiesLine(citiesLine({ 5: "not-a-number" }), VERSION)).toBeNull();
    expect(parseCitiesLine("123\tOnly\tThree", VERSION)).toBeNull();
    expect(parseCitiesLine("", VERSION)).toBeNull();
  });
});

describe("parseAdmin1Line", () => {
  test("valid admin1CodesASCII row splits the concatenated code", () => {
    expect(parseAdmin1Line("US.FL\tFlorida\tFlorida\t4155751", VERSION)).toEqual([
      "US",
      "FL",
      "Florida",
      "Florida",
      VERSION,
    ]);
  });

  test("keeps a distinct ascii name when present", () => {
    expect(
      parseAdmin1Line("HT.OU\tOuest\tOuest\t3578071", VERSION).slice(0, 4),
    ).toEqual(["HT", "OU", "Ouest", "Ouest"]);
  });

  test("rejects malformed rows", () => {
    expect(parseAdmin1Line("Florida\tFlorida\tFlorida\t1", VERSION)).toBeNull();
    expect(parseAdmin1Line("US\tFlorida\tFlorida\t1", VERSION)).toBeNull();
    expect(parseAdmin1Line("US.FL\t\tFlorida\t1", VERSION)).toBeNull();
    expect(parseAdmin1Line("", VERSION)).toBeNull();
  });
});

describe("importAdmin1File skip behavior", () => {
  test("skips cleanly when geo_admin1_names does not exist", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "admin1-"));
    const file = path.join(dir, "admin1CodesASCII.txt");
    fs.writeFileSync(file, "US.FL\tFlorida\tFlorida\t4155751\n");
    // Fake db whose to_regclass lookup reports the table as absent. Any
    // other query would throw, proving the importer never reaches INSERT.
    const db = {
      query: async (sql) => {
        if (sql.includes("to_regclass")) return { rows: [{ reg: null }] };
        throw new Error(`unexpected query: ${sql}`);
      },
    };
    await expect(importAdmin1File(file, VERSION, db)).resolves.toEqual({
      imported: 0,
      rejected: 0,
      skipped: "geo_admin1_names_missing",
      attribution: "GeoNames CC BY 4.0",
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("importCitiesFile", () => {
  test("imports place rows through the transaction pattern and counts rejects", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cities-"));
    const file = path.join(dir, "cities1000.txt");
    fs.writeFileSync(
      file,
      [
        citiesLine(),
        citiesLine({ 0: "1", 1: "Nowhere", 6: "A" }), // rejected: not a place
        citiesLine({ 0: "2", 1: "Bad Coord", 4: "999" }), // rejected: coords
      ].join("\n") + "\n",
    );
    const inserted = [];
    const handleQuery = async (sql, params) => {
      if (sql.includes("INSERT INTO geo_postal_centroids")) inserted.push(params);
      return { rows: [] };
    };
    // The shared test setup replaces withTransaction with a shim whose
    // client delegates to pool.query, so the fake exposes both shapes.
    const db = {
      query: handleQuery,
      connect: async () => ({ query: handleQuery, release: jest.fn() }),
    };
    const result = await importCitiesFile(file, VERSION, db);
    expect(result).toEqual({
      imported: 1,
      rejected: 2,
      attribution: "GeoNames CC BY 4.0",
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0][0]).toBe("FR");
    expect(inserted[0][1]).toBe(""); // postal_code '' for place rows
    expect(inserted[0][2]).toBe("Paris");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("normalizePostal", () => {
  test("strips all whitespace and uppercases", () => {
    expect(normalizePostal(" k1a 0b1 ")).toBe("K1A0B1");
    expect(normalizePostal(" 33101 ")).toBe("33101");
    expect(normalizePostal("sw1a\t1aa\n")).toBe("SW1A1AA");
    expect(normalizePostal("")).toBe("");
    expect(normalizePostal(null)).toBe("");
    expect(normalizePostal(undefined)).toBe("");
  });

  test("matches the postal importer's inline normalization", () => {
    // Postal TSV columns: country, postal, place, admin1 name, admin1 code,
    // admin2 name, admin2 code, admin3 name, admin3 code, lat, lng, accuracy.
    const line = [
      "CA", " k1a 0b1 ", "Ottawa", "Ontario", "ON", "", "", "", "",
      "45.4215", "-75.6972", "1",
    ].join("\t");
    const row = parse(line, VERSION);
    expect(row[1]).toBe(normalizePostal(" k1a 0b1 "));
    expect(row[1]).toBe("K1A0B1");
  });
});

// --- Resolver fake conn -----------------------------------------------------
// Emulates, in memory, the exact queries resolve() issues:
//   - exact postal lookup (postal_code=$2)
//   - to_regclass('geo_admin1_names') existence probe
//   - geo_admin1_names alias lookup
//   - place-centroid lookup (postal_code='')
//   - postal-row city+state lookup (lower(admin1)=lower($3))
function fakeConn({ centroids = [], admin1Names = [], admin1Table = true } = {}) {
  return {
    async query(sql, params = []) {
      if (sql.includes("to_regclass")) {
        return { rows: [{ reg: admin1Table ? "geo_admin1_names" : null }] };
      }
      if (sql.includes("FROM geo_admin1_names")) {
        const [country, input] = params;
        const rows = admin1Names
          .filter(
            (a) =>
              a.country === country &&
              (a.name.toLowerCase() === String(input).toLowerCase() ||
                a.ascii_name.toLowerCase() === String(input).toLowerCase() ||
                a.admin1_code.toUpperCase() === String(input).toUpperCase()),
          )
          .map((a) => ({
            admin1_code: a.admin1_code,
            name: a.name,
            ascii_name: a.ascii_name,
          }));
        return { rows };
      }
      if (sql.includes("postal_code=''")) {
        const [country, city] = params;
        const rows = centroids
          .filter(
            (c) =>
              c.country === country &&
              c.postal_code === "" &&
              c.place_name.toLowerCase() === String(city).toLowerCase(),
          )
          .sort((a, b) => a.id - b.id)
          .map((c) => ({ id: c.id, admin1: c.admin1 }));
        return { rows };
      }
      if (sql.includes("postal_code=$2")) {
        const [country, postal] = params;
        const row = centroids
          .filter((c) => c.country === country && c.postal_code === postal)
          .sort((a, b) => a.id - b.id)[0];
        return { rows: row ? [{ id: row.id }] : [] };
      }
      if (sql.includes("lower(admin1)=lower($3)")) {
        const [country, city, admin1] = params;
        const row = centroids
          .filter(
            (c) =>
              c.country === country &&
              c.place_name.toLowerCase() === String(city).toLowerCase() &&
              String(c.admin1 || "").toLowerCase() ===
                String(admin1).toLowerCase(),
          )
          .sort((a, b) => a.id - b.id)[0];
        return { rows: row ? [{ id: row.id }] : [] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

const FLORIDA = {
  country: "US",
  admin1_code: "FL",
  name: "Florida",
  ascii_name: "Florida",
};

describe("resolve", () => {
  test("exact postal hit, with the lookup input normalized", async () => {
    const conn = fakeConn({
      centroids: [
        { id: 7, country: "CA", postal_code: "K1A0B1", place_name: "Ottawa", admin1: "ON" },
      ],
    });
    await expect(
      resolve(conn, { country: "CA", postal_code: " k1a 0b1 " }),
    ).resolves.toBe(7);
  });

  test("exact postal row is preferred over a place row for the same city", async () => {
    const conn = fakeConn({
      centroids: [
        { id: 1, country: "US", postal_code: "33101", place_name: "Miami", admin1: "FL" },
        { id: 2, country: "US", postal_code: "", place_name: "Miami", admin1: "FL" },
      ],
      admin1Names: [FLORIDA],
    });
    await expect(
      resolve(conn, { country: "US", postal_code: "33101", city: "Miami", state: "FL" }),
    ).resolves.toBe(1);
  });

  test("postal miss falls back to a place centroid (Haiti-style: no postal row)", async () => {
    const conn = fakeConn({
      centroids: [
        { id: 10, country: "HT", postal_code: "", place_name: "Port-au-Prince", admin1: "OU" },
      ],
      admin1Table: false,
    });
    await expect(
      resolve(conn, { country: "HT", postal_code: "6110", city: "Port-au-Prince" }),
    ).resolves.toBe(10);
    // Also with no postal code supplied at all.
    await expect(
      resolve(conn, { country: "HT", city: "port-au-prince" }),
    ).resolves.toBe(10);
  });

  test("ambiguous city without a state fails closed with 0", async () => {
    const conn = fakeConn({
      centroids: [
        { id: 20, country: "US", postal_code: "", place_name: "Springfield", admin1: "IL" },
        { id: 21, country: "US", postal_code: "", place_name: "Springfield", admin1: "MO" },
      ],
    });
    await expect(
      resolve(conn, { country: "US", city: "Springfield" }),
    ).resolves.toBe(0);
    // The same ambiguity resolves once a state disambiguates it.
    await expect(
      resolve(conn, { country: "US", city: "Springfield", state: "MO" }),
    ).resolves.toBe(21);
  });

  test("city+state via the admin1 NAME, resolved through the alias table to a place row storing the code", async () => {
    const conn = fakeConn({
      centroids: [
        { id: 2, country: "US", postal_code: "", place_name: "Miami", admin1: "FL" },
        { id: 3, country: "US", postal_code: "", place_name: "Miami", admin1: "OH" },
      ],
      admin1Names: [FLORIDA],
    });
    await expect(
      resolve(conn, { country: "US", city: "Miami", state: "Florida" }),
    ).resolves.toBe(2);
  });

  test("city+state via the admin1 NAME also reaches postal rows storing the code", async () => {
    const conn = fakeConn({
      centroids: [
        { id: 5, country: "US", postal_code: "33101", place_name: "Miami", admin1: "FL" },
      ],
      admin1Names: [FLORIDA],
    });
    // No postal code given, so the place fallback finds nothing and the
    // postal-row city+state path must try the resolved code "FL".
    await expect(
      resolve(conn, { country: "US", city: "Miami", state: "Florida" }),
    ).resolves.toBe(5);
    // And the original direct form still works.
    await expect(
      resolve(conn, { country: "US", city: "Miami", state: "FL" }),
    ).resolves.toBe(5);
  });

  test("missing geo_admin1_names table does not break resolution", async () => {
    const conn = fakeConn({
      centroids: [
        { id: 2, country: "US", postal_code: "", place_name: "Miami", admin1: "FL" },
        { id: 1, country: "US", postal_code: "33101", place_name: "Miami", admin1: "FL" },
      ],
      admin1Table: false,
    });
    await expect(
      resolve(conn, { country: "US", postal_code: "33101" }),
    ).resolves.toBe(1);
    await expect(
      resolve(conn, { country: "US", city: "Miami", state: "FL" }),
    ).resolves.toBe(2);
    await expect(
      resolve(conn, { country: "US", city: "Miami", state: "Florida" }),
    ).resolves.toBe(0); // no alias table: the name cannot be resolved, fail closed
  });

  test("invalid country and total misses return 0", async () => {
    const conn = fakeConn({ centroids: [] });
    await expect(resolve(conn, { country: "USA", postal_code: "33101" })).resolves.toBe(0);
    await expect(resolve(conn, { country: "US", postal_code: "00000" })).resolves.toBe(0);
    await expect(
      resolve(conn, { country: "US", city: "Nowhere", state: "FL" }),
    ).resolves.toBe(0);
  });
});
}


// ===== Section 2: Taxonomy draft seeding (spec 8.1/8.6) =====
{
/**
 * t3frag-seed.test.js — Track 3, Slice 1: taxonomy draft seeding.
 *
 * Standalone: no real DB. The conn is a fake { query } that records the SQL
 * it receives and emulates demand_taxonomy_nodes with an in-memory set, so
 * idempotency (ON CONFLICT DO NOTHING) is exercised end to end.
 */

const seed = require("../scripts/seedTaxonomyDraft");

const LOCALES = ["en", "es", "fr", "ht", "ar"];

function expectFiveLabels(node) {
  for (const locale of LOCALES) {
    expect(typeof node.labels[locale]).toBe("string");
    expect(node.labels[locale].length).toBeGreaterThan(0);
  }
}

function fakeConn(responder) {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (responder) return responder(sql, params);
      return { rows: [], rowCount: 0 };
    }),
  };
}

// ---------------------------------------------------------------------------
// Converters: every source yields draft nodes with 5 non-empty labels
// ---------------------------------------------------------------------------

describe("source converters", () => {
  test("categories: hierarchical rows map to services.* with parent linkage", () => {
    const nodes = seed.nodesFromCategories([
      { id: 6, name: "Plumbing", slug: "plumbing", parent_id: null },
      { id: 21, name: "Plumbing — Drain / Sewer", slug: "plumbing-drain", parent_id: 6 },
      { id: 9, name: "Pet Care", slug: "pet-care", parent_id: null },
    ]);
    expect(nodes.map((n) => n.code)).toEqual([
      "services.pet_care",
      "services.plumbing",
      "services.plumbing_drain",
    ]);
    const drain = nodes.find((n) => n.code === "services.plumbing_drain");
    expect(drain.parent_code).toBe("services.plumbing");
    expect(nodes.find((n) => n.code === "services.plumbing").parent_code).toBe("services");
    expect(drain.source).toBe("categories");
    nodes.forEach(expectFiveLabels);
  });

  test("categories: unknown parent_id falls back to the services root", () => {
    const nodes = seed.nodesFromCategories([
      { id: 1, name: "Orphan", slug: "orphan", parent_id: 999 },
    ]);
    expect(nodes[0].parent_code).toBe("services");
  });

  test("skills: grouped under their category stub, else the services root", () => {
    const nodes = seed.nodesFromSkills([
      { id: 1, name: "Drain Cleaning", category: "Plumbing" },
      { id: 2, name: "Faucet Repair", category: "Plumbing" },
      { id: 3, name: "Odd Job", category: null },
    ]);
    const stub = nodes.find((n) => n.code === "services.plumbing");
    expect(stub).toBeDefined();
    expect(stub.parent_code).toBe("services");
    const drain = nodes.find((n) => n.code === "services.plumbing.drain_cleaning");
    expect(drain.parent_code).toBe("services.plumbing");
    expect(nodes.find((n) => n.code === "services.odd_job").parent_code).toBe("services");
    nodes.forEach(expectFiveLabels);
  });

  test("business categories: category under business.*, subtypes beneath it", () => {
    const nodes = seed.nodesFromBusinessCategories([
      { id: "food", title: "Restaurant & Food", subtypes: ["Restaurant", "Bakery"] },
      { id: "health", title: "Healthcare", subtypes: ["Medical Clinic", "Mental Health"] },
    ]);
    expect(nodes.find((n) => n.code === "business.food").parent_code).toBe("business");
    const bakery = nodes.find((n) => n.code === "business.food.bakery");
    expect(bakery.parent_code).toBe("business.food");
    nodes.forEach(expectFiveLabels);
  });

  test("direct catalog: reviewed name_i18n labels are preserved", () => {
    const nodes = seed.nodesFromDirectCatalog([
      {
        slug: "electrical",
        name_i18n: { en: "Electrical", es: "Electricidad", fr: "Électricité", ht: "Elektrisite", ar: "كهرباء" },
      },
      { slug: "business-formation", name_i18n: { en: "Business Formation" } },
    ]);
    const electrical = nodes.find((n) => n.code === "services.direct.electrical");
    expect(electrical.parent_code).toBe("services");
    expect(electrical.labels.es).toBe("Electricidad");
    expect(electrical.labels.ar).toBe("كهرباء");
    nodes.forEach(expectFiveLabels);
  });

  test("learn categories land under learn.*", () => {
    const nodes = seed.nodesFromLearnCategories(["plumbing", "car-care"]);
    expect(nodes.map((n) => n.code).sort()).toEqual(["learn.car_care", "learn.plumbing"]);
    expect(nodes.every((n) => n.parent_code === "learn")).toBe(true);
    nodes.forEach(expectFiveLabels);
  });

  test("job types: plumbing kits nest under services.plumbing, others at root", () => {
    const nodes = seed.nodesFromJobTypes(["toilet-replacement", "ceiling-fan", "mystery-job"]);
    const toilet = nodes.find((n) => n.code === "services.plumbing.toilet_replacement");
    expect(toilet).toBeDefined();
    expect(toilet.parent_code).toBe("services.plumbing");
    expect(nodes.find((n) => n.code === "services.electrical.ceiling_fan")).toBeDefined();
    expect(nodes.find((n) => n.code === "services.mystery_job").parent_code).toBe("services");
    nodes.forEach(expectFiveLabels);
  });

  test("cuisine and menu tags are restaurant-level under food.*", () => {
    const cuisine = seed.nodesFromCuisineTags(["haitian", "mexican"]);
    expect(cuisine.map((n) => n.code).sort()).toEqual([
      "food.cuisine.haitian",
      "food.cuisine.mexican",
    ]);
    expect(cuisine.every((n) => n.parent_code === "food.cuisine")).toBe(true);
    const menu = seed.nodesFromMenuTags(["spicy", "vegan"]);
    expect(menu.map((n) => n.code).sort()).toEqual(["food.menu.spicy", "food.menu.vegan"]);
    cuisine.concat(menu).forEach(expectFiveLabels);
  });
});

// ---------------------------------------------------------------------------
// Sensitive classification (spec 8.6)
// ---------------------------------------------------------------------------

describe("sensitive classification (spec 8.6)", () => {
  test("halal and kosher cuisine nodes are sensitive but stay restaurant-level", () => {
    const nodes = seed.nodesFromCuisineTags(["halal", "kosher"]);
    for (const node of nodes) {
      expect(node.sensitive).toBe(true);
      expect(node.code.startsWith("food.cuisine.")).toBe(true);
    }
  });

  test("a nationality cuisine name is NOT sensitive", () => {
    const [haitian] = seed.nodesFromCuisineTags(["haitian"]);
    expect(haitian.sensitive).toBe(false);
    const [mexican] = seed.nodesFromCuisineTags(["mexican"]);
    expect(mexican.sensitive).toBe(false);
  });

  test("mental health and medical nodes are sensitive", () => {
    const biz = seed.nodesFromBusinessCategories([
      { id: "health", title: "Healthcare", subtypes: ["Mental Health", "Medical Clinic", "Dental"] },
    ]);
    expect(biz.find((n) => n.code === "business.health.mental_health").sensitive).toBe(true);
    expect(biz.find((n) => n.code === "business.health.medical_clinic").sensitive).toBe(true);
    expect(biz.find((n) => n.code === "business.health.dental").sensitive).toBe(true);
    const skills = seed.nodesFromSkills([
      { id: 1, name: "Mental Health First Aid", category: "Personal Services" },
    ]);
    expect(skills.find((n) => n.code.endsWith("mental_health_first_aid")).sensitive).toBe(true);
  });

  test("a plain plumbing skill is not sensitive", () => {
    const nodes = seed.nodesFromSkills([{ id: 1, name: "Drain Cleaning", category: "Plumbing" }]);
    expect(nodes.find((n) => n.code === "services.plumbing.drain_cleaning").sensitive).toBe(false);
    expect(nodes.find((n) => n.code === "services.plumbing").sensitive).toBe(false);
    expect(seed.isSensitive("Plumbing", "categories")).toBe(false);
  });

  test("no sensitive node is drafted as a person-level (customer.*) node", () => {
    const all = seed.mergeNodes([
      seed.ROOT_NODES,
      seed.nodesFromCuisineTags(["halal"]),
      seed.nodesFromBusinessCategories([
        { id: "health", title: "Healthcare", subtypes: ["Mental Health"] },
      ]),
    ]);
    for (const node of all.filter((n) => n.sensitive)) {
      expect(node.code.startsWith("customer.")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Dedupe / collisions / merge
// ---------------------------------------------------------------------------

describe("dedupe and collisions", () => {
  test("slugify is deterministic", () => {
    expect(seed.slugify("Cafe / Coffee Shop")).toBe("cafe_coffee_shop");
    expect(seed.slugify("Rewiring (Full House)")).toBe("rewiring_full_house");
    expect(seed.slugify("Cafe / Coffee Shop")).toBe(seed.slugify("Cafe / Coffee Shop"));
  });

  test("colliding slugs inside one source get a deterministic suffix", () => {
    const rows = [
      { id: 1, name: "Drain Cleaning", category: "Plumbing" },
      { id: 2, name: "Drain Cleaning!", category: "Plumbing" },
      { id: 3, name: "Drain  Cleaning", category: "Plumbing" },
    ];
    const first = seed.nodesFromSkills(rows).map((n) => n.code);
    const second = seed.nodesFromSkills(rows).map((n) => n.code);
    expect(first).toEqual(second);
    expect(first).toContain("services.plumbing.drain_cleaning");
    expect(first).toContain("services.plumbing.drain_cleaning_2");
    expect(first).toContain("services.plumbing.drain_cleaning_3");
    expect(new Set(first).size).toBe(first.length);
  });

  test("merge dedupes by code and ORs the sensitive flag", () => {
    const a = seed.nodesFromCategories([{ id: 1, name: "Wellness", slug: "wellness", parent_id: null }]);
    const b = seed.nodesFromSkills([{ id: 9, name: "Faucet Repair", category: "Wellness" }]);
    const merged = seed.mergeNodes([a, b]);
    const wellness = merged.filter((n) => n.code === "services.wellness");
    expect(wellness).toHaveLength(1);
    expect(wellness[0].sensitive).toBe(true);
  });

  test("merge keeps roots and children sorted by code", () => {
    const merged = seed.mergeNodes([seed.ROOT_NODES, seed.nodesFromLearnCategories(["plumbing"])]);
    const codes = merged.map((n) => n.code);
    expect(codes).toEqual(codes.slice().sort());
    expect(codes).toContain("learn");
    expect(codes).toContain("learn.plumbing");
  });
});

// ---------------------------------------------------------------------------
// Apply: idempotent, draft-only SQL through an injectable conn
// ---------------------------------------------------------------------------

describe("apply step", () => {
  test("inserts use ON CONFLICT DO NOTHING and status 'draft'", async () => {
    const conn = fakeConn(async () => ({ rows: [], rowCount: 1 }));
    const nodes = seed.mergeNodes([
      seed.ROOT_NODES,
      seed.nodesFromCategories([{ id: 6, name: "Plumbing", slug: "plumbing", parent_id: null }]),
    ]);
    await seed.applyNodes(conn, nodes);
    expect(conn.query).toHaveBeenCalled();
    for (const { sql } of conn.calls) {
      expect(sql).toContain("ON CONFLICT (code) DO NOTHING");
      expect(sql).toContain("'draft'");
      expect(sql).not.toContain("'active'");
    }
  });

  test("parents are inserted before their children", async () => {
    const conn = fakeConn(async () => ({ rows: [], rowCount: 1 }));
    const nodes = seed.mergeNodes([
      seed.ROOT_NODES,
      seed.nodesFromCategories([
        { id: 6, name: "Plumbing", slug: "plumbing", parent_id: null },
        { id: 21, name: "Plumbing — Drain / Sewer", slug: "plumbing-drain", parent_id: 6 },
      ]),
    ]);
    await seed.applyNodes(conn, nodes);
    const order = conn.calls.map((c) => c.params[0]);
    expect(order.indexOf("services")).toBeLessThan(order.indexOf("services.plumbing"));
    expect(order.indexOf("services.plumbing")).toBeLessThan(order.indexOf("services.plumbing_drain"));
    const drainCall = conn.calls.find((c) => c.params[0] === "services.plumbing_drain");
    expect(drainCall.params[1]).toBe("services.plumbing");
  });

  test("running apply twice against the same store inserts nothing the second time", async () => {
    const store = new Set();
    const conn = fakeConn(async (sql, params) => {
      if (store.has(params[0])) return { rows: [], rowCount: 0 };
      store.add(params[0]);
      return { rows: [], rowCount: 1 };
    });
    const nodes = seed.mergeNodes([seed.ROOT_NODES, seed.nodesFromLearnCategories(["plumbing"])]);
    const first = await seed.applyNodes(conn, nodes);
    const second = await seed.applyNodes(conn, nodes);
    expect(first).toBe(nodes.length);
    expect(second).toBe(0);
  });

  test("labels reach the conn as JSON with all 5 locales", async () => {
    const conn = fakeConn(async () => ({ rows: [], rowCount: 1 }));
    await seed.applyNodes(conn, seed.nodesFromCategories([
      { id: 6, name: "Plumbing", slug: "plumbing", parent_id: null },
    ]));
    const labels = JSON.parse(conn.calls[0].params[2]);
    for (const locale of LOCALES) expect(labels[locale]).toBeTruthy();
    expect(conn.calls[0].params[3]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DB collection: missing tables become summary errors, never a crash
// ---------------------------------------------------------------------------

describe("collectDrafts with a fake conn", () => {
  test("collects DB + JS sources and summarizes per source / namespace", async () => {
    const conn = fakeConn(async (sql) => {
      if (sql.includes("FROM categories")) {
        return { rows: [{ id: 6, name: "Plumbing", slug: "plumbing", parent_id: null }], rowCount: 1 };
      }
      if (sql.includes("FROM skills_lookup")) {
        return { rows: [{ id: 1, name: "Drain Cleaning", category: "Plumbing" }], rowCount: 1 };
      }
      if (sql.includes("FROM direct_catalog_categories")) {
        return { rows: [{ slug: "electrical", name_i18n: { en: "Electrical" } }], rowCount: 1 };
      }
      if (sql.includes("FROM job_kit_definitions")) {
        return { rows: [{ job_type: "toilet-replacement" }], rowCount: 1 };
      }
      if (sql.includes("FROM food_restaurants")) {
        return { rows: [{ cuisine_tags: ["haitian", "halal"] }], rowCount: 1 };
      }
      if (sql.includes("FROM food_menu_items")) {
        return { rows: [{ tags: ["spicy"] }, { tags: ["spicy"] }], rowCount: 2 };
      }
      return { rows: [], rowCount: 0 };
    });
    const { nodes, summary } = await seed.collectDrafts(conn, {
      businessCategories: [{ id: "food", title: "Restaurant & Food", subtypes: ["Bakery"] }],
      learnCategories: ["plumbing"],
    });
    const codes = nodes.map((n) => n.code);
    expect(codes).toContain("services.plumbing");
    expect(codes).toContain("services.plumbing.drain_cleaning");
    expect(codes).toContain("services.direct.electrical");
    expect(codes).toContain("services.plumbing.toilet_replacement");
    expect(codes).toContain("food.cuisine.haitian");
    expect(codes).toContain("food.cuisine.halal");
    expect(codes).toContain("food.menu.spicy");
    expect(codes).toContain("business.food.bakery");
    expect(codes).toContain("learn.plumbing");
    expect(summary.errors).toEqual([]);
    expect(summary.total).toBe(nodes.length);
    expect(summary.perNamespace.services).toBeGreaterThan(0);
    expect(summary.perNamespace.food).toBeGreaterThan(0);
    expect(summary.sensitive).toBeGreaterThanOrEqual(1);
    expect(summary.perSource.categories).toBe(1);
    nodes.forEach(expectFiveLabels);
  });

  test("a missing table is reported as a source error and other sources still load", async () => {
    const conn = fakeConn(async (sql) => {
      if (sql.includes("FROM skills_lookup")) throw new Error('relation "skills_lookup" does not exist');
      return { rows: [], rowCount: 0 };
    });
    const { summary } = await seed.collectDrafts(conn, {
      businessCategories: [],
      learnCategories: ["plumbing"],
    });
    expect(summary.errors.some((e) => e.source === "skills_lookup")).toBe(true);
    expect(summary.perSource.learn_categories).toBe(1);
  });

  test("menu tags below the common threshold are dropped", () => {
    expect(seed.commonValues([["spicy"], ["spicy"], ["rare"]], 2)).toEqual(["spicy"]);
  });
});
}


// ===== Section 3: Classifier upgrades (spec 8.3/8.4) =====
{
// TRACK 3, SLICE 2 fragment tests: pure-function coverage for the upgraded
// classifier (parent inheritance, closed Ollama candidate lists, source
// language detection, guarded regex rules). No DB, no Ollama.
const {
  scoreRules,
  buildCandidateList,
  detectLanguage,
  validateRegexPattern,
} = require("../growth/classify");

const CHILD = "services.plumbing.drain_clog";
const PARENT = "services.plumbing";
const childRule = (over = {}) => ({
  code: CHILD,
  node_id: 2,
  kind: "keyword",
  pattern: "blocked drain",
  locale: "en",
  status: "active",
  parent_code: PARENT,
  parent_id: 1,
  ...over,
});

describe("scoreRules parent inheritance (spec 8.3)", () => {
  test("keyword+category on a child scores the child 0.9 and the parent 0.8, child first", () => {
    const ranked = scoreRules(
      { text: "blocked drain", locale: "en", category_id: 3 },
      [childRule(), childRule({ kind: "category_id", pattern: "3" })],
    );
    expect(ranked.map((r) => r.code)).toEqual([CHILD, PARENT]);
    expect(ranked[0].confidence).toBe(0.9);
    expect(ranked[1]).toMatchObject({
      code: PARENT,
      node_id: 1,
      confidence: 0.8,
      inherited: true,
    });
  });

  test("keyword-only child hit gives the parent a discounted 0.6", () => {
    const ranked = scoreRules({ text: "blocked drain", locale: "en" }, [
      childRule(),
    ]);
    expect(ranked.map((r) => [r.code, r.confidence])).toEqual([
      [CHILD, 0.7],
      [PARENT, 0.6],
    ]);
  });

  test("category-only hit ties at 0.8 but the child still ranks above its parent", () => {
    const ranked = scoreRules(
      { text: "unrelated words", locale: "en", category_id: 3 },
      [childRule({ kind: "category_id", pattern: "3" })],
    );
    expect(ranked.map((r) => r.code)).toEqual([CHILD, PARENT]);
    expect(ranked[0].confidence).toBe(0.8);
    expect(ranked[1].confidence).toBe(0.8);
  });

  test("inheritance walks the whole chain with a further 0.1 discount per level", () => {
    const rules = [
      childRule(),
      {
        code: PARENT,
        node_id: 1,
        kind: "keyword",
        pattern: "zzz-no-match",
        locale: "en",
        status: "active",
        parent_code: "services",
        parent_id: 10,
      },
    ];
    const ranked = scoreRules({ text: "blocked drain", locale: "en" }, rules);
    expect(ranked.map((r) => [r.code, r.confidence])).toEqual([
      [CHILD, 0.7],
      [PARENT, 0.6],
      ["services", 0.5],
    ]);
  });

  test("rules without parent fields behave exactly as before (roots, no inheritance)", () => {
    const ranked = scoreRules(
      { text: "blocked drain", locale: "en", category_id: 3 },
      [
        {
          code: CHILD,
          node_id: 2,
          kind: "keyword",
          pattern: "drain",
          locale: "en",
          status: "active",
        },
        {
          code: CHILD,
          node_id: 2,
          kind: "category_id",
          pattern: "3",
          locale: "en",
          status: "active",
        },
      ],
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({ code: CHILD, confidence: 0.9 });
  });

  test("a directly hit parent keeps the better of its direct and inherited scores", () => {
    const ranked = scoreRules(
      { text: "blocked drain", locale: "en", category_id: 3 },
      [
        childRule(),
        {
          code: PARENT,
          node_id: 1,
          kind: "category_id",
          pattern: "3",
          locale: "en",
          status: "active",
        },
      ],
    );
    const parent = ranked.find((r) => r.code === PARENT);
    expect(parent.confidence).toBe(0.8); // direct category score, not the 0.6 inheritance
    expect(parent.inherited).toBe(false);
  });

  test("inheritance does not credit a sensitive or non-active parent", () => {
    for (const over of [
      { parent_sensitive: true },
      { parent_status: "draft" },
    ]) {
      const ranked = scoreRules({ text: "blocked drain", locale: "en" }, [
        childRule(over),
      ]);
      expect(ranked.map((r) => r.code)).toEqual([CHILD]);
    }
  });

  test("sensitive nodes and inactive rules are still excluded entirely", () => {
    const ranked = scoreRules({ text: "blocked drain", locale: "en" }, [
      childRule({ sensitive: true }),
      childRule({ status: "retired", pattern: "blocked" }),
    ]);
    expect(ranked).toEqual([]);
  });
});

describe("buildCandidateList (spec 8.4 closed list)", () => {
  const node = (id, code, parent_id, over = {}) => ({
    id,
    code,
    parent_id,
    sensitive: false,
    status: "active",
    labels: { en: code },
    ...over,
  });
  const tree = [
    node(1, "services", null),
    node(2, "services.plumbing", 1),
    node(3, "services.plumbing.drain_clog", 2),
    node(4, "services.plumbing.leak_repair", 2),
    node(5, "services.plumbing.water_heater", 2, { sensitive: true }),
    node(6, "services.plumbing.retired_intent", 2, { status: "retired" }),
    node(7, "services.electrical", 1),
    node(8, "services.electrical.outlet_repair", 7),
  ];

  test("leaf best guess yields its category's children (siblings + itself), sensitive/retired excluded", () => {
    const list = buildCandidateList(tree, "services.plumbing.drain_clog");
    expect(list.map((n) => n.code)).toEqual([
      "services.plumbing.drain_clog",
      "services.plumbing.leak_repair",
    ]);
    expect(list[0].label).toBe("services.plumbing.drain_clog");
  });

  test("category best guess yields its own children", () => {
    expect(
      buildCandidateList(tree, "services.plumbing").map((n) => n.code),
    ).toEqual([
      "services.plumbing.drain_clog",
      "services.plumbing.leak_repair",
    ]);
    expect(buildCandidateList(tree, "services").map((n) => n.code)).toEqual([
      "services.electrical",
      "services.plumbing",
    ]);
  });

  test("no best guess, unknown code, or missing category all yield an empty list", () => {
    expect(buildCandidateList(tree, null)).toEqual([]);
    expect(buildCandidateList(tree, undefined)).toEqual([]);
    expect(buildCandidateList(tree, "")).toEqual([]);
    expect(buildCandidateList(tree, "does.not.exist")).toEqual([]);
    // Leaf whose parent is not in the active list.
    expect(buildCandidateList([node(9, "orphan.leaf", 99)], "orphan.leaf")).toEqual(
      [],
    );
    // Root leaf: no parent and no children.
    expect(buildCandidateList([node(9, "lonely", null)], "lonely")).toEqual([]);
    // Sensitive best guess is not an active candidate source.
    expect(buildCandidateList(tree, "services.plumbing.water_heater")).toEqual([]);
  });

  test("list is capped at 40 codes in deterministic code order", () => {
    const big = [node(1, "cat", null)];
    for (let i = 50; i >= 1; i--)
      big.push(node(100 + i, `cat.intent_${String(i).padStart(2, "0")}`, 1));
    const list = buildCandidateList(big, "cat");
    expect(list).toHaveLength(40);
    expect(list[0].code).toBe("cat.intent_01");
    expect(list[39].code).toBe("cat.intent_40");
  });

  test("labels given as a JSON string still produce an English label", () => {
    const nodes = [
      node(1, "cat", null),
      node(2, "cat.kid", 1, { labels: '{"en":"Kid intent"}' }),
    ];
    expect(buildCandidateList(nodes, "cat")[0].label).toBe("Kid intent");
  });
});

describe("detectLanguage", () => {
  test.each([
    ["I need a plumber for my clogged drain please", "en"],
    ["Necesito un plomero para destapar el desagüe atascado por favor", "es"],
    ["J'ai besoin d'un plombier pour déboucher la canalisation bouchée", "fr"],
    ["Mwen bezwen yon plonbye pou debouche tiyo bouche a", "ht"],
    ["انسداد المصرف مسدود", "ar"],
    ["", "en"],
    ["xyzzy", "en"],
  ])("detects %j as %s", (text, expected) => {
    expect(detectLanguage(text)).toBe(expected);
  });

  test("keyword rules match against the detected language when locale is absent or auto", () => {
    const esRule = {
      code: CHILD,
      node_id: 2,
      kind: "keyword",
      pattern: "atascado",
      locale: "es",
      status: "active",
    };
    const text = "el desagüe está atascado";
    expect(scoreRules({ text }, [esRule])).toHaveLength(1);
    expect(scoreRules({ text, locale: "auto" }, [esRule])).toHaveLength(1);
  });

  test("an explicit locale still wins over detection", () => {
    const esRule = {
      code: CHILD,
      node_id: 2,
      kind: "keyword",
      pattern: "atascado",
      locale: "es",
      status: "active",
    };
    expect(
      scoreRules({ text: "el desagüe está atascado", locale: "en" }, [esRule]),
    ).toEqual([]);
  });
});

describe("validateRegexPattern and regex rule scoring", () => {
  test.each([
    "drain|clog",
    "^blocked",
    "leak(ed|ing)?",
    "colou?r",
    "a+?",
    "a{2,3}",
    "(?:abc)+",
    "(abc)+",
  ])("accepts safe pattern %j", (pattern) => {
    expect(validateRegexPattern(pattern)).toBe(true);
  });

  test.each([
    "(a+)+",
    "(a*)*",
    "(a+)*",
    "(.*)+",
    "(\\w+\\s?)*",
    "(\\w+) \\1",
    "drain(?=clog)",
    "drain(?!clog)",
    "(?<=x)y",
    "(?<!x)y",
    "[a-",
    "a++",
    "a**",
    "",
    "x".repeat(201),
    null,
    42,
  ])("rejects unsafe or invalid pattern %j", (pattern) => {
    expect(validateRegexPattern(pattern)).toBe(false);
  });

  const regexRule = (over = {}) => ({
    code: CHILD,
    node_id: 2,
    kind: "regex",
    pattern: "block(ed)? drain",
    locale: "en",
    status: "active",
    ...over,
  });

  test("a guarded regex rule scores like a keyword (0.7 alone, 0.9 with category)", () => {
    expect(
      scoreRules({ text: "blocked drain", locale: "en" }, [regexRule()])[0],
    ).toMatchObject({ code: CHILD, confidence: 0.7, regex: true });
    const both = scoreRules(
      { text: "blocked drain", locale: "en", category_id: 3 },
      [regexRule(), regexRule({ kind: "category_id", pattern: "3" })],
    );
    expect(both[0]).toMatchObject({ code: CHILD, confidence: 0.9 });
  });

  test("invalid or dangerous regex rules are skipped silently", () => {
    for (const pattern of ["(a+)+", "[a-", "blocked (drain)\\1"])
      expect(
        scoreRules({ text: "blocked drain", locale: "en" }, [
          regexRule({ pattern }),
        ]),
      ).toEqual([]);
  });

  test("regex rules respect the locale gate", () => {
    expect(
      scoreRules({ text: "blocked drain", locale: "fr" }, [regexRule()]),
    ).toEqual([]);
  });
});
}


// ===== Section 4: Evaluation harness (spec 8.5) =====
{
// Track 3 slice 3: tests for the pinned-model evaluation harness in
// server/growth/eval/runner.js. The pure scoring path is exercised with
// a fake conn returning the migration 921 seed nodes and rules, and a
// fake ollama function. No database and no Ollama server are involved.
const path = require("path");
const {
  candidateList,
  evaluateDataset,
  evaluateGates,
  runEvaluation,
} = require("../growth/eval/runner");

const DRAIN = "services.plumbing.drain_clog";
const DIGEST = `sha256:${"a".repeat(64)}`;

// Migration 921 seed nodes (ids assigned in insert order there).
const NODES = [
  { id: 1, code: "services.plumbing", parent_id: null, labels: { en: "Plumbing" }, sensitive: false, status: "active" },
  { id: 2, code: DRAIN, parent_id: 1, labels: { en: "Clogged drain" }, sensitive: false, status: "active" },
  { id: 3, code: "food.restaurant_ops.delivery_growth", parent_id: null, labels: { en: "Delivery growth" }, sensitive: false, status: "active" },
  { id: 4, code: "business.setup.online_booking", parent_id: null, labels: { en: "Online booking" }, sensitive: false, status: "active" },
];

// Migration 921 seed rules: keyword rules for drain_clog only.
const RULE_PATTERNS = [
  ["en", "clog"],
  ["en", "blocked drain"],
  ["es", "atascado"],
  ["es", "desagüe"],
  ["fr", "bouché"],
  ["fr", "canalisation"],
  ["ht", "tiyo bouche"],
  ["ht", "drenaj"],
  ["ar", "انسداد"],
  ["ar", "تسليك"],
];
const RULES = RULE_PATTERNS.map(([locale, pattern], i) => ({
  id: i + 1,
  node_id: 2,
  locale,
  kind: "keyword",
  pattern,
  weight: 0.7,
  code: DRAIN,
  sensitive: false,
  status: "active",
}));

function fakeConn() {
  return {
    query: jest.fn(async (sql) => {
      if (sql.includes("demand_taxonomy_rules")) return { rows: RULES };
      if (sql.includes("demand_taxonomy_nodes")) return { rows: NODES };
      throw new Error(`unexpected query: ${sql}`);
    }),
  };
}

// Fake ollama with the ../ollamaClient.js generate signature. Picks the
// first candidate code with high confidence.
function fakeOllama() {
  return jest.fn(async ({ data }) => {
    if (!data.intents.length) return null;
    return {
      output: { intent: data.intents[0].code, confidence: 0.95 },
      model: "fake-model",
      digest: DIGEST,
      prompt_version: "growth-v1",
      prompt_hash: "fakehash",
    };
  });
}

function fakeOllamaNone() {
  return jest.fn(async () => ({
    output: { intent: "none", confidence: 0.9 },
    model: "fake-model",
    digest: DIGEST,
    prompt_version: "growth-v1",
    prompt_hash: "fakehash",
  }));
}

const drainItem = (i, language = "en") => ({
  id: `drain-${i}`,
  vertical: "services",
  language,
  text: `Clogged drain problem number ${i}`,
  fields: {},
  expected_code: DRAIN,
});

test("smoke fixtures run end to end and produce the full report shape", async () => {
  const ollama = fakeOllama();
  const report = await runEvaluation({
    datasetPath: path.join(__dirname, "../growth/eval/fixtures/smoke.jsonl"),
    conn: fakeConn(),
    ollama,
    env: {},
  });
  expect(report.dataset.path).toContain("smoke.jsonl");
  expect(report.dataset.count).toBe(20);
  expect(report.counts).toEqual({ total: 20, correct: 15, incorrect: 5 });
  expect(report.overall_precision).toBeCloseTo(0.75);
  expect(report.model).toEqual({ name: "fake-model", digest: DIGEST });
  expect(report.prompt_version).toBe("growth-v1");
  expect(report.results).toHaveLength(20);

  // Per-language and per-vertical breakdowns are present.
  expect(Object.keys(report.per_language).sort()).toEqual(["ar", "en", "es", "fr", "ht"]);
  expect(report.per_language.en).toEqual({ total: 6, correct: 3, precision: 0.5 });
  expect(report.per_language.ht.precision).toBe(1);
  expect(report.per_language.ar.precision).toBe(1);
  for (const vertical of ["services", "food", "business", "customer"])
    expect(report.per_vertical[vertical]).toBeDefined();
  expect(report.per_vertical.food).toEqual({ total: 2, correct: 0, precision: 0 });

  // Per-intent precision: every drain item is resolved via the closed
  // candidate list; the other seeded intents have no rules in the seed
  // and land in review.
  expect(report.per_intent[DRAIN]).toEqual({ examples: 11, correct: 11, precision: 1 });
  expect(
    report.confusion.find(
      (c) => c.expected === "food.restaurant_ops.delivery_growth" && c.predicted === "review",
    ),
  ).toEqual({ expected: "food.restaurant_ops.delivery_growth", predicted: "review", count: 2 });

  // Gates: the smoke set does not meet the section 8.5 bar, and the
  // gate computation says so.
  expect(report.gates.overall).toEqual({ pass: false, threshold: 0.9, actual: 0.75 });
  expect(report.gates.per_language.pass).toBe(false);
  expect(report.gates.per_language.failures.map((f) => f.language).sort()).toEqual(["en", "es", "fr"]);
  expect(report.gates.per_intent_regression.baseline_provided).toBe(false);
  expect(report.gates.pass).toBe(false);

  // Ollama was called only for the 11 rule-unsettled drain items, each
  // time with a non-empty closed candidate list of at most 40 codes.
  expect(ollama).toHaveBeenCalledTimes(11);
  for (const [args] of ollama.mock.calls) {
    expect(args.data.intents.length).toBeGreaterThanOrEqual(1);
    expect(args.data.intents.length).toBeLessThanOrEqual(40);
    expect(args.schema.properties.intent.enum).toEqual([
      ...args.data.intents.map((n) => n.code),
      "none",
    ]);
  }
});

test("an empty candidate list never triggers an ollama call", async () => {
  const ollama = fakeOllama();
  const { results } = await evaluateDataset({
    items: [
      {
        id: "paint-1",
        vertical: "services",
        language: "en",
        text: "I need someone to paint my bedroom walls",
        fields: {},
        expected_code: "none",
      },
    ],
    nodes: NODES,
    rules: RULES,
    ollama,
  });
  expect(ollama).not.toHaveBeenCalled();
  expect(results[0].predicted_code).toBe("review");
  expect(results[0].correct).toBe(true);
  expect(candidateList(null, NODES)).toEqual([]);
  expect(candidateList({ code: DRAIN }, NODES).map((n) => n.code)).toEqual([DRAIN]);
});

test("gate computation fails a weak tiny dataset and passes a clean one", async () => {
  const weak = await evaluateDataset({
    items: [
      drainItem(1),
      // Labelled drain but nothing in the text supports it: predicted review.
      { ...drainItem(2), text: "I need someone to paint my bedroom walls" },
    ],
    nodes: NODES,
    rules: RULES,
    ollama: fakeOllama(),
  });
  expect(weak.metrics.overall_precision).toBe(0.5);
  expect(weak.gates.overall.pass).toBe(false);
  expect(weak.gates.per_language.pass).toBe(false);
  expect(weak.gates.pass).toBe(false);

  const clean = await evaluateDataset({
    items: Array.from({ length: 10 }, (_, i) => drainItem(i + 1)),
    nodes: NODES,
    rules: RULES,
    ollama: fakeOllama(),
  });
  expect(clean.metrics.overall_precision).toBe(1);
  expect(clean.gates.overall.pass).toBe(true);
  expect(clean.gates.per_language.pass).toBe(true);
  expect(clean.gates.pass).toBe(true);
});

test("per-intent regression gate: over 2 points with >= 30 examples fails", () => {
  const metricsWith = (precision, examples) => ({
    overall_precision: 1,
    per_language: { en: { total: examples, correct: examples, precision: 1 } },
    per_intent: { [DRAIN]: { examples, correct: Math.round(precision * examples), precision } },
  });
  const baseline = { per_intent: { [DRAIN]: { examples: 30, correct: 30, precision: 1 } } };

  const dropped = evaluateGates(metricsWith(0.9, 30), baseline);
  expect(dropped.per_intent_regression.pass).toBe(false);
  expect(dropped.per_intent_regression.failures).toHaveLength(1);
  expect(dropped.per_intent_regression.failures[0].code).toBe(DRAIN);
  expect(dropped.per_intent_regression.failures[0].drop).toBeCloseTo(0.1);
  expect(dropped.pass).toBe(false);

  // A drop of exactly 2 points is allowed.
  expect(evaluateGates(metricsWith(0.98, 30), baseline).per_intent_regression.pass).toBe(true);
  // Intents below 30 examples are not gated, however far they drop.
  expect(evaluateGates(metricsWith(0, 29), baseline).per_intent_regression.pass).toBe(true);
  // No baseline means no regression failures.
  expect(evaluateGates(metricsWith(0.5, 30), null).per_intent_regression).toMatchObject({
    pass: true,
    baseline_provided: false,
    failures: [],
  });
});

test("regression gate fires through the full pipeline against a baseline report", async () => {
  const items = Array.from({ length: 30 }, (_, i) => drainItem(i + 1));
  const { metrics, gates } = await evaluateDataset({
    items,
    nodes: NODES,
    rules: RULES,
    // The model answers "none" for everything: every drain item lands
    // in review, so drain precision falls from 1 to 0.
    ollama: fakeOllamaNone(),
    baseline: { per_intent: { [DRAIN]: { examples: 30, correct: 30, precision: 1 } } },
  });
  expect(metrics.per_intent[DRAIN]).toEqual({ examples: 30, correct: 0, precision: 0 });
  expect(gates.per_intent_regression.pass).toBe(false);
  expect(gates.per_intent_regression.failures[0]).toMatchObject({
    code: DRAIN,
    examples: 30,
    baseline_precision: 1,
    current_precision: 0,
  });
  expect(gates.pass).toBe(false);
});
}


// ===== Section 5: Clusters (spec 9.3) =====
{
// Track 3 slice 5: cluster optimisation, stable ids, persistence, linkage.
// Pure tests for selectClusters/clusterKey plus a fake conn that emulates
// the SQL shapes find()/persistClusters()/linkClusterToSegment() issue.
const fs = require("fs");
const path = require("path");
const clusters = require("../growth/geo/clusters");
const { selectClusters, clusterKey, HARD_FLOOR } = clusters;

const RULES = [
  {
    code: "US",
    activity_basis: "notice",
    offers_basis: "notice",
    sale_share_control: false,
    reviewed_at: "2026-10-01",
  },
  {
    code: "default",
    activity_basis: "notice",
    offers_basis: "notice",
    sale_share_control: false,
    reviewed_at: "2026-10-01",
  },
  {
    code: "unknown",
    activity_basis: "consent",
    offers_basis: "consent",
    sale_share_control: true,
    reviewed_at: "2026-10-01",
  },
];
const uid = (n) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeEach(() => {
  process.env.GROWTH_TRACKING_HARD_OFF = "false";
  process.env.GROWTH_SUBJECT_PEPPER =
    "synthetic-growth-subject-pepper-test-only";
});

// ---- fake conn for find() -------------------------------------------------
function makeFindConn({ rolloutState = "effective" } = {}) {
  // postal_ref -> candidate user numbers; user 9 is gate-ineligible.
  const candidates = [];
  const users = new Map();
  const addUser = (n, postal_ref, eligible = true) => {
    candidates.push({ user_id: uid(n), postal_ref });
    users.set(uid(n), {
      id: uid(n),
      role: "helper",
      is_active: true,
      is_banned: false,
      deleted_at: null,
      is_suspended: false,
      country: "US",
      country_confirmed: true,
      city: "Springfield",
      state: "OH",
      zip_code: "45501",
      preferred_language: "en",
      created_at: "2025-01-01",
      adult_confirmed: eligible,
      is_internal: false,
    });
  };
  [1, 2, 3].forEach((n) => addUser(n, 1));
  [4, 5].forEach((n) => addUser(n, 2));
  [6, 7, 8].forEach((n) => addUser(n, 3));
  addUser(9, 3, false);
  [10, 11].forEach((n) => addUser(n, 4));
  const placeNames = {
    1: "Springfield",
    2: "Shelbyville",
    3: "Ogdenville",
    4: "North Haverbrook",
  };
  const adjacency = { 1: [1, 2], 2: [1, 2, 3], 3: [3, 4], 4: [3, 4] };
  const calls = [];
  const conn = {
    calls,
    query: jest.fn(async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes("WHERE key='growth.jurisdiction_rules'"))
        return { rows: [{ value: JSON.stringify(RULES) }] };
      if (sql.includes("FROM platform_settings WHERE key IN"))
        return {
          rows: [
            { key: "growth.activity_tracking_enabled", value: "true" },
            {
              key: "growth.jurisdiction_rules",
              value: JSON.stringify(RULES),
            },
          ],
        };
      if (sql.includes("FROM activity_tracking_rollout"))
        return {
          rows: [
            {
              id: 1,
              state: rolloutState,
              effective_at: "2026-10-19",
              policy_version: "v1",
              legal_review_ref: "test-legal",
              translations_reviewed: true,
              rights_verified: true,
            },
          ],
        };
      if (sql.includes("LEFT JOIN growth_subject_eligibility"))
        return {
          rows: params[0].map((id) => users.get(id)).filter(Boolean),
        };
      if (sql.includes("FROM tracking_consent_current")) return { rows: [] };
      if (sql.includes("SELECT p.user_id,p.postal_ref"))
        return { rows: candidates };
      if (sql.includes("GROUP BY p.postal_ref")) {
        // Emulate the SQL aggregation over the eligible ids in $1.
        const eligible = new Set(params[0]);
        const counts = new Map();
        for (const c of candidates)
          if (eligible.has(c.user_id))
            counts.set(c.postal_ref, (counts.get(c.postal_ref) || 0) + 1);
        return {
          rows: [...counts.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([postal_ref, member_count]) => ({
              postal_ref,
              member_count,
            })),
        };
      }
      if (sql.includes("ST_DWithin")) {
        const [ids, countsArr] = params;
        const countOf = new Map(ids.map((id, i) => [id, countsArr[i]]));
        const rows = [];
        for (const id of [...ids].sort((a, b) => a - b))
          for (const neighbour of [...(adjacency[id] || [])].sort(
            (a, b) => a - b,
          ))
            if (countOf.has(neighbour))
              rows.push({
                id,
                place_name: placeNames[id],
                neighbour,
                neighbour_count: countOf.get(neighbour),
              });
        return { rows };
      }
      throw new Error(`unexpected_sql: ${sql.slice(0, 80)}`);
    }),
  };
  return conn;
}

const FIND_ARGS = [
  {
    intent: "services.plumbing.drain_clog",
    role: "helper",
    country: "US",
    miles: 35,
    min_n: 5,
  },
  { global: true },
];

test("find aggregates eligible users in SQL and runs one neighbourhood join over eligible centroids only", async () => {
  const conn = makeFindConn();
  const result = await clusters.find(conn, ...FIND_ARGS);
  // Anchor 2 totals 3+2+3=8 eligible members; user 9 (postal 3) is gated out.
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    anchor_id: 2,
    place_name: "Shelbyville",
    member_count: 8,
    miles: 35,
    postal_refs: [1, 2, 3],
  });
  expect(result[0].cluster_key).toBe(
    clusterKey({
      intent: "services.plumbing.drain_clog",
      role: "helper",
      country: "US",
      anchor_postal_ref: 2,
      miles: 35,
      postal_refs: [3, 1, 2],
    }),
  );
  const sqls = conn.calls.map((c) => c.sql);
  // Candidate query no longer caps at 100k profile rows.
  const candidateSql = sqls.find((s) =>
    s.includes("SELECT p.user_id,p.postal_ref"),
  );
  expect(candidateSql).not.toContain("100001");
  // Aggregation is a GROUP BY over the eligible ids passed back in.
  const agg = conn.calls.find((c) => c.sql.includes("GROUP BY p.postal_ref"));
  expect(agg.sql).toContain("COUNT(*)");
  expect(agg.sql).toContain("unnest($1::uuid[])");
  expect(agg.params[0]).toHaveLength(10);
  expect(agg.params[0]).not.toContain(uid(9));
  // Exactly one neighbourhood statement, half radius unchanged.
  const joins = conn.calls.filter((c) => c.sql.includes("ST_DWithin"));
  expect(joins).toHaveLength(1);
  expect(joins[0].sql).toContain("unnest($1::int[])");
  expect(joins[0].params[2]).toBeCloseTo((35 * 1609.344) / 2);
  expect(joins[0].params[0]).toEqual([1, 2, 3, 4]);
  expect(joins[0].params[1]).toEqual([3, 2, 3, 2]);
});

test("find returns [] while the rollout gate is off and validates min_n >= 5", async () => {
  const conn = makeFindConn({ rolloutState: "draft" });
  await expect(clusters.find(conn, ...FIND_ARGS)).resolves.toEqual([]);
  expect(
    conn.calls.some((c) => c.sql.includes("user_interest_profiles p JOIN")),
  ).toBe(false);
  await expect(
    clusters.find(makeFindConn(), { ...FIND_ARGS[0], min_n: 3 }, FIND_ARGS[1]),
  ).rejects.toThrow("invalid_cluster_request");
});

// ---- selectClusters: pure greedy ------------------------------------------
const anchorsOf = (spec) =>
  Object.entries(spec).map(([id, centroids]) => ({
    id: Number(id),
    place_name: `place-${id}`,
    centroids,
  }));

test("greedy picks the largest neighbourhood first and never reuses centroids", () => {
  const counts = new Map([
    [1, 3],
    [2, 2],
    [3, 3],
    [4, 2],
  ]);
  const out = selectClusters(
    anchorsOf({ 1: [1, 2], 2: [1, 2, 3], 3: [3, 4], 4: [3, 4] }),
    counts,
    5,
  );
  expect(out).toEqual([
    {
      anchor_id: 2,
      place_name: "place-2",
      member_count: 8,
      postal_refs: [1, 2, 3],
    },
  ]);
  // A second disjoint group is still emitted after the first selection.
  const counts2 = new Map([
    [1, 5],
    [2, 1],
    [3, 5],
    [4, 1],
  ]);
  const out2 = selectClusters(
    anchorsOf({ 1: [1, 2], 2: [1, 2], 3: [3, 4], 4: [3, 4] }),
    counts2,
    5,
  );
  expect(out2.map((c) => c.anchor_id)).toEqual([1, 3]);
  const usedRefs = out2.flatMap((c) => c.postal_refs);
  expect(new Set(usedRefs).size).toBe(usedRefs.length);
});

test("ties break by lowest anchor id and counts below min_n stop selection", () => {
  const counts = new Map([
    [1, 4],
    [2, 4],
  ]);
  const out = selectClusters(
    anchorsOf({ 2: [2], 1: [1] }),
    counts,
    4,
  );
  expect(out.map((c) => c.anchor_id)).toEqual([1, 2]);
  expect(
    selectClusters(anchorsOf({ 1: [1] }), new Map([[1, 4]]), 5),
  ).toEqual([]);
});

test("hard floor: a count of 2 is never emitted, even below the validated min_n", () => {
  expect(HARD_FLOOR).toBe(3);
  for (const minN of [1, 2, 3])
    expect(
      selectClusters(anchorsOf({ 1: [1] }), new Map([[1, 2]]), minN),
    ).toEqual([]);
  // A count of exactly 3 is the floor and is emitted when minN allows it.
  expect(
    selectClusters(anchorsOf({ 1: [1] }), new Map([[1, 3]]), 2),
  ).toHaveLength(1);
});

// Brute-force reference: the original O(anchors^2) rescan implementation.
function bruteForce(anchorsInput, membersByCentroid, minN) {
  const effectiveMin = Math.max(minN, HARD_FLOOR);
  const members = new Map(
    [...membersByCentroid.entries()].map(([k, v]) => [Number(k), v]),
  );
  const anchors = new Map();
  for (const a of anchorsInput)
    anchors.set(a.id, {
      id: a.id,
      place_name: a.place_name,
      centroids: [...a.centroids],
    });
  const used = new Set();
  const result = [];
  while (anchors.size) {
    const candidates = [...anchors.values()]
      .map((a) => ({
        ...a,
        count: a.centroids
          .filter((c) => !used.has(c))
          .reduce((n, c) => n + (members.get(c) || 0), 0),
      }))
      .sort((a, b) => b.count - a.count || a.id - b.id);
    const best = candidates[0];
    if (!best || best.count < effectiveMin) break;
    result.push({
      anchor_id: best.id,
      place_name: best.place_name,
      member_count: best.count,
      postal_refs: best.centroids.filter((c) => !used.has(c)),
    });
    best.centroids.forEach((c) => used.add(c));
    anchors.delete(best.id);
  }
  return result;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("incremental decrement matches brute-force recomputation on randomized cases", () => {
  const rand = mulberry32(20261020);
  for (let trial = 0; trial < 300; trial++) {
    const n = 6 + Math.floor(rand() * 9); // 6..14 centroids
    const ids = Array.from({ length: n }, (_, i) => i + 1);
    const counts = new Map(ids.map((id) => [id, Math.floor(rand() * 5)])); // 0..4
    const anchors = ids.map((id) => {
      const centroids = ids.filter(
        (other) => other === id || rand() < 0.35,
      );
      return { id, place_name: `place-${id}`, centroids };
    });
    const minN = [3, 4, 5, 6][Math.floor(rand() * 4)];
    expect(selectClusters(anchors, counts, minN)).toEqual(
      bruteForce(anchors, counts, minN),
    );
  }
});

// ---- cluster_key ------------------------------------------------------------
test("cluster_key is stable across member order and changes with identity inputs", () => {
  const base = {
    intent: "services.plumbing.drain_clog",
    role: "helper",
    country: "US",
    anchor_postal_ref: 2,
    miles: 35,
    postal_refs: [1, 2, 3],
  };
  const key = clusterKey(base);
  expect(key).toMatch(/^gc_[a-f0-9]{64}$/);
  expect(clusterKey({ ...base, postal_refs: [3, 2, 1] })).toBe(key);
  expect(clusterKey({ ...base, anchor_postal_ref: 3 })).not.toBe(key);
  expect(clusterKey({ ...base, miles: 50 })).not.toBe(key);
  expect(clusterKey({ ...base, postal_refs: [1, 2] })).not.toBe(key);
  expect(clusterKey({ ...base, intent: "services.plumbing" })).not.toBe(key);
});

// ---- persistClusters ---------------------------------------------------------
test("persistClusters upserts by cluster_key and returns the stored rows", async () => {
  const calls = [];
  const conn = {
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      return {
        rows: [
          {
            id: 41,
            cluster_key: params[0],
            member_count: params[6],
            segment_id: null,
          },
        ],
      };
    }),
  };
  const found = {
    anchor_id: 2,
    place_name: "Shelbyville",
    member_count: 8,
    miles: 35,
    postal_refs: [1, 2, 3],
  };
  const saved = await clusters.persistClusters(conn, [found], {
    intent: "services.plumbing.drain_clog",
    role: "helper",
    country: "US",
    run_date: "2026-10-20",
  });
  expect(saved).toHaveLength(1);
  expect(saved[0].cluster_key).toBe(
    clusterKey({
      intent: "services.plumbing.drain_clog",
      role: "helper",
      country: "US",
      anchor_postal_ref: 2,
      miles: 35,
      postal_refs: [1, 2, 3],
    }),
  );
  const { sql, params } = calls[0];
  expect(sql).toContain("INSERT INTO growth_clusters");
  expect(sql).toContain("ON CONFLICT (cluster_key) DO UPDATE SET");
  expect(sql).toContain("member_count=EXCLUDED.member_count");
  expect(sql).toContain("postal_refs=EXCLUDED.postal_refs");
  expect(sql).toContain("last_seen_at=NOW()");
  expect(sql).toContain("RETURNING *");
  expect(params[4]).toBe(2);
  expect(params[7]).toBe(35);
  expect(params[8]).toEqual([1, 2, 3]);
  expect(params[9]).toBe("2026-10-20");
  // Below the hard floor: never persisted, no query issued.
  const skipped = await clusters.persistClusters(
    conn,
    [{ ...found, member_count: 2 }],
    { intent: "services.plumbing.drain_clog", role: "helper", country: "US" },
  );
  expect(skipped).toEqual([]);
  expect(calls).toHaveLength(1);
});

// ---- linkClusterToSegment ----------------------------------------------------
test("linkClusterToSegment validates the segment and updates by key or id", async () => {
  const makeConn = ({ segment = { id: 7 }, row }) => ({
    query: jest.fn(async (sql, params) => {
      if (sql.includes("FROM growth_segments"))
        return { rows: segment ? [segment] : [] };
      if (sql.includes("UPDATE growth_clusters SET segment_id"))
        return { rows: row ? [row] : [] };
      throw new Error(`unexpected_sql: ${sql.slice(0, 60)}`);
    }),
  });
  const byKey = makeConn({
    row: { id: 41, cluster_key: "gc_abc", segment_id: 7 },
  });
  await expect(
    clusters.linkClusterToSegment(byKey, "gc_abc", 7),
  ).resolves.toMatchObject({ id: 41, segment_id: 7 });
  expect(byKey.query.mock.calls[1][0]).toContain("WHERE cluster_key=$1");
  const byId = makeConn({ row: { id: 41, segment_id: 7 } });
  await expect(
    clusters.linkClusterToSegment(byId, 41, 7),
  ).resolves.toMatchObject({ id: 41 });
  expect(byId.query.mock.calls[1][0]).toContain("WHERE id=$1");
  await expect(
    clusters.linkClusterToSegment(makeConn({ segment: null }), "gc_abc", 7),
  ).rejects.toThrow("segment_not_found");
  await expect(
    clusters.linkClusterToSegment(makeConn({ row: null }), "gc_missing", 7),
  ).rejects.toThrow("cluster_not_found");
});

// ---- migration 937 (static inspection; no live DB) ---------------------------
test("migration 937 is additive and carries the required tables, columns and indexes", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "../migrations/937_growth_clusters.sql"),
    "utf8",
  );
  expect(sql).toContain("CREATE TABLE growth_clusters");
  expect(sql).toContain("cluster_key TEXT NOT NULL UNIQUE");
  expect(sql).toMatch(/anchor_postal_ref INTEGER NOT NULL/);
  expect(sql).toMatch(/member_count INTEGER NOT NULL CHECK\(member_count>=3\)/);
  expect(sql).toContain("postal_refs INTEGER[]");
  expect(sql).toContain("segment_id BIGINT REFERENCES growth_segments(id)");
  expect(sql).toContain("first_seen_at");
  expect(sql).toContain("last_seen_at");
  expect(sql).toContain("run_date DATE");
  expect(sql).toContain("CREATE INDEX ON growth_clusters(segment_id)");
  expect(sql).toContain("CREATE TABLE geo_admin1_names");
  expect(sql).toMatch(/country CHAR\(2\) NOT NULL/);
  expect(sql).toContain("UNIQUE(country,admin1_code)");
  // Additive only: no destructive or rewriting statements.
  expect(sql).not.toMatch(/\b(DROP|DELETE|TRUNCATE|ALTER)\b/);
});
}
