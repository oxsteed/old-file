import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

/**
 * Group 2 (Household delegate, items 51-100): the household page.
 * The owner invites delegates (52), reviews consent and scope (53, 81),
 * sees the activity log (55) and the role summary (74); delegates accept
 * or decline their invitations, read the shared calendar (61), prepare
 * visits (66-70), work maintenance plans (76-80), request spending
 * approval (82), and read shared documents (92). A delegate never pays
 * and never sees payment details: no amount, deposit, or payout appears
 * anywhere on this page.
 *
 * Wave 4 (Checkpoint C): the page is household-aware. The selector at the
 * top switches between the viewer's own household and each household they
 * hold a delegation for; every list/create call carries that household's
 * ownerId (item 61). Loading is per-section (Promise.allSettled, R64), so
 * one failing section no longer blanks the whole page. Grants render from
 * the locale catalog (household.scopeGrants.*), never from the server's
 * English strings (item 81).
 */
const SCOPES = ['book', 'schedule', 'prepare', 'coordinate', 'view_records', 'manage_addresses', 'manage_tasks', 'view_calendar'];
const TABS = ['delegations', 'calendar', 'addresses', 'contacts', 'templates', 'tasks', 'approvals', 'documents'];
const TEMPLATE_PREFILL_KEY = 'oxs:household-template-prefill';

function scopeGrants(scope, t) {
  const grants = t(`household.scopeGrants.${scope}`, { returnObjects: true });
  return Array.isArray(grants) ? grants : [];
}

/**
 * One visit's preparation workspace (items 63, 66-69, 86-91, 96-97).
 * Loads the prep row on demand; getPrep creates nothing (R63).
 */
