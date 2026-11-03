import { useEffect, useState } from "react";
import adminApi from "../../../lib/adminApi";

const STAGES = ["new", "never_activated", "active", "lapsing", "dormant", "closed"];

function Distribution({ dist, copy, label }) {
  if (!dist || dist.suppressed) return <p>{copy("lifecycle.suppressed", { min: 10 })}</p>;
  return (
    <table>
      <caption className="c360u-sr">{label}</caption>
      <thead><tr><th scope="col">{copy("lifecycle.stage")}</th><th scope="col">{copy("lifecycle.share")}</th></tr></thead>
      <tbody>
        {STAGES.map((s) => {
          const cell = dist.stages[s];
          return (
            <tr key={s}>
              <th scope="row">{copy(`lifecycle.stages.${s}`)}</th>
              <td>
                {cell?.suppressed ? copy("lifecycle.small") : (
                  <span className="c360u-bar-row">
                    <span className="c360u-bar" style={{ inlineSize: `${cell?.share || 0}%` }} aria-hidden="true" />
                    <bdi>{cell?.share ?? 0}%</bdi>
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Upgrade 7: lifecycle stage with its inputs, and country cohort comparison.
export default function Lifecycle({ api, copy, when, viewerKey }) {
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const [countries, setCountries] = useState("");
  const [months, setMonths] = useState(12);
  const [cmp, setCmp] = useState(null);
  const [cmpState, setCmpState] = useState("idle");
  useEffect(() => {
    const c = new AbortController();
    setState("loading");
    setCmp(null);
    adminApi.get(`${api}/lifecycle`, { signal: c.signal })
      .then((r) => {
        if (c.signal.aborted) return;
        setData(r.data);
        setCountries(r.data.country || "");
        setState("ready");
      })
      .catch(() => !c.signal.aborted && setState("error"));
    return () => c.abort();
  }, [api, viewerKey]);
  const compare = async (e) => {
    e.preventDefault();
    setCmpState("loading");
    try {
      const r = await adminApi.get("/admin/customer360/cohorts", { params: { countries, months } });
      setCmp(r.data);
      setCmpState("ready");
    } catch (err) {
      setCmpState(err.response?.data?.code === "region_scoped_admin" ? "restricted" : err.response?.data?.code === "invalid_countries" ? "invalid" : "error");
    }
  };
  return (
    <article className="c360u" data-panel="lifecycle">
      <h3>{copy("lifecycle.title")}</h3>
      <p className="c360w-note">{copy("lifecycle.hint")}</p>
      {state === "loading" && <p role="status">{copy("loading")}</p>}
      {state === "error" && <p role="alert">{copy("loadFailed")}</p>}
      {data && data.state === "none" && <p>{copy("lifecycle.none")}</p>}
      {data && data.state === "ready" && (
        <>
          <p className="c360u-score" data-stage={data.stage}>
            <strong>{copy(`lifecycle.stages.${data.stage}`)}</strong> · {copy("lifecycle.since", { time: when(data.stageSince) })}
          </p>
          <p>{copy(`lifecycle.explain.${data.stage}`)}</p>
          <ul>
            <li>{copy("lifecycle.factors.last", { days: data.factors.daysSinceLastTransaction ?? "—" })}</li>
            <li>{copy("lifecycle.factors.first", { days: data.factors.daysSinceFirstTransaction ?? "—" })}</li>
            <li>{copy("lifecycle.factors.recent", { count: data.factors.transactions90d })}</li>
          </ul>
          <p className="c360w-meta">{copy("lifecycle.computed", { time: when(data.computedAt), model: data.modelVersion })}</p>
          <h4>{copy("lifecycle.cohortTitle", { country: data.country, month: String(data.cohortMonth).slice(0, 7) })}</h4>
          {data.cohortState === "restricted" && <p>{copy("lifecycle.regionRestricted")}</p>}
          {data.cohort && (
            <div className="c360u-cards">
              <section className="c360u-card">
                <h4>{copy("lifecycle.countryCohort", { country: data.country })}</h4>
                <Distribution dist={data.cohort.countryCohort} copy={copy} label={copy("lifecycle.countryCohort", { country: data.country })} />
              </section>
              <section className="c360u-card">
                <h4>{copy("lifecycle.platformCohort")}</h4>
                <Distribution dist={data.cohort.platformCohort} copy={copy} label={copy("lifecycle.platformCohort")} />
              </section>
            </div>
          )}
        </>
      )}
      {data && data.cohortState !== "restricted" && (
        <section>
          <h4>{copy("lifecycle.compareTitle")}</h4>
          <form className="c360u-row" onSubmit={compare}>
            <label>
              {copy("lifecycle.countries")}
              <input value={countries} maxLength={20} dir="ltr" onChange={(e) => setCountries(e.target.value)} />
            </label>
            <label>
              {copy("lifecycle.months")}
              <select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                {[3, 6, 12, 24].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <button type="submit">{copy("lifecycle.compare")}</button>
          </form>
          {cmpState === "loading" && <p role="status">{copy("loading")}</p>}
          {cmpState === "invalid" && <p role="alert">{copy("lifecycle.invalidCountries")}</p>}
          {cmpState === "restricted" && <p role="alert">{copy("lifecycle.regionRestricted")}</p>}
          {cmpState === "error" && <p role="alert">{copy("loadFailed")}</p>}
          {cmp && cmpState === "ready" && (
            <div className="c360u-scroll">
              <table data-compare="countries">
                <caption>{copy("lifecycle.compareCaption", { months: cmp.months, min: cmp.minCell })}</caption>
                <thead>
                  <tr>
                    <th scope="col">{copy("lifecycle.country")}</th>
                    <th scope="col">{copy("lifecycle.customers")}</th>
                    {cmp.stages.map((s) => <th key={s} scope="col">{copy(`lifecycle.stages.${s}`)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {cmp.countries.map((c) => (
                    <tr key={c.country}>
                      <th scope="row"><bdi>{c.country}</bdi></th>
                      <td>{c.suppressed ? copy("lifecycle.small") : c.total}</td>
                      {cmp.stages.map((s) => (
                        <td key={s}>{c.suppressed || c.stages[s]?.suppressed ? "—" : `${c.stages[s].share}%`}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {cmp.computedAt && <p className="c360w-meta">{copy("lifecycle.statsAt", { time: when(cmp.computedAt) })}</p>}
            </div>
          )}
        </section>
      )}
    </article>
  );
}
