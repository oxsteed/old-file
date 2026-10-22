"use strict";

const queries = require("../growth/clickhouseQueries");

test("builds only bounded aggregate queries with typed parameters", () => {
  const request = queries.build("activityHourly", {
    start: "2026-10-01",
    end: "2026-10-07",
    eventName: "ui.click",
    limit: 50,
  });
  expect(request.query).toContain("uniqMerge(subjects)");
  expect(request.query).toContain("postal_ref");
  expect(request.query).toContain("LIMIT {limit:UInt32}");
  expect(request.query_params).toEqual({
    start: "2026-10-01",
    end: "2026-10-07",
    event_name: "ui.click",
    limit: 50,
  });
});

test.each([
  [{ start: "2026-10-01", end: "2026-11-01" }, "date_range_too_large"],
  [{ start: "2026-10-02", end: "2026-10-01" }, "date_range_invalid"],
  [{ start: "2026-10-01", end: "2026-10-02", limit: 0 }, "limit_invalid"],
  [{ start: "2026-10-01", end: "2026-10-02", eventName: "x' OR 1=1" }, "event_name_invalid"],
])("rejects unsafe query parameters", (input, code) => {
  expect(() => queries.build("activityHourly", input)).toThrow(code);
});

test("rejects arbitrary query names and clients", async () => {
  expect(() => queries.build("rawSql", {})).toThrow("unknown_clickhouse_query");
  await expect(queries.execute(null, "activityHourly", {})).rejects.toThrow("clickhouse_client_required");
});
