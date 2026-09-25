import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import {
  createCreativeApprovalRecord,
  createCreativePackage,
  deleteCreativeApprovalRecord,
  deleteCreativePackage,
  updateCreativeApprovalRecord,
  updateCreativeIntakeRequest,
  updateCreativeOperationsSettings,
  updateCreativePackage,
} from '../../api/creativeOperations';
import { formatMoney } from '../../lib/format';

const EMPTY_SETTINGS = {
  response_promise_hours: 12,
  discovery_call_label: 'Creative discovery intake',
  delivery_window_days: 14,
  approval_turnaround_hours: 48,
  revision_policy: '',
  approval_policy: '',
  follow_up_prompt: '',
  testimonial_prompt: '',
  preferred_contact_channel: 'email',
  gallery_focus_tags: '',
  deliverable_types: '',
  trust_artifacts: '',
};

const EMPTY_PACKAGE = {
  package_name: '',
  package_type: 'project',
  target_templates: 'creative_studio',
  description: '',
  price_cents: '',
  revision_rounds: '',
  deliverables: '',
  active: true,
};

const EMPTY_RECORD = {
  intake_request_id: '',
  record_type: 'approval',
  title: '',
  status: 'pending',
  due_at: '',
  asset_url: '',
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

export default function CreativeOperationsTab({ businessId, workspace, currency = 'USD', onRefresh, onJumpTab }) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`businessHub.creativeOps.${key}`, options);
  const settings = workspace?.settings || {};
  const intakeRequests = workspace?.intakeRequests || [];
  const packages = workspace?.packages || [];
  const approvalRecords = workspace?.approvalRecords || [];
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
      gallery_focus_tags: (settings.gallery_focus_tags || []).join(', '),
      deliverable_types: (settings.deliverable_types || []).join(', '),
      trust_artifacts: (settings.trust_artifacts || []).join(', '),
    });
  }, [settings]);

  const groupedIntakes = useMemo(() => ({
    discovery: intakeRequests.filter((item) => ['new', 'discovery_scheduled'].includes(item.status)),
    proposal: intakeRequests.filter((item) => ['proposal_sent', 'active'].includes(item.status)),
    review: intakeRequests.filter((item) => ['in_review', 'approved', 'delivered'].includes(item.status)),
  }), [intakeRequests]);

  async function saveSettings() {
    setSavingSettings(true);
    try {
      await updateCreativeOperationsSettings(businessId, {
        ...settingsForm,
        gallery_focus_tags: parseCommaList(settingsForm.gallery_focus_tags),
        deliverable_types: parseCommaList(settingsForm.deliverable_types),
        trust_artifacts: parseCommaList(settingsForm.trust_artifacts),
      });
      toast.success(copy('settingsSaved'));
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || copy('settingsSaveFailed'));
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
        revision_rounds: packageForm.revision_rounds ? Number(packageForm.revision_rounds) : null,
      };
      if (editingPackageId) await updateCreativePackage(businessId, editingPackageId, payload);
      else await createCreativePackage(businessId, payload);
      toast.success(editingPackageId ? copy('packageUpdated') : copy('packageAdded'));
      setPackageForm(EMPTY_PACKAGE);
      setEditingPackageId(null);
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || copy('packageSaveFailed'));
    }
  }

  async function saveRecord(event) {
    event.preventDefault();
    try {
      if (editingRecordId) await updateCreativeApprovalRecord(businessId, editingRecordId, recordForm);
      else await createCreativeApprovalRecord(businessId, recordForm);
      toast.success(editingRecordId ? copy('recordUpdated') : copy('recordAdded'));
      setRecordForm(EMPTY_RECORD);
      setEditingRecordId(null);
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || copy('recordSaveFailed'));
    }
  }

  async function quickUpdateIntake(requestId, patch) {
    try {
      await updateCreativeIntakeRequest(businessId, requestId, patch);
      toast.success(copy('intakeUpdated'));
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || copy('intakeUpdateFailed'));
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-gray-800 bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.18),_transparent_36%),linear-gradient(135deg,rgba(17,24,39,0.98),rgba(28,25,23,0.96))] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.24)] sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <span className="inline-flex rounded-full border border-orange-400/25 bg-orange-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-100">
              {copy('label')}
            </span>
            <h2 className="mt-4 text-3xl font-semibold text-white">{copy('title')}</h2>
            <p className="mt-3 text-sm leading-7 text-gray-300">
              {copy('description')}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:min-w-[360px]">
            <Card label={copy('openIntakes')} value={metrics.open_intakes || 0} hint={copy('proposalsWaiting', { count: metrics.proposals_waiting || 0 })} />
            <Card label={copy('approvalPressure')} value={metrics.approvals_pending || 0} hint={copy('overdueApprovals', { count: metrics.approvals_overdue || 0 })} />
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-4">
        <Card label={copy('delivered30d')} value={metrics.delivered_last_30 || 0} hint={copy('delivered30dHint')} />
        <Card label={copy('followUpsDue')} value={metrics.follow_up_due || 0} hint={copy('followUpsDueHint')} />
        <Card label={copy('activePackages')} value={metrics.active_packages || 0} hint={`${formatMoney((metrics.package_value_cents || 0) / 100, { currency })} ${copy('livePackagePricing')}`} />
        <Card label={copy('proofQueue')} value={approvalRecords.filter((item) => item.status === 'revisions_requested').length} hint={copy('proofQueueHint')} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.95fr]">
        <Section
          title={copy('intakePipeline')}
          subtitle={copy('intakePipelineSubtitle')}
          actions={<button type="button" className="bh-btn" onClick={() => onJumpTab?.('quotes')}>{copy('openQuotes')}</button>}
        >
          <div className="space-y-4">
            {intakeRequests.slice(0, 12).map((item) => (
              <div key={item.id} className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-gray-800 px-2.5 py-1 text-[11px] font-semibold text-gray-300">{item.template_slug}</span>
                      <span className="rounded-full bg-orange-400/10 px-2.5 py-1 text-[11px] font-semibold text-orange-200">{item.workflow_stage}</span>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-white">{item.project_type}</p>
                    <p className="mt-1 text-sm text-gray-400">{item.package_interest || copy('customScope')}{item.contact_name ? ` · ${item.contact_name}` : ''}</p>
                  </div>
                  <div className="flex gap-2">
                    <button className="bh-btn sm" type="button" onClick={() => quickUpdateIntake(item.id, { status: 'proposal_sent', workflow_stage: 'proposal' })}>{copy('proposalSent')}</button>
                    <button className="bh-btn sm" type="button" onClick={() => quickUpdateIntake(item.id, { status: 'delivered', workflow_stage: 'follow_up' })}>{copy('delivered')}</button>
                  </div>
                </div>
              </div>
            ))}
            {intakeRequests.length === 0 ? <p className="text-sm text-gray-400">{copy('noIntakes')}</p> : null}
          </div>
        </Section>

        <Section
          title={copy('queueSnapshot')}
          subtitle={copy('queueSnapshotSubtitle')}
          actions={<button type="button" className="bh-btn" onClick={() => onRefresh?.()}>{copy('refresh')}</button>}
        >
          <div className="space-y-4">
            <div className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{copy('discoveryQueue')}</p>
              <p className="mt-2 text-sm text-gray-300">{copy('discoveryQueueHint', { count: groupedIntakes.discovery.length })}</p>
            </div>
            <div className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{copy('proposalProduction')}</p>
              <p className="mt-2 text-sm text-gray-300">{copy('proposalProductionHint', { count: groupedIntakes.proposal.length })}</p>
            </div>
            <div className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{copy('reviewDelivery')}</p>
              <p className="mt-2 text-sm text-gray-300">{copy('reviewDeliveryHint', { count: groupedIntakes.review.length })}</p>
            </div>
          </div>
        </Section>
      </div>

      <Section
        title={copy('settingsTitle')}
        subtitle={copy('settingsSubtitle')}
        actions={<button type="button" className="bh-btn primary" onClick={saveSettings} disabled={savingSettings}>{savingSettings ? t('common.saving') : copy('saveSettings')}</button>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Input label={copy('responsePromise')}><TextInput type="number" min="1" value={settingsForm.response_promise_hours} onChange={(e) => setSettingsForm((current) => ({ ...current, response_promise_hours: e.target.value }))} /></Input>
          <Input label={copy('discoveryLabel')}><TextInput value={settingsForm.discovery_call_label} onChange={(e) => setSettingsForm((current) => ({ ...current, discovery_call_label: e.target.value }))} /></Input>
          <Input label={copy('deliveryWindow')}><TextInput type="number" min="1" value={settingsForm.delivery_window_days} onChange={(e) => setSettingsForm((current) => ({ ...current, delivery_window_days: e.target.value }))} /></Input>
          <Input label={copy('approvalTurnaround')}><TextInput type="number" min="1" value={settingsForm.approval_turnaround_hours} onChange={(e) => setSettingsForm((current) => ({ ...current, approval_turnaround_hours: e.target.value }))} /></Input>
          <Input label={copy('preferredContact')}><Select value={settingsForm.preferred_contact_channel} onChange={(e) => setSettingsForm((current) => ({ ...current, preferred_contact_channel: e.target.value }))}><option value="email">{copy('email')}</option><option value="call">{copy('call')}</option><option value="meeting">{copy('meeting')}</option><option value="message">{copy('message')}</option></Select></Input>
          <Input label={copy('galleryFocusTags')}><TextInput value={settingsForm.gallery_focus_tags} onChange={(e) => setSettingsForm((current) => ({ ...current, gallery_focus_tags: e.target.value }))} placeholder={copy('galleryFocusTagsPlaceholder')} /></Input>
          <Input label={copy('deliverableTypes')} wide><TextInput value={settingsForm.deliverable_types} onChange={(e) => setSettingsForm((current) => ({ ...current, deliverable_types: e.target.value }))} placeholder={copy('deliverableTypesPlaceholder')} /></Input>
          <Input label={copy('trustArtifacts')} wide><TextInput value={settingsForm.trust_artifacts} onChange={(e) => setSettingsForm((current) => ({ ...current, trust_artifacts: e.target.value }))} placeholder={copy('trustArtifactsPlaceholder')} /></Input>
          <Input label={copy('revisionPolicy')} wide><TextArea rows={3} value={settingsForm.revision_policy} onChange={(e) => setSettingsForm((current) => ({ ...current, revision_policy: e.target.value }))} /></Input>
          <Input label={copy('approvalPolicy')} wide><TextArea rows={3} value={settingsForm.approval_policy} onChange={(e) => setSettingsForm((current) => ({ ...current, approval_policy: e.target.value }))} /></Input>
          <Input label={copy('followUpPrompt')} wide><TextArea rows={3} value={settingsForm.follow_up_prompt} onChange={(e) => setSettingsForm((current) => ({ ...current, follow_up_prompt: e.target.value }))} /></Input>
          <Input label={copy('testimonialPrompt')} wide><TextArea rows={3} value={settingsForm.testimonial_prompt} onChange={(e) => setSettingsForm((current) => ({ ...current, testimonial_prompt: e.target.value }))} /></Input>
        </div>
      </Section>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Section title="Packages and scope logic" subtitle="Turn portfolio interest into productized projects, session packages, and retainers the team can quote consistently.">
          <form className="grid gap-4 md:grid-cols-2" onSubmit={savePackage}>
            <Input label="Package name"><TextInput value={packageForm.package_name} onChange={(e) => setPackageForm((current) => ({ ...current, package_name: e.target.value }))} /></Input>
            <Input label="Type"><Select value={packageForm.package_type} onChange={(e) => setPackageForm((current) => ({ ...current, package_type: e.target.value }))}><option value="project">Project</option><option value="session">Session</option><option value="campaign">Campaign</option><option value="retainer">Retainer</option></Select></Input>
            <Input label="Price cents"><TextInput type="number" min="0" value={packageForm.price_cents} onChange={(e) => setPackageForm((current) => ({ ...current, price_cents: e.target.value }))} /></Input>
            <Input label="Revision rounds"><TextInput type="number" min="0" value={packageForm.revision_rounds} onChange={(e) => setPackageForm((current) => ({ ...current, revision_rounds: e.target.value }))} /></Input>
            <Input label="Target templates" wide><TextInput value={packageForm.target_templates} onChange={(e) => setPackageForm((current) => ({ ...current, target_templates: e.target.value }))} placeholder="photographer, creative_studio, graphic_design" /></Input>
            <Input label="Deliverables" wide><TextInput value={packageForm.deliverables} onChange={(e) => setPackageForm((current) => ({ ...current, deliverables: e.target.value }))} placeholder="Retouched gallery, logo suite, ad variations, usage guide" /></Input>
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
                      <span className="rounded-full bg-orange-400/10 px-2.5 py-1 text-[11px] font-semibold text-orange-200">{item.package_type}</span>
                    </div>
                    {item.description ? <p className="mt-1 text-sm text-gray-400">{item.description}</p> : null}
                    <p className="mt-2 text-sm font-semibold text-white">{formatMoney((item.price_cents || 0) / 100, { currency })}</p>
                  </div>
                  <div className="flex gap-2">
                    <button className="bh-btn sm" type="button" onClick={() => {
                      setEditingPackageId(item.id);
                      setPackageForm({
                        package_name: item.package_name || '',
                        package_type: item.package_type || 'project',
                        target_templates: (item.target_templates || []).join(', '),
                        description: item.description || '',
                        price_cents: item.price_cents || '',
                        revision_rounds: item.revision_rounds || '',
                        deliverables: (item.deliverables || []).join(', '),
                        active: item.active !== false,
                      });
                    }}>Edit</button>
                    <button className="bh-btn sm" type="button" onClick={async () => { await deleteCreativePackage(businessId, item.id); toast.success('Package deleted'); await onRefresh?.(); }}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Approval and delivery records" subtitle="Track briefs, proofs, client approvals, final deliveries, and testimonial permissions in one proof-ready queue.">
          <form className="grid gap-4 md:grid-cols-2" onSubmit={saveRecord}>
            <Input label="Intake request"><Select value={recordForm.intake_request_id} onChange={(e) => setRecordForm((current) => ({ ...current, intake_request_id: e.target.value }))}><option value="">Unlinked</option>{intakeRequests.map((item) => <option key={item.id} value={item.id}>{item.project_type}</option>)}</Select></Input>
            <Input label="Record type"><Select value={recordForm.record_type} onChange={(e) => setRecordForm((current) => ({ ...current, record_type: e.target.value }))}><option value="approval">Approval</option><option value="brief">Brief</option><option value="proof">Proof</option><option value="delivery">Delivery</option><option value="usage_rights">Usage rights</option><option value="testimonial">Testimonial</option></Select></Input>
            <Input label="Title"><TextInput value={recordForm.title} onChange={(e) => setRecordForm((current) => ({ ...current, title: e.target.value }))} /></Input>
            <Input label="Status"><Select value={recordForm.status} onChange={(e) => setRecordForm((current) => ({ ...current, status: e.target.value }))}><option value="pending">Pending</option><option value="approved">Approved</option><option value="revisions_requested">Revisions requested</option><option value="delivered">Delivered</option><option value="archived">Archived</option></Select></Input>
            <Input label="Due at"><TextInput type="datetime-local" value={recordForm.due_at} onChange={(e) => setRecordForm((current) => ({ ...current, due_at: e.target.value }))} /></Input>
            <Input label="Asset URL"><TextInput value={recordForm.asset_url} onChange={(e) => setRecordForm((current) => ({ ...current, asset_url: e.target.value }))} /></Input>
            <Input label="Notes" wide><TextArea rows={2} value={recordForm.notes} onChange={(e) => setRecordForm((current) => ({ ...current, notes: e.target.value }))} /></Input>
            <div className="md:col-span-2 flex gap-3">
              <button className="bh-btn primary" type="submit">{editingRecordId ? 'Update record' : 'Add record'}</button>
              {editingRecordId ? <button className="bh-btn" type="button" onClick={() => { setEditingRecordId(null); setRecordForm(EMPTY_RECORD); }}>Cancel</button> : null}
            </div>
          </form>
          <div className="mt-5 space-y-3">
            {approvalRecords.map((item) => (
              <div key={item.id} className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-white">{item.title}</p>
                      <span className="rounded-full bg-gray-800 px-2.5 py-1 text-[11px] font-semibold text-gray-300">{item.record_type}</span>
                      <span className="rounded-full bg-orange-400/10 px-2.5 py-1 text-[11px] font-semibold text-orange-200">{item.status}</span>
                    </div>
                    {item.notes ? <p className="mt-1 text-sm text-gray-400">{item.notes}</p> : null}
                  </div>
                  <div className="flex gap-2">
                    <button className="bh-btn sm" type="button" onClick={() => {
                      setEditingRecordId(item.id);
                      setRecordForm({
                        intake_request_id: item.intake_request_id || '',
                        record_type: item.record_type || 'approval',
                        title: item.title || '',
                        status: item.status || 'pending',
                        due_at: item.due_at ? new Date(item.due_at).toISOString().slice(0, 16) : '',
                        asset_url: item.asset_url || '',
                        notes: item.notes || '',
                      });
                    }}>Edit</button>
                    <button className="bh-btn sm" type="button" onClick={async () => { await deleteCreativeApprovalRecord(businessId, item.id); toast.success('Approval record deleted'); await onRefresh?.(); }}>Delete</button>
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
