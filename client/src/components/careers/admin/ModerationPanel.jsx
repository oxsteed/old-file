import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminListCareerOpenings, adminModerateOpening } from '../../../api/careers';
import { formatDate, formatPayRange } from '../../../features/careers/careersModel';
import { ActionButton, Empty, Loading, LoadError, useLoad } from '../ui';

export default function ModerationPanel() {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState({ moderation_status: 'flagged', q: '' });
  const [applied, setApplied] = useState(filter);
  const [notes, setNotes] = useState({});
  const list = useLoad(() => adminListCareerOpenings({ moderation_status: applied.moderation_status || undefined, q: applied.q || undefined }), [applied]);
  const rows = list.data?.openings || [];
  const moderate = async (o, status) => {
    await adminModerateOpening(o.id, { moderation_status: status, note: notes[o.id] || null });
    list.reload();
  };
  return (
    <div className="ox-careers-grid">
      <form className="ox-careers-filters" onSubmit={(e) => { e.preventDefault(); setApplied(filter); }}>
        <select aria-label={t('careers.admin.moderationFilter')} value={filter.moderation_status} onChange={(e) => setFilter({ ...filter, moderation_status: e.target.value })}>
          <option value="">{t('careers.admin.all')}</option>
          {['flagged', 'ok', 'removed'].map((s) => <option key={s} value={s}>{t(`careers.moderation.${s}`)}</option>)}
        </select>
        <input aria-label={t('careers.searchPlaceholder')} placeholder={t('careers.searchPlaceholder')} value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        <button type="submit" className="ox-careers-btn primary">{t('careers.filters.search')}</button>
      </form>
      {list.loading && !list.data ? <Loading /> : null}
      <LoadError error={list.error} onRetry={list.reload} />
      {list.data && !rows.length ? <Empty>{t('careers.admin.noOpenings')}</Empty> : null}
      {rows.map((o) => (
        <article key={o.id} className="ox-careers-panel">
          <div className="ox-careers-row">
            <div>
              <h3>{o.title}</h3>
              <p className="ox-careers-subtle">
                {o.employer_type === 'platform' ? t('careers.filters.oxsteed') : o.business_name} · {[o.city, o.region, o.country_code].filter(Boolean).join(', ')} · {formatPayRange(o, i18n.language)} · {t('careers.employer.applicantCount', { count: o.applications })}
              </p>
              <p className="ox-careers-subtle">{t(`careers.openingStatus.${o.status}`)} · {formatDate(o.updated_at, i18n.language)}</p>
            </div>
            <span className={`ox-careers-chip ${o.moderation_status === 'ok' ? 'ok' : o.moderation_status === 'removed' ? 'bad' : 'warn'}`}>{t(`careers.moderation.${o.moderation_status}`)}</span>
          </div>
          {o.removed_reason ? <p>{t('careers.employer.removedReason', { reason: o.removed_reason })}</p> : null}
          <input aria-label={t('careers.admin.note')} placeholder={t('careers.admin.note')} value={notes[o.id] || ''} onChange={(e) => setNotes({ ...notes, [o.id]: e.target.value })} />
          <div className="ox-careers-actions">
            {o.moderation_status !== 'ok' ? <ActionButton onClick={() => moderate(o, 'ok')}>{t('careers.admin.approve')}</ActionButton> : null}
            {o.moderation_status === 'ok' ? <ActionButton onClick={() => moderate(o, 'flagged')}>{t('careers.admin.flag')}</ActionButton> : null}
            {o.moderation_status !== 'removed' ? <ActionButton danger disabled={!notes[o.id]} onClick={() => moderate(o, 'removed')}>{t('careers.admin.remove')}</ActionButton> : null}
          </div>
        </article>
      ))}
    </div>
  );
}
