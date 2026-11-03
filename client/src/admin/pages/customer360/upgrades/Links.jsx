import { useEffect, useState } from "react";
import adminApi from "../../../lib/adminApi";

const ACTIONS = {
  in_review: ["duplicate", "distinct", "dismiss"],
  awaiting_second_review: ["confirm", "reject", "dismiss"],
};

function Graph({ nodes, copy }) {
  const size = 240;
  const c = size / 2;
  const r = size / 2 - 28;
  return (
    <svg className="c360u-graph" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={copy("links.graphLabel", { count: nodes.length })}>
      {nodes.map((n, i) => {
        const angle = (2 * Math.PI * i) / Math.max(nodes.length, 1) - Math.PI / 2;
        const x = c + r * Math.cos(angle);
        const y = c + r * Math.sin(angle);
        return (
          <g key={n.userId}>
            <line x1={c} y1={c} x2={x} y2={y} strokeWidth={1 + n.score * 5} className="c360u-edge" />
            <circle cx={x} cy={y} r={10} className={n.suspended ? "c360u-node is-suspended" : "c360u-node"} />
            <text x={x} y={y + 24} textAnchor="middle">{Math.round(n.score * 100)}%</text>
          </g>
        );
      })}
      <circle cx={c} cy={c} r={14} className="c360u-node is-self" />
    </svg>
  );
}

// Upgrade 5: weighted link graph and guided merge review. Nothing is merged.
export default function Links({ api, copy, when, user, viewerKey }) {
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const [active, setActive] = useState(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const load = async (signal) => {
    const r = await adminApi.get(`${api}/links`, { signal });
    setData(r.data);
    return r.data;
  };
  useEffect(() => {
    const c = new AbortController();
    setState("loading");
    setActive(null);
    load(c.signal).then(() => !c.signal.aborted && setState("ready")).catch(() => !c.signal.aborted && setState("error"));
    return () => c.abort();
  }, [api, viewerKey]);
  const fail = (e) => setNotice(copy(
    { revision_conflict: "conflict", checklist_incomplete: "links.checklistIncomplete", self_approval_forbidden: "links.secondAdmin" }[e.response?.data?.code] || "actionFailed",
  ));
  const open = async (otherId) => {
    setNotice("");
    try {
      const r = await adminApi.post(`${api}/links/${otherId}/review`, {});
      const d = await load();
      setActive(d.reviews.find((x) => String(x.id) === String(r.data.review.id)) || r.data.review);
    } catch (e) {
      fail(e);
    }
  };
  const step = async (action, checklist) => {
    setNotice("");
    try {
      const r = await adminApi.post(`${api}/link-reviews/${active.id}/${action}`, { checklist, reason: action === "checklist" ? undefined : reason, revision: active.revision });
      setActive({ ...r.data.review, id: String(r.data.review.id) });
      setReason("");
      setNotice(copy("saved"));
      await load();
    } catch (e) {
      fail(e);
    }
  };
  const other = (rv) => (rv.user_a === user.id ? rv.user_b : rv.user_a);
  return (
    <article className="c360u" data-panel="links">
      <h3>{copy("links.title")}</h3>
      <p>{copy("links.hint")}</p>
      <p className="c360w-note">{copy("links.neverMerge")}</p>
      {notice && <p role="status">{notice}</p>}
      {state === "loading" && <p role="status">{copy("loading")}</p>}
      {state === "error" && <p role="alert">{copy("loadFailed")}</p>}
      {data && (
        <>
          {!data.signalsEnabled && <p role="status">{copy("links.signalsOff")}</p>}
          <p className="c360w-meta">
            {copy("links.kindsShown", { kinds: data.kinds.map((k) => copy(`links.kinds.${k}`)).join(", ") })}
          </p>
          {data.common?.length > 0 && (
            <p>{copy("links.common", { kinds: data.common.map((x) => copy(`links.kinds.${x.kind}`)).join(", ") })}</p>
          )}
          {!data.nodes.length ? (
            <p>{copy("links.empty")}</p>
          ) : (
            <div className="c360u-cards">
              <Graph nodes={data.nodes} copy={copy} />
              <ol className="c360u-events">
                {data.nodes.map((n) => (
                  <li key={n.userId} data-link={n.userId}>
                    <strong>
                      <bdi>{n.name || copy("unknown")}</bdi> · <bdi>{n.emailMasked}</bdi>
                    </strong>
                    <span>
                      {copy("links.score", { score: Math.round(n.score * 100) })} ·{" "}
                      {n.kinds.map((k) => copy(`links.kinds.${k}`)).join(", ")}
                    </span>
                    <span>
                      {copy("links.created", { time: when(n.createdAt) })}
                      {n.suspended ? ` · ${copy("links.suspended")}` : ""}
                    </span>
                    <button type="button" onClick={() => open(n.userId)}>{copy("links.review")}</button>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {data.reviews.length > 0 && (
            <section>
              <h4>{copy("links.reviews")}</h4>
              <ul>
                {data.reviews.map((rv) => (
                  <li key={rv.id}>
                    <button type="button" onClick={() => setActive(rv)}>
                      <bdi>{String(other(rv)).slice(0, 8)}</bdi> · {copy(`links.statuses.${rv.status}`)} · {Math.round(Number(rv.score) * 100)}%
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {active && (
            <section className="c360u-replay" data-review={active.status} aria-labelledby="c360u-review-title">
              <h4 id="c360u-review-title">{copy("links.reviewTitle", { status: copy(`links.statuses.${active.status}`) })}</h4>
              <fieldset disabled={active.status !== "in_review"}>
                <legend>{copy("links.checklistTitle")}</legend>
                {[...data.checklist, ...data.optionalChecklist].map((k) => (
                  <label key={k} className="c360u-check">
                    <input type="checkbox" checked={!!active.checklist?.[k]} onChange={(e) => step("checklist", { [k]: e.target.checked })} />
                    {copy(`links.checklist.${k}`)}
                  </label>
                ))}
              </fieldset>
              {active.status === "awaiting_second_review" && <p role="status">{copy("links.awaiting")}</p>}
              {active.status === "confirmed_duplicate" && <p>{copy("links.nextSteps")}</p>}
              {ACTIONS[active.status] && (
                <>
                  <label className="c360u-reply">
                    {copy("anomalies.reason")}
                    <textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                  </label>
                  <div className="c360u-row">
                    {ACTIONS[active.status].map((a) => (
                      <button key={a} type="button" disabled={reason.trim().length < 3} onClick={() => step(a)}>
                        {copy(`links.actions.${a}`)}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <button type="button" onClick={() => setActive(null)}>{copy("close")}</button>
            </section>
          )}
        </>
      )}
    </article>
  );
}
