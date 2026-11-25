// Groups 7-8 items 351-400: restaurant operations console. Location
// readiness, settings, special hours, menu changes, ops reports, downtime,
// transfers, and emergency closure. Server enforces every permission; the
// panel only renders what the API returns.
import { useState } from 'react';
import { useBizG56 } from './useBizG56';
import './g56.css';

const SUBSTITUTION = ['contact_customer', 'substitute_similar', 'refund_item', 'cancel_order'];
const REOPEN_KEYS = ['equipment_checked', 'food_safety_checked', 'staff_ready', 'systems_online'];
const CLOSURE_REASONS = ['power', 'water', 'weather', 'equipment', 'staffing', 'safety', 'other'];

function Notice({ p }) {
  return (
    <>
      {p.notice && <p role="status" className="g56-ok">{p.common('saved')}</p>}
      {p.errorText && <p role="alert" className="g56-error">{p.errorText}</p>}
    </>
  );
}

export default function RestaurantOpsPanel({ restaurantId }) {
  const locs = useBizG56(`/restaurants/${restaurantId}/locations`, 'ops');
  const [locationId, setLocationId] = useState('');
  const locations = locs.data?.locations || [];
  const selected = locationId || (locations[0] ? String(locations[0].id) : '');
  const base = `/restaurants/${restaurantId}/ops`;
  return (
    <section className="g56-panel" aria-label="operations console">
      <h3>{locs.tr('title')}</h3>
      <p className="g56-muted">{locs.tr('subtitle')}</p>
      {locs.errorText && <p className="g56-error">{locs.errorText}</p>}
      {locations.length > 0 && (
        <label>{locs.common('location')}
          <select value={selected} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => <option key={l.id} value={String(l.id)}>{l.name}</option>)}
          </select>
        </label>
      )}
      {selected && (
        <>
          <ReadinessSection base={base} locationId={selected} locations={locations} />
          <MenuSection base={base} locationId={selected} />
          <MenuImportSection base={base} />
          <DowntimeSection base={base} locationId={selected} />
          <TransfersSection base={base} locationId={selected} locations={locations} />
          <ClosureSection base={base} locationId={selected} />
          <PackageLabelSection restaurantId={restaurantId} />
          <DriverArrivalsSection restaurantId={restaurantId} locationId={selected} />
          <KitchenTicketsSection base={base} restaurantId={restaurantId} locationId={selected} />
        </>
      )}
      <ReportsSection base={base} locationId={selected} />
    </section>
  );
}

