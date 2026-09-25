import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import {
  createBeautyPackage,
  createBeautyTrustRecord,
  deleteBeautyPackage,
  deleteBeautyTrustRecord,
  updateBeautyIntakeRequest,
  updateBeautyOperationsSettings,
  updateBeautyPackage,
  updateBeautyTrustRecord,
} from '../../api/beautyOperations';
import { formatMoney } from '../../lib/format';

const EMPTY_SETTINGS = {
  response_promise_hours: 6,
  consultation_offer_label: 'Beauty intake and appointment planning',
  rebook_window_days: 42,
  same_day_fill_window_hours: 6,
  deposit_policy: '',
  cancellation_policy: '',
  prep_instructions: '',
  aftercare_prompt: '',
  membership_pitch: '',
  emergency_contact_phone: '',
  preferred_contact_channel: 'text',
  service_focuses: '',
  concern_tags: '',
  trust_artifacts: '',
  consent_requirements: '',
};

const EMPTY_PACKAGE = {
  package_name: '',
  package_type: 'membership',
  target_templates: 'beauty_style',
  description: '',
  price_cents: '',
  sessions_included: '',
  perks: '',
  active: true,
};

const EMPTY_TRUST = {
  record_type: 'License',
  title: '',
  issuer: '',
  status: 'active',
  expires_on: '',
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

export default function BeautyOperationsTab({ businessId, workspace, currency = 'USD', onRefresh, onJumpTab }) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`businessHub.beautyOps.${key}`, options);
  const settings = workspace?.settings || {};
  const intakeRequests = workspace?.intakeRequests || [];
  const packages = workspace?.packages || [];
  const trustRecords = workspace?.trustRecords || [];
  const metrics = workspace?.metrics || {};
  const upcomingAppointments = workspace?.upcomingAppointments || [];

  const [settingsForm, setSettingsForm] = useState(EMPTY_SETTINGS);
  const [savingSettings, setSavingSettings] = useState(false);
  const [packageForm, setPackageForm] = useState(EMPTY_PACKAGE);
  const [editingPackageId, setEditingPackageId] = useState(null);
  const [trustForm, setTrustForm] = useState(EMPTY_TRUST);
  const [editingTrustId, setEditingTrustId] = useState(null);

  useEffect(() => {
    setSettingsForm({
      ...EMPTY_SETTINGS,
      ...settings,
      service_focuses: (settings.service_focuses || []).join(', '),
      concern_tags: (settings.concern_tags || []).join(', '),
      trust_artifacts: (settings.trust_artifacts || []).join(', '),
      consent_requirements: (settings.consent_requirements || []).join(', '),
    });
  }, [settings]);

  const groupedIntakes = useMemo(() => ({
    consult: intakeRequests.filter((item) => ['new', 'consultation_ready'].includes(item.status)),
    prep: intakeRequests.filter((item) => ['booked', 'confirmed'].includes(item.status)),
    followUp: intakeRequests.filter((item) => ['completed', 'no_show'].includes(item.status)),
  }), [intakeRequests]);

  async function saveSettings() {
    setSavingSettings(true);
    try {
      await updateBeautyOperationsSettings(businessId, {
        ...settingsForm,
        service_focuses: parseCommaList(settingsForm.service_focuses),
        concern_tags: parseCommaList(settingsForm.concern_tags),
        trust_artifacts: parseCommaList(settingsForm.trust_artifacts),
        consent_requirements: parseCommaList(settingsForm.consent_requirements),
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
        perks: parseCommaList(packageForm.perks),
        price_cents: packageForm.price_cents ? Number(packageForm.price_cents) : 0,
        sessions_included: packageForm.sessions_included ? Number(packageForm.sessions_included) : null,
      };
      if (editingPackageId) await updateBeautyPackage(businessId, editingPackageId, payload);
      else await createBeautyPackage(businessId, payload);
      toast.success(editingPackageId ? copy('packageUpdated') : copy('packageAdded'));
      setPackageForm(EMPTY_PACKAGE);
      setEditingPackageId(null);
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || copy('packageSaveFailed'));
    }
  }

  async function saveTrustRecord(event) {
    event.preventDefault();
    try {
      if (editingTrustId) await updateBeautyTrustRecord(businessId, editingTrustId, trustForm);
      else await createBeautyTrustRecord(businessId, trustForm);
      toast.success(editingTrustId ? copy('trustRecordUpdated') : copy('trustRecordAdded'));
      setTrustForm(EMPTY_TRUST);
      setEditingTrustId(null);
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || copy('trustRecordSaveFailed'));
    }
  }

  async function quickUpdateIntake(requestId, patch) {
    try {
      await updateBeautyIntakeRequest(businessId, requestId, patch);
      toast.success(copy('intakeUpdated'));
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || copy('intakeUpdateFailed'));
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-gray-800 bg-[radial-gradient(circle_at_top_left,_rgba(244,114,182,0.16),_transparent_36%),linear-gradient(135deg,rgba(24,24,27,0.98),rgba(39,39,42,0.96))] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.24)] sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <span className="inline-flex rounded-full border border-pink-400/25 bg-pink-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-pink-100">
              {copy('label')}
            </span>
            <h2 className="mt-4 text-3xl font-semibold text-white">{copy('title')}</h2>
            <p className="mt-3 text-sm leading-7 text-gray-300">
              {copy('description')}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:min-w-[360px]">
            <Card label={copy('openIntakes')} value={metrics.open_intakes || 0} hint={copy('upcomingAppointments', { count: metrics.upcoming_appointments || 0 })} />
            <Card label={copy('rebookMomentum')} value={metrics.rebooked_requests || 0} hint={copy('followUpsDue', { count: metrics.follow_up_due || 0 })} />
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-4">
        <Card label={copy('noShowRisk')} value={(metrics.no_show_requests || 0) + (metrics.appointment_no_shows || 0)} hint={copy('noShowRiskHint')} />
        <Card label={copy('completed30d')} value={metrics.completed_last_30 || 0} hint={copy('completed30dHint')} />
        <Card label={copy('activePlans')} value={metrics.active_packages || 0} hint={`${formatMoney((metrics.package_value_cents || 0) / 100, { currency })} ${copy('livePackagePricing')}`} />
        <Card label={copy('trustRecords')} value={metrics.active_trust_records || 0} hint={copy('trustExpiring', { count: metrics.trust_expiring || 0 })} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.95fr]">
        <Section
          title={copy('intakePipeline')}
          subtitle={copy('intakePipelineSubtitle')}
          actions={<button type="button" className="bh-btn" onClick={() => onJumpTab?.('calendar')}>{copy('openSchedule')}</button>}
        >
          <div className="space-y-4">
            {intakeRequests.slice(0, 12).map((item) => (
              <div key={item.id} className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-gray-800 px-2.5 py-1 text-[11px] font-semibold text-gray-300">{item.template_slug}</span>
                      <span className="rounded-full bg-pink-400/10 px-2.5 py-1 text-[11px] font-semibold text-pink-200">{item.workflow_stage}</span>
                      <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200">{item.client_segment}</span>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-white">{item.desired_service}</p>
                    <p className="mt-1 text-sm text-gray-400">
                      {item.desired_look || copy('noLookNotes')}{item.preferred_staff ? ` · ${copy('prefers')} ${item.preferred_staff}` : ''}{item.contact_name ? ` · ${item.contact_name}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button className="bh-btn sm" type="button" onClick={() => quickUpdateIntake(item.id, { status: 'booked', workflow_stage: 'booking' })}>{copy('markBooked')}</button>
                    <button className="bh-btn sm" type="button" onClick={() => quickUpdateIntake(item.id, { status: 'rebooked', workflow_stage: 'closed' })}>{copy('rebooked')}</button>
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
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{copy('consultationQueue')}</p>
              <p className="mt-2 text-sm text-gray-300">{copy('consultationQueueHint', { count: groupedIntakes.consult.length })}</p>
            </div>
            <div className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{copy('prepAndVisit')}</p>
              <p className="mt-2 text-sm text-gray-300">{copy('prepAndVisitHint', { count: groupedIntakes.prep.length })}</p>
            </div>
            <div className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{copy('followUpAndRebook')}</p>
              <p className="mt-2 text-sm text-gray-300">{copy('followUpAndRebookHint', { count: groupedIntakes.followUp.length })}</p>
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
          <Input label={copy('consultationLabel')}><TextInput value={settingsForm.consultation_offer_label} onChange={(e) => setSettingsForm((current) => ({ ...current, consultation_offer_label: e.target.value }))} /></Input>
          <Input label={copy('rebookWindow')}><TextInput type="number" min="1" value={settingsForm.rebook_window_days} onChange={(e) => setSettingsForm((current) => ({ ...current, rebook_window_days: e.target.value }))} /></Input>
          <Input label={copy('sameDayFillWindow')}><TextInput type="number" min="1" value={settingsForm.same_day_fill_window_hours} onChange={(e) => setSettingsForm((current) => ({ ...current, same_day_fill_window_hours: e.target.value }))} /></Input>
          <Input label={copy('preferredContact')}><Select value={settingsForm.preferred_contact_channel} onChange={(e) => setSettingsForm((current) => ({ ...current, preferred_contact_channel: e.target.value }))}><option value="text">{copy('text')}</option><option value="email">{copy('email')}</option><option value="call">{copy('call')}</option><option value="dm">DM</option></Select></Input>
          <Input label={copy('emergencyPhone')}><TextInput value={settingsForm.emergency_contact_phone} onChange={(e) => setSettingsForm((current) => ({ ...current, emergency_contact_phone: e.target.value }))} /></Input>
          <Input label={copy('serviceFocuses')} wide><TextInput value={settingsForm.service_focuses} onChange={(e) => setSettingsForm((current) => ({ ...current, service_focuses: e.target.value }))} placeholder={copy('serviceFocusesPlaceholder')} /></Input>
          <Input label={copy('concernTags')} wide><TextInput value={settingsForm.concern_tags} onChange={(e) => setSettingsForm((current) => ({ ...current, concern_tags: e.target.value }))} placeholder={copy('concernTagsPlaceholder')} /></Input>
          <Input label={copy('trustArtifacts')} wide><TextInput value={settingsForm.trust_artifacts} onChange={(e) => setSettingsForm((current) => ({ ...current, trust_artifacts: e.target.value }))} placeholder={copy('trustArtifactsPlaceholder')} /></Input>
          <Input label={copy('consentRequirements')} wide><TextInput value={settingsForm.consent_requirements} onChange={(e) => setSettingsForm((current) => ({ ...current, consent_requirements: e.target.value }))} placeholder={copy('consentRequirementsPlaceholder')} /></Input>
          <Input label={copy('depositPolicy')} wide><TextArea rows={3} value={settingsForm.deposit_policy} onChange={(e) => setSettingsForm((current) => ({ ...current, deposit_policy: e.target.value }))} /></Input>
          <Input label={copy('cancellationPolicy')} wide><TextArea rows={3} value={settingsForm.cancellation_policy} onChange={(e) => setSettingsForm((current) => ({ ...current, cancellation_policy: e.target.value }))} /></Input>
          <Input label={copy('prepInstructions')} wide><TextArea rows={3} value={settingsForm.prep_instructions} onChange={(e) => setSettingsForm((current) => ({ ...current, prep_instructions: e.target.value }))} /></Input>
          <Input label={copy('aftercarePrompt')} wide><TextArea rows={3} value={settingsForm.aftercare_prompt} onChange={(e) => setSettingsForm((current) => ({ ...current, aftercare_prompt: e.target.value }))} /></Input>
          <Input label={copy('membershipPitch')} wide><TextArea rows={3} value={settingsForm.membership_pitch} onChange={(e) => setSettingsForm((current) => ({ ...current, membership_pitch: e.target.value }))} /></Input>
        </div>
      </Section>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Section title={copy('packagesTitle')} subtitle={copy('packagesSubtitle')}>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={savePackage}>
            <Input label={copy('packageName')}><TextInput value={packageForm.package_name} onChange={(e) => setPackageForm((current) => ({ ...current, package_name: e.target.value }))} /></Input>
            <Input label={copy('type')}><Select value={packageForm.package_type} onChange={(e) => setPackageForm((current) => ({ ...current, package_type: e.target.value }))}><option value="membership">{copy('membership')}</option><option value="series">{copy('series')}</option><option value="single">{copy('single')}</option><option value="bridal">{copy('bridal')}</option></Select></Input>
            <Input label={copy('priceCents')}><TextInput type="number" min="0" value={packageForm.price_cents} onChange={(e) => setPackageForm((current) => ({ ...current, price_cents: e.target.value }))} /></Input>
            <Input label={copy('sessionsIncluded')}><TextInput type="number" min="0" value={packageForm.sessions_included} onChange={(e) => setPackageForm((current) => ({ ...current, sessions_included: e.target.value }))} /></Input>
            <Input label={copy('targetTemplates')} wide><TextInput value={packageForm.target_templates} onChange={(e) => setPackageForm((current) => ({ ...current, target_templates: e.target.value }))} placeholder={copy('targetTemplatesPlaceholder')} /></Input>
            <Input label={copy('perks')} wide><TextInput value={packageForm.perks} onChange={(e) => setPackageForm((current) => ({ ...current, perks: e.target.value }))} placeholder={copy('perksPlaceholder')} /></Input>
            <Input label={copy('descriptionLabel')} wide><TextArea rows={2} value={packageForm.description} onChange={(e) => setPackageForm((current) => ({ ...current, description: e.target.value }))} /></Input>
            <div className="md:col-span-2 flex gap-3">
              <button className="bh-btn primary" type="submit">{editingPackageId ? copy('updatePackage') : copy('addPackage')}</button>
              {editingPackageId ? <button className="bh-btn" type="button" onClick={() => { setEditingPackageId(null); setPackageForm(EMPTY_PACKAGE); }}>{t('common.cancel')}</button> : null}
            </div>
          </form>
          <div className="mt-5 space-y-3">
            {packages.map((item) => (
              <div key={item.id} className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-white">{item.package_name}</p>
                      <span className="rounded-full bg-pink-400/10 px-2.5 py-1 text-[11px] font-semibold text-pink-200">{item.package_type}</span>
                    </div>
                    {item.description ? <p className="mt-1 text-sm text-gray-400">{item.description}</p> : null}
                    <p className="mt-2 text-sm font-semibold text-white">{formatMoney((item.price_cents || 0) / 100, { currency })}</p>
                  </div>
                  <div className="flex gap-2">
                    <button className="bh-btn sm" type="button" onClick={() => {
                      setEditingPackageId(item.id);
                      setPackageForm({
                        package_name: item.package_name || '',
                        package_type: item.package_type || 'membership',
                        target_templates: (item.target_templates || []).join(', '),
                        description: item.description || '',
                        price_cents: item.price_cents || '',
                        sessions_included: item.sessions_included || '',
                        perks: (item.perks || []).join(', '),
                        active: item.active !== false,
                      });
                    }}>{t('common.edit')}</button>
                    <button className="bh-btn sm" type="button" onClick={async () => { await deleteBeautyPackage(businessId, item.id); toast.success(copy('packageDeleted')); await onRefresh?.(); }}>{t('common.delete')}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title={copy('trustTitle')} subtitle={copy('trustSubtitle')}>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={saveTrustRecord}>
            <Input label={copy('recordType')}><TextInput value={trustForm.record_type} onChange={(e) => setTrustForm((current) => ({ ...current, record_type: e.target.value }))} /></Input>
            <Input label={copy('titleLabel')}><TextInput value={trustForm.title} onChange={(e) => setTrustForm((current) => ({ ...current, title: e.target.value }))} /></Input>
            <Input label={copy('issuer')}><TextInput value={trustForm.issuer} onChange={(e) => setTrustForm((current) => ({ ...current, issuer: e.target.value }))} /></Input>
            <Input label={copy('statusLabel')}><Select value={trustForm.status} onChange={(e) => setTrustForm((current) => ({ ...current, status: e.target.value }))}><option value="active">{copy('active')}</option><option value="expiring">{copy('expiring')}</option><option value="expired">{copy('expired')}</option><option value="archived">{copy('archived')}</option></Select></Input>
            <Input label={copy('expiresOn')}><TextInput type="date" value={trustForm.expires_on} onChange={(e) => setTrustForm((current) => ({ ...current, expires_on: e.target.value }))} /></Input>
            <Input label={copy('documentUrl')}><TextInput value={trustForm.document_url} onChange={(e) => setTrustForm((current) => ({ ...current, document_url: e.target.value }))} /></Input>
            <Input label={copy('notesLabel')} wide><TextArea rows={2} value={trustForm.notes} onChange={(e) => setTrustForm((current) => ({ ...current, notes: e.target.value }))} /></Input>
            <div className="md:col-span-2 flex gap-3">
              <button className="bh-btn primary" type="submit">{editingTrustId ? copy('updateTrustRecord') : copy('addTrustRecord')}</button>
              {editingTrustId ? <button className="bh-btn" type="button" onClick={() => { setEditingTrustId(null); setTrustForm(EMPTY_TRUST); }}>{t('common.cancel')}</button> : null}
            </div>
          </form>
          <div className="mt-5 space-y-3">
            {trustRecords.map((item) => (
              <div key={item.id} className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-white">{item.title}</p>
                      <span className="rounded-full bg-gray-800 px-2.5 py-1 text-[11px] font-semibold text-gray-300">{item.record_type}</span>
                      <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200">{item.status}</span>
                    </div>
                    {item.notes ? <p className="mt-1 text-sm text-gray-400">{item.notes}</p> : null}
                  </div>
                  <div className="flex gap-2">
                    <button className="bh-btn sm" type="button" onClick={() => {
                      setEditingTrustId(item.id);
                      setTrustForm({
                        record_type: item.record_type || '',
                        title: item.title || '',
                        issuer: item.issuer || '',
                        status: item.status || 'active',
                        expires_on: item.expires_on ? String(item.expires_on).slice(0, 10) : '',
                        document_url: item.document_url || '',
                        notes: item.notes || '',
                      });
                    }}>{t('common.edit')}</button>
                    <button className="bh-btn sm" type="button" onClick={async () => { await deleteBeautyTrustRecord(businessId, item.id); toast.success(copy('trustRecordDeleted')); await onRefresh?.(); }}>{t('common.delete')}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section
        title={copy('upcomingTitle')}
        subtitle={copy('upcomingSubtitle')}
        actions={<button type="button" className="bh-btn" onClick={() => onJumpTab?.('calendar')}>{copy('openCalendar')}</button>}
      >
        <div className="space-y-3">
          {upcomingAppointments.length === 0 ? (
            <p className="text-sm text-gray-400">{copy('noUpcoming')}</p>
          ) : upcomingAppointments.map((item) => (
            <div key={item.id} className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">{item.service_name || copy('appointment')}</p>
                  <p className="text-sm text-gray-400">{item.customer_name || copy('guestClient')} · {new Date(item.start_time).toLocaleString()}</p>
                </div>
                <span className="rounded-full bg-gray-800 px-2.5 py-1 text-[11px] font-semibold text-gray-300">{item.status}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
