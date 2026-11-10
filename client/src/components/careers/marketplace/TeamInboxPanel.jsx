import { useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { deleteMessageTemplate, getTeamCareerInbox, listMessageTemplates, saveMessageTemplate } from '../../../api/careers';
import { ActionButton, Empty, Field, Loading, LoadError, useCareerErrors, useLoad } from '../ui';
import { formatWhen } from '../../../features/careers/careersModel';
import MessageThread from './MessageThread';

/** Shared hiring-team inbox across openings, plus saved reply templates. */
export default function TeamInboxPanel({ ctx }) {
  const { t, i18n } = useTranslation();
  const errorText = useCareerErrors();
  const inbox = useLoad(() => getTeamCareerInbox(ctx), [ctx.employerType, ctx.businessId]);
  const templates = useLoad(() => listMessageTemplates(ctx), [ctx.employerType, ctx.businessId]);
  const [open, setOpen] = useState(null);
  const [tpl, setTpl] = useState({ id: null, name: '', body: '' });
  return (
    <div className="ox-careers-grid">
      <section className="ox-careers-section">
        <h3>{t('careers.mk.inbox.title')}</h3>
        {inbox.loading && !inbox.data ? <Loading /> : null}
        <LoadError error={inbox.error} onRetry={inbox.reload} />
        {inbox.data && !inbox.data.length ? <Empty>{t('careers.mk.inbox.none')}</Empty> : null}
        {(inbox.data || []).map((th) => (
          <article key={th.thread_id} className="ox-careers-app">
            <div className="ox-careers-row">
              <button type="button" className="ox-careers-link" aria-expanded={open === th.application_id} onClick={() => setOpen(open === th.application_id ? null : th.application_id)}>
                {th.opening_title}{th.applicant_number ? ` · #${th.applicant_number}` : ''}
              </button>
              {th.unread ? <span className="ox-careers-chip warn">{t('careers.mk.inbox.unread', { count: th.unread })}</span> : null}
              <span className="ox-careers-subtle">{formatWhen(th.last_message_at, undefined, i18n.language)}</span>
            </div>
            {open === th.application_id ? <MessageThread applicationId={th.application_id} side="employer" ctx={ctx} /> : null}
          </article>
        ))}
      </section>
      <section className="ox-careers-section">
        <h3>{t('careers.mk.templates.title')}</h3>
        <p className="ox-careers-subtle">{t('careers.mk.templates.hint')}</p>
        {(templates.data || []).map((x) => (
          <div key={x.id} className="ox-careers-row ox-careers-app">
            <div><strong>{x.name}</strong><p className="ox-careers-subtle">{x.body}</p></div>
            <div className="ox-careers-actions">
              <button type="button" className="ox-careers-btn" onClick={() => setTpl({ id: x.id, name: x.name, body: x.body })}>{t('careers.mk.common.edit')}</button>
              <ActionButton danger onClick={async () => { await deleteMessageTemplate(ctx, x.id); templates.reload(); }}>{t('careers.mk.resume.delete')}</ActionButton>
            </div>
          </div>
        ))}
        <form className="ox-careers-panel" onSubmit={async (e) => {
          e.preventDefault();
          try { await saveMessageTemplate(ctx, { name: tpl.name, body: tpl.body }, tpl.id); setTpl({ id: null, name: '', body: '' }); templates.reload(); toast.success(t('careers.mk.templates.saved')); } catch (err) { toast.error(errorText(err)); }
        }}
        >
          <Field label={t('careers.mk.templates.name')} htmlFor="tpl-name"><input id="tpl-name" maxLength={80} value={tpl.name} onChange={(e) => setTpl((x) => ({ ...x, name: e.target.value }))} /></Field>
          <Field label={t('careers.mk.templates.body')} htmlFor="tpl-body" hint={t('careers.mk.templates.placeholders')}>
            <textarea id="tpl-body" rows={4} maxLength={2000} value={tpl.body} onChange={(e) => setTpl((x) => ({ ...x, body: e.target.value }))} />
          </Field>
          <div className="ox-careers-actions">
            <button type="submit" className="ox-careers-btn primary" disabled={!tpl.name.trim() || !tpl.body.trim()}>{tpl.id ? t('careers.mk.common.save') : t('careers.mk.templates.add')}</button>
            {tpl.id ? <button type="button" className="ox-careers-btn" onClick={() => setTpl({ id: null, name: '', body: '' })}>{t('careers.common.cancel')}</button> : null}
          </div>
        </form>
      </section>
    </div>
  );
}
