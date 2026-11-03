import { useEffect, useState } from "react";
import adminApi from "../../../lib/adminApi";

const uuid = () =>
  globalThis.crypto?.randomUUID?.() ||
  "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (Math.random() * 16) >> (c / 4)).toString(16));
const ERRORS = ["playbook_already_open", "handoff_note_required", "step_already_completed", "playbook_run_closed"];

// Upgrade 9: playbooks. Safe steps run automatically after an explicit
// confirmation; money steps only hand off to the existing approval flows.
export default function Playbooks({ api, copy, when, viewerKey, onArea }) {
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const [confirming, setConfirming] = useState(null);
  const [notes, setNotes] = useState({});
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async (signal) => {
    const r = await adminApi.get(`${api}/playbooks`, { signal });
    setData(r.data);
  };
  useEffect(() => {
    const c = new AbortController();
    setState("loading");
    load(c.signal).then(() => !c.signal.aborted && setState("ready")).catch(() => !c.signal.aborted && setState("error"));
    return () => c.abort();
  }, [api, viewerKey]);

  const act = async (fn, ok) => {
    setBusy(true);
    setNotice("");
    try {
      await fn();
      setNotice(ok);
      await load();
    } catch (e) {
      const code = e.response?.data?.code;
      setNotice(copy(ERRORS.includes(code) ? `playbooks.errors.${code}` : "actionFailed"));
    } finally {
      setBusy(false);
    }
  };
  const start = (key) => act(async () => {
    const id = confirming.id;
    await adminApi.post(`${api}/playbooks/${key}/run`, { confirm: true, clientRequestId: id }, { headers: { "Idempotency-Key": id } });
    setConfirming(null);
  }, copy("playbooks.started"));
  const complete = (run, step) => act(() => adminApi.post(`${api}/playbook-runs/${run.id}/steps/${step.key}/complete`, { note: notes[`${run.id}:${step.key}`] || null }), copy("playbooks.stepSaved"));
  const cancel = (run) => act(() => adminApi.post(`${api}/playbook-runs/${run.id}/cancel`, {}), copy("playbooks.cancelled"));
  const openKeys = new Set((data?.runs || []).filter((r) => r.status === "open").map((r) => r.playbook_key));

  return (
    <article className="c360u" data-panel="playbooks">
      <h3>{copy("playbooks.title")}</h3>
      <p className="c360w-note">{copy("playbooks.hint")}</p>
      {notice && <p role="status">{notice}</p>}
      {state === "loading" && <p role="status">{copy("loading")}</p>}
      {state === "error" && <p role="alert">{copy("loadFailed")}</p>}
      {data && (
        <>
          <ul className="c360u-cards">
            {data.playbooks.map((p) => (
              <li key={p.key} data-playbook={p.key}>
                <strong>{copy(`playbooks.names.${p.key}`)}</strong>
                <ol>
                  {p.steps.map((s) => (
                    <li key={s.key}>
                      {copy(`playbooks.steps.${s.key}`)} · <span data-kind={s.kind}>{copy(`playbooks.kinds.${s.kind}`)}</span>
                    </li>
                  ))}
                </ol>
                {openKeys.has(p.key) ? <p>{copy("playbooks.alreadyOpen")}</p>
                  : confirming?.key === p.key ? (
                    <div className="c360u-row" data-confirm={p.key}>
                      <p role="alert">{copy("playbooks.confirm")}</p>
                      <button type="button" disabled={busy} onClick={() => start(p.key)}>{copy("playbooks.runNow")}</button>
                      <button type="button" disabled={busy} onClick={() => setConfirming(null)}>{copy("playbooks.back")}</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirming({ key: p.key, id: uuid() })}>{copy("playbooks.run")}</button>
                  )}
              </li>
            ))}
          </ul>
          <h4>{copy("playbooks.history")}</h4>
          {!data.runs.length ? <p>{copy("playbooks.none")}</p> : (
            <ul className="c360u-cards">
              {data.runs.map((run) => (
                <li key={run.id} data-run={run.id} data-status={run.status}>
                  <strong>{copy(`playbooks.names.${run.playbook_key}`)} · {copy(`playbooks.runStatuses.${run.status}`)}</strong>
                  <span><bdi>{run.started_by_name}</bdi> · {when(run.created_at)}</span>
                  <ol>
                    {run.steps.map((s) => (
                      <li key={s.key} data-step={s.key} data-step-status={s.status}>
                        <span>{copy(`playbooks.steps.${s.key}`)} · {copy(`playbooks.statuses.${s.status}`)}</span>
                        {s.result?.reason && <span className="c360w-meta"> · {copy(`playbooks.reasons.${s.result.reason}`)}</span>}
                        {s.note && <p className="c360u-message"><bdi>{s.note}</bdi></p>}
                        {run.status === "open" && s.status === "pending" && (s.kind === "manual" || s.kind === "money_handoff") && (
                          <div className="c360u-reply">
                            {s.kind === "money_handoff" && <p role="note">{copy("playbooks.moneyNote")}</p>}
                            {s.kind === "money_handoff" && <a href={data.playbooks.find((p) => p.key === run.playbook_key)?.steps.find((x) => x.key === s.key)?.route}>{copy("playbooks.openApprovals")}</a>}
                            {s.key === "contact_customer" && onArea && <button type="button" onClick={() => onArea("inbox")}>{copy("playbooks.openInbox")}</button>}
                            <label>
                              {copy(s.kind === "money_handoff" ? "playbooks.handoffNote" : "playbooks.note")}
                              <input value={notes[`${run.id}:${s.key}`] || ""} maxLength={1000} onChange={(e) => setNotes((n) => ({ ...n, [`${run.id}:${s.key}`]: e.target.value }))} />
                            </label>
                            <button type="button" disabled={busy || (s.kind === "money_handoff" && !(notes[`${run.id}:${s.key}`] || "").trim())} onClick={() => complete(run, s)}>
                              {copy(s.kind === "money_handoff" ? "playbooks.markHandedOff" : "playbooks.markDone")}
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                  {run.status === "open" && <button type="button" disabled={busy} onClick={() => cancel(run)}>{copy("playbooks.cancel")}</button>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </article>
  );
}