function PrepPanel({ bookingId, delegates, onError }) {
  const { t } = useTranslation();
  const [prep, setPrep] = useState(null);
  const [availability, setAvailability] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');
  const [checklistLabel, setChecklistLabel] = useState('');
  const [supplyForm, setSupplyForm] = useState({ item: '', quantity: '', note: '' });
  const [accessibilityNeeds, setAccessibilityNeeds] = useState('');
  const [arrivalInstructions, setArrivalInstructions] = useState('');
  const [assignee, setAssignee] = useState('');
  const [windowForm, setWindowForm] = useState({ date: '', start: '', end: '', note: '' });
  const [summary, setSummary] = useState('');
  const [replacementReason, setReplacementReason] = useState('');
  const [missedAction, setMissedAction] = useState('reschedule');
  const [missedNote, setMissedNote] = useState('');
  const [unavailableReason, setUnavailableReason] = useState('');
  const [emergency, setEmergency] = useState(null);
  const [cancellation, setCancellation] = useState(null);
  const [handoffTo, setHandoffTo] = useState('');
  const [handoffNote, setHandoffNote] = useState('');
  const [reassignTo, setReassignTo] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    Promise.all([
      api.get(`/household/visits/${bookingId}/prep`),
      api.get(`/household/visits/${bookingId}/availability`),
    ])
      .then(([prepRes, availRes]) => {
        const row = prepRes.data?.prep || null;
        setPrep(row);
        setAccessibilityNeeds(row?.accessibilityNeeds || '');
        setArrivalInstructions(row?.arrivalInstructions || '');
        setAssignee(row?.assignedDelegateUserId || '');
        setSummary(row?.summary || '');
        setAvailability(Array.isArray(availRes.data?.availability) ? availRes.data.availability : []);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [bookingId]);

  useEffect(load, [load]);

  async function savePrep(patch) {
    setMessage('');
    try {
      const r = await api.put(`/household/visits/${bookingId}/prep`, patch);
      const row = r.data?.prep;
      if (row) {
        setPrep(row);
        setAccessibilityNeeds(row.accessibilityNeeds || '');
        setArrivalInstructions(row.arrivalInstructions || '');
        setAssignee(row.assignedDelegateUserId || '');
      }
    } catch (e) {
      onError(e?.response?.data?.error || t('household.actionFailed'));
    }
  }

  async function post(path, body, onOk) {
    setMessage('');
    try {
      const r = await api.post(path, body || {});
      if (onOk) onOk(r.data);
      load();
    } catch (e) {
      onError(e?.response?.data?.error || t('household.actionFailed'));
    }
  }

  if (loading) return <p className="mt-3 text-sm text-muted">{t('household.loading')}</p>;
  if (failed) {
    return (
      <p className="mt-3 text-sm text-muted">
        {t('household.prepLoadFailed')}{' '}
        <button type="button" className="underline" onClick={load}>{t('household.retry')}</button>
      </p>
    );
  }

  const checklist = Array.isArray(prep?.checklist) ? prep.checklist : [];
  const supplies = Array.isArray(prep?.supplies) ? prep.supplies : [];

  return (
    <div className="mt-3 space-y-4 rounded-md border border-border p-3">
      <h3 className="text-sm font-medium">{t('household.prepTitle')}</h3>

      <div>
        <p className="text-sm text-muted">{t('household.checklistLabel')}</p>
        <ul className="mt-1 space-y-1">
          {checklist.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!item.done}
                onChange={() => savePrep({ checklist: checklist.map((c) => (c.id === item.id ? { ...c, done: !c.done } : c)) })}
              />
              <span className={item.done ? 'line-through text-muted' : ''}>{item.label}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={checklistLabel}
            placeholder={t('household.addChecklistPlaceholder')}
            onChange={(e) => setChecklistLabel(e.target.value)}
          />
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm"
            onClick={() => {
              if (!checklistLabel.trim()) return;
              savePrep({ checklist: [...checklist, { id: crypto.randomUUID(), label: checklistLabel.trim(), done: false }] });
              setChecklistLabel('');
            }}
          >
            {t('household.addChecklistButton')}
          </button>
        </div>
      </div>

      <div>
        <p className="text-sm text-muted">{t('household.suppliesLabel')}</p>
        <ul className="mt-1 space-y-1 text-sm">
          {supplies.map((s, i) => (
            <li key={`${s.item}-${i}`}>{s.item}{s.quantity ? ` × ${s.quantity}` : ''}{s.note ? ` · ${s.note}` : ''}</li>
          ))}
        </ul>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <input
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={supplyForm.item}
            placeholder={t('household.supplyItemLabel')}
            onChange={(e) => setSupplyForm((p) => ({ ...p, item: e.target.value }))}
          />
          <input
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={supplyForm.quantity}
            placeholder={t('household.supplyQtyLabel')}
            onChange={(e) => setSupplyForm((p) => ({ ...p, quantity: e.target.value }))}
          />
          <input
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={supplyForm.note}
            placeholder={t('household.supplyNoteLabel')}
            onChange={(e) => setSupplyForm((p) => ({ ...p, note: e.target.value }))}
          />
        </div>
        <button
          type="button"
          className="mt-2 rounded-md border border-border px-3 py-1.5 text-sm"
          onClick={() => {
            if (!supplyForm.item.trim()) return;
            savePrep({ supplies: [...supplies, { item: supplyForm.item.trim(), quantity: supplyForm.quantity.trim(), note: supplyForm.note.trim() }] });
            setSupplyForm({ item: '', quantity: '', note: '' });
          }}
        >
          {t('household.addSupplyButton')}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-muted">{t('household.accessibilityLabel')}</span>
          <textarea
            rows={2}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={accessibilityNeeds}
            onChange={(e) => setAccessibilityNeeds(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">{t('household.arrivalInstructionsLabel')}</span>
          <textarea
            rows={2}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={arrivalInstructions}
            onChange={(e) => setArrivalInstructions(e.target.value)}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-sm"
          onClick={() => savePrep({ accessibilityNeeds, arrivalInstructions })}
        >
          {t('household.savePrep')}
        </button>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">{t('household.assigneeLabel')}</span>
          <select
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={assignee}
            onChange={(e) => { setAssignee(e.target.value); savePrep({ assignedDelegateUserId: e.target.value || null }); }}
          >
            <option value="">{t('household.noAssignee')}</option>
            {delegates.map((d) => (
              <option key={d.id} value={d.delegateUserId || ''}>{d.delegateName || d.delegateEmail}</option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <p className="text-sm text-muted">{t('household.availabilityTitle')}</p>
        {availability.length === 0 && <p className="mt-1 text-sm text-muted">{t('household.noAvailability')}</p>}
        <ul className="mt-1 space-y-1 text-sm">
          {availability.map((w, i) => (
            <li key={`${w.date}-${w.start}-${i}`}>{w.date} · {w.start}{w.end ? `-${w.end}` : ''}{w.note ? ` · ${w.note}` : ''}</li>
          ))}
        </ul>
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          <input type="date" className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={windowForm.date} onChange={(e) => setWindowForm((p) => ({ ...p, date: e.target.value }))} aria-label={t('household.availabilityDateLabel')} />
          <input type="time" className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={windowForm.start} onChange={(e) => setWindowForm((p) => ({ ...p, start: e.target.value }))} aria-label={t('household.availabilityStartLabel')} />
          <input type="time" className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={windowForm.end} onChange={(e) => setWindowForm((p) => ({ ...p, end: e.target.value }))} aria-label={t('household.availabilityEndLabel')} />
          <input className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={windowForm.note} placeholder={t('household.availabilityNoteLabel')} onChange={(e) => setWindowForm((p) => ({ ...p, note: e.target.value }))} />
        </div>
        <button
          type="button"
          className="mt-2 rounded-md border border-border px-3 py-1.5 text-sm"
          onClick={() => {
            if (!windowForm.date || !windowForm.start) return;
            post(`/household/visits/${bookingId}/availability`, { windows: [...availability, { date: windowForm.date, start: windowForm.start, end: windowForm.end || undefined, note: windowForm.note || undefined }] });
            setWindowForm({ date: '', start: '', end: '', note: '' });
          }}
        >
          {t('household.addAvailabilityButton')}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-muted">{t('household.shareSummaryLabel')}</span>
          <textarea
            rows={2}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">{t('household.replacementLabel')}</span>
          <input
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={replacementReason}
            onChange={(e) => setReplacementReason(e.target.value)}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-sm"
          disabled={!summary.trim()}
          onClick={() => post(`/household/visits/${bookingId}/summary`, { summary: summary.trim() }, () => setMessage(t('household.summarySaved')))}
        >
          {t('household.shareSummaryButton')}
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-sm"
          disabled={!replacementReason.trim()}
          onClick={() => post(`/household/visits/${bookingId}/replacement-request`, { reason: replacementReason.trim() }, () => setReplacementReason(''))}
        >
          {t('household.replacementButton')}
        </button>
        {!prep?.readinessConfirmedAt && (
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => post(`/household/visits/${bookingId}/prep/confirm-readiness`, {})}>
            {t('household.confirmReadiness')}
          </button>
        )}
        <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => post(`/household/visits/${bookingId}/remind`, {}, (d) => setMessage(d?.tooSoon ? t('household.remindedTooSoon') : t('household.remindedOk')))}>
          {t('household.remind')}
        </button>
        <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => post(`/household/visits/${bookingId}/supplies/remind`, {}, (d) => setMessage(d?.tooSoon ? t('household.remindedTooSoon') : t('household.remindedOk')))}>
          {t('household.remindSupplies')}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-sm text-muted">{t('household.missedFollowupLabel')}</p>
          <div className="mt-1 flex gap-2">
            <select className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={missedAction} onChange={(e) => setMissedAction(e.target.value)} aria-label={t('household.missedActionLabel')}>
              {['reschedule', 'replacement', 'note'].map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <input className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={missedNote} placeholder={t('household.missedNoteLabel')} onChange={(e) => setMissedNote(e.target.value)} />
            <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => post(`/household/visits/${bookingId}/missed-followup`, { action: missedAction, note: missedNote || undefined }, () => setMissedNote(''))}>
              {t('household.missedButton')}
            </button>
          </div>
        </div>
        <div>
          <p className="text-sm text-muted">{t('household.unavailableLabel')}</p>
          <div className="mt-1 flex gap-2">
            <input className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={unavailableReason} placeholder={t('household.unavailableLabel')} onChange={(e) => setUnavailableReason(e.target.value)} />
            <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" disabled={!unavailableReason.trim()} onClick={() => post(`/household/visits/${bookingId}/unavailable`, { reason: unavailableReason.trim() }, () => setUnavailableReason(''))}>
              {t('household.unavailableButton')}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => post(`/household/visits/${bookingId}/emergency-fallback`, {}, (d) => setEmergency(d))}>
          {t('household.emergencyButton')}
        </button>
        <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={async () => {
          setMessage('');
          try {
            const r = await api.get(`/household/visits/${bookingId}/cancellation-preview`);
            setCancellation(r.data);
          } catch (e) {
            onError(e?.response?.data?.error || t('household.actionFailed'));
          }
        }}>
          {t('household.cancellationPreviewButton')}
        </button>
      </div>
      {emergency && (
        <p className="text-sm">{t('household.emergencyContact')}: {emergency.contactName} · {emergency.status}</p>
      )}
      {cancellation && (
        <div className="text-sm text-muted">
          <p>{cancellation.note}</p>
          <p>{t('household.checklistProgress', { done: cancellation.impacts?.checklistDone || 0, total: cancellation.impacts?.checklistItems || 0 })}</p>
          <p>{t('household.cancellationSameDay', { count: (cancellation.impacts?.sameDayVisits || []).length })}</p>
          <p>{t('household.cancellationRecurring', { count: cancellation.impacts?.activeRecurringBookings || 0 })}</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-sm text-muted">{t('household.handoffPrepTitle')}</p>
          <div className="mt-1 flex gap-2">
            <select className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={handoffTo} onChange={(e) => setHandoffTo(e.target.value)} aria-label={t('household.handoffPrepTo')}>
              <option value="">{t('household.handoffPrepTo')}</option>
              {delegates.map((d) => (
                <option key={d.id} value={d.delegateUserId || ''}>{d.delegateName || d.delegateEmail}</option>
              ))}
            </select>
            <input className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={handoffNote} placeholder={t('household.handoffPrepNote')} onChange={(e) => setHandoffNote(e.target.value)} />
            <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" disabled={!handoffTo} onClick={() => post(`/household/visits/${bookingId}/prep/handoff`, { toDelegateUserId: handoffTo, note: handoffNote || undefined }, () => { setHandoffNote(''); setMessage(t('household.handoffDone')); })}>
              {t('household.handoffPrepButton')}
            </button>
          </div>
          {prep?.handoffNote && !prep?.handoffAcknowledgedAt && (
            <button type="button" className="mt-2 rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => post(`/household/visits/${bookingId}/prep/handoff-acknowledge`, {})}>
              {t('household.acknowledgeHandoff')}
            </button>
          )}
          {prep?.handoffAcknowledgedAt && <p className="mt-1 text-sm text-muted">{t('household.handoffAcknowledged')}</p>}
        </div>
        <div>
          <p className="text-sm text-muted">{t('household.reassignLabel')}</p>
          <div className="mt-1 flex gap-2">
            <select className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} aria-label={t('household.reassignLabel')}>
              <option value="">{t('household.reassignLabel')}</option>
              {delegates.map((d) => (
                <option key={d.id} value={d.delegateUserId || ''}>{d.delegateName || d.delegateEmail}</option>
              ))}
            </select>
            <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" disabled={!reassignTo} onClick={() => post('/household/visits/reassign', { bookingIds: [bookingId], toDelegateUserId: reassignTo }, () => setReassignTo(''))}>
              {t('household.reassignButton')}
            </button>
          </div>
        </div>
      </div>

      {message && <p className="text-sm text-muted">{message}</p>}
    </div>
  );
}

export default function HouseholdPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite');
  const [tab, setTab] = useState('delegations');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [loadErrors, setLoadErrors] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // Item 61: '' is the viewer's own household; otherwise the ownerId of a
  // household the viewer holds a delegation for.
  const [context, setContext] = useState('');
  const [heldDelegations, setHeldDelegations] = useState([]);
  const [delegations, setDelegations] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [visits, setVisits] = useState([]);
  const [addresses, setAddresses] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [triage, setTriage] = useState(null);
  const [approvals, setApprovals] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [activity, setActivity] = useState({});
  const [preview, setPreview] = useState({});
  const [receipts, setReceipts] = useState({});
  const [taskHistory, setTaskHistory] = useState(null);
  const [rowMessage, setRowMessage] = useState({});
  const [invite, setInvite] = useState({ email: '', scopes: ['book', 'schedule'], isCoordinator: false });
  const [contactForm, setContactForm] = useState({ name: '', phone: '', relationship: '', role: 'alternate', isEmergency: false });
  const [templateForm, setTemplateForm] = useState({ name: '', serviceName: '', frequency: 'weekly' });
  const [taskForm, setTaskForm] = useState({ kind: 'household', title: '', dueDate: '', vehicleId: '', recurrenceDays: '', notes: '' });
  const [approvalForm, setApprovalForm] = useState({ amountDollars: '', bookingId: '', reason: '' });
  const [documentForm, setDocumentForm] = useState({ kind: 'document', title: '', body: '' });
  const [subForm, setSubForm] = useState({});
  const [handoffForm, setHandoffForm] = useState({});
  const [forwardTargets, setForwardTargets] = useState({});
  const [calHandoff, setCalHandoff] = useState({ fromDelegationId: '', toDelegationId: '', note: '' });
  const [openPrep, setOpenPrep] = useState(null);

  const isOwnerView = context === '';
  const acceptedDelegations = delegations.filter((d) => d.status === 'accepted');
  const heldAccepted = heldDelegations.filter((d) => d.status === 'accepted');
  const selectedHeld = heldDelegations.find((d) => d.ownerId === context);

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    const params = context ? { ownerId: context } : {};
    const calls = [
      ['delegations', api.get('/household/delegations')],
      ['invitations', api.get('/household/invitations')],
      ['calendar', api.get('/household/calendar', { params })],
      ['addresses', api.get('/household/addresses', { params })],
      ['contacts', api.get('/household/contacts', { params })],
      ['templates', api.get('/household/templates', { params })],
      ['triage', api.get('/household/tasks/triage', { params })],
      ['approvals', api.get('/household/spending-approvals', { params })],
      ['documents', api.get('/household/documents', { params })],
      ['held', api.get('/household/delegations', { params: { role: 'delegate' } })],
    ];
    // R64: one failing section no longer blanks the page; each result
    // lands on its own, and failures are reported with a retry.
    Promise.allSettled(calls.map(([, p]) => p))
      .then((results) => {
        const failedKeys = [];
        results.forEach((result, i) => {
          const key = calls[i][0];
          if (result.status !== 'fulfilled') { failedKeys.push(key); return; }
          const data = result.value.data || {};
          if (key === 'delegations') setDelegations(Array.isArray(data.delegations) ? data.delegations : []);
          if (key === 'invitations') setInvitations(Array.isArray(data.invitations) ? data.invitations : []);
          if (key === 'calendar') setVisits(Array.isArray(data.visits) ? data.visits : []);
          if (key === 'addresses') setAddresses(Array.isArray(data.addresses) ? data.addresses : []);
          if (key === 'contacts') setContacts(Array.isArray(data.contacts) ? data.contacts : []);
          if (key === 'templates') setTemplates(Array.isArray(data.templates) ? data.templates : []);
          if (key === 'triage') setTriage(data || null);
          if (key === 'approvals') setApprovals(Array.isArray(data.approvals) ? data.approvals : []);
          if (key === 'documents') setDocuments(Array.isArray(data.documents) ? data.documents : []);
          if (key === 'held') setHeldDelegations(Array.isArray(data.delegations) ? data.delegations : []);
        });
        setLoadErrors(failedKeys);
        setFailed(failedKeys.length > 0);
      })
      .finally(() => setLoading(false));
  }, [context]);

  useEffect(load, [load]);

  function switchContext(next) {
    setContext(next);
    // Drop the previous household's rows so they never flash as the new one.
    setVisits([]); setAddresses([]); setContacts([]); setTemplates([]);
    setTriage(null); setApprovals([]); setDocuments([]); setOpenPrep(null);
  }

  async function act(promise, onDone) {
    setError('');
    setNotice('');
    try {
      await promise;
      if (onDone) onDone();
      load();
    } catch (e) {
      setError(e?.response?.data?.error || t('household.actionFailed'));
    }
  }

  function toggleScope(scope) {
    setInvite((prev) => ({
      ...prev,
      scopes: prev.scopes.includes(scope)
        ? prev.scopes.filter((s) => s !== scope)
        : [...prev.scopes, scope],
    }));
  }

  function downloadExport() {
    const params = context ? { ownerId: context } : {};
    api.get('/household/history-export', { params })
      .then((r) => {
        const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'household-history.json';
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => setError(t('household.actionFailed')));
  }

  async function remindDelegationRow(id) {
    setError('');
    try {
      const r = await api.post(`/household/delegations/${id}/remind`);
      setRowMessage((m) => ({ ...m, [id]: r.data?.tooSoon ? t('household.remindedTooSoon') : t('household.remindedOk') }));
    } catch (e) {
      setError(e?.response?.data?.error || t('household.actionFailed'));
    }
  }

  async function useTemplate(tpl) {
    setError('');
    try {
      const r = await api.get(`/household/templates/${tpl.id}/prefill`);
      const prefill = r.data?.prefill;
      if (!prefill) { setError(t('household.actionFailed')); return; }
      sessionStorage.setItem(TEMPLATE_PREFILL_KEY, JSON.stringify(prefill));
      navigate('/helpers');
    } catch (e) {
      setError(e?.response?.data?.error || t('household.actionFailed'));
    }
  }

  function toggleForwardTarget(docId, delegationId) {
    setForwardTargets((prev) => {
      const current = prev[docId] || [];
      return {
        ...prev,
        [docId]: current.includes(delegationId)
          ? current.filter((id) => id !== delegationId)
          : [...current, delegationId],
      };
    });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{t('household.title')}</h1>
            <p className="mt-1 text-sm text-muted">{t('household.subtitle')}</p>
          </div>
          <button type="button" className="rounded-md border border-border px-3 py-2 text-sm" onClick={downloadExport}>
            {t('household.exportButton')}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="text-sm text-muted" htmlFor="household-context">{t('household.contextLabel')}</label>
          <select
            id="household-context"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={context}
            onChange={(e) => switchContext(e.target.value)}
          >
            <option value="">{t('household.myHousehold')}</option>
            {heldAccepted.map((d) => (
              <option key={d.id} value={d.ownerId}>
                {d.ownerName || d.ownerId} · {(d.scopes || []).map((s) => t(`household.scopes.${s}`)).join(', ')}
              </option>
            ))}
          </select>
        </div>

        {inviteToken && (
          <div className="mt-4 rounded-md border border-border bg-surface p-4">
            <p className="text-sm font-medium">{t('household.inviteBannerTitle')}</p>
            <button
              type="button"
              className="mt-2 rounded-md bg-accent px-4 py-2 text-sm text-on-accent"
              onClick={() => act(api.post('/household/delegations/accept-by-token', { token: inviteToken }), () => setSearchParams({}))}
            >
              {t('household.inviteBannerAccept')}
            </button>
          </div>
        )}

        {loading && <p className="mt-6 text-sm text-muted">{t('household.loading')}</p>}
        {failed && (
          <p className="mt-6 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {t('household.partialLoadFailed')}{' '}
            <button type="button" className="underline" onClick={load}>{t('household.retry')}</button>
            {loadErrors.length > 0 && <span className="text-muted"> ({loadErrors.join(', ')})</span>}
          </p>
        )}
        {error && (
          <p className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
        {notice && (
          <p className="mt-4 rounded-md border border-border bg-surface px-3 py-2 text-sm">{notice}</p>
        )}

        <div className="mt-6 flex flex-wrap gap-2" role="tablist">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              className={`rounded-full border px-3 py-1.5 text-sm ${tab === name ? 'border-border bg-surface text-foreground' : 'border-border text-muted'}`}
              onClick={() => setTab(name)}
            >
              {t(`household.tabs.${name}`)}
            </button>
          ))}
        </div>

        {tab === 'delegations' && (
          <section className="mt-6 space-y-6">
            {isOwnerView && (
              <div className="rounded-lg border border-border bg-surface p-4">
                <h2 className="text-lg font-medium">{t('household.inviteTitle')}</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="text-muted">{t('household.emailLabel')}</span>
                    <input
                      className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
                      value={invite.email}
                      placeholder={t('household.emailPlaceholder')}
                      onChange={(e) => setInvite((p) => ({ ...p, email: e.target.value }))}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={invite.isCoordinator}
                      onChange={(e) => setInvite((p) => ({ ...p, isCoordinator: e.target.checked }))}
                    />
                    {t('household.coordinatorLabel')}
                  </label>
                </div>
                <fieldset className="mt-3">
                  <legend className="text-sm text-muted">{t('household.scopesLabel')}</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {SCOPES.map((scope) => (
                      <label key={scope} className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm">
                        <input type="checkbox" checked={invite.scopes.includes(scope)} onChange={() => toggleScope(scope)} />
                        {t(`household.scopes.${scope}`)}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="mt-3 space-y-1 text-sm text-muted">
                  {invite.scopes.map((scope) => (
                    <div key={scope}>
                      <span className="font-medium text-foreground">{t(`household.scopes.${scope}`)}</span>
                      <ul className="ms-4 list-disc">
                        {scopeGrants(scope, t).map((g) => (<li key={g}>{g}</li>))}
                      </ul>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="mt-4 rounded-md bg-accent px-4 py-2 text-sm text-on-accent"
                  onClick={() => act(api.post('/household/delegations', {
                    delegateEmail: invite.email,
                    scopes: invite.scopes,
                    isCoordinator: invite.isCoordinator,
                  }), () => setInvite({ email: '', scopes: ['book', 'schedule'], isCoordinator: false }))}
                >
                  {t('household.inviteButton')}
                </button>
              </div>
            )}

            {invitations.length > 0 && (
              <div className="rounded-lg border border-border bg-surface p-4">
                <h2 className="text-lg font-medium">{t('household.invitationsTitle')}</h2>
                <ul className="mt-3 space-y-3">
                  {invitations.map((inv) => (
                    <li key={inv.id} className="rounded-md border border-border p-3">
                      <p className="text-sm font-medium">{inv.ownerName || inv.delegateEmail}</p>
                      <ul className="mt-2 space-y-2 text-sm text-muted">
                        {(inv.scopePreview || []).map((s) => (
                          <li key={s.scope}>
                            <span className="font-medium text-foreground">{t(`household.scopes.${s.scope}`)}</span>
                            <ul className="ms-4 list-disc">
                              {scopeGrants(s.scope, t).map((g) => (<li key={g}>{g}</li>))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2 flex gap-2">
                        <button type="button" className="rounded-md bg-accent px-3 py-1.5 text-sm text-on-accent" onClick={() => act(api.post(`/household/delegations/${inv.id}/accept`))}>
                          {t('household.accept')}
                        </button>
                        <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => act(api.post(`/household/delegations/${inv.id}/decline`))}>
                          {t('household.decline')}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!isOwnerView && selectedHeld && (
              <div className="rounded-lg border border-border bg-surface p-4">
                <h2 className="text-lg font-medium">{t('household.yourDelegationTitle')}</h2>
                <p className="mt-2 text-sm">
                  {selectedHeld.ownerName || selectedHeld.ownerId} · {(selectedHeld.scopes || []).map((s) => t(`household.scopes.${s}`)).join(', ')}
                  {selectedHeld.daysToExpiry !== null && selectedHeld.status === 'accepted' ? ` · ${t('household.daysLeft', { count: selectedHeld.daysToExpiry })}` : ''}
                  {selectedHeld.expiresSoon ? ` · ${t('household.expiresSoon')}` : ''}
                </p>
                <ul className="mt-2 space-y-1 text-sm text-muted">
                  {(selectedHeld.scopes || []).map((scope) => (
                    <li key={scope}>
                      <span className="font-medium text-foreground">{t(`household.scopes.${scope}`)}</span>
                      <ul className="ms-4 list-disc">
                        {scopeGrants(scope, t).map((g) => (<li key={g}>{g}</li>))}
                      </ul>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedHeld.status === 'accepted' && (
                    <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => remindDelegationRow(selectedHeld.id)}>
                      {t('household.remindDelegation')}
                    </button>
                  )}
                  {selectedHeld.handoffNote && !selectedHeld.handoffAcknowledgedAt && (
                    <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => act(api.post(`/household/delegations/${selectedHeld.id}/handoff-acknowledge`))}>
                      {t('household.acknowledgeHandoff')}
                    </button>
                  )}
                  {(selectedHeld.status === 'revoked' || selectedHeld.status === 'expired' || selectedHeld.status === 'closed') && (
                    <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => {
                      if (receipts[selectedHeld.id]) { setReceipts((r) => ({ ...r, [selectedHeld.id]: null })); return; }
                      api.get(`/household/delegations/${selectedHeld.id}/closure-receipt`).then((r) => setReceipts((prev) => ({ ...prev, [selectedHeld.id]: r.data.receipt }))).catch(() => setError(t('household.actionFailed')));
                    }}>
                      {t('household.viewReceipt')}
                    </button>
                  )}
                </div>
                {rowMessage[selectedHeld.id] && <p className="mt-2 text-sm text-muted">{rowMessage[selectedHeld.id]}</p>}
                {receipts[selectedHeld.id] && (
                  <div className="mt-2 text-sm text-muted">
                    <p>{t('household.receiptReason')}: {receipts[selectedHeld.id].reason || ''}</p>
                    {receipts[selectedHeld.id].upcomingVisitsReassigned && (
                      <p>{t('household.receiptReassigned', { count: receipts[selectedHeld.id].upcomingVisitsReassigned.count || 0 })}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {isOwnerView && (
              <div className="rounded-lg border border-border bg-surface p-4">
                <h2 className="text-lg font-medium">{t('household.delegationsTitle')}</h2>
                {delegations.length === 0 && <p className="mt-2 text-sm text-muted">{t('household.noDelegations')}</p>}
                <ul className="mt-3 space-y-3">
                  {delegations.map((d) => (
                    <li key={d.id} className="rounded-md border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">{d.delegateName || d.delegateEmail}</p>
                        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
                          {d.status}
                          {d.isCoordinator ? ` · ${t('household.coordinatorBadge')}` : ''}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-muted">
                        {(d.scopes || []).map((s) => t(`household.scopes.${s}`)).join(', ')}
                        {d.daysToExpiry !== null && d.status === 'accepted' ? ` · ${t('household.daysLeft', { count: d.daysToExpiry })}` : ''}
                        {d.expiresSoon ? ` · ${t('household.expiresSoon')}` : ''}
                      </p>
                      {preview[d.id] && (
                        <div className="mt-2 space-y-1 text-sm text-muted">
                          {preview[d.id].scopes.map((s) => (
                            <div key={s.scope}>
                              <span className="font-medium text-foreground">{t(`household.scopes.${s.scope}`)}</span>
                              <ul className="ms-4 list-disc">
                                {scopeGrants(s.scope, t).map((g) => (<li key={g}>{g}</li>))}
                              </ul>
                            </div>
                          ))}
                          <p>{t('household.neverGranted')}</p>
                        </div>
                      )}
                      {activity[d.id] && (
                        <ul className="mt-2 space-y-1 text-sm text-muted">
                          {activity[d.id].map((a) => (
                            <li key={a.id}>{a.action} · {new Date(a.created_at).toLocaleString()}</li>
                          ))}
                        </ul>
                      )}
                      {receipts[d.id] && (
                        <div className="mt-2 text-sm text-muted">
                          <p>{t('household.receiptReason')}: {receipts[d.id].reason || ''}</p>
                          {receipts[d.id].upcomingVisitsReassigned && (
                            <p>{t('household.receiptReassigned', { count: receipts[d.id].upcomingVisitsReassigned.count || 0 })}</p>
                          )}
                          {(receipts[d.id].scopesHeld || []).length > 0 && (
                            <p>{t('household.receiptScopes')}: {receipts[d.id].scopesHeld.join(', ')}</p>
                          )}
                        </div>
                      )}
                      {rowMessage[d.id] && <p className="mt-2 text-sm text-muted">{rowMessage[d.id]}</p>}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => {
                          if (preview[d.id]) { setPreview((p) => ({ ...p, [d.id]: null })); return; }
                          api.get(`/household/delegations/${d.id}/scope-preview`).then((r) => setPreview((p) => ({ ...p, [d.id]: r.data }))).catch(() => setError(t('household.actionFailed')));
                        }}>
                          {t('household.scopePreview')}
                        </button>
                        <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => {
                          if (activity[d.id]) { setActivity((p) => ({ ...p, [d.id]: null })); return; }
                          api.get(`/household/delegations/${d.id}/activity`).then((r) => setActivity((p) => ({ ...p, [d.id]: r.data.activity }))).catch(() => setError(t('household.actionFailed')));
                        }}>
                          {t('household.viewActivity')}
                        </button>
                        {d.status === 'accepted' && (
                          <>
                            <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => act(api.post(`/household/delegations/${d.id}/renew`))}>
                              {t('household.renew')}
                            </button>
                            <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => remindDelegationRow(d.id)}>
                              {t('household.remindDelegation')}
                            </button>
                            <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => act(api.post(`/household/delegations/${d.id}/coordinator`, { isCoordinator: true }))}>
                              {t('household.makeCoordinator')}
                            </button>
                            <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => act(api.post(`/household/delegations/${d.id}/revoke`, { reason: t('household.revokeReason') }))}>
                              {t('household.revoke')}
                            </button>
                          </>
                        )}
                        {(d.status === 'revoked' || d.status === 'expired' || d.status === 'closed') && (
                          <>
                            <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => act(api.post(`/household/delegations/${d.id}/reinvite`, {}))}>
                              {t('household.reinvite')}
                            </button>
                            <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => {
                              if (receipts[d.id]) { setReceipts((r) => ({ ...r, [d.id]: null })); return; }
                              api.get(`/household/delegations/${d.id}/closure-receipt`).then((r) => setReceipts((prev) => ({ ...prev, [d.id]: r.data.receipt }))).catch(() => setError(t('household.actionFailed')));
                            }}>
                              {t('household.viewReceipt')}
                            </button>
                          </>
                        )}
                      </div>
                      {d.status === 'accepted' && (
                        <div className="mt-3 space-y-3 border-t border-border pt-3">
                          <div>
                            <p className="text-sm text-muted">{t('household.substituteTitle')}</p>
                            <div className="mt-1 flex flex-wrap gap-2">
                              <input
                                type="date"
                                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                                value={subForm[d.id]?.until || ''}
                                onChange={(e) => setSubForm((p) => ({ ...p, [d.id]: { ...p[d.id], until: e.target.value } }))}
                                aria-label={t('household.substituteUntilLabel')}
                              />
                              <input
                                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                                value={subForm[d.id]?.note || ''}
                                placeholder={t('household.substituteNoteLabel')}
                                onChange={(e) => setSubForm((p) => ({ ...p, [d.id]: { ...p[d.id], note: e.target.value } }))}
                              />
                              <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => act(api.post(`/household/delegations/${d.id}/substitute`, { until: subForm[d.id]?.until || undefined, note: subForm[d.id]?.note || undefined }))}>
                                {t('household.setSubstitute')}
                              </button>
                            </div>
                          </div>
                          <div>
                            <p className="text-sm text-muted">{t('household.handoffTitle')}</p>
                            <div className="mt-1 flex flex-wrap gap-2">
                              <select
                                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                                value={handoffForm[d.id]?.toDelegationId || ''}
                                onChange={(e) => setHandoffForm((p) => ({ ...p, [d.id]: { ...p[d.id], toDelegationId: e.target.value } }))}
                                aria-label={t('household.handoffToLabel')}
                              >
                                <option value="">{t('household.handoffToLabel')}</option>
                                {acceptedDelegations.filter((x) => x.id !== d.id).map((x) => (
                                  <option key={x.id} value={x.id}>{x.delegateName || x.delegateEmail}</option>
                                ))}
                              </select>
                              <input
                                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                                value={handoffForm[d.id]?.note || ''}
                                placeholder={t('household.handoffNoteLabel')}
                                onChange={(e) => setHandoffForm((p) => ({ ...p, [d.id]: { ...p[d.id], note: e.target.value } }))}
                              />
                              <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" disabled={!handoffForm[d.id]?.toDelegationId} onClick={() => act(api.post(`/household/delegations/${d.id}/handoff`, { toDelegationId: handoffForm[d.id].toDelegationId, note: handoffForm[d.id].note || undefined }))}>
                                {t('household.handoffButton')}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {isOwnerView && acceptedDelegations.length > 1 && (
              <div className="rounded-lg border border-border bg-surface p-4">
                <h2 className="text-lg font-medium">{t('household.handoffCalendarTitle')}</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <label className="block text-sm">
                    <span className="text-muted">{t('household.handoffCalendarFrom')}</span>
                    <select className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" value={calHandoff.fromDelegationId} onChange={(e) => setCalHandoff((p) => ({ ...p, fromDelegationId: e.target.value }))}>
                      <option value="">{t('household.handoffCalendarFrom')}</option>
                      {acceptedDelegations.map((x) => (
                        <option key={x.id} value={x.id}>{x.delegateName || x.delegateEmail}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="text-muted">{t('household.handoffCalendarTo')}</span>
                    <select className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" value={calHandoff.toDelegationId} onChange={(e) => setCalHandoff((p) => ({ ...p, toDelegationId: e.target.value }))}>
                      <option value="">{t('household.handoffCalendarTo')}</option>
                      {acceptedDelegations.map((x) => (
                        <option key={x.id} value={x.id}>{x.delegateName || x.delegateEmail}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="text-muted">{t('household.handoffNoteLabel')}</span>
                    <input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" value={calHandoff.note} onChange={(e) => setCalHandoff((p) => ({ ...p, note: e.target.value }))} />
                  </label>
                </div>
                <button
                  type="button"
                  className="mt-4 rounded-md bg-accent px-4 py-2 text-sm text-on-accent"
                  disabled={!calHandoff.fromDelegationId || !calHandoff.toDelegationId}
                  onClick={() => act(api.post('/household/calendar/handoff', calHandoff), () => setCalHandoff({ fromDelegationId: '', toDelegationId: '', note: '' }))}
                >
                  {t('household.handoffCalendarButton')}
                </button>
              </div>
            )}
          </section>
        )}

        {tab === 'calendar' && (
          <section className="mt-6 rounded-lg border border-border bg-surface p-4">
            <h2 className="text-lg font-medium">{t('household.calendarTitle')}</h2>
            {visits.length === 0 && <p className="mt-2 text-sm text-muted">{t('household.noVisits')}</p>}
            <ul className="mt-3 space-y-3">
              {visits.map((v) => (
                <li key={v.bookingId} className="rounded-md border border-border p-3">
                  <p className="text-sm font-medium">{v.serviceName}</p>
                  <p className="mt-1 text-sm text-muted">
                    {v.requestedDate} · {v.requestedStartTime || ''}{v.requestedEndTime ? `-${v.requestedEndTime}` : ''} · {v.serviceLocation || ''}
                  </p>
                  {v.ownershipLabel && <p className="mt-1 text-sm">{v.ownershipLabel}</p>}
                  <p className="mt-1 text-sm text-muted">
                    {t('household.checklistProgress', { done: v.checklistDone, total: v.checklistTotal })}
                    {v.readinessConfirmedAt ? ` · ${t('household.readinessConfirmed')}` : ''}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => setOpenPrep((cur) => (cur === v.bookingId ? null : v.bookingId))}>
                      {t('household.prepareButton')}
                    </button>
                    {!v.readinessConfirmedAt && (
                      <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => act(api.post(`/household/visits/${v.bookingId}/prep/confirm-readiness`))}>
                        {t('household.confirmReadiness')}
                      </button>
                    )}
                    <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => act(api.post(`/household/visits/${v.bookingId}/remind`))}>
                      {t('household.remind')}
                    </button>
                  </div>
                  {openPrep === v.bookingId && (
                    <PrepPanel bookingId={v.bookingId} delegates={acceptedDelegations} onError={setError} />
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === 'addresses' && (
          <section className="mt-6 rounded-lg border border-border bg-surface p-4">
            <h2 className="text-lg font-medium">{t('household.addressesTitle')}</h2>
            <p className="mt-1 text-sm text-muted">
              <Link className="underline" to="/settings/locations">{t('household.manageInSettings')}</Link>
            </p>
            {addresses.length === 0 && <p className="mt-2 text-sm text-muted">{t('household.noAddresses')}</p>}
            <ul className="mt-3 space-y-3">
              {addresses.map((a) => (
                <li key={a.id} className="rounded-md border border-border p-3">
                  <p className="text-sm font-medium">{a.label}</p>
                  <p className="mt-1 text-sm text-muted">{a.address}</p>
                  {a.entry_preset && <p className="mt-1 text-sm text-muted">{t('household.entryPreset')}: {t(`household.entryPresets.${a.entry_preset}`)}</p>}
                  {a.entry_instructions && <p className="mt-1 text-sm">{a.entry_instructions}</p>}
                  {a.shared_with_household && <p className="mt-1 text-sm text-muted">{t('household.sharedAddress')}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === 'contacts' && (
          <section className="mt-6 space-y-6">
            {isOwnerView && (
              <div className="rounded-lg border border-border bg-surface p-4">
                <h2 className="text-lg font-medium">{t('household.contactsTitle')}</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="text-muted">{t('household.nameLabel')}</span>
                    <input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" value={contactForm.name} onChange={(e) => setContactForm((p) => ({ ...p, name: e.target.value }))} />
                  </label>
                  <label className="block text-sm">
                    <span className="text-muted">{t('household.phoneLabel')}</span>
                    <input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" value={contactForm.phone} onChange={(e) => setContactForm((p) => ({ ...p, phone: e.target.value }))} />
                  </label>
                  <label className="block text-sm">
                    <span className="text-muted">{t('household.relationshipLabel')}</span>
                    <input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" value={contactForm.relationship} onChange={(e) => setContactForm((p) => ({ ...p, relationship: e.target.value }))} />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={contactForm.isEmergency} onChange={(e) => setContactForm((p) => ({ ...p, isEmergency: e.target.checked }))} />
                    {t('household.emergencyLabel')}
                  </label>
                </div>
                <button type="button" className="mt-4 rounded-md bg-accent px-4 py-2 text-sm text-on-accent" onClick={() => act(api.post('/household/contacts', contactForm), () => setContactForm({ name: '', phone: '', relationship: '', role: 'alternate', isEmergency: false }))}>
                  {t('household.addContact')}
                </button>
              </div>
            )}
            <div className="rounded-lg border border-border bg-surface p-4">
              {contacts.length === 0 && <p className="text-sm text-muted">{t('household.noContacts')}</p>}
              <ul className="space-y-3">
                {contacts.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
                    <p className="text-sm">
                      <span className="font-medium">{c.name}</span>
                      {c.phone ? ` · ${c.phone}` : ''}
                      {c.relationship ? ` · ${c.relationship}` : ''}
                      {c.is_emergency ? ` · ${t('household.emergencyBadge')}` : ''}
                    </p>
                    {isOwnerView && (
                      <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => act(api.post(`/household/contacts/${c.id}/archive`))}>
                        {t('household.archive')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {tab === 'templates' && (
          <section className="mt-6 space-y-6">
            {isOwnerView && (
              <div className="rounded-lg border border-border bg-surface p-4">
                <h2 className="text-lg font-medium">{t('household.templatesTitle')}</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <label className="block text-sm">
                    <span className="text-muted">{t('household.templateNameLabel')}</span>
                    <input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" value={templateForm.name} onChange={(e) => setTemplateForm((p) => ({ ...p, name: e.target.value }))} />
                  </label>
                  <label className="block text-sm">
                    <span className="text-muted">{t('household.serviceLabel')}</span>
                    <input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" value={templateForm.serviceName} onChange={(e) => setTemplateForm((p) => ({ ...p, serviceName: e.target.value }))} />
                  </label>
                  <label className="block text-sm">
                    <span className="text-muted">{t('household.frequencyLabel')}</span>
                    <select className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" value={templateForm.frequency} onChange={(e) => setTemplateForm((p) => ({ ...p, frequency: e.target.value }))}>
                      {['weekly', 'biweekly', 'monthly', 'quarterly'].map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <button type="button" className="mt-4 rounded-md bg-accent px-4 py-2 text-sm text-on-accent" onClick={() => act(api.post('/household/templates', { ...templateForm, ownerId: context || undefined }), () => setTemplateForm({ name: '', serviceName: '', frequency: 'weekly' }))}>
                  {t('household.addTemplate')}
                </button>
              </div>
            )}
            <div className="rounded-lg border border-border bg-surface p-4">
              {templates.length === 0 && <p className="text-sm text-muted">{t('household.noTemplates')}</p>}
              <ul className="space-y-3">
                {templates.map((tpl) => (
                  <li key={tpl.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
                    <p className="text-sm"><span className="font-medium">{tpl.name}</span> · {tpl.service_name} · {tpl.frequency}</p>
                    <div className="flex gap-2">
                      <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => useTemplate(tpl)}>
                        {t('household.useTemplate')}
                      </button>
                      {isOwnerView && (
                        <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => act(api.delete(`/household/templates/${tpl.id}`))}>
                          {t('household.delete')}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {tab === 'tasks' && (
          <section className="mt-6 space-y-6">
            <div className="rounded-lg border border-border bg-surface p-4">
              <h2 className="text-lg font-medium">{t('household.tasksTitle')}</h2>
              {triage && (
                <p className="mt-1 text-sm text-muted">
                  {t('household.overdue')}: {triage.counts.overdue} · {t('household.dueSoon')}: {triage.counts.dueSoon} · {t('household.upcoming')}: {triage.counts.upcoming}
                </p>
              )}
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <label className="block text-sm">
                  <span className="text-muted">{t('household.kindLabel')}</span>
                  <select className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" value={taskForm.kind} onChange={(e) => setTaskForm((p) => ({ ...p, kind: e.target.value }))}>
                    {['vehicle', 'household', 'personal_care'].map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="text-muted">{t('household.taskTitleLabel')}</span>
                  <input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" value={taskForm.title} onChange={(e) => setTaskForm((p) => ({ ...p, title: e.target.value }))} />
                </label>
                <label className="block text-sm">
                  <span className="text-muted">{t('household.dueLabel')}</span>
                  <input type="date" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" value={taskForm.dueDate} onChange={(e) => setTaskForm((p) => ({ ...p, dueDate: e.target.value }))} />
                </label>
                <label className="block text-sm">
                  <span className="text-muted">{t('household.vehicleLabel')}</span>
                  <input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" value={taskForm.vehicleId} placeholder="UUID" onChange={(e) => setTaskForm((p) => ({ ...p, vehicleId: e.target.value }))} />
                </label>
                <label className="block text-sm">
                  <span className="text-muted">{t('household.recurrenceLabel')}</span>
                  <input type="number" min="1" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" value={taskForm.recurrenceDays} onChange={(e) => setTaskForm((p) => ({ ...p, recurrenceDays: e.target.value }))} />
                </label>
                <label className="block text-sm">
                  <span className="text-muted">{t('household.notesLabel')}</span>
                  <input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" value={taskForm.notes} onChange={(e) => setTaskForm((p) => ({ ...p, notes: e.target.value }))} />
                </label>
              </div>
              <button type="button" className="mt-4 rounded-md bg-accent px-4 py-2 text-sm text-on-accent" onClick={() => act(api.post('/household/tasks', {
                kind: taskForm.kind,
                title: taskForm.title,
                dueDate: taskForm.dueDate || undefined,
                vehicleId: taskForm.vehicleId || undefined,
                recurrenceDays: taskForm.recurrenceDays ? Number(taskForm.recurrenceDays) : undefined,
                notes: taskForm.notes || undefined,
                ownerId: context || undefined,
              }), () => setTaskForm({ kind: 'household', title: '', dueDate: '', vehicleId: '', recurrenceDays: '', notes: '' }))}>
                {t('household.addTask')}
              </button>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              {(!triage || (triage.overdue.length + triage.dueSoon.length + triage.upcoming.length) === 0) && (
                <p className="text-sm text-muted">{t('household.noTasks')}</p>
              )}
              <ul className="space-y-3">
                {[...(triage?.overdue || []), ...(triage?.dueSoon || []), ...(triage?.upcoming || [])].map((task) => (
                  <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
                    <p className="text-sm">
                      <span className="font-medium">{task.title}</span> · {task.kind}
                      {task.dueDate ? ` · ${task.dueDate}` : ''}
                      {task.overdue ? ` · ${t('household.overdue')}` : ''}
                      {task.dueSoon ? ` · ${t('household.dueSoon')}` : ''}
                      {task.recurrenceDays ? ` · ${t('household.recurrenceLabel')}: ${task.recurrenceDays}` : ''}
                    </p>
                    <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => act(api.post(`/household/tasks/${task.id}/complete`))}>
                      {t('household.complete')}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-4">
                <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => {
                  const params = context ? { ownerId: context } : {};
                  api.get('/household/tasks/history', { params }).then((r) => setTaskHistory(Array.isArray(r.data?.history) ? r.data.history : [])).catch(() => setError(t('household.actionFailed')));
                }}>
                  {t('household.viewHistory')}
                </button>
                {taskHistory && (
                  <ul className="mt-3 space-y-2">
                    {taskHistory.length === 0 && <li className="text-sm text-muted">{t('household.noTasks')}</li>}
                    {taskHistory.map((task) => (
                      <li key={task.id} className="rounded-md border border-border p-3 text-sm">
                        <span className="font-medium">{task.title}</span> · {task.kind} · {task.status}
                        {task.completedAt ? ` · ${new Date(task.completedAt).toLocaleString()}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        )}

        {tab === 'approvals' && (
          <section className="mt-6 space-y-6">
            <div className="rounded-lg border border-border bg-surface p-4">
              <h2 className="text-lg font-medium">{t('household.approvalsTitle')}</h2>
              <p className="mt-1 text-sm text-muted">{t('household.approvalsNote')}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <label className="block text-sm">
                  <span className="text-muted">{t('household.amountDollarsLabel')}</span>
                  <input type="number" min="0" step="0.01" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" value={approvalForm.amountDollars} placeholder="75.00" onChange={(e) => setApprovalForm((p) => ({ ...p, amountDollars: e.target.value }))} />
                </label>
                <label className="block text-sm">
                  <span className="text-muted">{t('household.bookingLabel')}</span>
                  <select className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" value={approvalForm.bookingId} onChange={(e) => setApprovalForm((p) => ({ ...p, bookingId: e.target.value }))}>
                    <option value="">{t('household.noBooking')}</option>
                    {visits.map((v) => (
                      <option key={v.bookingId} value={v.bookingId}>{v.serviceName} · {v.requestedDate}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="text-muted">{t('household.reasonLabel')}</span>
                  <input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" value={approvalForm.reason} onChange={(e) => setApprovalForm((p) => ({ ...p, reason: e.target.value }))} />
                </label>
              </div>
              <button type="button" className="mt-4 rounded-md bg-accent px-4 py-2 text-sm text-on-accent" onClick={() => {
                const cents = Math.round(Number(approvalForm.amountDollars) * 100);
                if (!Number.isFinite(cents) || cents <= 0) { setError(t('household.amountInvalid')); return; }
                act(api.post('/household/spending-approvals', {
                  amountCents: cents,
                  reason: approvalForm.reason,
                  bookingId: approvalForm.bookingId || undefined,
                  ownerId: context || undefined,
                }), () => setApprovalForm({ amountDollars: '', bookingId: '', reason: '' }));
              }}>
                {t('household.requestApproval')}
              </button>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              {approvals.length === 0 && <p className="text-sm text-muted">{t('household.noApprovals')}</p>}
              <ul className="space-y-3">
                {approvals.map((a) => (
                  <li key={a.id} className="rounded-md border border-border p-3">
                    <p className="text-sm">{a.reason} · {(a.amount_cents / 100).toFixed(2)} {a.currency} · {a.status}</p>
                    {a.status === 'pending' && isOwnerView && (
                      <div className="mt-2 flex gap-2">
                        <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => act(api.post(`/household/spending-approvals/${a.id}/decide`, { decision: 'approved' }))}>
                          {t('household.approve')}
                        </button>
                        <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => act(api.post(`/household/spending-approvals/${a.id}/decide`, { decision: 'denied' }))}>
                          {t('household.deny')}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {tab === 'documents' && (
          <section className="mt-6 space-y-6">
            <div className="rounded-lg border border-border bg-surface p-4">
              <h2 className="text-lg font-medium">{t('household.documentsTitle')}</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-muted">{t('household.taskTitleLabel')}</span>
                  <input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" value={documentForm.title} onChange={(e) => setDocumentForm((p) => ({ ...p, title: e.target.value }))} />
                </label>
                <label className="block text-sm">
                  <span className="text-muted">{t('household.kindLabel')}</span>
                  <select className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" value={documentForm.kind} onChange={(e) => setDocumentForm((p) => ({ ...p, kind: e.target.value }))}>
                    {['document', 'receipt', 'visit_summary'].map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="mt-3 block text-sm">
                <span className="text-muted">{t('household.bodyLabel')}</span>
                <textarea className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" rows={3} value={documentForm.body} onChange={(e) => setDocumentForm((p) => ({ ...p, body: e.target.value }))} />
              </label>
              <button type="button" className="mt-4 rounded-md bg-accent px-4 py-2 text-sm text-on-accent" onClick={() => act(api.post('/household/documents', { ...documentForm, ownerId: context || undefined }), () => setDocumentForm({ kind: 'document', title: '', body: '' }))}>
                {t('household.addDocument')}
              </button>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              {documents.length === 0 && <p className="text-sm text-muted">{t('household.noDocuments')}</p>}
              <ul className="space-y-3">
                {documents.map((doc) => (
                  <li key={doc.id} className="rounded-md border border-border p-3">
                    <p className="text-sm font-medium">{doc.title}</p>
                    <p className="mt-1 text-sm text-muted">{doc.kind}</p>
                    {doc.body && <p className="mt-1 text-sm">{doc.body}</p>}
                    {doc.forwardedFrom && <p className="mt-1 text-sm text-muted">{t('household.forwardedFrom')}</p>}
                    {(doc.sharedWithDelegationIds || []).length > 0 && (
                      <p className="mt-1 text-sm text-muted">{t('household.sharedWith', { count: doc.sharedWithDelegationIds.length })}</p>
                    )}
                    {isOwnerView && acceptedDelegations.length > 0 && (
                      <div className="mt-2">
                        <p className="text-sm text-muted">{t('household.forwardTitle')}</p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {acceptedDelegations.map((d) => (
                            <label key={d.id} className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm">
                              <input
                                type="checkbox"
                                checked={(forwardTargets[doc.id] || []).includes(d.id)}
                                onChange={() => toggleForwardTarget(doc.id, d.id)}
                              />
                              {d.delegateName || d.delegateEmail}
                            </label>
                          ))}
                          <button
                            type="button"
                            className="rounded-md border border-border px-3 py-1.5 text-sm"
                            disabled={(forwardTargets[doc.id] || []).length === 0}
                            onClick={() => act(api.post(`/household/documents/${doc.id}/forward`, { toDelegationIds: forwardTargets[doc.id] }), () => {
                              setForwardTargets((prev) => ({ ...prev, [doc.id]: [] }));
                              setNotice(t('household.forwardedOk'));
                            })}
                          >
                            {t('household.forwardButton')}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}
