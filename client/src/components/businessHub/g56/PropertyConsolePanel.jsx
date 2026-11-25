// Groups 7-8 items 301-350: property console. Portfolio, property detail
// (units, areas, assignments, requests, incidents, keys, transfer), access
// review, upkeep, vendors, and work orders. Server enforces every
// permission; the panel only renders what the API returns.
import { useState } from 'react';
import { useBizG56 } from './useBizG56';
import './g56.css';

const TYPES = ['single_family', 'multi_family', 'condo', 'commercial', 'mixed_use', 'other'];
const OCCUPANCY = ['occupied', 'vacant', 'turnover', 'owner_hold'];
const AREA_KINDS = ['lobby', 'laundry', 'parking', 'grounds', 'roof', 'mechanical', 'amenity', 'other'];
const ROLES = ['manager', 'building_staff', 'coverage', 'unit_contact'];
const SEVERITIES = ['minor', 'major', 'critical'];

const toCents = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const dollars = (c) => (c == null ? '' : (Number(c) / 100).toFixed(2));

function useMoney() {
  return (c) => (c == null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(c) / 100));
}

function Notice({ p }) {
  return (
    <>
      {p.notice && <p role="status" className="g56-ok">{p.common('saved')}</p>}
      {p.errorText && <p role="alert" className="g56-error">{p.errorText}</p>}
    </>
  );
}

export default function PropertyConsolePanel({ businessId }) {
  const [selectedId, setSelectedId] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const base = `/businesses/${businessId}/properties`;
  return (
    <section className="g56-panel" aria-label="property console">
      <PortfolioSection
        base={base}
        showArchived={showArchived}
        setShowArchived={setShowArchived}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      {selectedId && (
        <PropertyDetail base={base} propertyId={selectedId} onBack={() => setSelectedId(null)} />
      )}
      <AccessReviewSection base={base} />
      <UpkeepSection base={base} />
      <VendorsSection base={base} />
      <WorkOrdersSection base={base} />
      <OwnerApprovalsSection />
      <OwnerIncidentsSection />
    </section>
  );
}

