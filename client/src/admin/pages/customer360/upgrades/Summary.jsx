import { useEffect, useState } from "react";
import adminApi from "../../../lib/adminApi";

const REFRESHING = ["dirty", "stale", "outdated_model"];

// Upgrade 12: precomputed per-customer summary with an explicit freshness state.
// The server never blocks a read on a recompute (except the very first one), so
// the badge tells the admin how current these numbers are.
export default function Summary({ api, copy, when, viewerKey, onArea }) {
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setState("loading");
    adminApi.get(`${api}/summary`, { signal: c.signal })
      .then((r) => { if (!c.signal.aborted) { setData(r.data); setState("ready"); } })
      .catch(() => !c.signal.aborted && setState("error"));
    return () => c.abort();
  }, [api, viewerKey]);
  const recompute = async () => {
    setBusy(true);
    setNotice("");
    try {
      setData((await adminApi.post(`${api}/summary/recompute`, {})).data);
      setNotice(copy("summary.recomputed"));
    } catch {
      setNotice(copy("actionFailed"));
    } finally {
      setBusy(false);
    }
  };
  const st = data?.staleness;
  const anomalyTotal = data ? Object.values(data.anomalies || {}).reduce((n, v) => n + v, 0) : 0;
  const queueTotals = data ? Object.values(data.queues || {}).reduce((t, q) => ({ open: t.open + q.open, breached: t.breached + q.breached }), { open: 0, breached: 0 }) : null;
  return (
    <article className="c360u" data-panel="summary">
      <h3>{copy("summary.title")}</h3>
      <p className="c360w-note">{copy("summary.hint")}</p>
      {state === "loading" && <p role="status">{copy("loading")}</p>}
      {state === "error" && <p role="alert">{copy("loadFailed")}</p>}
      {data && st && (
        <>
          <p className="c360u-staleness" data-staleness={st.state} role="status">
            <strong>{copy(`summary.states.${st.state}`)}</strong>{" "}
            {st.computedAt && copy(`summary.stateDetail.${st.state}`, { time: when(st.computedAt), hours: st.ttlHours })}
            {REFRESHING.includes(st.state) && <> {copy("summary.queued")}</>}
          </p>
          <p className="c360w-meta">
            {data.computeMs != null && copy("summary.computedIn", { ms: data.computeMs })}
            {data.incomplete && <> · <span className="c360u-flag">{copy("summary.incomplete")}</span></>}
          </p>
          <button type="button" disabled={busy} onClick={recompute}>{copy("summary.recompute")}</button>
          {notice && <p role="status">{notice}</p>}
          <div className="c360u-cards">
            <section className="c360u-card" data-summary="lifecycle">
              <h4>{copy("summary.lifecycle")}</h4>
              <p>{data.lifecycle?.stage ? copy(`lifecycle.stages.${data.lifecycle.stage}`, { defaultValue: data.lifecycle.stage }) : copy("summary.none")}</p>
            </section>
            <section className="c360u-card" data-summary="health" data-band={data.health?.churnBand || undefined}>
              <h4>{copy("summary.churn")}</h4>
              <p>{data.health?.churnBand ? copy(`health.bands.${data.health.churnBand}`) : copy("summary.none")}</p>
            </section>
            <section className="c360u-card" data-summary="events">
              <h4>{copy("summary.events")}</h4>
              <p>{data.events?.n ? copy("summary.eventsValue", { count: data.events.n, time: when(data.events.lastAt) }) : copy("summary.none")}</p>
            </section>
            <section className="c360u-card" data-summary="anomalies">
              <h4>{copy("summary.anomalies")}</h4>
              <p>{anomalyTotal}</p>
            </section>
            <section className="c360u-card" data-summary="queues">
              <h4>{copy("summary.queues")}</h4>
              <p>{copy("summary.queueValue", { open: queueTotals.open, breached: queueTotals.breached })}</p>
            </section>
          </div>
          {data.areas.length === 0 ? (
            <p>{copy("summary.empty")}</p>
          ) : (
            <table className="c360u-table">
              <caption className="c360u-sr">{copy("summary.caption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{copy("summary.area")}</th>
                  <th scope="col">{copy("summary.records")}</th>
                  <th scope="col">{copy("summary.last30")}</th>
                  <th scope="col">{copy("summary.lastActivity")}</th>
                </tr>
              </thead>
              <tbody>
                {data.areas.map((a) => (
                  <tr key={a.area} data-area={a.area}>
                    <th scope="row">
                      <button type="button" className="c360u-link" onClick={() => onArea?.(a.area)}>{copy(`areas.${a.area}`, { defaultValue: a.area })}</button>
                    </th>
                    <td>{a.count}</td>
                    <td>{a.last30}</td>
                    <td>{a.lastAt ? when(a.lastAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </article>
  );
}
