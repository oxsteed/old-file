import { useEffect, useState } from "react";
import adminApi from "../../../lib/adminApi";

const STATES = ["healthy", "disabled", "not_started", "failing", "behind"];

/**
 * Gap fill 8: whether CUSTOMER360_UPGRADES_ENABLED is on, how far the
 * summary rebuild is behind, and each background task's last run (from
 * the heartbeat table, so every API instance sees the same view).
 */
export default function SummaryHealth({ copy, when }) {
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const load = async (signal) => {
    const r = await adminApi.get(`/admin/customer360/summaries/health`, { signal });
    setData(r.data);
  };
  useEffect(() => {
    const c = new AbortController();
    load(c.signal).then(() => !c.signal.aborted && setState("ready")).catch(() => !c.signal.aborted && setState("error"));
    return () => c.abort();
  }, []);
  const refresh = () => {
    setState("loading");
    load().then(() => setState("ready")).catch(() => setState("error"));
  };
  const n = (v) => (v == null ? "—" : Number(v).toLocaleString());
  const capped = (c) => (c.capped ? copy("summaryHealth.atLeast", { count: n(c.count) }) : n(c.count));
  const seconds = (s) => (s == null ? "—" : s < 3600 ? copy("queues.minutes", { count: Math.max(1, Math.round(s / 60)) }) : copy("summaryHealth.hours", { count: Math.round(s / 3600) }));
  return (
    <article className="c360u" data-panel="summary-health">
      <h3>{copy("summaryHealth.title")}</h3>
      <p className="c360w-note">{copy("summaryHealth.hint")}</p>
      {state === "loading" && <p role="status">{copy("loading")}</p>}
      {state === "error" && <p role="alert">{copy("loadFailed")}</p>}
      {data && (
        <>
          <p data-health={data.state} className={data.state === "healthy" ? undefined : "c360u-flag"} role="status">
            <strong>{copy(`summaryHealth.states.${STATES.includes(data.state) ? data.state : "behind"}`)}</strong>
            {" · "}{copy(data.enabled ? "summaryHealth.enabled" : "summaryHealth.disabledFlag", { flag: "CUSTOMER360_UPGRADES_ENABLED" })}
          </p>
          <dl className="c360w-grid">
            <div><dt>{copy("summaryHealth.modelVersion")}</dt><dd dir="ltr">{data.modelVersion}</dd></div>
            <div><dt>{copy("summaryHealth.ttl")}</dt><dd>{copy("summaryHealth.hours", { count: data.ttlHours })}</dd></div>
            <div><dt>{copy("summaryHealth.rows")}</dt><dd>{n(data.estimatedRows)}</dd></div>
            <div><dt>{copy("summaryHealth.dirty")}</dt><dd>{n(data.dirty)}</dd></div>
            <div><dt>{copy("summaryHealth.oldestDirty")}</dt><dd>{seconds(data.oldestDirtySeconds)}</dd></div>
            <div><dt>{copy("summaryHealth.stale")}</dt><dd>{capped(data.stale)}</dd></div>
            <div><dt>{copy("summaryHealth.outdatedModel")}</dt><dd>{capped(data.outdatedModel)}</dd></div>
            <div><dt>{copy("summaryHealth.eventLag")}</dt><dd>{n(data.events?.lag)}</dd></div>
          </dl>
          <div className="c360u-scroll">
            <table data-table="workers">
              <caption>{copy("summaryHealth.workers")}</caption>
              <thead>
                <tr>
                  <th scope="col">{copy("summaryHealth.task")}</th>
                  <th scope="col">{copy("summaryHealth.status")}</th>
                  <th scope="col">{copy("summaryHealth.lastOk")}</th>
                  <th scope="col">{copy("summaryHealth.lastError")}</th>
                  <th scope="col">{copy("summaryHealth.failures")}</th>
                </tr>
              </thead>
              <tbody>
                {!data.workers.length && <tr><td colSpan={5}>{copy("summaryHealth.noWorkers")}</td></tr>}
                {data.workers.map((w) => (
                  <tr key={w.task} data-worker={w.task} data-status={w.status}>
                    <th scope="row"><bdi dir="ltr">{w.task}</bdi></th>
                    <td>{copy(`summaryHealth.workerStates.${w.status}`)}</td>
                    <td>{w.last_ok_at ? when(w.last_ok_at) : "—"}</td>
                    <td>{w.last_error_at ? <>{when(w.last_error_at)} · <bdi dir="ltr">{w.last_error_code || "error"}</bdi></> : "—"}</td>
                    <td>{n(w.consecutive_failures)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="c360w-note">{copy("summaryHealth.checked", { time: when(data.checkedAt) })}</p>
          <button type="button" onClick={refresh}>{copy("summaryHealth.refresh")}</button>
        </>
      )}
    </article>
  );
}
