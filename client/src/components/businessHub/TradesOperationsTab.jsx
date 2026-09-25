import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import {
  createTradesRecommendation,
  createTradesTrustRecord,
  updateTradesDiagnosticRequest,
  updateTradesOperationsSettings,
  updateTradesRecommendation,
  updateTradesTrustRecord,
  deleteTradesRecommendation,
  deleteTradesTrustRecord,
} from '../../api/tradesOperations';
import { formatMoney } from '../../lib/format';

const EMPTY_SETTINGS = {
  response_promise_hours: 12,
  estimate_turnaround_hours: 24,
  booking_style: 'diagnostic_first',
  primary_quote_label: '',
  supported_issue_types: '',
  service_asset_types: '',
  trust_artifacts: '',
  dispatch_notes: '',
  intake_instructions: '',
  emergency_phone: '',
};

const EMPTY_RECOMMENDATION = {
  diagnostic_request_id: '',
  quote_id: '',
  title: '',
  recommendation_type: 'repair',
  priority: 'recommended',
  description: '',
  estimated_cents: '',
  status: 'open',
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

export default function TradesOperationsTab({ businessId, workspace, currency = 'USD', onRefresh, onJumpTab }) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`businessHub.tradesOps.${key}`, options);
  const settings = workspace?.settings || {};
  const diagnostics = workspace?.diagnostics || [];
  const recommendations = workspace?.recommendations || [];
  const trustRecords = workspace?.trustRecords || [];
  const metrics = workspace?.metrics || {};

  const [settingsForm, setSettingsForm] = useState(EMPTY_SETTINGS);
  const [savingSettings, setSavingSettings] = useState(false);
  const [recommendationForm, setRecommendationForm] = useState(EMPTY_RECOMMENDATION);
  const [editingRecommendationId, setEditingRecommendationId] = useState(null);
  const [trustForm, setTrustForm] = useState(EMPTY_TRUST);
  const [editingTrustId, setEditingTrustId] = useState(null);

  useEffect(() => {
    setSettingsForm({
      ...EMPTY_SETTINGS,
      ...settings,
      primary_quote_label: settings.primary_quote_label || copy('defaultQuoteLabel'),
      supported_issue_types: (settings.supported_issue_types || []).join(', '),
      service_asset_types: (settings.service_asset_types || []).join(', '),
      trust_artifacts: (settings.trust_artifacts || []).join(', '),
    });
  }, [settings]);

  const groupedDiagnostics = useMemo(() => {
    return {
      urgent: diagnostics.filter((item) => ['emergency', 'urgent'].includes(item.urgency)),
      estimate: diagnostics.filter((item) => item.workflow_stage === 'estimate' || item.status === 'quoted'),
      repair: diagnostics.filter((item) => item.workflow_stage === 'repair' || item.status === 'approved'),
    };
  }, [diagnostics]);

  async function saveSettings() {
    setSavingSettings(true);
    try {
      await updateTradesOperationsSettings(businessId, {
        ...settingsForm,
        supported_issue_types: parseCommaList(settingsForm.supported_issue_types),
        service_asset_types: parseCommaList(settingsForm.service_asset_types),
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

  async function saveRecommendation(event) {
    event.preventDefault();
    try {
      const payload = {
        ...recommendationForm,
        quote_id: recommendationForm.quote_id || null,
        diagnostic_request_id: recommendationForm.diagnostic_request_id || null,
        estimated_cents: recommendationForm.estimated_cents ? Number(recommendationForm.estimated_cents) : null,
      };
      if (editingRecommendationId) await updateTradesRecommendation(businessId, editingRecommendationId, payload);
      else await createTradesRecommendation(businessId, payload);
      toast.success(editingRecommendationId ? copy('recommendationUpdated') : copy('recommendationAdded'));
      setRecommendationForm(EMPTY_RECOMMENDATION);
      setEditingRecommendationId(null);
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || copy('recommendationSaveFailed'));
    }
  }

  async function saveTrustRecord(event) {
    event.preventDefault();
    try {
      if (editingTrustId) await updateTradesTrustRecord(businessId, editingTrustId, trustForm);
      else await createTradesTrustRecord(businessId, trustForm);
      toast.success(editingTrustId ? copy('trustRecordUpdated') : copy('trustRecordAdded'));
      setTrustForm(EMPTY_TRUST);
      setEditingTrustId(null);
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || copy('trustRecordSaveFailed'));
    }
  }

  async function quickUpdateRequest(requestId, patch) {
    try {
      await updateTradesDiagnosticRequest(businessId, requestId, patch);
      toast.success(copy('requestUpdated'));
      await onRefresh?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || copy('requestUpdateFailed'));
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-gray-800 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.14),_transparent_36%),linear-gradient(135deg,rgba(17,24,39,0.98),rgba(15,23,42,0.96))] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.24)] sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <span className="inline-flex rounded-full border border-blue-400/25 bg-blue-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-100">
              {copy('label')}
            </span>
            <h2 className="mt-4 text-3xl font-semibold text-white">{copy('title')}</h2>
            <p className="mt-3 text-sm leading-7 text-gray-300">
              {copy('description')}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:min-w-[360px]">
            <Card label={copy('openDiagnostics')} value={metrics.open_requests || 0} hint={copy('diagnosticSplit', { auto: metrics.auto_requests || 0, field: metrics.field_requests || 0 })} />
            <Card label={copy('criticalRecommendations')} value={metrics.critical_recommendations || 0} hint={copy('criticalRecommendationsHint')} />
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-4">
        <Card label={copy('followUpsDue')} value={metrics.follow_up_due || 0} hint={copy('followUpsDueHint')} />
        <Card label={copy('slaRisk')} value={metrics.overdue_sla || 0} hint={copy('slaRiskHint')} />
        <Card label={copy('openValue')} value={formatMoney((metrics.open_recommendation_value || 0) / 100, { currency })} hint={copy('openValueHint')} />
        <Card label={copy('trustRecords')} value={metrics.active_trust_records || 0} hint={copy('trustExpiring', { count: metrics.trust_expiring || 0 })} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.95fr]">
        <Section
          title={copy('pipelineTitle')}
          subtitle={copy('pipelineSubtitle')}
          actions={<button type="button" className="bh-btn" onClick={() => onJumpTab?.('quotes')}>{copy('openQuotes')}</button>}
        >
          <div className="space-y-4">
            {diagnostics.slice(0, 12).map((item) => (
              <div key={item.id} className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-gray-800 px-2.5 py-1 text-[11px] font-semibold text-gray-300">{item.template_slug}</span>
                      <span className="rounded-full bg-blue-400/10 px-2.5 py-1 text-[11px] font-semibold text-blue-200">{item.workflow_stage}</span>
                      <span className="rounded-full bg-rose-400/10 px-2.5 py-1 text-[11px] font-semibold text-rose-200">{item.urgency}</span>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-white">{item.title}</p>
                    <p className="mt-1 text-sm text-gray-400">{item.issue_type}{item.asset_label ? ` · ${item.asset_label}` : ''}{item.vin ? ` · VIN ${item.vin}` : ''}</p>
                  </div>
                  <div className="flex gap-2">
                    <button className="bh-btn sm" type="button" onClick={() => quickUpdateRequest(item.id, { status: 'quoted', workflow_stage: 'estimate' })}>{copy('markQuoted')}</button>
                    <button className="bh-btn sm" type="button" onClick={() => quickUpdateRequest(item.id, { status: 'approved', workflow_stage: 'repair' })}>{copy('approveRepair')}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title={copy('queueSnapshot')}
          subtitle={copy('queueSnapshotSubtitle')}
          actions={<button type="button" className="bh-btn" onClick={() => onRefresh?.()}>{copy('refresh')}</button>}
        >
          <div className="space-y-4">
            <div className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{copy('urgent')}</p>
              <p className="mt-2 text-sm text-gray-300">{copy('urgentHint', { count: groupedDiagnostics.urgent.length })}</p>
            </div>
            <div className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{copy('estimateStage')}</p>
              <p className="mt-2 text-sm text-gray-300">{copy('estimateStageHint', { count: groupedDiagnostics.estimate.length })}</p>
            </div>
            <div className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{copy('repairApproved')}</p>
              <p className="mt-2 text-sm text-gray-300">{copy('repairApprovedHint', { count: groupedDiagnostics.repair.length })}</p>
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
          <Input label={copy('estimateTurnaround')}><TextInput type="number" min="1" value={settingsForm.estimate_turnaround_hours} onChange={(e) => setSettingsForm((current) => ({ ...current, estimate_turnaround_hours: e.target.value }))} /></Input>
          <Input label={copy('bookingStyle')}><Select value={settingsForm.booking_style} onChange={(e) => setSettingsForm((current) => ({ ...current, booking_style: e.target.value }))}>{['diagnostic_first', 'quote_first', 'direct_service'].map((style) => <option key={style} value={style}>{copy(`bookingStyles.${style}`)}</option>)}</Select></Input>
          <Input label={copy('primaryQuoteLabel')}><TextInput value={settingsForm.primary_quote_label} onChange={(e) => setSettingsForm((current) => ({ ...current, primary_quote_label: e.target.value }))} /></Input>
          <Input label={copy('emergencyPhone')}><TextInput value={settingsForm.emergency_phone} onChange={(e) => setSettingsForm((current) => ({ ...current, emergency_phone: e.target.value }))} /></Input>
          <Input label={copy('serviceAssetTypes')}><TextInput value={settingsForm.service_asset_types} onChange={(e) => setSettingsForm((current) => ({ ...current, service_asset_types: e.target.value }))} placeholder={copy('serviceAssetTypesPlaceholder')} /></Input>
          <Input label={copy('supportedIssueTypes')} wide><TextInput value={settingsForm.supported_issue_types} onChange={(e) => setSettingsForm((current) => ({ ...current, supported_issue_types: e.target.value }))} placeholder={copy('commaSeparatedPlaceholder')} /></Input>
          <Input label={copy('trustArtifacts')} wide><TextInput value={settingsForm.trust_artifacts} onChange={(e) => setSettingsForm((current) => ({ ...current, trust_artifacts: e.target.value }))} placeholder={copy('trustArtifactsPlaceholder')} /></Input>
          <Input label={copy('intakeInstructions')} wide><TextArea rows={3} value={settingsForm.intake_instructions} onChange={(e) => setSettingsForm((current) => ({ ...current, intake_instructions: e.target.value }))} /></Input>
          <Input label={copy('dispatchNotes')} wide><TextArea rows={3} value={settingsForm.dispatch_notes} onChange={(e) => setSettingsForm((current) => ({ ...current, dispatch_notes: e.target.value }))} /></Input>
        </div>
      </Section>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Section title={copy('recommendationsTitle')} subtitle={copy('recommendationsSubtitle')}>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={saveRecommendation}>
            <Input label={copy('diagnosticRequest')}><Select value={recommendationForm.diagnostic_request_id} onChange={(e) => setRecommendationForm((current) => ({ ...current, diagnostic_request_id: e.target.value }))}><option value="">{copy('unlinked')}</option>{diagnostics.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</Select></Input>
            <Input label={copy('quoteId')}><TextInput value={recommendationForm.quote_id} onChange={(e) => setRecommendationForm((current) => ({ ...current, quote_id: e.target.value }))} /></Input>
            <Input label={copy('titleField')}><TextInput value={recommendationForm.title} onChange={(e) => setRecommendationForm((current) => ({ ...current, title: e.target.value }))} /></Input>
            <Input label={copy('type')}><Select value={recommendationForm.recommendation_type} onChange={(e) => setRecommendationForm((current) => ({ ...current, recommendation_type: e.target.value }))}>{['repair', 'upgrade', 'maintenance', 'replacement', 'safety'].map((type) => <option key={type} value={type}>{copy(`recommendationTypes.${type}`)}</option>)}</Select></Input>
            <Input label={copy('priority')}><Select value={recommendationForm.priority} onChange={(e) => setRecommendationForm((current) => ({ ...current, priority: e.target.value }))}>{['critical', 'recommended', 'optional'].map((priority) => <option key={priority} value={priority}>{copy(`priorities.${priority}`)}</option>)}</Select></Input>
            <Input label={copy('statusField')}><Select value={recommendationForm.status} onChange={(e) => setRecommendationForm((current) => ({ ...current, status: e.target.value }))}>{['open', 'quoted', 'approved', 'completed', 'declined'].map((status) => <option key={status} value={status}>{copy(`statuses.${status}`)}</option>)}</Select></Input>
            <Input label={copy('estimatedCents')}><TextInput type="number" min="0" value={recommendationForm.estimated_cents} onChange={(e) => setRecommendationForm((current) => ({ ...current, estimated_cents: e.target.value }))} /></Input>
            <Input label={copy('descriptionField')} wide><TextArea rows={2} value={recommendationForm.description} onChange={(e) => setRecommendationForm((current) => ({ ...current, description: e.target.value }))} /></Input>
            <div className="md:col-span-2 flex gap-3">
              <button className="bh-btn primary" type="submit">{editingRecommendationId ? copy('updateRecommendation') : copy('addRecommendation')}</button>
              {editingRecommendationId ? <button className="bh-btn" type="button" onClick={() => { setEditingRecommendationId(null); setRecommendationForm(EMPTY_RECOMMENDATION); }}>{copy('cancel')}</button> : null}
            </div>
          </form>
          <div className="mt-5 space-y-3">
            {recommendations.map((item) => (
              <div key={item.id} className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-white">{item.title}</p>
                      <span className="rounded-full bg-gray-800 px-2.5 py-1 text-[11px] font-semibold text-gray-300">{item.recommendation_type}</span>
                      <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200">{item.priority}</span>
                    </div>
                    <p className="mt-1 text-sm text-gray-400">{item.description || copy('noDescription')}</p>
                    {item.estimated_cents != null ? <p className="mt-2 text-sm font-semibold text-white">{formatMoney((item.estimated_cents || 0) / 100, { currency })}</p> : null}
                  </div>
                  <div className="flex gap-2">
                    <button className="bh-btn sm" type="button" onClick={() => { setEditingRecommendationId(item.id); setRecommendationForm({ ...EMPTY_RECOMMENDATION, ...item, estimated_cents: item.estimated_cents ?? '' }); }}>{copy('edit')}</button>
                    <button className="bh-btn sm danger" type="button" onClick={async () => { if (!window.confirm(copy('deleteRecommendationConfirm'))) return; await deleteTradesRecommendation(businessId, item.id); toast.success(copy('recommendationDeleted')); await onRefresh?.(); }}>{copy('delete')}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title={copy('trustTitle')} subtitle={copy('trustSubtitle')}>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={saveTrustRecord}>
            <Input label={copy('recordType')}><TextInput value={trustForm.record_type} onChange={(e) => setTrustForm((current) => ({ ...current, record_type: e.target.value }))} /></Input>
            <Input label={copy('titleField')}><TextInput value={trustForm.title} onChange={(e) => setTrustForm((current) => ({ ...current, title: e.target.value }))} /></Input>
            <Input label={copy('issuer')}><TextInput value={trustForm.issuer} onChange={(e) => setTrustForm((current) => ({ ...current, issuer: e.target.value }))} /></Input>
            <Input label={copy('statusField')}><Select value={trustForm.status} onChange={(e) => setTrustForm((current) => ({ ...current, status: e.target.value }))}>{['active', 'expiring', 'expired', 'archived'].map((status) => <option key={status} value={status}>{copy(`trustStatuses.${status}`)}</option>)}</Select></Input>
            <Input label={copy('expiresOn')}><TextInput type="date" value={trustForm.expires_on} onChange={(e) => setTrustForm((current) => ({ ...current, expires_on: e.target.value }))} /></Input>
            <Input label={copy('documentUrl')}><TextInput value={trustForm.document_url} onChange={(e) => setTrustForm((current) => ({ ...current, document_url: e.target.value }))} /></Input>
            <Input label={copy('notesField')} wide><TextArea rows={2} value={trustForm.notes} onChange={(e) => setTrustForm((current) => ({ ...current, notes: e.target.value }))} /></Input>
            <div className="md:col-span-2 flex gap-3">
              <button className="bh-btn primary" type="submit">{editingTrustId ? copy('updateRecord') : copy('addRecord')}</button>
              {editingTrustId ? <button className="bh-btn" type="button" onClick={() => { setEditingTrustId(null); setTrustForm(EMPTY_TRUST); }}>{copy('cancel')}</button> : null}
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
                      <span className="rounded-full bg-blue-400/10 px-2.5 py-1 text-[11px] font-semibold text-blue-200">{copy(`trustStatuses.${item.status}`)}</span>
                    </div>
                    <p className="mt-1 text-sm text-gray-400">{item.issuer || copy('noIssuer')}{item.expires_on ? ` · ${copy('expiresOnText', { date: new Date(item.expires_on).toLocaleDateString() })}` : ''}</p>
                  </div>
                  <div className="flex gap-2">
                    <button className="bh-btn sm" type="button" onClick={() => { setEditingTrustId(item.id); setTrustForm({ ...EMPTY_TRUST, ...item, expires_on: item.expires_on ? String(item.expires_on).slice(0, 10) : '' }); }}>{copy('edit')}</button>
                    <button className="bh-btn sm danger" type="button" onClick={async () => { if (!window.confirm(copy('deleteRecordConfirm'))) return; await deleteTradesTrustRecord(businessId, item.id); toast.success(copy('trustRecordDeleted')); await onRefresh?.(); }}>{copy('delete')}</button>
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
