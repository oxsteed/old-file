import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { currentAuthEpoch, isCurrentAuthEpoch } from '../api/authSessionEpoch';
import { ACCESS_CHANGED_EVENT } from '../hooks/useAccessProjection';
import api from '../api/axios';
import './HelperWorkPanel.css';
export default function JobSuitabilityPreview({ jobId }) {
  const { user, hasHelperAccess } = useAuth();
  const epoch = currentAuthEpoch();
  return user?.id && hasHelperAccess ? <Preview key={`${user.id}:${epoch}:${jobId}`} jobId={jobId} epoch={epoch} /> : null;
}
function Preview({ jobId, epoch }) {
  const { t } = useTranslation(), tr = key => t(`helperSuitability.${key}`);
  const [data, setData] = useState(null), [error, setError] = useState(false), [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true; setData(null); setError(false);
    api.get(`/helpers/me/suitability/${jobId}`).then(({ data: value }) => {
      if (active && isCurrentAuthEpoch(epoch)) setData(value);
    }).catch(() => { if (active && isCurrentAuthEpoch(epoch)) setError(true); });
    const refresh = () => { active = false; setData(null); setReload(value => value + 1); };
    window.addEventListener(ACCESS_CHANGED_EVENT, refresh);
    return () => { active = false; window.removeEventListener(ACCESS_CHANGED_EVENT, refresh); };
  }, [jobId, epoch, reload]);
  return <section className="helper-work" aria-label={tr('title')} data-track-private>
    <h2>{tr('title')}</h2><p>{tr('help')}</p>
    {error ? <><p role="alert">{tr('loadError')}</p><button type="button" onClick={() => setReload(value => value + 1)}>{tr('reload')}</button></> : !data ? <p role="status">{tr('loading')}</p> : <>
      <p>{tr(data.can_bid_now ? 'eligible' : 'notOpen')}</p><p>{tr(`schedule_${data.schedule}`)}</p>
      <h3>{tr('review')}</h3><ul>{[...(data.requirements || []), ...(data.required_skills || [])].map((item, index) => <li key={index}>{item}</li>)}</ul>
      {!data.requirements?.length && !data.required_skills?.length && <p>{tr('none')}</p>}
      <button type="button" onClick={() => setReload(value => value + 1)}>{tr('reload')}</button>
    </>}
  </section>;
}