function PortfolioSection({ base, showArchived, setShowArchived, selectedId, onSelect }) {
  const p = useBizG56(`${base}${showArchived ? '?archived=1' : ''}`, 'properties');
  const [form, setForm] = useState({ label: '', property_type: 'single_family', address: '', address_city: '' });
  const create = async (e) => {
    e.preventDefault();
    if (!form.label.trim()) return;
    const created = await p.send('post', base, {
      label: form.label.trim(), property_type: form.property_type,
      address: form.address.trim() || undefined, address_city: form.address_city.trim() || undefined,
    });
    if (created) { setForm({ label: '', property_type: 'single_family', address: '', address_city: '' }); }
  };
  const archive = async (id, archived) => {
    const path = `${base}/p/${id}/${archived ? 'restore' : 'archive'}`;
    await p.send('post', path, archived ? {} : { reason: '' });
  };
  return (
    <div>
      <h3>{p.tr('portfolio')}</h3>
      <p className="g56-muted">{p.tr('subtitle')}</p>
      <Notice p={p} />
      {p.data?.totals && (
        <div className="g56-row">
          <span className="g56-badge">{p.tr('units')}: {p.data.totals.units}</span>
          <span className="g56-badge">{p.tr('openRequests')}: {p.data.totals.open_requests}</span>
          <span className="g56-badge">{p.tr('urgent')}: {p.data.totals.urgent_requests}</span>
          <span className="g56-badge">{p.tr('pendingApprovals')}: {p.data.totals.pending_approvals}</span>
          <span className="g56-badge">{p.tr('overdue')}: {p.data.totals.overdue_maintenance}</span>
          <span className="g56-badge">{p.tr('incidents')}: {p.data.totals.open_incidents}</span>
        </div>
      )}
      <form onSubmit={create} className="g56-row" data-track="ui.e96cf59a5b.1">
        <label>{p.tr('label')}<input value={form.label} maxLength={160} onChange={(e) => setForm({ ...form, label: e.target.value })} /></label>
        <label>{p.tr('type')}<select value={form.property_type} onChange={(e) => setForm({ ...form, property_type: e.target.value })}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label>{p.tr('address')}<input value={form.address} maxLength={300} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
        <label>{p.tr('city')}<input value={form.address_city} maxLength={120} onChange={(e) => setForm({ ...form, address_city: e.target.value })} /></label>
        <button type="submit" disabled={p.busy || !form.label.trim()} data-track="ui.e96cf59a5b.2">{p.tr('createProperty')}</button>
      </form>
      <label><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} data-track="ui.e96cf59a5b.3" /> {showArchived ? p.tr('hideArchived') : p.tr('showArchived')}</label>
      {!p.data ? null : p.data.properties.length === 0 ? (
        <p>{p.tr('empty')}</p>
      ) : (
        <table className="g56-table">
          <thead><tr>
            <th scope="col">{p.tr('label')}</th><th scope="col">{p.tr('city')}</th><th scope="col">{p.tr('type')}</th>
            <th scope="col">{p.tr('units')}</th><th scope="col">{p.tr('vacant')}</th>
            <th scope="col">{p.tr('openRequests')}</th><th scope="col">{p.tr('urgent')}</th>
            <th scope="col">{p.tr('pendingApprovals')}</th><th scope="col">{p.tr('managers')}</th><th scope="col"><span className="g56-sr">{p.common('view')}</span></th>
          </tr></thead>
          <tbody>{p.data.properties.map((r) => (
            <tr key={r.id} className={selectedId === String(r.id) ? 'g56-row--selected' : ''}>
              <td>{r.label}</td><td>{r.address_city || '—'}</td><td>{r.property_type}</td>
              <td>{r.units}</td><td>{r.vacant}</td><td>{r.open_requests}</td><td>{r.urgent_requests}</td>
              <td>{r.pending_approvals}</td><td>{r.managers || '—'}</td>
              <td>
                <button type="button" disabled={p.busy} onClick={() => onSelect(String(r.id))} data-track="ui.e96cf59a5b.4">{p.common('view')}</button>
                {' '}
                {p.data.can_manage && (
                  <button type="button" disabled={p.busy} onClick={() => archive(r.id, Boolean(r.archived_at))} data-track="ui.e96cf59a5b.5">
                    {r.archived_at ? p.tr('restore') : p.tr('archive')}
                  </button>
                )}
                {' '}
                {p.data.can_manage && (
                  <button type="button" disabled={p.busy} onClick={async () => { if (!window.confirm(p.tr('deletePropertyConfirm', { label: r.label }))) return; await p.send('delete', `${base}/p/${r.id}`); }} data-track="ui.e96cf59a5b.73">
                    {p.tr('deleteProperty')}
                  </button>
                )}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {p.data?.totals && <p className="g56-muted">{p.tr('portfolio')}: {p.data.totals.properties}</p>}
    </div>
  );
}

function PropertyDetail({ base, propertyId, onBack }) {
  // Batch G: the profile route is GET/PATCH /p/:propertyId — the /profile
  // suffix never existed server-side, so the detail view 404'd and the
  // assignments/requests/keys/transfer sections never loaded.
  const p = useBizG56(`${base}/p/${propertyId}`, 'properties');
  const money = useMoney();
  const [requestId, setRequestId] = useState(null);
  if (!p.data) return p.errorText ? <p className="g56-error">{p.errorText}</p> : null;
  const { property, units, common_areas: areas, assignments, history } = p.data;
  const saveProfile = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {};
    for (const key of ['label', 'notes', 'owner_name']) {
      const v = String(fd.get(key) || '').trim();
      if (v) body[key] = v;
    }
    for (const key of ['monthly_budget_cents', 'approval_threshold_cents', 'reserve_balance_cents']) {
      const v = toCents(fd.get(key));
      if (v != null) body[key] = v;
    }
    if (Object.keys(body).length) await p.send('patch', `${base}/p/${propertyId}`, body);
  };
  return (
    <div>
      <button type="button" onClick={onBack} data-track="ui.e96cf59a5b.6">{p.common('back')}</button>
      <h3>{property.label}</h3>
      <Notice p={p} />
      {p.data.can_manage && (
        <form onSubmit={saveProfile} className="g56-row" data-track="ui.e96cf59a5b.7">
          <label>{p.tr('label')}<input name="label" defaultValue={property.label} maxLength={160} /></label>
          <label>{p.tr('owner')}<input name="owner_name" defaultValue={property.owner_name || ''} maxLength={160} /></label>
          <label>{p.tr('monthlyBudget')}<input name="monthly_budget_cents" inputMode="decimal" defaultValue={dollars(property.monthly_budget_cents)} dir="ltr" /></label>
          <label>{p.tr('approvalThreshold')}<input name="approval_threshold_cents" inputMode="decimal" defaultValue={dollars(property.approval_threshold_cents)} dir="ltr" /></label>
          <label>{p.tr('reserveBalance')}<input name="reserve_balance_cents" inputMode="decimal" defaultValue={dollars(property.reserve_balance_cents)} dir="ltr" /></label>
          <label>{p.common('notes')}<input name="notes" defaultValue={property.notes || ''} maxLength={4000} /></label>
          <button type="submit" disabled={p.busy} data-track="ui.e96cf59a5b.8">{p.tr('saveProfile')}</button>
        </form>
      )}
      <p className="g56-muted">
        {[property.address, property.address_city, property.property_type].filter(Boolean).join(' · ')}
        {property.monthly_budget_cents != null && <> · {p.tr('budget')}: {money(property.monthly_budget_cents)}</>}
        {property.reserve_balance_cents != null && <> · {p.tr('reserve')}: {money(property.reserve_balance_cents)}</>}
      </p>
      <UnitsSection base={base} propertyId={propertyId} units={units} p={p} />
      <AreasSection base={base} propertyId={propertyId} areas={areas} p={p} />
      <AssignmentsSection base={base} propertyId={propertyId} assignments={assignments} units={units} p={p} />
      <RequestsSection base={base} history={history} p={p} requestId={requestId} setRequestId={setRequestId} />
      <IncidentsSection base={base} propertyId={propertyId} p={p} />
      <KeysSection base={base} propertyId={propertyId} p={p} />
      <TransferSection base={base} propertyId={propertyId} p={p} />
      <TurnoverStartSection base={base} propertyId={propertyId} units={units} p={p} />
      <UnitSpendSection base={base} propertyId={propertyId} p={p} />
      <ScheduleCreateSection base={base} propertyId={propertyId} units={units} p={p} />
    </div>
  );
}

function UnitsSection({ base, propertyId, units, p }) {
  const [form, setForm] = useState({ unit_label: '', occupancy_status: 'vacant', contact_name: '', contact_phone: '', contact_email: '', access_summary: '' });
  const add = async (e) => {
    e.preventDefault();
    if (!form.unit_label.trim()) return;
    const created = await p.send('post', `${base}/p/${propertyId}/units`, { ...form, unit_label: form.unit_label.trim() });
    if (created) setForm({ unit_label: '', occupancy_status: 'vacant', contact_name: '', contact_phone: '', contact_email: '', access_summary: '' });
  };
  return (
    <div>
      <h4>{p.tr('unitList')}</h4>
      {units.length === 0 ? <p>{p.common('empty')}</p> : (
        <table className="g56-table">
          <thead><tr><th scope="col">{p.tr('unitLabel')}</th><th scope="col">{p.tr('occupancy')}</th><th scope="col">{p.tr('contactName')}</th><th scope="col">{p.tr('contactPhone')}</th><th scope="col">{p.tr('contactEmail')}</th></tr></thead>
          <tbody>{units.map((u) => <tr key={u.id}><td>{u.unit_label}</td><td>{u.occupancy_status}</td><td>{u.contact_name || '—'}</td><td>{u.contact_phone || '—'}</td><td>{u.contact_email || '—'}</td></tr>)}</tbody>
        </table>
      )}
      {p.data.can_manage && (
        <form onSubmit={add} className="g56-row" data-track="ui.e96cf59a5b.9">
          <label>{p.tr('unitLabel')}<input value={form.unit_label} maxLength={120} onChange={(e) => setForm({ ...form, unit_label: e.target.value })} /></label>
          <label>{p.tr('occupancy')}<select value={form.occupancy_status} onChange={(e) => setForm({ ...form, occupancy_status: e.target.value })}>{OCCUPANCY.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
          <label>{p.tr('contactName')}<input value={form.contact_name} maxLength={160} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></label>
          <label>{p.tr('contactPhone')}<input value={form.contact_phone} maxLength={40} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} dir="ltr" /></label>
          <label>{p.tr('contactEmail')}<input value={form.contact_email} maxLength={255} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} dir="ltr" /></label>
          <label>{p.tr('accessSummary')}<input value={form.access_summary} maxLength={2000} onChange={(e) => setForm({ ...form, access_summary: e.target.value })} /></label>
          <button type="submit" disabled={p.busy || !form.unit_label.trim()} data-track="ui.e96cf59a5b.10">{p.tr('addUnit')}</button>
        </form>
      )}
    </div>
  );
}

function AreasSection({ base, propertyId, areas, p }) {
  const [form, setForm] = useState({ name: '', kind: 'other', access_notes: '' });
  const add = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    // Batch H: the route is POST /p/:propertyId/common-areas, not /areas.
    const created = await p.send('post', `${base}/p/${propertyId}/common-areas`, { ...form, name: form.name.trim() });
    if (created) setForm({ name: '', kind: 'other', access_notes: '' });
  };
  return (
    <div>
      <h4>{p.tr('areas')}</h4>
      {areas.length === 0 ? <p>{p.common('empty')}</p> : (
        <ul className="g56-list">{areas.map((a) => <li key={a.id}>{a.name} · {a.kind}{a.access_notes ? ` · ${a.access_notes}` : ''}{p.data.can_manage && <> <button type="button" disabled={p.busy} onClick={() => p.send('delete', `${base}/common-areas/${a.id}`)} data-track="ui.e96cf59a5b.74">{p.tr('archive')}</button></>}</li>)}</ul>
      )}
      {p.data.can_manage && (
        <form onSubmit={add} className="g56-row" data-track="ui.e96cf59a5b.11">
          <label>{p.tr('areaName')}<input value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>{p.tr('areaKind')}<select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{AREA_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
          <label>{p.tr('accessSummary')}<input value={form.access_notes} maxLength={2000} onChange={(e) => setForm({ ...form, access_notes: e.target.value })} /></label>
          <button type="submit" disabled={p.busy || !form.name.trim()} data-track="ui.e96cf59a5b.12">{p.tr('addArea')}</button>
        </form>
      )}
    </div>
  );
}

function AssignmentsSection({ base, propertyId, assignments, units, p }) {
  const [form, setForm] = useState({ role: 'manager', user_id: '', contact_name: '', contact_email: '', contact_phone: '', unit_id: '', starts_at: '', ends_at: '' });
  const assign = async (e) => {
    e.preventDefault();
    const body = { role: form.role };
    if (form.user_id.trim()) body.user_id = form.user_id.trim();
    if (form.role === 'unit_contact') {
      if (!form.unit_id.trim()) return;
      body.unit_id = form.unit_id.trim();
      if (form.contact_name.trim()) body.contact_name = form.contact_name.trim();
      if (form.contact_email.trim()) body.contact_email = form.contact_email.trim();
      if (form.contact_phone.trim()) body.contact_phone = form.contact_phone.trim();
    }
    if (form.starts_at) body.starts_at = form.starts_at;
    if (form.ends_at) body.ends_at = form.ends_at;
    const created = await p.send('post', `${base}/p/${propertyId}/assignments`, body);
    if (created) setForm({ role: 'manager', user_id: '', contact_name: '', contact_email: '', contact_phone: '', unit_id: '', starts_at: '', ends_at: '' });
  };
  return (
    <div>
      <h4>{p.tr('assignments')}</h4>
      {assignments.length === 0 ? <p>{p.common('empty')}</p> : (
        <table className="g56-table">
          <thead><tr><th scope="col">{p.common('role')}</th><th scope="col">{p.tr('contactName')}</th><th scope="col">{p.tr('startsAt')}</th><th scope="col">{p.tr('endsAt')}</th><th scope="col"><span className="g56-sr">{p.tr('endAssignment')}</span></th></tr></thead>
          <tbody>{assignments.map((a) => (
            <tr key={a.id}>
              <td>{a.role}</td><td>{a.user_name || a.contact_name || a.contact_email || '—'}</td>
              <td>{p.time(a.starts_at)}</td><td>{a.ends_at ? p.time(a.ends_at) : '—'}</td>
              <td>
                <button type="button" disabled={p.busy} onClick={() => p.send('post', `${base}/assignments/${a.id}/review`, { decision: 'keep' })} data-track="ui.e96cf59a5b.13">{p.tr('keep')}</button>
                {' '}
                {/* Batch G: no POST /assignments/:id/end route exists; ending
                    goes through the review endpoint, like AccessReviewSection. */}
                <button type="button" disabled={p.busy} onClick={() => p.send('post', `${base}/assignments/${a.id}/review`, { decision: 'end' })} data-track="ui.e96cf59a5b.14">{p.tr('endAssignment')}</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {p.data.can_manage && (
        <form onSubmit={assign} className="g56-row" data-track="ui.e96cf59a5b.15">
          <label>{p.common('role')}<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
          <label>{p.tr('userId')}<input value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })} dir="ltr" /></label>
          {form.role === 'unit_contact' && (
            <>
              <label>{p.tr('unitLabel')}<select value={form.unit_id} onChange={(e) => setForm({ ...form, unit_id: e.target.value })}><option value="">—</option>{units.map((u) => <option key={u.id} value={u.id}>{u.unit_label}</option>)}</select></label>
              <label>{p.tr('contactName')}<input value={form.contact_name} maxLength={160} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></label>
            </>
          )}
          <label>{p.tr('startsAt')}<input type="date" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} /></label>
          <label>{p.tr('endsAt')}<input type="date" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} /></label>
          <button type="submit" disabled={p.busy} data-track="ui.e96cf59a5b.16">{p.tr('assign')}</button>
        </form>
      )}
    </div>
  );
}

function RequestsSection({ base, history, p, requestId, setRequestId }) {
  const money = useMoney();
  return (
    <div>
      <h4>{p.tr('requests')}</h4>
      {history.length === 0 ? <p>{p.common('empty')}</p> : (
        <table className="g56-table">
          <thead><tr><th scope="col">{p.common('title')}</th><th scope="col">{p.common('status')}</th><th scope="col">{p.tr('urgency')}</th><th scope="col">{p.tr('category')}</th><th scope="col">{p.tr('unitLabel')}</th><th scope="col">{p.common('created')}</th><th scope="col">{p.tr('cost')}</th><th scope="col"><span className="g56-sr">{p.common('view')}</span></th></tr></thead>
          <tbody>{history.map((r) => (
            <tr key={r.id} className={requestId === String(r.id) ? 'g56-row--selected' : ''}>
              <td>{r.title}</td><td>{r.status}</td><td>{r.urgency}</td><td>{r.issue_category || '—'}</td>
              <td>{r.unit_label || '—'}</td><td>{p.time(r.created_at)}</td><td>{r.actual_cost == null ? '—' : money(Math.round(Number(r.actual_cost) * 100))}</td>
              <td><button type="button" onClick={() => setRequestId(String(r.id))} data-track="ui.e96cf59a5b.17">{p.common('view')}</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {requestId && <RequestDetail base={base} requestId={requestId} onClose={() => setRequestId(null)} />}
    </div>
  );
}

function DuplicatesSection({ base, requestId, dup }) {
  const [target, setTarget] = useState('');
  if (!dup.data) return dup.errorText ? <p className="g56-error">{dup.errorText}</p> : null;
  return (
    <div>
      <h5>{dup.tr('duplicates')}</h5>
      <Notice p={dup} />
      {dup.data.duplicate_of_id && <p className="g56-muted">{dup.tr('duplicateOf')}: {dup.data.duplicate_of_id}</p>}
      {dup.data.candidates.length === 0 ? <p>{dup.common('empty')}</p> : (
        <form onSubmit={async (ev) => { ev.preventDefault(); if (target) await dup.send('post', `${base}/requests/${requestId}/duplicate`, { duplicate_of_id: target }); }} className="g56-row" data-track="ui.e96cf59a5b.58">
          <label>{dup.tr('duplicateOf')}
            <select value={target} onChange={(ev) => setTarget(ev.target.value)}>
              <option value="">—</option>
              {dup.data.candidates.map((c) => <option key={c.id} value={String(c.id)}>{c.title} · {c.status}</option>)}
            </select>
          </label>
          <button type="submit" disabled={dup.busy || !target} data-track="ui.e96cf59a5b.59">{dup.tr('linkDuplicate')}</button>
        </form>
      )}
    </div>
  );
}

function RequestDetail({ base, requestId, onClose }) {
  const q = useBizG56(`${base}/requests/${requestId}/quotes`, 'properties');
  const e = useBizG56(`${base}/requests/${requestId}/entry`, 'properties');
  const v = useBizG56(`${base}/vendors`, 'properties');
  const dup = useBizG56(`${base}/requests/${requestId}/duplicates`, 'properties');
  const money = useMoney();
  const [quoteForm, setQuoteForm] = useState({ vendor_id: '', amount: '', scope: '', available_on: '' });
  const [woForm, setWoForm] = useState({ vendor_id: '', quote_id: '', nte: '', scope: '' });
  const [approvalForm, setApprovalForm] = useState({ amount: '', note: '' });
  const [entryForm, setEntryForm] = useState({ consent: 'granted', method: 'portal', start: '', end: '', instructions: '', instructionsExpireAt: '' });
  if (!q.data) return q.errorText ? <p className="g56-error">{q.errorText}</p> : null;
  const addQuote = async (ev) => {
    ev.preventDefault();
    const cents = toCents(quoteForm.amount);
    if (!quoteForm.vendor_id || cents == null) return;
    const created = await q.send('post', `${base}/requests/${requestId}/quotes`, {
      vendor_id: quoteForm.vendor_id, amount_cents: cents,
      scope: quoteForm.scope.trim() || undefined, available_on: quoteForm.available_on || undefined,
    });
    if (created) setQuoteForm({ vendor_id: '', amount: '', scope: '', available_on: '' });
  };
  const issueWO = async (ev) => {
    ev.preventDefault();
    const nte = toCents(woForm.nte);
    if (nte == null) return;
    const body = { not_to_exceed_cents: nte };
    if (woForm.quote_id) body.quote_id = woForm.quote_id;
    else if (woForm.vendor_id) body.vendor_id = woForm.vendor_id;
    else return;
    if (woForm.scope.trim()) body.scope = woForm.scope.trim();
    await q.send('post', `${base}/requests/${requestId}/work-orders`, body);
  };
  const requestApproval = async (ev) => {
    ev.preventDefault();
    const cents = toCents(approvalForm.amount);
    if (cents == null) return;
    await q.send('post', `${base}/requests/${requestId}/approval`, { amount_cents: cents, note: approvalForm.note.trim() || undefined });
  };
  const saveEntry = async (ev) => {
    ev.preventDefault();
    const windows = (entryForm.start && entryForm.end)
      ? [{ start: new Date(entryForm.start).toISOString(), end: new Date(entryForm.end).toISOString() }] : [];
    // Batch H: the entry route is PUT, not POST (server/routes/propertyManager.js).
    await e.send('put', `${base}/requests/${requestId}/entry`, {
      consent: entryForm.consent, consent_method: entryForm.method,
      offered_windows: windows, instructions: entryForm.instructions.trim() || undefined,
      instructions_expire_at: entryForm.instructionsExpireAt ? new Date(entryForm.instructionsExpireAt).toISOString() : undefined,
    });
  };
  return (
    <div>
      <h4>{q.tr('requestDetail')}</h4>
      <button type="button" onClick={onClose} data-track="ui.e96cf59a5b.18">{q.common('back')}</button>
      <Notice p={q} />
      <Notice p={e} />
      <p className="g56-muted">
        {q.tr('approvalThreshold')}: {q.data.threshold_cents == null ? '—' : money(q.data.threshold_cents)}
        {' · '}{q.common('status')}: {q.data.approval_status}
      </p>
      <h5>{q.tr('quotes')}</h5>
      <DuplicatesSection base={base} requestId={requestId} dup={dup} />
      {q.data.quotes.length === 0 ? <p>{q.common('empty')}</p> : (
        <table className="g56-table">
          <thead><tr><th scope="col">{q.common('vendor')}</th><th scope="col">{q.common('amount')}</th><th scope="col">{q.common('scope')}</th><th scope="col">{q.tr('availableOn')}</th><th scope="col">{q.common('status')}</th><th scope="col"><span className="g56-sr">{q.tr('selectQuote')}</span></th></tr></thead>
          <tbody>{q.data.quotes.map((quote) => (
            <tr key={quote.id}>
              <td>{quote.vendor}</td><td>{money(quote.amount_cents)}{quote.lowest ? ` (${q.tr('lowest')})` : ''}</td>
              <td>{quote.scope || '—'}</td><td>{quote.available_on || '—'}</td>
              <td>{quote.status}{quote.needs_approval ? ` · ${q.tr('needsApproval')}` : ''}</td>
              <td>{quote.status !== 'selected' && <button type="button" disabled={q.busy} onClick={() => q.send('post', `${base}/quotes/${quote.id}/select`, {})} data-track="ui.e96cf59a5b.19">{q.tr('selectQuote')}</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <form onSubmit={addQuote} className="g56-row" data-track="ui.e96cf59a5b.20">
        <label>{q.common('vendor')}<select value={quoteForm.vendor_id} onChange={(ev) => setQuoteForm({ ...quoteForm, vendor_id: ev.target.value })}><option value="">—</option>{(v.data?.vendors || []).map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label>
        <label>{q.common('amount')}<input inputMode="decimal" value={quoteForm.amount} onChange={(ev) => setQuoteForm({ ...quoteForm, amount: ev.target.value })} dir="ltr" /></label>
        <label>{q.common('scope')}<input value={quoteForm.scope} maxLength={2000} onChange={(ev) => setQuoteForm({ ...quoteForm, scope: ev.target.value })} /></label>
        <label>{q.tr('availableOn')}<input type="date" value={quoteForm.available_on} onChange={(ev) => setQuoteForm({ ...quoteForm, available_on: ev.target.value })} /></label>
        <button type="submit" disabled={q.busy || !quoteForm.vendor_id} data-track="ui.e96cf59a5b.21">{q.tr('addQuote')}</button>
      </form>
      <form onSubmit={issueWO} className="g56-row" data-track="ui.e96cf59a5b.22">
        <label>{q.common('vendor')}<select value={woForm.vendor_id} onChange={(ev) => setWoForm({ ...woForm, vendor_id: ev.target.value, quote_id: '' })}><option value="">—</option>{(v.data?.vendors || []).map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label>
        <label>{q.tr('quotes')}<select value={woForm.quote_id} onChange={(ev) => setWoForm({ ...woForm, quote_id: ev.target.value })}><option value="">—</option>{q.data.quotes.map((quote) => <option key={quote.id} value={quote.id}>{quote.vendor} · {money(quote.amount_cents)}</option>)}</select></label>
        <label>{q.tr('notToExceed')}<input inputMode="decimal" value={woForm.nte} onChange={(ev) => setWoForm({ ...woForm, nte: ev.target.value })} dir="ltr" /></label>
        <label>{q.common('scope')}<input value={woForm.scope} maxLength={4000} onChange={(ev) => setWoForm({ ...woForm, scope: ev.target.value })} /></label>
        <button type="submit" disabled={q.busy} data-track="ui.e96cf59a5b.23">{q.tr('issueWorkOrder')}</button>
      </form>
      <form onSubmit={requestApproval} className="g56-row" data-track="ui.e96cf59a5b.24">
        <label>{q.tr('approvalAmount')}<input inputMode="decimal" value={approvalForm.amount} onChange={(ev) => setApprovalForm({ ...approvalForm, amount: ev.target.value })} dir="ltr" /></label>
        <label>{q.common('reason')}<input value={approvalForm.note} maxLength={1000} onChange={(ev) => setApprovalForm({ ...approvalForm, note: ev.target.value })} /></label>
        <button type="submit" disabled={q.busy} data-track="ui.e96cf59a5b.25">{q.tr('requestApproval')}</button>
      </form>
      <div className="g56-row">
        {/* Batch H: the route is POST /requests/:id/entry/notify, not /notify-occupant. */}
        <button type="button" disabled={q.busy} onClick={() => q.send('post', `${base}/requests/${requestId}/entry/notify`, {})} data-track="ui.e96cf59a5b.26">{q.tr('notifyOccupant')}</button>
        <button type="button" disabled={q.busy} onClick={() => q.send('post', `${base}/requests/${requestId}/emergency`, {})} data-track="ui.e96cf59a5b.27">{q.tr('routeEmergency')}</button>
      </div>
      <h5>{q.tr('entry')}</h5>
      {e.data && (
        <p className="g56-muted">
          {q.tr('permissionToEnter')}: {String(e.data.permission_to_enter ?? '—')}
          {e.data.entry?.instructions ? ` · ${q.tr('entryInstructions')}: ${e.data.entry.instructions}` : ''}
          {e.data.entry?.instructions_expired ? ` · ${q.tr('instructionsExpired')}` : ''}
          {e.data.entry?.consent_expired ? ` · ${q.tr('consentExpired')}` : ''}
          {e.data.entry?.consent_valid_until && !e.data.entry?.consent_expired ? ` · ${q.tr('consentValidUntil')}: ${q.time(e.data.entry.consent_valid_until)}` : ''}
        </p>
      )}
      <form onSubmit={saveEntry} className="g56-row" data-track="ui.e96cf59a5b.28">
        <label>{q.tr('entry')}<select value={entryForm.consent} onChange={(ev) => setEntryForm({ ...entryForm, consent: ev.target.value })}><option value="granted">granted</option><option value="denied">denied</option></select></label>
        <label>{q.tr('windowStart')}<input type="datetime-local" value={entryForm.start} onChange={(ev) => setEntryForm({ ...entryForm, start: ev.target.value })} /></label>
        <label>{q.tr('windowEnd')}<input type="datetime-local" value={entryForm.end} onChange={(ev) => setEntryForm({ ...entryForm, end: ev.target.value })} /></label>
        <label>{q.tr('entryInstructions')}<input value={entryForm.instructions} maxLength={2000} onChange={(ev) => setEntryForm({ ...entryForm, instructions: ev.target.value })} /></label>
        <label>{q.tr('instructionsExpireAt')}<input type="datetime-local" value={entryForm.instructionsExpireAt} onChange={(ev) => setEntryForm({ ...entryForm, instructionsExpireAt: ev.target.value })} /></label>
        <button type="submit" disabled={e.busy} data-track="ui.e96cf59a5b.29">{q.tr('saveEntry')}</button>
      </form>
    </div>
  );
}

function IncidentsSection({ base, propertyId, p }) {
  const i = useBizG56(`${base}/p/${propertyId}/incidents`, 'properties');
  const [form, setForm] = useState({ title: '', severity: 'major', relocation_note: '', category: '', assigned_to: '' });
  const [evForm, setEvForm] = useState({ incident_id: '', url: '', label: '', kind: 'photo' });
  const [fuForm, setFuForm] = useState({ incident_id: '', follow_up_on: '' });
  const create = async (ev) => {
    ev.preventDefault();
    if (!form.title.trim()) return;
    const created = await i.send('post', `${base}/p/${propertyId}/incidents`, {
      title: form.title.trim(), severity: form.severity, relocation_note: form.relocation_note.trim() || undefined,
      category: form.category.trim() || undefined, assigned_to: form.assigned_to.trim() || undefined,
    });
    if (created) setForm({ title: '', severity: 'major', relocation_note: '', category: '', assigned_to: '' });
  };
  const addEvidence = async (ev) => {
    ev.preventDefault();
    if (!evForm.incident_id || !evForm.url.trim()) return;
    const created = await i.send('post', `${base}/incidents/${evForm.incident_id}/evidence`, { url: evForm.url.trim(), label: evForm.label.trim() || undefined, kind: evForm.kind });
    if (created) setEvForm({ incident_id: '', url: '', label: '', kind: 'photo' });
  };
  const setFollowUp = async (ev) => {
    ev.preventDefault();
    if (!fuForm.incident_id || !fuForm.follow_up_on) return;
    const updated = await i.send('patch', `${base}/incidents/${fuForm.incident_id}`, { follow_up_on: fuForm.follow_up_on });
    if (updated) setFuForm({ incident_id: '', follow_up_on: '' });
  };
  if (!i.data) return i.errorText ? <p className="g56-error">{i.errorText}</p> : null;
  return (
    <div>
      <h4>{i.tr('incidentsTitle')}</h4>
      <Notice p={i} />
      {i.data.incidents.length === 0 ? <p>{i.common('empty')}</p> : (
        <ul className="g56-list">{i.data.incidents.map((row) => <li key={row.id}>{row.title} · {row.severity} · {row.status} · {row.category || i.tr('uncategorised')} · {row.assignee_name || i.tr('unassigned')}{row.unit_label ? ` · ${row.unit_label}` : ''}{row.follow_up_overdue ? ` · ${i.tr('overdue')}` : ''}</li>)}</ul>
      )}
      <form onSubmit={create} className="g56-row" data-track="ui.e96cf59a5b.30">
        <label>{i.common('title')}<input value={form.title} maxLength={160} onChange={(ev) => setForm({ ...form, title: ev.target.value })} /></label>
        <label>{i.tr('severity')}<select value={form.severity} onChange={(ev) => setForm({ ...form, severity: ev.target.value })}>{SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        <label>{i.tr('category')}<input value={form.category} maxLength={80} onChange={(ev) => setForm({ ...form, category: ev.target.value })} /></label>
        <label>{i.tr('assigneeUserId')}<input value={form.assigned_to} onChange={(ev) => setForm({ ...form, assigned_to: ev.target.value })} dir="ltr" /></label>
        <label>{i.common('notes')}<input value={form.relocation_note} maxLength={2000} onChange={(ev) => setForm({ ...form, relocation_note: ev.target.value })} /></label>
        <button type="submit" disabled={i.busy || !form.title.trim()} data-track="ui.e96cf59a5b.31">{i.tr('createIncident')}</button>
      </form>
      <form onSubmit={addEvidence} className="g56-row" data-track="ui.e96cf59a5b.60">
        <label>{i.tr('incidentsTitle')}<select value={evForm.incident_id} onChange={(ev) => setEvForm({ ...evForm, incident_id: ev.target.value })}><option value="">—</option>{i.data.incidents.map((row) => <option key={row.id} value={String(row.id)}>{row.title}</option>)}</select></label>
        <label>{i.tr('evidenceUrl')}<input value={evForm.url} maxLength={1000} onChange={(ev) => setEvForm({ ...evForm, url: ev.target.value })} dir="ltr" /></label>
        <label>{i.common('title')}<input value={evForm.label} maxLength={160} onChange={(ev) => setEvForm({ ...evForm, label: ev.target.value })} /></label>
        <label>{i.tr('evidence')}<select value={evForm.kind} onChange={(ev) => setEvForm({ ...evForm, kind: ev.target.value })}>{['photo', 'document', 'video', 'other'].map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
        <button type="submit" disabled={i.busy || !evForm.incident_id || !evForm.url.trim()} data-track="ui.e96cf59a5b.61">{i.tr('addEvidence')}</button>
      </form>
      <form onSubmit={setFollowUp} className="g56-row" data-track="ui.e96cf59a5b.62">
        <label>{i.tr('incidentsTitle')}<select value={fuForm.incident_id} onChange={(ev) => setFuForm({ ...fuForm, incident_id: ev.target.value })}><option value="">—</option>{i.data.incidents.map((row) => <option key={row.id} value={String(row.id)}>{row.title}</option>)}</select></label>
        <label>{i.tr('followUpOn')}<input type="date" value={fuForm.follow_up_on} onChange={(ev) => setFuForm({ ...fuForm, follow_up_on: ev.target.value })} /></label>
        <button type="submit" disabled={i.busy || !fuForm.incident_id || !fuForm.follow_up_on} data-track="ui.e96cf59a5b.63">{i.tr('setFollowUp')}</button>
      </form>
    </div>
  );
}

function KeysSection({ base, propertyId, p }) {
  const k = useBizG56(`${base}/p/${propertyId}/keys`, 'properties');
  const [label, setLabel] = useState('');
  const [holder, setHolder] = useState('');
  const add = async (ev) => {
    ev.preventDefault();
    if (!label.trim()) return;
    const created = await k.send('post', `${base}/p/${propertyId}/keys`, { label: label.trim() });
    if (created) setLabel('');
  };
  if (!k.data) return k.errorText ? <p className="g56-error">{k.errorText}</p> : null;
  return (
    <div>
      <h4>{k.tr('keys')}</h4>
      <Notice p={k} />
      {k.data.keys.length === 0 ? <p>{k.common('empty')}</p> : (
        <table className="g56-table">
          <thead><tr><th scope="col">{k.tr('keyLabel')}</th><th scope="col">{k.tr('unitLabel')}</th><th scope="col">{k.common('status')}</th><th scope="col"><span className="g56-sr">{k.tr('checkOut')}</span></th></tr></thead>
          <tbody>{k.data.keys.map((row) => (
            <tr key={row.id}>
              <td>{row.label}</td><td>{row.unit_label || '—'}</td><td>{row.status}{row.overdue ? ` · ${k.tr('overdue')}` : ''}</td>
              <td>
                {row.status !== 'out' ? (
                  <button type="button" disabled={k.busy} onClick={() => k.send('post', `${base}/keys/${row.id}/check-out`, { holder_name: holder.trim() || undefined })} data-track="ui.e96cf59a5b.32">{k.tr('checkOut')}</button>
                ) : (
                  <>
                    <button type="button" disabled={k.busy} onClick={() => k.send('post', `${base}/keys/${row.id}/return`, {})} data-track="ui.e96cf59a5b.33">{k.tr('checkIn')}</button>
                    {' '}
                    <button type="button" disabled={k.busy} onClick={() => k.send('post', `${base}/keys/${row.id}/lost`, {})} data-track="ui.e96cf59a5b.34">{k.tr('lost')}</button>
                  </>
                )}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <form onSubmit={add} className="g56-row" data-track="ui.e96cf59a5b.35">
        <label>{k.tr('keyLabel')}<input value={label} maxLength={80} onChange={(ev) => setLabel(ev.target.value)} /></label>
        <label>{k.tr('contactName')}<input value={holder} maxLength={160} onChange={(ev) => setHolder(ev.target.value)} /></label>
        <button type="submit" disabled={k.busy || !label.trim()} data-track="ui.e96cf59a5b.36">{k.tr('addKey')}</button>
      </form>
      {k.data.keys.some((row) => (row.events || []).length > 0) && (
        <div>
          <h5>{k.tr('keyHistory')}</h5>
          <ul className="g56-list">{k.data.keys.flatMap((row) => (row.events || []).map((ev, idx) => <li key={`${row.id}-${idx}`}>{row.label} · {ev.action} · {ev.holder_name || '—'} · {k.time(ev.at)}</li>))}</ul>
        </div>
      )}
    </div>
  );
}

function TransferSection({ base, propertyId, p }) {
  const [toUser, setToUser] = useState('');
  const [revokeUser, setRevokeUser] = useState('');
  const [handover, setHandover] = useState(null);
  const showHandover = async () => {
    const v = await p.send('get', `${base}/p/${propertyId}/handover`);
    if (v) setHandover(v);
  };
  return (
    <div>
      <h4>{p.tr('handover')}</h4>
      <div className="g56-row">
        <button type="button" disabled={p.busy} onClick={showHandover} data-track="ui.e96cf59a5b.37">{p.tr('handover')}</button>
        <button type="button" disabled={p.busy} onClick={() => p.send('post', `${base}/p/${propertyId}/notify-occupants`, {})} data-track="ui.e96cf59a5b.38">{p.tr('notifyOccupants')}</button>
      </div>
      {handover && (
        <p className="g56-muted">
          {handover.property?.label} · {handover.property?.address || ''} · {handover.property?.owner_name || ''}
          {handover.generated_at ? ` · ${p.time(handover.generated_at)}` : ''}
        </p>
      )}
      <form onSubmit={async (ev) => { ev.preventDefault(); if (!toUser.trim()) return; const v = await p.send('post', `${base}/p/${propertyId}/reassign`, { to_user_id: toUser.trim() }); if (v) setToUser(''); }} className="g56-row" data-track="ui.e96cf59a5b.39">
        <label>{p.tr('userId')}<input value={toUser} onChange={(ev) => setToUser(ev.target.value)} dir="ltr" /></label>
        <button type="submit" disabled={p.busy || !toUser.trim()} data-track="ui.e96cf59a5b.40">{p.tr('reassign')}</button>
      </form>
      <form onSubmit={async (ev) => { ev.preventDefault(); if (!revokeUser.trim()) return; const v = await p.send('post', `${base}/p/${propertyId}/revoke`, { user_id: revokeUser.trim() }); if (v) setRevokeUser(''); }} className="g56-row" data-track="ui.e96cf59a5b.41">
        <label>{p.tr('userId')}<input value={revokeUser} onChange={(ev) => setRevokeUser(ev.target.value)} dir="ltr" /></label>
        <button type="submit" disabled={p.busy || !revokeUser.trim()} data-track="ui.e96cf59a5b.42">{p.tr('revokeAccess')}</button>
      </form>
    </div>
  );
}

function TurnoverStartSection({ base, propertyId, units, p }) {
  const [form, setForm] = useState({ unit_id: '', move_out_on: '', move_in_on: '' });
  const start = async (ev) => {
    ev.preventDefault();
    if (!form.unit_id) return;
    const created = await p.send('post', `${base}/p/${propertyId}/turnovers`, {
      unit_id: form.unit_id,
      move_out_on: form.move_out_on || undefined, move_in_on: form.move_in_on || undefined,
    });
    if (created) setForm({ unit_id: '', move_out_on: '', move_in_on: '' });
  };
  return (
    <div>
      <h4>{p.tr('turnovers')}</h4>
      <form onSubmit={start} className="g56-row" data-track="ui.e96cf59a5b.43">
        <label>{p.tr('unitLabel')}<select value={form.unit_id} onChange={(ev) => setForm({ ...form, unit_id: ev.target.value })}><option value="">—</option>{units.map((u) => <option key={u.id} value={u.id}>{u.unit_label}</option>)}</select></label>
        <label>{p.tr('moveOut')}<input type="date" value={form.move_out_on} onChange={(ev) => setForm({ ...form, move_out_on: ev.target.value })} /></label>
        <label>{p.tr('moveIn')}<input type="date" value={form.move_in_on} onChange={(ev) => setForm({ ...form, move_in_on: ev.target.value })} /></label>
        <button type="submit" disabled={p.busy || !form.unit_id} data-track="ui.e96cf59a5b.44">{p.tr('startTurnover')}</button>
      </form>
    </div>
  );
}

function AccessReviewSection({ base }) {
  const p = useBizG56(`${base}/access-review`, 'properties');
  if (!p.data) return p.errorText ? <p className="g56-error">{p.errorText}</p> : null;
  return (
    <div>
      <h3>{p.tr('accessReview')}</h3>
      <Notice p={p} />
      <p className="g56-muted">{p.tr('flagged')}: {p.data.flagged}</p>
      {p.data.assignments.length === 0 ? <p>{p.common('empty')}</p> : (
        <table className="g56-table">
          <thead><tr><th scope="col">{p.tr('label')}</th><th scope="col">{p.common('role')}</th><th scope="col">{p.tr('contactName')}</th><th scope="col">{p.tr('keysOut')}</th><th scope="col">{p.tr('flagged')}</th><th scope="col"><span className="g56-sr">{p.tr('reviewAssignment')}</span></th></tr></thead>
          <tbody>{p.data.assignments.map((a) => {
            const flags = [a.member_inactive && p.tr('memberInactive'), a.ending_soon && p.tr('endingSoon'), a.review_due && p.tr('reviewDue')].filter(Boolean);
            return (
              <tr key={a.id}>
                <td>{a.property}</td><td>{a.role}</td><td>{a.user_name || a.contact_name || '—'}</td>
                <td>{a.keys_out}</td><td>{flags.length ? flags.join(' · ') : '—'}</td>
                <td>
                  <button type="button" disabled={p.busy} onClick={() => p.send('post', `${base}/assignments/${a.id}/review`, { decision: 'keep' })} data-track="ui.e96cf59a5b.45">{p.tr('keep')}</button>
                  {' '}
                  <button type="button" disabled={p.busy} onClick={() => p.send('post', `${base}/assignments/${a.id}/review`, { decision: 'end' })} data-track="ui.e96cf59a5b.46">{p.tr('endAssignment')}</button>
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
    </div>
  );
}

function UpkeepSection({ base }) {
  const cal = useBizG56(`${base}/calendar`, 'properties');
  const al = useBizG56(`${base}/alerts`, 'properties');
  const tv = useBizG56(`${base}/turnovers`, 'properties');
  const co = useBizG56(`${base}/costs`, 'properties');
  const inv = useBizG56(`${base}/invoices`, 'properties');
  const money = useMoney();
  const [invoiceForm, setInvoiceForm] = useState({ vendor_id: '', amount: '', work_order_id: '' });
  const addInvoice = async (ev) => {
    ev.preventDefault();
    const cents = toCents(invoiceForm.amount);
    if (!invoiceForm.vendor_id || cents == null) return;
    const created = await inv.send('post', `${base}/invoices`, {
      vendor_id: invoiceForm.vendor_id, amount_cents: cents,
      work_order_id: invoiceForm.work_order_id.trim() || undefined,
    });
    if (created) setInvoiceForm({ vendor_id: '', amount: '', work_order_id: '' });
  };
  return (
    <div>
      <h3>{cal.tr('upkeep')}</h3>
      <h4>{cal.tr('calendar')}</h4>
      {!cal.data ? (cal.errorText && <p className="g56-error">{cal.errorText}</p>) : cal.data.items.length === 0 ? <p>{cal.common('empty')}</p> : (
        <ul className="g56-list">{cal.data.items.map((row, idx) => <li key={row.id || idx}>{row.title || row.kind} · {row.due_on || ''}{row.overdue ? ` · ${cal.tr('overdue')}` : ''}{row.source === 'schedule' && <button type="button" disabled={cal.busy} onClick={() => cal.send('post', `${base}/schedules/${row.id}/book`, {})} data-track="ui.e96cf59a5b.64">{cal.tr('bookOccurrence')}</button>}</li>)}</ul>
      )}
      <h4>{al.tr('alerts')}</h4>
      {!al.data ? (al.errorText && <p className="g56-error">{al.errorText}</p>) : (
        <>
          <p className="g56-muted">{al.tr('overdue')}: {al.data.overdue.length}</p>
          {al.data.overdue.length > 0 && <ul className="g56-list">{al.data.overdue.map((row, idx) => <li key={row.id || idx}>{row.title || row.kind} · {row.due_on || ''}</li>)}</ul>}
          <button type="button" disabled={al.busy} onClick={() => al.send('post', `${base}/alerts/notify`, {})} data-track="ui.e96cf59a5b.47">{al.tr('notifyNow')}</button>
          <Notice p={al} />
        </>
      )}
      <h4>{tv.tr('turnovers')}</h4>
      {!tv.data ? (tv.errorText && <p className="g56-error">{tv.errorText}</p>) : tv.data.turnovers.length === 0 ? <p>{tv.common('empty')}</p> : (
        <table className="g56-table">
          <thead><tr><th scope="col">{tv.tr('label')}</th><th scope="col">{tv.tr('unitLabel')}</th><th scope="col">{tv.common('status')}</th><th scope="col">{tv.tr('due')}</th><th scope="col"><span className="g56-sr">{tv.tr('closeWorkOrder')}</span></th></tr></thead>
          <tbody>{tv.data.turnovers.map((row) => (
            <tr key={row.id}>
              <td>{row.property}</td><td>{row.unit_label}</td><td>{row.status} · {row.done_steps}/{row.total_steps}{row.at_risk ? ` · ${tv.tr('overdue')}` : ''}</td>
              <td>{row.move_in_on || '—'}</td>
              <td>
                {row.steps?.map((s) => (
                  <span key={s.key}>
                    <button type="button" disabled={tv.busy} onClick={() => tv.send('post', `${base}/turnovers/${row.id}/steps/${s.key}`, { status: s.status === 'done' ? 'pending' : 'done' })} data-track="ui.e96cf59a5b.48">{s.key}: {s.status}</button>
                    {' '}
                  </span>
                ))}
                <button type="button" disabled={tv.busy} onClick={() => tv.send('post', `${base}/turnovers/${row.id}/close`, {})} data-track="ui.e96cf59a5b.49">{tv.tr('closeWorkOrder')}</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <h4>{co.tr('costs')}</h4>
      {!co.data ? (co.errorText && <p className="g56-error">{co.errorText}</p>) : (
        <>
          <p className="g56-muted">{co.tr('monthSpend')}: {money(co.data.total_spend_cents)} · {co.tr('overdue')}: {co.data.over_budget}</p>
          <button type="button" disabled={co.busy} onClick={() => co.send('post', `${base}/costs/alerts`, {})} data-track="ui.e96cf59a5b.65">{co.tr('sendBudgetAlerts')}</button>
          <Notice p={co} />
          <table className="g56-table">
            <thead><tr><th scope="col">{co.tr('label')}</th><th scope="col">{co.tr('monthSpend')}</th><th scope="col">{co.tr('budget')}</th><th scope="col">{co.tr('reserve')}</th></tr></thead>
            <tbody>{co.data.properties.map((row) => (
              <tr key={row.id}><td>{row.label}</td><td>{money(row.month_spend_cents)}</td><td>{row.monthly_budget_cents == null ? '—' : money(row.monthly_budget_cents)}</td><td>{row.reserve_balance_cents == null ? '—' : money(row.reserve_balance_cents)}</td></tr>
            ))}</tbody>
          </table>
        </>
      )}
      <h4>{inv.tr('invoices')}</h4>
      {!inv.data ? (inv.errorText && <p className="g56-error">{inv.errorText}</p>) : inv.data.invoices.length === 0 ? <p>{inv.common('empty')}</p> : (
        <table className="g56-table">
          <thead><tr><th scope="col">{inv.common('vendor')}</th><th scope="col">{inv.common('amount')}</th><th scope="col">{inv.tr('matchStatus')}</th><th scope="col">{inv.tr('label')}</th><th scope="col"><span className="g56-sr">{inv.tr('invoiceDecision')}</span></th></tr></thead>
          <tbody>{inv.data.invoices.map((row) => (
            <tr key={row.id}>
              <td>{row.vendor}</td><td>{money(row.amount_cents)}</td><td>{row.match_status}</td><td>{row.property || '—'}</td>
              <td>
                {['unmatched', 'matched', 'over'].includes(row.match_status) && (
                  <>
                    <button type="button" disabled={inv.busy} onClick={() => inv.send('post', `${base}/invoices/${row.id}/decision`, { decision: 'approved' })} data-track="ui.e96cf59a5b.50">{inv.common('approve')}</button>
                    {' '}
                    <button type="button" disabled={inv.busy} onClick={() => inv.send('post', `${base}/invoices/${row.id}/decision`, { decision: 'rejected' })} data-track="ui.e96cf59a5b.51">{inv.common('decline')}</button>
                  </>
                )}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <VendorsInvoiceForm base={base} inv={inv} invoiceForm={invoiceForm} setInvoiceForm={setInvoiceForm} addInvoice={addInvoice} />
    </div>
  );
}

function VendorsInvoiceForm({ base, inv, invoiceForm, setInvoiceForm, addInvoice }) {
  const v = useBizG56(`${base}/vendors`, 'properties');
  if (!v.data) return v.errorText ? <p className="g56-error">{v.errorText}</p> : null;
  return (
    <form onSubmit={addInvoice} className="g56-row" data-track="ui.e96cf59a5b.52">
      <label>{inv.common('vendor')}<select value={invoiceForm.vendor_id} onChange={(ev) => setInvoiceForm({ ...invoiceForm, vendor_id: ev.target.value })}><option value="">—</option>{v.data.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label>
      <label>{inv.common('amount')}<input inputMode="decimal" value={invoiceForm.amount} onChange={(ev) => setInvoiceForm({ ...invoiceForm, amount: ev.target.value })} dir="ltr" /></label>
      <label>{inv.tr('workOrders')}<input value={invoiceForm.work_order_id} onChange={(ev) => setInvoiceForm({ ...invoiceForm, work_order_id: ev.target.value })} dir="ltr" /></label>
      <button type="submit" disabled={inv.busy || !invoiceForm.vendor_id} data-track="ui.e96cf59a5b.53">{inv.tr('addInvoice')}</button>
    </form>
  );
}

function VendorsSection({ base }) {
  const v = useBizG56(`${base}/vendors`, 'properties');
  const [form, setForm] = useState({ name: '', trade: '', phone: '', email: '' });
  const create = async (ev) => {
    ev.preventDefault();
    if (!form.name.trim()) return;
    const created = await v.send('post', `${base}/vendors`, { name: form.name.trim(), trade: form.trade.trim() || undefined, phone: form.phone.trim() || undefined, email: form.email.trim() || undefined });
    if (created) setForm({ name: '', trade: '', phone: '', email: '' });
  };
  if (!v.data) return v.errorText ? <p className="g56-error">{v.errorText}</p> : null;
  return (
    <div>
      <h3>{v.tr('vendors')}</h3>
      <Notice p={v} />
      {v.data.vendors.length === 0 ? <p>{v.common('empty')}</p> : (
        <ul className="g56-list">{v.data.vendors.map((row) => <li key={row.id}>{row.name}{row.trade ? ` · ${row.trade}` : ''} · {row.status}{row.insurance_expired ? ` · ${v.tr('insuranceExpired')}` : ''} · {v.tr('workOrders')}: {row.work_orders}</li>)}</ul>
      )}
      <form onSubmit={create} className="g56-row" data-track="ui.e96cf59a5b.54">
        <label>{v.tr('vendorName')}<input value={form.name} maxLength={160} onChange={(ev) => setForm({ ...form, name: ev.target.value })} /></label>
        <label>{v.tr('trade')}<input value={form.trade} maxLength={120} onChange={(ev) => setForm({ ...form, trade: ev.target.value })} /></label>
        <label>{v.tr('contactPhone')}<input value={form.phone} maxLength={40} onChange={(ev) => setForm({ ...form, phone: ev.target.value })} dir="ltr" /></label>
        <label>{v.tr('contactEmail')}<input value={form.email} maxLength={255} onChange={(ev) => setForm({ ...form, email: ev.target.value })} dir="ltr" /></label>
        <button type="submit" disabled={v.busy || !form.name.trim()} data-track="ui.e96cf59a5b.55">{v.tr('createVendor')}</button>
      </form>
    </div>
  );
}

function WorkOrdersSection({ base }) {
  const w = useBizG56(`${base}/work-orders`, 'properties');
  const money = useMoney();
  if (!w.data) return w.errorText ? <p className="g56-error">{w.errorText}</p> : null;
  return (
    <div>
      <h3>{w.tr('workOrders')}</h3>
      <Notice p={w} />
      {w.data.work_orders.length === 0 ? <p>{w.common('empty')}</p> : (
        <table className="g56-table">
          <thead><tr><th scope="col">{w.tr('workOrders')}</th><th scope="col">{w.common('vendor')}</th><th scope="col">{w.common('title')}</th><th scope="col">{w.common('status')}</th><th scope="col">{w.tr('notToExceed')}</th><th scope="col"><span className="g56-sr">{w.tr('closeWorkOrder')}</span></th></tr></thead>
          <tbody>{w.data.work_orders.map((row) => (
            <tr key={row.id}>
              <td>{row.number}</td><td>{row.vendor}</td><td>{row.title}</td><td>{row.status}</td>
              <td>{money(row.not_to_exceed_cents)}</td>
              <td>
                {row.status === 'issued' && (
                  <>
                    <button type="button" disabled={w.busy} onClick={() => w.send('post', `${base}/work-orders/${row.id}/close`, { status: 'completed' })} data-track="ui.e96cf59a5b.56">{w.tr('closeWorkOrder')}</button>
                    {' '}
                    <button type="button" disabled={w.busy} onClick={() => w.send('post', `${base}/work-orders/${row.id}/close`, { status: 'cancelled' })} data-track="ui.e96cf59a5b.57">{w.common('decline')}</button>
                  </>
                )}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

const SCHEDULE_KINDS = ['inspection', 'equipment', 'seasonal', 'vendor'];

function OwnerApprovalsSection() {
  // 317 (D-433): owner approval inbox. User-scoped: the server lists only
  // requests this caller must approve, plus their recently decided ones.
  const p = useBizG56('/me/property/approvals', 'properties');
  const money = useMoney();
  const [note, setNote] = useState('');
  const [trailId, setTrailId] = useState(null);
  if (!p.data) return p.errorText ? <p className="g56-error">{p.errorText}</p> : null;
  const decide = async (id, decision) => {
    const out = await p.send('post', `/me/property/approvals/${id}`, { decision, note: note.trim() || undefined });
    if (out) { setNote(''); setTrailId(null); }
  };
  const approvals = p.data.approvals || [];
  const decided = p.data.decided || [];
  return (
    <div>
      <h3>{p.tr('ownerApprovals')}</h3>
      <Notice p={p} />
      {approvals.length === 0 ? <p>{p.common('empty')}</p> : (
        <>
          <form onSubmit={(ev) => ev.preventDefault()} className="g56-row" data-track="ui.e96cf59a5b.72">
            <label>{p.tr('approvalNote')}<input value={note} maxLength={1000} onChange={(ev) => setNote(ev.target.value)} /></label>
          </form>
          <table className="g56-table">
            <thead><tr><th scope="col">{p.tr('label')}</th><th scope="col">{p.common('title')}</th><th scope="col">{p.common('amount')}</th><th scope="col">{p.tr('urgency')}</th><th scope="col">{p.tr('unitLabel')}</th><th scope="col">{p.tr('requestedAt')}</th><th scope="col"><span className="g56-sr">{p.tr('auditTrail')}</span></th></tr></thead>
            <tbody>{approvals.map((row) => (
              <tr key={row.id}>
                <td>{row.property}</td><td>{row.title}{row.approval_note ? ` · ${row.approval_note}` : ''}</td>
                <td>{money(row.approval_amount_cents)}</td><td>{row.urgency}</td><td>{row.unit_label || '—'}</td>
                <td>{p.time(row.approval_requested_at)}</td>
                <td>
                  <button type="button" disabled={p.busy} onClick={() => decide(row.id, 'approved')} data-track="ui.e96cf59a5b.68">{p.common('approve')}</button>
                  {' '}
                  <button type="button" disabled={p.busy} onClick={() => decide(row.id, 'declined')} data-track="ui.e96cf59a5b.69">{p.common('decline')}</button>
                  {' '}
                  <button type="button" onClick={() => setTrailId(trailId === String(row.id) ? null : String(row.id))} data-track="ui.e96cf59a5b.70">{trailId === String(row.id) ? p.tr('hideTrail') : p.tr('showTrail')}</button>
                  {trailId === String(row.id) && <ApprovalTrail requestId={String(row.id)} />}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </>
      )}
      {decided.length > 0 && (
        <>
          <h4>{p.tr('decidedApprovals')}</h4>
          <table className="g56-table">
            <thead><tr><th scope="col">{p.tr('label')}</th><th scope="col">{p.common('title')}</th><th scope="col">{p.common('amount')}</th><th scope="col">{p.common('status')}</th><th scope="col">{p.tr('decidedAt')}</th><th scope="col"><span className="g56-sr">{p.tr('auditTrail')}</span></th></tr></thead>
            <tbody>{decided.map((row) => (
              <tr key={row.id}>
                <td>{row.property}</td><td>{row.title}</td><td>{money(row.approval_amount_cents)}</td>
                <td>{row.approval_status}{row.decided_by ? ` · ${row.decided_by}` : ''}</td>
                <td>{p.time(row.approval_decided_at)}</td>
                <td>
                  <button type="button" onClick={() => setTrailId(trailId === String(row.id) ? null : String(row.id))} data-track="ui.e96cf59a5b.71">{trailId === String(row.id) ? p.tr('hideTrail') : p.tr('showTrail')}</button>
                  {trailId === String(row.id) && <ApprovalTrail requestId={String(row.id)} />}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </>
      )}
    </div>
  );
}

function ApprovalTrail({ requestId }) {
  const p = useBizG56(`/me/property/approvals/${requestId}/events`, 'properties');
  if (!p.data) return p.errorText ? <p className="g56-error">{p.errorText}</p> : null;
  if (p.data.events.length === 0) return <p>{p.common('empty')}</p>;
  return (
    <ul className="g56-list">
      {p.data.events.map((ev) => (
        <li key={ev.id}>{ev.event_type} · {ev.actor_name || '—'} · {p.time(ev.created_at)}{ev.note ? ` · ${ev.note}` : ''}</li>
      ))}
    </ul>
  );
}

function OwnerIncidentsSection() {
  // 345 (D-435): owner incident summary. Server returns only incidents
  // shared with this owner; the UI groups them by property.
  const p = useBizG56('/me/property/incidents', 'properties');
  if (!p.data) return p.errorText ? <p className="g56-error">{p.errorText}</p> : null;
  if (p.data.incidents.length === 0) {
    return (
      <div>
        <h3>{p.tr('ownerIncidents')}</h3>
        <p>{p.common('empty')}</p>
      </div>
    );
  }
  const groups = [];
  for (const row of p.data.incidents) {
    const g = groups.find((x) => x.property === row.property);
    if (g) g.rows.push(row);
    else groups.push({ property: row.property, business: row.business_name, rows: [row] });
  }
  return (
    <div>
      <h3>{p.tr('ownerIncidents')}</h3>
      {groups.map((g) => (
        <div key={g.property}>
          <h4>{g.property}{g.business ? ` · ${g.business}` : ''}</h4>
          <table className="g56-table">
            <thead><tr><th scope="col">{p.common('title')}</th><th scope="col">{p.tr('category')}</th><th scope="col">{p.tr('assignee')}</th><th scope="col">{p.tr('severity')}</th><th scope="col">{p.common('status')}</th><th scope="col">{p.tr('followUpOn')}</th><th scope="col">{p.tr('sharedAt')}</th></tr></thead>
            <tbody>{g.rows.map((row) => (
              <tr key={row.id}>
                <td>{row.title}{row.owner_summary ? ` · ${row.owner_summary}` : ''}</td>
                <td>{row.category || p.tr('uncategorised')}</td>
                <td>{row.assignee_name || p.tr('unassigned')}</td>
                <td>{row.severity}</td>
                <td>{row.status}</td>
                <td>{row.follow_up_on ? String(row.follow_up_on).slice(0, 10) : '—'}</td>
                <td>{p.time(row.owner_shared_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function UnitSpendSection({ base, propertyId, p }) {
  const u = useBizG56(`${base}/p/${propertyId}/unit-spend`, 'properties');
  const money = useMoney();
  if (!u.data) return u.errorText ? <p className="g56-error">{u.errorText}</p> : null;
  return (
    <div>
      <h4>{u.tr('unitSpend')}</h4>
      <p className="g56-muted">{u.tr('months')}: {u.data.months} · {u.tr('cost')}: {money(u.data.building_wide_cents)}</p>
      {u.data.units.length === 0 ? <p>{u.common('empty')}</p> : (
        <table className="g56-table">
          <thead><tr><th scope="col">{u.tr('unitLabel')}</th><th scope="col">{u.tr('cost')}</th><th scope="col">{u.common('quantity')}</th></tr></thead>
          <tbody>{u.data.units.map((row) => <tr key={row.id}><td>{row.unit_label}</td><td>{money(row.spend_cents)}</td><td>{row.items}</td></tr>)}</tbody>
        </table>
      )}
    </div>
  );
}

function ScheduleCreateSection({ base, propertyId, units, p }) {
  const [form, setForm] = useState({ kind: 'inspection', interval_days: '', months: '', unit_id: '' });
  const create = async (ev) => {
    ev.preventDefault();
    const body = { kind: form.kind };
    if (form.interval_days !== '') body.interval_days = Number(form.interval_days);
    if (form.months.trim()) {
      const months = form.months.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= 12);
      if (months.length) body.months = [...new Set(months)];
    }
    if (form.unit_id) body.unit_id = form.unit_id;
    if (body.interval_days == null && !body.months) return;
    const created = await p.send('post', `${base}/p/${propertyId}/schedules`, body);
    if (created) setForm({ kind: 'inspection', interval_days: '', months: '', unit_id: '' });
  };
  return (
    <div>
      <h4>{p.tr('calendar')}</h4>
      <form onSubmit={create} className="g56-row" data-track="ui.e96cf59a5b.66">
        <label>{p.tr('scheduleKind')}<select value={form.kind} onChange={(ev) => setForm({ ...form, kind: ev.target.value })}>{SCHEDULE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
        <label>{p.tr('intervalDays')}<input type="number" min="1" max="3660" value={form.interval_days} onChange={(ev) => setForm({ ...form, interval_days: ev.target.value })} dir="ltr" /></label>
        <label>{p.tr('months')}<input value={form.months} onChange={(ev) => setForm({ ...form, months: ev.target.value })} dir="ltr" /></label>
        <label>{p.tr('unitLabel')}<select value={form.unit_id} onChange={(ev) => setForm({ ...form, unit_id: ev.target.value })}><option value="">—</option>{units.map((u) => <option key={u.id} value={u.id}>{u.unit_label}</option>)}</select></label>
        <button type="submit" disabled={p.busy} data-track="ui.e96cf59a5b.67">{p.tr('createSchedule')}</button>
      </form>
    </div>
  );
}
