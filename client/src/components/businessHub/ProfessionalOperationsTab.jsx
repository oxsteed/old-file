import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  createProfessionalComplianceRecord,
  createProfessionalPackage,
  deleteProfessionalComplianceRecord,
  deleteProfessionalPackage,
  updateProfessionalComplianceRecord,
  updateProfessionalEngagementRequest,
  updateProfessionalOperationsSettings,
  updateProfessionalPackage,
} from '../../api/professionalOperations';
import { formatMoney } from '../../lib/format';

const EMPTY_SETTINGS = {
  response_promise_hours: 24,
  consultation_label: 'Engagement intake and consultation planning',
  recurring_reminder_days: 30,
  preferred_contact_channel: 'email',
  document_checklist: '',
  obligation_types: '',
  trust_artifacts: '',
  follow_up_prompt: '',
  engagement_policy: '',
};

const EMPTY_PACKAGE = {
  package_name: '',
  package_type: 'engagement',
  target_templates: 'consulting_coaching',
  description: '',
  price_cents: '',
  cadence_label: '',
  deliverables: '',
  active: true,
};

const EMPTY_RECORD = {
  engagement_request_id: '',
  record_type: 'document',
  title: '',
  status: 'pending',
  due_at: '',
  document_url: '',
  notes: '',
};

function parseCommaList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function Card({ label, value, hint }) {
  return (
    <div className="rounded-3xl border border-gray-800 bg-gray-950/70 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
      {hint ? <p className="mt-1 text-sm text-gray-400">{hint}</p> : null}
    </div>
  );
}

