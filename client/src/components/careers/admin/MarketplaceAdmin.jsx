import { useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import {
  adminApproveCommission, adminContentQueue, adminListMessageReports, adminListOpeningReports, adminListReferralCommissions,
  adminMarkCommissionPaid, adminModerateContent, adminResolveMessageReport, adminResolveOpeningReports, adminVoidCommission,
} from '../../../api/careers';
import { ActionButton, Empty, Field, Loading, LoadError, Notice, useCareerErrors, useLoad } from '../ui';
import { formatWhen } from '../../../features/careers/careersModel';
import { formatCents } from '../../../features/careers/marketplaceModel';

/** "Report this job" and reported messages (moderate_careers). */
export function ReportsAdmin() {
  const { t, i18n } = useTranslation();
  const openings = useLoad(() => adminListOpeningReports(), []);
  const messages = useLoad(() => adminListMessageReports(), []);
  const [notes, setNotes] = useState({});
  return (
    <div className="ox-careers-grid">
      <section className="ox-careers-section">
        <h2>{t('careers.mk.admin.openingReports')}</h2>
        {openings.loading && !openings.data ? <Loading /> : null}
        <LoadError error={openings.error} onRetry={openings.reload} />
        {openings.data && !openings.data.length ? <Empty>{t('careers.mk.admin.noReports')}</Empty> : null}
        {(openings.data || []).map((r) => (
          <article key={r.opening_id} className="ox-careers-panel">
            <div className="ox-careers-row">
              <div>
                <a href={`/careers/${r.opening_id}`} target="_blank" rel="noopener noreferrer"><strong>{r.title}</strong></a>
                <p className="ox-careers-subtle">{r.employer_name} · {t('careers.mk.admin.reportCount', { count: r.reports })} · {formatWhen(r.last_reported_at, undefined, i18n.language)}</p>
              </div>
              <span className="ox-careers-chip">{t(`careers.moderation.${r.moderation_status}`)}</span>
            </div>
            <p>{(r.reasons || []).map((x) => t(`careers.mk.report.openingReasons.${x}`)).join(' · ')}</p>
            {(r.items || []).slice(0, 5).map((it, i) => (it.details ? <p key={i} className="ox-careers-subtle">“{it.details}”</p> : null))}
            <Field label={t('careers.mk.admin.note')} htmlFor={`or-${r.opening_id}`}>
              <input id={`or-${r.opening_id}`} maxLength={500} value={notes[r.opening_id] || ''} onChange={(e) => setNotes((n) => ({ ...n, [r.opening_id]: e.target.value }))} />
            </Field>
            <div className="ox-careers-actions">
              <ActionButton onClick={async () => { await adminResolveOpeningReports(r.opening_id, { outcome: 'dismiss', note: notes[r.opening_id] }); openings.reload(); }}>{t('careers.mk.admin.dismiss')}</ActionButton>
              <ActionButton danger disabled={!notes[r.opening_id]} onClick={async () => { await adminResolveOpeningReports(r.opening_id, { outcome: 'remove', note: notes[r.opening_id] }); openings.reload(); }}>{t('careers.mk.admin.removeJob')}</ActionButton>
              {r.moderation_status === 'removed' ? <ActionButton onClick={async () => { await adminResolveOpeningReports(r.opening_id, { outcome: 'restore', note: notes[r.opening_id] }); openings.reload(); }}>{t('careers.mk.admin.restore')}</ActionButton> : null}
            </div>
          </article>
        ))}
      </section>
      <section className="ox-careers-section">
        <h2>{t('careers.mk.admin.messageReports')}</h2>
        <LoadError error={messages.error} onRetry={messages.reload} />
        {messages.data && !messages.data.length ? <Empty>{t('careers.mk.admin.noReports')}</Empty> : null}
        {(messages.data || []).map((m) => (
          <article key={m.message_id} className="ox-careers-panel">
            <p className="ox-careers-subtle">{t(`careers.mk.admin.from.${m.sender_side}`)} · {t('careers.mk.admin.reportCount', { count: m.reports })} · {(m.reasons || []).map((x) => t(`careers.mk.report.messageReasons.${x}`)).join(' · ')}</p>
            <p className="ox-careers-prose">{m.body}</p>
            <div className="ox-careers-actions">
              <ActionButton onClick={async () => { await adminResolveMessageReport(m.message_id, { outcome: 'dismiss' }); messages.reload(); }}>{t('careers.mk.admin.dismiss')}</ActionButton>
              <ActionButton danger onClick={async () => { await adminResolveMessageReport(m.message_id, { outcome: 'hide', reason: (m.reasons || [])[0] }); messages.reload(); }}>{t('careers.mk.admin.hideMessage')}</ActionButton>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

/** Reviews, questions and answers held for moderation. */
export function ContentAdmin() {
  const { t, i18n } = useTranslation();
  const data = useLoad(() => adminContentQueue(), []);
  const act = (kind, id, decision) => async () => { await adminModerateContent(kind, id, { decision }); data.reload(); };
  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <LoadError error={data.error} onRetry={data.reload} />;
  const { reviews = [], questions = [], answers = [] } = data.data || {};
  const row = (kind, item, title, body) => (
    <article key={`${kind}-${item.id}`} className="ox-careers-panel">
      <p className="ox-careers-subtle">{item.business_name || `#${item.business_id}`} · {formatWhen(item.created_at, undefined, i18n.language)}{item.moderation_reason ? ` · ${t(`careers.mk.admin.why.${item.moderation_reason}`)}` : ''}{item.reports ? ` · ${t('careers.mk.admin.reportCount', { count: item.reports })}` : ''}</p>
      {title ? <p><strong>{title}</strong></p> : null}
      <p className="ox-careers-prose">{body}</p>
      <div className="ox-careers-actions">
        <ActionButton primary onClick={act(kind, item.id, 'publish')}>{t('careers.mk.admin.publish')}</ActionButton>
        <ActionButton danger onClick={act(kind, item.id, 'reject')}>{t('careers.mk.admin.reject')}</ActionButton>
      </div>
    </article>
  );
  return (
    <div className="ox-careers-grid">
      <Notice>{t('careers.mk.admin.contentHint')}</Notice>
      <h2>{t('careers.mk.employers.tabs.reviews')}</h2>
      {!reviews.length ? <Empty>{t('careers.mk.admin.queueEmpty')}</Empty> : reviews.map((r) => row('review', r, `${r.overall}★ ${r.headline}`, [r.pros, r.cons].filter(Boolean).join('\n\n')))}
      <h2>{t('careers.mk.employers.tabs.questions')}</h2>
      {!questions.length ? <Empty>{t('careers.mk.admin.queueEmpty')}</Empty> : questions.map((q) => row('question', q, null, q.body))}
      <h2>{t('careers.mk.admin.answers')}</h2>
      {!answers.length ? <Empty>{t('careers.mk.admin.queueEmpty')}</Empty> : answers.map((a) => row('answer', a, null, a.body))}
    </div>
  );
}

/** Referral commissions: two distinct admins approve, then one records the payout reference. */
export function ReferralsAdmin() {
  const { t, i18n } = useTranslation();
  const errorText = useCareerErrors();
  const [status, setStatus] = useState('pending');
  const data = useLoad(() => adminListReferralCommissions(status), [status]);
  const [refs, setRefs] = useState({});
  const run = (fn) => async () => { try { await fn(); data.reload(); } catch (err) { toast.error(errorText(err)); } };
  return (
    <div className="ox-careers-grid">
      <Notice>{t('careers.mk.admin.referralHint')}</Notice>
      <select aria-label={t('careers.mk.admin.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
        {['pending', 'approved', 'paid', 'void'].map((s) => <option key={s} value={s}>{t(`careers.mk.admin.commission.${s}`)}</option>)}
      </select>
      {data.loading && !data.data ? <Loading /> : null}
      <LoadError error={data.error} onRetry={data.reload} />
      {data.data && !data.data.length ? <Empty>{t('careers.mk.admin.queueEmpty')}</Empty> : null}
      {(data.data || []).map((c) => (
        <article key={c.id} className="ox-careers-panel">
          <div className="ox-careers-row">
            <strong>{formatCents(c.amount_cents, c.currency, i18n.language)}</strong>
            <span className="ox-careers-subtle">{t('careers.mk.admin.commissionLine', { business: c.business_name, code: c.code, invoice: formatCents(c.invoice_amount_cents, c.currency, i18n.language), rate: c.rate_bps / 100 })}</span>
          </div>
          <p className="ox-careers-subtle">
            {formatWhen(c.created_at, undefined, i18n.language)}
            {c.first_approver ? ` · ${t('careers.mk.admin.firstApproval')}` : ''}
            {c.second_approver ? ` · ${t('careers.mk.admin.secondApproval')}` : ''}
            {c.paid_reference ? ` · ${t('careers.mk.admin.paidRef', { ref: c.paid_reference })}` : ''}
          </p>
          <div className="ox-careers-actions">
            {c.status === 'pending' ? <button type="button" className="ox-careers-btn primary" onClick={run(() => adminApproveCommission(c.id))}>{t('careers.mk.admin.approve')}</button> : null}
            {c.status === 'approved' ? (
              <>
                <input aria-label={t('careers.mk.admin.payoutReference')} placeholder={t('careers.mk.admin.payoutReference')} maxLength={120} value={refs[c.id] || ''} onChange={(e) => setRefs((r) => ({ ...r, [c.id]: e.target.value }))} />
                <button type="button" className="ox-careers-btn primary" disabled={!(refs[c.id] || '').trim()} onClick={run(() => adminMarkCommissionPaid(c.id, refs[c.id].trim()))}>{t('careers.mk.admin.markPaid')}</button>
              </>
            ) : null}
            {['pending', 'approved'].includes(c.status) ? (
              <button type="button" className="ox-careers-btn danger" onClick={run(() => { const reason = window.prompt(t('careers.mk.admin.voidReason')); return reason ? adminVoidCommission(c.id, reason) : Promise.resolve(); })}>{t('careers.mk.admin.void')}</button>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
