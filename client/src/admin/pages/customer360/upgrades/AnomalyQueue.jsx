import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import adminApi from "../../../lib/adminApi";
import { ACTIONS, Evidence, STATUSES } from "./Anomalies";

/**
 * Gap fill 7: every customer's anomalies in one list
 * (GET /admin/customer360/anomalies). The server returns only the kinds
 * this admin may see, pages with `nextBefore`, and audits each read.
 * Actions go through the customer's own anomaly route, so the reason and
 * revision checks match the customer workspace.
 */
export default function AnomalyQueue({ copy, when }) {
  const [status, setStatus] = useState("open");
  const [rows, setRows] = useState([]);
  const [kinds, setKinds] = useState([]);
  const [next, setNext] = useState(null);
  const [state, setState] = useState("loading");
  const [pending, setPending] = useState(null);
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async ({ before = null, signal } = {}) => {
    const r = await adminApi.get(`/admin/customer360/anomalies`, { signal, params: before ? { status, before } : { status } });
    setRows((prev) => (before ? [...prev, ...r.data.anomalies] : r.data.anomalies));
    setKinds(r.data.kinds);
    setNext(r.data.nextBefore);
  };
  useEffect(() => {
    const c = new AbortController();
    setState("loading");
    setPending(null);
    load({ signal: c.signal }).then(() => !c.signal.aborted && setState("ready")).catch(() => !c.signal.aborted && setState("error"));
    return () => c.abort();
  }, [status]);

  const more = async () => {
    setBusy(true);
    try {
      await load({ before: next });
    } catch {
      setNotice(copy("loadFailed"));
    } finally {
      setBusy(false);
    }
  };
  const submit = async (e) => {
    e.preventDefault();
    setNotice("");
    setBusy(true);
    const a = pending.anomaly;
    try {
      await adminApi.post(`/admin/users/${encodeURIComponent(a.customer_id)}/workspace/anomalies/${encodeURIComponent(a.id)}/${pending.action}`, {
        reason,
        revision: a.revision,
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

  return (
    <article className="c360u" data-panel="anomaly-queue">
      <h3>{copy("ops.anomaliesTitle")}</h3>
      <p className="c360w-note">{copy("ops.anomaliesHint")}</p>
      {notice && <p role="status">{notice}</p>}
      <label>
        {copy("anomalies.show")}
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{copy(`anomalies.statuses.${s}`)}</option>)}
        </select>
      </label>
      {state === "loading" && <p role="status">{copy("loading")}</p>}
      {state === "error" && <p role="alert">{copy("loadFailed")}</p>}
      {state === "ready" && !kinds.length && <p>{copy("anomalies.noAccess")}</p>}
      {state === "ready" && kinds.length > 0 && !rows.length && <p>{copy("anomalies.empty")}</p>}
      <ul className="c360u-events">
        {rows.map((a) => (
          <li key={a.id} data-anomaly={a.kind} data-status={a.status}>
            <strong>{copy(`anomalies.kinds.${a.kind}`)}</strong>
            <Link to={`/admin/customers/${encodeURIComponent(a.customer_id)}/360?area=anomalies`}><bdi>{a.customer_name}</bdi></Link>
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
      {next && <button type="button" disabled={busy} onClick={more}>{copy("queues.more")}</button>}
    </article>
  );
}
