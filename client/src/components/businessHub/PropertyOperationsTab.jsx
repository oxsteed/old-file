import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import {
  createPropertyComplianceRecord,
  createPropertyPackage,
  createPropertyUnit,
  deletePropertyComplianceRecord,
  deletePropertyPackage,
  deletePropertyUnit,
  updatePropertyComplianceRecord,
  updatePropertyOperationsSettings,
  updatePropertyPackage,
  updatePropertyUnit,
} from '../../api/propertyOperations';
import { formatMoney } from '../../lib/format';

const EMPTY_SETTINGS = {
  emergency_phone: '',
  emergency_instructions: '',
  after_hours_policy: '',
  response_promise_hours: 24,
  follow_up_interval_hours: 24,
  default_bill_to: 'owner',
  supported_issue_categories: '',
  trust_artifacts: '',
  managed_property_types: '',
  service_area_notes: '',
  tenant_portal_intro: '',
};

const EMPTY_UNIT = {
  property_label: '',
  unit_label: '',
  property_type: 'Apartment',
  occupancy_status: 'occupied',
  contact_name: '',
  contact_phone: '',
  access_summary: '',
  priority_tier: 'standard',
  notes: '',
};

const EMPTY_PACKAGE = {
  name: '',
  description: '',
  pricing_model: 'flat',
  bill_to_party: 'owner',
  base_price_cents: 0,
  after_hours_surcharge_cents: 0,
  target_turnaround_hours: '',
  includes: '',
  is_active: true,
};

const EMPTY_COMPLIANCE = {
  unit_id: '',
  record_type: 'Inspection',
  title: '',
  status: 'pending',
  due_date: '',
  vendor_name: '',
  document_url: '',
  notes: '',
};

