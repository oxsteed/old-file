"use strict";
const { withFencedJobLock } = require("./jobLockingService");
const gate = require("../growth/gate");
const { withTransaction } = require("../utils/transaction");
const db = require("../db");
const {
  collectDomainDay,
  addDemand,
  addSupply,
  key3,
} = require("../growth/rollups/domain");

// Chunked insert of one day's subject sets. The sets (migration 939) are
// the source behind the k-suppressed counts: exact distinct windows are
// computed from them, never by summing daily counts.
async function insertSets(conn, table, thirdColumn, map, day) {
  const rows = [];
  for (const [k, set] of map) {
    const [postal, node, third] = k.split("|");
    for (const user of set)
      rows.push([day, Number(postal), Number(node), third, user]);
  }
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const params = [];
    const values = chunk
      .map((r, j) => {
        params.push(...r);
        const b = j * 5;
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`;
      })
      .join(",");
    await conn.query(
      `INSERT INTO ${table}(day,postal_ref,node_id,${thirdColumn},user_id) VALUES ${values} ON CONFLICT DO NOTHING`,
      params,
    );
  }
  return rows.length;
}

async function run() {
  if (
    process.env.GROWTH_TRACKING_HARD_OFF !== "false" ||
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
      // Shared subject sets: ClickHouse job events plus Postgres domain
      // signals (growth/rollups/domain.js) land in the same maps.
      const shared = {
        demand: new Map(),
        supply: new Map(),
        bidCapacity: new Map(),
        sources: {},
      };
      const demandEvents = new Map(); // true event counts, event path only
      let profiles = 0;
      if (process.env.GROWTH_CLICKHOUSE_URL) {
        const client = require("../growth/clickhouse").getClient("nightly");
        const result = await client.query({
          query: `SELECT subject_key,postal_ref,event_name,entity_type,entity_id,uniqExact(event_id) AS events
      FROM growth.activity_events FINAL WHERE day={day:Date} AND NOT is_bot AND NOT is_internal
      AND postal_ref>0 AND entity_type='job' AND event_name IN ('job.posted','job.published','job.bid_placed','job.completed')
      GROUP BY subject_key,postal_ref,event_name,entity_type,entity_id`,
          query_params: { day },
          format: "JSONEachRow",
        });
        const nodeCache = new Map();
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
            if (row.event_name === "job.bid_placed") {
              // Supply is attributed to the provider's own postal
              // reference, not the job's location (spec 10.1 fix).
              const postal = profilePostal || row.postal_ref;
              addSupply(shared, postal, node, "helper", subject.user_id);
              const k = key3(postal, node, "helper");
              shared.bidCapacity.set(
                k,
                (shared.bidCapacity.get(k) || 0) + Number(row.events),
              );
            } else {
              addDemand(
                shared,
                row.postal_ref,
                node,
                row.event_name,
                subject.user_id,
              );
              const k = key3(row.postal_ref, node, row.event_name);
              demandEvents.set(
                k,
                (demandEvents.get(k) || 0) + Number(row.events),
              );
            }
          }
      }
      const domain = await collectDomainDay(fence.db, day, shared);
      let propensity = null;
      await fence.fencedTransaction(async (conn) => {
        await insertSets(conn, "demand_subject_daily", "signal_type", shared.demand, day);
        await insertSets(conn, "supply_subject_daily", "role", shared.supply, day);
        await conn.query("DELETE FROM demand_daily WHERE day=$1", [day]);
        await conn.query("DELETE FROM supply_daily WHERE day=$1", [day]);
        for (const [k, set] of shared.demand)
          if (set.size >= 5) {
            const [postal, node, signal] = k.split("|");
            await conn.query(
              "INSERT INTO demand_daily(day,postal_ref,node_id,signal_type,subjects,events) VALUES($1,$2,$3,$4,$5,$6)",
              [
                day,
                Number(postal),
                Number(node),
                signal,
                set.size,
                // Domain signals record one event per person per signal;
                // event-path signals keep their true event counts.
                demandEvents.get(k) || set.size,
              ],
            );
          }
        for (const [k, set] of shared.supply)
          if (set.size >= 5) {
            const [postal, node, role] = k.split("|");
            await conn.query(
              `INSERT INTO supply_daily(day,postal_ref,node_id,role,providers,capacity)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(day,postal_ref,node_id,role) DO UPDATE SET providers=EXCLUDED.providers,capacity=EXCLUDED.capacity`,
              [
                day,
                Number(postal),
                Number(node),
                role,
                set.size,
                shared.bidCapacity.get(k) || set.size,
              ],
            );
          }
        // Spec 19 anomaly check: a cell (postal x intent, all signals)
        // whose distinct demand people in the last 7 days are more than
        // 5x the prior 7 days is flagged for review.
        await conn.query(
          `INSERT INTO growth_anomaly_flags(day,postal_ref,node_id,subjects_current,subjects_prior,ratio)
           SELECT $1::date,postal_ref,node_id,cur,prior,cur::numeric/prior FROM (
             SELECT postal_ref,node_id,
               COUNT(DISTINCT user_id) FILTER (WHERE day>$1::date-7 AND day<=$1::date)::int AS cur,
               COUNT(DISTINCT user_id) FILTER (WHERE day>$1::date-14 AND day<=$1::date-7)::int AS prior
             FROM demand_subject_daily
             WHERE day>$1::date-14 AND day<=$1::date GROUP BY postal_ref,node_id
           ) t WHERE prior>=1 AND cur>=5 AND cur>5*prior
           ON CONFLICT(day,postal_ref,node_id) DO UPDATE SET
             subjects_current=EXCLUDED.subjects_current,subjects_prior=EXCLUDED.subjects_prior,ratio=EXCLUDED.ratio`,
          [day],
        );
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
          "DELETE FROM demand_subject_daily WHERE day<CURRENT_DATE-interval '5 years'",
        );
        await conn.query(
          "DELETE FROM supply_subject_daily WHERE day<CURRENT_DATE-interval '5 years'",
        );
        await conn.query(
          "DELETE FROM growth_anomaly_flags WHERE day<CURRENT_DATE-interval '1 year'",
        );
      });
      try {
        propensity = await require("../growth/propensity").computeAll(fence.db);
      } catch (err) {
        propensity = { error: err.code || err.message || "unknown" };
      }
      await fence.db.query(
        "UPDATE growth_rollup_runs SET status='complete',completed_at=NOW(),counts=$2 WHERE id=$1",
        [
          run.id,
          {
            demand_cells: shared.demand.size,
            supply_cells: shared.supply.size,
            profiles,
            coverage: "job_events+domain_tables",
            sources: domain.sources,
            propensity,
          },
        ],
      );
      return {
        demand_cells: shared.demand.size,
        supply_cells: shared.supply.size,
        profiles,
      };
    },
    3600,
  );
}
module.exports = { run };
