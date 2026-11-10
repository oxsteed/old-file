import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import {
  getMyCareerMessages, getTeamCareerMessages, listMessageTemplates, reportMyCareerMessage, reportTeamCareerMessage,
  sendMyCareerMessage, sendTeamCareerMessage,
} from '../../../api/careers';
import { Empty, LoadError, Loading, Notice, useCareerErrors, useLoad } from '../ui';
import { useSocket } from '../../../hooks/useSocket';
import { formatWhen } from '../../../features/careers/careersModel';
import { MESSAGE_REPORT_REASONS } from '../../../features/careers/marketplaceModel';
import { ReportForm } from './shared';

/**
 * One application's conversation. side="candidate" (the worker) or
 * "employer" (the hiring team, optionally with saved templates). New
 * messages arrive over the /chat socket as ids only and are re-read here.
 */
export default function MessageThread({ applicationId, side = 'candidate', ctx = null }) {
  const { t, i18n } = useTranslation();
  const errorText = useCareerErrors();
  const { socket } = useSocket();
  const employer = side === 'employer';
  const thread = useLoad(() => (employer ? getTeamCareerMessages(applicationId) : getMyCareerMessages(applicationId)), [applicationId, side]);
  const templates = useLoad(() => (employer && ctx ? listMessageTemplates(ctx).catch(() => []) : Promise.resolve([])), [employer, ctx?.businessId, ctx?.employerType]);
  const [body, setBody] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [sending, setSending] = useState(false);
  const [reporting, setReporting] = useState(null);

  useEffect(() => {
    if (!socket) return undefined;
    const onMessage = (evt) => { if (Number(evt?.applicationId) === Number(applicationId)) thread.reload(); };
    socket.on('careers:message', onMessage);
    return () => socket.off('careers:message', onMessage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, applicationId]);

  const send = async (e) => {
    e.preventDefault();
    if (!body.trim() && !templateId) return;
    setSending(true);
    try {
      if (employer) await sendTeamCareerMessage(applicationId, { body: body.trim() || undefined, template_id: templateId || undefined });
      else await sendMyCareerMessage(applicationId, body.trim());
      setBody(''); setTemplateId('');
      thread.reload();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSending(false);
    }
  };

  const messages = thread.data?.messages || [];
  return (
    <section className="ox-careers-section" aria-label={t('careers.mk.messages.thread')}>
      <h3>{t('careers.mk.messages.thread')}</h3>
      <p className="ox-careers-subtle">{employer ? t('careers.mk.messages.teamHint') : t('careers.mk.messages.candidateHint')}</p>
      {thread.loading && !thread.data ? <Loading /> : null}
      <LoadError error={thread.error} onRetry={thread.reload} />
      {!thread.loading && !messages.length ? <Empty>{t('careers.mk.messages.empty')}</Empty> : null}
      <ol className="ox-careers-thread">
        {messages.map((m) => (
          <li key={m.id} className={`ox-careers-message${m.mine ? ' mine' : ''}`}>
            <p className="ox-careers-subtle">
              {m.mine ? t('careers.mk.messages.you') : (m.side === 'employer' ? m.sender_label : t('careers.mk.messages.applicant'))}
              {' · '}{formatWhen(m.created_at, undefined, i18n.language)}
            </p>
            {m.hidden ? <p className="ox-careers-subtle">{t('careers.mk.messages.hidden')}</p> : <p className="ox-careers-prose">{m.body}</p>}
            {m.contact_warning ? <Notice tone="warn">{t('careers.mk.messages.contactWarning')}</Notice> : null}
            {!m.mine && !m.hidden ? <button type="button" className="ox-careers-link" onClick={() => setReporting(m.id)}>{t('careers.mk.actions.report')}</button> : null}
            {reporting === m.id ? (
              <ReportForm
                idPrefix={`msg-${m.id}`}
                reasons={MESSAGE_REPORT_REASONS}
                reasonKey="careers.mk.report.messageReasons"
                onCancel={() => setReporting(null)}
                onSubmit={async ({ reason }) => {
                  if (employer) await reportTeamCareerMessage(applicationId, m.id, reason); else await reportMyCareerMessage(applicationId, m.id, reason);
                  setReporting(null);
                }}
              />
            ) : null}
          </li>
        ))}
      </ol>
      <form className="ox-careers-panel" onSubmit={send}>
        {employer && (templates.data || []).length ? (
          <label className="ox-careers-field" htmlFor={`tpl-${applicationId}`}>
            <span>{t('careers.mk.templates.use')}</span>
            <select id={`tpl-${applicationId}`} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">{t('careers.mk.templates.none')}</option>
              {templates.data.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
            </select>
          </label>
        ) : null}
        <label className="ox-careers-field" htmlFor={`msg-body-${applicationId}`}>
          <span>{t('careers.mk.messages.write')}</span>
          <textarea id={`msg-body-${applicationId}`} rows={3} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <p className="ox-careers-subtle">{t('careers.mk.messages.safety')}</p>
        <div className="ox-careers-actions">
          <button type="submit" className="ox-careers-btn primary" disabled={sending || (!body.trim() && !templateId)}>{t('careers.mk.messages.send')}</button>
        </div>
      </form>
    </section>
  );
}
