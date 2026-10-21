"use strict";

// Fixed, aggregate-only ClickHouse queries for the Growth Insights product.
// Callers select a named query and supply bounded parameters; arbitrary SQL is
// deliberately not accepted from an HTTP request or an admin UI.
const MAX_DAYS = 31;
const MAX_ROWS = 10000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const QUERIES = Object.freeze({
  activityHourly: `
    SELECT hour, event_name, role, country, postal_ref, route, element_key,
           uniqMerge(subjects) AS subjects, uniqExactMerge(events) AS events
      FROM growth.activity_hourly
     WHERE day BETWEEN {start:Date} AND {end:Date}
       AND ({event_name:String} = '' OR event_name = {event_name:String})
     GROUP BY hour, event_name, role, country, postal_ref, route, element_key
     ORDER BY hour ASC
     LIMIT {limit:UInt32}`,
  subjectActivityDaily: `
    SELECT day, event_name, uniqExact(subject_key) AS subjects,
           uniqExactMerge(events) AS events
      FROM growth.subject_activity_daily
     WHERE day BETWEEN {start:Date} AND {end:Date}
     GROUP BY day, event_name
     ORDER BY day ASC, event_name ASC
     LIMIT {limit:UInt32}`,
});

function validDay(value, name) {
  const day = String(value || "");
  if (!ISO_DAY.test(day)) throw new Error(`${name}_invalid`);
  return day;
}

function daysBetween(start, end) {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a)
    throw new Error("date_range_invalid");
  const days = Math.floor((b - a) / 86400000) + 1;
  if (days > MAX_DAYS) throw new Error("date_range_too_large");
  return days;
}

function params({ start, end, eventName = "", limit = MAX_ROWS } = {}) {
  const safeStart = validDay(start, "start");
  const safeEnd = validDay(end, "end");
  daysBetween(safeStart, safeEnd);
  const safeLimit = Number(limit);
  if (!Number.isInteger(safeLimit) || safeLimit < 1 || safeLimit > MAX_ROWS)
    throw new Error("limit_invalid");
  const safeEvent = String(eventName || "");
  if (safeEvent.length > 80 || !/^[a-z0-9_.-]*$/i.test(safeEvent))
    throw new Error("event_name_invalid");
  return {
    start: safeStart,
    end: safeEnd,
    event_name: safeEvent,
    limit: safeLimit,
  };
}

function build(name, input) {
  if (!Object.hasOwn(QUERIES, name)) throw new Error("unknown_clickhouse_query");
  return { query: QUERIES[name], query_params: params(input) };
}

async function execute(client, name, input) {
  if (!client || typeof client.query !== "function")
    throw new Error("clickhouse_client_required");
  const request = build(name, input);
  return client.query({ ...request, format: "JSONEachRow" });
}

module.exports = { MAX_DAYS, MAX_ROWS, QUERIES, build, execute };
