import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminListDisputes, adminResolveDispute } from '../../../api/careers';
import { formatDate } from '../../../features/careers/careersModel';
import { ActionButton, Empty, Loading, LoadError, useLoad } from '../ui';

export default function DisputesPanel() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState('open');
  const [notes, setNotes] = useState({});
  const list = useLoad(() => adminListDisputes({ status }), [status]);
  const rows = list.data?.disputes || [];
  return (
    <div className="ox-careers-grid">
      <p className="ox-careers-subtle">{t('careers.admin.disputesIntro')}</p>
      <select aria-label={t('careers.privacy.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
        {['open', 'upheld', 'rejected'].map((s) => <option key={s} value={s}>{t(`careers.privacy.disputeStatus.${s}`)}</option>)}
      </select>
      {list.loading && !list.data ? <Loading /> : null}
      <LoadError error={list.error} onRetry={list.reload} />
      {list.data && !rows.length ? <Empty>{t('careers.privacy.noDisputes')}</Empty> : null}
      {rows.map((d) => (
        <article key={d.id} className="ox-careers-panel">
          <div className="ox-careers-row">
            <strong>{[d.first_name, d.last_name].filter(Boolean).join(' ')} · {t(`careers.facts.${d.fact_type}`)}</strong>
            <span className={`ox-careers-chip ${d.overdue ? 'bad' : ''}`}>{t('careers.admin.due', { date: formatDate(d.due_at, i18n.language) })}{d.overdue ? ` · ${t('careers.admin.overdue')}` : ''}</span>
          </div>
          <p className="ox-careers-prose">{d.reason}</p>
          {d.source_ref ? <p className="ox-careers-subtle">{t('careers.admin.source', { source: d.source_ref.source || '' })}</p> : null}
          {d.status === 'open' ? (
            <>
              <input aria-label={t('careers.admin.note')} placeholder={t('careers.admin.note')} value={notes[d.id] || ''} onChange={(e) => setNotes({ ...notes, [d.id]: e.target.value })} />
              <div className="ox-careers-actions">
                <ActionButton primary onClick={async () => { await adminResolveDispute(d.id, { outcome: 'upheld', note: notes[d.id] }); list.reload(); }}>{t('careers.admin.uphold')}</ActionButton>
                <ActionButton onClick={async () => { await adminResolveDispute(d.id, { outcome: 'rejected', note: notes[d.id] }); list.reload(); }}>{t('careers.admin.rejectDispute')}</ActionButton>
              </div>
            </>
          ) : <p>{d.resolution_note}</p>}
        </article>
      ))}
    </div>
  );
}
