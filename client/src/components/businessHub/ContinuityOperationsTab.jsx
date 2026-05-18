import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  createContinuityPlan,
  createContinuityTrustRecord,
  deleteContinuityPlan,
  deleteContinuityTrustRecord,
  updateContinuityIntakeRequest,
  updateContinuityOperationsSettings,
  updateContinuityPlan,
  updateContinuityTrustRecord,
} from '../../api/continuityOperations';
import { formatMoney } from '../../lib/format';

const EMPTY_SETTINGS = {
  response_promise_hours: 12,
  intake_label: 'Guided intake and continuity planning',
  follow_up_window_days: 14,
  next_session_window_days: 14,
  preferred_contact_channel: 'message',
  intake_focuses: '',
  trust_artifacts: '',
  plan_focuses: '',
  progress_prompts: '',
  consent_requirements: '',
  guardian_policy: '',
  prep_expectations: '',
  continuity_pitch: '',
  emergency_contact_phone: '',
};

const EMPTY_PLAN = {
  plan_name: '',
  plan_type: 'membership',
  target_templates: 'wellness_therapy',
  description: '',
  price_cents: '',
  session_count: '',
  cadence_label: '',
  focus_areas: '',
  active: true,
};

const EMPTY_TRUST = {
  record_type: 'Credential',
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

function Input({ label, wide = false, children }) {
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

export default function ContinuityOperationsTab({ businessId, workspace, currency = 'USD', onRefresh, onJumpTab }) {
  const settings = workspace?.settings || {};
  const intakeRequests = workspace?.intakeRequests || [];
  const plans = workspace?.plans || [];
  const trustRecords = workspace?.trustRecords || [];
  const metrics = workspace?.metrics || {};
  const upcomingAppointments = workspace?.upcomingAppointments || [];

  const [settingsForm, setSettingsForm] = useState(EMPTY_SETTINGS);
  const [savingSettings, setSavingSettings] = useState(false);
  const [planForm, setPlanForm] = useState(EMPTY_PLAN);
  const [editingPlanId, setEditingPlanId] = useState(null);
  const [trustForm, setTrustForm] = useState(EMPTY_TRUST);
  const [editingTrustId, setEditingTrustId] = useState(null);

  useEffect(() => {
    setSettingsForm({
      ...EMPTY_SETTINGS,
      ...settings,
      intake_focuses: (settings.intake_focuses || []).join(', '),
      trust_artifacts: (settings.trust_artifacts || []).join(', '),
      plan_focuses: (settings.plan_focuses || []).join(', '),
      progress_prompts: (settings.progress_prompts || []).join(', '),
      consent_requirements: (settings.consent_requirements || []).join(', '),
    });
  }, [settings]);

  const groupedRequests = useMemo(() => ({
    intake: intakeRequests.filter((item) => ['new', 'qualified'].includes(item.status)),
    active: intakeRequests.filter((item) => ['scheduled', 'active', 'progress_review'].includes(item.status)),
    retention: intakeRequests.filter((item) => ['continuing', 'completed'].includes(item.status)),
  }), [intakeRequests]);

  async function saveSettings() {
    setSavingSettings(true);
    try {
      await updateContinuityOperationsSettings(businessId, {
        ...settingsForm,
        intake_focuses: parseCommaList(settingsForm.intake_focuses),
        trust_artifacts: parseCommaList(settingsForm.trust_artifacts),
        plan_focuses: parseCommaList(settingsForm.plan_focuses),
        progress_prompts: parseCommaList(settingsForm.progress_prompts),
        consent_requirements: parseCommaList(settingsForm.consent_requirements),
      });
      toast.success('Continuity settings saved');
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not save continuity settings');
    } finally {
      setSavingSettings(false);
    }
  }

  async function savePlan(event) {
    event.preventDefault();
    try {
      const payload = {
        ...planForm,
        target_templates: parseCommaList(planForm.target_templates),
        focus_areas: parseCommaList(planForm.focus_areas),
        price_cents: planForm.price_cents ? Number(planForm.price_cents) : 0,
        session_count: planForm.session_count ? Number(planForm.session_count) : null,
      };
      if (editingPlanId) await updateContinuityPlan(businessId, editingPlanId, payload);
      else await createContinuityPlan(businessId, payload);
      toast.success(editingPlanId ? 'Plan updated' : 'Plan added');
      setPlanForm(EMPTY_PLAN);
      setEditingPlanId(null);
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not save plan');
    }
  }

  async function saveTrustRecord(event) {
    event.preventDefault();
    try {
      if (editingTrustId) await updateContinuityTrustRecord(businessId, editingTrustId, trustForm);
      else await createContinuityTrustRecord(businessId, trustForm);
      toast.success(editingTrustId ? 'Trust record updated' : 'Trust record added');
      setTrustForm(EMPTY_TRUST);
      setEditingTrustId(null);
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not save trust record');
    }
  }

  async function quickUpdateRequest(requestId, patch) {
    try {
      await updateContinuityIntakeRequest(businessId, requestId, patch);
      toast.success('Continuity intake updated');
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not update continuity intake');
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-gray-800 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.16),_transparent_36%),linear-gradient(135deg,rgba(24,24,27,0.98),rgba(15,23,42,0.96))] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.24)] sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <span className="inline-flex rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-100">
              Continuity Ops
            </span>
            <h2 className="mt-4 text-3xl font-semibold text-white">Recurring intake, progress, and retention operating system</h2>
            <p className="mt-3 text-sm leading-7 text-gray-300">
              Run guided intake, continuity plans, guardian or trust expectations, and next-session follow-through for wellness, care, tutoring, and other relationship-led templates.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:min-w-[360px]">
            <Card label="Open intakes" value={metrics.open_requests || 0} hint={`${metrics.upcoming_appointments || 0} upcoming appointments`} />
            <Card label="Continuing clients" value={metrics.continuity_clients || 0} hint={`${metrics.follow_up_due || 0} follow-ups due`} />
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-4">
        <Card label="Next sessions due" value={metrics.next_sessions_due || 0} hint="People who need their next recommended touchpoint" />
        <Card label="Completed 30d" value={metrics.completed_last_30 || 0} hint="Appointments closed in the last month" />
        <Card label="Active plans" value={metrics.active_plans || 0} hint={`${formatMoney((metrics.plan_value_cents || 0) / 100, { currency })} in live continuity pricing`} />
        <Card label="Trust records" value={metrics.active_trust_records || 0} hint={`${metrics.trust_expiring || 0} expiring or expired`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.95fr]">
        <Section
          title="Continuity intake pipeline"
          subtitle="Move new goals into qualification, scheduled sessions, progress review, and retention follow-up without losing context."
          actions={<button type="button" className="bh-btn" onClick={() => onJumpTab?.('calendar')}>Open schedule</button>}
        >
          <div className="space-y-4">
            {intakeRequests.slice(0, 12).map((item) => (
              <div key={item.id} className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-gray-800 px-2.5 py-1 text-[11px] font-semibold text-gray-300">{item.template_slug}</span>
                      <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-200">{item.workflow_stage}</span>
                      <span className="rounded-full bg-sky-400/10 px-2.5 py-1 text-[11px] font-semibold text-sky-200">{item.relationship_type}</span>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-white">{item.primary_goal}</p>
                    <p className="mt-1 text-sm text-gray-400">
                      {item.progress_target || 'No progress target yet'}{item.age_or_level ? ` · ${item.age_or_level}` : ''}{item.contact_name ? ` · ${item.contact_name}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button className="bh-btn sm" type="button" onClick={() => quickUpdateRequest(item.id, { status: 'scheduled', workflow_stage: 'scheduling' })}>Schedule</button>
                    <button className="bh-btn sm" type="button" onClick={() => quickUpdateRequest(item.id, { status: 'continuing', workflow_stage: 'retention' })}>Continuing</button>
                  </div>
                </div>
              </div>
            ))}
            {intakeRequests.length === 0 ? <p className="text-sm text-gray-400">No continuity intake requests yet. Public guided intake will feed new recurring demand here.</p> : null}
          </div>
        </Section>

        <Section title="Queue snapshot" subtitle="Simple view of how recurring demand is moving across intake, live service, and retention.">
          <div className="space-y-4">
            <div className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">New and qualified</p>
              <p className="mt-2 text-sm text-gray-300">{groupedRequests.intake.length} people still need fit review, expectation-setting, or scheduling outreach.</p>
            </div>
            <div className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Active support</p>
              <p className="mt-2 text-sm text-gray-300">{groupedRequests.active.length} requests are in scheduling, live sessions, or progress-review mode.</p>
            </div>
            <div className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Retention rhythm</p>
              <p className="mt-2 text-sm text-gray-300">{groupedRequests.retention.length} people are in continuing or completed follow-through, where the next plan matters.</p>
            </div>
            <div className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Upcoming appointments</p>
              <div className="mt-2 space-y-2">
                {upcomingAppointments.length === 0 ? <p className="text-sm text-gray-400">No upcoming appointments linked yet.</p> : upcomingAppointments.slice(0, 4).map((item) => (
                  <p key={item.id} className="text-sm text-gray-300">{item.service_name || 'Session'} · {new Date(item.start_time).toLocaleString()}</p>
                ))}
              </div>
            </div>
          </div>
        </Section>
      </div>

      <Section
        title="Intake, trust, and continuity settings"
        subtitle="Control the intake promise, consent expectations, guardian guidance, and continuity framing customers see before they commit."
        actions={<button type="button" className="bh-btn primary" onClick={saveSettings} disabled={savingSettings}>{savingSettings ? 'Saving...' : 'Save settings'}</button>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Response promise (hours)"><TextInput type="number" min="1" value={settingsForm.response_promise_hours} onChange={(e) => setSettingsForm((current) => ({ ...current, response_promise_hours: e.target.value }))} /></Input>
          <Input label="Intake label"><TextInput value={settingsForm.intake_label} onChange={(e) => setSettingsForm((current) => ({ ...current, intake_label: e.target.value }))} /></Input>
          <Input label="Follow-up window (days)"><TextInput type="number" min="1" value={settingsForm.follow_up_window_days} onChange={(e) => setSettingsForm((current) => ({ ...current, follow_up_window_days: e.target.value }))} /></Input>
          <Input label="Next-session window (days)"><TextInput type="number" min="1" value={settingsForm.next_session_window_days} onChange={(e) => setSettingsForm((current) => ({ ...current, next_session_window_days: e.target.value }))} /></Input>
          <Input label="Preferred contact channel"><Select value={settingsForm.preferred_contact_channel} onChange={(e) => setSettingsForm((current) => ({ ...current, preferred_contact_channel: e.target.value }))}><option value="message">Message</option><option value="email">Email</option><option value="call">Call</option><option value="text">Text</option><option value="meeting">Meeting</option></Select></Input>
          <Input label="Emergency / front desk phone"><TextInput value={settingsForm.emergency_contact_phone} onChange={(e) => setSettingsForm((current) => ({ ...current, emergency_contact_phone: e.target.value }))} /></Input>
          <Input label="Intake focuses" wide><TextInput value={settingsForm.intake_focuses} onChange={(e) => setSettingsForm((current) => ({ ...current, intake_focuses: e.target.value }))} placeholder="Goals, routines, support context, recurring cadence" /></Input>
          <Input label="Trust artifacts" wide><TextInput value={settingsForm.trust_artifacts} onChange={(e) => setSettingsForm((current) => ({ ...current, trust_artifacts: e.target.value }))} placeholder="Safety-aware intake, guardian communication, progress updates" /></Input>
          <Input label="Plan focuses" wide><TextInput value={settingsForm.plan_focuses} onChange={(e) => setSettingsForm((current) => ({ ...current, plan_focuses: e.target.value }))} placeholder="Session packs, memberships, learning plans, recurring support" /></Input>
          <Input label="Progress prompts" wide><TextInput value={settingsForm.progress_prompts} onChange={(e) => setSettingsForm((current) => ({ ...current, progress_prompts: e.target.value }))} placeholder="Rebook suggestion, progress note, next-goal conversation" /></Input>
          <Input label="Consent requirements" wide><TextInput value={settingsForm.consent_requirements} onChange={(e) => setSettingsForm((current) => ({ ...current, consent_requirements: e.target.value }))} placeholder="Intake acknowledgement, communication preferences, guardian approval" /></Input>
          <Input label="Guardian / family policy" wide><TextArea rows={3} value={settingsForm.guardian_policy} onChange={(e) => setSettingsForm((current) => ({ ...current, guardian_policy: e.target.value }))} /></Input>
          <Input label="Prep expectations" wide><TextArea rows={3} value={settingsForm.prep_expectations} onChange={(e) => setSettingsForm((current) => ({ ...current, prep_expectations: e.target.value }))} /></Input>
          <Input label="Continuity pitch" wide><TextArea rows={3} value={settingsForm.continuity_pitch} onChange={(e) => setSettingsForm((current) => ({ ...current, continuity_pitch: e.target.value }))} /></Input>
        </div>
      </Section>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Section title="Continuity plans and package logic" subtitle="Package repeat support into memberships, plans, or session blocks the team can actually sell and renew.">
          <form className="grid gap-4 md:grid-cols-2" onSubmit={savePlan}>
            <Input label="Plan name"><TextInput value={planForm.plan_name} onChange={(e) => setPlanForm((current) => ({ ...current, plan_name: e.target.value }))} /></Input>
            <Input label="Type"><Select value={planForm.plan_type} onChange={(e) => setPlanForm((current) => ({ ...current, plan_type: e.target.value }))}><option value="membership">Membership</option><option value="session_pack">Session pack</option><option value="care_plan">Care plan</option><option value="learning_plan">Learning plan</option><option value="wellness_plan">Wellness plan</option></Select></Input>
            <Input label="Price cents"><TextInput type="number" min="0" value={planForm.price_cents} onChange={(e) => setPlanForm((current) => ({ ...current, price_cents: e.target.value }))} /></Input>
            <Input label="Session count"><TextInput type="number" min="0" value={planForm.session_count} onChange={(e) => setPlanForm((current) => ({ ...current, session_count: e.target.value }))} /></Input>
            <Input label="Cadence label"><TextInput value={planForm.cadence_label} onChange={(e) => setPlanForm((current) => ({ ...current, cadence_label: e.target.value }))} placeholder="Weekly, twice monthly, school-year plan" /></Input>
            <Input label="Target templates" wide><TextInput value={planForm.target_templates} onChange={(e) => setPlanForm((current) => ({ ...current, target_templates: e.target.value }))} placeholder="wellness_therapy, math_tutor, dog_walker" /></Input>
            <Input label="Focus areas" wide><TextInput value={planForm.focus_areas} onChange={(e) => setPlanForm((current) => ({ ...current, focus_areas: e.target.value }))} placeholder="Strength, anxiety support, exam prep, puppy routine" /></Input>
            <Input label="Description" wide><TextArea rows={2} value={planForm.description} onChange={(e) => setPlanForm((current) => ({ ...current, description: e.target.value }))} /></Input>
            <div className="md:col-span-2 flex gap-3">
              <button className="bh-btn primary" type="submit">{editingPlanId ? 'Update plan' : 'Add plan'}</button>
              {editingPlanId ? <button className="bh-btn" type="button" onClick={() => { setEditingPlanId(null); setPlanForm(EMPTY_PLAN); }}>Cancel</button> : null}
            </div>
          </form>
          <div className="mt-5 space-y-3">
            {plans.map((item) => (
              <div key={item.id} className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-white">{item.plan_name}</p>
                      <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">{item.plan_type}</span>
                    </div>
                    <p className="mt-2 text-sm text-gray-400">{item.description || 'No description yet.'}</p>
                    <p className="mt-2 text-xs text-gray-500">{formatMoney((item.price_cents || 0) / 100, { currency })}{item.cadence_label ? ` · ${item.cadence_label}` : ''}</p>
                  </div>
                  <div className="flex gap-2">
                    <button className="bh-btn sm" type="button" onClick={() => {
                      setEditingPlanId(item.id);
                      setPlanForm({
                        plan_name: item.plan_name || '',
                        plan_type: item.plan_type || 'membership',
                        target_templates: (item.target_templates || []).join(', '),
                        description: item.description || '',
                        price_cents: item.price_cents || '',
                        session_count: item.session_count || '',
                        cadence_label: item.cadence_label || '',
                        focus_areas: (item.focus_areas || []).join(', '),
                        active: item.active !== false,
                      });
                    }}>Edit</button>
                    <button className="bh-btn sm" type="button" onClick={async () => {
                      try {
                        await deleteContinuityPlan(businessId, item.id);
                        toast.success('Plan removed');
                        await onRefresh?.();
                      } catch (error) {
                        toast.error(error?.response?.data?.error || 'Could not remove plan');
                      }
                    }}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
            {plans.length === 0 ? <p className="text-sm text-gray-400">No continuity plans yet.</p> : null}
          </div>
        </Section>

        <Section title="Trust, credential, and compliance records" subtitle="Keep credentials, safety records, or documentation visible so continuity-led clients see the trust layer behind the work.">
          <form className="grid gap-4 md:grid-cols-2" onSubmit={saveTrustRecord}>
            <Input label="Record type"><TextInput value={trustForm.record_type} onChange={(e) => setTrustForm((current) => ({ ...current, record_type: e.target.value }))} /></Input>
            <Input label="Title"><TextInput value={trustForm.title} onChange={(e) => setTrustForm((current) => ({ ...current, title: e.target.value }))} /></Input>
            <Input label="Issuer"><TextInput value={trustForm.issuer} onChange={(e) => setTrustForm((current) => ({ ...current, issuer: e.target.value }))} /></Input>
            <Input label="Status"><Select value={trustForm.status} onChange={(e) => setTrustForm((current) => ({ ...current, status: e.target.value }))}><option value="active">Active</option><option value="expiring">Expiring</option><option value="expired">Expired</option><option value="archived">Archived</option></Select></Input>
            <Input label="Expires on"><TextInput type="date" value={trustForm.expires_on} onChange={(e) => setTrustForm((current) => ({ ...current, expires_on: e.target.value }))} /></Input>
            <Input label="Document URL"><TextInput value={trustForm.document_url} onChange={(e) => setTrustForm((current) => ({ ...current, document_url: e.target.value }))} /></Input>
            <Input label="Notes" wide><TextArea rows={3} value={trustForm.notes} onChange={(e) => setTrustForm((current) => ({ ...current, notes: e.target.value }))} /></Input>
            <div className="md:col-span-2 flex gap-3">
              <button className="bh-btn primary" type="submit">{editingTrustId ? 'Update record' : 'Add record'}</button>
              {editingTrustId ? <button className="bh-btn" type="button" onClick={() => { setEditingTrustId(null); setTrustForm(EMPTY_TRUST); }}>Cancel</button> : null}
            </div>
          </form>
          <div className="mt-5 space-y-3">
            {trustRecords.map((item) => (
              <div key={item.id} className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-white">{item.title}</p>
                      <span className="rounded-full bg-sky-400/10 px-2 py-0.5 text-[11px] font-semibold text-sky-200">{item.status}</span>
                    </div>
                    <p className="mt-2 text-sm text-gray-400">{item.record_type}{item.issuer ? ` · ${item.issuer}` : ''}{item.expires_on ? ` · expires ${item.expires_on}` : ''}</p>
                  </div>
                  <div className="flex gap-2">
                    <button className="bh-btn sm" type="button" onClick={() => {
                      setEditingTrustId(item.id);
                      setTrustForm({
                        record_type: item.record_type || '',
                        title: item.title || '',
                        issuer: item.issuer || '',
                        status: item.status || 'active',
                        expires_on: item.expires_on || '',
                        document_url: item.document_url || '',
                        notes: item.notes || '',
                      });
                    }}>Edit</button>
                    <button className="bh-btn sm" type="button" onClick={async () => {
                      try {
                        await deleteContinuityTrustRecord(businessId, item.id);
                        toast.success('Trust record removed');
                        await onRefresh?.();
                      } catch (error) {
                        toast.error(error?.response?.data?.error || 'Could not remove trust record');
                      }
                    }}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
            {trustRecords.length === 0 ? <p className="text-sm text-gray-400">No trust records yet.</p> : null}
          </div>
        </Section>
      </div>
    </div>
  );
}
