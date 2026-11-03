import { useEffect, useState } from "react";
import adminApi from "../../../lib/adminApi";

// Upgrade 2: advisory health and risk scores with a per-factor explanation.
export default function Health({ api, copy, when, viewerKey }) {
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const load = async (method = "get", signal) => {
    const r = method === "get"
      ? await adminApi.get(`${api}/health`, { signal })
      : await adminApi.post(`${api}/health/recompute`, {}, { signal });
    setData(r.data);
  };
  useEffect(() => {
    const c = new AbortController();
    setState("loading");
    load("get", c.signal)
      .then(() => !c.signal.aborted && setState("ready"))
      .catch(() => !c.signal.aborted && setState("error"));
    return () => c.abort();
  }, [api, viewerKey]);
  return (
    <article className="c360u" data-panel="health">
      <h3>{copy("health.title")}</h3>
      <p className="c360w-note">{copy("health.advisory")}</p>
      {state === "loading" && <p role="status">{copy("loading")}</p>}
      {state === "error" && <p role="alert">{copy("loadFailed")}</p>}
      {data && (
        <>
          <p className="c360w-meta">
            {copy("health.computed", { time: when(data.computedAt), model: data.modelVersion })}
          </p>
          <div className="c360u-cards">
            {["churn", "payment", "support"].map((name) => {
              const s = data[name];
              return (
                <section key={name} className="c360u-card" data-score={name} data-band={s.band || "restricted"}>
                  <h4>{copy(`health.scores.${name}`)}</h4>
                  {s.state === "restricted" ? (
                    <p>{copy("health.restricted")}</p>
                  ) : (
                    <>
                      <p className="c360u-score">
                        <strong>{s.score}</strong>/100 · {copy(`health.bands.${s.band}`)}
                      </p>
                      <table>
                        <caption className="c360u-sr">{copy("health.factorsCaption")}</caption>
                        <thead>
                          <tr>
                            <th scope="col">{copy("health.factor")}</th>
                            <th scope="col">{copy("health.value")}</th>
                            <th scope="col">{copy("health.points")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.factors.map((f) => (
                            <tr key={f.key}>
                              <th scope="row">
                                {copy(`health.factors.${f.key}.label`)}
                                <small>{copy(`health.factors.${f.key}.explain`)}</small>
                              </th>
                              <td>
                                {f.value == null ? copy("health.never") : f.key === "activityDrop"
                                  ? copy("health.activityValue", { recent: f.value, previous: f.previous ?? 0 })
                                  : f.value}
                              </td>
                              <td>{copy("health.contribution", { points: f.contribution, weight: f.weight })}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </section>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => load("post").then(() => setState("ready")).catch(() => setState("error"))}
          >
            {copy("health.recompute")}
          </button>
        </>
      )}
    </article>
  );
}
