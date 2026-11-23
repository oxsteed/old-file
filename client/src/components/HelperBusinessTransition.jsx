import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import api from '../api/axios';
import './HelperReputationPanel.css';
import './HelperBusinessTransition.css';

// Group 4 rest, items 196-199 (helper side): readiness milestones, a
// preview of what carries into a business (read-only) and what stays,
// the business application handoff, and linking the read-only record to a
// business the helper already owns. Server: /helpers/me/business-transition.
export default function HelperBusinessTransition() {
  const { user } = useAuth();
  return user?.id ? <Transition key={user.id} /> : null;
}

function Transition() {
  const { t } = useTranslation();
  const c = (key, opts) => t(`helperG4.growth.${key}`, opts);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState('');

  const load = (signal) => api.get('/helpers/me/business-transition', { signal })
    .then(({ data: d }) => { if (!signal?.aborted) setData(d); })
    .catch(() => { if (!signal?.aborted) setData(null); });
  useEffect(() => { const ctrl = new AbortController(); load(ctrl.signal); return () => ctrl.abort(); }, []);

  async function change(businessId, method) {
    setBusy(businessId); setNotice('');
    try {
      const path = `/helpers/me/business-transition/records/${encodeURIComponent(businessId)}`;
      await (method === 'delete' ? api.delete(path) : api.post(path));
      await load();
    } catch { setNotice(c('failed')); } finally { setBusy(null); }
  }

  if (!data) return null;
  const { milestones = [], preview = {}, links = [], ownedBusinesses = [] } = data;
  const linkedIds = new Set(links.map((l) => String(l.businessId)));
  const unlinked = ownedBusinesses.filter((b) => !linkedIds.has(String(b.id)));
  const carries = preview.carries || {};

  return <section className="helper-reputation" aria-labelledby="helper-growth-title">
    <h2 id="helper-growth-title">{c('title')}</h2>
    <p>{c('hint')}</p>
    {notice && <p role="alert">{notice}</p>}

    <h3>{c('milestonesTitle')}</h3>
    <p>{c('milestonesHint')}</p>
    <ul className="helper-growth-milestones">
      {milestones.map((m) => <li key={m.key}>
        <span>{c(`milestones.${m.key}`)}</span>
        <span>{m.key === 'completed_jobs' || m.key === 'steady_reviews' ? `${c('progress', { current: m.current, target: m.target })} · ` : ''}{m.met ? c('met') : c('notMet')}</span>
      </li>)}
    </ul>

    <h3>{c('previewTitle')}</h3>
    <div className="helper-growth-columns">
      <div>
        <h4>{c('carries')}</h4>
        <ul>
          <li>{c('completedJobs', { count: carries.completedJobs || 0 })}</li>
          <li>{c('portfolioItems', { count: carries.portfolioItems || 0 })}</li>
          {carries.skills?.length > 0 && <li>{c('skills')}: <bdi>{carries.skills.map((s) => s.name).join(', ')}</bdi></li>}
          {carries.categories?.length > 0 && <li>{c('categories')}: <bdi>{carries.categories.join(', ')}</bdi></li>}
        </ul>
      </div>
      <div>
        <h4>{c('stays')}</h4>
        <ul>{(preview.stays || []).map((k) => <li key={k}>{c(`stay.${k}`)}</li>)}</ul>
      </div>
    </div>
    {preview.serviceIdeas?.length > 0 && <>
      <h4>{c('serviceIdeas')}</h4>
      <ul>{preview.serviceIdeas.map((s) => <li key={s.skill}><bdi>{s.skill}</bdi></li>)}</ul>
    </>}

    <div className="helper-growth-actions">
      <Link to="/business-hub?create=service&from=helper" className="btn-primary" data-track="ui.helperG4.growth.start">{c('start')}</Link>
    </div>

    {links.map((l) => <div key={l.businessId} className="helper-growth-actions">
      <span>{c('linked', { name: l.businessName })}</span>
      <button type="button" disabled={busy === l.businessId} onClick={() => change(l.businessId, 'delete')} data-track="ui.helperG4.growth.unlink">{c('unlink')}</button>
    </div>)}
    {unlinked.length > 0 && <>
      <h4>{c('linkTitle')}</h4>
      {unlinked.map((b) => <div key={b.id} className="helper-growth-actions">
        <bdi>{b.name}</bdi>
        <button type="button" disabled={busy === b.id} onClick={() => change(b.id, 'post')} data-track="ui.helperG4.growth.link">{c('link')}</button>
      </div>)}
    </>}
  </section>;
}
