// client/src/admin/pages/super/ModePolicies.jsx
//
// Super-admin page to toggle the platform-approval gate per mode and edit
// the application schema (the form a user sees when prompted).
//
// Backend:
//   GET   /api/admin/mode-policies
//   PATCH /api/admin/mode-policies/:mode

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Save, ToggleLeft, ToggleRight, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  adminListPolicies,
  adminUpdatePolicy,
} from '../../../api/modePlatformApprovals';

function ToggleRow({ label, checked, onChange, hint, disabled }) {
  return (
    <button
      type="button"
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
  const [requiresApproval, setRequiresApproval] = useState(policy.requires_approval);
  const [autoApprove, setAutoApprove] = useState(policy.auto_approve);
  const [gatedActions, setGatedActions] = useState((policy.gated_actions || []).join(', '));
  const [schemaText, setSchemaText] = useState(JSON.stringify(policy.application_schema || {}, null, 2));
  const [saving, setSaving] = useState(false);
  const [schemaError, setSchemaError] = useState(null);

  const dirty = requiresApproval !== policy.requires_approval
    || autoApprove !== policy.auto_approve
    || gatedActions !== (policy.gated_actions || []).join(', ')
    || schemaText !== JSON.stringify(policy.application_schema || {}, null, 2);

  const handleSave = async () => {
    let parsedSchema;
    try {
      parsedSchema = JSON.parse(schemaText);
    } catch (e) {
      setSchemaError('Invalid JSON');
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
      toast.success(`Policy for ${policy.mode} saved`);
      onChange?.(res.policy);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
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
            Updated {policy.updated_at ? new Date(policy.updated_at).toLocaleString() : '—'}
          </div>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {dirty ? 'Save changes' : 'Saved'}
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ToggleRow
          label="Requires approval"
          checked={requiresApproval}
          onChange={setRequiresApproval}
          hint="When ON, gated actions inside this mode are blocked until OxSteed approves the user."
        />
        <ToggleRow
          label="Auto-approve"
          checked={autoApprove}
          onChange={setAutoApprove}
          hint="When ON, valid submissions skip the queue and approve immediately."
          disabled={!requiresApproval}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Gated actions (comma-separated)</label>
        <input
          type="text"
          value={gatedActions}
          onChange={(e) => setGatedActions(e.target.value)}
          placeholder="e.g. accept_paying_booking, publish_listing"
          className="w-full py-2 px-3 bg-gray-800/50 border border-gray-700 rounded-md text-white text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
        />
        <p className="text-[11px] text-gray-500">App code passes one of these action codes to <code className="px-1 bg-gray-800 rounded">requirePlatformApproval(mode, action)</code>.</p>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Application schema (JSON)</label>
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
    </section>
  );
}

export default function ModePolicies() {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminListPolicies();
      setPolicies(res.policies || []);
    } catch (err) {
      toast.error('Failed to load policies');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handlePolicyChange = (updated) => {
    setPolicies(prev => prev.map(p => p.mode === updated.mode ? updated : p));
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white">Mode platform-approval policies</h1>
        <p className="text-sm text-gray-400 mt-1">
          Configure which modes require OxSteed approval before users can perform gated actions. Toggle auto-approve to skip manual review.
        </p>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-orange-500" />
        </div>
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
