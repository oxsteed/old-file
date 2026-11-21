import { useEffect, useRef, useState, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { currentAuthEpoch, isCurrentAuthEpoch } from '../api/authSessionEpoch';
import { ACCESS_CHANGED_EVENT } from '../hooks/useAccessProjection';
import api from '../api/axios';
import './HelperWorkPanel.css';
export const DISCOVERY_CHANGED_EVENT = 'oxsteed:discovery-changed';
export default function HelperDiscoverySettings() {
  const { user } = useAuth();
  const epoch = currentAuthEpoch();
  return user?.id ? <Settings key={`${user.id}:${epoch}`} epoch={epoch} /> : null;
}
function Settings({ epoch }) {
  const { t } = useTranslation(), id = useId(), tr = key => t(`helperDiscovery.${key}`);
  const generation = useRef(0);
  const [policy, setPolicy] = useState(null), [radius, setRadius] = useState('25');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  useEffect(() => {
    const seq = ++generation.current;
    setPolicy(null); setError('');
    api.get('/helpers/me/discovery').then(({ data }) => {
      if (seq !== generation.current || !isCurrentAuthEpoch(epoch)) return;
      if (!data?.preferences) throw new Error('Invalid preferences');
      setPolicy(data.preferences); setRadius(String(data.preferences.opportunity_radius_miles));
    }).catch(() => { if (seq === generation.current && isCurrentAuthEpoch(epoch)) setError('loadError'); });
    return () => { generation.current++; };
  }, [epoch, reload]);
  useEffect(() => {
    const refresh = () => { generation.current++; setPolicy(null); setReload(value => value + 1); };
    window.addEventListener(ACCESS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ACCESS_CHANGED_EVENT, refresh);
  }, []);
  async function save() {
    if (!policy || busy) return;
    const seq = generation.current, valid = () => seq === generation.current && isCurrentAuthEpoch(epoch);
    setBusy(true); setError(''); setNotice('');
    try {
      const { data } = await api.put('/helpers/me/discovery', { opportunity_radius_miles: Number(radius), expectedVersion: policy.discovery_version });
      if (valid()) { setPolicy(data.preferences); setNotice('saved'); window.dispatchEvent(new Event(DISCOVERY_CHANGED_EVENT)); }
    } catch (err) {
      if (valid()) { if ([403,404].includes(err.response?.status)) setPolicy(null); setError(err.response?.data?.code === 'discovery_version_conflict' ? 'conflict' : 'saveError'); }
    } finally { if (isCurrentAuthEpoch(epoch)) setBusy(false); }
  }
  return <section className="helper-work" aria-label={tr('title')} data-track-private>
    <h3>{tr('title')}</h3><p>{tr('help')}</p>
    {error && <p role="alert">{tr(error)}</p>}<p role="status">{notice ? tr(notice) : ''}</p>
    {!policy && !error && <p role="status">{tr('loading')}</p>}
    {policy && <fieldset disabled={busy}><legend>{tr('title')}</legend>
      <label htmlFor={id}>{tr('radius')}</label><input id={id} type="number" min="1" max="250" value={radius} onChange={e => setRadius(e.target.value)} />
      <button type="button" onClick={save}>{tr('save')}</button>
    </fieldset>}
    <button type="button" disabled={busy} onClick={() => { generation.current++; setPolicy(null); setReload(value => value + 1); }}>{tr('reload')}</button><p>{tr('reloadHelp')}</p>
  </section>;
}