function ReadinessSection({ base, locationId, locations }) {
  const r = useBizG56(`${base}/locations/${locationId}/readiness`, 'ops');
  const s = useBizG56(`${base}/locations/${locationId}/settings`, 'ops');
  const h = useBizG56(`${base}/locations/${locationId}/special-hours`, 'ops');
  const [settings, setSettings] = useState(null);
  const [copyFrom, setCopyFrom] = useState('');
  const [hoursForm, setHoursForm] = useState({ on_date: '', closed: false, opens_at: '', closes_at: '', label: '' });
  const current = settings ?? s.data;
  if (!r.data) return r.errorText ? <p className="g56-error">{r.errorText}</p> : null;
  const setCheck = (key, done) => r.send('post', `${base}/locations/${locationId}/checks/${key}`, { done });
  const saveSettings = async (e) => {
    e.preventDefault();
    if (!current) return;
    const body = {};
    for (const k of ['scheduled_slot_minutes', 'scheduled_slot_max_orders', 'unclaimed_pickup_minutes']) {
      const v = current[k];
      if (v !== '' && v != null) body[k] = Number(v);
    }
    for (const k of ['pickup_area_label', 'pickup_instructions', 'pickup_parking_note']) {
      if (current[k] !== undefined) body[k] = current[k];
    }
    body.curbside_enabled = Boolean(current.curbside_enabled);
    if (current.substitution_policy) body.substitution_policy = current.substitution_policy;
    await s.send('patch', `${base}/locations/${locationId}/settings`, body);
  };
  const addHours = async (e) => {
    e.preventDefault();
    if (!hoursForm.on_date) return;
    const created = await h.send('post', `${base}/locations/${locationId}/special-hours`, {
      on_date: hoursForm.on_date, closed: hoursForm.closed,
      opens_at: hoursForm.closed ? undefined : hoursForm.opens_at,
      closes_at: hoursForm.closed ? undefined : hoursForm.closes_at,
      label: hoursForm.label.trim() || undefined,
    });
    if (created) setHoursForm({ on_date: '', closed: false, opens_at: '', closes_at: '', label: '' });
  };
  return (
    <div>
      <h4>{r.tr('readiness')} · {r.data.location_name}</h4>
      <Notice p={r} />
      <p className="g56-muted">
        {r.data.done}/{r.data.total} · {r.data.ready ? r.tr('ready') : r.tr('notReady')}
        {r.data.launched_at ? ` · ${r.time(r.data.launched_at)}` : ''}
      </p>
      <ul className="g56-list">
        {r.data.checks.map((c) => (
          <li key={c.key}>
            {r.tr(`check.${c.key}`)} · {c.done ? r.tr('ready') : r.tr('notReady')}
            {c.source === 'manual' && (
              <button type="button" disabled={r.busy} onClick={() => setCheck(c.key, !c.done)} data-track="ui.f17c022f60.1">{r.tr('markDone')}</button>
            )}
          </li>
        ))}
      </ul>
      {!r.data.ready && (
        <button type="button" disabled={r.busy} onClick={() => r.send('post', `${base}/locations/${locationId}/launch`, {})} data-track="ui.f17c022f60.2">{r.tr('launch')}</button>
      )}
      <div className="g56-row">
        <label>{r.common('location')}
          <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            <option value="">—</option>
            {locations.filter((l) => String(l.id) !== String(locationId)).map((l) => <option key={l.id} value={String(l.id)}>{l.name}</option>)}
          </select>
        </label>
        <button type="button" disabled={r.busy || !copyFrom} onClick={() => r.send('post', `${base}/locations/${locationId}/copy-settings`, { from_location_id: Number(copyFrom) })} data-track="ui.f17c022f60.3">{r.tr('copySettings')}</button>
      </div>
      <h5>{s.tr('settings')}</h5>
      <Notice p={s} />
      {current && (
        <form onSubmit={saveSettings} className="g56-row" data-track="ui.f17c022f60.4">
          <label>{s.tr('slotMinutes')}<input type="number" min="5" max="120" value={current.scheduled_slot_minutes ?? ''} onChange={(e) => setSettings({ ...current, scheduled_slot_minutes: e.target.value })} dir="ltr" /></label>
          <label>{s.tr('slotMax')}<input type="number" min="0" max="1000" value={current.scheduled_slot_max_orders ?? ''} onChange={(e) => setSettings({ ...current, scheduled_slot_max_orders: e.target.value })} dir="ltr" /></label>
          <label>{s.tr('unclaimedMinutes')}<input type="number" min="5" max="240" value={current.unclaimed_pickup_minutes ?? ''} onChange={(e) => setSettings({ ...current, unclaimed_pickup_minutes: e.target.value })} dir="ltr" /></label>
          <label>{s.tr('pickupArea')}<input value={current.pickup_area_label || ''} maxLength={120} onChange={(e) => setSettings({ ...current, pickup_area_label: e.target.value })} /></label>
          <label>{s.tr('pickupInstructions')}<input value={current.pickup_instructions || ''} maxLength={1000} onChange={(e) => setSettings({ ...current, pickup_instructions: e.target.value })} /></label>
          <label>{s.tr('parkingNote')}<input value={current.pickup_parking_note || ''} maxLength={500} onChange={(e) => setSettings({ ...current, pickup_parking_note: e.target.value })} /></label>
          <label><input type="checkbox" checked={Boolean(current.curbside_enabled)} onChange={(e) => setSettings({ ...current, curbside_enabled: e.target.checked })} data-track="ui.f17c022f60.5" /> {s.tr('curbside')}</label>
          <label>{s.tr('substitution')}<select value={current.substitution_policy || ''} onChange={(e) => setSettings({ ...current, substitution_policy: e.target.value })}><option value="">—</option>{SUBSTITUTION.map((v) => <option key={v} value={v}>{s.tr(`sub.${v}`)}</option>)}</select></label>
          <button type="submit" disabled={s.busy} data-track="ui.f17c022f60.6">{s.tr('saveSettings')}</button>
        </form>
      )}
      <h5>{h.tr('specialHours')}</h5>
      <Notice p={h} />
      {h.data?.special_hours.length > 0 && (
        <ul className="g56-list">{h.data.special_hours.map((row) => (
          <li key={row.id}>
            {row.on_date} · {row.closed ? h.tr('closed') : `${row.opens_at}–${row.closes_at}`}{row.label ? ` · ${row.label}` : ''}
            {' '}<button type="button" disabled={h.busy} onClick={() => h.send('delete', `${base}/locations/${locationId}/special-hours/${row.id}`)} data-track="ui.f17c022f60.7">{h.common('delete')}</button>
          </li>
        ))}</ul>
      )}
      <form onSubmit={addHours} className="g56-row" data-track="ui.f17c022f60.8">
        <label>{h.tr('startDate')}<input type="date" value={hoursForm.on_date} onChange={(e) => setHoursForm({ ...hoursForm, on_date: e.target.value })} /></label>
        <label><input type="checkbox" checked={hoursForm.closed} onChange={(e) => setHoursForm({ ...hoursForm, closed: e.target.checked })} data-track="ui.f17c022f60.9" /> {h.tr('closed')}</label>
        {!hoursForm.closed && (
          <>
            <label>{h.tr('openTime')}<input type="time" value={hoursForm.opens_at} onChange={(e) => setHoursForm({ ...hoursForm, opens_at: e.target.value })} /></label>
            <label>{h.tr('closeTime')}<input type="time" value={hoursForm.closes_at} onChange={(e) => setHoursForm({ ...hoursForm, closes_at: e.target.value })} /></label>
          </>
        )}
        <label>{h.tr('label')}<input value={hoursForm.label} maxLength={80} onChange={(e) => setHoursForm({ ...hoursForm, label: e.target.value })} /></label>
        <button type="submit" disabled={h.busy || !hoursForm.on_date} data-track="ui.f17c022f60.10">{h.tr('addHours')}</button>
      </form>
    </div>
  );
}

