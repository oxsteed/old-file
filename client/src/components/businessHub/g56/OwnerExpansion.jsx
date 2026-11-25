// Groups 5-6 items 236-240: service locations with launch checklists,
// territory overview, capacity planning and the seasonal staffing forecast.
import { useState } from 'react';
import { useBizG56 } from './useBizG56';
import './g56.css';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const blank = { name: '', address_street: '', address_city: '', address_state: '', address_zip: '', phone: '', timezone: '', open: '09:00', close: '17:00', days: [], manager_user_id: '', member_ids: [], service_ids: [] };
const pct = v => (v == null ? '—' : `${Math.round(v * 100)}%`);

function toForm(l) {
  const days = Object.keys(l.hours || {});
  const first = days.length ? l.hours[days[0]] : ['09:00', '17:00'];
  return { ...blank, ...Object.fromEntries(Object.entries(l).filter(([k]) => k in blank && l[k] != null)), open: first[0], close: first[1], days, member_ids: l.member_ids || [], service_ids: (l.service_ids || []).map(Number) };
}
function toBody(f) {
  const hours = Object.fromEntries(f.days.map(d => [d, [f.open, f.close]]));
  return { name: f.name, address_street: f.address_street, address_city: f.address_city, address_state: f.address_state, address_zip: f.address_zip, phone: f.phone, timezone: f.timezone, hours, manager_user_id: f.manager_user_id || null, member_ids: f.member_ids, service_ids: f.service_ids };
}

function LocationForm({ p, data, initial, onSave, onCancel }) {
  const [f, setF] = useState(initial);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const toggle = (k, v) => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter(x => x !== v) : [...f[k], v] });
  return (
    <fieldset disabled={p.busy}>
      <div className="g56-row">
        <label>{p.tr('name')}<input maxLength={80} value={f.name} onChange={set('name')} /></label>
        <label>{p.tr('street')}<input value={f.address_street} onChange={set('address_street')} /></label>
        <label>{p.tr('city')}<input value={f.address_city} onChange={set('address_city')} /></label>
        <label>{p.tr('state')}<input maxLength={2} value={f.address_state} onChange={set('address_state')} /></label>
        <label>{p.tr('zip')}<input maxLength={10} inputMode="numeric" value={f.address_zip} onChange={set('address_zip')} /></label>
        <label>{p.tr('phone')}<input type="tel" value={f.phone} onChange={set('phone')} /></label>
        <label>{p.tr('timezone')}<input placeholder="America/New_York" value={f.timezone} onChange={set('timezone')} /></label>
      </div>
      <div className="g56-row">
        <span>{p.tr('hours')}</span>
        {DAYS.map(d => <label key={d}><span><input type="checkbox" checked={f.days.includes(d)} onChange={() => toggle('days', d)} data-track="ui.b7e2c41d08.1" /> {p.tr(`day.${d}`)}</span></label>)}
        <label>{p.tr('opens')}<input type="time" value={f.open} onChange={set('open')} /></label>
        <label>{p.tr('closes')}<input type="time" value={f.close} onChange={set('close')} /></label>
      </div>
      <div className="g56-row">
        <label>{p.tr('manager')}<select value={f.manager_user_id || ''} onChange={set('manager_user_id')}><option value="">—</option>{data.staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      </div>
      <div className="g56-row"><span>{p.tr('team')}</span>{data.staff.map(s => <label key={s.id}><span><input type="checkbox" checked={f.member_ids.includes(s.id)} onChange={() => toggle('member_ids', s.id)} data-track="ui.b7e2c41d08.2" /> {s.name}</span></label>)}</div>
      <div className="g56-row"><span>{p.tr('services')}</span>{data.services.map(s => <label key={s.id}><span><input type="checkbox" checked={f.service_ids.includes(s.id)} onChange={() => toggle('service_ids', s.id)} data-track="ui.b7e2c41d08.3" /> {s.name}</span></label>)}</div>
      <div className="g56-row">
        <button type="button" disabled={!f.name.trim()} onClick={() => onSave(toBody(f))} data-track="ui.b7e2c41d08.4">{p.common('save')}</button>
        <button type="button" onClick={onCancel} data-track="ui.b7e2c41d08.5">{p.common('cancel')}</button>
      </div>
    </fieldset>
  );
}

