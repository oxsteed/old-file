import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessagesSquare, Paperclip } from 'lucide-react';
import { getSupportTicket, replyToSupportTicket } from '../../api/statementCases';
import { listOxsteedCreditDisputes } from '../../api/oxsteedCredit';
import './CaseFollowup.css';

// CaseFollowup: complete case follow-up inside the statement page.
// For a case linked to a statement (a credit dispute or a support ticket)
// it shows the status timeline, lets the user add evidence (text plus a
// file reference, sent as a follow-up message through the existing support
// reply API) and exchange follow-up messages, all without leaving the
// statement page.
//
// Support tickets reuse the EXISTING case-message APIs
// (GET/POST /support/my-tickets/:ticketId[/reply]). Credit disputes have no
// user-facing message API today, so dispute follow-up is a read-only status
// timeline here; the backend need is documented in the Group C report rather
// than building a conflicting route.
//
// Mount point (coordinator): render inside InvestigationPanel's case list
// (one CaseFollowup per case) or as a standalone section on the statement
// pages. Props: { caseRef } where caseRef = { caseSupport:
// 'credit_disputes' | 'support_tickets', caseId, status?, reasonCode?,
// openedAt?, updatedAt?, slaDueAt?, resolution?, detailUrl? }.
function newIdempotencyKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export default function CaseFollowup({ caseRef }) {
  const { t, i18n } = useTranslation('statements');
  const language = (i18n.resolvedLanguage || i18n.language || 'en').split(/[-_]/)[0];
  const isTicket = caseRef?.caseSupport === 'support_tickets';
  const [ticket, setTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [dispute, setDispute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [sendDone, setSendDone] = useState(false);
  const [evidenceText, setEvidenceText] = useState('');
  const [evidenceFile, setEvidenceFile] = useState('');
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceError, setEvidenceError] = useState(null);
  const [evidenceDone, setEvidenceDone] = useState(false);

  const load = useCallback(async (signal) => {
    if (!caseRef?.caseId) {
      setError(t('caseFollowup.loadError'));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (isTicket) {
        const payload = await getSupportTicket(caseRef.caseId, { signal });
        setTicket(payload?.ticket || null);
        setMessages(Array.isArray(payload?.messages) ? payload.messages : []);
      } else {
        const disputes = await listOxsteedCreditDisputes({ signal });
        const found = (Array.isArray(disputes) ? disputes : []).find((d) => String(d.id) === String(caseRef.caseId));
        setDispute(found || caseRef);
      }
    } catch (err) {
      if (err?.code === 'ERR_CANCELED') return;
      setError(t('caseFollowup.loadError'));
    } finally {
      setLoading(false);
    }
  }, [caseRef, isTicket, t]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const sendMessage = async (event) => {
    event.preventDefault();
    const content = message.trim();
    if (!content) return;
    setSending(true);
    setSendError(null);
    try {
      await replyToSupportTicket(caseRef.caseId, content, { idempotencyKey: newIdempotencyKey() });
      setMessage('');
      setSendDone(true);
      const controller = new AbortController();
      await load(controller.signal);
    } catch {
      setSendError(t('caseFollowup.messageError'));
    } finally {
      setSending(false);
    }
  };

  // Evidence is added as a follow-up message through the existing support
  // reply API: a text note plus an optional file reference. No new backend
  // route; the reply thread is the durable evidence trail.
  const addEvidence = async (event) => {
    event.preventDefault();
    const note = evidenceText.trim();
    const fileRef = evidenceFile.trim();
    if (!note && !fileRef) return;
    setEvidenceBusy(true);
    setEvidenceError(null);
    try {
      const parts = [t('caseFollowup.evidenceTitle') + ':'];
      if (note) parts.push(note);
      if (fileRef) parts.push(`${t('caseFollowup.evidenceTitle')} file: ${fileRef}`);
      await replyToSupportTicket(caseRef.caseId, parts.join('\n'), { idempotencyKey: newIdempotencyKey() });
      setEvidenceText('');
      setEvidenceFile('');
      setEvidenceDone(true);
      const controller = new AbortController();
      await load(controller.signal);
    } catch {
      setEvidenceError(t('caseFollowup.evidenceError'));
    } finally {
      setEvidenceBusy(false);
    }
  };

  const status = ticket?.status || dispute?.status || caseRef?.status;
  const openedAt = ticket?.created_at || dispute?.openedAt || caseRef?.openedAt;
  const updatedAt = ticket?.updated_at || dispute?.updatedAt || caseRef?.updatedAt;

  return (
    <section className="stc-panel stc-followup" aria-label={t('caseFollowup.title')}>
      <div className="stc-panel-head">
        <h2><MessagesSquare aria-hidden="true" /> {t('caseFollowup.title')}</h2>
      </div>

      {loading ? <p className="stc-state">{t('caseFollowup.loading')}</p> : null}
      {error ? (
        <div className="stc-state">
          <p className="stc-error-text">{error}</p>
          <button type="button" onClick={() => load()}>{t('common.retry')}</button>
        </div>
      ) : null}

      {!loading && !error ? (
        <>
          <div className="stc-card">
            <h3>{t('caseFollowup.timelineTitle')}</h3>
            <dl className="stc-facts">
              <div><dt>{t('caseFollowup.statusLabel')}</dt><dd><span className={`stc-case-status stc-case-status-${status}`}>{status}</span></dd></div>
              {caseRef?.reasonCode ? <div><dt>{t('caseFollowup.reasonCode')}</dt><dd>{caseRef.reasonCode}</dd></div> : null}
              <div><dt>{t('caseFollowup.openedAt')}</dt><dd>{openedAt ? new Date(openedAt).toLocaleString(language) : '—'}</dd></div>
              <div><dt>{t('caseFollowup.updatedAt')}</dt><dd>{updatedAt ? new Date(updatedAt).toLocaleString(language) : '—'}</dd></div>
              {dispute?.slaDueAt || caseRef?.slaDueAt ? (
                <div><dt>{t('caseFollowup.slaDueAt')}</dt><dd>{new Date(dispute?.slaDueAt || caseRef.slaDueAt).toLocaleString(language)}</dd></div>
              ) : null}
              {dispute?.resolution || caseRef?.resolution ? (
                <div><dt>{t('caseFollowup.resolution')}</dt><dd>{dispute?.resolution || caseRef.resolution}</dd></div>
              ) : null}
            </dl>
            {caseRef?.detailUrl ? <a className="stc-link" href={caseRef.detailUrl}>{t('caseFollowup.ticketLink')}</a> : null}
            {['resolved', 'closed'].includes(status) ? <p className="stc-note">{t('caseFollowup.closedNotice')}</p> : null}
          </div>

          {!isTicket ? (
            <div className="stc-card">
              <h3>{t('caseFollowup.disputeReadonlyTitle')}</h3>
              <p className="stc-muted">{t('caseFollowup.disputeReadonlyBody')}</p>
            </div>
          ) : (
            <>
              <div className="stc-card">
                <h3>{t('caseFollowup.messagesTitle')}</h3>
                {messages.length === 0 ? <p className="stc-muted">{t('caseFollowup.emptyMessages')}</p> : null}
                <ul className="stc-messages">
                  {messages.map((msg) => (
                    <li key={msg.id} className={msg.is_from_admin ? 'stc-message-admin' : 'stc-message-user'}>
                      <p className="stc-message-meta">
                        {msg.is_from_admin ? t('caseFollowup.fromSupport') : t('caseFollowup.fromYou')}
                        {' · '}
                        {msg.created_at ? new Date(msg.created_at).toLocaleString(language) : ''}
                      </p>
                      <p className="stc-message-body">{msg.content}</p>
                    </li>
                  ))}
                </ul>
                {sendDone ? <p className="stc-notice" role="status">{t('caseFollowup.messageSent')}</p> : null}
                {['resolved', 'closed'].includes(status) ? null : (
                  <form className="stc-form" onSubmit={sendMessage}>
                    <label className="stc-field">
                      <span>{t('caseFollowup.messagesTitle')}</span>
                      <textarea
                        rows={3}
                        value={message}
                        maxLength={10000}
                        placeholder={t('caseFollowup.messagePlaceholder')}
                        onChange={(e) => setMessage(e.target.value)}
                      />
                    </label>
                    {sendError ? <p className="stc-error-text" role="alert">{sendError}</p> : null}
                    <div className="stc-actions">
                      <button type="submit" className="stc-primary" disabled={sending || !message.trim()}>
                        {sending ? t('caseFollowup.sending') : t('caseFollowup.sendMessage')}
                      </button>
                    </div>
                  </form>
                )}
              </div>

              <div className="stc-card">
                <h3><Paperclip aria-hidden="true" /> {t('caseFollowup.evidenceTitle')}</h3>
                <p className="stc-note">{t('caseFollowup.evidenceHint')}</p>
                {evidenceDone ? <p className="stc-notice" role="status">{t('caseFollowup.evidenceAdded')}</p> : null}
                <form className="stc-form" onSubmit={addEvidence}>
                  <label className="stc-field">
                    <span>{t('caseFollowup.evidenceTitle')}</span>
                    <textarea
                      rows={3}
                      value={evidenceText}
                      maxLength={2000}
                      placeholder={t('caseFollowup.evidencePlaceholder')}
                      onChange={(e) => setEvidenceText(e.target.value)}
                    />
                  </label>
                  <label className="stc-field">
                    <span>{t('caseFollowup.evidenceFileLabel')}</span>
                    <input
                      type="url"
                      value={evidenceFile}
                      maxLength={2000}
                      placeholder="https://…"
                      onChange={(e) => setEvidenceFile(e.target.value)}
                    />
                  </label>
                  {evidenceError ? <p className="stc-error-text" role="alert">{evidenceError}</p> : null}
                  <div className="stc-actions">
                    <button type="submit" disabled={evidenceBusy || (!evidenceText.trim() && !evidenceFile.trim())}>
                      {evidenceBusy ? t('caseFollowup.addingEvidence') : t('caseFollowup.addEvidence')}
                    </button>
                  </div>
                </form>
              </div>
            </>
          )}
        </>
      ) : null}
    </section>
  );
}
