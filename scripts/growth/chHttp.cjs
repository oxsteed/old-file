"use strict";
// Minimal ClickHouse HTTP client for the drill tools. Credentials come from
// CLICKHOUSE_USER / CLICKHOUSE_PASSWORD and are never printed.
async function ch(url, query, { body, timeoutMs = 30000 } = {}) {
  const u = new URL(url);
  u.searchParams.set("query", query);
  const headers = {};
  if (process.env.CLICKHOUSE_USER) headers["X-ClickHouse-User"] = process.env.CLICKHOUSE_USER;
  if (process.env.CLICKHOUSE_PASSWORD) headers["X-ClickHouse-Key"] = process.env.CLICKHOUSE_PASSWORD;
  const res = await fetch(u, { method: body ? "POST" : "GET", body, headers, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) throw new Error(`ClickHouse ${res.status}: ${text.slice(0, 200)}`);
  return text;
}
module.exports = { ch };
