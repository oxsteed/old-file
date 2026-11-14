"use strict";
const { withFencedJobLock } = require("./jobLockingService");
const gate = require("../growth/gate");
const { withTransaction } = require("../utils/transaction");
const { mapBounded } = require("../utils/boundedBatch");
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

// Manual rerun path for partial days: the nightly job targets only
// yesterday, so a day that finished partial was never revisited once the
// night moved on. run({ day }) recomputes any past day; run({ day, force })
// also recomputes a day that already completed. An explicit day skips the
// 03:00 UTC gate (past days hold complete data); the tracking hard-off
// gate still applies. Triggered by POST /api/admin/growth/rollups/rerun
// and the Growth Insights overview page.
// Cost audit 2026-11-13 item 9: the block used to build gate contexts
// twice per 250-row block (once for every subject, once for the eligible
// subset inside the transaction). Build once outside and reuse the
// contexts here. The reuse is safe because the advisory shared locks
// taken above serialize withdrawals/erasure that start after them, and
// runtimePolicy with lockPolicy re-reads the global policy under FOR
// SHARE, so the only gap is inputs that changed before the locks were
// taken; one batched re-read covers those, and only users whose inputs
// moved get a fresh contexts() build (usually none).
//
// The revalidation must stay exact: every input decide() reads is
// compared (global enabled/rollout, user row, consent grants, resolved
// jurisdiction). The consent derivation below mirrors gate.js
// (gate.contexts skips a granted consent whose text version is not the
// rollout's, except sale_share_optout); if that rule ever changes,
// update deriveConsents with it, or a changed consent could be missed.
function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortDeep(v)]),
    );
  }
  return value;
}
const sameJson = (a, b) =>
  JSON.stringify(sortDeep(a ?? null)) === JSON.stringify(sortDeep(b ?? null));
function deriveConsents(triples, policyVersion) {
  const out = {};
  for (const [purpose, granted, version] of triples || []) {
    if (granted && purpose !== "sale_share_optout" && version !== policyVersion)
      continue;
    out[purpose] = granted;
  }
  return out;
}
async function refreshContexts(conn, eligible, outer) {
  const eligibleUserIds = [
    ...new Set(eligible.map(({ subject }) => subject.user_id)),
  ];
  const policy = await gate.runtimePolicy(conn, { lockPolicy: true });
  const skeys = eligibleUserIds.map((id) =>
    require("../growth/identity").key("subject", id),
  );
  const { rows } = await conn.query(
    `-- growth_rollup_freshness
     WITH m(id, skey) AS (SELECT * FROM unnest($1::uuid[], $2::char(64)[]))
     SELECT u.id, u.role, u.is_active, u.is_banned, u.deleted_at, u.is_suspended,
       u.country, u.country_confirmed, u.city, u.state, u.zip_code, u.preferred_language, u.created_at,
       e.adult_confirmed, e.is_internal,
       COALESCE((SELECT jsonb_agg(jsonb_build_array(c.purpose, c.granted, h.consent_text_version))
         FROM tracking_consent_current c JOIN tracking_consents h ON h.id = c.consent_id
         WHERE c.subject_key = m.skey), '[]'::jsonb) AS consents
     FROM users u JOIN m ON m.id = u.id
     LEFT JOIN growth_subject_eligibility e ON e.user_id = u.id`,
    [eligibleUserIds, skeys],
  );
  const freshById = new Map(rows.map((r) => [r.id, r]));
  const changed = [];
  for (const id of eligibleUserIds) {
    const ctx = outer.get(id);
    if (!ctx) {
      changed.push(id);
      continue;
    }
    if (ctx.enabled !== policy.enabled) {
      changed.push(id);
      continue;
    }
    if (!sameJson(ctx.rollout, policy.rollout)) {
      changed.push(id);
      continue;
    }
    const fresh = freshById.get(id);
    if (!fresh && !ctx.user) continue;
    if (!fresh || !ctx.user) {
      changed.push(id);
      continue;
    }
    const { consents, ...userRow } = fresh;
    if (!sameJson(userRow, ctx.user)) {
      changed.push(id);
      continue;
    }
    if (
      !sameJson(
        deriveConsents(consents, policy.rollout?.policy_version),
        ctx.consents,
      )
    ) {
      changed.push(id);
      continue;
    }
    if (
      !sameJson(
        gate.resolveJurisdiction(ctx.trustedSignals, policy.rules),
        ctx.jurisdiction,
      )
    ) {
      changed.push(id);
      continue;
    }
  }
  if (!changed.length) return outer;
  const rebuilt = await gate.contexts(changed, { db: conn });
  const merged = new Map(outer);
  for (const [id, ctx] of rebuilt) merged.set(id, ctx);
  return merged;
}

