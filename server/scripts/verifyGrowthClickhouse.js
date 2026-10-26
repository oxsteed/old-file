#!/usr/bin/env node
"use strict";
const { createClient } = require("@clickhouse/client");
const crypto = require("crypto");
const { migrate } = require("./clickhouseMigrate");
async function verify() {
  const url = new URL(process.env.GROWTH_CLICKHOUSE_URL || "invalid:");
  if (
    process.env.NODE_ENV !== "test" ||
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname)
  )
    throw new Error("Disposable loopback ClickHouse fixture required");
  const admin = require("../growth/clickhouse").getClient("admin");
  const read = async (c, query, query_params = {}) =>
    await (
      await c.query({ query, query_params, format: "JSONEachRow" })
    ).json();
  if (
    (await read(admin, "SELECT getMacro('replica') AS replica"))[0].replica !==
    "test-01"
  )
    throw new Error("Refusing to modify a non-test cluster");
  await migrate(admin);
  await migrate(admin);
  for (const table of ["activity_events", "activity_hourly", "subject_activity_daily"]) {
    const [definition] = await read(admin, "SELECT create_table_query FROM system.tables WHERE database='growth' AND name={table:String}", { table });
    if (!/TTL[\s\S]*toIntervalDay\(90\)/.test(definition?.create_table_query || "")) {
      throw new Error(`growth_retention_mismatch:${table}`);
    }
  }
  const password = "synthetic-growth-role-only";
  const clients = [];
  try {
    for (const role of ["writer", "reader", "rights"]) {
      await admin.command({
        query: `CREATE USER IF NOT EXISTS growth_test_${role} ON CLUSTER growth IDENTIFIED WITH plaintext_password BY '${password}'`,
      });
      await admin.command({
        query: `GRANT ON CLUSTER growth growth_${role} TO growth_test_${role}`,
      });
      clients.push(
        createClient({
          url: url.href,
          username: `growth_test_${role}`,
          password,
          log: { level: "OFF" },
        }),
      );
    }
    const [writer, reader, rights] = clients;
    const now = new Date().toISOString(),
      stamp = now.replace("T", " ").replace("Z", ""),
      subject = crypto.randomBytes(32).toString("hex");
    const row = {
      day: now.slice(0, 10),
      event_id: crypto.randomUUID(),
      occurred_at: stamp,
      received_at: stamp,
      event_name: "ui.click",
      schema_ver: 1,
      subject_key: subject,
      device_key: "",
      session_key: "",
      role: "helper",
      surface: "web",
      app_version: "1",
      locale: "en",
      country: "US",
      postal_ref: 1,
      jurisdiction: "US",
      basis: "notice",
      route: "/jobs",
      element_key: `test.${subject.slice(0, 16)}`,
      entity_type: "",
      entity_id: "",
      props: "{}",
      is_bot: false,
      is_internal: false,
    };
    const oldTime = new Date(Date.now() - 91 * 86400000).toISOString();
    const expired = { ...row, day: oldTime.slice(0,10), event_id: crypto.randomUUID(),
      occurred_at: oldTime.replace('T',' ').replace('Z',''),
      subject_key: crypto.randomBytes(32).toString('hex'), element_key: `expired.${subject.slice(0,16)}` };
    await writer.insert({ table: 'growth.activity_events', values: [expired], format: 'JSONEachRow' });
    for (const table of ['activity_events','activity_hourly','subject_activity_daily']) {
      await admin.command({ query: `ALTER TABLE growth.${table} ON CLUSTER growth MATERIALIZE TTL`, clickhouse_settings: { mutations_sync: '2' } });
      const where = table === 'activity_hourly' ? 'element_key={element:String}' : 'subject_key={subject:String}';
      const [count] = await read(admin, `SELECT count() AS remaining FROM growth.${table} FINAL WHERE ${where}`,
        { subject: expired.subject_key, element: expired.element_key });
      if (Number(count.remaining) !== 0) throw new Error(`growth_retention_expiry_failed:${table}`);
    }
    await writer.insert({
      table: "growth.activity_events",
      values: [row],
      format: "JSONEachRow",
    });
    await writer.insert({
      table: "growth.activity_events",
      values: [row],
      format: "JSONEachRow",
    });
    if (
      Number(
        (
          await read(
            rights,
            "SELECT count() AS n FROM growth.activity_events FINAL WHERE subject_key={subject:String}",
            { subject },
          )
        )[0].n,
      ) !== 1
    )
      throw new Error("Raw event replay was not deduplicated");
    if (
      Number(
        (
          await read(
            reader,
            "SELECT uniqExactMerge(events) AS n FROM growth.activity_hourly WHERE element_key={element:String}",
            { element: row.element_key },
          )
        )[0].n,
      ) !== 1
    )
      throw new Error("Rollup replay failed");
    for (const client of [writer, reader]) {
      let denied = false;
      try {
        await read(client, "SELECT * FROM growth.activity_events LIMIT 1");
      } catch (e) {
        denied = String(e.code) === "497";
      }
      if (!denied) throw new Error("Raw access role isolation failed");
    }
    for (const table of ["activity_events", "subject_activity_daily"])
      await rights.command({
        query: `ALTER TABLE growth.${table} ON CLUSTER growth DELETE WHERE subject_key={subject:String}`,
        query_params: { subject },
        clickhouse_settings: { mutations_sync: "2" },
      });
    if (
      Number(
        (
          await read(
            rights,
            "SELECT count() AS n FROM growth.activity_events FINAL WHERE subject_key={subject:String}",
            { subject },
          )
        )[0].n,
      ) !== 0
    )
      throw new Error("Erasure failed");
    console.log(
      JSON.stringify({
        migrations: "passed and idempotent",
        deduplication: "raw and aggregate passed",
        roleIsolation: "passed",
        physicalMutation: "passed",
        replicas: 1,
      }),
    );
  } finally {
    await Promise.all(clients.map((c) => c.close()));
    await require("../growth/clickhouse").close();
  }
}
if (require.main === module)
  verify().catch((e) => {
    console.error(
      "Growth ClickHouse verification failed:",
      e.code || "",
      e.message,
    );
    process.exitCode = 1;
  });
module.exports = { verify };
