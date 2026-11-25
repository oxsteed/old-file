// Groups 5-6 items 262-270, 273-274, 281-284, 286-290: one job, for the
// people working it — handoff summary, checklist, progress, crew, documents,
// notes with mentions, completion record, materials, history, and blockers.
import { useState } from 'react';
import { useBizG56, requestId } from './useBizG56';
import './g56.css';

const KINDS = ['exception', 'missing_instruction', 'incident', 'access_denied', 'reassignment_request'];

function Blocker({ businessId, appointmentId }) {
  const p = useBizG56(`/businesses/${businessId}/work/exceptions`, 'job');
  const [f, setF] = useState({ kind: 'missing_instruction', category: '', severity: '', description: '' });
  if (!p.data) return null;
  const cats = p.data.kinds?.[f.kind] || [];
  const mine = p.data.raised.filter(e => e.appointment_id === appointmentId);
  return (
    <div>
      <h4>{p.tr('blockers')}</h4>
      <div className="g56-row">
        <label>{p.tr('kindLabel')}<select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value, category: '' })}>{KINDS.map(k => <option key={k} value={k}>{p.tr(`kind.${k}`)}</option>)}</select></label>
        <label>{p.tr('category')}<select value={f.category} onChange={e => setF({ ...f, category: e.target.value })}><option value="">—</option>{cats.map(c => <option key={c} value={c}>{p.tr(`cat.${c}`)}</option>)}</select></label>
        <label>{p.tr('severity')}<select value={f.severity} onChange={e => setF({ ...f, severity: e.target.value })}><option value="">{p.tr('sev.default')}</option>{['low', 'normal', 'high', 'critical'].map(s => <option key={s} value={s}>{p.tr(`sev.${s}`)}</option>)}</select></label>
        <label className="g56-grow">{p.tr('describe')}<input value={f.description} onChange={e => setF({ ...f, description: e.target.value })} maxLength={2000} /></label>
        <button type="button" disabled={p.busy || !f.category || f.description.trim().length < 5} onClick={async () => {
          if (await p.send('post', `/businesses/${businessId}/work/exceptions`, { ...f, severity: f.severity || undefined, appointment_id: appointmentId, request_id: requestId() })) setF({ ...f, description: '' });
        }} data-track="ui.68ec2fbbcd.1">{p.tr('raise')}</button>
      </div>
      <ul className="g56-list">{mine.map(e => (
        <li key={e.id}><span className="g56-badge">{p.tr(`kind.${e.kind}`)}</span> {e.description} · <span className="g56-badge">{p.tr(`excStatus.${e.status}`)}</span>
          {e.routed_to_name && <> · {p.tr('routedTo', { name: e.routed_to_name })}</>}{e.resolution && <> · {e.resolution}</>}
          {e.overdue && e.escalation_level < 2 && <button type="button" disabled={p.busy} onClick={() => p.send('post', `/businesses/${businessId}/work/exceptions/${e.id}/escalate`)} data-track="ui.68ec2fbbcd.2">{p.tr('escalate')}</button>}</li>))}</ul>
      {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
    </div>
  );
}

