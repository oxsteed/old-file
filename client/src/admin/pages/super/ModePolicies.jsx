// client/src/admin/pages/super/ModePolicies.jsx
//
// Super-admin page to toggle the platform-approval gate per mode and edit
// the application schema (the form a user sees when prompted).
//
// Backend:
//   GET   /api/admin/mode-policies
//   PATCH /api/admin/mode-policies/:mode

import { useState } from 'react';
import { Loader2, Save, ToggleLeft, ToggleRight, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import api from '../../../api/axios';
import { useAbortableFetch } from '../../lib/useAbortableFetch';
import AdminErrorState from '../../lib/AdminErrorState';
import ConfirmDialog from '../../lib/ConfirmDialog';
import {
  adminListPolicyRevisions,
  adminRollbackPolicy,
  adminUpdatePolicy,
} from '../../../api/modePlatformApprovals';

function ToggleRow({ label, checked, onChange, hint, disabled }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className="w-full flex items-start gap-3 p-3 rounded-lg border border-gray-800 hover:border-gray-700 transition text-left"
    >
      {checked
        ? <ToggleRight size={26} className="text-orange-500 flex-shrink-0 mt-0.5" />
        : <ToggleLeft size={26} className="text-gray-600 flex-shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-white">{label}</div>
        {hint && <div className="text-xs text-gray-400 mt-0.5">{hint}</div>}
      </div>
    </button>
  );
}

function PolicyCard({ policy, onChange }) {
  const { t } = useTranslation();
  const [requiresApproval, setRequiresApproval] = useState(policy.requires_approval);
  const [autoApprove, setAutoApprove] = useState(policy.auto_approve);
  const [gatedActions, setGatedActions] = useState((policy.gated_actions || []).join(', '));
  const [schemaText, setSchemaText] = useState(JSON.stringify(policy.application_schema || {}, null, 2));
  const [saving, setSaving] = useState(false);
  const [schemaError, setSchemaError] = useState(null);
  const [confirmGateOff, setConfirmGateOff] = useState(false);
  const [revisions, setRevisions] = useState(null);
  const [loadingRevisions, setLoadingRevisions] = useState(false);
  const [rollbackRevision, setRollbackRevision] = useState(null);
  const [rollbackReason, setRollbackReason] = useState('');
  const [rollingBack, setRollingBack] = useState(false);

  const dirty = requiresApproval !== policy.requires_approval
    || autoApprove !== policy.auto_approve
    || gatedActions !== (policy.gated_actions || []).join(', ')
    || schemaText !== JSON.stringify(policy.application_schema || {}, null, 2);

  // Turning the approval gate OFF is a safety downgrade: require confirmation.
  const turningGateOff = policy.requires_approval && !requiresApproval;

  const doSave = async () => {
    let parsedSchema;
    try {
      parsedSchema = JSON.parse(schemaText);
    } catch (e) {
      setSchemaError(t('superModePolicies.invalidJson'));
      return;
    }
    setSchemaError(null);
    setSaving(true);
    try {
      const res = await adminUpdatePolicy(policy.mode, {
        requires_approval: requiresApproval,
        auto_approve: autoApprove,
        gated_actions: gatedActions.split(',').map(s => s.trim()).filter(Boolean),
        application_schema: parsedSchema,
        expected_updated_at: policy.updated_at,
        change_reason: 'Updated from the mode policy console',
      });
      toast.success(t('superModePolicies.savedToast', { mode: policy.mode }));
      onChange?.(res.policy);
    } catch (err) {
      throw new Error(err?.response?.data?.error || t('superPricingConfig.errorSave'));
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    if (turningGateOff) { setConfirmGateOff(true); return; }
    doSave().catch((err) => toast.error(err.message));
  };

  const confirmGateOffSave = async () => {
    try {
      await doSave();
    } catch (err) {
      throw err; // keep dialog open on failure
    }
  };

  const loadRevisions = async () => {
    setLoadingRevisions(true);
    try {
      const res = await adminListPolicyRevisions(policy.mode);
      setRevisions(res.revisions || []);
    } catch (err) {
      toast.error(err?.response?.data?.error || t('superModePolicies.historyFailed', { defaultValue: 'Could not load policy history.' }));
    } finally {
      setLoadingRevisions(false);
    }
  };

  const rollback = async () => {
    if (!rollbackRevision || rollbackReason.trim().length < 3) return;
    setRollingBack(true);
    try {
      const res = await adminRollbackPolicy(policy.mode, {
        revision_id: rollbackRevision.id,
        expected_updated_at: policy.updated_at,
        change_reason: rollbackReason.trim(),
      });
      toast.success(t('superModePolicies.rollbackSaved', { mode: policy.mode, defaultValue: 'Policy rollback saved for {{mode}}.' }));
      setRollbackRevision(null);
      setRollbackReason('');
      onChange?.(res.policy);
      await loadRevisions();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('superModePolicies.rollbackFailed', { defaultValue: 'Could not roll back this policy.' }));
    } finally {
      setRollingBack(false);
    }
  };

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-5 flex flex-col gap-4">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <ShieldCheck size={16} className="text-orange-500" />
            {policy.mode}
          </h3>
          <div className="text-xs text-gray-400 mt-0.5">
            {t('superModePolicies.updated', { date: policy.updated_at ? new Date(policy.updated_at).toLocaleString() : '—' })}
          </div>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {dirty ? t('superModePolicies.saveChanges') : t('superModePolicies.saved')}
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ToggleRow
          label={t('superModePolicies.requiresApproval')}
          checked={requiresApproval}
          onChange={setRequiresApproval}
          hint={t('superModePolicies.requiresApprovalHint')}
        />
        <ToggleRow
          label={t('superModePolicies.autoApprove')}
          checked={autoApprove}
          onChange={setAutoApprove}
          hint={t('superModePolicies.autoApproveHint')}
          disabled={!requiresApproval}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{t('superModePolicies.gatedLabel')}</label>
        <input
          type="text"
          value={gatedActions}
          onChange={(e) => setGatedActions(e.target.value)}
          placeholder="e.g. accept_paying_booking, publish_listing"
          className="w-full py-2 px-3 bg-gray-800/50 border border-gray-700 rounded-md text-white text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
        />
        <p className="text-[11px] text-gray-500">{t('superModePolicies.gatedHint')}</p>
      </div>

      <div className="border-t border-gray-800 pt-3">
        <button type="button" className="text-xs font-semibold text-orange-300 hover:text-orange-200" onClick={loadRevisions} disabled={loadingRevisions}>
          {loadingRevisions ? t('superModePolicies.loadingHistory', { defaultValue: 'Loading history...' }) : t('superModePolicies.showHistory', { defaultValue: 'Show immutable revision history' })}
        </button>
        {revisions && (
          <div className="mt-3 space-y-2" aria-live="polite">
            {!revisions.length && <p className="text-xs text-gray-500">{t('superModePolicies.noHistory', { defaultValue: 'No saved revisions yet.' })}</p>}
            {revisions.map((revision) => (
              <div key={revision.id} className="rounded-md border border-gray-800 bg-gray-950/40 p-2 text-xs text-gray-400">
                <div className="flex flex-wrap justify-between gap-2 items-center"><span>{revision.policy_updated_at || revision.created_at}</span><span>{revision.change_reason || t('superModePolicies.noReason', { defaultValue: 'No reason recorded' })}</span><button type="button" className="text-orange-300 hover:text-orange-200" onClick={() => { setRollbackRevision(revision); setRollbackReason(''); }}>{t('superModePolicies.rollback', { defaultValue: 'Rollback' })}</button></div>
                <div className="mt-1 text-gray-500">{revision.gated_actions?.join(', ') || t('superModePolicies.noGates', { defaultValue: 'No gated actions' })}</div>
                {rollbackRevision?.id === revision.id && (
                  <div className="mt-2 flex flex-wrap gap-2 items-center">
                    <input value={rollbackReason} onChange={(e) => setRollbackReason(e.target.value)} maxLength={1000} placeholder={t('superModePolicies.rollbackReason', { defaultValue: 'Why is this rollback needed?' })} aria-label={t('superModePolicies.rollbackReason', { defaultValue: 'Why is this rollback needed?' })} className="flex-1 min-w-[16rem] py-1.5 px-2 bg-gray-800 border border-gray-700 rounded text-white" />
                    <button type="button" onClick={rollback} disabled={rollingBack || rollbackReason.trim().length < 3} className="px-2 py-1.5 rounded bg-orange-500 text-white disabled:opacity-50">{rollingBack ? t('superModePolicies.rollingBack', { defaultValue: 'Rolling back…' }) : t('superModePolicies.confirmRollback', { defaultValue: 'Confirm rollback' })}</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{t('superModePolicies.schemaLabel')}</label>
        <textarea
          value={schemaText}
          onChange={(e) => { setSchemaText(e.target.value); setSchemaError(null); }}
          rows={12}
          className={`w-full py-2 px-3 bg-gray-800/50 border rounded-md text-white text-xs font-mono placeholder-gray-500 focus:outline-none focus:border-orange-500 ${schemaError ? 'border-red-500' : 'border-gray-700'}`}
        />
        {schemaError && <span className="text-[11px] text-red-400">{schemaError}</span>}
        <p className="text-[11px] text-gray-500">
          Shape: <code className="px-1 bg-gray-800 rounded">{'{ "fields": [{ "name", "type", "label", "required", "hint?", "minLength?", "maxLength?", "min?", "max?" }] }'}</code>
        </p>
      </div>

      <ConfirmDialog
        open={confirmGateOff}
        title={t('superModePolicies.confirmGateOffTitle')}
        message={t('superModePolicies.confirmGateOffMsg', { mode: policy.mode })}
        danger
        confirmLabel={t('superModePolicies.confirmGateOffLabel')}
        onConfirm={confirmGateOffSave}
        onClose={() => setConfirmGateOff(false)}
      />
    </section>
  );
}

export default function ModePolicies() {
  const { t } = useTranslation();

  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const res = await api.get('/admin/mode-policies', { signal });
    return res.data.policies || [];
  }, []);
  const policies = data || [];
  const { data: coverageData, loading: coverageLoading } = useAbortableFetch(async (signal) => {
    const res = await api.get('/admin/mode-policies/coverage', { signal });
    return res.data.coverage || [];
  }, []);
  const coverage = coverageData || [];

  const handlePolicyChange = (updated) => {
    reload();
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white">{t('superModePolicies.title')}</h1>
        <p className="text-sm text-gray-400 mt-1">
          {t('superModePolicies.subtitle')}
        </p>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-orange-500" />
        </div>
      ) : error ? (
        <AdminErrorState onRetry={reload} />
      ) : (
        <>
          <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
            <h2 className="text-base font-semibold text-white">{t('superModePolicies.coverageTitle', { defaultValue: 'Enforcement coverage' })}</h2>
            <p className="text-xs text-gray-400 mt-1">{t('superModePolicies.coverageHint', { defaultValue: 'Every registered gated action must be represented by a persisted policy. Missing or unknown actions are shown before release.' })}</p>
            {coverageLoading ? <p className="text-xs text-gray-500 mt-3">{t('superModePolicies.loadingCoverage', { defaultValue: 'Loading coverage…' })}</p> : (
              <div className="mt-3 grid gap-2">
                {coverage.map((item) => (
                  <div key={item.mode} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold text-white min-w-[7rem]">{item.mode}</span>
                    <span className={item.complete ? 'text-green-400' : 'text-red-400'}>{item.complete ? t('superModePolicies.coverageComplete', { defaultValue: 'Complete' }) : t('superModePolicies.coverageIncomplete', { defaultValue: 'Needs review' })}</span>
                    {item.missing_actions?.length > 0 && <span className="text-red-300">{t('superModePolicies.missingActions', { actions: item.missing_actions.join(', '), defaultValue: `Missing: ${item.missing_actions.join(', ')}` })}</span>}
                    {item.unknown_actions?.length > 0 && <span className="text-amber-300">{t('superModePolicies.unknownActions', { actions: item.unknown_actions.join(', '), defaultValue: `Unknown: ${item.unknown_actions.join(', ')}` })}</span>}
                  </div>
                ))}
              </div>
            )}
          </section>
          <div className="grid grid-cols-1 gap-4">
            {policies.map(p => (
              <PolicyCard key={p.mode} policy={p} onChange={handlePolicyChange} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
