import { useEffect, useState } from "react";
import adminApi from "../../../lib/adminApi";
import { changeRows, eventLabel } from "./model";

const SOURCES = ["admin_audit", "login", "payment", "support", "food_order", "customer360"];

// Upgrade 1: the replayable "who changed what" timeline from customer_events.
export default function EventLog({ api, copy, when, isSuper, viewerKey }) {
  const [source, setSource] = useState("");
  const [actorType, setActorType] = useState("");
  const [page, setPage] = useState({ events: [], nextBefore: null, sources: [], backfill: [] });
  const [state, setState] = useState("loading");
  const [replay, setReplay] = useState(null);
  const [replayAt, setReplayAt] = useState("");
  const [chain, setChain] = useState(null);

  const load = async (before = null, signal) => {
    const r = await adminApi.get(`${api}/events`, {
      signal,
      params: { sources: source || undefined, actorType: actorType || undefined, before: before || undefined, limit: 50 },
    });
    setPage((old) => ({ ...r.data, events: before ? [...old.events, ...r.data.events] : r.data.events }));
  };
  useEffect(() => {
    const c = new AbortController();
    setState("loading");
    setReplay(null);
    load(null, c.signal)
      .then(() => !c.signal.aborted && setState("ready"))
      .catch(() => !c.signal.aborted && setState("error"));
    return () => c.abort();
  }, [api, source, actorType, viewerKey]);

  const openReplay = async (event, at = "") => {
    try {
      const r = await adminApi.get(`${api}/events/replay`, {
        params: { entityType: event.entity_type, entityId: event.entity_id, at: at ? new Date(at).toISOString() : undefined },
      });
      setReplay({ event, ...r.data });
    } catch {
      setState("error");
    }
  };
  const importing = page.backfill?.some((b) => !b.completed);

  return (
    <article className="c360u" data-panel="events">
      <h3>{copy("events.title")}</h3>
      <p>{copy("events.hint")}</p>
      {importing && <p role="status">{copy("events.importing")}</p>}
      <div className="c360u-row">
        <label>
          {copy("events.source")}
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">{copy("events.allSources")}</option>
            {SOURCES.filter((s) => !page.sources?.length || page.sources.includes(s) || s === source).map((s) => (
              <option key={s} value={s}>{copy(`events.sources.${s}`)}</option>
            ))}
          </select>
        </label>
        <label>
          {copy("events.actor")}
          <select value={actorType} onChange={(e) => setActorType(e.target.value)}>
            <option value="">{copy("events.anyActor")}</option>
            {["admin", "customer", "system", "business"].map((a) => (
              <option key={a} value={a}>{copy(`events.actors.${a}`)}</option>
            ))}
          </select>
        </label>
        {isSuper && (
          <button
            type="button"
            onClick={async () => {
              try {
                setChain((await adminApi.get(`${api}/events/verify`)).data);
              } catch {
                setChain({ intact: false, failed: true });
              }
            }}
          >
            {copy("events.verify")}
          </button>
        )}
      </div>
      {chain && (
        <p role="status">
          {chain.failed ? copy("actionFailed") : chain.intact ? copy("events.chainIntact", { count: chain.total }) : copy("events.chainBroken", { id: chain.firstBrokenId })}
        </p>
      )}
      {state === "loading" && <p role="status">{copy("loading")}</p>}
      {state === "error" && <p role="alert">{copy("loadFailed")}</p>}
      {state === "ready" && !page.events.length && <p>{copy("events.empty")}</p>}
      <ol className="c360u-events">
        {page.events.map((e) => (
          <li key={e.id} data-event={e.event_type}>
            <time dateTime={e.occurred_at}>{when(e.occurred_at)}</time>
            <strong>{eventLabel(e, copy)}</strong>
            <span>
              {copy(`events.actors.${e.actor_type}`)}
              {e.actor_id ? ` · ${String(e.actor_id).slice(0, 8)}` : ""} · {copy(`events.sources.${e.source}`)}
            </span>
            {changeRows(e.changes).length > 0 && (
              <ul>
                {changeRows(e.changes).map((c) => (
                  <li key={c.field}>
                    <bdi>{c.field}</bdi>:{" "}
                    {c.kind === "redacted" ? copy("events.redacted") : c.kind === "changed" ? copy("events.changed") : (
                      <>
                        <bdi>{c.from ?? "—"}</bdi> → <bdi>{c.to ?? "—"}</bdi>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {e.entity_type && e.entity_id && (
              <button type="button" onClick={() => openReplay(e)}>
                {copy("events.replay")}
              </button>
            )}
          </li>
        ))}
      </ol>
      {page.nextBefore && (
        <button type="button" onClick={() => load(page.nextBefore).catch(() => setState("error"))}>
          {copy("events.older")}
        </button>
      )}
      {replay && (
        <section className="c360u-replay" aria-labelledby="c360u-replay-title">
          <h4 id="c360u-replay-title">
            {copy("events.replayTitle", { entity: copy(`events.entities.${replay.entityType}`), id: replay.entityId })}
          </h4>
          <label>
            {copy("events.asOf")}
            <input type="datetime-local" value={replayAt} onChange={(e) => setReplayAt(e.target.value)} />
          </label>
          <button type="button" onClick={() => openReplay(replay.event, replayAt)}>
            {copy("events.rebuild")}
          </button>
          <dl>
            {Object.entries(replay.state).map(([k, v]) => (
              <div key={k}>
                <dt><bdi>{k}</bdi></dt>
                <dd><bdi>{v == null ? "—" : String(v)}</bdi></dd>
              </div>
            ))}
          </dl>
          {replay.unknownFields.length > 0 && <p>{copy("events.unknownFields", { fields: replay.unknownFields.join(", ") })}</p>}
          <ol>
            {replay.steps.map((s) => (
              <li key={s.id}>
                <time dateTime={s.occurredAt}>{when(s.occurredAt)}</time> · {eventLabel({ event_type: s.eventType }, copy)} · {copy(`events.actors.${s.actorType}`)}
              </li>
            ))}
          </ol>
          <button type="button" onClick={() => setReplay(null)}>{copy("close")}</button>
        </section>
      )}
    </article>
  );
}