function Locations({ businessId }) {
  const base = `/businesses/${businessId}/owner/locations`;
  const p = useBizG56(base, 'expansion');
  const [editing, setEditing] = useState(null);
  const [item, setItem] = useState({});
  if (!p.data) return p.errorText ? <p className="g56-error">{p.errorText}</p> : null;
  const save = async body => {
    const ok = editing === 'new' ? await p.send('post', base, body) : await p.send('put', `${base}/${editing.id}`, { ...body, expectedVersion: editing.version });
    if (ok) setEditing(null);
  };
  return (
    <div>
      <h4>{p.tr('locations')}</h4>
      <p>{p.tr('locationsHelp')}</p>
      {editing ? <LocationForm p={p} data={p.data} initial={editing === 'new' ? blank : toForm(editing)} onSave={save} onCancel={() => setEditing(null)} />
        : <button type="button" onClick={() => setEditing('new')} data-track="ui.b7e2c41d08.6">{p.tr('addLocation')}</button>}
      {p.errorText && <p className="g56-error" role="alert">{p.errorText}</p>}
      <ul className="g56-list">
        {p.data.locations.map(l => (
          <li key={l.id}>
            <strong>{l.name}</strong> <span className="g56-badge">{p.tr(`status.${l.status}`)}</span> {[l.address_city, l.address_state].filter(Boolean).join(', ')}
            {l.manager_name && ` · ${p.tr('manager')}: ${l.manager_name}`}
            {l.status !== 'closed' && (
              <>
                <ul className="g56-list">
                  {l.checklist.computed.map(c => <li key={c.key} className={c.done ? 'g56-ok' : 'g56-miss'}>{c.done ? '✓' : '•'} {p.tr(`check.${c.key}`)}</li>)}
                  {l.checklist.items.map(i => (
                    <li key={i.id} className={i.done_at ? 'g56-ok' : 'g56-miss'}>
                      <label><span><input type="checkbox" checked={!!i.done_at} disabled={p.busy} onChange={e => p.send('patch', `${base}/${l.id}/checklist/${i.id}`, { done: e.target.checked })} data-track="ui.b7e2c41d08.7" /> {i.label}{!i.required && ` (${p.tr('optional')})`}</span></label>
                      {' '}<button type="button" disabled={p.busy} onClick={() => p.send('patch', `${base}/${l.id}/checklist/${i.id}`, { remove: true })} data-track="ui.b7e2c41d08.8">{p.tr('remove')}</button>
                    </li>
                  ))}
                </ul>
                <div className="g56-row">
                  <label>{p.tr('newItem')}<input maxLength={120} value={item[l.id] || ''} onChange={e => setItem({ ...item, [l.id]: e.target.value })} /></label>
                  <button type="button" disabled={p.busy || !(item[l.id] || '').trim()} onClick={async () => { if (await p.send('post', `${base}/${l.id}/checklist`, { label: item[l.id] })) setItem({ ...item, [l.id]: '' }); }} data-track="ui.b7e2c41d08.9">{p.tr('addItem')}</button>
                  <button type="button" disabled={p.busy} onClick={() => setEditing(l)} data-track="ui.b7e2c41d08.10">{p.tr('edit')}</button>
                  {['setup', 'paused'].includes(l.status) && <button type="button" disabled={p.busy || !l.checklist.ready} onClick={() => p.send('post', `${base}/${l.id}/launch`, { expectedVersion: l.version })} data-track="ui.b7e2c41d08.11">{p.tr('launch')}</button>}
                  {l.status === 'active' && <button type="button" disabled={p.busy} onClick={() => p.send('post', `${base}/${l.id}/pause`, { expectedVersion: l.version })} data-track="ui.b7e2c41d08.12">{p.tr('pause')}</button>}
                  <button type="button" disabled={p.busy} onClick={() => window.confirm(p.tr('closeConfirm')) && p.send('post', `${base}/${l.id}/close`, { expectedVersion: l.version })} data-track="ui.b7e2c41d08.13">{p.tr('close')}</button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Territory({ businessId }) {
  const p = useBizG56(`/businesses/${businessId}/owner/territory`, 'expansion');
  if (!p.data) return p.errorText ? <p className="g56-error">{p.errorText}</p> : null;
  return (
    <div>
      <h4>{p.tr('territory')}</h4>
      <p>{p.tr('territoryHelp')}</p>
      {!p.data.areas.length ? <p>{p.common('none')}</p> : (
        <table className="g56-table">
          <thead><tr><th scope="col">{p.tr('area')}</th><th scope="col">{p.tr('visits')}</th><th scope="col">{p.tr('visits90')}</th><th scope="col">{p.tr('share')}</th></tr></thead>
          <tbody>{p.data.areas.map(a => <tr key={`${a.state}-${a.zip3}`}><td>{a.state || a.zip3 ? `${a.state} ${a.zip3 ? `${a.zip3}xx` : ''}` : p.tr('unknownArea')}</td><td>{a.visits}</td><td>{a.visits_90d}</td><td>{pct(a.share)}</td></tr>)}</tbody>
        </table>
      )}
      {p.data.service_rules.length > 0 && <p>{p.tr('regionRules')}: {p.data.service_rules.map(r => `${r.name} (${[...(r.region_states || []), ...(r.region_postal_prefixes || [])].join(', ')})`).join('; ')}</p>}
    </div>
  );
}

function Capacity({ businessId, locations }) {
  const [weeks, setWeeks] = useState(4);
  const [loc, setLoc] = useState('');
  const p = useBizG56(`/businesses/${businessId}/owner/capacity?weeks=${weeks}${loc ? `&location_id=${loc}` : ''}`, 'expansion');
  return (
    <div>
      <h4>{p.tr('capacity')}</h4>
      <div className="g56-row">
        <label>{p.tr('weeks')}<select value={weeks} onChange={e => setWeeks(Number(e.target.value))}>{[1, 2, 4, 8, 12].map(w => <option key={w} value={w}>{w}</option>)}</select></label>
        {locations?.length > 0 && <label>{p.tr('location')}<select value={loc} onChange={e => setLoc(e.target.value)}><option value="">{p.tr('allLocations')}</option>{locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>}
      </div>
      {!p.data ? (p.errorText && <p className="g56-error">{p.errorText}</p>) : (
        <table className="g56-table">
          <thead><tr><th scope="col">{p.tr('weekOf')}</th><th scope="col">{p.tr('capacityHours')}</th><th scope="col">{p.tr('bookedHours')}</th><th scope="col">{p.tr('openHours')}</th><th scope="col">{p.tr('utilization')}</th></tr></thead>
          <tbody>{p.data.weeks.map(w => <tr key={w.week_start}><td>{w.week_start}</td><td>{w.capacity_hours}</td><td>{w.booked_hours}</td><td>{w.open_hours}</td><td className={w.utilization == null || w.utilization > 0.85 ? 'g56-miss' : 'g56-ok'}>{pct(w.utilization)}</td></tr>)}</tbody>
        </table>
      )}
      {p.data && p.data.days.some(d => d.flag !== 'ok') && (
        <ul className="g56-list">{p.data.days.filter(d => d.flag !== 'ok').map(d => <li key={d.day} className="g56-miss">{d.day}: {p.tr(`flag.${d.flag}`)} ({d.booked_hours + d.unassigned_hours}/{d.capacity_hours})</li>)}</ul>
      )}
    </div>
  );
}

function Forecast({ businessId }) {
  const p = useBizG56(`/businesses/${businessId}/owner/staffing-forecast`, 'expansion');
  if (!p.data) return p.errorText ? <p className="g56-error">{p.errorText}</p> : null;
  return (
    <div>
      <h4>{p.tr('forecast')}</h4>
      <p>{p.tr('forecastHelp', { staff: p.data.current_staff, hours: p.data.hours_per_person_month, target: Math.round(p.data.target_utilization * 100) })}</p>
      <table className="g56-table">
        <thead><tr><th scope="col">{p.tr('month')}</th><th scope="col">{p.tr('demandHours')}</th><th scope="col">{p.tr('staffNeeded')}</th><th scope="col">{p.tr('gap')}</th><th scope="col">{p.tr('basis')}</th></tr></thead>
        <tbody>{p.data.months.map(m => <tr key={m.month}><td>{m.month}</td><td>{m.demand_hours}</td><td>{m.staff_needed}</td><td className={m.gap > 0 ? 'g56-miss' : 'g56-ok'}>{m.gap > 0 ? `+${m.gap}` : m.gap}</td><td>{p.tr(`basisLabel.${m.basis}`)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

export default function OwnerExpansion({ businessId }) {
  const p = useBizG56(`/businesses/${businessId}/owner/locations`, 'expansion');
  return (
    <section className="g56-panel">
      <h3>{p.tr('title')}</h3>
      <Locations businessId={businessId} />
      <Territory businessId={businessId} />
      <Capacity businessId={businessId} locations={p.data?.locations?.filter(l => l.status !== 'closed')} />
      <Forecast businessId={businessId} />
    </section>
  );
}
