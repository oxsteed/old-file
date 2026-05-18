import { useEffect, useMemo, useState } from 'react';
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
      toast.success('Property operations settings saved');
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not save property settings');
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleSaveUnit(event) {
    event.preventDefault();
    try {
      if (editingUnitId) await updatePropertyUnit(businessId, editingUnitId, unitForm);
      else await createPropertyUnit(businessId, unitForm);
      toast.success(editingUnitId ? 'Unit updated' : 'Unit added');
      setUnitForm(EMPTY_UNIT);
      setEditingUnitId(null);
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not save unit');
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
      toast.success(editingPackageId ? 'Package updated' : 'Package added');
      setPackageForm(EMPTY_PACKAGE);
      setEditingPackageId(null);
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not save package');
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
      toast.success(editingComplianceId ? 'Compliance record updated' : 'Compliance record added');
      setComplianceForm(EMPTY_COMPLIANCE);
      setEditingComplianceId(null);
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not save compliance record');
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-gray-800 bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.12),_transparent_36%),linear-gradient(135deg,rgba(17,24,39,0.98),rgba(15,23,42,0.96))] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.24)] sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <span className="inline-flex rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-100">
              Property Ops
            </span>
            <h2 className="mt-4 text-3xl font-semibold text-white">Property manager operating system</h2>
            <p className="mt-3 text-sm leading-7 text-gray-300">
              This tab turns the template into a live property workspace with units, tenant intake standards, compliance reminders,
              dispatch pricing, and follow-up queues tied to maintenance operations.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:min-w-[360px]">
            <MetricCard label="Units tracked" value={metrics.total_units || 0} hint={`${occupancySummary.occupied || 0} occupied · ${occupancySummary.turnover || 0} turnover`} />
            <MetricCard label="Compliance risk" value={metrics.compliance_overdue || 0} hint="Due or overdue records needing action" />
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-4">
        <MetricCard label="Open requests" value={metrics.open_requests || 0} hint="Current repair pipeline" />
        <MetricCard label="Follow-ups due" value={metrics.follow_up_requests || 0} hint="Requests waiting on next contact" />
        <MetricCard label="Recorded cost" value={formatMoney(metrics.recorded_cost_total || 0, { currency })} hint="Logged repair spend" />
        <MetricCard label="Active packages" value={metrics.active_packages || 0} hint="Billable service logic live" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <Section
          title="Follow-up Queue"
          subtitle="These reminders are auto-generated from stale maintenance requests and due compliance records."
          actions={<button type="button" className="bh-btn" onClick={() => onRefresh?.()}>Refresh</button>}
        >
          {followUps.length === 0 ? (
            <div className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-4 text-sm text-gray-400">
              No follow-ups are due right now.
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
                      {item.due_at ? new Date(item.due_at).toLocaleDateString() : 'Due now'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          title="Recent Property Workflow"
          subtitle="Recent maintenance items stay visible here so the operations tab and maintenance queue work together."
          actions={(
            <button type="button" className="bh-btn" onClick={() => onJumpTab?.('maintenance')}>
              Open maintenance
            </button>
          )}
        >
          <div className="space-y-3">
            {recentRequests.length === 0 ? (
              <div className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-4 text-sm text-gray-400">
                No maintenance requests have been logged yet.
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
                  {(request.property_label || 'Property')}{request.unit_label ? ` · ${request.unit_label}` : ''}{request.vendor_name ? ` · ${request.vendor_name}` : ''}
                </p>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section
        title="Tenant Intake and Trust Settings"
        subtitle="These settings change what the tenant sees, how maintenance gets categorized, and how quickly the team is expected to follow up."
        actions={<button type="button" className="bh-btn primary" onClick={handleSaveSettings} disabled={savingSettings}>{savingSettings ? 'Saving...' : 'Save settings'}</button>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Emergency phone">
            <TextInput value={settingsForm.emergency_phone} onChange={(e) => setSettingsForm((current) => ({ ...current, emergency_phone: e.target.value }))} placeholder="Optional emergency line" />
          </Input>
          <Input label="Default bill to">
            <Select value={settingsForm.default_bill_to} onChange={(e) => setSettingsForm((current) => ({ ...current, default_bill_to: e.target.value }))}>
              <option value="owner">Owner</option>
              <option value="tenant">Tenant</option>
              <option value="hoa">HOA</option>
              <option value="internal">Internal</option>
            </Select>
          </Input>
          <Input label="Response promise (hours)">
            <TextInput type="number" min="1" value={settingsForm.response_promise_hours} onChange={(e) => setSettingsForm((current) => ({ ...current, response_promise_hours: e.target.value }))} />
          </Input>
          <Input label="Follow-up cadence (hours)">
            <TextInput type="number" min="1" value={settingsForm.follow_up_interval_hours} onChange={(e) => setSettingsForm((current) => ({ ...current, follow_up_interval_hours: e.target.value }))} />
          </Input>
          <Input label="Issue categories" wide>
            <TextInput value={settingsForm.supported_issue_categories} onChange={(e) => setSettingsForm((current) => ({ ...current, supported_issue_categories: e.target.value }))} placeholder="Comma-separated categories" />
          </Input>
          <Input label="Trust artifacts" wide>
            <TextInput value={settingsForm.trust_artifacts} onChange={(e) => setSettingsForm((current) => ({ ...current, trust_artifacts: e.target.value }))} placeholder="Comma-separated trust cues" />
          </Input>
          <Input label="Managed property types" wide>
            <TextInput value={settingsForm.managed_property_types} onChange={(e) => setSettingsForm((current) => ({ ...current, managed_property_types: e.target.value }))} placeholder="Apartment, Duplex, HOA, Short-term rental" />
          </Input>
          <Input label="Tenant portal intro" wide>
            <TextArea rows={3} value={settingsForm.tenant_portal_intro} onChange={(e) => setSettingsForm((current) => ({ ...current, tenant_portal_intro: e.target.value }))} placeholder="Public guidance for tenants before they submit a request" />
          </Input>
          <Input label="Emergency instructions" wide>
            <TextArea rows={3} value={settingsForm.emergency_instructions} onChange={(e) => setSettingsForm((current) => ({ ...current, emergency_instructions: e.target.value }))} placeholder="What a tenant should do for flooding, fire, or safety issues" />
          </Input>
          <Input label="After-hours policy" wide>
            <TextArea rows={3} value={settingsForm.after_hours_policy} onChange={(e) => setSettingsForm((current) => ({ ...current, after_hours_policy: e.target.value }))} placeholder="After-hours dispatch or emergency-only guidance" />
          </Input>
        </div>
      </Section>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Section title="Portfolio Units" subtitle="Track units, occupants, access context, and priority tiers so dispatch happens with the right property context.">
          <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSaveUnit}>
            <Input label="Property label"><TextInput value={unitForm.property_label} onChange={(e) => setUnitForm((current) => ({ ...current, property_label: e.target.value }))} /></Input>
            <Input label="Unit"><TextInput value={unitForm.unit_label} onChange={(e) => setUnitForm((current) => ({ ...current, unit_label: e.target.value }))} /></Input>
            <Input label="Property type"><TextInput value={unitForm.property_type} onChange={(e) => setUnitForm((current) => ({ ...current, property_type: e.target.value }))} /></Input>
            <Input label="Occupancy">
              <Select value={unitForm.occupancy_status} onChange={(e) => setUnitForm((current) => ({ ...current, occupancy_status: e.target.value }))}>
                <option value="occupied">Occupied</option>
                <option value="vacant">Vacant</option>
                <option value="turnover">Turnover</option>
                <option value="owner_hold">Owner hold</option>
              </Select>
            </Input>
            <Input label="Contact name"><TextInput value={unitForm.contact_name} onChange={(e) => setUnitForm((current) => ({ ...current, contact_name: e.target.value }))} /></Input>
            <Input label="Contact phone"><TextInput value={unitForm.contact_phone} onChange={(e) => setUnitForm((current) => ({ ...current, contact_phone: e.target.value }))} /></Input>
            <Input label="Priority tier"><Select value={unitForm.priority_tier} onChange={(e) => setUnitForm((current) => ({ ...current, priority_tier: e.target.value }))}><option value="standard">Standard</option><option value="priority">Priority</option><option value="vip">VIP</option></Select></Input>
            <Input label="Access summary" wide><TextArea rows={2} value={unitForm.access_summary} onChange={(e) => setUnitForm((current) => ({ ...current, access_summary: e.target.value }))} /></Input>
            <Input label="Notes" wide><TextArea rows={2} value={unitForm.notes} onChange={(e) => setUnitForm((current) => ({ ...current, notes: e.target.value }))} /></Input>
            <div className="md:col-span-2 flex gap-3">
              <button className="bh-btn primary" type="submit">{editingUnitId ? 'Update unit' : 'Add unit'}</button>
              {editingUnitId ? <button className="bh-btn" type="button" onClick={() => { setEditingUnitId(null); setUnitForm(EMPTY_UNIT); }}>Cancel</button> : null}
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
                    <button className="bh-btn sm" type="button" onClick={() => { setEditingUnitId(unit.id); setUnitForm({ ...EMPTY_UNIT, ...unit }); }}>Edit</button>
                    <button className="bh-btn sm danger" type="button" onClick={async () => { if (!window.confirm('Delete this unit?')) return; await deletePropertyUnit(businessId, unit.id); toast.success('Unit deleted'); await onRefresh?.(); }}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Property Packages and Pricing" subtitle="Define dispatch, inspection, turnover, and retainer logic that this template can actually sell and bill against.">
          <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSavePackage}>
            <Input label="Package name"><TextInput value={packageForm.name} onChange={(e) => setPackageForm((current) => ({ ...current, name: e.target.value }))} /></Input>
            <Input label="Pricing model"><Select value={packageForm.pricing_model} onChange={(e) => setPackageForm((current) => ({ ...current, pricing_model: e.target.value }))}><option value="flat">Flat</option><option value="hourly">Hourly</option><option value="inspection">Inspection</option><option value="turnover">Turnover</option><option value="retainer">Retainer</option></Select></Input>
            <Input label="Bill to"><Select value={packageForm.bill_to_party} onChange={(e) => setPackageForm((current) => ({ ...current, bill_to_party: e.target.value }))}><option value="owner">Owner</option><option value="tenant">Tenant</option><option value="hoa">HOA</option><option value="internal">Internal</option></Select></Input>
            <Input label="Base price (cents)"><TextInput type="number" min="0" value={packageForm.base_price_cents} onChange={(e) => setPackageForm((current) => ({ ...current, base_price_cents: e.target.value }))} /></Input>
            <Input label="After-hours surcharge (cents)"><TextInput type="number" min="0" value={packageForm.after_hours_surcharge_cents} onChange={(e) => setPackageForm((current) => ({ ...current, after_hours_surcharge_cents: e.target.value }))} /></Input>
            <Input label="Target turnaround (hours)"><TextInput type="number" min="0" value={packageForm.target_turnaround_hours} onChange={(e) => setPackageForm((current) => ({ ...current, target_turnaround_hours: e.target.value }))} /></Input>
            <Input label="Description" wide><TextArea rows={2} value={packageForm.description} onChange={(e) => setPackageForm((current) => ({ ...current, description: e.target.value }))} /></Input>
            <Input label="Includes" wide><TextInput value={packageForm.includes} onChange={(e) => setPackageForm((current) => ({ ...current, includes: e.target.value }))} placeholder="Comma-separated inclusions" /></Input>
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
                      <p className="text-sm font-semibold text-white">{item.name}</p>
                      <span className="rounded-full bg-gray-800 px-2.5 py-1 text-[11px] font-semibold text-gray-300">{item.pricing_model}</span>
                      <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200">{item.bill_to_party}</span>
                    </div>
                    <p className="mt-1 text-sm text-gray-400">{formatMoney((item.base_price_cents || 0) / 100, { currency })} base{item.after_hours_surcharge_cents ? ` · ${formatMoney((item.after_hours_surcharge_cents || 0) / 100, { currency })} after-hours` : ''}</p>
                    {item.description ? <p className="mt-2 text-sm leading-6 text-gray-400">{item.description}</p> : null}
                  </div>
                  <div className="flex gap-2">
                    <button className="bh-btn sm" type="button" onClick={() => { setEditingPackageId(item.id); setPackageForm({ ...EMPTY_PACKAGE, ...item, includes: (item.includes || []).join(', ') }); }}>Edit</button>
                    <button className="bh-btn sm danger" type="button" onClick={async () => { if (!window.confirm('Delete this package?')) return; await deletePropertyPackage(businessId, item.id); toast.success('Package deleted'); await onRefresh?.(); }}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section title="Compliance and Trust Records" subtitle="Track inspections, recurring obligations, and trust artifacts that make the property template feel like an actual management system.">
        <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSaveCompliance}>
          <Input label="Unit"><Select value={complianceForm.unit_id} onChange={(e) => setComplianceForm((current) => ({ ...current, unit_id: e.target.value }))}><option value="">General / whole property</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.property_label}{unit.unit_label ? ` · ${unit.unit_label}` : ''}</option>)}</Select></Input>
          <Input label="Record type"><TextInput value={complianceForm.record_type} onChange={(e) => setComplianceForm((current) => ({ ...current, record_type: e.target.value }))} /></Input>
          <Input label="Title"><TextInput value={complianceForm.title} onChange={(e) => setComplianceForm((current) => ({ ...current, title: e.target.value }))} /></Input>
          <Input label="Status"><Select value={complianceForm.status} onChange={(e) => setComplianceForm((current) => ({ ...current, status: e.target.value }))}><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="complete">Complete</option><option value="overdue">Overdue</option></Select></Input>
          <Input label="Due date"><TextInput type="date" value={complianceForm.due_date} onChange={(e) => setComplianceForm((current) => ({ ...current, due_date: e.target.value }))} /></Input>
          <Input label="Vendor"><TextInput value={complianceForm.vendor_name} onChange={(e) => setComplianceForm((current) => ({ ...current, vendor_name: e.target.value }))} /></Input>
          <Input label="Document URL" wide><TextInput value={complianceForm.document_url} onChange={(e) => setComplianceForm((current) => ({ ...current, document_url: e.target.value }))} /></Input>
          <Input label="Notes" wide><TextArea rows={2} value={complianceForm.notes} onChange={(e) => setComplianceForm((current) => ({ ...current, notes: e.target.value }))} /></Input>
          <div className="md:col-span-2 flex gap-3">
            <button className="bh-btn primary" type="submit">{editingComplianceId ? 'Update record' : 'Add record'}</button>
            {editingComplianceId ? <button className="bh-btn" type="button" onClick={() => { setEditingComplianceId(null); setComplianceForm(EMPTY_COMPLIANCE); }}>Cancel</button> : null}
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
                  <p className="mt-1 text-sm text-gray-400">{record.unit_property_label || 'General record'}{record.due_date ? ` · due ${new Date(record.due_date).toLocaleDateString()}` : ''}</p>
                </div>
                <div className="flex gap-2">
                  <button className="bh-btn sm" type="button" onClick={() => { setEditingComplianceId(record.id); setComplianceForm({ ...EMPTY_COMPLIANCE, ...record, due_date: record.due_date ? String(record.due_date).slice(0, 10) : '' }); }}>Edit</button>
                  <button className="bh-btn sm danger" type="button" onClick={async () => { if (!window.confirm('Delete this record?')) return; await deletePropertyComplianceRecord(businessId, record.id); toast.success('Compliance record deleted'); await onRefresh?.(); }}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
