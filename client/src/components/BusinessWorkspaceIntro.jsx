import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import { formatDate } from '../lib/format';
import './HelperReputationPanel.css';
import './HelperBusinessTransition.css';

// Group 4 rest, items 199-200 (business side): the new workspace
// introduction and the founder's read-only helper record. Renders nothing
// unless the signed-in owner linked their helper history to this business.
export default function BusinessWorkspaceIntro({ businessId }) {
  const { t, i18n } = useTranslation();
  const c = (key, opts) => t(`helperG4.workspace.${key}`, opts);
  const [record, setRecord] = useState(null);
  const path = `/helpers/me/business-transition/records/${encodeURIComponent(businessId)}`;

  useEffect(() => {
    const ctrl = new AbortController();
    setRecord(null);
    api.get(path, { signal: ctrl.signal })
      .then(({ data }) => { if (!ctrl.signal.aborted) setRecord(data.record); })
      .catch(() => {});
    return () => ctrl.abort();
  }, [path]);

  async function dismiss() {
    try {
      await api.post(`${path}/dismiss-intro`);
      setRecord((r) => ({ ...r, intro: { ...r.intro, dismissed: true } }));
    } catch { /* keep showing; nothing changed */ }
  }

  if (!record) return null;
  const h = record.history || {};
  return <section className="helper-reputation" aria-labelledby={`biz-intro-${businessId}`}>
    {!record.intro?.dismissed && <>
      <h2 id={`biz-intro-${businessId}`}>{c('title')}</h2>
      <p>{c('hint')}</p>
      <ul className="helper-growth-milestones">
        {(record.intro?.steps || []).map((s) => <li key={s.key}><span>{c(`steps.${s.key}`)}</span><span>{s.done ? c('done') : c('todo')}</span></li>)}
      </ul>
      <div className="helper-growth-actions">
        <button type="button" onClick={dismiss} data-track="ui.helperG4.workspace.dismiss">{c('dismiss')}</button>
      </div>
    </>}
    <h3 id={record.intro?.dismissed ? `biz-intro-${businessId}` : undefined}>{c('recordTitle')}</h3>
    <p>{c('recordHint', { date: formatDate(h.takenAt || record.linkedAt, { locale: i18n.language }) })}</p>
    <ul>
      <li>{t('helperG4.growth.completedJobs', { count: h.completedJobs || 0 })}</li>
      {h.skills?.length > 0 && <li>{t('helperG4.growth.skills')}: <bdi>{h.skills.map((s) => s.name).join(', ')}</bdi></li>}
      {h.categories?.length > 0 && <li>{t('helperG4.growth.categories')}: <bdi>{h.categories.join(', ')}</bdi></li>}
    </ul>
    {record.portfolio?.length > 0 && <ul className="helper-growth-portfolio">
      {record.portfolio.map((p) => <li key={p.id}><img src={p.url} alt={p.caption || ''} loading="lazy" /></li>)}
    </ul>}
  </section>;
}
