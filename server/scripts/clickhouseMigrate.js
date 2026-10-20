#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const statements = (sql) =>
  sql
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
async function migrate(
  client = require("../growth/clickhouse").getClient("admin"),
) {
  const dir = path.join(__dirname, "../migrations-clickhouse");
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^C\d+_.*\.sql$/.test(f))
    .sort();
  const bootstrap = fs.readFileSync(path.join(dir, files[0]), "utf8");
  let previous;
  try {
    const result = await client.query({
      query: "SELECT name,checksum FROM growth.schema_migrations FINAL",
      format: "JSONEachRow",
    });
    previous = await result.json();
  } catch (error) {
    if (!["60", "81"].includes(String(error.code))) throw error;
    for (const query of statements(bootstrap)) await client.command({ query });
    previous = [];
  }
  const applied = new Map(previous.map((r) => [r.name, r.checksum]));
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    if (applied.has(file)) {
      if (applied.get(file) !== checksum)
        throw new Error(`Applied ClickHouse migration changed: ${file}`);
      continue;
    }
    for (const query of statements(sql)) await client.command({ query });
    await client.insert({
      table: "growth.schema_migrations",
      values: [{ name: file, checksum }],
      format: "JSONEachRow",
    });
  }
}
if (require.main === module)
  migrate()
    .then(() => require("../growth/clickhouse").close())
    .catch(async () => {
      console.error(
        "ClickHouse migration failed; inspect private server diagnostics.",
      );
      await require("../growth/clickhouse").close();
      process.exitCode = 1;
    });
module.exports = { migrate, statements };
