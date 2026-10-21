"use strict";
const amazon = require("../growth/partners/amazonProducts");

test("Amazon integration is default-off and never creates a client when disabled", async () => {
  expect(amazon.config({ GROWTH_AMAZON_ENABLED: "false" })).toBeNull();
  await expect(amazon.searchItems("drill", { config: null })).resolves.toEqual({
    enabled: false,
    items: [],
  });
});

test("normalization keeps only direct Amazon item URLs and bounded fields", () => {
  const items = amazon.normalizeItems({
    SearchResult: {
      Items: [
        { ASIN: "B000000001", DetailPageURL: "https://www.amazon.com/dp/B000000001", ItemInfo: { Title: { DisplayValue: "Drill" } } },
        { ASIN: "invalid", DetailPageURL: "https://evil.example.test/item" },
      ],
    },
  });
  expect(items).toHaveLength(1);
  expect(items[0].asin).toBe("B000000001");
});

test("report evidence is hashed and disclosure is explicit", () => {
  const csv = "asin\tclicks\nB000000001\t2\n";
  expect(amazon.reportEvidence("report-1", csv)).toMatchObject({
    report_ref: "report-1",
    row_count: 1,
    content_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(amazon.disclosure()).toMatch(/Amazon Associate/);
});
