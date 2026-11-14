import { useEffect, useState } from "react";
import adminApi from "../../../lib/adminApi";

export const STATUSES = ["open", "snoozed", "acknowledged", "resolved"];
export const ACTIONS = { open: ["snooze", "acknowledge", "resolve"], snoozed: ["unsnooze", "acknowledge", "resolve"], acknowledged: ["resolve"], resolved: [] };

export function Evidence({ a, copy }) {
  const e = a.evidence || {};
  if (a.kind === "new_country_login")
    return <p>{copy("anomalies.evidence.country", { country: e.country, previous: (e.previousCountries || []).join(", ") || "—" })}</p>;
  if (a.kind === "refund_spike")
    return <p>{copy("anomalies.evidence.refunds", { count: e.refunds7d, baseline: e.baselineWeekly })}</p>;
  return <p>{copy("anomalies.evidence.payouts", { count: e.failures7d })}</p>;
}

// Upgrade 4: bundled anomalies with snooze / acknowledge / resolve, and a
// platform-wide watch that reuses the Customer 360 alert worker.
export default function Anomalies({ api, copy, when, viewerKey }) {
  const [statuses, setStatuses] = useState(["open", "snoozed", "acknowledged"]);
  const [rows, setRows] = useState([]);
  const [kinds, setKinds] = useState([]);
  const [watches, setWatches] = useState([]);
  const [state, setState] = useState("loading");
  const [pending, setPending] = useState(null);
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [notice, setNotice] = useState("");
  // Domain 1 #15: busy guard mirroring AnomalyQueue, so a double-click on
  // the action submit cannot double-POST the same snooze/acknowledge/resolve.
  const [busy, setBusy] = useState(false);
  const load = async (signal) => {
    const [a, w] = await Promise.all([
      adminApi.get(`${api}/anomalies`, { signal, params: { status: statuses.join(",") } }),
      adminApi.get(`/admin/customer360/anomaly-watches`, { signal }),
    ]);
    setRows(a.data.anomalies);
    setKinds(a.data.kinds);
    setWatches(w.data.watches);
  };
  // Domain 1 #13: the load is re-runnable so the error branch can offer a
  // retry instead of relying on toggling a status filter to re-fetch.
  const reload = async (signal) => {
    setState("loading");
    try {
      await load(signal);
      if (!signal?.aborted) setState("ready");
    } catch {
      if (!signal?.aborted) setState("error");
    }
  };
  useEffect(() => {
    const c = new AbortController();
    reload(c.signal);
    return () => c.abort();
  }, [api, viewerKey, statuses.join()]);
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await adminApi.post(`${api}/anomalies/${pending.anomaly.id}/${pending.action}`, {
        reason,
        revision: pending.anomaly.revision,
        until: pending.action === "snooze" ? new Date(until).toISOString() : undefined,
      });
      setPending(null);
      setReason("");
      setUntil("");
      setNotice(copy("saved"));
      await load();
    } catch (err) {
      setNotice(copy(err.response?.data?.code === "revision_conflict" ? "conflict" : "actionFailed"));
    } finally {
      setBusy(false);
    }
  };
  const watch = async (source, enabled) => {
    try {
      await adminApi.put(`/admin/customer360/anomaly-watches`, { source, enabled, minAgeMinutes: 0 });
      setWatches((await adminApi.get(`/admin/customer360/anomaly-watches`)).data.watches);
      setNotice(copy("saved"));
    } catch {
      setNotice(copy("actionFailed"));
    }
  };
  const watchSources = [
    ...(kinds.includes("refund_spike") ? ["anomaliesFinancial"] : []),
    ...(kinds.includes("new_country_login") ? ["anomaliesSecurity"] : []),
  ];
  return (
    <article className="c360u" data-panel="anomalies">
      <h3>{copy("anomalies.title")}</h3>
      <p>{copy("anomalies.hint")}</p>
      {notice && <p role="status">{notice}</p>}
      <fieldset className="c360u-row">
        <legend>{copy("anomalies.show")}</legend>
        {STATUSES.map((s) => (
          <label key={s} className="c360u-check">
            <input
              type="checkbox"
              checked={statuses.includes(s)}
              onChange={(e) => setStatuses(e.target.checked ? [...statuses, s] : statuses.filter((x) => x !== s).length ? statuses.filter((x) => x !== s) : statuses)}
            />
            {copy(`anomalies.statuses.${s}`)}
          </label>
        ))}
      </fieldset>
      {state === "loading" && <p role="status">{copy("loading")}</p>}
      {state === "error" && (
        <p role="alert">
          {copy("loadFailed")}{" "}
          <button type="button" onClick={() => reload()}>{copy("retry")}</button>
        </p>
      )}
      {state === "ready" && !kinds.length && <p>{copy("anomalies.noAccess")}</p>}
      {state === "ready" && kinds.length > 0 && !rows.length && <p>{copy("anomalies.empty")}</p>}
      <ul className="c360u-events">
        {rows.map((a) => (
          <li key={a.id} data-anomaly={a.kind}>
            <strong>{copy(`anomalies.kinds.${a.kind}`)}</strong>
            <span>
              {copy(`anomalies.statuses.${a.status}`)} · {copy("anomalies.occurrences", { count: a.occurrences })}
              {a.snoozed_until ? ` · ${copy("anomalies.snoozedUntil", { time: when(a.snoozed_until) })}` : ""}
            </span>
            <span>{copy("anomalies.detected", { first: when(a.first_detected_at), last: when(a.last_detected_at) })}</span>
            <Evidence a={a} copy={copy} />
            <div className="c360u-row">
              {ACTIONS[a.status].map((action) => (
                <button key={action} type="button" disabled={busy} onClick={() => { setPending({ anomaly: a, action }); setReason(""); }}>
                  {copy(`anomalies.actions.${action}`)}
                </button>
              ))}
            </div>
            {pending?.anomaly.id === a.id && (
              <form className="c360u-reply" onSubmit={submit}>
                {pending.action === "snooze" && (
                  <label>
                    {copy("anomalies.until")}
                    <input type="datetime-local" required value={until} onChange={(e) => setUntil(e.target.value)} />
                  </label>
                )}
                <label>
                  {copy("anomalies.reason")}
                  <textarea required minLength={3} maxLength={500} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                </label>
                <div className="c360u-row">
                  <button type="submit" disabled={busy}>{copy(`anomalies.actions.${pending.action}`)}</button>
                  <button type="button" onClick={() => setPending(null)}>{copy("anomalies.cancel")}</button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>
      {watchSources.length > 0 && (
        <section>
          <h4>{copy("anomalies.watchTitle")}</h4>
          <p>{copy("anomalies.watchHint")}</p>
          {watchSources.map((source) => {
            const on = watches.some((w) => w.source === source && w.enabled);
            return (
              <label key={source} className="c360u-check">
                <input type="checkbox" checked={on} onChange={(e) => watch(source, e.target.checked)} />
                {copy(`anomalies.watch.${source}`)}
              </label>
            );
          })}
        </section>
      )}
    </article>
  );
}