export default function WorkJobDetail({ businessId, appointmentId, onClose }) {
  const base = `/businesses/${businessId}/work/appointments/${appointmentId}`;
  const hs = useBizG56(`${base}/handoff`, 'job');
  const cl = useBizG56(`${base}/checklist`, 'job');
  const pg = useBizG56(`${base}/progress`, 'job');
  const docs = useBizG56(`${base}/documents`, 'job');
  const comp = useBizG56(`${base}/completion`, 'job');
  const mat = useBizG56(`${base}/materials`, 'job');
  const hist = useBizG56(`${base}/assignment-history`, 'job');
  const tm = useBizG56(`/businesses/${businessId}/work/teammates`, 'job');
  const [item, setItem] = useState(''); const [prog, setProg] = useState({ note: '', percent: '' });
  const [noteText, setNoteText] = useState(''); const [mentions, setMentions] = useState([]);
  const [cf, setCf] = useState(null); const [m, setM] = useState({ name: '', quantity: '1', unit: '', cost: '' });
  if (!hs.data) return hs.errorText ? <section className="g56-panel"><p className="g56-error">{hs.errorText}</p><button type="button" onClick={onClose} data-track="ui.68ec2fbbcd.3">{hs.tr('close')}</button></section> : null;
  const h = hs.data; const a = h.appointment;
  const items = cl.data?.items || (Array.isArray(cl.data) ? cl.data : []);
  const rec = comp.data?.record;
  const form = cf || { summary: rec?.summary || '', follow_up_needed: !!rec?.follow_up_needed, follow_up_note: rec?.follow_up_note || '', customer_signoff_name: rec?.customer_signoff_name || '' };
  const people = tm.data?.teammates || [];
  return (
    <section className="g56-panel" aria-label={hs.tr('title')}>
      <div className="g56-row"><h3 className="g56-grow">{a.service_name} · {hs.time(a.start_time)}</h3><button type="button" onClick={onClose} data-track="ui.68ec2fbbcd.4">{hs.tr('close')}</button></div>
      <p>{a.customer_name}{a.customer_notes && <> · {a.customer_notes}</>}</p>
      <h4>{hs.tr('handoff')}</h4>
      <ul className="g56-list">{h.notes.map(n => <li key={n.id}>{n.is_pinned && <span className="g56-badge">{hs.tr('pinned')}</span>} {n.content} · {n.author}</li>)}</ul>
      {h.open_exceptions.length > 0 && <p className="g56-miss">{hs.tr('openIssues', { count: h.open_exceptions.length })}</p>}
      {h.acknowledged_at ? <p className="g56-ok">{hs.tr('acked', { date: hs.time(h.acknowledged_at) })}</p>
        : <button type="button" disabled={hs.busy} onClick={() => hs.send('post', `${base}/handoff/ack`)} data-track="ui.68ec2fbbcd.5">{hs.tr('ack')}</button>}

      <h4>{hs.tr('checklist')}</h4>
      <ul className="g56-list">{items.map(i => (
        <li key={i.id}><label><span><input type="checkbox" checked={!!i.done_at} disabled={cl.busy} onChange={e => cl.send('patch', `${base}/checklist/${i.id}`, { done: e.target.checked })} data-track="ui.68ec2fbbcd.6" /> {i.label}{i.required && ' *'}</span></label></li>))}</ul>
      <div className="g56-row"><input aria-label={hs.tr('addItem')} value={item} onChange={e => setItem(e.target.value)} maxLength={160} />
        <button type="button" disabled={cl.busy || !item.trim()} onClick={async () => { if (await cl.send('post', `${base}/checklist`, { label: item })) setItem(''); }} data-track="ui.68ec2fbbcd.7">{hs.tr('addItem')}</button></div>

      <h4>{hs.tr('progress')}</h4>
      <div className="g56-row">
        <label>%<input type="number" min="0" max="100" value={prog.percent} onChange={e => setProg({ ...prog, percent: e.target.value })} /></label>
        <label className="g56-grow">{hs.tr('progressNote')}<input value={prog.note} onChange={e => setProg({ ...prog, note: e.target.value })} maxLength={1000} /></label>
        <button type="button" disabled={pg.busy || !prog.note.trim()} onClick={async () => { if (await pg.send('post', `${base}/progress`, prog)) setProg({ note: '', percent: '' }); }} data-track="ui.68ec2fbbcd.8">{hs.tr('post')}</button>
      </div>
      <ul className="g56-list">{(pg.data?.updates || []).map(u => <li key={u.id}>{u.percent != null && `${u.percent}% · `}{u.note} · {u.author_name} · {hs.time(u.created_at)}</li>)}</ul>

      <h4>{hs.tr('crew')}</h4>
      <ul className="g56-list">{h.crew.map(c => <li key={c.user_id}>{c.name} · {hs.tr(`crewRole.${c.role}`)} · <span className="g56-badge">{hs.tr(`attend.${c.attendance}`)}</span>{c.task_note && <> · {c.task_note}</>}</li>)}</ul>

      <h4>{hs.tr('notes')}</h4>
      <div className="g56-row">
        <label className="g56-grow">{hs.tr('noteText')}<input value={noteText} onChange={e => setNoteText(e.target.value)} maxLength={4000} /></label>
        {people.length > 0 && <label>{hs.tr('mention')}<select multiple value={mentions} onChange={e => setMentions([...e.target.selectedOptions].map(o => o.value))}>{people.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
        <button type="button" disabled={hs.busy || !noteText.trim()} onClick={async () => { if (await hs.send('post', `${base}/team-notes`, { content: noteText, mention_user_ids: mentions })) { setNoteText(''); setMentions([]); } }} data-track="ui.68ec2fbbcd.9">{hs.tr('post')}</button>
      </div>

      {(docs.data?.documents || []).length > 0 && <><h4>{hs.tr('documents')}</h4>
        <ul className="g56-list">{docs.data.documents.map(d => <li key={d.id}><strong>{d.title}</strong> {d.body}{d.url && <> · <a href={d.url} target="_blank" rel="noopener noreferrer" data-track="ui.68ec2fbbcd.10">{hs.tr('openLink')}</a></>}</li>)}</ul></>}

      <h4>{hs.tr('completion')}{comp.data?.required && ` (${hs.tr('required')})`}</h4>
      <div className="g56-row">
        <label className="g56-grow">{hs.tr('summary')}<textarea value={form.summary} onChange={e => setCf({ ...form, summary: e.target.value })} maxLength={2000} /></label>
        <label>{hs.tr('signoff')}<input value={form.customer_signoff_name} onChange={e => setCf({ ...form, customer_signoff_name: e.target.value })} maxLength={120} /></label>
        <label><span><input type="checkbox" checked={form.follow_up_needed} onChange={e => setCf({ ...form, follow_up_needed: e.target.checked })} data-track="ui.68ec2fbbcd.11" /> {hs.tr('followUp')}</span></label>
        {form.follow_up_needed && <label className="g56-grow">{hs.tr('followUpNote')}<input value={form.follow_up_note} onChange={e => setCf({ ...form, follow_up_note: e.target.value })} maxLength={1000} /></label>}
        <button type="button" disabled={comp.busy || form.summary.trim().length < 5} onClick={async () => { if (await comp.send('put', `${base}/completion`, { ...form, expectedVersion: rec?.version })) setCf(null); }} data-track="ui.68ec2fbbcd.12">{hs.tr('saveRecord')}</button>
      </div>
      {comp.errorText && <p className="g56-error" role="alert">{comp.errorText}</p>}

      <h4>{hs.tr('materials')}</h4>
      <div className="g56-row">
        <label>{hs.tr('material')}<input value={m.name} onChange={e => setM({ ...m, name: e.target.value })} maxLength={120} /></label>
        <label>{hs.tr('qty')}<input type="number" min="0" step="any" value={m.quantity} onChange={e => setM({ ...m, quantity: e.target.value })} /></label>
        <label>{hs.tr('unit')}<input value={m.unit} onChange={e => setM({ ...m, unit: e.target.value })} maxLength={20} /></label>
        <label>{hs.tr('cost')}<input type="number" min="0" step="0.01" value={m.cost} onChange={e => setM({ ...m, cost: e.target.value })} /></label>
        <button type="button" disabled={mat.busy || !m.name.trim() || !(Number(m.quantity) > 0)} onClick={async () => {
          if (await mat.send('post', `${base}/materials`, { name: m.name, quantity: Number(m.quantity), unit: m.unit || undefined, cost_cents: m.cost === '' ? undefined : Math.round(Number(m.cost) * 100) })) setM({ name: '', quantity: '1', unit: '', cost: '' });
        }} data-track="ui.68ec2fbbcd.13">{hs.tr('add')}</button>
      </div>
      <ul className="g56-list">{(mat.data?.materials || []).map(x => <li key={x.id}>{x.name} · {Number(x.quantity)} {x.unit}{x.cost_cents != null && ` · ${(x.cost_cents / 100).toFixed(2)}`}
        <button type="button" disabled={mat.busy} onClick={() => mat.send('delete', `/businesses/${businessId}/work/materials/${x.id}`)} data-track="ui.68ec2fbbcd.14">{hs.tr('remove')}</button></li>)}</ul>

      <Blocker businessId={businessId} appointmentId={appointmentId} />

      <h4>{hs.tr('history')}</h4>
      <ul className="g56-list">{(hist.data?.events || []).map((e, i) => <li key={i}>{hs.time(e.at)} · {hs.tr(`ev.${e.event}`, { defaultValue: e.event })} · {[e.from_name, e.to_name].filter(Boolean).join(' → ')}{e.actor_name && ` (${e.actor_name})`}</li>)}</ul>
      {[hs, cl, pg, mat].map(x => x.errorText).filter(Boolean).slice(0, 1).map(t => <p key={t} className="g56-error" role="alert">{t}</p>)}
    </section>
  );
}
