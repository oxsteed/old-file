// Groups 5-6 item 225 (customer side): recent business visits and issue reports.
import { useState } from 'react';
import { useBizG56, requestId } from './useBizG56';
import './g56.css';

const CATEGORIES = ['quality', 'incomplete', 'damage', 'late_or_no_show', 'conduct', 'billing', 'other'];

export default function MyBusinessVisits() {
  const p = useBizG56('/me/business-visits', 'visits');
  const issues = useBizG56(null, 'issues');
  const [open, setOpen] = useState(null);
  if (!p.data?.visits?.length) return null;
  return (
    <section className="g56-panel">
      <h3>{p.tr('title')}</h3>
      <ul className="g56-list">{p.data.visits.map(v => (
        <li key={v.id}><strong>{v.business_name}</strong> · {v.service_name} · {p.time(v.start_time)}
          {v.issue && <> <span className="g56-badge">{issues.tr(`status.${v.issue.status}`)}</span>{v.issue.resolution ? <p><em>{v.issue.resolution}</em></p> : null}</>}
          {v.can_report && (!v.issue || ['resolved', 'dismissed'].includes(v.issue.status)) && open?.id !== v.id && <button type="button" onClick={() => setOpen({ id: v.id, business: v.business_id, category: 'quality', description: '', requestId: requestId() })} data-track="ui.2da3d807d7.1">{p.tr('report')}</button>}
          {open?.id === v.id && (
            <div className="g56-row">
              <label>{p.tr('category')}<select value={open.category} onChange={e => setOpen({ ...open, category: e.target.value })}>{CATEGORIES.map(c => <option key={c} value={c}>{issues.tr(`category.${c}`)}</option>)}</select></label>
              <label>{p.tr('description')}<textarea value={open.description} maxLength={2000} onChange={e => setOpen({ ...open, description: e.target.value })} /></label>
              <button type="button" disabled={p.busy || open.description.trim().length < 10} onClick={async () => { if (await p.send('post', `/businesses/${open.business}/appointments/${open.id}/service-issues`, { requestId: open.requestId, category: open.category, description: open.description })) setOpen(null); }} data-track="ui.2da3d807d7.2">{p.tr('send')}</button>
              <button type="button" onClick={() => setOpen(null)} data-track="ui.2da3d807d7.3">{p.common('cancel')}</button>
            </div>)}
        </li>))}</ul>
      {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
      {p.notice && <p role="status">{p.tr('sent')}</p>}
    </section>
  );
}
