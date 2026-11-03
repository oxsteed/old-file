import { useEffect, useState } from "react";
import adminApi from "../../../lib/adminApi";

const INBOX_ERRORS = ["sms_disabled", "no_email", "no_verified_phone", "customer_not_messageable", "message_grant_required", "idempotency_conflict"];
const LANG_NAMES = { en: "English", es: "Español", fr: "Français", ht: "Kreyòl ayisyen", ar: "العربية" };
const uuid = () =>
  globalThis.crypto?.randomUUID?.() ||
  "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (Math.random() * 16) >> (c / 4)).toString(16));

// Upgrade 8: unified inbox. Replies go out only through the existing
// grant-gated channels, and only after the explicit "Send now" action.
export default function Inbox({ api, copy, when, user, viewerKey }) {
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const [draft, setDraft] = useState({ channel: "", ticketId: "", language: "en", templateKey: "", subject: "", body: "" });
  const [review, setReview] = useState(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async (signal) => {
    const r = await adminApi.get(`${api}/inbox`, { signal });
    setData(r.data);
    return r.data;
  };
  useEffect(() => {
    const c = new AbortController();
    setState("loading");
    setReview(null);
    load(c.signal)
      .then((d) => {
        if (c.signal.aborted) return;
        setDraft((p) => ({ ...p, channel: "", ticketId: d.tickets?.[0]?.id || "", language: d.language || "en", subject: "", body: "", templateKey: "" }));
        setState("ready");
      })
      .catch(() => !c.signal.aborted && setState("error"));
    return () => c.abort();
  }, [api, viewerKey]);

  const available = data
    ? [
        data.grants.support && data.tickets.length ? "support" : null,
        "message",
        data.channels?.email?.available ? "email" : null,
        data.channels?.sms?.available ? "sms" : null,
      ].filter(Boolean)
    : [];
  const set = (patch) => setDraft((p) => ({ ...p, ...patch }));
  const applyTemplate = async (templateKey, language = draft.language) => {
    set({ templateKey });
    if (!templateKey) return;
    try {
      const r = await adminApi.get(`${api}/inbox/templates/${templateKey}`, { params: { language } });
      set({ templateKey, subject: r.data.subject, body: r.data.body });
    } catch {
      setNotice(copy("actionFailed"));
    }
  };
  const recipient = () =>
    draft.channel === "email" ? data.channels.email.to
      : draft.channel === "sms" ? data.channels.sms.to
      : draft.channel === "support" ? copy("inbox.ticketLabel", { number: data.tickets.find((t) => t.id === draft.ticketId)?.ticket_number || "" })
      : copy("inbox.inApp");
  const sendNow = async () => {
    setBusy(true);
    setNotice("");
    const headers = { "Idempotency-Key": review.key };
    try {
      if (draft.channel === "support") {
        await adminApi.post(`/admin/support/tickets/${draft.ticketId}/reply`, { content: draft.body, is_internal: false }, { headers });
      } else if (draft.channel === "message") {
        await adminApi.post(`/admin/messages/conversations/${user.id}/send`, { content: draft.body }, { headers });
      } else {
        await adminApi.post(`${api}/inbox/send`, {
          channel: draft.channel, templateKey: draft.templateKey || null, language: draft.language,
          subject: draft.subject, body: draft.body, confirm: true, clientMessageId: review.key,
        }, { headers });
      }
      setReview(null);
      set({ body: "", subject: "", templateKey: "" });
      setNotice(copy("inbox.sent"));
      await load();
    } catch (e) {
      const code = e.response?.data?.code;
      setNotice(copy(INBOX_ERRORS.includes(code) ? `inbox.errors.${code}` : "actionFailed"));
    } finally {
      setBusy(false);
    }
  };
  const valid = draft.channel && draft.body.trim() && (draft.channel !== "email" || draft.subject.trim()) && (draft.channel !== "support" || draft.ticketId)
    && (draft.channel !== "sms" || draft.body.length <= 480);

  return (
    <article className="c360u" data-panel="inbox">
      <h3>{copy("inbox.title")}</h3>
      <p className="c360w-note">{copy("inbox.hint")}</p>
      {notice && <p role="status">{notice}</p>}
      {state === "loading" && <p role="status">{copy("loading")}</p>}
      {state === "error" && <p role="alert">{copy("loadFailed")}</p>}
      {data && (
        <>
          {!data.grants.support && <p>{copy("inbox.noSupportAccess")}</p>}
          {!data.items.length ? <p>{copy("inbox.empty")}</p> : (
            <ol className="c360u-events">
              {data.items.map((m) => (
                <li key={`${m.channel}:${m.id}`} data-channel={m.channel} data-direction={m.outbound ? "out" : "in"}>
                  <strong>
                    {copy(`inbox.channels.${m.channel}`)} · {copy(m.outbound ? "inbox.outbound" : "inbox.inbound")}
                    {m.internal ? ` · ${copy("inbox.internal")}` : ""}
                    {m.status ? ` · ${copy(`inbox.statuses.${m.status}`)}` : ""}
                  </strong>
                  <span><bdi>{m.author}</bdi> · {when(m.at)}{m.thread_label ? <> · <bdi>{m.thread_label}</bdi></> : null}</span>
                  {m.subject && <span><bdi>{m.subject}</bdi></span>}
                  <p className="c360u-message"><bdi>{m.body}</bdi></p>
                </li>
              ))}
            </ol>
          )}
          {data.nextBefore && (
            <button type="button" onClick={async () => {
              const r = await adminApi.get(`${api}/inbox`, { params: { before: data.nextBefore } });
              setData((p) => ({ ...p, items: [...p.items, ...r.data.items], nextBefore: r.data.nextBefore }));
            }}>{copy("inbox.older")}</button>
          )}
          {!data.canSend ? <p>{copy("inbox.noSendAccess")}</p> : (
            <section className="c360u-replay" aria-labelledby="c360u-compose">
              <h4 id="c360u-compose">{copy("inbox.compose")}</h4>
              {!review ? (
                <form className="c360u-reply" onSubmit={(e) => { e.preventDefault(); if (valid) setReview({ key: uuid() }); }}>
                  <div className="c360u-row">
                    <label>
                      {copy("inbox.channel")}
                      <select value={draft.channel} onChange={(e) => set({ channel: e.target.value })}>
                        <option value="">{copy("inbox.choose")}</option>
                        {available.map((c) => <option key={c} value={c}>{copy(`inbox.channels.${c}`)}</option>)}
                      </select>
                    </label>
                    {draft.channel === "support" && (
                      <label>
                        {copy("inbox.ticket")}
                        <select value={draft.ticketId} onChange={(e) => set({ ticketId: e.target.value })}>
                          {data.tickets.map((t) => <option key={t.id} value={t.id}>{t.ticket_number} · {t.subject || ""}</option>)}
                        </select>
                      </label>
                    )}
                    <label>
                      {copy("inbox.language")}
                      <select value={draft.language} onChange={(e) => { set({ language: e.target.value }); if (draft.templateKey) applyTemplate(draft.templateKey, e.target.value); }}>
                        {data.languages.map((l) => <option key={l} value={l} lang={l}>{LANG_NAMES[l]}</option>)}
                      </select>
                    </label>
                    <label>
                      {copy("inbox.template")}
                      <select value={draft.templateKey} onChange={(e) => applyTemplate(e.target.value)}>
                        <option value="">{copy("inbox.noTemplate")}</option>
                        {data.templates.map((k) => <option key={k} value={k}>{copy(`inbox.templates.${k}`)}</option>)}
                      </select>
                    </label>
                  </div>
                  {draft.channel === "email" && data.channels?.email && !data.channels.email.verified && <p role="status">{copy("inbox.unverifiedEmail")}</p>}
                  {draft.channel === "email" && (
                    <label>
                      {copy("inbox.subject")}
                      <input value={draft.subject} maxLength={200} dir={draft.language === "ar" ? "rtl" : "auto"} lang={draft.language} onChange={(e) => set({ subject: e.target.value })} />
                    </label>
                  )}
                  <label>
                    {copy("inbox.body")}
                    <textarea rows={6} value={draft.body} maxLength={draft.channel === "sms" ? 480 : 8000} dir={draft.language === "ar" ? "rtl" : "auto"} lang={draft.language} onChange={(e) => set({ body: e.target.value })} />
                  </label>
                  {draft.channel === "sms" && <p className="c360w-meta">{copy("inbox.smsLimit", { count: draft.body.length })}</p>}
                  <button type="submit" disabled={!valid}>{copy("inbox.review")}</button>
                </form>
              ) : (
                <div data-review="send">
                  <p role="alert">{copy("inbox.confirm", { channel: copy(`inbox.channels.${draft.channel}`), to: recipient(), language: LANG_NAMES[draft.language] })}</p>
                  {draft.subject && draft.channel === "email" && <p><strong><bdi>{draft.subject}</bdi></strong></p>}
                  <p className="c360u-message" lang={draft.language} dir={draft.language === "ar" ? "rtl" : "auto"}>{draft.body}</p>
                  <div className="c360u-row">
                    <button type="button" onClick={sendNow} disabled={busy}>{copy("inbox.sendNow")}</button>
                    <button type="button" onClick={() => setReview(null)} disabled={busy}>{copy("inbox.edit")}</button>
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </article>
  );
}
