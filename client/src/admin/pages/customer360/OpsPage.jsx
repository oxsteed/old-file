import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../../hooks/useAuth";
import { adminRoute } from "../../adminRouteManifest";
import TeamBoard from "./upgrades/TeamBoard";
import AnomalyQueue from "./upgrades/AnomalyQueue";
import SummaryHealth from "./upgrades/SummaryHealth";
import "./workspace.css";

export const OPS_VIEWS = Object.freeze({
  queues: "customer360Queues",
  anomalies: "customer360Anomalies",
  summaries: "customer360Summaries",
});

/**
 * Gap fills 6-8: Customer 360 work that is not about one customer — the
 * team queue board, the platform anomaly list and summary health — as
 * standalone admin pages that share one tab bar.
 */
export default function OpsPage({ view = "queues" }) {
  const { t, i18n } = useTranslation();
  const copy = (key, options) => t(`customerWorkspace.${key}`, options);
  const lang = i18n.resolvedLanguage || i18n.language || "en";
  const { user: admin } = useAuth();
  const isSuper = admin?.role === "super_admin";
  const when = (v) => {
    if (!v) return copy("unknown");
    const d = new Date(v);
    return Number.isNaN(d.getTime())
      ? copy("unknown")
      : new Intl.DateTimeFormat(lang === "ht" ? "fr-HT" : lang, { dateStyle: "medium", timeStyle: "short" }).format(d);
  };
  return (
    <section className="c360w" data-page="customer360-ops" data-view={view}>
      <h2>{copy("ops.title")}</h2>
      <p className="c360w-note">{copy("ops.hint")}</p>
      <nav aria-label={copy("ops.title")} className="c360u-row">
        {Object.entries(OPS_VIEWS).map(([key, route]) => (
          <NavLink key={key} to={adminRoute(route).path} data-ops-tab={key}>
            {copy(`ops.tabs.${key}`)}
          </NavLink>
        ))}
      </nav>
      {view === "queues" && (
        <article className="c360u" data-panel="team-board">
          <h3>{copy("queues.title")}</h3>
          <p className="c360w-note">{copy("ops.queuesHint")}</p>
          <TeamBoard copy={copy} when={when} viewerKey={admin?.id || "admin"} isSuper={isSuper} headingId="c360-ops-board" />
        </article>
      )}
      {view === "anomalies" && <AnomalyQueue copy={copy} when={when} />}
      {view === "summaries" && <SummaryHealth copy={copy} when={when} />}
    </section>
  );
}