function MenuSection({ base, locationId }) {
  const m = useBizG56(`${base}/menu/scheduled-changes`, 'ops');
  const hist = useBizG56(`${base}/menu/history?location_id=${locationId}`, 'ops');
  const [form, setForm] = useState({ menu_item_id: '', price: '', is_available: '', effective_at: '' });
  const schedule = async (e) => {
    e.preventDefault();
    const itemId = Number(form.menu_item_id);
    if (!itemId || !form.effective_at) return;
    const body = { menu_item_id: itemId, location_id: Number(locationId), effective_at: new Date(form.effective_at).toISOString() };
    if (form.price !== '') body.price_cents = Math.round(parseFloat(form.price) * 100);
    if (form.is_available !== '') body.is_available = form.is_available === 'true';
    const created = await m.send('post', `${base}/menu/scheduled-changes`, body);
    if (created) setForm({ menu_item_id: '', price: '', is_available: '', effective_at: '' });
  };
  return (
    <div>
      <h4>{m.tr('menu')}</h4>
      <Notice p={m} />
      <h5>{m.tr('scheduledChanges')}</h5>
      {!m.data ? (m.errorText && <p className="g56-error">{m.errorText}</p>) : m.data.changes.length === 0 ? <p>{m.common('empty')}</p> : (
        <table className="g56-table">
          <thead><tr><th scope="col">{m.common('item')}</th><th scope="col">{m.common('location')}</th><th scope="col">{m.tr('changeType')}</th><th scope="col">{m.tr('effectiveAt')}</th><th scope="col">{m.common('status')}</th><th scope="col"><span className="g56-sr">{m.tr('cancelChange')}</span></th></tr></thead>
          <tbody>{m.data.changes.map((c) => (
            <tr key={c.id}>
              <td>{c.item_name}</td><td>{c.location_name || '—'}</td>
              <td>{c.price_cents != null ? `$${(c.price_cents / 100).toFixed(2)}` : ''}{c.is_available != null ? ` · ${c.is_available ? m.tr('ready') : m.tr('closed')}` : ''}</td>
              <td>{m.time(c.effective_at)}</td><td>{c.status}</td>
              <td>{c.status === 'pending' && <button type="button" disabled={m.busy} onClick={() => m.send('post', `${base}/menu/scheduled-changes/${c.id}/cancel`, {})} data-track="ui.f17c022f60.11">{m.tr('cancelChange')}</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <form onSubmit={schedule} className="g56-row" data-track="ui.f17c022f60.12">
        <label>{m.tr('menuItemId')}<input inputMode="numeric" value={form.menu_item_id} onChange={(e) => setForm({ ...form, menu_item_id: e.target.value })} dir="ltr" /></label>
        <label>{m.common('amount')}<input inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} dir="ltr" /></label>
        <label>{m.tr('changeType')}<select value={form.is_available} onChange={(e) => setForm({ ...form, is_available: e.target.value })}><option value="">—</option><option value="true">{m.tr('ready')}</option><option value="false">{m.tr('closed')}</option></select></label>
        <label>{m.tr('effectiveAt')}<input type="datetime-local" value={form.effective_at} onChange={(e) => setForm({ ...form, effective_at: e.target.value })} /></label>
        <button type="submit" disabled={m.busy} data-track="ui.f17c022f60.13">{m.tr('scheduleChange')}</button>
      </form>
      <h5>{hist.tr('menuHistory')}</h5>
      {!hist.data ? (hist.errorText && <p className="g56-error">{hist.errorText}</p>) : hist.data.changes.length === 0 ? <p>{hist.common('empty')}</p> : (
        <ul className="g56-list">{hist.data.changes.slice(0, 20).map((c) => <li key={c.id}>{c.item_name} · {c.field} · {String(c.old_value ?? '')} → {String(c.new_value ?? '')} · {c.changed_by_name || ''} · {hist.time(c.created_at)}</li>)}</ul>
      )}
    </div>
  );
}

function MenuImportSection({ base }) {
  const m = useBizG56(null, 'ops');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState(null);
  const readFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setCsv(String(r.result || ''));
    r.readAsText(f);
  };
  const doPreview = async (e) => {
    e.preventDefault();
    if (!csv.trim()) return;
    const v = await m.send('post', `${base}/menu/import`, { csv });
    if (v) setPreview(v);
  };
  const confirm = async () => {
    const v = await m.send('post', `${base}/menu/import`, { csv, dry_run: false });
    if (v) setPreview(v);
  };
  return (
    <div>
      <h4>{m.tr('importMenu')}</h4>
      <Notice p={m} />
      <p className="g56-muted">{m.tr('importDrafts')}</p>
      <form onSubmit={doPreview} className="g56-row" data-track="ui.f17c022f60.28">
        <label>{m.tr('importUpload')}<input type="file" accept=".csv,text/csv" onChange={readFile} /></label>
        <label>{m.tr('importPaste')}<textarea value={csv} rows={4} maxLength={500000} onChange={(e) => setCsv(e.target.value)} dir="ltr" /></label>
        <button type="submit" disabled={m.busy || !csv.trim()} data-track="ui.f17c022f60.35">{m.tr('importPreview')}</button>
      </form>
      {preview && (
        <div>
          <p className="g56-muted">
            {preview.dry_run ? m.tr('importPreview') : m.tr('importConfirm')} · {m.tr('importCreated')}: {preview.create ?? preview.created ?? 0} · {m.tr('importSkipped')}: {preview.skipped ?? 0}
          </p>
          {preview.rows?.length > 0 && (
            <table className="g56-table">
              <thead><tr><th scope="col">{m.common('item')}</th><th scope="col">{m.common('amount')}</th><th scope="col">{m.common('status')}</th></tr></thead>
              <tbody>{preview.rows.map((row) => (
                <tr key={row.line}>
                  <td>{row.name || '—'}{row.category ? ` · ${row.category}` : ''}</td>
                  <td>{row.price_cents != null ? `$${(row.price_cents / 100).toFixed(2)}` : '—'}</td>
                  <td>{row.status}{row.errors?.length > 0 ? ` · ${row.errors.join(', ')}` : ''}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {preview.dry_run && (preview.create ?? 0) > 0 && (
            <button type="button" disabled={m.busy} onClick={confirm} data-track="ui.f17c022f60.29">{m.tr('importConfirm')}</button>
          )}
        </div>
      )}
    </div>
  );
}

function ReportsSection({ base, locationId }) {
  const days = 30;
  const unc = useBizG56(`${base}/reports/unclaimed?days=${days}`, 'ops');
  const can = useBizG56(`${base}/reports/cancellations?days=${days}`, 'ops');
  const dis = useBizG56(`${base}/reports/dispatch-delays?days=${days}`, 'ops');
  const prep = useBizG56(`${base}/reports/prep-trends?days=${days}`, 'ops');
  const unav = useBizG56(`${base}/reports/unavailability?days=${days}`, 'ops');
  const peak = useBizG56(`${base}/reports/peak-load?days=${days}`, 'ops');
  const rep = useBizG56(`${base}/reports/repeat-issues?days=${days}`, 'ops');
  const cap = useBizG56(locationId ? `${base}/reports/capacity-forecast?location_id=${locationId}` : null, 'ops');
  return (
    <div>
      <h4>{unc.tr('reports')} · {unc.tr('days')}: {days}</h4>
      <h5>{unc.tr('unclaimed')}</h5>
      {!unc.data ? (unc.errorText && <p className="g56-error">{unc.errorText}</p>) : unc.data.orders.length === 0 ? <p>{unc.common('empty')}</p> : (
        <ul className="g56-list">{unc.data.orders.map((o) => <li key={o.id}>#{o.queue_number || o.id} · {o.guest_name || o.pickup_contact_name || ''} · {unc.time(o.ready_at)} · {o.location_name || ''}</li>)}</ul>
      )}
      <h5>{can.tr('cancellations')}</h5>
      {!can.data ? (can.errorText && <p className="g56-error">{can.errorText}</p>) : can.data.orders.length === 0 ? <p>{can.common('empty')}</p> : (
        <table className="g56-table">
          <thead><tr><th scope="col">{can.tr('orders')}</th><th scope="col">{can.common('created')}</th><th scope="col">{can.common('status')}</th><th scope="col">{can.tr('followUp')}</th></tr></thead>
          <tbody>{can.data.orders.map((o) => (
            <tr key={o.id}>
              <td>#{o.queue_number || o.id} · {o.guest_name || ''}</td><td>{can.time(o.cancelled_at)}</td><td>{o.follow_up_status || 'pending'}</td>
              <td>
                <button type="button" disabled={can.busy} onClick={() => can.send('post', `${base}/reports/cancellations/${o.id}/follow-up`, { status: 'contacted' })} data-track="ui.f17c022f60.14">{can.tr('followUp')}</button>
                {' '}
                <button type="button" disabled={can.busy} onClick={() => can.send('post', `${base}/reports/cancellations/${o.id}/follow-up`, { status: 'resolved' })} data-track="ui.f17c022f60.15">{can.tr('resolution')}</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <h5>{dis.tr('dispatchDelays')}</h5>
      {!dis.data ? (dis.errorText && <p className="g56-error">{dis.errorText}</p>) : (
        <>
          {dis.data.locations.length > 0 && (
            <table className="g56-table">
              <thead><tr><th scope="col">{dis.common('location')}</th><th scope="col">{dis.tr('orders')}</th><th scope="col">{dis.tr('minutesLate')}</th></tr></thead>
              <tbody>{dis.data.locations.map((row) => <tr key={row.location_id}><td>{row.location_name}</td><td>{row.tasks}</td><td>{row.late_deliveries ?? row.avg_late_minutes ?? '—'}</td></tr>)}</tbody>
            </table>
          )}
          {dis.data.worst.length > 0 && <ul className="g56-list">{dis.data.worst.map((w) => <li key={w.id}>{w.order_reference} · {w.late_minutes} {dis.tr('minutesLate')}</li>)}</ul>}
        </>
      )}
      <h5>{prep.tr('prepTrends')}</h5>
      {!prep.data ? (prep.errorText && <p className="g56-error">{prep.errorText}</p>) : (
        <>
          {prep.data.by_day.length > 0 && (
            <table className="g56-table">
              <thead><tr><th scope="col">{prep.common('date')}</th><th scope="col">{prep.tr('orders')}</th><th scope="col">{prep.tr('avgMinutes')}</th></tr></thead>
              <tbody>{prep.data.by_day.slice(-7).map((row) => <tr key={row.day}><td>{String(row.day).slice(0, 10)}</td><td>{row.orders}</td><td>{row.avg_minutes}</td></tr>)}</tbody>
            </table>
          )}
          {prep.data.by_location.length > 0 && (
            <ul className="g56-list">{prep.data.by_location.map((row) => <li key={row.location_id}>{row.location_id} · {row.orders} · {row.avg_minutes} min</li>)}</ul>
          )}
        </>
      )}
      <h5>{unav.tr('unavailability')}</h5>
      {!unav.data ? (unav.errorText && <p className="g56-error">{unav.errorText}</p>) : unav.data.items.length === 0 ? <p>{unav.common('empty')}</p> : (
        <ul className="g56-list">{unav.data.items.map((row) => <li key={row.menu_item_id}>{row.name} · {row.inventory_outages ?? 0} outages</li>)}</ul>
      )}
      <h5>{peak.tr('peakLoad')}</h5>
      {!peak.data ? (peak.errorText && <p className="g56-error">{peak.errorText}</p>) : peak.data.locations.length === 0 ? <p>{peak.common('empty')}</p> : (
        <ul className="g56-list">{peak.data.locations.map((row) => <li key={row.location_id}>{row.location_name} · {peak.tr('peakLoad')}: {row.peak_hour}:00 · {row.peak_avg_orders}/h</li>)}</ul>
      )}
      <h5>{rep.tr('repeatIssues')}</h5>
      {!rep.data ? (rep.errorText && <p className="g56-error">{rep.errorText}</p>) : (
        <>
          {rep.data.support_cases.length > 0 && <ul className="g56-list">{rep.data.support_cases.map((row, i) => <li key={i}>{row.issue_type}{row.issue_subtype ? ` · ${row.issue_subtype}` : ''} · {row.cases}</li>)}</ul>}
          {rep.data.order_issues.length > 0 && <ul className="g56-list">{rep.data.order_issues.map((row, i) => <li key={i}>{row.kind} · {row.item_name || ''} · {row.issues}</li>)}</ul>}
        </>
      )}
      <h5>{cap.tr('capacity')}</h5>
      {!cap.data ? (cap.errorText && <p className="g56-error">{cap.errorText}</p>) : (
        <>
          <p className="g56-muted">{cap.tr('days')}: {cap.data.date} · {cap.tr('capacity')}: {cap.data.under_hours} under</p>
          {cap.data.hours.filter((row) => row.status === 'under').length > 0 && (
            <table className="g56-table">
              <thead><tr><th scope="col">{cap.tr('hour')}</th><th scope="col">{cap.tr('orders')}</th><th scope="col">{cap.tr('staff')}</th><th scope="col">{cap.tr('needed')}</th></tr></thead>
              <tbody>{cap.data.hours.filter((row) => row.status === 'under').map((row) => <tr key={row.hour}><td>{row.hour}:00</td><td>{row.forecast_orders}</td><td>{row.scheduled_staff}</td><td>{row.needed_staff}</td></tr>)}</tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function DowntimeSection({ base, locationId }) {
  const d = useBizG56(`${base}/downtime?location_id=${locationId}`, 'ops');
  const [form, setForm] = useState({ equipment: '', note: '' });
  const report = async (e) => {
    e.preventDefault();
    if (!form.equipment.trim()) return;
    const created = await d.send('post', `${base}/downtime`, { location_id: Number(locationId), equipment: form.equipment.trim(), note: form.note.trim() || undefined });
    if (created) setForm({ equipment: '', note: '' });
  };
  return (
    <div>
      <h4>{d.tr('downtime')}</h4>
      <Notice p={d} />
      {!d.data ? (d.errorText && <p className="g56-error">{d.errorText}</p>) : d.data.downtime.length === 0 ? <p>{d.common('empty')}</p> : (
        <table className="g56-table">
          <thead><tr><th scope="col">{d.tr('equipment')}</th><th scope="col">{d.common('location')}</th><th scope="col">{d.common('status')}</th><th scope="col">{d.common('created')}</th><th scope="col"><span className="g56-sr">{d.tr('restoreDowntime')}</span></th></tr></thead>
          <tbody>{d.data.downtime.map((row) => (
            <tr key={row.id}>
              <td>{row.equipment}</td><td>{row.location_name}</td><td>{row.status}</td><td>{d.time(row.started_at)}</td>
              <td>{row.status === 'down' && <RestoreDowntime base={base} id={row.id} d={d} />}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <form onSubmit={report} className="g56-row" data-track="ui.f17c022f60.16">
        <label>{d.tr('equipment')}<input value={form.equipment} maxLength={120} onChange={(e) => setForm({ ...form, equipment: e.target.value })} /></label>
        <label>{d.common('reason')}<input value={form.note} maxLength={2000} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
        <button type="submit" disabled={d.busy || !form.equipment.trim()} data-track="ui.f17c022f60.17">{d.tr('reportDowntime')}</button>
      </form>
    </div>
  );
}

function TransfersSection({ base, locationId, locations }) {
  const t = useBizG56(`${base}/transfers`, 'ops');
  const [form, setForm] = useState({ order_id: '', to_location_id: '', reason: '' });
  const request = async (e) => {
    e.preventDefault();
    const orderId = Number(form.order_id);
    if (!orderId || !form.to_location_id) return;
    const created = await t.send('post', `${base}/transfers`, { order_id: orderId, to_location_id: Number(form.to_location_id), reason: form.reason.trim() || undefined });
    if (created) setForm({ order_id: '', to_location_id: '', reason: '' });
  };
  return (
    <div>
      <h4>{t.tr('transfers')}</h4>
      <Notice p={t} />
      {!t.data ? (t.errorText && <p className="g56-error">{t.errorText}</p>) : t.data.transfers.length === 0 ? <p>{t.common('empty')}</p> : (
        <table className="g56-table">
          <thead><tr><th scope="col">{t.tr('orders')}</th><th scope="col">{t.tr('fromLocation')}</th><th scope="col">{t.tr('toLocation')}</th><th scope="col">{t.common('status')}</th><th scope="col"><span className="g56-sr">{t.tr('decide')}</span></th></tr></thead>
          <tbody>{t.data.transfers.map((row) => (
            <tr key={row.id}>
              <td>#{row.queue_number || row.order_id}</td><td>{row.from_location}</td><td>{row.to_location}</td><td>{row.status}</td>
              <td>
                {row.status === 'requested' && (
                  <>
                    <button type="button" disabled={t.busy} onClick={() => t.send('post', `${base}/transfers/${row.id}/decide`, { decision: 'accepted' })} data-track="ui.f17c022f60.18">{t.common('approve')}</button>
                    {' '}
                    <button type="button" disabled={t.busy} onClick={() => t.send('post', `${base}/transfers/${row.id}/decide`, { decision: 'declined' })} data-track="ui.f17c022f60.19">{t.common('decline')}</button>
                  </>
                )}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <form onSubmit={request} className="g56-row" data-track="ui.f17c022f60.20">
        <label>{t.tr('orderId')}<input inputMode="numeric" value={form.order_id} onChange={(e) => setForm({ ...form, order_id: e.target.value })} dir="ltr" /></label>
        <label>{t.tr('toLocation')}<select value={form.to_location_id} onChange={(e) => setForm({ ...form, to_location_id: e.target.value })}><option value="">—</option>{locations.filter((l) => String(l.id) !== String(locationId)).map((l) => <option key={l.id} value={String(l.id)}>{l.name}</option>)}</select></label>
        <label>{t.common('reason')}<input value={form.reason} maxLength={500} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
        <button type="submit" disabled={t.busy} data-track="ui.f17c022f60.21">{t.tr('requestTransfer')}</button>
      </form>
    </div>
  );
}

const CLOSURE_DISPOSITIONS = ['hand_off', 'finish', 'transfer', 'cancel'];
function ClosureSection({ base, locationId }) {
  const c = useBizG56(`${base}/locations/${locationId}/closure`, 'ops');
  const [form, setForm] = useState({ reason: 'other', note: '' });
  const [notice, setNotice] = useState('');
  const [disps, setDisps] = useState(null);
  if (!c.data) return c.errorText ? <p className="g56-error">{c.errorText}</p> : null;
  const closure = c.data.closure;
  const checks = closure?.reopen_checklist || {};
  const openOrders = c.data.open_orders || [];
  const recorded = c.data.dispositions || [];
  const defaultDisp = (o) => (o.suggested === 'hand_off' ? 'hand_off' : o.suggested === 'finish_or_transfer' ? 'finish' : 'transfer');
  const dispFor = (o) => disps?.[o.id] || { disposition: defaultDisp(o), note: '' };
  const setDisp = (o, patch) => setDisps({ ...(disps || {}), [o.id]: { ...dispFor(o), ...patch } });
  const allDispositioned = openOrders.every((o) => dispFor(o).disposition);
  const close = async (e) => {
    e.preventDefault();
    if (!notice.trim() || !allDispositioned) return;
    const dispositions = openOrders.map((o) => ({ order_id: Number(o.id), disposition: dispFor(o).disposition, note: dispFor(o).note.trim() || undefined }));
    const done = await c.send('post', `${base}/emergency-closures`, { location_id: Number(locationId), reason: form.reason, note: form.note.trim() || undefined, dispositions, customer_notice: notice.trim() });
    if (done) { setNotice(''); setDisps(null); }
  };
  return (
    <div>
      <h4>{c.tr('emergency')}</h4>
      <Notice p={c} />
      {closure ? (
        <>
          <p className="g56-muted">{c.tr('currentClosure')}: {closure.reason} · {c.time(closure.created_at)}</p>
          {closure.customer_notice_message && <p className="g56-muted">{c.tr('noticeSent')}: {closure.customer_notice_message}</p>}
          {recorded.length > 0 && (
            <ul className="g56-list">{recorded.map((d) => (
              <li key={d.id}>#{d.order_id} · {c.tr(`disp.${d.disposition}`)}{d.note ? ` · ${d.note}` : ''}{d.decided_by_name ? ` · ${d.decided_by_name}` : ''}</li>
            ))}</ul>
          )}
          {openOrders.length > 0 && (
            <ul className="g56-list">{openOrders.map((o) => <li key={o.id}>#{o.queue_number || o.id} · {o.status}</li>)}</ul>
          )}
          <ul className="g56-list">
            {REOPEN_KEYS.map((key) => (
              <li key={key}>
                {c.tr(`reopenCheck.${key}`)} · {checks[key]?.done ? c.tr('ready') : c.tr('notReady')}
                {' '}<button type="button" disabled={c.busy} onClick={() => c.send('post', `${base}/locations/${locationId}/closure/checks/${key}`, { done: !checks[key]?.done })} data-track="ui.f17c022f60.22">{c.tr('markDone')}</button>
              </li>
            ))}
          </ul>
          <button type="button" disabled={c.busy} onClick={() => c.send('post', `${base}/locations/${locationId}/reopen`, {})} data-track="ui.f17c022f60.23">{c.tr('reopen')}</button>
        </>
      ) : (
        <form onSubmit={close} className="g56-row" data-track="ui.f17c022f60.24">
          <label>{c.tr('closureReason')}<select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>{CLOSURE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
          <label>{c.common('notes')}<input value={form.note} maxLength={1000} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          {openOrders.length > 0 && (
            <>
              <p className="g56-muted">{c.tr('openOrders')}: {openOrders.length} · {c.tr('closeBlocked')}</p>
              {openOrders.map((o) => (
                <div key={o.id} className="g56-row">
                  <span>#{o.queue_number || o.id} · {o.status} · {o.guest_name || ''}</span>
                  <label>{c.tr('disposition')}
                    <select value={dispFor(o).disposition} onChange={(e) => setDisp(o, { disposition: e.target.value })}>
                      {CLOSURE_DISPOSITIONS.map((d) => <option key={d} value={d}>{c.tr(`disp.${d}`)}</option>)}
                    </select>
                  </label>
                  <span className="g56-muted">{c.tr('suggested')}: {c.tr(`disp.${defaultDisp(o)}`)}</span>
                  <label>{c.tr('dispositionNote')}<input value={dispFor(o).note} maxLength={1000} onChange={(e) => setDisp(o, { note: e.target.value })} /></label>
                </div>
              ))}
              <label>{c.tr('customerNotice')}<textarea value={notice} rows={3} maxLength={2000} onChange={(e) => setNotice(e.target.value)} /></label>
              <p className="g56-muted">{c.tr('customerNoticeHint')}</p>
            </>
          )}
          <button type="submit" disabled={c.busy || (openOrders.length > 0 && (!notice.trim() || !allDispositioned))} data-track="ui.f17c022f60.25">{c.tr('closeNow')}</button>
        </form>
      )}
    </div>
  );
}

function PackageLabelSection({ restaurantId }) {
  const [orderId, setOrderId] = useState('');
  const [loadedId, setLoadedId] = useState('');
  const t = useBizG56(loadedId ? `/restaurants/${restaurantId}/shift/orders/${loadedId}/label` : null, 'ops');
  const load = async (e) => {
    e.preventDefault();
    if (!orderId.trim()) return;
    setLoadedId(orderId.trim());
  };
  return (
    <div>
      <h4>{t.tr('packageLabel')}</h4>
      <Notice p={t} />
      <form onSubmit={load} className="g56-row" data-track="ui.f17c022f60.30">
        <label>{t.tr('orderId')}<input inputMode="numeric" value={orderId} onChange={(e) => setOrderId(e.target.value)} dir="ltr" /></label>
        <button type="submit" disabled={t.busy || !orderId.trim()} data-track="ui.f17c022f60.36">{t.tr('labelLoad')}</button>
      </form>
      {t.data && (
        <div className="g56-print-area">
          <p><strong>{t.data.restaurant || ''}</strong> · #{t.data.queue_number || t.data.order_id}</p>
          <p>{t.tr('pickupCode')}: <strong dir="ltr">{t.data.pickup_code || '—'}</strong></p>
          <p>{t.data.customer || ''} · {t.data.fulfillment_type}{t.data.table_label ? ` · ${t.data.table_label}` : ''}</p>
          {t.data.scheduled_for && <p>{t.tr('labelScheduled')}: {t.time(t.data.scheduled_for)}</p>}
          <ul className="g56-list">{t.data.items.map((item, i) => (
            <li key={i}>{item.quantity}× {item.name}{item.note ? ` · ${item.note}` : ''}{item.allergens?.length > 0 ? ` · ${item.allergens.join(', ')}` : ''}</li>
          ))}</ul>
          {t.data.allergens?.length > 0 && <p>{t.data.allergens.join(', ')}</p>}
          <button type="button" onClick={() => window.print()} data-track="ui.f17c022f60.31">{t.tr('printLabel')}</button>
        </div>
      )}
    </div>
  );
}

function DriverArrivalsSection({ restaurantId, locationId }) {
  const a = useBizG56(locationId ? `/restaurants/${restaurantId}/shift/driver-arrivals?location_id=${locationId}` : null, 'ops');
  if (!a.data) return a.errorText ? <p className="g56-error">{a.errorText}</p> : null;
  return (
    <div>
      <h4>{a.tr('driverArrivals')}</h4>
      <Notice p={a} />
      {a.data.drivers.length === 0 ? <p>{a.common('empty')}</p> : (
        <table className="g56-table">
          <thead><tr><th scope="col">{a.tr('driverName')}</th><th scope="col">{a.tr('orders')}</th><th scope="col">{a.common('status')}</th><th scope="col">{a.tr('etaMinutes')}</th><th scope="col">{a.tr('distance')}</th><th scope="col">{a.tr('arrived')}</th></tr></thead>
          <tbody>{a.data.drivers.map((d) => (
            <tr key={d.id}>
              <td>{d.driver_name || '—'}</td>
              <td>{d.order_reference}{d.queue_number ? ` · #${d.queue_number}` : ''}</td>
              <td>{d.status}{d.order_status ? ` · ${d.order_status}` : ''}</td>
              <td>{d.eta_minutes ?? '—'}</td>
              <td>{d.distance_m != null ? `${d.distance_m} m` : '—'}</td>
              <td>{d.arrived ? a.tr('arrived') : a.tr('notArrived')}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

function KitchenTicketsSection({ base, restaurantId, locationId }) {
  const [station, setStation] = useState('');
  const [detailId, setDetailId] = useState('');
  const q = station ? `&station=${encodeURIComponent(station)}` : '';
  const k = useBizG56(locationId ? `${base}/tickets?location_id=${locationId}${q}` : null, 'ops');
  const d = useBizG56(detailId ? `/restaurants/${restaurantId}/shift/orders/${detailId}/ticket` : null, 'ops');
  const tickets = k.data?.tickets || [];
  const printVisible = async () => {
    if (!tickets.length) return;
    await k.send('post', `/restaurants/${restaurantId}/shift/print-batch`, { order_ids: tickets.map((t) => Number(t.id)) });
  };
  const packDone = (t) => (t.pack_checklist ? Object.values(t.pack_checklist).filter((v) => v?.done).length : 0);
  return (
    <div>
      <h4>{k.tr('kitchenTickets')}</h4>
      <Notice p={k} />
      <form onSubmit={(e) => e.preventDefault()} className="g56-row" data-track="ui.f17c022f60.32">
        <label>{k.tr('stationFilter')}
          <select value={station} onChange={(e) => setStation(e.target.value)}>
            <option value="">{k.tr('allStations')}</option>
            <option value="unassigned">{k.tr('unassignedStation')}</option>
            {(k.data?.stations || []).map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </label>
        <button type="button" disabled={k.busy || !tickets.length} onClick={printVisible} data-track="ui.f17c022f60.33">{k.tr('batchPrintVisible')}</button>
      </form>
      {!k.data ? (k.errorText && <p className="g56-error">{k.errorText}</p>) : tickets.length === 0 ? <p>{k.common('empty')}</p> : (
        <table className="g56-table">
          <thead><tr><th scope="col">{k.tr('orders')}</th><th scope="col">{k.common('status')}</th><th scope="col">{k.tr('ticketOwner')}</th><th scope="col">{k.tr('ticketItems')}</th><th scope="col">{k.tr('packProgress')}</th><th scope="col"><span className="g56-sr">{k.tr('ticketDetail')}</span></th></tr></thead>
          <tbody>{tickets.map((t) => (
            <tr key={t.id}>
              <td>#{t.queue_number || t.id}{t.scheduled_for ? ` · ${k.time(t.scheduled_for)}` : ''}</td>
              <td>{t.status} · {t.fulfillment_type}</td>
              <td>{t.owner_name || '—'}</td>
              <td>{t.items.map((i) => `${i.quantity}× ${i.name}${i.station_label ? ` (${i.station_label})` : ''}`).join(', ')}</td>
              <td>{packDone(t)}/5</td>
              <td><button type="button" disabled={k.busy} onClick={() => setDetailId(detailId === String(t.id) ? '' : String(t.id))} data-track="ui.f17c022f60.34">{k.tr('ticketDetail')}</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {detailId && d.data && (
        <div>
          <p className="g56-muted">{d.tr('ticketDetail')}: #{d.data.order_id}</p>
          {Array.isArray(d.data.pack_checklist) && d.data.pack_checklist.length > 0 && (
            <ul className="g56-list">{d.data.pack_checklist.map((item) => (
              <li key={item.key}>{d.t(`bizG56.shift.packItem.${item.key}`)} · {item.done ? d.tr('ready') : d.tr('notReady')}</li>
            ))}</ul>
          )}
          {d.data.handoffs?.length > 0 && <ul className="g56-list">{d.data.handoffs.map((h) => <li key={h.id}>{h.kind} · {h.note || ''} · {d.time(h.created_at)}</li>)}</ul>}
        </div>
      )}
      {detailId && d.errorText && <p className="g56-error">{d.errorText}</p>}
    </div>
  );
}

const DOWNTIME_CHECKS = ['cleaned', 'tested', 'temperature_ok'];
function RestoreDowntime({ base, id, d }) {
  const [checks, setChecks] = useState({});
  const allDone = DOWNTIME_CHECKS.every((k) => checks[k]);
  return (
    <span>
      {DOWNTIME_CHECKS.map((k) => (
        <label key={k}>
          <input type="checkbox" checked={Boolean(checks[k])} onChange={(e) => setChecks({ ...checks, [k]: e.target.checked })} data-track="ui.f17c022f60.26" /> {d.tr(`downtimeCheck.${k}`)}
        </label>
      ))}
      {' '}
      <button type="button" disabled={d.busy || !allDone} onClick={() => d.send('post', `${base}/downtime/${id}/restore`, { checks: { cleaned: true, tested: true, temperature_ok: true } })} data-track="ui.f17c022f60.27">{d.tr('restoreDowntime')}</button>
    </span>
  );
}
