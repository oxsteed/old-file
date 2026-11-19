import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
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
 */
const SCOPES = ['book', 'schedule', 'prepare', 'coordinate', 'view_records', 'manage_addresses', 'manage_tasks', 'view_calendar'];
const TABS = ['delegations', 'calendar', 'addresses', 'contacts', 'templates', 'tasks', 'approvals', 'documents'];

export default function HouseholdPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('delegations');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState('');
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
  const [invite, setInvite] = useState({ email: '', scopes: ['book', 'schedule'], isCoordinator: false });
  const [contactForm, setContactForm] = useState({ name: '', phone: '', relationship: '', role: 'alternate', isEmergency: false });
  const [templateForm, setTemplateForm] = useState({ name: '', serviceName: '', frequency: 'weekly' });
  const [taskForm, setTaskForm] = useState({ kind: 'household', title: '', dueDate: '' });
  const [approvalForm, setApprovalForm] = useState({ amountCents: '', reason: '' });
  const [documentForm, setDocumentForm] = useState({ kind: 'document', title: '', body: '' });

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    Promise.all([
      api.get('/household/delegations'),
      api.get('/household/invitations'),
      api.get('/household/calendar'),
      api.get('/household/addresses'),
      api.get('/household/contacts'),
      api.get('/household/templates'),
      api.get('/household/tasks/triage'),
      api.get('/household/spending-approvals'),
      api.get('/household/documents'),
    ])
      .then(([d, inv, cal, addr, con, tpl, tri, app, doc]) => {
        setDelegations(Array.isArray(d.data?.delegations) ? d.data.delegations : []);
        setInvitations(Array.isArray(inv.data?.invitations) ? inv.data.invitations : []);
        setVisits(Array.isArray(cal.data?.visits) ? cal.data.visits : []);
        setAddresses(Array.isArray(addr.data?.addresses) ? addr.data.addresses : []);
        setContacts(Array.isArray(con.data?.contacts) ? con.data.contacts : []);
        setTemplates(Array.isArray(tpl.data?.templates) ? tpl.data.templates : []);
        setTriage(tri.data || null);
        setApprovals(Array.isArray(app.data?.approvals) ? app.data.approvals : []);
        setDocuments(Array.isArray(doc.data?.documents) ? doc.data.documents : []);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  async function act(promise, onDone) {
    setError('');
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
    api.get('/household/history-export')
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

        {loading && <p className="mt-6 text-sm text-muted">{t('household.loading')}</p>}
        {failed && (
          <p className="mt-6 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {t('household.loadFailed')}
          </p>
        )}
        {error && (
          <p className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
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

            {invitations.length > 0 && (
              <div className="rounded-lg border border-border bg-surface p-4">
                <h2 className="text-lg font-medium">{t('household.invitationsTitle')}</h2>
                <ul className="mt-3 space-y-3">
                  {invitations.map((inv) => (
                    <li key={inv.id} className="rounded-md border border-border p-3">
                      <p className="text-sm font-medium">{inv.ownerName || inv.delegateEmail}</p>
                      <p className="mt-1 text-sm text-muted">
                        {inv.scopePreview.map((s) => s.scope).join(', ')}
                      </p>
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
                      {(d.scopes || []).join(', ')}
                      {d.daysToExpiry !== null && d.status === 'accepted' ? ` · ${t('household.daysLeft', { count: d.daysToExpiry })}` : ''}
                      {d.expiresSoon ? ` · ${t('household.expiresSoon')}` : ''}
                    </p>
                    {preview[d.id] && (
                      <ul className="mt-2 space-y-1 text-sm text-muted">
                        {preview[d.id].scopes.map((s) => (
                          <li key={s.scope}>{s.scope}: {s.grants}</li>
                        ))}
                        {preview[d.id].neverGranted.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    )}
                    {activity[d.id] && (
                      <ul className="mt-2 space-y-1 text-sm text-muted">
                        {activity[d.id].map((a) => (
                          <li key={a.id}>{a.action} · {new Date(a.created_at).toLocaleString()}</li>
                        ))}
                      </ul>
                    )}
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
                          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => act(api.post(`/household/delegations/${d.id}/coordinator`, { isCoordinator: true }))}>
                            {t('household.makeCoordinator')}
                          </button>
                          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => act(api.post(`/household/delegations/${d.id}/revoke`, { reason: t('household.revokeReason') }))}>
                            {t('household.revoke')}
                          </button>
                        </>
                      )}
                      {(d.status === 'revoked' || d.status === 'expired' || d.status === 'closed') && (
                        <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => act(api.post(`/household/delegations/${d.id}/reinvite`, {}))}>
                          {t('household.reinvite')}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
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
                    {!v.readinessConfirmedAt && (
                      <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => act(api.post(`/household/visits/${v.bookingId}/prep/confirm-readiness`))}>
                        {t('household.confirmReadiness')}
                      </button>
                    )}
                    <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => act(api.post(`/household/visits/${v.bookingId}/remind`))}>
                      {t('household.remind')}
                    </button>
                  </div>
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
                  {a.entry_preset && <p className="mt-1 text-sm text-muted">{t('household.entryPreset')}: {a.entry_preset}</p>}
                  {a.entry_instructions && <p className="mt-1 text-sm">{a.entry_instructions}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === 'contacts' && (
          <section className="mt-6 space-y-6">
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
                    <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => act(api.post(`/household/contacts/${c.id}/archive`))}>
                      {t('household.archive')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {tab === 'templates' && (
          <section className="mt-6 space-y-6">
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
              <button type="button" className="mt-4 rounded-md bg-accent px-4 py-2 text-sm text-on-accent" onClick={() => act(api.post('/household/templates', templateForm), () => setTemplateForm({ name: '', serviceName: '', frequency: 'weekly' }))}>
                {t('household.addTemplate')}
              </button>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              {templates.length === 0 && <p className="text-sm text-muted">{t('household.noTemplates')}</p>}
              <ul className="space-y-3">
                {templates.map((tpl) => (
                  <li key={tpl.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
                    <p className="text-sm"><span className="font-medium">{tpl.name}</span> · {tpl.service_name} · {tpl.frequency}</p>
                    <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => act(api.delete(`/household/templates/${tpl.id}`))}>
                      {t('household.delete')}
                    </button>
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
              </div>
              <button type="button" className="mt-4 rounded-md bg-accent px-4 py-2 text-sm text-on-accent" onClick={() => act(api.post('/household/tasks', { kind: taskForm.kind, title: taskForm.title, dueDate: taskForm.dueDate || undefined }), () => setTaskForm({ kind: 'household', title: '', dueDate: '' }))}>
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
                    </p>
                    <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => act(api.post(`/household/tasks/${task.id}/complete`))}>
                      {t('household.complete')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {tab === 'approvals' && (
          <section className="mt-6 space-y-6">
            <div className="rounded-lg border border-border bg-surface p-4">
              <h2 className="text-lg font-medium">{t('household.approvalsTitle')}</h2>
              <p className="mt-1 text-sm text-muted">{t('household.approvalsNote')}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-muted">{t('household.amountLabel')}</span>
                  <input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" value={approvalForm.amountCents} placeholder="7500" onChange={(e) => setApprovalForm((p) => ({ ...p, amountCents: e.target.value }))} />
                </label>
                <label className="block text-sm">
                  <span className="text-muted">{t('household.reasonLabel')}</span>
                  <input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" value={approvalForm.reason} onChange={(e) => setApprovalForm((p) => ({ ...p, reason: e.target.value }))} />
                </label>
              </div>
              <button type="button" className="mt-4 rounded-md bg-accent px-4 py-2 text-sm text-on-accent" onClick={() => act(api.post('/household/spending-approvals', { amountCents: approvalForm.amountCents, reason: approvalForm.reason }), () => setApprovalForm({ amountCents: '', reason: '' }))}>
                {t('household.requestApproval')}
              </button>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              {approvals.length === 0 && <p className="text-sm text-muted">{t('household.noApprovals')}</p>}
              <ul className="space-y-3">
                {approvals.map((a) => (
                  <li key={a.id} className="rounded-md border border-border p-3">
                    <p className="text-sm">{a.reason} · {(a.amount_cents / 100).toFixed(2)} {a.currency} · {a.status}</p>
                    {a.status === 'pending' && (
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
              <button type="button" className="mt-4 rounded-md bg-accent px-4 py-2 text-sm text-on-accent" onClick={() => act(api.post('/household/documents', documentForm), () => setDocumentForm({ kind: 'document', title: '', body: '' }))}>
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
