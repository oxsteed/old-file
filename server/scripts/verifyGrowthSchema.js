#!/usr/bin/env node
"use strict";
const fs = require("fs"),
  path = require("path"),
  crypto = require("crypto"),
  { spawnSync } = require("child_process");
const root = path.resolve(__dirname, "..");
const container =
  process.env.GROWTH_TEST_POSTGRES_CONTAINER ||
  "oxsteed-growth-isolated-test-postgres-1";
if (!/^oxsteed-growth-[a-z0-9-]+-postgres-1$/.test(container))
  throw new Error("A dedicated growth test container is required");
const context = process.env.CI === "true" ? "default" : "colima";
const database = `growth_test_${crypto.randomBytes(6).toString("hex")}`;
function psql(db, input) {
  const out = spawnSync(
    "docker",
    [
      "--context",
      context,
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "oxsteed",
      "-d",
      db,
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input, encoding: "utf8" },
  );
  if (out.status !== 0)
    throw new Error(out.stderr || "Growth schema rehearsal failed");
  return out.stdout;
}
try {
  psql("postgres", `CREATE DATABASE ${database};`);
  const files = fs
    .readdirSync(path.join(root, "migrations"))
    .filter(
      (f) =>
        /^9\d\d_.*\.sql$/.test(f) &&
        Number(f.slice(0, 3)) >= 916 &&
        Number(f.slice(0, 3)) <= 940,
    )
    .sort();
  const input = [
    fs.readFileSync(path.join(root, "growth/testing/base.sql"), "utf8"),
    ...files.map((f) =>
      fs.readFileSync(path.join(root, "migrations", f), "utf8"),
    ),
    fs.readFileSync(path.join(root, "growth/testing/assert.sql"), "utf8"),
  ].join("\n");
  psql(database, input);
  console.log(
    JSON.stringify({
      migrations: files.length,
      assertions: "passed",
      database: "disposable predecessor fixture",
    }),
  );
} finally {
  psql("postgres", `DROP DATABASE IF EXISTS ${database} WITH(FORCE);`);
}
