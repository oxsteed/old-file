import { useEffect, useState } from "react";
import adminApi from "../../../lib/adminApi";
import TeamBoard, { QueueItem, errorCopy } from "./TeamBoard";

// Upgrade 10: this customer's queue items, and the shared team board with
// saved views and SLA tracking (the board is also its own page, gap fill 6).
export default function Queues({ api, copy, when, viewerKey, isSuper }) {
  const [mine, setMine] = useState(null);
  const [add, setAdd] = useState({ queueKey: "", reason: "" });
  const [resolveFor, setResolveFor] = useState(null);
  const [state, setState] = useState("loading");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [boardKey, setBoardKey] = useState(0);

  const loadMine = async (signal) => setMine((await adminApi.get(`${api}/queues`, { signal })).data);
  useEffect(() => {
    const c = new AbortController();
    setState("loading");
    loadMine(c.signal)
      .then(() => !c.signal.aborted && setState("ready"))
      .catch(() => !c.signal.aborted && setState("error"));
    return () => c.abort();
  }, [api, viewerKey]);

  // Nov 10 #5: a failed load used to dead-end with only "loadFailed" and no
  // way back. Retry re-runs the load; on success the list and add form render.
  const retryMine = () => {
    setState("loading");
    loadMine().then(() => setState("ready")).catch(() => setState("error"));
  };

  const run = async (fn, ok) => {
    setBusy(true);
    setNotice("");
    try {
      await fn();
      if (ok) setNotice(ok);
    } catch (e) {
      setNotice(errorCopy(copy, e));
    } finally {
      setBusy(false);
    }
  };
  const act = (item, action, extra = {}) => run(async () => {
    await adminApi.post(`/admin/customer360/queue-items/${item.id}/${action}`, { revision: item.revision, ...extra });
    setResolveFor(null);
    await loadMine();
    setBoardKey((k) => k + 1);
  }, copy(`queues.done.${action}`));

  return (
    <article className="c360u" data-panel="queues">
      <h3>{copy("queues.title")}</h3>
      <p className="c360w-note">{copy("queues.hint")}</p>
      {notice && <p role="status">{notice}</p>}
      {state === "loading" && <p role="status">{copy("loading")}</p>}
      {state === "error" && (<><p role="alert">{copy("loadFailed")}</p><button type="button" onClick={retryMine}>{copy("retry")}</button></>)}
      {mine && (
        <section aria-labelledby="c360u-q-mine">
          <h4 id="c360u-q-mine">{copy("queues.thisCustomer")}</h4>
          {!mine.items.length ? <p>{copy("queues.notQueued")}</p> : (
            <ul className="c360u-cards">
              {mine.items.map((i) => <QueueItem key={i.id} item={i} showCustomer={false} copy={copy} when={when} busy={busy} resolveFor={resolveFor} setResolveFor={setResolveFor} act={act} />)}
            </ul>
          )}
          <form className="c360u-row" onSubmit={(e) => { e.preventDefault(); run(async () => { await adminApi.post(`${api}/queue-items`, add); setAdd({ queueKey: "", reason: "" }); await loadMine(); setBoardKey((k) => k + 1); }, copy("queues.added")); }}>
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
      <TeamBoard key={boardKey} copy={copy} when={when} viewerKey={viewerKey} isSuper={isSuper} onChanged={() => loadMine()} />
    </article>
  );
}
