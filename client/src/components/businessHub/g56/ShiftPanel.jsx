// Groups 7-8 items 402-450: staff shift console. Shift brief and start,
// station, readiness, batch print, ticket history and pack, late orders,
// stock notices, issues, breaks, incidents, and end of shift. Server
// enforces every permission; the panel only renders what the API returns.
import { useState } from 'react';
import { useBizG56 } from './useBizG56';
import './g56.css';

const READINESS = ['uniform_ready', 'hands_washed', 'station_stocked', 'handoff_read'];
const PACK = ['items_verified', 'sauces_utensils', 'drinks', 'sealed', 'label_applied'];
const NOTICE_KINDS = ['low_stock', 'substitution', 'menu_correction'];
const ISSUE_KINDS = ['missing_item', 'substitution', 'wrong_order', 'late'];
const INCIDENT_CATEGORIES = ['food_service', 'equipment', 'safety', 'guest', 'other'];
const HANDOFF_KINDS = ['owner', 'station', 'prep'];

function Notice({ p }) {
  return (
    <>
      {p.notice && <p role="status" className="g56-ok">{p.common('saved')}</p>}
      {p.errorText && <p role="alert" className="g56-error">{p.errorText}</p>}
    </>
  );
}

export default function ShiftPanel({ restaurantId }) {
  const b = useBizG56(`/restaurants/${restaurantId}/shift`, 'shift');
  const [startForm, setStartForm] = useState({ location_id: '', shift_id: '' });
  if (!b.data) return b.errorText ? <p className="g56-error">{b.errorText}</p> : null;
  const start = async (e) => {
    e.preventDefault();
    if (!startForm.location_id) return;
    await b.send('post', `/restaurants/${restaurantId}/shift/start`, {
      location_id: Number(startForm.location_id),
      shift_id: startForm.shift_id ? Number(startForm.shift_id) : undefined,
    });
  };
  return (
    <section className="g56-panel" aria-label="my shift">
      <h3>{b.tr('title')}</h3>
      <p className="g56-muted">{b.tr('subtitle')}</p>
      <Notice p={b} />
      {!b.data.started ? (
        <div>
          <h4>{b.tr('startShift')}</h4>
          {b.data.todays_shifts?.length > 0 && (
            <ul className="g56-list">{b.data.todays_shifts.map((s) => <li key={s.id}>{s.role_label || ''} · {b.time(s.start_time)} – {b.time(s.end_time)}</li>)}</ul>
          )}
          <form onSubmit={start} className="g56-row" data-track="ui.33e821f241.1">
            <label>{b.common('location')}
              <select value={startForm.location_id} onChange={(e) => setStartForm({ ...startForm, location_id: e.target.value })}>
                <option value="">—</option>
                {(b.data.locations || []).map((l) => <option key={l.id} value={String(l.id)}>{l.name}</option>)}
              </select>
            </label>
            <label>{b.tr('todaysShifts')}<input inputMode="numeric" value={startForm.shift_id} onChange={(e) => setStartForm({ ...startForm, shift_id: e.target.value })} dir="ltr" /></label>
            <button type="submit" disabled={b.busy || !startForm.location_id} data-track="ui.33e821f241.2">{b.tr('startShift')}</button>
          </form>
        </div>
      ) : (
        <ShiftBrief b={b} restaurantId={restaurantId} />
      )}
      <LateOrdersSection restaurantId={restaurantId} />
      <StockNoticesSection restaurantId={restaurantId} locationId={b.data.started ? b.data.location?.id : null} />
      <IssuesSection restaurantId={restaurantId} />
      <BreakSection restaurantId={restaurantId} />
      <IncidentsSection restaurantId={restaurantId} locationId={b.data.started ? b.data.location?.id : null} />
      <TicketSection restaurantId={restaurantId} />
      {b.data.started && <EndShiftSection restaurantId={restaurantId} />}
    </section>
  );
}

