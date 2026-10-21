"use strict";
const { withFencedJobLock } = require("./jobLockingService");
const gate = require("../growth/gate");
const db = require("../db");

// Bounded, aggregate-only audit. It re-evaluates the current fail-closed gate
// for subjects that emitted events in the seven-day window and stores counts,
// never raw event payloads. Historical consent evidence is retained in the
// append-only ledger; this job is the operational zero-violation signal.
async function run() {
  if (process.env.GROWTH_TRACKING_HARD_OFF !== "false" || !process.env.GROWTH_CLICKHOUSE_URL)
    return { skipped: true };
  return withFencedJobLock("growth-consent-audit", async (fence) => {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 86400000);
    const store = require("../growth/clickhouse").getClient("rights");
    const result = await store.query({
      query: `SELECT subject_key,count() AS events
        FROM growth.activity_events
       WHERE day >= {start:Date} AND day <= {end:Date}
       GROUP BY subject_key
       LIMIT 10000`,
      query_params: {
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
      },
      format: "JSONEachRow",
    });
    let subjects = 0;
    let events = 0;
    let violations = 0;
    for await (const block of result.stream()) {
      for (const raw of block) {
        fence.assertActive();
        const row = raw.json();
        events += Number(row.events || 0);
        const { rows } = await fence.db.query(
          "SELECT user_id FROM growth_subject_eligibility WHERE subject_key=$1",
          [row.subject_key],
        );
        subjects++;
        if (!rows[0]) {
          violations++;
          continue;
        }
        const permission = await gate.allow({ userId: rows[0].user_id });
        if (!permission.allowed) violations++;
      }
    }
    await fence.db.query(
      `INSERT INTO growth_consent_audit_runs
       (window_start,window_end,subjects_checked,events_checked,violations,status,evidence)
       VALUES($1,$2,$3,$4,$5,'complete',$6::jsonb)`,
      [start, end, subjects, events, violations, JSON.stringify({ bounded_subject_limit: 10000 })],
    );
    return { subjects_checked: subjects, events_checked: events, violations };
  }, 300);
}
module.exports = { run };