function parseCommaList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function MetricCard({ label, value, hint }) {
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

export default function PropertyOperationsTab({ businessId, workspace, currency = 'USD', onRefresh, onJumpTab }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language || undefined;
  const metrics = workspace?.metrics || {};
  const settings = workspace?.settings || {};
  const units = workspace?.units || [];
  const packages = workspace?.packages || [];
  const compliance = workspace?.compliance || [];
  const followUps = workspace?.followUps || [];
  const recentRequests = workspace?.recentRequests || [];

  const [settingsForm, setSettingsForm] = useState(() => ({
    ...EMPTY_SETTINGS,
    ...settings,
    supported_issue_categories: (settings.supported_issue_categories || []).join(', '),
    trust_artifacts: (settings.trust_artifacts || []).join(', '),
    managed_property_types: (settings.managed_property_types || []).join(', '),
  }));
  const [savingSettings, setSavingSettings] = useState(false);

  const [unitForm, setUnitForm] = useState(EMPTY_UNIT);
  const [editingUnitId, setEditingUnitId] = useState(null);
  const [packageForm, setPackageForm] = useState(EMPTY_PACKAGE);
  const [editingPackageId, setEditingPackageId] = useState(null);
  const [complianceForm, setComplianceForm] = useState(EMPTY_COMPLIANCE);
  const [editingComplianceId, setEditingComplianceId] = useState(null);

  useEffect(() => {
    setSettingsForm({
      ...EMPTY_SETTINGS,
      ...settings,
      supported_issue_categories: (settings.supported_issue_categories || []).join(', '),
      trust_artifacts: (settings.trust_artifacts || []).join(', '),
      managed_property_types: (settings.managed_property_types || []).join(', '),
    });
  }, [settings]);

  const occupancySummary = useMemo(() => {
    const counts = units.reduce((acc, unit) => {
      acc[unit.occupancy_status] = (acc[unit.occupancy_status] || 0) + 1;
      return acc;
    }, {});
    return counts;
  }, [units]);

  async function handleSaveSettings() {
    setSavingSettings(true);
    try {
      await updatePropertyOperationsSettings(businessId, {
        ...settingsForm,
        supported_issue_categories: parseCommaList(settingsForm.supported_issue_categories),
        trust_artifacts: parseCommaList(settingsForm.trust_artifacts),
        managed_property_types: parseCommaList(settingsForm.managed_property_types),
      });
      toast.success(t('businessHub.propertyOps.toasts.settingsSaved'));
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || t('businessHub.propertyOps.toasts.settingsSaveError'));
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleSaveUnit(event) {
    event.preventDefault();
    try {
      if (editingUnitId) await updatePropertyUnit(businessId, editingUnitId, unitForm);
      else await createPropertyUnit(businessId, unitForm);
      toast.success(editingUnitId ? t('businessHub.propertyOps.toasts.unitUpdated') : t('businessHub.propertyOps.toasts.unitAdded'));
      setUnitForm(EMPTY_UNIT);
      setEditingUnitId(null);
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || t('businessHub.propertyOps.toasts.unitSaveError'));
    }
  }

  async function handleSavePackage(event) {
    event.preventDefault();
    try {
      const payload = {
        ...packageForm,
        includes: parseCommaList(packageForm.includes),
        base_price_cents: Number(packageForm.base_price_cents || 0),
        after_hours_surcharge_cents: Number(packageForm.after_hours_surcharge_cents || 0),
      };
      if (editingPackageId) await updatePropertyPackage(businessId, editingPackageId, payload);
      else await createPropertyPackage(businessId, payload);
      toast.success(editingPackageId ? t('businessHub.propertyOps.toasts.packageUpdated') : t('businessHub.propertyOps.toasts.packageAdded'));
      setPackageForm(EMPTY_PACKAGE);
      setEditingPackageId(null);
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || t('businessHub.propertyOps.toasts.packageSaveError'));
    }
  }

  async function handleSaveCompliance(event) {
    event.preventDefault();
    try {
      const payload = {
        ...complianceForm,
        unit_id: complianceForm.unit_id || null,
      };
      if (editingComplianceId) await updatePropertyComplianceRecord(businessId, editingComplianceId, payload);
      else await createPropertyComplianceRecord(businessId, payload);
      toast.success(editingComplianceId ? t('businessHub.propertyOps.toasts.complianceUpdated') : t('businessHub.propertyOps.toasts.complianceAdded'));
      setComplianceForm(EMPTY_COMPLIANCE);
      setEditingComplianceId(null);
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || t('businessHub.propertyOps.toasts.complianceSaveError'));
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-gray-800 bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.12),_transparent_36%),linear-gradient(135deg,rgba(17,24,39,0.98),rgba(15,23,42,0.96))] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.24)] sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <span className="inline-flex rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-100">
              {t('businessHub.propertyOps.badge')}
            </span>
            <h2 className="mt-4 text-3xl font-semibold text-white">{t('businessHub.propertyOps.title')}</h2>
            <p className="mt-3 text-sm leading-7 text-gray-300">{t('businessHub.propertyOps.description')}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:min-w-[360px]">
            <MetricCard label={t('businessHub.propertyOps.metrics.unitsTracked')} value={metrics.total_units || 0} hint={t('businessHub.propertyOps.metrics.unitsTrackedHint', { occupied: occupancySummary.occupied || 0, turnover: occupancySummary.turnover || 0 })} />
            <MetricCard label={t('businessHub.propertyOps.metrics.complianceRisk')} value={metrics.compliance_overdue || 0} hint={t('businessHub.propertyOps.metrics.complianceRiskHint')} />
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-4">
        <MetricCard label={t('businessHub.propertyOps.metrics.openRequests')} value={metrics.open_requests || 0} hint={t('businessHub.propertyOps.metrics.openRequestsHint')} />
        <MetricCard label={t('businessHub.propertyOps.metrics.followUpsDue')} value={metrics.follow_up_requests || 0} hint={t('businessHub.propertyOps.metrics.followUpsDueHint')} />
        <MetricCard label={t('businessHub.propertyOps.metrics.recordedCost')} value={formatMoney(metrics.recorded_cost_total || 0, { currency })} hint={t('businessHub.propertyOps.metrics.recordedCostHint')} />
        <MetricCard label={t('businessHub.propertyOps.metrics.activePackages')} value={metrics.active_packages || 0} hint={t('businessHub.propertyOps.metrics.activePackagesHint')} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <Section
          title={t('businessHub.propertyOps.followUpQueue.title')}
          subtitle={t('businessHub.propertyOps.followUpQueue.subtitle')}
          actions={<button type="button" className="bh-btn" onClick={() => onRefresh?.()}>{t('businessHub.propertyOps.common.refresh')}</button>}
        >
          {followUps.length === 0 ? (
            <div className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-4 text-sm text-gray-400">
              {t('businessHub.propertyOps.followUpQueue.empty')}
            </div>
          ) : (
            <div className="space-y-3">
              {followUps.map((item) => (
                <div key={item.id} className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{item.title}</p>
                      <p className="mt-1 text-sm leading-6 text-gray-400">{item.detail}</p>
                    </div>
                    <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200">
                      {item.due_at ? new Date(item.due_at).toLocaleDateString(locale) : t('businessHub.propertyOps.followUpQueue.dueNow')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          title={t('businessHub.propertyOps.recentWorkflow.title')}
          subtitle={t('businessHub.propertyOps.recentWorkflow.subtitle')}
          actions={(
            <button type="button" className="bh-btn" onClick={() => onJumpTab?.('maintenance')}>
              {t('businessHub.propertyOps.recentWorkflow.openMaintenance')}
            </button>
          )}
        >
          <div className="space-y-3">
            {recentRequests.length === 0 ? (
              <div className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-4 text-sm text-gray-400">
                {t('businessHub.propertyOps.recentWorkflow.empty')}
              </div>
            ) : recentRequests.map((request) => (
              <div key={request.id} className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-blue-400/10 px-2.5 py-1 text-[11px] font-semibold text-blue-200">{request.workflow_stage}</span>
                  <span className="rounded-full bg-gray-800 px-2.5 py-1 text-[11px] font-semibold text-gray-300">{request.status}</span>
                  <span className="rounded-full bg-rose-400/10 px-2.5 py-1 text-[11px] font-semibold text-rose-200">{request.urgency}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-white">{request.title}</p>
                <p className="mt-1 text-sm text-gray-400">
                  {(request.property_label || t('businessHub.propertyOps.recentWorkflow.propertyFallback'))}{request.unit_label ? ` · ${request.unit_label}` : ''}{request.vendor_name ? ` · ${request.vendor_name}` : ''}
                </p>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section
        title={t('businessHub.propertyOps.settings.title')}
        subtitle={t('businessHub.propertyOps.settings.subtitle')}
        actions={<button type="button" className="bh-btn primary" onClick={handleSaveSettings} disabled={savingSettings}>{savingSettings ? t('businessHub.propertyOps.common.saving') : t('businessHub.propertyOps.common.saveSettings')}</button>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Input label={t('businessHub.propertyOps.settings.emergencyPhone')}>
            <TextInput value={settingsForm.emergency_phone} onChange={(e) => setSettingsForm((current) => ({ ...current, emergency_phone: e.target.value }))} placeholder={t('businessHub.propertyOps.settings.emergencyPhonePlaceholder')} />
          </Input>
          <Input label={t('businessHub.propertyOps.settings.defaultBillTo')}>
            <Select value={settingsForm.default_bill_to} onChange={(e) => setSettingsForm((current) => ({ ...current, default_bill_to: e.target.value }))}>
              <option value="owner">{t('businessHub.propertyOps.options.billTo.owner')}</option>
              <option value="tenant">{t('businessHub.propertyOps.options.billTo.tenant')}</option>
              <option value="hoa">HOA</option>
              <option value="internal">{t('businessHub.propertyOps.options.billTo.internal')}</option>
            </Select>
          </Input>
          <Input label={t('businessHub.propertyOps.settings.responsePromiseHours')}>
            <TextInput type="number" min="1" value={settingsForm.response_promise_hours} onChange={(e) => setSettingsForm((current) => ({ ...current, response_promise_hours: e.target.value }))} />
          </Input>
          <Input label={t('businessHub.propertyOps.settings.followUpCadenceHours')}>
            <TextInput type="number" min="1" value={settingsForm.follow_up_interval_hours} onChange={(e) => setSettingsForm((current) => ({ ...current, follow_up_interval_hours: e.target.value }))} />
          </Input>
          <Input label={t('businessHub.propertyOps.settings.issueCategories')} wide>
            <TextInput value={settingsForm.supported_issue_categories} onChange={(e) => setSettingsForm((current) => ({ ...current, supported_issue_categories: e.target.value }))} placeholder={t('businessHub.propertyOps.settings.issueCategoriesPlaceholder')} />
          </Input>
          <Input label={t('businessHub.propertyOps.settings.trustArtifacts')} wide>
            <TextInput value={settingsForm.trust_artifacts} onChange={(e) => setSettingsForm((current) => ({ ...current, trust_artifacts: e.target.value }))} placeholder={t('businessHub.propertyOps.settings.trustArtifactsPlaceholder')} />
          </Input>
          <Input label={t('businessHub.propertyOps.settings.managedPropertyTypes')} wide>
            <TextInput value={settingsForm.managed_property_types} onChange={(e) => setSettingsForm((current) => ({ ...current, managed_property_types: e.target.value }))} placeholder={t('businessHub.propertyOps.settings.managedPropertyTypesPlaceholder')} />
          </Input>
          <Input label={t('businessHub.propertyOps.settings.tenantPortalIntro')} wide>
            <TextArea rows={3} value={settingsForm.tenant_portal_intro} onChange={(e) => setSettingsForm((current) => ({ ...current, tenant_portal_intro: e.target.value }))} placeholder={t('businessHub.propertyOps.settings.tenantPortalIntroPlaceholder')} />
          </Input>
          <Input label={t('businessHub.propertyOps.settings.emergencyInstructions')} wide>
            <TextArea rows={3} value={settingsForm.emergency_instructions} onChange={(e) => setSettingsForm((current) => ({ ...current, emergency_instructions: e.target.value }))} placeholder={t('businessHub.propertyOps.settings.emergencyInstructionsPlaceholder')} />
          </Input>
          <Input label={t('businessHub.propertyOps.settings.afterHoursPolicy')} wide>
            <TextArea rows={3} value={settingsForm.after_hours_policy} onChange={(e) => setSettingsForm((current) => ({ ...current, after_hours_policy: e.target.value }))} placeholder={t('businessHub.propertyOps.settings.afterHoursPolicyPlaceholder')} />
          </Input>
        </div>
      </Section>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Section title={t('businessHub.propertyOps.units.title')} subtitle={t('businessHub.propertyOps.units.subtitle')}>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSaveUnit}>
            <Input label={t('businessHub.propertyOps.units.propertyLabel')}><TextInput value={unitForm.property_label} onChange={(e) => setUnitForm((current) => ({ ...current, property_label: e.target.value }))} /></Input>
            <Input label={t('businessHub.propertyOps.units.unit')}><TextInput value={unitForm.unit_label} onChange={(e) => setUnitForm((current) => ({ ...current, unit_label: e.target.value }))} /></Input>
            <Input label={t('businessHub.propertyOps.units.propertyType')}><TextInput value={unitForm.property_type} onChange={(e) => setUnitForm((current) => ({ ...current, property_type: e.target.value }))} /></Input>
            <Input label={t('businessHub.propertyOps.units.occupancy')}>
              <Select value={unitForm.occupancy_status} onChange={(e) => setUnitForm((current) => ({ ...current, occupancy_status: e.target.value }))}>
                <option value="occupied">{t('businessHub.propertyOps.options.occupancy.occupied')}</option>
                <option value="vacant">{t('businessHub.propertyOps.options.occupancy.vacant')}</option>
                <option value="turnover">{t('businessHub.propertyOps.options.occupancy.turnover')}</option>
                <option value="owner_hold">{t('businessHub.propertyOps.options.occupancy.ownerHold')}</option>
              </Select>
            </Input>
            <Input label={t('businessHub.propertyOps.units.contactName')}><TextInput value={unitForm.contact_name} onChange={(e) => setUnitForm((current) => ({ ...current, contact_name: e.target.value }))} /></Input>
            <Input label={t('businessHub.propertyOps.units.contactPhone')}><TextInput value={unitForm.contact_phone} onChange={(e) => setUnitForm((current) => ({ ...current, contact_phone: e.target.value }))} /></Input>
            <Input label={t('businessHub.propertyOps.units.priorityTier')}><Select value={unitForm.priority_tier} onChange={(e) => setUnitForm((current) => ({ ...current, priority_tier: e.target.value }))}><option value="standard">{t('businessHub.propertyOps.options.priority.standard')}</option><option value="priority">{t('businessHub.propertyOps.options.priority.priority')}</option><option value="vip">{t('businessHub.propertyOps.options.priority.vip')}</option></Select></Input>
            <Input label={t('businessHub.propertyOps.units.accessSummary')} wide><TextArea rows={2} value={unitForm.access_summary} onChange={(e) => setUnitForm((current) => ({ ...current, access_summary: e.target.value }))} /></Input>
            <Input label={t('businessHub.propertyOps.units.notes')} wide><TextArea rows={2} value={unitForm.notes} onChange={(e) => setUnitForm((current) => ({ ...current, notes: e.target.value }))} /></Input>
            <div className="md:col-span-2 flex gap-3">
              <button className="bh-btn primary" type="submit">{editingUnitId ? t('businessHub.propertyOps.units.updateUnit') : t('businessHub.propertyOps.units.addUnit')}</button>
              {editingUnitId ? <button className="bh-btn" type="button" onClick={() => { setEditingUnitId(null); setUnitForm(EMPTY_UNIT); }}>{t('businessHub.propertyOps.common.cancel')}</button> : null}
            </div>
          </form>
          <div className="mt-5 space-y-3">
            {units.map((unit) => (
              <div key={unit.id} className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">{unit.property_label}{unit.unit_label ? ` · ${unit.unit_label}` : ''}</p>
                    <p className="mt-1 text-sm text-gray-400">{unit.property_type} · {unit.occupancy_status} · {unit.priority_tier}</p>
                    {unit.access_summary ? <p className="mt-2 text-sm leading-6 text-gray-400">{unit.access_summary}</p> : null}
                  </div>
                  <div className="flex gap-2">
                    <button className="bh-btn sm" type="button" onClick={() => { setEditingUnitId(unit.id); setUnitForm({ ...EMPTY_UNIT, ...unit }); }}>{t('businessHub.propertyOps.common.edit')}</button>
                    <button className="bh-btn sm danger" type="button" onClick={async () => { if (!window.confirm(t('businessHub.propertyOps.confirms.deleteUnit'))) return; await deletePropertyUnit(businessId, unit.id); toast.success(t('businessHub.propertyOps.toasts.unitDeleted')); await onRefresh?.(); }}>{t('businessHub.propertyOps.common.delete')}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title={t('businessHub.propertyOps.packages.title')} subtitle={t('businessHub.propertyOps.packages.subtitle')}>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSavePackage}>
            <Input label={t('businessHub.propertyOps.packages.packageName')}><TextInput value={packageForm.name} onChange={(e) => setPackageForm((current) => ({ ...current, name: e.target.value }))} /></Input>
            <Input label={t('businessHub.propertyOps.packages.pricingModel')}><Select value={packageForm.pricing_model} onChange={(e) => setPackageForm((current) => ({ ...current, pricing_model: e.target.value }))}><option value="flat">{t('businessHub.propertyOps.options.pricingModel.flat')}</option><option value="hourly">{t('businessHub.propertyOps.options.pricingModel.hourly')}</option><option value="inspection">{t('businessHub.propertyOps.options.pricingModel.inspection')}</option><option value="turnover">{t('businessHub.propertyOps.options.pricingModel.turnover')}</option><option value="retainer">{t('businessHub.propertyOps.options.pricingModel.retainer')}</option></Select></Input>
            <Input label={t('businessHub.propertyOps.packages.billTo')}><Select value={packageForm.bill_to_party} onChange={(e) => setPackageForm((current) => ({ ...current, bill_to_party: e.target.value }))}><option value="owner">{t('businessHub.propertyOps.options.billTo.owner')}</option><option value="tenant">{t('businessHub.propertyOps.options.billTo.tenant')}</option><option value="hoa">HOA</option><option value="internal">{t('businessHub.propertyOps.options.billTo.internal')}</option></Select></Input>
            <Input label={t('businessHub.propertyOps.packages.basePriceCents')}><TextInput type="number" min="0" value={packageForm.base_price_cents} onChange={(e) => setPackageForm((current) => ({ ...current, base_price_cents: e.target.value }))} /></Input>
            <Input label={t('businessHub.propertyOps.packages.afterHoursSurchargeCents')}><TextInput type="number" min="0" value={packageForm.after_hours_surcharge_cents} onChange={(e) => setPackageForm((current) => ({ ...current, after_hours_surcharge_cents: e.target.value }))} /></Input>
            <Input label={t('businessHub.propertyOps.packages.targetTurnaroundHours')}><TextInput type="number" min="0" value={packageForm.target_turnaround_hours} onChange={(e) => setPackageForm((current) => ({ ...current, target_turnaround_hours: e.target.value }))} /></Input>
            <Input label={t('businessHub.propertyOps.packages.descriptionLabel')} wide><TextArea rows={2} value={packageForm.description} onChange={(e) => setPackageForm((current) => ({ ...current, description: e.target.value }))} /></Input>
            <Input label={t('businessHub.propertyOps.packages.includes')} wide><TextInput value={packageForm.includes} onChange={(e) => setPackageForm((current) => ({ ...current, includes: e.target.value }))} placeholder={t('businessHub.propertyOps.packages.includesPlaceholder')} /></Input>
            <div className="md:col-span-2 flex gap-3">
              <button className="bh-btn primary" type="submit">{editingPackageId ? t('businessHub.propertyOps.packages.updatePackage') : t('businessHub.propertyOps.packages.addPackage')}</button>
              {editingPackageId ? <button className="bh-btn" type="button" onClick={() => { setEditingPackageId(null); setPackageForm(EMPTY_PACKAGE); }}>{t('businessHub.propertyOps.common.cancel')}</button> : null}
            </div>
          </form>
          <div className="mt-5 space-y-3">
            {packages.map((item) => (
              <div key={item.id} className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-white">{item.name}</p>
                      <span className="rounded-full bg-gray-800 px-2.5 py-1 text-[11px] font-semibold text-gray-300">{item.pricing_model}</span>
                      <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200">{item.bill_to_party}</span>
                    </div>
                    <p className="mt-1 text-sm text-gray-400">{formatMoney((item.base_price_cents || 0) / 100, { currency })} {t('businessHub.propertyOps.packages.baseSuffix')}{item.after_hours_surcharge_cents ? ` · ${formatMoney((item.after_hours_surcharge_cents || 0) / 100, { currency })} ${t('businessHub.propertyOps.packages.afterHoursSuffix')}` : ''}</p>
                    {item.description ? <p className="mt-2 text-sm leading-6 text-gray-400">{item.description}</p> : null}
                  </div>
                  <div className="flex gap-2">
                    <button className="bh-btn sm" type="button" onClick={() => { setEditingPackageId(item.id); setPackageForm({ ...EMPTY_PACKAGE, ...item, includes: (item.includes || []).join(', ') }); }}>{t('businessHub.propertyOps.common.edit')}</button>
                    <button className="bh-btn sm danger" type="button" onClick={async () => { if (!window.confirm(t('businessHub.propertyOps.confirms.deletePackage'))) return; await deletePropertyPackage(businessId, item.id); toast.success(t('businessHub.propertyOps.toasts.packageDeleted')); await onRefresh?.(); }}>{t('businessHub.propertyOps.common.delete')}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section title={t('businessHub.propertyOps.compliance.title')} subtitle={t('businessHub.propertyOps.compliance.subtitle')}>
        <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSaveCompliance}>
          <Input label={t('businessHub.propertyOps.compliance.unit')}><Select value={complianceForm.unit_id} onChange={(e) => setComplianceForm((current) => ({ ...current, unit_id: e.target.value }))}><option value="">{t('businessHub.propertyOps.compliance.generalWholeProperty')}</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.property_label}{unit.unit_label ? ` · ${unit.unit_label}` : ''}</option>)}</Select></Input>
          <Input label={t('businessHub.propertyOps.compliance.recordType')}><TextInput value={complianceForm.record_type} onChange={(e) => setComplianceForm((current) => ({ ...current, record_type: e.target.value }))} /></Input>
          <Input label={t('businessHub.propertyOps.compliance.titleLabel')}><TextInput value={complianceForm.title} onChange={(e) => setComplianceForm((current) => ({ ...current, title: e.target.value }))} /></Input>
          <Input label={t('businessHub.propertyOps.compliance.status')}><Select value={complianceForm.status} onChange={(e) => setComplianceForm((current) => ({ ...current, status: e.target.value }))}><option value="pending">{t('businessHub.propertyOps.options.complianceStatus.pending')}</option><option value="in_progress">{t('businessHub.propertyOps.options.complianceStatus.inProgress')}</option><option value="complete">{t('businessHub.propertyOps.options.complianceStatus.complete')}</option><option value="overdue">{t('businessHub.propertyOps.options.complianceStatus.overdue')}</option></Select></Input>
          <Input label={t('businessHub.propertyOps.compliance.dueDate')}><TextInput type="date" value={complianceForm.due_date} onChange={(e) => setComplianceForm((current) => ({ ...current, due_date: e.target.value }))} /></Input>
          <Input label={t('businessHub.propertyOps.compliance.vendor')}><TextInput value={complianceForm.vendor_name} onChange={(e) => setComplianceForm((current) => ({ ...current, vendor_name: e.target.value }))} /></Input>
          <Input label={t('businessHub.propertyOps.compliance.documentUrl')} wide><TextInput value={complianceForm.document_url} onChange={(e) => setComplianceForm((current) => ({ ...current, document_url: e.target.value }))} /></Input>
          <Input label={t('businessHub.propertyOps.compliance.notes')} wide><TextArea rows={2} value={complianceForm.notes} onChange={(e) => setComplianceForm((current) => ({ ...current, notes: e.target.value }))} /></Input>
          <div className="md:col-span-2 flex gap-3">
            <button className="bh-btn primary" type="submit">{editingComplianceId ? t('businessHub.propertyOps.compliance.updateRecord') : t('businessHub.propertyOps.compliance.addRecord')}</button>
            {editingComplianceId ? <button className="bh-btn" type="button" onClick={() => { setEditingComplianceId(null); setComplianceForm(EMPTY_COMPLIANCE); }}>{t('businessHub.propertyOps.common.cancel')}</button> : null}
          </div>
        </form>
        <div className="mt-5 space-y-3">
          {compliance.map((record) => (
            <div key={record.id} className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-white">{record.title}</p>
                    <span className="rounded-full bg-gray-800 px-2.5 py-1 text-[11px] font-semibold text-gray-300">{record.record_type}</span>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${record.status === 'overdue' ? 'bg-rose-400/10 text-rose-200' : record.status === 'complete' ? 'bg-emerald-400/10 text-emerald-200' : 'bg-amber-400/10 text-amber-200'}`}>{record.status}</span>
                  </div>
                  <p className="mt-1 text-sm text-gray-400">{record.unit_property_label || t('businessHub.propertyOps.compliance.generalRecord')}{record.due_date ? ` · ${t('businessHub.propertyOps.compliance.duePrefix')} ${new Date(record.due_date).toLocaleDateString(locale)}` : ''}</p>
                </div>
                <div className="flex gap-2">
                  <button className="bh-btn sm" type="button" onClick={() => { setEditingComplianceId(record.id); setComplianceForm({ ...EMPTY_COMPLIANCE, ...record, due_date: record.due_date ? String(record.due_date).slice(0, 10) : '' }); }}>{t('businessHub.propertyOps.common.edit')}</button>
                  <button className="bh-btn sm danger" type="button" onClick={async () => { if (!window.confirm(t('businessHub.propertyOps.confirms.deleteRecord'))) return; await deletePropertyComplianceRecord(businessId, record.id); toast.success(t('businessHub.propertyOps.toasts.complianceDeleted')); await onRefresh?.(); }}>{t('businessHub.propertyOps.common.delete')}</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
