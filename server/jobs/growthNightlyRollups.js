"use strict";
const { withFencedJobLock } = require("./jobLockingService");
const gate = require("../growth/gate");
const { withTransaction } = require("../utils/transaction");
const db = require("../db");
async function run() {
  if (
    process.env.GROWTH_TRACKING_HARD_OFF !== "false" ||
    !process.env.GROWTH_CLICKHOUSE_URL ||
    new Date().getUTCHours() < 3
  )
    return { skipped: true };
  return withFencedJobLock(
    "growth-nightly",
    async (fence) => {
      const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const { rows: done } = await fence.db.query(
        "SELECT id FROM growth_rollup_runs WHERE day=$1 AND status='complete'",
        [day],
      );
      if (done.length) return { skipped: true };
      const {
        rows: [run],
      } = await fence.db.query(
        "INSERT INTO growth_rollup_runs(day,status) VALUES($1,'running') RETURNING id",
        [day],
      );
      const client = require("../growth/clickhouse").getClient("nightly");
      const result = await client.query({
        query: `SELECT subject_key,postal_ref,event_name,entity_type,entity_id,uniqExact(event_id) AS events
      FROM growth.activity_events FINAL WHERE day={day:Date} AND NOT is_bot AND NOT is_internal
      AND postal_ref>0 AND entity_type='job' AND event_name IN ('job.posted','job.published','job.bid_placed','job.completed')
      GROUP BY subject_key,postal_ref,event_name,entity_type,entity_id`,
        query_params: { day },
        format: "JSONEachRow",
      });
      const cells = new Map(),
        nodeCache = new Map();
      let profiles = 0;
      for await (const block of result.stream())
        for (const raw of block) {
          fence.assertActive();
          const row = raw.json();
          const {
            rows: [subject],
          } = await fence.db.query(
            "SELECT user_id FROM growth_subject_eligibility WHERE subject_key=$1",
            [row.subject_key],
          );
          if (!subject) continue;
          const permission = await gate.allow(
            { userId: subject.user_id },
            "activity_offers",
          );
          if (!permission.allowed) continue;
          const u = permission.context.user;
          const profilePostal = await require("../growth/geo/resolve").resolve(
            fence.db,
            {
              country: u.country_confirmed ? u.country : null,
              postal_code: u.zip_code,
              city: u.city,
              state: u.state,
            },
          );
          let node = nodeCache.get(row.entity_id);
          if (node === undefined) {
            const {
              rows: [existing],
            } = await fence.db.query(
              `SELECT i.node_id,n.sensitive FROM entity_intents i JOIN demand_taxonomy_nodes n ON n.id=i.node_id
          WHERE i.entity_type='job' AND i.entity_id=$1 AND i.superseded_at IS NULL AND n.status='active' ORDER BY i.id DESC LIMIT 1`,
              [row.entity_id],
            );
            if (existing) node = existing.sensitive ? null : existing.node_id;
            else {
              const {
                rows: [job],
              } = await fence.db.query(
                "SELECT title,description,category_id,job_type FROM jobs WHERE id=$1",
                [row.entity_id],
              );
              if (job) {
                const classified = await withTransaction(
                  db,
                  (conn) =>
                    require("../growth/classify").classify(conn, {
                      entity_type: "job",
                      entity_id: row.entity_id,
                      text: `${job.title} ${job.description}`,
                      category_id: job.category_id,
                      job_type: job.job_type,
                    }),
                  "growth_classify",
                );
                node = classified.review ? null : classified.node_id;
              }
            }
            nodeCache.set(row.entity_id, node || null);
          }
          if (!node) continue;
          await fence.fencedTransaction(async (conn) => {
            await conn.query(
              "SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",
              [require("../growth/identity").consentLock(row.subject_key)],
            );
            if (
              !(
                await gate.allow(
                  { userId: subject.user_id, db: conn },
                  "activity_offers",
                )
              ).allowed
            )
              return;
            await conn.query(
              `INSERT INTO user_interest_profiles(user_id,node_id,postal_ref,score,last_seen)
          VALUES($1,$2,$3,$4,$5::date+interval '1 day') ON CONFLICT(user_id,node_id) DO UPDATE SET
          score=EXCLUDED.score,postal_ref=EXCLUDED.postal_ref,last_seen=EXCLUDED.last_seen`,
              [
                subject.user_id,
                node,
                profilePostal || null,
                Math.min(1, 0.5 + Math.log2(Number(row.events) + 1) / 10),
                day,
              ],
            );
            profiles++;
          });
          const key = `${row.postal_ref}:${node}:${row.event_name}`,
            cell = cells.get(key) || {
              postal: row.postal_ref,
              node,
              signal: row.event_name,
              subjects: new Set(),
              events: 0,
            };
          cell.subjects.add(row.subject_key);
          cell.events += Number(row.events);
          cells.set(key, cell);
        }
      await fence.fencedTransaction(async (conn) => {
        await conn.query("DELETE FROM demand_daily WHERE day=$1", [day]);
        await conn.query("DELETE FROM supply_daily WHERE day=$1", [day]);
        for (const cell of cells.values())
          if (cell.subjects.size >= 5) {
            if (cell.signal === "job.bid_placed")
              await conn.query(
                `INSERT INTO supply_daily(day,postal_ref,node_id,role,providers,capacity)
          VALUES($1,$2,$3,'helper',$4,$5) ON CONFLICT(day,postal_ref,node_id,role) DO UPDATE SET providers=EXCLUDED.providers,capacity=EXCLUDED.capacity`,
                [day, cell.postal, cell.node, cell.subjects.size, cell.events],
              );
            else
              await conn.query(
                "INSERT INTO demand_daily(day,postal_ref,node_id,signal_type,subjects,events) VALUES($1,$2,$3,$4,$5,$6)",
                [
                  day,
                  cell.postal,
                  cell.node,
                  cell.signal,
                  cell.subjects.size,
                  cell.events,
                ],
              );
          }
        await conn.query(
          "DELETE FROM user_interest_profiles WHERE last_seen<NOW()-interval '12 months'",
        );
        await conn.query(
          "DELETE FROM demand_daily WHERE day<CURRENT_DATE-interval '5 years'",
        );
        await conn.query(
          "DELETE FROM supply_daily WHERE day<CURRENT_DATE-interval '5 years'",
        );
        await conn.query(
          "UPDATE growth_rollup_runs SET status='complete',completed_at=NOW(),counts=$2 WHERE id=$1",
          [
            run.id,
            { cells: cells.size, profiles, coverage: "job_events_only" },
          ],
        );
      });
      return { cells: cells.size, profiles };
    },
    3600,
  );
}
module.exports = { run };
