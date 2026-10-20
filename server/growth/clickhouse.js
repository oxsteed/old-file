"use strict";
const clients = new Map();
function getClient(role) {
  if (!["writer", "reader", "rights", "admin", "nightly"].includes(role))
    throw new Error("invalid_growth_store_role");
  if (clients.has(role)) return clients.get(role);
  const url = new URL(process.env.GROWTH_CLICKHOUSE_URL || "invalid:");
  if (url.username || url.password || url.search || url.pathname !== "/")
    throw new Error(
      "growth_store_url_must_not_contain_credentials_or_settings",
    );
  if (
    url.protocol !== "https:" &&
    !(
      process.env.NODE_ENV === "test" &&
      ["127.0.0.1", "localhost"].includes(url.hostname)
    )
  )
    throw new Error("growth_store_requires_tls");
  const prefix = `GROWTH_CLICKHOUSE_${role.toUpperCase()}`;
  if (!process.env[`${prefix}_USER`] || !process.env[`${prefix}_PASSWORD`])
    throw new Error("growth_store_role_not_configured");
  const client = require("@clickhouse/client").createClient({
    url: url.href,
    database: "default",
    username: process.env[`${prefix}_USER`],
    password: process.env[`${prefix}_PASSWORD`],
    request_timeout: role === "writer" ? 20000 : 65000,
    log: { level: "OFF" },
    clickhouse_settings: { max_execution_time: 60, max_result_rows: "1000000" },
  });
  clients.set(role, client);
  return client;
}
async function close() {
  await Promise.all([...clients.values()].map((c) => c.close()));
  clients.clear();
}
module.exports = { getClient, close };
