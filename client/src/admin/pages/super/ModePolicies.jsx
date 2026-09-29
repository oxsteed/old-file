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
        <div className="grid grid-cols-1 gap-4">
          {policies.map(p => (
            <PolicyCard key={p.mode} policy={p} onChange={handlePolicyChange} />
          ))}
        </div>
      )}
    </div>
  );
}
