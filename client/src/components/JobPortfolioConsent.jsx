import { useEffect, useRef, useState, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { currentAuthEpoch, isCurrentAuthEpoch } from '../api/authSessionEpoch';
import { ACCESS_CHANGED_EVENT } from '../hooks/useAccessProjection';
import { createMessageRequestId } from '../lib/messageRequestId';
import api from '../api/axios';
import { formatDate } from '../lib/format';
import './HelperWorkPanel.css';
export default function JobPortfolioConsent({ jobId }) {
  const { user } = useAuth(), epoch = currentAuthEpoch();
  return user?.id ? <Consent key={`${user.id}:${epoch}:${jobId}`} jobId={jobId} epoch={epoch} /> : null;
}
function Consent({ jobId, epoch }) {
  const { t } = useTranslation(), id = useId(), tr = key => t(`portfolioConsent.${key}`);
  const gen = useRef(0), retry = useRef(null);
  const [data, setData] = useState(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [url, setUrl] = useState(''), [caption, setCaption] = useState(''), [reload, setReload] = useState(0);
  useEffect(() => {
    const seq = ++gen.current; setError('');
    api.get(`/helpers/me/portfolio-requests/${jobId}`).then(({ data: value }) => {
      if (seq === gen.current && isCurrentAuthEpoch(epoch)) setData(value);
    }).catch(() => { if (seq === gen.current && isCurrentAuthEpoch(epoch)) { setData(null); setError('loadError'); } });
    return () => { gen.current++; };
  }, [jobId, epoch, reload]);
  useEffect(() => {
    const refresh = () => { gen.current++; setData(null); setUrl(''); setCaption(''); setReload(value => value + 1); };
    window.addEventListener(ACCESS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ACCESS_CHANGED_EVENT, refresh);
  }, []);
  async function mutate(row, status) {
    if (busy) return;
    const seq = gen.current, valid = () => seq === gen.current && isCurrentAuthEpoch(epoch);
    setBusy(true); setError(''); setNotice('');
    try {
      if (row) await api.post(`/helpers/me/portfolio-requests/${jobId}/${row.id}`, { status, expectedVersion: row.version });
      else {
        const fingerprint = JSON.stringify([url, caption]);
        if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, id: createMessageRequestId() };
        await api.post(`/helpers/me/portfolio-requests/${jobId}`, { storage_key: url, caption, requestId: retry.current.id });
      }
      if (valid()) { if (!row) { retry.current = null; setUrl(''); setCaption(''); } setNotice('saved'); setReload(value => value + 1); }
    } catch (err) {
      if (valid()) { if ([403,404].includes(err.response?.status)) setData(null); setError(err.response?.status === 409 ? 'conflict' : 'saveError'); }
    } finally { if (isCurrentAuthEpoch(epoch)) setBusy(false); }
  }
  async function upload(file) {
    if (!file || busy) return;
    const seq = gen.current; setBusy(true); setError('');
    try {
      const form = new FormData(); form.append('file', file);
      const {data: value} = await api.post(`/helpers/me/portfolio-requests/${jobId}/upload`, form);
      if (seq === gen.current && isCurrentAuthEpoch(epoch)) { setUrl(value.key); setNotice('uploaded'); }
    } catch { if (seq === gen.current && isCurrentAuthEpoch(epoch)) setError('saveError'); }
    finally { if (isCurrentAuthEpoch(epoch)) setBusy(false); }
  }
  return <section className="helper-work" aria-label={tr('title')} data-track-private>
    <h2>{tr('title')}</h2><p>{tr('help')}</p><p>{tr('privacy')}</p>
    {error && <p role="alert">{tr(error)}</p>}<p role="status">{notice ? tr(notice) : ''}</p>
    {!data && !error && <p role="status">{tr('loading')}</p>}
    {data?.can_request && <fieldset disabled={busy}><legend>{tr('request')}</legend>
      <label htmlFor={`${id}-url`}>{tr('url')}</label><input id={`${id}-url`} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => upload(e.target.files?.[0])} />
      <label htmlFor={`${id}-caption`}>{tr('caption')}</label><input id={`${id}-caption`} value={caption} onChange={e => setCaption(e.target.value)} maxLength={200} />
      <button type="button" disabled={!url || !caption.trim()} onClick={() => mutate()}>{tr('request')}</button>
    </fieldset>}
    {data && <ul>{data.requests.map(row => <li key={row.id}>
      <p className="helper-work__text">{row.caption}</p><a href={row.media_url} target="_blank" rel="noreferrer">{tr('preview')}</a><p>{tr(row.status)}</p>
      <div className="helper-work__actions">
        {data.customer && row.status === 'pending' && <><button type="button" disabled={busy} onClick={() => mutate(row, 'approved')}>{tr('approve')}</button><button type="button" disabled={busy} onClick={() => mutate(row, 'declined')}>{tr('decline')}</button></>}
        {data.customer && row.status === 'approved' && <button type="button" disabled={busy} onClick={() => mutate(row, 'revoked')}>{tr('revoke')}</button>}
        {!data.customer && ['pending','approved'].includes(row.status) && <button type="button" disabled={busy} onClick={() => mutate(row, 'withdrawn')}>{tr('withdraw')}</button>}
      </div>
      <ol aria-label={tr('history')}>{(row.events || []).map((event, index) => <li key={index}>{tr(event.status)} · {formatDate(event.created_at)}</li>)}</ol>
    </li>)}</ul>}
    {data && !data.requests.length && <p>{tr('empty')}</p>}
    <button type="button" disabled={busy} onClick={() => { gen.current++; setData(null); setReload(value => value + 1); }}>{tr('reload')}</button>
  </section>;
}
