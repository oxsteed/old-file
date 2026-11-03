import { useEffect, useState } from "react";
import adminApi from "../../../lib/adminApi";

const EMPTY = { queues: [], statuses: ["open", "claimed"], assignee: "any", breachedOnly: false, sort: "due" };
const ERRORS = ["already_queued", "revision_conflict", "already_claimed", "not_assignee", "view_name_taken", "global_grant_required", "resolution_required"];

function Sla({ item, copy }) {
  if (item.status === "resolved") return <span data-sla="done">{copy(`queues.resolutions.${item.resolution}`)}</span>;
  if (item.breached) return <span data-sla="breached" className="c360u-flag">{copy("queues.breached", { minutes: Math.abs(item.minutes_left) })}</span>;
  return <span data-sla="ok">{copy("queues.dueIn", { minutes: item.minutes_left })}</span>;
}

// Upgrade 10: this customer's queue items, and the shared team board with
// saved views and SLA tracking.
export default function Queues({ api, copy, when, viewerKey }) {
  const [mine, setMine] = useState(null);
  const [board, setBoard] = useState(null);
  const [views, setViews] = useState([]);
  const [filters, setFilters] = useState(EMPTY);
  const [viewId, setViewId] = useState("");
  const [add, setAdd] = useState({ queueKey: "", reason: "" });
  const [viewName, setViewName] = useState("");
  const [viewTeam, setViewTeam] = useState(false);
  const [resolveFor, setResolveFor] = useState(null);
  const [state, setState] = useState("loading");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const loadMine = async (signal) => setMine((await adminApi.get(`${api}/queues`, { signal })).data);
  const loadBoard = async (f = filters, v = viewId, signal, cursor) => {
    const params = v ? { view: v } : { queues: f.queues.join(","), statuses: f.statuses.join(","), assignee: f.assignee, breachedOnly: f.breachedOnly, sort: f.sort };
    const r = await adminApi.get(`/admin/customer360/queues`, { signal, params: cursor ? { ...params, cursor } : params });
    setBoard((p) => (cursor ? { ...r.data, items: [...p.items, ...r.data.items] } : r.data));
    if (v) setFilters(r.data.filters);
  };
  const loadViews = async (signal) => setViews((await adminApi.get(`/admin/customer360/saved-views`, { signal })).data.views);
  useEffect(() => {
    const c = new AbortController();
    setState("loading");
    loadMine(c.signal)
      .then(() => !c.signal.aborted && setState("ready"))
      .catch(() => !c.signal.aborted && setState("error"));
    loadBoard(EMPTY, "", c.signal).catch((e) => !c.signal.aborted && setBoard({ error: e.response?.data?.code || "error" }));
    loadViews(c.signal).catch(() => {});
    return () => c.abort();
  }, [api, viewerKey]);

  const run = async (fn, ok) => {
    setBusy(true);
    setNotice("");
    try {
      await fn();
      if (ok) setNotice(ok);
    } catch (e) {
      const code = e.response?.data?.code;
      setNotice(copy(ERRORS.includes(code) ? `queues.errors.${code}` : "actionFailed"));
    } finally {
      setBusy(false);
    }
  };
  const act = (item, action, extra = {}) => run(async () => {
    await adminApi.post(`/admin/customer360/queue-items/${item.id}/${action}`, { revision: item.revision, ...extra });
    setResolveFor(null);
    await Promise.all([loadMine(), loadBoard()]);
  }, copy(`queues.done.${action}`));
  const setF = (patch) => { setViewId(""); setFilters((f) => ({ ...f, ...patch })); };
  const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const itemRow = (item, showCustomer) => (
    <li key={item.id} data-item={item.id} data-status={item.status}>
      <strong>{item.queue_name} · {copy(`queues.statuses.${item.status}`)}</strong>
      {showCustomer && <a href={`/admin/customers/${item.customer_id}/360?area=queues`}><bdi>{item.customer_name}</bdi></a>}
      <span>{copy(`queues.topics.${item.topic}`, { defaultValue: item.topic })}{item.reason && item.source === "manual" ? <> · <bdi>{item.reason}</bdi></> : null}</span>
      <span>{when(item.created_at)} · <Sla item={item} copy={copy} />{item.assigned_name ? <> · <bdi>{item.assigned_name}</bdi></> : null}</span>
      {item.status !== "resolved" && (
        <div className="c360u-row">
          {item.status === "open" && <button type="button" disabled={busy} onClick={() => act(item, "claim")}>{copy("queues.claim")}</button>}
          {item.status === "claimed" && <button type="button" disabled={busy} onClick={() => act(item, "release")}>{copy("queues.release")}</button>}
          {resolveFor?.id === item.id ? (
            <>
              <label>
                {copy("queues.resolution")}
                <select value={resolveFor.resolution} onChange={(e) => setResolveFor({ ...resolveFor, resolution: e.target.value })}>
                  <option value="">{copy("queues.choose")}</option>
                  <option value="handled">{copy("queues.resolutions.handled")}</option>
                  <option value="no_action">{copy("queues.resolutions.no_action")}</option>
                </select>
              </label>
              <label>
                {copy("queues.note")}
                <input value={resolveFor.note} maxLength={1000} onChange={(e) => setResolveFor({ ...resolveFor, note: e.target.value })} />
              </label>
              <button type="button" disabled={busy || !resolveFor.resolution} onClick={() => act(item, "resolve", { resolution: resolveFor.resolution, note: resolveFor.note || null })}>{copy("queues.confirmResolve")}</button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={() => setResolveFor({ id: item.id, resolution: "", note: "" })}>{copy("queues.resolve")}</button>
          )}
        </div>
      )}
    </li>
  );

  return (
    <article className="c360u" data-panel="queues">
      <h3>{copy("queues.title")}</h3>
      <p className="c360w-note">{copy("queues.hint")}</p>
      {notice && <p role="status">{notice}</p>}
      {state === "loading" && <p role="status">{copy("loading")}</p>}
      {state === "error" && <p role="alert">{copy("loadFailed")}</p>}
      {mine && (
        <section aria-labelledby="c360u-q-mine">
          <h4 id="c360u-q-mine">{copy("queues.thisCustomer")}</h4>
          {!mine.items.length ? <p>{copy("queues.notQueued")}</p> : <ul className="c360u-cards">{mine.items.map((i) => itemRow(i, false))}</ul>}
          <form className="c360u-row" onSubmit={(e) => { e.preventDefault(); run(async () => { await adminApi.post(`${api}/queue-items`, add); setAdd({ queueKey: "", reason: "" }); await Promise.all([loadMine(), loadBoard()]); }, copy("queues.added")); }}>
            <label>
              {copy("queues.queue")}
              <select value={add.queueKey} onChange={(e) => setAdd({ ...add, queueKey: e.target.value })}>
                <option value="">{copy("queues.choose")}</option>
                {mine.queues.map((q) => <option key={q.queue_key} value={q.queue_key}>{q.name}</option>)}
              </select>
            </label>
            <label>
              {copy("queues.reason")}
              <input value={add.reason} maxLength={300} onChange={(e) => setAdd({ ...add, reason: e.target.value })} />
            </label>
            <button type="submit" disabled={busy || !add.queueKey || !add.reason.trim()}>{copy("queues.add")}</button>
          </form>
        </section>
      )}
      <section aria-labelledby="c360u-q-board">
        <h4 id="c360u-q-board">{copy("queues.board")}</h4>
        {board?.error ? <p>{copy(board.error === "global_grant_required" ? "queues.errors.global_grant_required" : "loadFailed")}</p> : board && (
          <>
            <div className="c360u-scroll">
              <table data-table="queues">
                <thead>
                  <tr>
                    <th scope="col">{copy("queues.queue")}</th><th scope="col">{copy("queues.sla")}</th><th scope="col">{copy("queues.statuses.open")}</th>
                    <th scope="col">{copy("queues.statuses.claimed")}</th><th scope="col">{copy("queues.breachedCol")}</th><th scope="col">{copy("queues.met30")}</th><th scope="col">{copy("queues.median30")}</th>
                  </tr>
                </thead>
                <tbody>
                  {board.queues.map((q) => (
                    <tr key={q.id} data-queue={q.queue_key}>
                      <th scope="row">{q.name}</th><td>{copy("queues.minutes", { count: q.sla_minutes })}</td><td>{q.open}</td><td>{q.claimed}</td>
                      <td>{q.breached}</td><td>{q.sla_met_pct_30d == null ? "—" : `${q.sla_met_pct_30d}%`}</td>
                      <td>{q.median_resolve_minutes_30d == null ? "—" : copy("queues.minutes", { count: Math.round(q.median_resolve_minutes_30d) })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="c360u-row" role="group" aria-label={copy("queues.filters")}>
              <label>
                {copy("queues.savedView")}
                <select value={viewId} onChange={(e) => { const v = e.target.value; setViewId(v); run(() => (v ? loadBoard(filters, v) : loadBoard(EMPTY, ""))); if (!v) setFilters(EMPTY); }}>
                  <option value="">{copy("queues.noView")}</option>
                  {views.map((v) => <option key={v.id} value={v.id}>{v.name}{v.scope === "team" ? ` · ${copy("queues.team")}` : ""}{v.mine ? "" : ` · ${v.owner_name}`}</option>)}
                </select>
              </label>
              <fieldset>
                <legend>{copy("queues.queue")}</legend>
                {board.queues.filter((q) => q.active).map((q) => (
                  <label key={q.queue_key}><input type="checkbox" checked={filters.queues.includes(q.queue_key)} onChange={() => setF({ queues: toggle(filters.queues, q.queue_key) })} /> {q.name}</label>
                ))}
              </fieldset>
              <label>
                {copy("queues.assignee")}
                <select value={filters.assignee} onChange={(e) => setF({ assignee: e.target.value })}>
                  {["any", "me", "unassigned"].map((a) => <option key={a} value={a}>{copy(`queues.assignees.${a}`)}</option>)}
                </select>
              </label>
              <label>
                {copy("queues.sort")}
                <select value={filters.sort} onChange={(e) => setF({ sort: e.target.value })}>
                  <option value="due">{copy("queues.sorts.due")}</option>
                  <option value="created">{copy("queues.sorts.created")}</option>
                </select>
              </label>
              <label><input type="checkbox" checked={filters.breachedOnly} onChange={(e) => setF({ breachedOnly: e.target.checked })} /> {copy("queues.breachedOnly")}</label>
              <button type="button" disabled={busy} onClick={() => run(() => loadBoard(filters, ""))}>{copy("queues.apply")}</button>
            </div>
            <form className="c360u-row" onSubmit={(e) => { e.preventDefault(); run(async () => { await adminApi.post(`/admin/customer360/saved-views`, { name: viewName, scope: viewTeam ? "team" : "private", filters }); setViewName(""); await loadViews(); }, copy("queues.viewSaved")); }}>
              <label>
                {copy("queues.viewName")}
                <input value={viewName} maxLength={80} onChange={(e) => setViewName(e.target.value)} />
              </label>
              <label><input type="checkbox" checked={viewTeam} onChange={(e) => setViewTeam(e.target.checked)} /> {copy("queues.shareTeam")}</label>
              <button type="submit" disabled={busy || !viewName.trim()}>{copy("queues.saveView")}</button>
              {viewId && views.find((v) => v.id === viewId)?.mine && (
                <button type="button" disabled={busy} onClick={() => run(async () => { await adminApi.delete(`/admin/customer360/saved-views/${viewId}`); setViewId(""); await loadViews(); }, copy("queues.viewDeleted"))}>{copy("queues.deleteView")}</button>
              )}
            </form>
            {!board.items.length ? <p>{copy("queues.emptyBoard")}</p> : <ul className="c360u-cards">{board.items.map((i) => itemRow(i, true))}</ul>}
            {board.nextCursor && <button type="button" disabled={busy} onClick={() => run(() => loadBoard(filters, viewId, undefined, board.nextCursor))}>{copy("queues.more")}</button>}
          </>
        )}
      </section>
    </article>
  );
}