async function run({ day: requestedDay, force = false } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  let day = requestedDay;
  if (day !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)) || day >= today)
      throw Object.assign(new Error("growth_rollup_day_invalid"), { status: 400 });
  } else {
    day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  }
  if (process.env.GROWTH_TRACKING_HARD_OFF !== "false")
    return { skipped: true };
  if (requestedDay === undefined && new Date().getUTCHours() < 3)
    return { skipped: true };
  return withFencedJobLock(
    "growth-nightly",
    async (fence) => {
      // The fenced run owns the job now; old running rows belong to lost leases.
      await fence.db.query("UPDATE growth_rollup_runs SET status='failed',completed_at=NOW() WHERE status='running' AND started_at<NOW()-interval '1 hour'");
      const { rows: done } = await fence.db.query(
        "SELECT id FROM growth_rollup_runs WHERE day=$1 AND status='complete'",
        [day],
      );
      if (done.length && !force) return { skipped: true, day, reason: 'already_complete' };
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
      let jobEventsCollected = false;
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
        for await (const block of result.stream()) {
          // Bound query parameter counts even if ClickHouse emits a large block.
          for (let offset=0; offset<block.length; offset+=250) {
            fence.assertActive();
            const rows = block.slice(offset,offset+250).map(raw=>raw.json());
            const { rows: subjects } = await fence.db.query(
              'SELECT subject_key,user_id FROM growth_subject_eligibility WHERE subject_key=ANY($1::char(64)[])',
              [[...new Set(rows.map(row=>row.subject_key))]]);
            const bySubject = new Map(subjects.map(row=>[row.subject_key,row]));
            const ids = [...new Set(subjects.map(row=>row.user_id))];
            const contexts = await gate.contexts(ids,{db:fence.db});
            // Notifications audit item 40: decide once per user per
            // block (batch API) instead of awaiting gate.allow per row.
            const decisions = gate.allowMany(contexts, 'activity_offers');
            const eligible = [];
            for (const row of rows) {
              const subject=bySubject.get(row.subject_key);
              const ctx=subject && contexts.get(subject.user_id);
              if (!ctx || !decisions.get(subject.user_id)?.allowed) continue;
              eligible.push({row,subject,ctx});
            }
            if (!eligible.length) continue;
            const postals = await require('../growth/geo/resolve').resolveBatch(fence.db,
              eligible.map(({ctx:{user:u}})=>({country:u.country_confirmed?u.country:null,postal_code:u.zip_code,city:u.city,state:u.state})));
            const jobIds=[...new Set(eligible.map(({row})=>row.entity_id))];
            const {rows:intents}=await fence.db.query(`SELECT DISTINCT ON(i.entity_id) i.entity_id,i.node_id,n.sensitive
              FROM entity_intents i JOIN demand_taxonomy_nodes n ON n.id=i.node_id
              WHERE i.entity_type='job' AND i.entity_id=ANY($1::text[]) AND i.superseded_at IS NULL AND n.status='active'
              ORDER BY i.entity_id,i.id DESC`,[jobIds]);
            const nodeByJob=new Map(intents.map(i=>[i.entity_id,i.sensitive?null:i.node_id]));
            const missing=jobIds.filter(id=>!nodeByJob.has(id));
            if(missing.length){
              const {rows:jobs}=await fence.db.query('SELECT id,title,description,category_id,job_type FROM jobs WHERE id=ANY($1::uuid[])',[missing]);
              // Cost audit 2026-11-04 item 6: classification ran serially,
              // one transaction per job. Batch it at bounded concurrency;
              // each classification still runs in its own transaction.
              await mapBounded(jobs, 5, async (job) => {
                const classified=await withTransaction(db,conn=>require('../growth/classify').classify(conn,{
                  entity_type:'job',entity_id:job.id,text:`${job.title} ${job.description}`,category_id:job.category_id,job_type:job.job_type
                }),'growth_classify');
                nodeByJob.set(String(job.id),classified.review?null:classified.node_id);
              });
            }
            await fence.fencedTransaction(async conn=>{
              // Sorted shared locks preserve withdrawal/erasure serialization.
              const keys=[...new Set(eligible.map(({row})=>require('../growth/identity').consentLock(row.subject_key)))].sort();
              await conn.query('SELECT pg_advisory_xact_lock_shared(hashtextextended(k,0)) FROM unnest($1::text[]) AS locks(k) ORDER BY k',[keys]);
              // Cost audit 2026-11-13 item 9: reuse the outer contexts
              // (revalidated in-transaction by refreshContexts) instead
              // of rebuilding them for the eligible subset.
              const fresh=await refreshContexts(conn, eligible, contexts);
              // Notifications audit item 40: same batch decision for the
              // revalidated in-transaction contexts; a consent withdrawn
              // between build and write still denies here because the
              // refreshed context carries the new consents.
              const freshDecisions = gate.allowMany(fresh, 'activity_offers');
              const writes=new Map();
              for(let i=0;i<eligible.length;i++){
                const {row,subject}=eligible[i], node=nodeByJob.get(row.entity_id), ctx=fresh.get(subject.user_id);
                if(!node || !ctx || !freshDecisions.get(subject.user_id)?.allowed) continue;
                const profilePostal=postals[i]||null;
                const score=Math.min(1,0.5+Math.log2(Number(row.events)+1)/10);
                const key=JSON.stringify([subject.user_id,node]);
                const prior=writes.get(key);
                if(!prior || score>prior[3]) writes.set(key,[subject.user_id,node,profilePostal,score,day]);
                if(row.event_name==='job.bid_placed'){
                  const postal=profilePostal||row.postal_ref;
                  addSupply(shared,postal,node,'helper',subject.user_id);
                  const k=key3(postal,node,'helper');
                  shared.bidCapacity.set(k,(shared.bidCapacity.get(k)||0)+Number(row.events));
                }else{
                  addDemand(shared,row.postal_ref,node,row.event_name,subject.user_id);
                  const k=key3(row.postal_ref,node,row.event_name);
                  demandEvents.set(k,(demandEvents.get(k)||0)+Number(row.events));
                }
              }
              if(writes.size){
                const params=[];
                const values=[...writes.values()].map((row,i)=>{params.push(...row);const b=i*5;return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5}::date+interval '1 day')`;}).join(',');
                await conn.query(`INSERT INTO user_interest_profiles(user_id,node_id,postal_ref,score,last_seen) VALUES ${values}
                  ON CONFLICT(user_id,node_id) DO UPDATE SET score=EXCLUDED.score,postal_ref=EXCLUDED.postal_ref,last_seen=EXCLUDED.last_seen`,params);
                profiles+=writes.size;
              }
            });
          }
        }
      }

      if (process.env.GROWTH_CLICKHOUSE_URL) jobEventsCollected = true;
      const domain = await collectDomainDay(fence.db, day, shared);
      let propensity = null;
      await fence.fencedTransaction(async (conn) => {
        // A recompute must not keep a partial run's subject sets:
        // insertSets uses ON CONFLICT DO NOTHING, so stale members would
        // survive a rerun. Clearing the day's sets first makes reruns
        // exact; for a fresh day these deletes are no-ops.
        await conn.query("DELETE FROM demand_subject_daily WHERE day=$1", [day]);
        await conn.query("DELETE FROM supply_subject_daily WHERE day=$1", [day]);
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
        "UPDATE growth_rollup_runs SET status=$3,completed_at=NOW(),counts=$2 WHERE id=$1",
        [
          run.id,
          {
            demand_cells: shared.demand.size,
            supply_cells: shared.supply.size,
            profiles,
            coverage: jobEventsCollected ? "job_events+domain_tables" : "domain_tables",
            sources: domain.sources,
            propensity,
          },
          propensity?.error ? 'partial' : 'complete',
        ],
      );
      return {
        day,
        demand_cells: shared.demand.size,
        supply_cells: shared.supply.size,
        profiles,
      };
    },
    3600,
  );
}
module.exports = { run };
