import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import './businessHub/g56/g56.css';

const KINDS = {
  exception: ['customer_not_home', 'access_issue', 'scope_change', 'parts_missing', 'weather', 'other'],
  missing_instruction: ['address', 'scope', 'access_code', 'materials', 'customer_contact', 'other'],
  incident: ['injury', 'property_damage', 'vehicle', 'safety_hazard', 'customer_conduct', 'other'],
  access_denied: ['permission', 'location', 'document', 'other'],
  reassignment_request: ['schedule', 'skills', 'workload', 'personal', 'other'],
};

// Group 5, item 265 (G5-5 HIGH): the crew member on a job reports a problem
// and it routes to the manager (the helper's business owner, else the
// client). The server decides routing and scope; this only collects the
// report and renders the per-job timeline.
export default function JobExceptions({ jobId, canRaise }) {
  const { t } = useTranslation();
  const c = (key, vars) => t(`jobDetail.jobExceptions.${key}`, vars);
  const g = (key, vars) => t(`bizG56.job.${key}`, vars);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [f, setF] = useState({ kind: 'exception', category: '', severity: '', description: '' });
  const [res, setRes] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: result } = await api.get(`/jobs/${encodeURIComponent(jobId)}/exceptions`);
      setData(result);
      setError('');
    } catch (err) {
      setError(err?.response?.data?.code || 'loadError');
    }
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  const raise = async () => {
    setBusy(true); setError('');
    try {
      await api.post(`/jobs/${encodeURIComponent(jobId)}/exceptions`, {
        ...f, severity: f.severity || undefined, request_id: crypto.randomUUID(),
      });
      setF({ ...f, description: '' });
      await load();
    } catch (err) {
      setError(err?.response?.data?.code || 'saveError');
    } finally { setBusy(false); }
  };

  const decide = async (e, status) => {
    setBusy(true); setError('');
    try {
      await api.patch(`/jobs/${encodeURIComponent(jobId)}/exceptions/${e.id}`, {
        status, resolution: res[e.id] || undefined, expectedVersion: e.version,
      });
      await load();
    } catch (err) {
      setError(err?.response?.data?.code || 'saveError');
    } finally { setBusy(false); }
  };

  if (!data && !error) return null;
  const cats = KINDS[f.kind] || [];
  const exceptions = data?.exceptions || [];
  return (
    <section className="jdp-card" aria-labelledby={`job-exceptions-${jobId}`}>
      <h2 id={`job-exceptions-${jobId}`} className="jdp-section-title">{c('title')}</h2>
      {error && <p role="alert">{error}</p>}
      {canRaise && (
        <div className="jdp-modal-actions">
          <label>{c('kindLabel')} <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, category: '' })}>
            {Object.keys(KINDS).map((k) => <option key={k} value={k}>{g(`kind.${k}`)}</option>)}
          </select></label>
          <label>{c('category')} <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            <option value="">—</option>
            {cats.map((cat) => <option key={cat} value={cat}>{g(`cat.${cat}`)}</option>)}
          </select></label>
          <label>{c('severity')} <select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>
            <option value="">{g('sev.default')}</option>
            {['low', 'normal', 'high', 'critical'].map((s) => <option key={s} value={s}>{g(`sev.${s}`)}</option>)}
          </select></label>
          <label className="grow">{c('describe')} <input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={2000} /></label>
          <button type="button" className="jdp-btn-ghost" disabled={busy || !f.category || f.description.trim().length < 5} onClick={raise} data-track="ui.573dfef74b.29">{c('raise')}</button>
        </div>
      )}
      {!exceptions.length ? <p>{c('empty')}</p> : (
        <ul className="g56-list">{exceptions.map((e) => (
          <li key={e.id}>
            <span className="g56-badge">{g(`kind.${e.kind}`)}</span> {e.description} · <span className="g56-badge">{g(`excStatus.${e.status}`)}</span>
            {e.routed_to_name && <> · {c('routedTo', { name: e.routed_to_name })}</>}{e.resolution && <> · {e.resolution}</>}
            {e.can_decide && ['open', 'acknowledged'].includes(e.status) && (
              <span className="jdp-modal-actions">
                <input aria-label={c('resolution')} placeholder={c('resolution')} value={res[e.id] || ''} onChange={(e2) => setRes({ ...res, [e.id]: e2.target.value })} maxLength={1000} />
                {e.status === 'open' && <button type="button" className="jdp-btn-ghost" disabled={busy} onClick={() => decide(e, 'acknowledged')} data-track="ui.573dfef74b.30">{c('acknowledge')}</button>}
                <button type="button" className="jdp-btn-ghost" disabled={busy || !(res[e.id] || '').trim()} onClick={() => decide(e, 'resolved')} data-track="ui.573dfef74b.31">{c('resolve')}</button>
                <button type="button" className="jdp-btn-ghost" disabled={busy || !(res[e.id] || '').trim()} onClick={() => decide(e, 'dismissed')} data-track="ui.573dfef74b.32">{c('dismiss')}</button>
              </span>
            )}
          </li>
        ))}</ul>
      )}
    </section>
  );
}
