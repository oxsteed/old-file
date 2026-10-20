"use strict";
const crypto = require("crypto");
const queue = require("../queue");
const gate = require("../gate");
const { key, consentLock } = require("../identity");
const { validateEvent } = require("../events/validate");
const { withFencedJobLock } = require("../../jobs/jobLockingService");
const GROUP = "writers";
const consumer = `writer-${process.pid}`;
const timestamp = (d) =>
  new Date(d).toISOString().replace("T", " ").replace("Z", "");
async function writeBatch(
  entries,
  { conn, store, fence, db: pg = require("../../db"), allow = gate.allow } = {},
) {
  const values = [],
    ack = [];
  const decisions = new Map();
  // Pass 1: parse, gate and validate each entry. Geography (job projection
  // and centroid resolution) is deferred so pass 2 can batch those lookups
  // instead of issuing per-event queries.
  const prepared = [];
  for (const [id, fields] of entries) {
    let row;
    try {
      row = JSON.parse(fields[1]);
      if (
        !row ||
        typeof row !== "object" ||
        Array.isArray(row) ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          row.userId || "",
        ) ||
        typeof row.domain !== "boolean" ||
        !row.event
      )
        throw new Error("invalid_envelope");
    } catch {
      // No raw payloads in a DLQ: rejected records can contain personal data.
      await conn.xadd(
        "activity:dlq",
        "MAXLEN",
        "~",
        10000,
        "source_id",
        id,
        "reason",
        "invalid_envelope",
      );
      ack.push(id);
      continue;
    }
    const decisionKey = JSON.stringify([row.userId, row.trustedSignals]);
    if (!decisions.has(decisionKey))
      decisions.set(
        decisionKey,
        await allow({
          userId: row.userId,
          trustedSignals: row.trustedSignals,
          db: pg,
        }),
      );
    const permission = decisions.get(decisionKey);
    if (!permission.allowed) {
      ack.push(id);
      continue;
    }
    // Legitimate domain backlogs are retained; client time skew is checked at ingress.
    const time = Date.parse(row.event?.occurred_at);
    const event = validateEvent(row.event, { domain: row.domain, now: time });
    const ttl = permission.basis === "consent" ? 30 : 90;
    if (
      !Number.isFinite(time) ||
      time > Date.now() + 300000 ||
      time < Date.now() - ttl * 86400000
    ) {
      ack.push(id);
      continue;
    }
    if (!event) {
      ack.push(id);
      continue;
    }
    const ctx = permission.context;
    prepared.push({
      id,
      row,
      permission,
      event,
      place: {
        country: ctx.user.country_confirmed ? ctx.user.country : null,
        postal_code: ctx.user.zip_code,
        city: ctx.user.city,
        state: ctx.user.state,
      },
    });
  }
  // Pass 2a: one batched projection for every distinct job referenced by a
  // domain job event (previously one query per event).
  const jobIds = [
    ...new Set(
      prepared
        .filter(
          (p) =>
            p.row.domain &&
            p.event.name.startsWith("job.") &&
            p.event.props.job_id,
        )
        .map((p) => p.event.props.job_id)
        .filter((jobId) =>
          /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
            jobId,
          ),
        ),
    ),
  ];
  if (jobIds.length) {
    const { rows: jobs } = await pg.query(
      "SELECT id, location_zip, location_country_code, location_city, location_state FROM jobs WHERE id = ANY($1::uuid[])",
      [jobIds],
    );
    const byId = new Map(jobs.map((job) => [String(job.id), job]));
    for (const p of prepared) {
      if (
        !(
          p.row.domain &&
          p.event.name.startsWith("job.") &&
          p.event.props.job_id
        )
      )
        continue;
      const job = byId.get(String(p.event.props.job_id));
      if (job)
        p.place = {
          country: job.location_country_code,
          postal_code: job.location_zip,
          city: job.location_city,
          state: job.location_state,
        };
    }
  }
  // Pass 2b: one batched centroid resolution for the whole batch (one
  // query per resolution pass plus one alias lookup per distinct
  // (country, state), previously up to two queries per event).
  const postalRefs = await require("../geo/resolve").resolveBatch(
    pg,
    prepared.map((p) => p.place),
  );
  prepared.forEach((p, i) => {
    const { row, permission, event } = p;
    const ctx = permission.context;
    const postal = postalRefs[i];
    values.push({
      day: event.occurred_at.slice(0, 10),
      event_id: event.event_id,
      occurred_at: timestamp(event.occurred_at),
      received_at: timestamp(Date.now()),
      event_name: event.name,
      schema_ver: 1,
      subject_key: ctx.subjectKey,
      device_key: "",
      session_key: row.session ? key("session", row.session) : "",
      role: require("../roles").canonicalRole(ctx.user.role),
      surface: row.surface,
      app_version: row.app_version,
      locale: row.locale,
      country: ctx.user.country_confirmed ? ctx.user.country : "",
      postal_ref: postal,
      jurisdiction: permission.jurisdiction,
      basis: permission.basis,
      route: event.props.route || "",
      element_key: event.props.element_key || "",
      entity_type:
        event.props.entity_type || (event.name.startsWith("job.") ? "job" : ""),
      entity_id: event.props.entity_id || event.props.job_id || "",
      props: JSON.stringify(event.props),
      is_bot: Boolean(row.is_bot),
      is_internal: false,
    });
    ack.push(p.id);
  });
  fence?.assertActive();
  if (values.length)
    await store.insert({
      table: "growth.activity_events",
      values,
      format: "JSONEachRow",
      clickhouse_settings: {
        insert_deduplication_token: crypto
          .createHash("sha256")
          .update(ack.join(","))
          .digest("hex"),
      },
    });
  fence?.assertActive();
  if (ack.length) {
    // ACK only after insert. A crash here replays identical event ids; both
    // raw FINAL reads and aggregate distinct states remain idempotent.
    const pipe = conn.multi();
    pipe.xack(queue.STREAM, GROUP, ...ack);
    pipe.xdel(queue.STREAM, ...ack);
    const acked = new Set(ack);
    for (const [id, fields] of entries)
      if (acked.has(id))
        try {
          pipe.srem?.(
            `activity:subject:${key("subject", JSON.parse(fields[1]).userId)}`,
            id,
          );
        } catch {}
    await pipe.exec();
  }
  return { stored: values.length, discarded: ack.length - values.length };
}
async function run() {
  if (process.env.GROWTH_TRACKING_HARD_OFF !== "false")
    return { skipped: true };
  return withFencedJobLock(
    "growth-clickhouse-writer",
    async (fence) => {
      const conn = await queue.ready();
      try {
        await conn.xgroup("CREATE", queue.STREAM, GROUP, "0", "MKSTREAM");
      } catch (e) {
        if (!e.message.includes("BUSYGROUP")) throw e;
      }
      const pending = await conn.xautoclaim(
        queue.STREAM,
        GROUP,
        consumer,
        60000,
        "0-0",
        "COUNT",
        20000,
      );
      let entries = pending[1];
      if (!entries.length)
        entries =
          (
            await conn.xreadgroup(
              "GROUP",
              GROUP,
              consumer,
              "COUNT",
              20000,
              "STREAMS",
              queue.STREAM,
              ">",
            )
          )?.[0]?.[1] || [];
      return fence.fencedTransaction(async (pg) => {
        // Sort the shared locks to avoid deadlocks across writers. Consent
        // withdrawal takes the matching exclusive lock and queues erasure only
        // after any in-flight insert has completed.
        const subjects = [
          ...new Set(
            entries.flatMap(([, fields]) => {
              try {
                return [
                  consentLock(key("subject", JSON.parse(fields[1]).userId)),
                ];
              } catch {
                return [];
              }
            }),
          ),
        ].sort();
        if (subjects.length)
          await pg.query(
            "SELECT pg_advisory_xact_lock_shared(hashtextextended(name,0)) FROM unnest($1::text[]) AS locks(name)",
            [subjects],
          );
        const actors = new Set(),
          signals = new Map();
        for (const [, fields] of entries)
          try {
            const row = JSON.parse(fields[1]);
            if (!/^[a-f0-9-]{36}$/i.test(row?.userId || "")) continue;
            actors.add(row.userId);
            signals.set(row.userId, [
              ...new Set([
                ...(signals.get(row.userId) || []),
                ...(row.trustedSignals || []),
              ]),
            ]);
          } catch {}
        const contexts = await gate.contexts([...actors], {
          db: pg,
          trustedSignals: signals,
          lockPolicy: true,
        });
        return writeBatch(entries, {
          conn,
          store: require("../clickhouse").getClient("writer"),
          fence,
          db: pg,
          allow: (input) => gate.allow(contexts.get(input.userId)),
        });
      });
    },
    120,
  );
}
module.exports = { run, writeBatch };
