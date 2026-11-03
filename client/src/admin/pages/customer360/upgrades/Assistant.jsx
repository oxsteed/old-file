import { useEffect, useRef, useState } from "react";
import adminApi from "../../../lib/adminApi";

const MODES = ["summary", "next_step", "reply_draft"];
const TOPICS = ["general", "verification", "payment", "order", "account_access", "support_followup"];

// Upgrade 3: review-only drafts from self-hosted Ollama. Nothing here sends,
// approves or changes anything; a reply draft is editable text only.
export default function Assistant({ api, copy, lang, viewerKey, sections, choose, status }) {
  const [mode, setMode] = useState("summary");
  const [topic, setTopic] = useState("general");
  const [result, setResult] = useState(null);
  const [state, setState] = useState("idle");
  const [reply, setReply] = useState({ subject: "", body: "" });
  const identity = useRef(viewerKey);
  identity.current = viewerKey;
  useEffect(() => {
    setResult(null);
    setState("idle");
    setReply({ subject: "", body: "" });
  }, [viewerKey]);
  const generate = async () => {
    const key = viewerKey;
    setState("busy");
    try {
      const r = await adminApi.post(`${api}/assistant`, { language: lang.split("-")[0], mode, topic });
      if (identity.current !== key) return;
      setResult(r.data);
      if (r.data.mode === "reply_draft" && r.data.draft) setReply(r.data.draft);
      setState("idle");
    } catch {
      if (identity.current === key) setState("error");
    }
  };
  const draft = result?.draft;
  return (
    <article data-panel="assistant">
      <h3>{copy("assistant")}</h3>
      <p>{copy("assistantHint")}</p>
      <p className="c360w-note">{copy("ai.policy")}</p>
      <div className="c360u-row">
        <label>
          {copy("ai.mode")}
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            {MODES.map((m) => (
              <option key={m} value={m}>{copy(`ai.modes.${m}`)}</option>
            ))}
          </select>
        </label>
        {mode === "reply_draft" && (
          <label>
            {copy("ai.topic")}
            <select value={topic} onChange={(e) => setTopic(e.target.value)}>
              {TOPICS.map((t) => (
                <option key={t} value={t}>{copy(`ai.topics.${t}`)}</option>
              ))}
            </select>
          </label>
        )}
        <button type="button" disabled={state === "busy"} onClick={generate}>
          {copy("generate")}
        </button>
      </div>
      {state === "error" && <p role="alert">{copy("actionFailed")}</p>}
      {result && (
        <>
          <p>{copy("draftWarning")}</p>
          {!draft && <p>{copy("providerUnavailable")}</p>}
          {draft && result.mode === "summary" && (
            <div className="c360w-draft">
              <p>{draft.summary}</p>
              <p>
                {copy("ai.cites")}{" "}
                {draft.citations.map((c) => (
                  <button key={c} type="button" onClick={() => choose(sections[c]?.area || "all", c)}>
                    {copy(`sources.${c}`)}
                  </button>
                ))}
              </p>
            </div>
          )}
          {draft && result.mode === "next_step" && (
            <ol className="c360w-draft">
              {draft.steps.map((s, i) => (
                <li key={i}>
                  {s.text} ·{" "}
                  <button type="button" onClick={() => choose(sections[s.citation]?.area || "all", s.citation)}>
                    {copy(`sources.${s.citation}`)}
                  </button>
                  {s.guide !== "none" && (
                    <button type="button" onClick={() => choose("guides")}>
                      {copy(`guidesCopy.${s.guide}.title`, { defaultValue: s.guide })}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
          {draft && result.mode === "reply_draft" && (
            <div className="c360u-reply">
              <label>
                {copy("ai.subject")}
                <input value={reply.subject} maxLength={160} onChange={(e) => setReply({ ...reply, subject: e.target.value })} />
              </label>
              <label>
                {copy("ai.body")}
                <textarea rows={8} value={reply.body} maxLength={2000} onChange={(e) => setReply({ ...reply, body: e.target.value })} />
              </label>
              <p className="c360w-note">{copy("ai.replyNotice")}</p>
              <button
                type="button"
                onClick={() => {
                  try {
                    sessionStorage.setItem(`c360-reply:${viewerKey}`, JSON.stringify(reply));
                  } catch {
                    /* storage unavailable: the text stays on screen */
                  }
                  choose("inbox");
                }}
              >
                {copy("ai.useInInbox")}
              </button>
            </div>
          )}
          <ul>
            {result.evidence.map((e) => (
              <li key={e.source}>
                <button type="button" onClick={() => choose(sections[e.source]?.area || "all", e.source)}>
                  {copy(`sources.${e.source}`)}
                </button>
                : {e.total ?? copy(e.state)}{" "}
                {e.groups?.map((g) => `${status(g.status)}: ${g.count}`).join(" · ")}
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}
