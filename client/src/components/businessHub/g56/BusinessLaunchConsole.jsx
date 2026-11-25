// Groups 5-6 items 201, 203-205, 207, 210: launch status, verification and
// service publication checklists, listing claim, regional rules, pause.
import { useId, useState } from 'react';
import api from '../../../api/axios';
import { useBizG56, requestId } from './useBizG56';
import './g56.css';

const Mark = ({ ok, required, tr }) => <span className={ok ? 'g56-ok' : 'g56-miss'}>{ok ? '✓' : (required ? '•' : '○')} {required ? '' : tr('optional')}</span>;

export default function BusinessLaunchConsole({ businessId }) {
  const id = useId();
  const p = useBizG56(`/businesses/${businessId}/owner/launch-readiness`, 'launch');
  const o = useBizG56(`/businesses/${businessId}/owner/offerings`, 'offerings');
  const { tr, data } = p;
  const [query, setQuery] = useState('');
  const [listings, setListings] = useState(null);
  const [claim, setClaim] = useState({ listing: '', relationship: 'owner', evidence: '' });
  const claimsState = useBizG56('/business-listing-claims/mine', 'claim');
  const [edit, setEdit] = useState(null);
  if (!data) return p.error ? <section className="g56-panel"><p className="g56-error" role="alert">{p.errorText}</p></section> : null;
  async function search() { try { const { data: v } = await api.get('/business-listing-claims/listings', { params: { q: query.trim() } }); setListings(v.listings || []); } catch { setListings([]); } }
  async function submitClaim() {
    const ok = await claimsState.send('post', '/business-listing-claims', { requestId: requestId(), listing_id: Number(claim.listing), business_id: Number(businessId), relationship: claim.relationship, evidence: claim.evidence });
    if (ok) setClaim({ listing: '', relationship: 'owner', evidence: '' });
  }
  const svcRows = o.data?.services || [];
  return (
    <section className="g56-panel" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>{tr('title')}</h3>
      <p><span className="g56-badge">{tr(`status.${data.status}`)}</span> {tr('progress', { done: data.progress.done, total: data.progress.total })}</p>
      {data.hidden_reason && <p className="g56-error">{tr('hiddenReason')}: {data.hidden_reason}</p>}
      <h4>{tr('verificationTitle')}</h4>
      <ul className="g56-list">{data.verification.map(c => <li key={c.key}><Mark ok={c.ok} required={c.required} tr={tr} /> {tr(`check.${c.key}`)}</li>)}</ul>
      <h4>{tr('servicesTitle')}</h4>
      {!data.services.length && <p>{tr('noServices')}</p>}
      <ul className="g56-list">{data.services.map(s => (
        <li key={s.id}><strong>{s.name}</strong> {s.ready ? <span className="g56-ok">{tr('serviceReady')}</span> : <span className="g56-miss">{tr('serviceNotReady')}</span>}
          <div className="g56-row">{s.checks.filter(c => !c.ok).map(c => <span key={c.key} className="g56-badge">{tr(`serviceCheck.${c.key}`)}</span>)}</div></li>))}</ul>

      <h4>{o.tr('title')}</h4>
      {o.errorText && <p className="g56-error" role="alert">{o.errorText}</p>}
      <ul className="g56-list">{svcRows.map(s => {
        const paused = s.paused_at && (!s.paused_until || new Date(s.paused_until) > new Date());
        const open = edit?.id === s.id;
        return (
          <li key={s.id}>
            <strong>{s.name}</strong> · {o.tr(`mode.${s.region_mode}`)} {paused && <span className="g56-badge">{o.tr('paused')}{s.paused_until ? ` · ${o.tr('until', { date: o.time(s.paused_until) })}` : ''}</span>}
            <div className="g56-row">
              {paused
                ? <button type="button" disabled={o.busy} onClick={() => o.send('post', `/businesses/${businessId}/owner/services/${s.id}/resume`, { expectedVersion: s.offering_version })} data-track="ui.a0fb6aa542.1">{o.tr('resume')}</button>
                : <button type="button" disabled={o.busy} onClick={() => setEdit({ id: s.id, kind: 'pause', reason: '', until: '' })} data-track="ui.a0fb6aa542.2">{o.tr('pause')}</button>}
              <button type="button" disabled={o.busy} onClick={() => setEdit({ id: s.id, kind: 'regions', mode: s.region_mode, states: (s.region_states || []).join(', '), prefixes: (s.region_postal_prefixes || []).join(', ') })} data-track="ui.a0fb6aa542.3">{o.tr('editRegions')}</button>
            </div>
            {open && edit.kind === 'pause' && (
              <div className="g56-row">
                <label>{o.tr('reason')}<input value={edit.reason} maxLength={300} onChange={e => setEdit({ ...edit, reason: e.target.value })} /></label>
                <label>{o.tr('resumeOn')}<input type="datetime-local" value={edit.until} onChange={e => setEdit({ ...edit, until: e.target.value })} /></label>
                <button type="button" disabled={o.busy || !edit.reason.trim()} onClick={async () => { if (await o.send('post', `/businesses/${businessId}/owner/services/${s.id}/pause`, { reason: edit.reason, paused_until: edit.until ? new Date(edit.until).toISOString() : null, expectedVersion: s.offering_version })) { setEdit(null); p.refresh(); } }} data-track="ui.a0fb6aa542.4">{o.tr('confirmPause')}</button>
                <button type="button" onClick={() => setEdit(null)} data-track="ui.a0fb6aa542.5">{o.common('cancel')}</button>
              </div>)}
            {open && edit.kind === 'regions' && (
              <div className="g56-row">
                <label>{o.tr('modeLabel')}<select value={edit.mode} onChange={e => setEdit({ ...edit, mode: e.target.value })}>{['everywhere', 'only', 'except'].map(m => <option key={m} value={m}>{o.tr(`mode.${m}`)}</option>)}</select></label>
                {edit.mode !== 'everywhere' && <>
                  <label>{o.tr('states')}<input value={edit.states} onChange={e => setEdit({ ...edit, states: e.target.value })} dir="ltr" /></label>
                  <label>{o.tr('postal')}<input value={edit.prefixes} onChange={e => setEdit({ ...edit, prefixes: e.target.value })} dir="ltr" /></label></>}
                <button type="button" disabled={o.busy} onClick={async () => { const split = v => v.split(',').map(x => x.trim()).filter(Boolean); if (await o.send('put', `/businesses/${businessId}/owner/services/${s.id}/regions`, { region_mode: edit.mode, region_states: split(edit.states), region_postal_prefixes: split(edit.prefixes), expectedVersion: s.offering_version })) setEdit(null); }} data-track="ui.a0fb6aa542.6">{o.common('save')}</button>
                <button type="button" onClick={() => setEdit(null)} data-track="ui.a0fb6aa542.7">{o.common('cancel')}</button>
              </div>)}
          </li>);
      })}</ul>

      <h4>{claimsState.tr('title')}</h4>
      <p>{claimsState.tr('help')}</p>
      {claimsState.errorText && <p className="g56-error" role="alert">{claimsState.errorText}</p>}
      <div className="g56-row">
        <label>{claimsState.tr('search')}<input value={query} onChange={e => setQuery(e.target.value)} /></label>
        <button type="button" disabled={claimsState.busy || query.trim().length < 2} onClick={search} data-track="ui.a0fb6aa542.8">{claimsState.tr('find')}</button>
      </div>
      {listings && (listings.length ? (
        <div className="g56-row">
          <label>{claimsState.tr('listing')}<select value={claim.listing} onChange={e => setClaim({ ...claim, listing: e.target.value })}><option value="">{claimsState.tr('choose')}</option>{listings.map(l => <option key={l.id} value={l.id}>{l.business_name} · {[l.region, l.postal_code].filter(Boolean).join(' ')}</option>)}</select></label>
          <label>{claimsState.tr('relationship')}<select value={claim.relationship} onChange={e => setClaim({ ...claim, relationship: e.target.value })}>{['owner', 'officer', 'authorized_manager'].map(r => <option key={r} value={r}>{claimsState.tr(`rel.${r}`)}</option>)}</select></label>
          <label>{claimsState.tr('evidence')}<textarea value={claim.evidence} maxLength={2000} onChange={e => setClaim({ ...claim, evidence: e.target.value })} /></label>
          <button type="button" disabled={claimsState.busy || !claim.listing || claim.evidence.trim().length < 20} onClick={submitClaim} data-track="ui.a0fb6aa542.9">{claimsState.tr('submit')}</button>
        </div>) : <p>{claimsState.tr('noListings')}</p>)}
      <ul className="g56-list">{(claimsState.data?.claims || []).filter(c => String(c.business_id) === String(businessId)).map(c => (
        <li key={c.id}>{c.listing_name} · <span className="g56-badge">{claimsState.tr(`claimStatus.${c.status}`)}</span>{c.decision_reason ? ` · ${c.decision_reason}` : ''}
          {c.status === 'pending' && <button type="button" disabled={claimsState.busy} onClick={() => claimsState.send('post', `/business-listing-claims/${c.id}/withdraw`)} data-track="ui.a0fb6aa542.10">{claimsState.tr('withdraw')}</button>}</li>))}</ul>
      {(p.notice || o.notice || claimsState.notice) && <p role="status">{p.common('saved')}</p>}
    </section>
  );
}