function Section({ title, subtitle, actions, children }) {
  return (
    <section className="rounded-3xl border border-gray-800 bg-gray-900/95 px-6 py-5 shadow-[0_12px_48px_rgba(0,0,0,0.18)]">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          {subtitle ? <p className="mt-1 text-sm leading-6 text-gray-400">{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Input({ label, children, wide = false }) {
  return (
    <label className={`${wide ? 'md:col-span-2' : ''} block`}>
      <span className="mb-1.5 block text-sm font-medium text-gray-200">{label}</span>
      {children}
    </label>
  );
}

function TextInput(props) {
  return <input {...props} className={`w-full rounded-2xl border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-gray-500 ${props.className || ''}`} />;
}

function TextArea(props) {
  return <textarea {...props} className={`w-full rounded-2xl border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-gray-500 ${props.className || ''}`} />;
}

function Select(props) {
  return <select {...props} className={`w-full rounded-2xl border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-white outline-none ${props.className || ''}`} />;
}

export default function ProfessionalOperationsTab({ businessId, workspace, currency = 'USD', onRefresh, onJumpTab }) {
  const settings = workspace?.settings || {};
  const engagementRequests = workspace?.engagementRequests || [];
  const packages = workspace?.packages || [];
  const complianceRecords = workspace?.complianceRecords || [];
  const metrics = workspace?.metrics || {};

  const [settingsForm, setSettingsForm] = useState(EMPTY_SETTINGS);
  const [savingSettings, setSavingSettings] = useState(false);
  const [packageForm, setPackageForm] = useState(EMPTY_PACKAGE);
  const [editingPackageId, setEditingPackageId] = useState(null);
  const [recordForm, setRecordForm] = useState(EMPTY_RECORD);
  const [editingRecordId, setEditingRecordId] = useState(null);

  useEffect(() => {
    setSettingsForm({
      ...EMPTY_SETTINGS,
      ...settings,
      document_checklist: (settings.document_checklist || []).join(', '),
      obligation_types: (settings.obligation_types || []).join(', '),
      trust_artifacts: (settings.trust_artifacts || []).join(', '),
    });
  }, [settings]);

  const groupedRequests = useMemo(() => ({
    intake: engagementRequests.filter((item) => ['new', 'discovery_scheduled'].includes(item.status)),
    scope: engagementRequests.filter((item) => ['proposal_sent', 'active', 'waiting_on_client'].includes(item.status)),
    followUp: engagementRequests.filter((item) => ['completed'].includes(item.status)),
  }), [engagementRequests]);

  async function saveSettings() {
    setSavingSettings(true);
    try {
      await updateProfessionalOperationsSettings(businessId, {
        ...settingsForm,
        document_checklist: parseCommaList(settingsForm.document_checklist),
        obligation_types: parseCommaList(settingsForm.obligation_types),
        trust_artifacts: parseCommaList(settingsForm.trust_artifacts),
      });
      toast.success('Professional settings saved');
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not save professional settings');
    } finally {
      setSavingSettings(false);
    }
  }

  async function savePackage(event) {
    event.preventDefault();
    try {
      const payload = {
        ...packageForm,
        target_templates: parseCommaList(packageForm.target_templates),
        deliverables: parseCommaList(packageForm.deliverables),
        price_cents: packageForm.price_cents ? Number(packageForm.price_cents) : 0,
      };
      if (editingPackageId) await updateProfessionalPackage(businessId, editingPackageId, payload);
      else await createProfessionalPackage(businessId, payload);
      toast.success(editingPackageId ? 'Package updated' : 'Package added');
      setPackageForm(EMPTY_PACKAGE);
      setEditingPackageId(null);
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not save package');
    }
  }

  async function saveRecord(event) {
    event.preventDefault();
    try {
      if (editingRecordId) await updateProfessionalComplianceRecord(businessId, editingRecordId, recordForm);
      else await createProfessionalComplianceRecord(businessId, recordForm);
      toast.success(editingRecordId ? 'Compliance record updated' : 'Compliance record added');
      setRecordForm(EMPTY_RECORD);
      setEditingRecordId(null);
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not save compliance record');
    }
  }

  async function quickUpdateRequest(requestId, patch) {
    try {
      await updateProfessionalEngagementRequest(businessId, requestId, patch);
      toast.success('Engagement updated');
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not update engagement');
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-gray-800 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.16),_transparent_36%),linear-gradient(135deg,rgba(12,18,32,0.98),rgba(20,24,35,0.96))] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.24)] sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <span className="inline-flex rounded-full border border-sky-400/25 bg-sky-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-100">
              Professional Ops
            </span>
            <h2 className="mt-4 text-3xl font-semibold text-white">Engagement, documents, obligations</h2>
            <p className="mt-3 text-sm leading-7 text-gray-300">
              Run trust-sensitive intake, package logic, document discipline, and recurring obligation follow-up from one workspace built for accountants, coaches, consultants, and legal-admin operators.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:min-w-[360px]">
            <Card label="Open engagements" value={metrics.open_requests || 0} hint={`${metrics.proposals_waiting || 0} proposals waiting`} />
            <Card label="Obligations due" value={metrics.obligations_due || 0} hint={`${metrics.follow_up_due || 0} follow-ups due`} />
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-4">
        <Card label="Compliance queue" value={metrics.records_needing_attention || 0} hint="Records or deadlines needing action" />
        <Card label="Completed records" value={metrics.completed_records || 0} hint="Completed document or compliance milestones" />
        <Card label="Active packages" value={metrics.active_packages || 0} hint={formatMoney((metrics.package_value_cents || 0) / 100, { currency }) + ' in live package pricing'} />
        <Card label="Waiting on client" value={engagementRequests.filter((item) => item.status === 'waiting_on_client').length} hint="Requests blocked on client docs or response" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.95fr]">
        <Section
          title="Engagement Pipeline"
          subtitle="Move trust-sensitive leads from intake to scoping, documents, delivery, and recurring obligation follow-up."
          actions={<button type="button" className="bh-btn" onClick={() => onJumpTab?.('quotes')}>Open quotes</button>}
        >
          <div className="space-y-4">
            {engagementRequests.slice(0, 12).map((item) => (
              <div key={item.id} className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-gray-800 px-2.5 py-1 text-[11px] font-semibold text-gray-300">{item.template_slug}</span>
                      <span className="rounded-full bg-sky-400/10 px-2.5 py-1 text-[11px] font-semibold text-sky-200">{item.workflow_stage}</span>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-white">{item.service_need}</p>
                    <p className="mt-1 text-sm text-gray-400">{item.package_interest || 'Custom engagement'}{item.contact_name ? ` · ${item.contact_name}` : ''}</p>
                  </div>
                  <div className="flex gap-2">
                    <button className="bh-btn sm" type="button" onClick={() => quickUpdateRequest(item.id, { status: 'proposal_sent', workflow_stage: 'scoping' })}>Proposal sent</button>
                    <button className="bh-btn sm" type="button" onClick={() => quickUpdateRequest(item.id, { status: 'completed', workflow_stage: 'follow_up' })}>Completed</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Queue Snapshot"
          subtitle="See what needs discovery, documents, or recurring obligation follow-up first."
          actions={<button type="button" className="bh-btn" onClick={() => onRefresh?.()}>Refresh</button>}
        >
          <div className="space-y-4">
            <div className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Intake queue</p>
              <p className="mt-2 text-sm text-gray-300">{groupedRequests.intake.length} leads still need fit-check, consultation scheduling, or scope clarification.</p>
            </div>
            <div className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Scope and documents</p>
              <p className="mt-2 text-sm text-gray-300">{groupedRequests.scope.length} engagements are in scoping, delivery, or waiting-on-client mode.</p>
            </div>
            <div className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Follow-up</p>
              <p className="mt-2 text-sm text-gray-300">{groupedRequests.followUp.length} completed engagements need retention or obligation follow-up.</p>
            </div>
          </div>
        </Section>
      </div>

      <Section
        title="Engagement and obligation settings"
        subtitle="Define response speed, document expectations, trust signals, and recurring obligation rhythm for professional-service work."
        actions={<button type="button" className="bh-btn primary" onClick={saveSettings} disabled={savingSettings}>{savingSettings ? 'Saving...' : 'Save settings'}</button>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Response promise (hours)"><TextInput type="number" min="1" value={settingsForm.response_promise_hours} onChange={(e) => setSettingsForm((current) => ({ ...current, response_promise_hours: e.target.value }))} /></Input>
          <Input label="Consultation label"><TextInput value={settingsForm.consultation_label} onChange={(e) => setSettingsForm((current) => ({ ...current, consultation_label: e.target.value }))} /></Input>
          <Input label="Recurring reminder days"><TextInput type="number" min="1" value={settingsForm.recurring_reminder_days} onChange={(e) => setSettingsForm((current) => ({ ...current, recurring_reminder_days: e.target.value }))} /></Input>
          <Input label="Preferred contact channel"><Select value={settingsForm.preferred_contact_channel} onChange={(e) => setSettingsForm((current) => ({ ...current, preferred_contact_channel: e.target.value }))}><option value="email">Email</option><option value="call">Call</option><option value="meeting">Meeting</option><option value="message">Message</option></Select></Input>
          <Input label="Document checklist" wide><TextInput value={settingsForm.document_checklist} onChange={(e) => setSettingsForm((current) => ({ ...current, document_checklist: e.target.value }))} placeholder="Bank statements, prior filings, source docs, discovery notes" /></Input>
          <Input label="Obligation types" wide><TextInput value={settingsForm.obligation_types} onChange={(e) => setSettingsForm((current) => ({ ...current, obligation_types: e.target.value }))} placeholder="Monthly review, filing, check-in, coaching milestone" /></Input>
          <Input label="Trust artifacts" wide><TextInput value={settingsForm.trust_artifacts} onChange={(e) => setSettingsForm((current) => ({ ...current, trust_artifacts: e.target.value }))} placeholder="Confidentiality process, document discipline, recurring obligation tracking" /></Input>
          <Input label="Follow-up prompt" wide><TextArea rows={3} value={settingsForm.follow_up_prompt} onChange={(e) => setSettingsForm((current) => ({ ...current, follow_up_prompt: e.target.value }))} /></Input>
          <Input label="Engagement policy" wide><TextArea rows={3} value={settingsForm.engagement_policy} onChange={(e) => setSettingsForm((current) => ({ ...current, engagement_policy: e.target.value }))} /></Input>
        </div>
      </Section>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Section title="Packages and retainer logic" subtitle="Turn consultations, filings, ongoing support, and retainers into structured packages the team can sell and deliver consistently.">
          <form className="grid gap-4 md:grid-cols-2" onSubmit={savePackage}>
            <Input label="Package name"><TextInput value={packageForm.package_name} onChange={(e) => setPackageForm((current) => ({ ...current, package_name: e.target.value }))} /></Input>
            <Input label="Type"><Select value={packageForm.package_type} onChange={(e) => setPackageForm((current) => ({ ...current, package_type: e.target.value }))}><option value="engagement">Engagement</option><option value="session">Session</option><option value="retainer">Retainer</option><option value="filing">Filing</option></Select></Input>
            <Input label="Price cents"><TextInput type="number" min="0" value={packageForm.price_cents} onChange={(e) => setPackageForm((current) => ({ ...current, price_cents: e.target.value }))} /></Input>
            <Input label="Cadence label"><TextInput value={packageForm.cadence_label} onChange={(e) => setPackageForm((current) => ({ ...current, cadence_label: e.target.value }))} placeholder="Monthly, quarterly, one-time filing" /></Input>
            <Input label="Target templates" wide><TextInput value={packageForm.target_templates} onChange={(e) => setPackageForm((current) => ({ ...current, target_templates: e.target.value }))} placeholder="accountant, consulting_coaching, legal_admin" /></Input>
            <Input label="Deliverables" wide><TextInput value={packageForm.deliverables} onChange={(e) => setPackageForm((current) => ({ ...current, deliverables: e.target.value }))} placeholder="Review meeting, filing packet, strategy notes, compliance checklist" /></Input>
            <Input label="Description" wide><TextArea rows={2} value={packageForm.description} onChange={(e) => setPackageForm((current) => ({ ...current, description: e.target.value }))} /></Input>
            <div className="md:col-span-2 flex gap-3">
              <button className="bh-btn primary" type="submit">{editingPackageId ? 'Update package' : 'Add package'}</button>
              {editingPackageId ? <button className="bh-btn" type="button" onClick={() => { setEditingPackageId(null); setPackageForm(EMPTY_PACKAGE); }}>Cancel</button> : null}
            </div>
          </form>
          <div className="mt-5 space-y-3">
            {packages.map((item) => (
              <div key={item.id} className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-white">{item.package_name}</p>
                      <span className="rounded-full bg-sky-400/10 px-2.5 py-1 text-[11px] font-semibold text-sky-200">{item.package_type}</span>
                    </div>
                    {item.description ? <p className="mt-1 text-sm text-gray-400">{item.description}</p> : null}
                    <p className="mt-2 text-sm font-semibold text-white">{formatMoney((item.price_cents || 0) / 100, { currency })}</p>
                  </div>
                  <div className="flex gap-2">
                    <button className="bh-btn sm" type="button" onClick={() => {
                      setEditingPackageId(item.id);
                      setPackageForm({
                        package_name: item.package_name || '',
                        package_type: item.package_type || 'engagement',
                        target_templates: (item.target_templates || []).join(', '),
                        description: item.description || '',
                        price_cents: item.price_cents || '',
                        cadence_label: item.cadence_label || '',
                        deliverables: (item.deliverables || []).join(', '),
                        active: item.active !== false,
                      });
                    }}>Edit</button>
                    <button className="bh-btn sm" type="button" onClick={async () => { await deleteProfessionalPackage(businessId, item.id); toast.success('Package deleted'); await onRefresh?.(); }}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Compliance and obligation records" subtitle="Track deadlines, required documents, engagement deliverables, and recurring follow-up obligations in one queue.">
          <form className="grid gap-4 md:grid-cols-2" onSubmit={saveRecord}>
            <Input label="Engagement request"><Select value={recordForm.engagement_request_id} onChange={(e) => setRecordForm((current) => ({ ...current, engagement_request_id: e.target.value }))}><option value="">Unlinked</option>{engagementRequests.map((item) => <option key={item.id} value={item.id}>{item.service_need}</option>)}</Select></Input>
            <Input label="Record type"><Select value={recordForm.record_type} onChange={(e) => setRecordForm((current) => ({ ...current, record_type: e.target.value }))}><option value="document">Document</option><option value="deadline">Deadline</option><option value="compliance">Compliance</option><option value="deliverable">Deliverable</option><option value="license">License</option><option value="follow_up">Follow-up</option></Select></Input>
            <Input label="Title"><TextInput value={recordForm.title} onChange={(e) => setRecordForm((current) => ({ ...current, title: e.target.value }))} /></Input>
            <Input label="Status"><Select value={recordForm.status} onChange={(e) => setRecordForm((current) => ({ ...current, status: e.target.value }))}><option value="pending">Pending</option><option value="ready">Ready</option><option value="completed">Completed</option><option value="expired">Expired</option><option value="archived">Archived</option></Select></Input>
            <Input label="Due at"><TextInput type="datetime-local" value={recordForm.due_at} onChange={(e) => setRecordForm((current) => ({ ...current, due_at: e.target.value }))} /></Input>
            <Input label="Document URL"><TextInput value={recordForm.document_url} onChange={(e) => setRecordForm((current) => ({ ...current, document_url: e.target.value }))} /></Input>
            <Input label="Notes" wide><TextArea rows={2} value={recordForm.notes} onChange={(e) => setRecordForm((current) => ({ ...current, notes: e.target.value }))} /></Input>
            <div className="md:col-span-2 flex gap-3">
              <button className="bh-btn primary" type="submit">{editingRecordId ? 'Update record' : 'Add record'}</button>
              {editingRecordId ? <button className="bh-btn" type="button" onClick={() => { setEditingRecordId(null); setRecordForm(EMPTY_RECORD); }}>Cancel</button> : null}
            </div>
          </form>
          <div className="mt-5 space-y-3">
            {complianceRecords.map((item) => (
              <div key={item.id} className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-white">{item.title}</p>
                      <span className="rounded-full bg-gray-800 px-2.5 py-1 text-[11px] font-semibold text-gray-300">{item.record_type}</span>
                      <span className="rounded-full bg-sky-400/10 px-2.5 py-1 text-[11px] font-semibold text-sky-200">{item.status}</span>
                    </div>
                    {item.notes ? <p className="mt-1 text-sm text-gray-400">{item.notes}</p> : null}
                  </div>
                  <div className="flex gap-2">
                    <button className="bh-btn sm" type="button" onClick={() => {
                      setEditingRecordId(item.id);
                      setRecordForm({
                        engagement_request_id: item.engagement_request_id || '',
                        record_type: item.record_type || 'document',
                        title: item.title || '',
                        status: item.status || 'pending',
                        due_at: item.due_at ? new Date(item.due_at).toISOString().slice(0, 16) : '',
                        document_url: item.document_url || '',
                        notes: item.notes || '',
                      });
                    }}>Edit</button>
                    <button className="bh-btn sm" type="button" onClick={async () => { await deleteProfessionalComplianceRecord(businessId, item.id); toast.success('Compliance record deleted'); await onRefresh?.(); }}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