function ShiftBrief({ b, restaurantId }) {
  const d = b.data;
  const [stationId, setStationId] = useState('');
  const [readiness, setReadiness] = useState({});
  const stations = useBizG56(`/restaurants/${restaurantId}/kitchen/stations`, 'shift');
  const acked = d.readiness_items?.every((key) => readiness[key]) || d.ready;
  const assign = async (e) => {
    e.preventDefault();
    if (!stationId) return;
    await b.send('post', `/restaurants/${restaurantId}/shift/station`, { station_id: Number(stationId) });
  };
  const ack = async () => {
    const items = {};
    for (const key of (d.readiness_items || READINESS)) items[key] = true;
    await b.send('post', `/restaurants/${restaurantId}/shift/readiness`, { items });
    setReadiness(items);
  };
  return (
    <div>
      <p className="g56-muted">{b.tr('started')} · {d.location?.name} {d.station ? `· ${d.station.name}` : ''}</p>
      <h4>{b.tr('station')}</h4>
      <form onSubmit={assign} className="g56-row" data-track="ui.33e821f241.3">
        <label>{b.tr('stationName')}
          <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
            <option value="">—</option>
            {(stations.data?.stations || []).map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
          </select>
        </label>
        <button type="submit" disabled={b.busy || !stationId} data-track="ui.33e821f241.4">{b.tr('assignStation')}</button>
      </form>
      <h4>{b.tr('tasks')}</h4>
      {d.tasks.length === 0 ? <p>{b.common('empty')}</p> : (
        <ul className="g56-list">{d.tasks.map((t) => <li key={t.id}>{t.title} · {t.priority} · {t.status}{t.due_at ? ` · ${b.time(t.due_at)}` : ''}</li>)}</ul>
      )}
      <h4>{b.tr('checklists')}</h4>
      {d.checklists.length === 0 ? <p>{b.common('empty')}</p> : (
        <ul className="g56-list">{d.checklists.map((c) => <li key={c.id}>{c.name} · {c.run_status || 'not_started'}{c.run_id ? ` · ${c.completed_tasks}/${c.total_tasks}` : ''}</li>)}</ul>
      )}
      <h4>{b.tr('handoff')}</h4>
      <p className="g56-muted">{b.tr('unread')}: {d.handoff.unread}</p>
      {d.handoff.logbook.length > 0 && <ul className="g56-list">{d.handoff.logbook.map((e) => <li key={e.id}>{e.body} · {e.author || ''} · {b.time(e.created_at)}</li>)}</ul>}
      {d.handoff.announcements.length > 0 && <ul className="g56-list">{d.handoff.announcements.map((a) => <li key={a.id}>{a.title}{a.body ? ` · ${a.body}` : ''}</li>)}</ul>}
      {d.handoff.stock_notices.length > 0 && <ul className="g56-list">{d.handoff.stock_notices.map((n) => <li key={n.id}>{n.kind} · {n.item_name || ''} · {n.note || ''}</li>)}</ul>}
      {d.handoff.equipment_down.length > 0 && <ul className="g56-list">{d.handoff.equipment_down.map((row) => <li key={row.id}>{row.equipment} · {b.time(row.started_at)}</li>)}</ul>}
      <h4>{b.tr('readinessItems')}</h4>
      <ul className="g56-list">
        {(d.readiness_items || READINESS).map((key) => (
          <li key={key}>{b.tr(`readyItem.${key}`)} · {readiness[key] || d.ready ? b.tr('ready') : b.tr('notReady')}</li>
        ))}
      </ul>
      {!acked && <button type="button" disabled={b.busy} onClick={ack} data-track="ui.33e821f241.5">{b.tr('acknowledgeReadiness')}</button>}
    </div>
  );
}

function LateOrdersSection({ restaurantId }) {
  const p = useBizG56(`/restaurants/${restaurantId}/shift/late-orders`, 'shift');
  if (!p.data) return p.errorText ? <p className="g56-error">{p.errorText}</p> : null;
  return (
    <div>
      <h4>{p.tr('lateOrders')}</h4>
      {p.data.orders.length === 0 ? <p>{p.common('empty')}</p> : (
        <ul className="g56-list">{p.data.orders.map((o) => <li key={o.id}>#{o.queue_number || o.id} · {o.guest_name || ''} · {p.time(o.ready_at || o.created_at)}</li>)}</ul>
      )}
    </div>
  );
}

function StockNoticesSection({ restaurantId, locationId }) {
  const p = useBizG56(`/restaurants/${restaurantId}/shift/stock-notices`, 'shift');
  const [form, setForm] = useState({ kind: 'low_stock', menu_item_id: '', note: '', substitutes: '' });
  const create = async (e) => {
    e.preventDefault();
    if (!locationId) return;
    const body = { kind: form.kind, location_id: Number(locationId), note: form.note.trim() || undefined };
    if (form.menu_item_id) body.menu_item_id = Number(form.menu_item_id);
    if (form.kind === 'substitution') {
      const subs = form.substitutes.split(',').map((s) => s.trim()).filter(Boolean);
      if (!subs.length) return;
      body.substitutes = subs;
    }
    const created = await p.send('post', `/restaurants/${restaurantId}/shift/stock-notices`, body);
    if (created) setForm({ kind: 'low_stock', menu_item_id: '', note: '', substitutes: '' });
  };
  if (!p.data) return p.errorText ? <p className="g56-error">{p.errorText}</p> : null;
  return (
    <div>
      <h4>{p.tr('stockNotices')}</h4>
      <Notice p={p} />
      {p.data.notices.length === 0 ? <p>{p.common('empty')}</p> : (
        <table className="g56-table">
          <thead><tr><th scope="col">{p.tr('itemName')}</th><th scope="col">{p.tr('note')}</th><th scope="col">{p.common('status')}</th><th scope="col"><span className="g56-sr">{p.tr('resolve')}</span></th></tr></thead>
          <tbody>{p.data.notices.map((n) => (
            <tr key={n.id}>
              <td>{n.item_name || ''} · {p.tr(`noticeKind.${n.kind}`)}</td><td>{n.note || '—'}</td><td>{n.status}</td>
              <td>
                {n.status !== 'resolved' && (
                  <>
                    <button type="button" disabled={p.busy} onClick={() => p.send('patch', `/restaurants/${restaurantId}/shift/stock-notices/${n.id}`, { status: 'acknowledged' })} data-track="ui.33e821f241.6">{p.tr('acknowledge')}</button>
                    {' '}
                    <button type="button" disabled={p.busy} onClick={() => p.send('patch', `/restaurants/${restaurantId}/shift/stock-notices/${n.id}`, { status: 'resolved' })} data-track="ui.33e821f241.7">{p.tr('resolve')}</button>
                  </>
                )}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <form onSubmit={create} className="g56-row" data-track="ui.33e821f241.8">
        <label>{p.tr('note')}<select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{NOTICE_KINDS.map((k) => <option key={k} value={k}>{p.tr(`noticeKind.${k}`)}</option>)}</select></label>
        <label>{p.tr('itemName')}<input inputMode="numeric" value={form.menu_item_id} onChange={(e) => setForm({ ...form, menu_item_id: e.target.value })} dir="ltr" /></label>
        <label>{p.tr('note')}<input value={form.note} maxLength={1000} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
        {form.kind === 'substitution' && <label>{p.tr('substitutes')}<input value={form.substitutes} maxLength={1200} onChange={(e) => setForm({ ...form, substitutes: e.target.value })} /></label>}
        <button type="submit" disabled={p.busy || !locationId} data-track="ui.33e821f241.9">{p.tr('createNotice')}</button>
      </form>
    </div>
  );
}

function IssuesSection({ restaurantId }) {
  const p = useBizG56(`/restaurants/${restaurantId}/shift/issues`, 'shift');
  const [form, setForm] = useState({ order_id: '', kind: 'late', detail: '', proposed_substitute: '' });
  const [resolution, setResolution] = useState('');
  const report = async (e) => {
    e.preventDefault();
    const orderId = Number(form.order_id);
    if (!orderId) return;
    const body = { kind: form.kind, detail: form.detail.trim() || undefined };
    if (form.proposed_substitute.trim()) body.proposed_substitute = form.proposed_substitute.trim();
    const created = await p.send('post', `/restaurants/${restaurantId}/shift/issues/${orderId}`, body);
    if (created) setForm({ order_id: '', kind: 'late', detail: '', proposed_substitute: '' });
  };
  if (!p.data) return p.errorText ? <p className="g56-error">{p.errorText}</p> : null;
  return (
    <div>
      <h4>{p.tr('issues')}</h4>
      <Notice p={p} />
      {p.data.issues.length === 0 ? <p>{p.common('empty')}</p> : (
        <table className="g56-table">
          <thead><tr><th scope="col">{p.tr('orderId')}</th><th scope="col">{p.tr('issueKind')}</th><th scope="col">{p.common('status')}</th><th scope="col"><span className="g56-sr">{p.tr('resolve')}</span></th></tr></thead>
          <tbody>{p.data.issues.map((row) => (
            <tr key={row.id}>
              <td>#{row.order_id}</td><td>{p.tr(`issKind.${row.kind}`)}{row.detail ? ` · ${row.detail}` : ''}</td><td>{row.status}{row.customer_response ? ` · ${row.customer_response}` : ''}{row.escalated_to ? ` · ${p.tr('escalatedTo')}: ${row.escalated_to}` : ''}</td>
              <td>
                {row.status !== 'resolved' && (
                  <>
                    <button type="button" disabled={p.busy} onClick={() => p.send('post', `/restaurants/${restaurantId}/shift/issues/${row.id}/escalate`, {})} data-track="ui.33e821f241.10">{p.tr('escalate')}</button>
                    {' '}
                    <input value={resolution} maxLength={1000} placeholder={p.tr('resolution')} onChange={(e) => setResolution(e.target.value)} />
                    {' '}
                    <button type="button" disabled={p.busy || !resolution.trim()} onClick={() => p.send('post', `/restaurants/${restaurantId}/shift/issues/${row.id}/resolve`, { resolution: resolution.trim() })} data-track="ui.33e821f241.11">{p.tr('resolve')}</button>
                  </>
                )}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <form onSubmit={report} className="g56-row" data-track="ui.33e821f241.12">
        <label>{p.tr('orderId')}<input inputMode="numeric" value={form.order_id} onChange={(e) => setForm({ ...form, order_id: e.target.value })} dir="ltr" /></label>
        <label>{p.tr('issueKind')}<select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{ISSUE_KINDS.map((k) => <option key={k} value={k}>{p.tr(`issKind.${k}`)}</option>)}</select></label>
        <label>{p.tr('issueDetail')}<input value={form.detail} maxLength={2000} onChange={(e) => setForm({ ...form, detail: e.target.value })} /></label>
        <label>{p.tr('proposedSubstitute')}<input value={form.proposed_substitute} maxLength={160} onChange={(e) => setForm({ ...form, proposed_substitute: e.target.value })} /></label>
        <button type="submit" disabled={p.busy} data-track="ui.33e821f241.13">{p.tr('reportIssue')}</button>
      </form>
    </div>
  );
}

function BreakSection({ restaurantId }) {
  const p = useBizG56(null, 'shift');
  const [summary, setSummary] = useState(null);
  const start = async () => { const v = await p.send('post', `/restaurants/${restaurantId}/shift/break/start`, {}); if (v) setSummary(v); };
  const end = async () => { const v = await p.send('post', `/restaurants/${restaurantId}/shift/break/end`, {}); if (v) setSummary(v); };
  return (
    <div>
      <h4>{p.tr('break')}</h4>
      <Notice p={p} />
      <div className="g56-row">
        <button type="button" disabled={p.busy} onClick={start} data-track="ui.33e821f241.14">{p.tr('breakStart')}</button>
        <button type="button" disabled={p.busy} onClick={end} data-track="ui.33e821f241.15">{p.tr('breakEnd')}</button>
      </div>
      {summary && <p className="g56-muted">{p.tr('onBreak')}: {String(summary.on_break ?? '')}{summary.break_started_at ? ` · ${p.time(summary.break_started_at)}` : ''}</p>}
    </div>
  );
}

function IncidentsSection({ restaurantId, locationId }) {
  const p = useBizG56(`/restaurants/${restaurantId}/shift/incidents`, 'shift');
  const [form, setForm] = useState({ title: '', detail: '', category: 'other', urgency: 'Medium' });
  const [followUp, setFollowUp] = useState('');
  const create = async (e) => {
    e.preventDefault();
    if (!locationId || !form.title.trim()) return;
    const created = await p.send('post', `/restaurants/${restaurantId}/shift/incidents`, {
      title: form.title.trim(), detail: form.detail.trim() || undefined,
      category: form.category, urgency: form.urgency, location_id: Number(locationId),
    });
    if (created) setForm({ title: '', detail: '', category: 'other', urgency: 'Medium' });
  };
  if (!p.data) return p.errorText ? <p className="g56-error">{p.errorText}</p> : null;
  return (
    <div>
      <h4>{p.tr('incidents')}</h4>
      <Notice p={p} />
      {p.data.incidents.length === 0 ? <p>{p.common('empty')}</p> : (
        <ul className="g56-list">{p.data.incidents.map((row) => (
          <li key={row.id}>
            {row.title} · {p.tr(`incCat.${row.category}`)} · {row.urgency} · {row.status}
            {' '}<input type="date" aria-label={p.tr('followUpAt')} value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
            {' '}<button type="button" disabled={p.busy} onClick={() => p.send('patch', `/restaurants/${restaurantId}/shift/incidents/${row.id}`, { status: 'resolved', resolution_note: 'resolved from shift panel', follow_up_at: followUp || undefined })} data-track="ui.33e821f241.16">{p.tr('resolve')}</button>
          </li>
        ))}</ul>
      )}
      <form onSubmit={create} className="g56-row" data-track="ui.33e821f241.17">
        <label>{p.common('title')}<input value={form.title} maxLength={160} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label>{p.tr('incidentCategory')}<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{INCIDENT_CATEGORIES.map((c) => <option key={c} value={c}>{p.tr(`incCat.${c}`)}</option>)}</select></label>
        <label>{p.tr('incidentUrgency')}<select value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })}>{['Low', 'Medium', 'High'].map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
        <label>{p.tr('issueDetail')}<input value={form.detail} maxLength={2000} onChange={(e) => setForm({ ...form, detail: e.target.value })} /></label>
        <button type="submit" disabled={p.busy || !locationId} data-track="ui.33e821f241.18">{p.tr('createIncident')}</button>
      </form>
    </div>
  );
}

function TicketSection({ restaurantId }) {
  const [orderId, setOrderId] = useState('');
  const [code, setCode] = useState('');
  const [printIds, setPrintIds] = useState('');
  const t = useBizG56(orderId ? `/restaurants/${restaurantId}/shift/tickets/${orderId}` : null, 'shift');
  const [handoffForm, setHandoffForm] = useState({ kind: 'station', to_station: '', to_user_id: '', note: '' });
  const verify = async (e) => {
    e.preventDefault();
    if (!orderId || !code.trim()) return;
    await t.send('post', `/restaurants/${restaurantId}/shift/verify-pickup/${orderId}`, { code: code.trim() });
  };
  const print = async (e) => {
    e.preventDefault();
    const ids = printIds.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
    if (!ids.length) return;
    await t.send('post', `/restaurants/${restaurantId}/shift/batch-print`, { order_ids: ids });
  };
  const handoff = async (e) => {
    e.preventDefault();
    if (!orderId) return;
    const body = { kind: handoffForm.kind, note: handoffForm.note.trim() || undefined };
    if (handoffForm.kind === 'station') body.to_station = handoffForm.to_station.trim();
    if (handoffForm.kind === 'owner') body.to_user_id = handoffForm.to_user_id.trim();
    await t.send('post', `/restaurants/${restaurantId}/shift/handoff/${orderId}`, body);
  };
  return (
    <div>
      <h4>{t.tr('ticket')}</h4>
      <Notice p={t} />
      <form onSubmit={verify} className="g56-row" data-track="ui.33e821f241.19">
        <label>{t.tr('orderId')}<input inputMode="numeric" value={orderId} onChange={(e) => setOrderId(e.target.value)} dir="ltr" /></label>
        <label>{t.tr('pickupCode')}<input value={code} maxLength={10} onChange={(e) => setCode(e.target.value)} dir="ltr" /></label>
        <button type="submit" disabled={t.busy} data-track="ui.33e821f241.20">{t.tr('verify')}</button>
      </form>
      {t.data && (
        <div>
          <p className="g56-muted">{t.tr('ticketHistory')}: #{t.data.order_id}</p>
          {Array.isArray(t.data.pack_checklist) && t.data.pack_checklist.length > 0 && (
            <ul className="g56-list">{t.data.pack_checklist.map((item) => (
              <li key={item.key}>
                {t.tr(`packItem.${item.key}`)} · {item.done ? t.tr('ready') : t.tr('notReady')}
                {' '}<button type="button" disabled={t.busy} onClick={() => t.send('post', `/restaurants/${restaurantId}/shift/tickets/${orderId}/pack/${item.key}`, { done: !item.done })} data-track="ui.33e821f241.21">{t.tr('pack')}</button>
              </li>
            ))}</ul>
          )}
          {t.data.handoffs?.length > 0 && <ul className="g56-list">{t.data.handoffs.map((h) => <li key={h.id}>{h.kind} · {h.note || ''} · {t.time(h.created_at)}</li>)}</ul>}
        </div>
      )}
      <form onSubmit={handoff} className="g56-row" data-track="ui.33e821f241.22">
        <label>{t.tr('handoff')}<select value={handoffForm.kind} onChange={(e) => setHandoffForm({ ...handoffForm, kind: e.target.value })}>{HANDOFF_KINDS.map((k) => <option key={k} value={k}>{t.tr(`handoffKind.${k}`)}</option>)}</select></label>
        {handoffForm.kind === 'station' && <label>{t.tr('stationName')}<input value={handoffForm.to_station} maxLength={80} onChange={(e) => setHandoffForm({ ...handoffForm, to_station: e.target.value })} /></label>}
        {handoffForm.kind === 'owner' && <label>{t.tr('handoffToUser')}<input value={handoffForm.to_user_id} onChange={(e) => setHandoffForm({ ...handoffForm, to_user_id: e.target.value })} dir="ltr" /></label>}
        <label>{t.tr('note')}<input value={handoffForm.note} maxLength={1000} onChange={(e) => setHandoffForm({ ...handoffForm, note: e.target.value })} /></label>
        <button type="submit" disabled={t.busy || !orderId} data-track="ui.33e821f241.23">{t.tr('handoff')}</button>
      </form>
      <form onSubmit={print} className="g56-row" data-track="ui.33e821f241.24">
        <label>{t.tr('orderIds')}<input value={printIds} onChange={(e) => setPrintIds(e.target.value)} dir="ltr" /></label>
        <button type="submit" disabled={t.busy} data-track="ui.33e821f241.25">{t.tr('batchPrint')}</button>
      </form>
    </div>
  );
}

function EndShiftSection({ restaurantId }) {
  const p = useBizG56(`/restaurants/${restaurantId}/shift/end/preview`, 'shift');
  const [note, setNote] = useState('');
  const [handoffTo, setHandoffTo] = useState('');
  const [ended, setEnded] = useState(false);
  const end = async (e) => {
    e.preventDefault();
    const v = await p.send('post', `/restaurants/${restaurantId}/shift/end`, { note: note.trim() || undefined, handoff_to_user_id: handoffTo.trim() || undefined });
    if (v) setEnded(true);
  };
  if (!p.data) return p.errorText ? <p className="g56-error">{p.errorText}</p> : null;
  if (ended) return <p role="status" className="g56-ok">{p.tr('ended')}</p>;
  return (
    <div>
      <h4>{p.tr('endPreview')}</h4>
      <Notice p={p} />
      <p className="g56-muted">
        {p.tr('ownedTickets')}: {p.data.owned_tickets.length} · {p.tr('needsHandoff')}: {p.data.needs_handoff ? p.tr('yes') : p.tr('no')}
        {' · '}{p.tr('lateOrders')}: {p.data.pickup_exceptions.length} · {p.tr('stockNotices')}: {p.data.stock_notices.length}
        {' · '}{p.tr('issues')}: {p.data.my_open_issues.length}
      </p>
      {p.data.owned_tickets.length > 0 && <ul className="g56-list">{p.data.owned_tickets.map((o) => <li key={o.id}>#{o.queue_number || o.id} · {o.status}</li>)}</ul>}
      <form onSubmit={end} className="g56-row" data-track="ui.33e821f241.26">
        <label>{p.tr('endReason')}<input value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></label>
        <label>{p.tr('handoffTo')}<input value={handoffTo} onChange={(e) => setHandoffTo(e.target.value)} dir="ltr" /></label>
        <button type="submit" disabled={p.busy} data-track="ui.33e821f241.27">{p.tr('endShift')}</button>
      </form>
    </div>
  );
}
