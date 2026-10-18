import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import adminApi from "../../lib/adminApi";
import { useAbortableFetch } from "../../lib/useAbortableFetch";
import { useHasGrant } from "../../lib/GrantGuard";
import { useAuth } from "../../../hooks/useAuth";
import ConfirmDialog from "../../lib/ConfirmDialog";
import {
  AREAS,
  ISSUE_STATUSES,
  connectionState,
  moneyMinor,
  moneyMajor,
  recordRoute,
  sectionTimeline,
  selectedRecords,
} from "./model";
import "./workspace.css";
const CreditDetail = lazy(() => import("../super/OxsteedCreditCustomerDetail"));
const GUIDES = [
  "verification",
  "refund",
  "credit",
  "payout",
  "foodOrder",
  "statements",
  "duplicate",
  "security",
];
const K = "customerWorkspace";
function Modal({ title, onClose, children }) {
  const ref = useRef(null),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prior = document.activeElement;
    const dialog = ref.current;
    dialog.showModal();
    const close = (e) => {
      e.preventDefault();
      closeRef.current();
    };
    const trap = (e) => {
      if (e.key !== "Tab") return;
      const items = [
        ...dialog.querySelectorAll(
          'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
        ),
      ].filter((el) => el.getClientRects().length);
      const first = items[0],
        last = items.at(-1);
      if (!first) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("cancel", close);
    dialog.addEventListener("keydown", trap);
    return () => {
      dialog.removeEventListener("cancel", close);
      dialog.removeEventListener("keydown", trap);
      dialog.close();
      prior?.focus?.();
    };
  }, []);
  const { t } = useTranslation();
  return (
    <dialog
      ref={ref}
      className="c360w-dialog"
      aria-labelledby="c360w-modal-title"
    >
      <div className="c360w">
        <header>
          <h2 id="c360w-modal-title">{title}</h2>
          <button type="button" onClick={onClose} autoFocus>
            {t(`${K}.close`)}
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
function Download({ blob, name }) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function Workspace({ user, existingTimeline = [] }) {
  const { t, i18n } = useTranslation();
  const copy = (key, options) => t(`${K}.${key}`, options);
  const lang = i18n.resolvedLanguage || i18n.language || "en";
  const { user: admin } = useAuth();
  const { allowed: canRefund } = useHasGrant("issue_refunds");
  const isSuper = admin?.role === "super_admin";
  const viewerKey = `${user.id}:${admin?.id || ""}`;
  const [params, setParams] = useSearchParams();
  const area = AREAS.includes(params.get("area"))
    ? params.get("area")
    : "attention";
  const source = params.get("source") || "";
  const applied = {
    q: params.get("c360_q") || "",
    from: params.get("c360_from") || "",
    to: params.get("c360_to") || "",
  };
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const [draft, setDraft] = useState(applied),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [selected, setSelected] = useState(null),
    [confirm, setConfirm] = useState(null),
    [more, setMore] = useState({});
  const [taskTitle, setTaskTitle] = useState(""),
    [due, setDue] = useState(""),
    [priority, setPriority] = useState("normal"),
    [taskStatus, setTaskStatus] = useState("in_progress"),
    [assignee, setAssignee] = useState(""),
    [resolution, setResolution] = useState("");
  const [alertSource, setAlertSource] = useState(""),
    [alertStatus, setAlertStatus] = useState("pending"),
    [alertAge, setAlertAge] = useState(0),
    [alertRules, setAlertRules] = useState([]);
  const [purpose, setPurpose] = useState(""),
    [exportSources, setExportSources] = useState([]),
    [report, setReport] = useState(null),
    [assistant, setAssistant] = useState(null);
  const keys = useRef(new Map());
  const controller = useRef(null),
    identity = useRef(viewerKey);
  identity.current = viewerKey;
  const api = `/admin/users/${user.id}/workspace`;
  const {
    data: raw,
    loading,
    error: loadError,
    reload,
  } = useAbortableFetch(
    async (signal) =>
      (await adminApi.get(api, { signal, params: { ...applied, limit: 5 } }))
        .data,
    [user.id, admin?.id, applied.q, applied.from, applied.to],
  );
  // A prior customer's records must never remain actionable during navigation.
  const data =
    !loadError && raw?.userId === user.id && raw?.viewerId === admin?.id
      ? raw
      : null;
  useEffect(() => {
    setMore({});
    setSelected(null);
    setConfirm(null);
    setReport(null);
    setAssistant(null);
    setAlertRules([]);
    setExportSources([]);
    setTaskTitle("");
    setNotice("");
    setError("");
    setPurpose("");
    setBusy(false);
    controller.current?.abort();
    return () => controller.current?.abort();
  }, [viewerKey]);
  useEffect(() => {
    setMore({});
    setDraft(applied);
  }, [applied.q, applied.from, applied.to]);
  useEffect(() => {
    if (area !== "cases") return;
    const c = new AbortController();
    adminApi
      .get(`${api}/alerts`, { signal: c.signal })
      .then((r) => setAlertRules(r.data.rules || []))
      .catch((e) => {
        if (!c.signal.aborted) setError(copy("actionFailed"));
      });
    return () => c.abort();
  }, [area, user.id]);
  const act = async (fn) => {
    if (busy) return;
    const id = viewerKey;
    const c = new AbortController();
    controller.current?.abort();
    controller.current = c;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn(c.signal);
      if (identity.current === id && !c.signal.aborted) {
        setNotice(copy("saved"));
        reload();
      }
    } catch (e) {
      if (identity.current === id && !c.signal.aborted)
        setError(
          copy(
            e.response?.data?.code === "revision_conflict"
              ? "conflict"
              : "actionFailed",
          ),
        );
    } finally {
      if (identity.current === id && !c.signal.aborted) setBusy(false);
    }
  };
  const choose = (next, key = "") => {
    const p = new URLSearchParams(params);
    p.set("area", next);
    key ? p.set("source", key) : p.delete("source");
    setParams(p, { replace: true });
  };
  const sections = useMemo(
    () => ({ ...data?.sections, ...more }),
    [data, more],
  );
  const ordered = useMemo(
    () =>
      Object.values(sections).sort(
        (a, b) => a.area.localeCompare(b.area) || a.key.localeCompare(b.key),
      ),
    [sections],
  );
  const timeline = useMemo(
    () =>
      sectionTimeline(sections).sort(
        (a, b) => new Date(b.occurred_at) - new Date(a.occurred_at),
      ),
    [sections, existingTimeline],
  );
  const ready = ordered.filter((s) => s.state === "ready");
  const show = selectedRecords({ sections }, area, source).sort(
    (a, b) => a.area.localeCompare(b.area) || a.key.localeCompare(b.key),
  );
  const when = (v) => {
    if (!v) return copy("unknown");
    const d = new Date(v);
    return Number.isNaN(d.getTime())
      ? copy("unknown")
      : new Intl.DateTimeFormat(lang === "ht" ? "fr-HT" : lang, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(d);
  };
  const label = (s, r) =>
    [
      "jobs",
      "businesses",
      "restaurants",
      "quotes",
      "bookings",
      "tickets",
      "conversations",
      "tasks",
      "campaigns",
    ].includes(s.key)
      ? r.label
      : copy(`sources.${s.key}`);
  const status = (v) =>
    t(`${K}.statuses.${v}`, {
      defaultValue: String(v || copy("unknown")).replace(/_/g, " "),
    });
  const open = (section, record) => {
    setAssignee("");
    setResolution("");
    setTaskStatus(record.status === "open" ? "in_progress" : "open");
    setSelected({ section, record });
  };
  const loadPage = (s, offset) =>
    act(async (signal) => {
      const r = await adminApi.get(api, {
        signal,
        params: { ...applied, source: s.key, limit: 25, offset },
      });
      if (identity.current === viewerKey)
        setMore((old) => ({ ...old, [s.key]: r.data.sections[s.key] }));
    });
  const createTask = (s, r, title = taskTitle) =>
    act(async (signal) => {
      const intent = JSON.stringify({
        title,
        priority,
        due,
        source: s?.key,
        id: r?.id,
        userId: user.id,
      });
      if (!keys.current.has(intent))
        keys.current.set(intent, crypto.randomUUID());
      await adminApi.post(
        `${api}/tasks`,
        {
          title,
          priority,
          dueAt: due ? new Date(due).toISOString() : null,
          idempotencyKey: keys.current.get(intent),
          relatedSource: s?.key || null,
          relatedId: r?.id || null,
        },
        { signal },
      );
      keys.current.delete(intent);
      if (identity.current === viewerKey) setTaskTitle("");
    });
  const requestConfirm = (kind, s, r) => {
    setSelected(null);
    setConfirm({
      kind,
      section: s,
      record: r,
      key: crypto.randomUUID(),
      viewerKey,
    });
  };
  const confirmAction = async (reason) => {
    if (!confirm || confirm.viewerKey !== viewerKey)
      throw new Error(copy("actionFailed"));
    const id = viewerKey,
      c = new AbortController();
    controller.current?.abort();
    controller.current = c;
    let response;
    if (confirm.kind === "revoke")
      response = await adminApi.post(
        `${api}/sessions/${confirm.record.id}/revoke`,
        { reason },
        { signal: c.signal },
      );
    if (confirm.kind === "refund")
      response = await adminApi.post(
        `/admin/food-orders/${confirm.record.id}/refund`,
        { reason },
        { headers: { "Idempotency-Key": confirm.key }, signal: c.signal },
      );
    if (confirm.kind === "refundMarketplace")
      response = await adminApi.post(
        `/admin/orders/${confirm.record.id}/refund`,
        { reason, fullRefund: true },
        { headers: { "Idempotency-Key": confirm.key }, signal: c.signal },
      );
    if (confirm.kind === "cancelBooking")
      response = await adminApi.post(
        `/agent/bookings/${confirm.record.id}/cancel`,
        { reason },
        { signal: c.signal },
      );
    if (confirm.kind === "cancelJob")
      response = await adminApi.post(
        `/admin/jobs/${confirm.record.id}/cancel`,
        { reason },
        { signal: c.signal },
      );
    if (confirm.kind === "complete")
      response = await adminApi.patch(
        `${api}/tasks/${confirm.record.id}`,
        {
          status: "completed",
          resolution: reason,
          revision: confirm.record.revision,
        },
        { signal: c.signal },
      );
    if (identity.current === id && !c.signal.aborted) {
      setNotice(copy(response?.status === 202 ? "pendingApproval" : "saved"));
      setMore({});
      reload();
      setSelected(null);
    }
  };
  const exportReport = (format) =>
    act(async (signal) => {
      const result = await adminApi.post(
        `${api}/export`,
        { purpose, sources: exportSources, filters: applied, format },
        { signal, responseType: format === "csv" ? "blob" : "json" },
      );
      if (identity.current !== viewerKey) return;
      if (format === "csv")
        Download({ blob: result.data, name: "customer360.csv" });
      else if (format === "json")
        Download({
          blob: new Blob([JSON.stringify(result.data, null, 2)], {
            type: "application/json",
          }),
          name: "customer360.json",
        });
      else setReport(result.data);
    });
  const alert = (rule) =>
    act(async (signal) => {
      await adminApi.put(`${api}/alerts`, rule, { signal });
      const r = await adminApi.get(`${api}/alerts`, { signal });
      if (identity.current === viewerKey) setAlertRules(r.data.rules);
    });
  return (
    <section className="c360w" aria-labelledby="c360w-title">
      <header>
        <div>
          <p className="c360w-eyebrow">{copy("eyebrow")}</p>
          <h2 id="c360w-title">{copy("title")}</h2>
          <p>{copy("description")}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setMore({});
            reload();
          }}
          disabled={loading}
        >
          {copy("refresh")}
        </button>
      </header>
      <form
        className="c360w-filters"
        onSubmit={(e) => {
          e.preventDefault();
          const p = new URLSearchParams(params);
          for (const k of ["q", "from", "to"])
            draft[k] ? p.set(`c360_${k}`, draft[k]) : p.delete(`c360_${k}`);
          setParams(p, { replace: true });
        }}
      >
        <label>
          {copy("search")}
          <input
            type="search"
            value={draft.q}
            maxLength={120}
            onChange={(e) => setDraft({ ...draft, q: e.target.value })}
          />
        </label>
        <label>
          {copy("from")}
          <input
            type="date"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </label>
        <label>
          {copy("to")}
          <input
            type="date"
            value={draft.to}
            min={draft.from || undefined}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </label>
        <button>{copy("apply")}</button>
      </form>
      <nav className="c360w-areas" aria-label={copy("navigation")}>
        {[
          "attention",
          "timeline",
          "cases",
          "eligibility",
          "guides",
          "assistant",
          "exports",
          "all",
        ].map((a) => (
          <button
            type="button"
            key={a}
            aria-pressed={area === a}
            onClick={() => choose(a)}
          >
            {copy(`areas.${a}`)}
          </button>
        ))}
        <label>
          {copy("navigation")}
          <select
            aria-label={copy("navigation")}
            value={area}
            onChange={(e) => choose(e.target.value)}
          >
            {AREAS.map((a) => (
              <option key={a} value={a}>
                {copy(`areas.${a}`)}
              </option>
            ))}
          </select>
        </label>
      </nav>
      {loadError && (
        <p role="alert">
          {copy("loadFailed")}{" "}
          <button type="button" onClick={reload}>
            {copy("retry")}
          </button>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {(loading || !data) && !loadError ? (
        <p role="status">{copy("loading")}</p>
      ) : (
        data && (
          <>
            <p className="c360w-meta">
              {copy("asOf", { time: when(data.generatedAt) })} ·{" "}
              {copy("coverage", { ready: ready.length, total: ordered.length })}
            </p>
            <p className="c360w-note">{copy("scopeNotice")}</p>
            {clock - new Date(data.generatedAt).getTime() > 60000 && (
              <p role="status">{copy("stale")}</p>
            )}
            {["all", "attention"].includes(area) && (
              <article>
                <h3>{copy("attention")}</h3>
                <p>{copy("attentionHint")}</p>
                <div className="c360w-grid">
                  {ready
                    .filter((s) =>
                      s.groups.some((g) => ISSUE_STATUSES.has(g.status)),
                    )
                    .map((s) => (
                      <button
                        type="button"
                        key={s.key}
                        onClick={() => choose(s.area, s.key)}
                      >
                        <strong>{copy(`sources.${s.key}`)}</strong>
                        <span>
                          {s.groups
                            .filter((g) => ISSUE_STATUSES.has(g.status))
                            .map(
                              (g) =>
                                `${g.participant_role ? status(g.participant_role) + " · " : ""}${status(g.status)}: ${g.count}`,
                            )
                            .join(" · ")}
                        </span>
                      </button>
                    ))}
                </div>
                {!ready.some((s) =>
                  s.groups.some((g) => ISSUE_STATUSES.has(g.status)),
                ) && <p>{copy("noMatchingAttention")}</p>}
              </article>
            )}
            {area === "experience" && (
              <article>
                <h3>{copy("experience")}</h3>
                <p>{copy("experienceHint")}</p>
                <div className="c360w-grid">
                  {ready
                    .filter((s) =>
                      [
                        "jobs",
                        "foodOrders",
                        "marketplaceOrders",
                        "reviews",
                        "tickets",
                        "conversations",
                      ].includes(s.key),
                    )
                    .map((s) => (
                      <article key={s.key}>
                        <h4>{copy(`sources.${s.key}`)}</h4>
                        <dl>
                          {[
                            "activeDays",
                            "last30Count",
                            "ratingCount",
                            "averageRating",
                          ].map((k) => (
                            <div key={k}>
                              <dt>{copy(`metrics.${k}`)}</dt>
                              <dd>{s.statistics?.[k] ?? copy("unknown")}</dd>
                            </div>
                          ))}
                          <div>
                            <dt>{copy("metrics.firstAt")}</dt>
                            <dd>{when(s.statistics?.firstAt)}</dd>
                          </div>
                          <div>
                            <dt>{copy("metrics.lastAt")}</dt>
                            <dd>{when(s.statistics?.lastAt)}</dd>
                          </div>
                        </dl>
                        <button
                          type="button"
                          onClick={() => choose(s.area, s.key)}
                        >
                          {copy("openFull")}
                        </button>
                      </article>
                    ))}
                </div>
              </article>
            )}
            {area === "quality" && (
              <article>
                <h3>{copy("quality")}</h3>
                <p>{copy("qualityHint")}</p>
                <ul>
                  {ordered.map((s) => (
                    <li key={s.key}>
                      <strong>{copy(`sources.${s.key}`)}</strong>:{" "}
                      {copy(s.state)} ·{" "}
                      {s.state === "ready"
                        ? copy("loaded", {
                            count: s.records.length,
                            total: s.total,
                          })
                        : copy("unknown")}{" "}
                      · {s.fetchedAt ? when(s.fetchedAt) : copy("unknown")}
                    </li>
                  ))}
                </ul>
              </article>
            )}
            {area === "eligibility" && (
              <article>
                <h3>{copy("eligibility")}</h3>
                <p>{copy("eligibilityHint")}</p>
                <div className="c360w-grid">
                  {["listing", "work"].map((k) => (
                    <article key={k}>
                      <h4>{copy(k)}</h4>
                      <p>
                        {copy(
                          data.eligibility.helper.applicable
                            ? data.eligibility.helper[k]
                              ? "eligible"
                              : "blocked"
                            : "notApplicable",
                        )}
                      </p>
                      <p>
                        {data.eligibility.helper.missing
                          .map((m) => copy(`checks.${m}`))
                          .join(" · ")}
                      </p>
                    </article>
                  ))}
                </div>
                <dl>
                  {Object.entries(data.eligibility.identity).map(([k, v]) => (
                    <div key={k}>
                      <dt>{copy(`checks.${k}`)}</dt>
                      <dd>
                        {typeof v === "boolean"
                          ? copy(v ? "yes" : "no")
                          : status(v)}
                      </dd>
                    </div>
                  ))}
                </dl>
                <dl>
                  {Object.entries({
                    accountActive: data.eligibility.restrictions?.active,
                    accountSuspended: data.eligibility.restrictions?.suspended,
                    accountRestricted:
                      data.eligibility.restrictions?.restricted,
                    taxComplete: data.eligibility.payout?.taxComplete,
                  }).map(([k, v]) => (
                    <div key={k}>
                      <dt>{copy(`checks.${k}`)}</dt>
                      <dd>
                        {v == null ? copy("unknown") : copy(v ? "yes" : "no")}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p>{copy("backgroundPolicy")}</p>
                <p>{copy("accountAccess")}</p>
              </article>
            )}
            {area === "timeline" && (
              <article>
                <h3>{copy("timeline")}</h3>
                <p>{copy("timelineHint")}</p>
                <ol className="c360w-timeline">
                  {timeline.map((r, i) => (
                    <li key={`${r.source}-${r.id}-${i}`}>
                      <time>{when(r.occurred_at)}</time>
                      <button
                        type="button"
                        onClick={() =>
                          r.legacy ? choose("all") : open(sections[r.source], r)
                        }
                      >
                        {r.legacy ? r.label : label(sections[r.source], r)}
                      </button>
                      <span>{status(r.status)}</span>
                    </li>
                  ))}
                </ol>
              </article>
            )}
            {area === "cases" && (
              <>
                <article>
                  <h3>{copy("newTask")}</h3>
                  <form
                    className="c360w-filters"
                    onSubmit={(e) => {
                      e.preventDefault();
                      createTask();
                    }}
                  >
                    <label>
                      {copy("taskTitle")}
                      <input
                        required
                        maxLength={240}
                        value={taskTitle}
                        onChange={(e) => setTaskTitle(e.target.value)}
                      />
                    </label>
                    <label>
                      {copy("priority")}
                      <select
                        value={priority}
                        onChange={(e) => setPriority(e.target.value)}
                      >
                        {["normal", "high", "urgent"].map((v) => (
                          <option key={v} value={v}>
                            {copy(`statuses.${v}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {copy("due")}
                      <input
                        type="datetime-local"
                        value={due}
                        onChange={(e) => setDue(e.target.value)}
                      />
                    </label>
                    <button disabled={busy || !taskTitle.trim()}>
                      {copy("createTask")}
                    </button>
                  </form>
                  <p>{copy("taskHint")}</p>
                </article>
                <article>
                  <h3>{copy("alerts")}</h3>
                  <form
                    className="c360w-filters"
                    onSubmit={(e) => {
                      e.preventDefault();
                      alert({
                        source: alertSource,
                        statuses: alertStatus
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                        minAgeMinutes: Number(alertAge),
                        enabled: true,
                      });
                    }}
                  >
                    <label>
                      {copy("source")}
                      <select
                        aria-label={copy("source")}
                        required
                        value={alertSource}
                        onChange={(e) => setAlertSource(e.target.value)}
                      >
                        <option value="">{copy("chooseSource")}</option>
                        {ready.map((s) => (
                          <option key={s.key} value={s.key}>
                            {copy(`sources.${s.key}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {copy("statusesLabel")}
                      <input
                        required
                        value={alertStatus}
                        onChange={(e) => setAlertStatus(e.target.value)}
                      />
                    </label>
                    <label>
                      {copy("age")}
                      <input
                        type="number"
                        min="0"
                        max="43200"
                        value={alertAge}
                        onChange={(e) => setAlertAge(e.target.value)}
                      />
                    </label>
                    <button disabled={busy}>{copy("saveRule")}</button>
                  </form>
                  <p>{copy("alertHint")}</p>
                  <ul>
                    {alertRules.map((rule) => (
                      <li key={rule.id}>
                        {copy(`sources.${rule.source}`)} ·{" "}
                        {rule.statuses.map(status).join(", ")} ·{" "}
                        {copy(rule.enabled ? "enabled" : "disabled")}{" "}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            alert({
                              source: rule.source,
                              statuses: rule.statuses,
                              minAgeMinutes: rule.min_age_minutes,
                              enabled: !rule.enabled,
                            })
                          }
                        >
                          {copy(rule.enabled ? "disable" : "enable")}
                        </button>
                      </li>
                    ))}
                  </ul>
                </article>
              </>
            )}
            {area === "guides" && (
              <article>
                <h3>{copy("guides")}</h3>
                <p>{copy("guidesHint")}</p>
                <div className="c360w-grid">
                  {GUIDES.map((g) => (
                    <details key={g}>
                      <summary>{copy(`guidesCopy.${g}.title`)}</summary>
                      <ol>
                        {[1, 2, 3, 4].map((step) => (
                          <li key={step}>
                            {copy(`guidesCopy.${g}.step${step}`)}
                          </li>
                        ))}
                      </ol>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          createTask(null, null, copy(`guidesCopy.${g}.title`))
                        }
                      >
                        {copy("createTask")}
                      </button>
                    </details>
                  ))}
                </div>
                <Link to="/how-it-works/guides">{copy("visualGuides")}</Link>
              </article>
            )}
            {area === "assistant" && (
              <article>
                <h3>{copy("assistant")}</h3>
                <p>{copy("assistantHint")}</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    act(async (signal) => {
                      const r = await adminApi.post(
                        `${api}/assistant`,
                        { language: lang.split("-")[0] },
                        { signal },
                      );
                      if (identity.current === viewerKey) setAssistant(r.data);
                    })
                  }
                >
                  {copy("generate")}
                </button>
                {assistant && (
                  <>
                    <p>{copy("draftWarning")}</p>
                    {assistant.draft ? (
                      <p className="c360w-draft">{assistant.draft}</p>
                    ) : (
                      <p>{copy("providerUnavailable")}</p>
                    )}
                    <ul>
                      {assistant.evidence.map((e) => (
                        <li key={e.source}>
                          <button
                            type="button"
                            onClick={() =>
                              choose(
                                sections[e.source]?.area || "all",
                                e.source,
                              )
                            }
                          >
                            {copy(`sources.${e.source}`)}
                          </button>
                          : {e.total ?? copy(e.state)}{" "}
                          {e.groups
                            ?.map(
                              (g) =>
                                `${g.participant_role ? status(g.participant_role) + " · " : ""}${status(g.status)}: ${g.count}`,
                            )
                            .join(" · ")}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </article>
            )}
            {area === "exports" && (
              <article>
                <h3>{copy("exports")}</h3>
                <p>{copy("exportHint")}</p>
                <label>
                  {copy("purpose")}
                  <textarea
                    required
                    minLength={5}
                    maxLength={500}
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                  />
                </label>
                <fieldset>
                  <legend>{copy("chooseSources")}</legend>
                  <div className="c360w-grid">
                    {ready.map((s) => (
                      <label key={s.key}>
                        <input
                          type="checkbox"
                          checked={exportSources.includes(s.key)}
                          onChange={(e) =>
                            setExportSources((old) =>
                              e.target.checked
                                ? [...old, s.key]
                                : old.filter((k) => k !== s.key),
                            )
                          }
                        />
                        {copy(`sources.${s.key}`)}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="c360w-actions">
                  {["csv", "json", "print"].map((format) => (
                    <button
                      type="button"
                      key={format}
                      disabled={
                        busy ||
                        purpose.trim().length < 5 ||
                        !exportSources.length
                      }
                      onClick={() => exportReport(format)}
                    >
                      {copy(`export_${format}`)}
                    </button>
                  ))}
                </div>
              </article>
            )}
            {![
              "attention",
              "timeline",
              "eligibility",
              "guides",
              "assistant",
              "exports",
              "experience",
              "quality",
            ].includes(area) && (
              <div className="c360w-grid c360w-sections">
                {show.map((s) => (
                  <article key={s.key} data-source={s.key}>
                    <header>
                      <h3>{copy(`sources.${s.key}`)}</h3>
                      <span>
                        {s.state === "ready"
                          ? copy("total", { count: s.total })
                          : copy(s.state)}
                      </span>
                    </header>
                    {s.state === "ready" ? (
                      <>
                        <p className="c360w-meta">
                          {copy("loaded", {
                            count: s.records.length,
                            total: s.total,
                          })}
                        </p>
                        {s.groups.some(
                          (g) =>
                            g.recorded_amount_cents != null ||
                            g.recorded_amount_major != null,
                        ) && (
                          <details>
                            <summary>{copy("recordedTotals")}</summary>
                            <p>{copy("recordedTotalsHint")}</p>
                            {s.groups
                              .filter(
                                (g) =>
                                  g.recorded_amount_cents != null ||
                                  g.recorded_amount_major != null,
                              )
                              .map((g) => (
                                <p
                                  key={`${g.status}-${g.currency_code}-${g.participant_role || ""}`}
                                >
                                  {g.participant_role
                                    ? `${status(g.participant_role)} · `
                                    : ""}
                                  {status(g.status)} ·{" "}
                                  {g.currency_code
                                    ? g.recorded_amount_major != null
                                      ? moneyMajor(
                                          g.recorded_amount_major,
                                          g.currency_code,
                                          lang,
                                        )
                                      : moneyMinor(
                                          g.recorded_amount_cents,
                                          g.currency_code,
                                          lang,
                                        )
                                    : copy("unknownCurrency", {
                                        value:
                                          g.recorded_amount_cents ??
                                          g.recorded_amount_major,
                                      })}
                                </p>
                              ))}
                          </details>
                        )}
                        <ul className="c360w-records">
                          {s.records.map((r) => (
                            <li key={r.id}>
                              <button type="button" onClick={() => open(s, r)}>
                                <strong>{label(s, r)}</strong>
                                <span>
                                  <bdi>#{r.id}</bdi> · {when(r.occurred_at)}
                                </span>
                                <span>
                                  {status(r.status)}
                                  {r.amount_cents != null && r.currency_code
                                    ? ` · ${moneyMinor(r.amount_cents, r.currency_code, lang)}`
                                    : ""}
                                </span>
                                {s.key === "devices" && (
                                  <span>
                                    {copy(`statuses.${connectionState(r)}`)} ·{" "}
                                    {copy("config", {
                                      applied: r.applied_config_version ?? 0,
                                      current: r.config_version ?? 0,
                                    })}
                                  </span>
                                )}
                              </button>
                            </li>
                          ))}
                        </ul>
                        {!s.records.length && <p>{copy("empty")}</p>}
                        <div className="c360w-actions">
                          <button
                            type="button"
                            disabled={busy || s.offset === 0}
                            onClick={() =>
                              loadPage(s, Math.max(0, s.offset - 25))
                            }
                          >
                            {copy("previous")}
                          </button>
                          <button
                            type="button"
                            disabled={busy || !s.hasMore}
                            onClick={() =>
                              loadPage(s, s.offset + s.records.length)
                            }
                          >
                            {copy("next")}
                          </button>
                        </div>
                      </>
                    ) : (
                      <p>
                        {copy(
                          s.state === "restricted"
                            ? "restrictedHint"
                            : "unavailableHint",
                        )}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </>
        )
      )}
      {selected && data && (
        <Modal
          key={user.id}
          title={label(selected.section, selected.record)}
          onClose={() => setSelected(null)}
        >
          <p>
            {copy("recordEvidence", {
              source: selected.section.source,
              id: selected.record.id,
            })}
          </p>
          <dl>
            {Object.entries(selected.record)
              .filter(([k]) => !["label"].includes(k))
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{copy(`fields.${k}`)}</dt>
                  <dd dir="auto">
                    {v == null
                      ? copy("unknown")
                      : typeof v === "boolean"
                        ? copy(v ? "yes" : "no")
                        : typeof v === "object"
                          ? JSON.stringify(v, null, 2)
                          : String(v)}
                  </dd>
                </div>
              ))}
          </dl>
          <div className="c360w-actions">
            {Object.entries(selected.record)
              .filter(
                ([k, v]) =>
                  [
                    "client_id",
                    "assigned_helper_id",
                    "payer_id",
                    "payee_id",
                    "reviewer_id",
                    "reviewee_id",
                    "owner_user_id",
                  ].includes(k) &&
                  /^[0-9a-f-]{36}$/i.test(String(v)) &&
                  String(v) !== user.id,
              )
              .map(([k, v]) => (
                <Link key={k} to={`/admin/customers/${v}/360`}>
                  {copy(`fields.${k}`)}
                </Link>
              ))}
            {recordRoute(selected.section, selected.record, user.id) && (
              <Link
                to={recordRoute(selected.section, selected.record, user.id)}
              >
                {copy("openFull")}
              </Link>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                createTask(
                  selected.section,
                  selected.record,
                  `${copy(`sources.${selected.section.key}`)} #${selected.record.id}`,
                )
              }
            >
              {copy("createTask")}
            </button>
            {selected.section.key === "sessions" &&
              isSuper &&
              selected.record.status === "active" && (
                <button
                  type="button"
                  onClick={() =>
                    requestConfirm("revoke", selected.section, selected.record)
                  }
                >
                  {copy("revoke")}
                </button>
              )}
            {selected.section.key === "foodOrders" &&
              canRefund &&
              ["paid", "partially_refunded"].includes(
                selected.record.payment_status,
              ) && (
                <button
                  type="button"
                  onClick={() =>
                    requestConfirm("refund", selected.section, selected.record)
                  }
                >
                  {copy("refund")}
                </button>
              )}
            {selected.section.key === "marketplaceOrders" &&
              canRefund &&
              [
                "paid",
                "processing",
                "shipped",
                "completed",
                "partially_refunded",
              ].includes(selected.record.status) && (
                <button
                  type="button"
                  onClick={() =>
                    requestConfirm(
                      "refundMarketplace",
                      selected.section,
                      selected.record,
                    )
                  }
                >
                  {copy("refund")}
                </button>
              )}
            {selected.section.key === "bookings" &&
              canRefund &&
              ["pending", "accepted"].includes(selected.record.status) && (
                <button
                  type="button"
                  onClick={() =>
                    requestConfirm(
                      "cancelBooking",
                      selected.section,
                      selected.record,
                    )
                  }
                >
                  {t("common.cancel")}
                </button>
              )}
            {selected.section.key === "jobs" &&
              canRefund &&
              !["cancelled", "closed", "completed"].includes(
                selected.record.status,
              ) && (
                <button
                  type="button"
                  onClick={() =>
                    requestConfirm(
                      "cancelJob",
                      selected.section,
                      selected.record,
                    )
                  }
                >
                  {t("common.cancel")}
                </button>
              )}
            {selected.section.key === "creditDeliveries" &&
              isSuper &&
              ["failed", "pending"].includes(selected.record.status) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    act((signal) =>
                      adminApi.post(
                        `/admin/super/oxsteed-credit/notifications/${selected.record.id}/retry`,
                        {},
                        { signal },
                      ),
                    )
                  }
                >
                  {copy("retry")}
                </button>
              )}
            {selected.section.key === "tasks" &&
              !["completed", "cancelled"].includes(selected.record.status) && (
                <button
                  type="button"
                  onClick={() =>
                    requestConfirm(
                      "complete",
                      selected.section,
                      selected.record,
                    )
                  }
                >
                  {copy("complete")}
                </button>
              )}
          </div>
          {selected.section.key === "tasks" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                act(async (signal) => {
                  await adminApi.patch(
                    `${api}/tasks/${selected.record.id}`,
                    {
                      status: taskStatus,
                      assignedTo: assignee || undefined,
                      resolution,
                      revision: selected.record.revision,
                    },
                    { signal },
                  );
                  if (identity.current === viewerKey) {
                    setSelected(null);
                    setMore({});
                  }
                });
              }}
            >
              <h3>{copy("assign")}</h3>
              <label>
                {copy("assignee")}
                <input
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  pattern="[0-9a-fA-F-]{36}"
                  placeholder={selected.record.assigned_to}
                />
              </label>
              <label>
                {copy("status")}
                <select
                  value={taskStatus}
                  onChange={(e) => setTaskStatus(e.target.value)}
                >
                  {["open", "in_progress", "completed", "cancelled"].map(
                    (v) => (
                      <option key={v} value={v}>
                        {status(v)}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                {copy("resolution")}
                <textarea
                  value={resolution}
                  minLength={
                    ["completed", "cancelled"].includes(taskStatus)
                      ? 3
                      : undefined
                  }
                  required={["completed", "cancelled"].includes(taskStatus)}
                  maxLength={2000}
                  onChange={(e) => setResolution(e.target.value)}
                />
              </label>
              <button disabled={busy}>{copy("updateTask")}</button>
            </form>
          )}
          {selected.section.key === "restaurantWallets" && isSuper && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                act(async (signal) => {
                  const now = new Date();
                  const from =
                    applied.from ||
                    new Date(
                      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
                    )
                      .toISOString()
                      .slice(0, 10);
                  const to = applied.to || now.toISOString().slice(0, 10);
                  const r = await adminApi.get(
                    `/admin/super/restaurant-credit/accounts/${user.id}/${selected.record.restaurant_id}/statements.pdf`,
                    {
                      signal,
                      responseType: "blob",
                      params: {
                        from,
                        to,
                        currencyCode: selected.record.currency_code,
                        language: lang,
                      },
                    },
                  );
                  if (
                    !(r.data instanceof Blob) ||
                    !r.data.size ||
                    !String(
                      r.headers?.["content-type"] || r.data.type,
                    ).includes("application/pdf")
                  )
                    throw new Error("invalid_document");
                  if (identity.current === viewerKey)
                    Download({
                      blob: r.data,
                      name: "restaurant-credit-statement.pdf",
                    });
                })
              }
            >
              {copy("statementPdf")}
            </button>
          )}
          {selected.section.key === "creditAccounts" && isSuper && (
            <Suspense fallback={<p>{copy("loading")}</p>}>
              <CreditDetail
                account={{
                  customerId: user.id,
                  accountId: selected.record.id,
                  currencyCode: selected.record.currency_code,
                }}
                onClose={() => setSelected(null)}
              />
            </Suspense>
          )}
        </Modal>
      )}
      {report && data && (
        <Modal title={copy("report")} onClose={() => setReport(null)}>
          <div className="c360w-report">
            <h2>{copy("report")}</h2>
            <p>
              {user.id} · {when(report.generatedAt)}
            </p>
            <p>{report.purpose}</p>
            <p>
              {copy("from")}: {report.filters?.from || copy("unknown")} ·{" "}
              {copy("to")}: {report.filters?.to || copy("unknown")} ·{" "}
              {copy("search")}: {report.filters?.q || copy("unknown")}
            </p>
            <p>{copy("exportHint")}</p>
            {report.sections.map((s) => (
              <p key={s.source}>
                {copy(`sources.${s.source}`)}: {s.exported}/{s.total}{" "}
                {s.partial ? copy("partial") : ""}
              </p>
            ))}
            <ol>
              {report.records.map((r, i) => (
                <li key={`${r.source}-${r.id}-${i}`}>
                  {copy(`sources.${r.source}`)} · <bdi>{r.id}</bdi> ·{" "}
                  {status(r.status)} · {when(r.occurred_at)}{" "}
                  {r.currency_code && r.amount_cents != null
                    ? moneyMinor(r.amount_cents, r.currency_code, lang)
                    : ""}
                </li>
              ))}
            </ol>
          </div>
          <button type="button" onClick={() => window.print()}>
            {copy("export_print")}
          </button>
        </Modal>
      )}
      <ConfirmDialog
        open={!!confirm && confirm.viewerKey === viewerKey}
        title={copy(
          confirm?.kind === "refundMarketplace"
            ? "refund"
            : ["cancelJob", "cancelBooking"].includes(confirm?.kind)
              ? "confirm"
              : confirm?.kind || "confirm",
        )}
        message={copy("confirmHint")}
        requireReason
        onClose={() => setConfirm(null)}
        onConfirm={async (reason) => {
          try {
            await confirmAction(reason);
          } catch (error) {
            throw new Error(
              copy(
                error.response?.status === 403
                  ? "restrictedHint"
                  : error.response?.status === 409
                    ? "conflict"
                    : "actionFailed",
              ),
            );
          }
        }}
      />
    </section>
  );
}
