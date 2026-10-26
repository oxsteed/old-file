#!/usr/bin/env node
"use strict";
// D16 operator CLI:
//   node server/scripts/regionGeoSourceSwitch.js --dry-run [--version=geonames-2026-10]
//   node server/scripts/regionGeoSourceSwitch.js --switch  [--version=...] [--force]
//   node server/scripts/regionGeoSourceSwitch.js --rollback
// Prints aggregate counts only. --force overrides a coverage regression,
// never an empty centroid table.
const db = require("../db");
const geoSwitch = require("../analytics/regionGeoSourceSwitch");

function parseArgs(argv) {
  const out = { action: null, version: null, force: false };
  for (const arg of argv) {
    if (arg === "--dry-run") out.action = "dry_run";
    else if (arg === "--switch") out.action = "switch";
    else if (arg === "--rollback") out.action = "rollback";
    else if (arg === "--force") out.force = true;
    else if (arg.startsWith("--version=")) out.version = arg.slice(10) || null;
  }
  return out;
}

async function main(argv = process.argv.slice(2), conn = db) {
  const args = parseArgs(argv);
  if (!args.action) throw new Error("usage: --dry-run | --switch [--force] | --rollback");
  const client = await conn.connect();
  let result;
  try {
    await client.query("BEGIN");
    if (args.action === "dry_run") result = await geoSwitch.dryRun(client, { sourceVersion: args.version });
    else if (args.action === "switch")
      result = await geoSwitch.switchToCentroids(client, { sourceVersion: args.version, force: args.force });
    else result = await geoSwitch.rollback(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  await geoSwitch.notifyAdminsOfResult(conn, result);
  const { notice, ...printable } = result;
  return printable;
}

if (require.main === module) {
  main()
    .then((r) => {
      process.stdout.write(`${JSON.stringify(r)}\n`);
      return db.end?.();
    })
    .catch((e) => {
      process.stderr.write(`${e.message}\n`);
      process.exitCode = 1;
      db.end?.();
    });
}

module.exports = { main, parseArgs };
