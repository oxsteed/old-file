import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import adminApi from "../../../lib/adminApi";

export const EMPTY_FILTERS = { queues: [], statuses: ["open", "claimed"], assignee: "any", breachedOnly: false, sort: "due" };
export const QUEUE_ERRORS = [
  "already_queued", "revision_conflict", "already_claimed", "not_assignee", "view_name_taken", "global_grant_required",
  "resolution_required", "queue_exists", "invalid_queue_key", "invalid_name", "invalid_sla",
];

export function Sla({ item, copy }) {
  if (item.status === "resolved") return <span data-sla="done">{copy(`queues.resolutions.${item.resolution}`)}</span>;
  if (item.breached) return <span data-sla="breached" className="c360u-flag">{copy("queues.breached", { minutes: Math.abs(item.minutes_left) })}</span>;
  return <span data-sla="ok">{copy("queues.dueIn", { minutes: item.minutes_left })}</span>;
}

export function errorCopy(copy, e) {
  const code = e?.response?.data?.code;
  return copy(QUEUE_ERRORS.includes(code) ? `queues.errors.${code}` : "actionFailed");
}

/** One queue item with claim / release / resolve (shared by the customer panel and the board). */
export function QueueItem({ item, showCustomer, copy, when, busy, resolveFor, setResolveFor, act }) {
  return (
    <li data-item={item.id} data-status={item.status}>
      <strong>{item.queue_name} · {copy(`queues.statuses.${item.status}`)}</strong>
      {/* Gap fill 15: client-side navigation keeps the admin app loaded. */}
      {showCustomer && <Link to={`/admin/customers/${encodeURIComponent(item.customer_id)}/360?area=queues`}><bdi>{item.customer_name}</bdi></Link>}
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
}

const SLA_LIMITS = { min: 5, max: 43200 };
const blankQueue = { queueKey: "", name: "", description: "", slaMinutes: "60" };

/**
 * Gap fill 5: super admins create queues and change their name,
 * description, response deadline (SLA, minutes) and whether they are active.
 * Feed queues (anomalies, duplicate reviews) keep their key; the server
 * checks the revision so two admins cannot overwrite each other.
 */
export function QueueSetup({ queues, copy, busy, run, reload }) {
  const [draft, setDraft] = useState(blankQueue);
  const [edits, setEdits] = useState({});
  const editOf = (q) => edits[q.id] || { name: q.name, description: q.description || "", slaMinutes: String(q.sla_minutes), active: q.active };
  const setEdit = (q, patch) => setEdits((all) => ({ ...all, [q.id]: { ...editOf(q), ...patch } }));
  const slaOk = (v) => /^\d+$/.test(String(v)) && Number(v) >= SLA_LIMITS.min && Number(v) <= SLA_LIMITS.max;
  const create = (e) => {
    e.preventDefault();
    run(async () => {
      await adminApi.post(`/admin/customer360/queues`, {
        queueKey: draft.queueKey.trim(), name: draft.name.trim(), description: draft.description.trim() || null, slaMinutes: Number(draft.slaMinutes),
      });
      setDraft(blankQueue);
      await reload();
    }, copy("queues.setup.created"));
  };
  const save = (q) => run(async () => {
    const d = editOf(q);
    await adminApi.patch(`/admin/customer360/queues/${encodeURIComponent(q.id)}`, {
      revision: q.revision, name: d.name.trim(), description: d.description.trim() || null, slaMinutes: Number(d.slaMinutes), active: d.active,
    });
    setEdits((all) => { const next = { ...all }; delete next[q.id]; return next; });
    await reload();
  }, copy("queues.setup.saved"));
  return (
    <section aria-labelledby="c360u-q-setup" data-section="queue-setup">
      <h4 id="c360u-q-setup">{copy("queues.setup.title")}</h4>
      <p className="c360w-note">{copy("queues.setup.hint", { min: SLA_LIMITS.min, max: SLA_LIMITS.max })}</p>
      <ul className="c360u-cards">
        {queues.map((q) => {
          const d = editOf(q);
          const changed = Boolean(edits[q.id]);
          return (
            <li key={q.id} data-setup-queue={q.queue_key}>
              <strong><bdi dir="ltr">{q.queue_key}</bdi>{q.feed ? ` · ${copy("queues.setup.feed")}` : ""}</strong>
              <div className="c360u-row">
                <label>{copy("queues.setup.name")}<input value={d.name} maxLength={80} onChange={(e) => setEdit(q, { name: e.target.value })} /></label>
                <label>{copy("queues.setup.description")}<input value={d.description} maxLength={300} onChange={(e) => setEdit(q, { description: e.target.value })} /></label>
                <label>{copy("queues.setup.slaMinutes")}<input inputMode="numeric" dir="ltr" value={d.slaMinutes} onChange={(e) => setEdit(q, { slaMinutes: e.target.value.replace(/\D/g, "") })} aria-invalid={!slaOk(d.slaMinutes)} /></label>
                <label><input type="checkbox" checked={d.active} onChange={(e) => setEdit(q, { active: e.target.checked })} /> {copy("queues.setup.active")}</label>
                <button type="button" disabled={busy || !changed || !d.name.trim() || !slaOk(d.slaMinutes)} onClick={() => save(q)}>{copy("queues.setup.save")}</button>
              </div>
            </li>
          );
        })}
      </ul>
      <form className="c360u-row" onSubmit={create} aria-label={copy("queues.setup.new")}>
        <label>{copy("queues.setup.key")}<input value={draft.queueKey} dir="ltr" maxLength={40} pattern="[a-z0-9_]{2,40}" onChange={(e) => setDraft({ ...draft, queueKey: e.target.value.toLowerCase() })} /></label>
        <label>{copy("queues.setup.name")}<input value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
        <label>{copy("queues.setup.description")}<input value={draft.description} maxLength={300} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
        <label>{copy("queues.setup.slaMinutes")}<input inputMode="numeric" dir="ltr" value={draft.slaMinutes} onChange={(e) => setDraft({ ...draft, slaMinutes: e.target.value.replace(/\D/g, "") })} /></label>
        <button type="submit" disabled={busy || !/^[a-z0-9_]{2,40}$/.test(draft.queueKey) || !draft.name.trim() || !slaOk(draft.slaMinutes)}>{copy("queues.setup.create")}</button>
      </form>
    </section>
  );
}

/**
 * The shared team board: per-queue SLA stats, filters, saved views (create,
 * rename / update, delete) and the item list. Used inside a customer's
 * workspace and on the standalone /admin/customer360/queues page (gap fill 6).
 */
export default function TeamBoard({ copy, when, viewerKey, isSuper = false, onChanged, headingId = "c360u-q-board" }) {
  const [board, setBoard] = useState(null);
  const [views, setViews] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [viewId, setViewId] = useState("");
  const [viewName, setViewName] = useState("");
  const [viewTeam, setViewTeam] = useState(false);
  const [rename, setRename] = useState(null);
  const [resolveFor, setResolveFor] = useState(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const loadBoard = async (f = filters, v = viewId, signal, cursor) => {
    const params = v ? { view: v } : { queues: f.queues.join(","), statuses: f.statuses.join(","), assignee: f.assignee, breachedOnly: f.breachedOnly, sort: f.sort };
    const r = await adminApi.get(`/admin/customer360/queues`, { signal, params: cursor ? { ...params, cursor } : params });
    setBoard((p) => (cursor ? { ...r.data, items: [...p.items, ...r.data.items] } : r.data));
    if (v) setFilters(r.data.filters);
  };
  const loadViews = async (signal) => setViews((await adminApi.get(`/admin/customer360/saved-views`, { signal })).data.views);
  useEffect(() => {
    const c = new AbortController();
    loadBoard(EMPTY_FILTERS, "", c.signal).catch((e) => !c.signal.aborted && setBoard({ error: e.response?.data?.code || "error" }));
    loadViews(c.signal).catch(() => {});
    return () => c.abort();
  }, [viewerKey]);

  const run = async (fn, ok) => {
    setBusy(true);
    setNotice("");
    try {
      await fn();
      if (ok) setNotice(ok);
    } catch (e) {
      setNotice(errorCopy(copy, e));
      if (e?.response?.data?.code === "revision_conflict") await Promise.all([loadBoard().catch(() => {}), loadViews().catch(() => {})]);
    } finally {
      setBusy(false);
    }
  };
  const act = (item, action, extra = {}) => run(async () => {
    await adminApi.post(`/admin/customer360/queue-items/${item.id}/${action}`, { revision: item.revision, ...extra });
    setResolveFor(null);
    await Promise.all([loadBoard(), onChanged?.()]);
  }, copy(`queues.done.${action}`));
  const setF = (patch) => { setViewId(""); setRename(null); setFilters((f) => ({ ...f, ...patch })); };
  const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const current = views.find((v) => v.id === viewId) || null;

  // Gap fill 11: rename a saved view, change who sees it, or store the
  // current filters in it (PUT with the view's revision).
  const updateView = (patch, ok) => run(async () => {
    await adminApi.put(`/admin/customer360/saved-views/${encodeURIComponent(current.id)}`, {
      name: current.name, scope: current.scope, filters, revision: current.revision, ...patch,
    });
    setRename(null);
    await loadViews();
  }, ok);

  if (board?.error) return <section aria-labelledby={headingId}><h4 id={headingId}>{copy("queues.board")}</h4><p>{copy(board.error === "global_grant_required" ? "queues.errors.global_grant_required" : "loadFailed")}</p></section>;
  if (!board) return <section aria-labelledby={headingId}><h4 id={headingId}>{copy("queues.board")}</h4><p role="status">{copy("loading")}</p></section>;
  return (
    <section aria-labelledby={headingId}>
      <h4 id={headingId}>{copy("queues.board")}</h4>
      {notice && <p role="status">{notice}</p>}
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
          <select value={viewId} onChange={(e) => { const v = e.target.value; setViewId(v); setRename(null); run(() => (v ? loadBoard(filters, v) : loadBoard(EMPTY_FILTERS, ""))); if (!v) setFilters(EMPTY_FILTERS); }}>
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
      </form>
      {current?.mine && (
        <div className="c360u-row" role="group" aria-label={copy("queues.manageView")} data-section="manage-view">
          {rename ? (
            <form className="c360u-row" onSubmit={(e) => { e.preventDefault(); updateView({ name: rename.name.trim(), scope: rename.team ? "team" : "private" }, copy("queues.viewRenamed")); }}>
              <label>{copy("queues.newViewName")}<input value={rename.name} maxLength={80} onChange={(e) => setRename({ ...rename, name: e.target.value })} /></label>
              <label><input type="checkbox" checked={rename.team} onChange={(e) => setRename({ ...rename, team: e.target.checked })} /> {copy("queues.shareTeam")}</label>
              <button type="submit" disabled={busy || !rename.name.trim()}>{copy("queues.saveRename")}</button>
              <button type="button" disabled={busy} onClick={() => setRename(null)}>{copy("anomalies.cancel")}</button>
            </form>
          ) : (
            <button type="button" disabled={busy} onClick={() => setRename({ name: current.name, team: current.scope === "team" })}>{copy("queues.renameView")}</button>
          )}
          <button type="button" disabled={busy} onClick={() => updateView({}, copy("queues.viewUpdated"))}>{copy("queues.updateView")}</button>
          <button type="button" disabled={busy} onClick={() => run(async () => { await adminApi.delete(`/admin/customer360/saved-views/${encodeURIComponent(current.id)}`); setViewId(""); setRename(null); await loadViews(); }, copy("queues.viewDeleted"))}>{copy("queues.deleteView")}</button>
        </div>
      )}
      {!board.items.length ? <p>{copy("queues.emptyBoard")}</p> : (
        <ul className="c360u-cards">
          {board.items.map((i) => <QueueItem key={i.id} item={i} showCustomer copy={copy} when={when} busy={busy} resolveFor={resolveFor} setResolveFor={setResolveFor} act={act} />)}
        </ul>
      )}
      {board.nextCursor && <button type="button" disabled={busy} onClick={() => run(() => loadBoard(filters, viewId, undefined, board.nextCursor))}>{copy("queues.more")}</button>}
      {isSuper && <QueueSetup queues={board.queues} copy={copy} busy={busy} run={run} reload={() => loadBoard()} />}
    </section>
  );
}
