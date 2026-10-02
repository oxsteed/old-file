import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Scale, FileSignature, ShieldCheck, KeyRound, Plus, Loader2,
  Pencil, Ban, ExternalLink, X,
} from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import { useAbortableFetch } from '../../../lib/useAbortableFetch';
import AdminErrorState from '../../../lib/AdminErrorState';
import useDestructiveConfirm from '../../../hooks/useDestructiveConfirm';
import { adminDate } from '../../../lib/formatters';

const BASE = '/admin/super/governance';

function tKey(k) {
  return `wsGovernance.${k}`;
}

function ts(d, fallback = '-') {
  if (!d) return fallback;
  return adminDate(d, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function dateOnly(d) {
  if (!d) return '-';
  return adminDate(d, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Format a Date as a local (non-UTC) datetime-local input value.
function toLocalDatetimeInput(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Field({ label, children }) {
  return (
    <label className="block text-sm">
      <span className="text-gray-400">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputCls =
  'w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none';
const btnCls =
  'inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50';
const dangerBtnCls =
  'inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50';
const ghostBtnCls =
  'inline-flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-neutral-700 disabled:opacity-50';
const tabCls = (active) =>
  `flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${
    active ? 'bg-blue-600 text-white' : 'bg-neutral-800 text-gray-300 hover:bg-neutral-700'
  }`;

function useStatusLabel() {
  const { t } = useTranslation();
  return (status) => {
    const map = {
      draft: t(tKey('statusDraft'), 'Draft'),
      active: t(tKey('statusActive'), 'Active'),
      retired: t(tKey('statusRetired'), 'Retired'),
      expired: t(tKey('statusExpired'), 'Expired'),
      terminated: t(tKey('statusTerminated'), 'Terminated'),
      pending: t(tKey('statusPending'), 'Pending'),
    };
    return map[status] || status;
  };
}

function StatusBadge({ status }) {
  const statusLabel = useStatusLabel();
  const colors = {
    draft: 'bg-neutral-700 text-gray-300',
    active: 'bg-green-900 text-green-300',
    retired: 'bg-gray-700 text-gray-300',
    expired: 'bg-yellow-900 text-yellow-300',
    terminated: 'bg-red-900 text-red-300',
    pending: 'bg-yellow-900 text-yellow-300',
  };
  return (
    <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${colors[status] || colors.draft}`}>
      {statusLabel(status)}
    </span>
  );
}

function Modal({ title, icon: Icon, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="font-semibold text-white flex items-center gap-2">
            {Icon && <Icon size={16} className="text-blue-400" />}
            {title}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

// ── Policies tab ─────────────────────────────────────────────────────────────

function PoliciesTab() {
  const { t } = useTranslation();
  const { confirmDestructive, dialog } = useDestructiveConfirm();
  const [form, setForm] = useState({ code: '', title: '', category: '', body: '', effective_from: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [editing, setEditing] = useState(null);

  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const res = await adminApi.get(`${BASE}/policies`, { signal });
    return res.data.policies || [];
  }, []);
  const policies = data || [];

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      await adminApi.post(`${BASE}/policies`, {
        ...form,
        effective_from: form.effective_from || undefined,
      });
      setForm({ code: '', title: '', category: '', body: '', effective_from: '' });
      reload();
    } catch (err) {
      setSaveError(err.response?.data?.error || t(tKey('saveFailed'), 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  const retire = async (policy) => {
    if (!(await confirmDestructive({
      title: t(tKey('retireConfirmTitle'), 'Retire policy'),
      description: t(tKey('retireConfirmDesc'), 'Retiring keeps the record for the audit trail but takes it out of the active set. This cannot be undone from here.'),
      confirmLabel: t(tKey('retireConfirmLabel'), 'Retire policy'),
      requireTypeText: 'RETIRE',
    }))) return;
    try {
      await adminApi.post(`${BASE}/policies/${policy.id}/retire`);
      reload();
    } catch (err) {
      setSaveError(err.response?.data?.error || t(tKey('saveFailed'), 'Save failed.'));
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {dialog}
      <div className="lg:col-span-2 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 h-fit">
        <h2 className="text-base font-semibold text-white">{t(tKey('newPolicy'), 'New policy')}</h2>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <Field label={t(tKey('code'), 'Code (lowercase slug)')}>
            <input className={inputCls} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase().replace(/\s+/g, '-') })} placeholder="fraud-zero-tolerance" required />
          </Field>
          <Field label={t(tKey('policyTitle'), 'Title')}>
            <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </Field>
          <Field label={t(tKey('category'), 'Category')}>
            <input className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="trust-safety" required />
          </Field>
          <Field label={t(tKey('body'), 'Policy text')}>
            <textarea className={inputCls} rows={5} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required />
          </Field>
          <Field label={t(tKey('effectiveFrom'), 'Effective from (optional)')}>
            <input type="date" className={inputCls} value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} />
          </Field>
          {saveError && <p className="text-sm text-red-400">{saveError}</p>}
          <button type="submit" className={btnCls} disabled={saving}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            {t(tKey('createPolicy'), 'Create policy')}
          </button>
        </form>
      </div>

      <div className="lg:col-span-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
        <h2 className="text-base font-semibold text-white">{t(tKey('policiesTitle'), 'Policy registry')}</h2>
        {loading && <p className="mt-4 text-sm text-gray-400 flex items-center gap-2"><Loader2 size={16} className="animate-spin" /></p>}
        {error && <div className="mt-4"><AdminErrorState message={t(tKey('loadFailed'), 'Failed to load the policy registry.')} onRetry={reload} /></div>}
        {!loading && !error && policies.length === 0 && (
          <p className="mt-4 text-sm text-gray-400">{t(tKey('noPolicies'), 'No policies recorded yet.')}</p>
        )}
        {!loading && !error && policies.length > 0 && (
          <div className="mt-4 space-y-3">
            {policies.map((p) => (
              <div key={p.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm text-white">{p.code}</span>
                      <span className="text-xs text-gray-400">v{p.version}</span>
                      <StatusBadge status={p.status} />
                    </div>
                    <p className="mt-1 text-sm font-medium text-gray-200">{p.title}</p>
                    <p className="text-xs text-gray-500">{p.category}{p.effective_from ? `, effective ${dateOnly(p.effective_from)}` : ''}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button type="button" className={ghostBtnCls} onClick={() => setEditing(p)}>
                      <Pencil size={13} />{t(tKey('edit'), 'Edit')}
                    </button>
                    {p.status !== 'retired' && (
                      <button type="button" className={dangerBtnCls} onClick={() => retire(p)}>
                        <Ban size={13} />{t(tKey('retire'), 'Retire')}
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-sm text-gray-400 line-clamp-3">{p.body}</p>
                <p className="mt-2 text-xs text-gray-600">{t(tKey('updatedAt'), 'Updated')}: {ts(p.updated_at)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <PolicyEditModal
          policy={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

function PolicyEditModal({ policy, onClose, onSaved }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    title: policy.title || '',
    category: policy.category || '',
    body: policy.body || '',
    status: policy.status || 'draft',
    effective_from: policy.effective_from ? String(policy.effective_from).slice(0, 10) : '',
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      await adminApi.put(`${BASE}/policies/${policy.id}`, {
        ...form,
        effective_from: form.effective_from || null,
      });
      onSaved();
    } catch (err) {
      setSaveError(err.response?.data?.error || t(tKey('saveFailed'), 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t(tKey('editPolicy'), 'Edit policy')} icon={Scale} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label={t(tKey('code'), 'Code (lowercase slug)')}>
          <input className={inputCls} value={policy.code} disabled />
        </Field>
        <Field label={t(tKey('policyTitle'), 'Title')}>
          <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        </Field>
        <Field label={t(tKey('category'), 'Category')}>
          <input className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required />
        </Field>
        <Field label={t(tKey('body'), 'Policy text')}>
          <textarea className={inputCls} rows={5} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t(tKey('status'), 'Status')}>
            <select className={inputCls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="draft">{t(tKey('statusDraft'), 'Draft')}</option>
              <option value="active">{t(tKey('statusActive'), 'Active')}</option>
              <option value="retired">{t(tKey('statusRetired'), 'Retired')}</option>
            </select>
          </Field>
          <Field label={t(tKey('effectiveFrom'), 'Effective from (optional)')}>
            <input type="date" className={inputCls} value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} />
          </Field>
        </div>
        <p className="text-xs text-gray-500">{t(tKey('versionNote'), 'Saving creates a new version; the old text stays in the audit trail.')}</p>
        {saveError && <p className="text-sm text-red-400">{saveError}</p>}
        <div className="flex gap-2">
          <button type="submit" className={btnCls} disabled={saving}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            {t(tKey('saveChanges'), 'Save changes')}
          </button>
          <button type="button" className={ghostBtnCls} onClick={onClose}>{t(tKey('cancel'), 'Cancel')}</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Contracts tab ────────────────────────────────────────────────────────────

const CONTRACT_TYPES = ['vendor', 'partner', 'contractor', 'lease', 'insurance', 'other'];

function ContractsTab() {
  const { t } = useTranslation();
  const { confirmDestructive, dialog } = useDestructiveConfirm();
  const [form, setForm] = useState({
    counterparty: '', contract_type: 'vendor', title: '',
    signed_at: '', expires_at: '', storage_ref: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [terminatingId, setTerminatingId] = useState(null);
  const [termReason, setTermReason] = useState('');

  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const res = await adminApi.get(`${BASE}/contracts`, { signal });
    return res.data.contracts || [];
  }, []);
  const contracts = data || [];

  const contractTypeLabel = (ct) => t(tKey(`type${ct[0].toUpperCase()}${ct.slice(1)}`), ct);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      await adminApi.post(`${BASE}/contracts`, {
        ...form,
        signed_at: form.signed_at || undefined,
        expires_at: form.expires_at || undefined,
        storage_ref: form.storage_ref || undefined,
        notes: form.notes || undefined,
      });
      setForm({ counterparty: '', contract_type: 'vendor', title: '', signed_at: '', expires_at: '', storage_ref: '', notes: '' });
      reload();
    } catch (err) {
      setSaveError(err.response?.data?.error || t(tKey('saveFailed'), 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  const doTerminate = async (contract) => {
    if (!(await confirmDestructive({
      title: t(tKey('terminateConfirmTitle'), 'Terminate contract'),
      description: t(tKey('terminateConfirmDesc'), 'The contract record stays for the audit trail with a terminated status. This cannot be undone from here.'),
      confirmLabel: t(tKey('terminateConfirmLabel'), 'Terminate contract'),
      requireTypeText: 'TERMINATE',
    }))) return;
    try {
      await adminApi.post(`${BASE}/contracts/${contract.id}/terminate`, termReason ? { reason: termReason } : {});
      setTerminatingId(null);
      setTermReason('');
      reload();
    } catch (err) {
      setSaveError(err.response?.data?.error || t(tKey('saveFailed'), 'Save failed.'));
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {dialog}
      <div className="lg:col-span-2 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 h-fit">
        <h2 className="text-base font-semibold text-white">{t(tKey('newContract'), 'Record a contract')}</h2>
        <p className="mt-1 text-xs text-gray-500">{t(tKey('contractsNote'), 'Records only: legal execution and signatures stay outside this registry.')}</p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <Field label={t(tKey('counterparty'), 'Counterparty')}>
            <input className={inputCls} value={form.counterparty} onChange={(e) => setForm({ ...form, counterparty: e.target.value })} required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t(tKey('contractType'), 'Type')}>
              <select className={inputCls} value={form.contract_type} onChange={(e) => setForm({ ...form, contract_type: e.target.value })}>
                {CONTRACT_TYPES.map((ct) => <option key={ct} value={ct}>{contractTypeLabel(ct)}</option>)}
              </select>
            </Field>
            <Field label={t(tKey('contractTitle'), 'Title')}>
              <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t(tKey('signedAt'), 'Signed on')}>
              <input type="date" className={inputCls} value={form.signed_at} onChange={(e) => setForm({ ...form, signed_at: e.target.value })} />
            </Field>
            <Field label={t(tKey('expiresAt'), 'Expires on')}>
              <input type="date" className={inputCls} value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
            </Field>
          </div>
          <Field label={t(tKey('storageRef'), 'Storage reference (optional)')}>
            <input className={inputCls} value={form.storage_ref} onChange={(e) => setForm({ ...form, storage_ref: e.target.value })} placeholder="s3://contracts/vendor-2026.pdf" />
          </Field>
          <Field label={t(tKey('notes'), 'Notes (optional)')}>
            <textarea className={inputCls} rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          {saveError && <p className="text-sm text-red-400">{saveError}</p>}
          <button type="submit" className={btnCls} disabled={saving}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            {t(tKey('createContract'), 'Record contract')}
          </button>
        </form>
      </div>

      <div className="lg:col-span-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
        <h2 className="text-base font-semibold text-white">{t(tKey('contractsTitle'), 'Contract records')}</h2>
        {loading && <p className="mt-4 text-sm text-gray-400 flex items-center gap-2"><Loader2 size={16} className="animate-spin" /></p>}
        {error && <div className="mt-4"><AdminErrorState message={t(tKey('loadFailed'), 'Failed to load the policy registry.')} onRetry={reload} /></div>}
        {!loading && !error && contracts.length === 0 && (
          <p className="mt-4 text-sm text-gray-400">{t(tKey('noContracts'), 'No contracts recorded yet.')}</p>
        )}
        {!loading && !error && contracts.length > 0 && (
          <div className="mt-4 space-y-3">
            {contracts.map((c) => (
              <div key={c.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white">{c.title}</span>
                      <StatusBadge status={c.status} />
                    </div>
                    <p className="mt-1 text-sm text-gray-300">{c.counterparty}</p>
                    <p className="text-xs text-gray-500">
                      {contractTypeLabel(c.contract_type)}
                      {c.signed_at ? `, ${t(tKey('signedAt'), 'Signed on')} ${dateOnly(c.signed_at)}` : ''}
                      {c.expires_at ? `, ${t(tKey('expiresAt'), 'Expires on')} ${dateOnly(c.expires_at)}` : ''}
                    </p>
                    {c.storage_ref && <p className="mt-1 font-mono text-xs text-gray-500 break-all">{c.storage_ref}</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button type="button" className={ghostBtnCls} onClick={() => setEditing(c)}>
                      <Pencil size={13} />{t(tKey('edit'), 'Edit')}
                    </button>
                    {c.status !== 'terminated' && (
                      <button type="button" className={dangerBtnCls} onClick={() => setTerminatingId(c.id)}>
                        <Ban size={13} />{t(tKey('terminate'), 'Terminate')}
                      </button>
                    )}
                  </div>
                </div>
                {c.notes && <p className="mt-2 text-sm text-gray-400 whitespace-pre-line">{c.notes}</p>}
                {terminatingId === c.id && (
                  <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/20 p-3">
                    <Field label={t(tKey('terminationReason'), 'Termination reason (optional)')}>
                      <input className={inputCls} value={termReason} onChange={(e) => setTermReason(e.target.value)} placeholder={t(tKey('reasonPlaceholder'), 'Why is this contract ending?')} />
                    </Field>
                    <div className="mt-2 flex gap-2">
                      <button type="button" className={dangerBtnCls} onClick={() => doTerminate(c)}>
                        {t(tKey('confirmTermination'), 'Confirm termination')}
                      </button>
                      <button type="button" className={ghostBtnCls} onClick={() => { setTerminatingId(null); setTermReason(''); }}>
                        {t(tKey('cancel'), 'Cancel')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <ContractEditModal
          contract={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

function ContractEditModal({ contract, onClose, onSaved }) {
  const { t } = useTranslation();
  const contractTypeLabel = (ct) => t(tKey(`type${ct[0].toUpperCase()}${ct.slice(1)}`), ct);
  const [form, setForm] = useState({
    counterparty: contract.counterparty || '',
    contract_type: contract.contract_type || 'vendor',
    title: contract.title || '',
    signed_at: contract.signed_at ? String(contract.signed_at).slice(0, 10) : '',
    expires_at: contract.expires_at ? String(contract.expires_at).slice(0, 10) : '',
    storage_ref: contract.storage_ref || '',
    notes: contract.notes || '',
    status: contract.status || 'draft',
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      await adminApi.put(`${BASE}/contracts/${contract.id}`, {
        ...form,
        signed_at: form.signed_at || null,
        expires_at: form.expires_at || null,
        storage_ref: form.storage_ref || null,
        notes: form.notes || null,
      });
      onSaved();
    } catch (err) {
      setSaveError(err.response?.data?.error || t(tKey('saveFailed'), 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t(tKey('editContract'), 'Edit contract')} icon={FileSignature} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label={t(tKey('counterparty'), 'Counterparty')}>
          <input className={inputCls} value={form.counterparty} onChange={(e) => setForm({ ...form, counterparty: e.target.value })} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t(tKey('contractType'), 'Type')}>
            <select className={inputCls} value={form.contract_type} onChange={(e) => setForm({ ...form, contract_type: e.target.value })}>
              {CONTRACT_TYPES.map((ct) => <option key={ct} value={ct}>{contractTypeLabel(ct)}</option>)}
            </select>
          </Field>
          <Field label={t(tKey('status'), 'Status')}>
            <select className={inputCls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="draft">{t(tKey('statusDraft'), 'Draft')}</option>
              <option value="active">{t(tKey('statusActive'), 'Active')}</option>
              <option value="expired">{t(tKey('statusExpired'), 'Expired')}</option>
              <option value="terminated">{t(tKey('statusTerminated'), 'Terminated')}</option>
            </select>
          </Field>
        </div>
        <Field label={t(tKey('contractTitle'), 'Title')}>
          <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t(tKey('signedAt'), 'Signed on')}>
            <input type="date" className={inputCls} value={form.signed_at} onChange={(e) => setForm({ ...form, signed_at: e.target.value })} />
          </Field>
          <Field label={t(tKey('expiresAt'), 'Expires on')}>
            <input type="date" className={inputCls} value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
          </Field>
        </div>
        <Field label={t(tKey('storageRef'), 'Storage reference (optional)')}>
          <input className={inputCls} value={form.storage_ref} onChange={(e) => setForm({ ...form, storage_ref: e.target.value })} />
        </Field>
        <Field label={t(tKey('notes'), 'Notes (optional)')}>
          <textarea className={inputCls} rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        {saveError && <p className="text-sm text-red-400">{saveError}</p>}
        <div className="flex gap-2">
          <button type="submit" className={btnCls} disabled={saving}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            {t(tKey('saveChanges'), 'Save changes')}
          </button>
          <button type="button" className={ghostBtnCls} onClick={onClose}>{t(tKey('cancel'), 'Cancel')}</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Privacy tab ──────────────────────────────────────────────────────────────

function PrivacyTab() {
  const { t } = useTranslation();
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
        <h2 className="text-base font-semibold text-white flex items-center gap-2">
          <ShieldCheck size={16} className="text-green-400" />
          {t(tKey('privacyTitle'), 'Privacy requests (CCPA / DSR)')}
        </h2>
        <p className="mt-2 text-sm text-gray-400">
          {t(tKey('privacyDesc'), 'Data subject requests are handled in the dedicated privacy queue: access, deletion, and correction requests with their deadlines and notification status.')}
        </p>
        <p className="mt-2 text-xs text-gray-500">
          {t(tKey('ccpaNote'), 'The queue lives on its own page; this workspace links out to it rather than duplicating it.')}
        </p>
        <Link
          to="/admin/legal/ccpa-requests"
          className={`${btnCls} mt-4`}
        >
          {t(tKey('openCcpaQueue'), 'Open the privacy request queue')}
          <ExternalLink size={15} />
        </Link>
      </div>
    </div>
  );
}

// ── Investigation access tab (E13) ───────────────────────────────────────────

function AccessTab() {
  const { t } = useTranslation();
  const { confirmDestructive, dialog } = useDestructiveConfirm();
  const [statusFilter, setStatusFilter] = useState('all');
  const [form, setForm] = useState({
    approver_id: '', purpose: '', scope_user_ids: '', investigation_ref: '', expires_at: '',
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [revokingId, setRevokingId] = useState(null);
  const [revokeReason, setRevokeReason] = useState('');

  // Admin accounts for the approver select (requester cannot be the approver;
  // the server rejects self-approval with 403).
  const { data: adminsData } = useAbortableFetch(async (signal) => {
    const res = await adminApi.get('/admin/super/admin-accounts', { signal });
    return res.data.admins || res.data.accounts || [];
  }, []);
  const admins = useMemo(
    () => (adminsData || []).filter((a) => a.is_active !== false),
    [adminsData]
  );
  const adminName = useMemo(() => {
    const map = {};
    for (const a of admins) {
      map[a.id] = [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email || String(a.id).slice(0, 8);
    }
    return map;
  }, [admins]);

  const {
    data: grantsData, loading: grantsLoading, error: grantsError, reload: reloadGrants,
  } = useAbortableFetch(async (signal) => {
    const params = statusFilter === 'all' ? {} : { status: statusFilter };
    const res = await adminApi.get('/admin/investigations/access', { params, signal });
    return res.data.grants || [];
  }, [statusFilter]);
  const grants = grantsData || [];
  const pending = grants.filter((g) => g.status === 'pending');
  const active = grants.filter((g) => g.status === 'active');
  const history = grants.filter((g) => g.status !== 'pending' && g.status !== 'active');

  const { data: readsData, loading: readsLoading, error: readsError, reload: reloadReads } = useAbortableFetch(async (signal) => {
    const res = await adminApi.get('/admin/audit-log', {
      params: { action: 'investigation_read', limit: 50 },
      signal,
    });
    return res.data.log || [];
  }, []);
  const reads = readsData || [];

  const maxExpiry = useMemo(() => toLocalDatetimeInput(new Date(Date.now() + 72 * 3600 * 1000)), []);

  const submitRequest = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const scope = String(form.scope_user_ids).split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      await adminApi.post('/admin/investigations/access', {
        approver_id: form.approver_id,
        purpose: form.purpose,
        scope_user_ids: scope,
        investigation_ref: form.investigation_ref,
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : undefined,
      });
      setForm({ approver_id: '', purpose: '', scope_user_ids: '', investigation_ref: '', expires_at: '' });
      reloadGrants();
    } catch (err) {
      setSaveError(err.response?.data?.error || t(tKey('saveFailed'), 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  const approve = async (grant) => {
    try {
      await adminApi.post(`/admin/investigations/access/${grant.id}/approve`);
      reloadGrants();
    } catch (err) {
      setSaveError(err.response?.data?.error || t(tKey('saveFailed'), 'Save failed.'));
    }
  };

  const doRevoke = async (grant) => {
    if (!(await confirmDestructive({
      title: t(tKey('revokeConfirmTitle'), 'Revoke access grant'),
      description: t(tKey('revokeConfirmDesc'), 'The requester loses elevated read access immediately. The request, approval, and revocation all stay in the audit trail.'),
      confirmLabel: t(tKey('revokeConfirmLabel'), 'Revoke grant'),
      requireTypeText: 'REVOKE',
    }))) return;
    try {
      await adminApi.post(`/admin/investigations/access/${grant.id}/revoke`, revokeReason ? { reason: revokeReason } : {});
      setRevokingId(null);
      setRevokeReason('');
      reloadGrants();
    } catch (err) {
      setSaveError(err.response?.data?.error || t(tKey('saveFailed'), 'Save failed.'));
    }
  };

  const grantCard = (g) => (
    <div key={g.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm text-white">#{g.id}</span>
            <StatusBadge status={g.status} />
            {g.investigation_ref && <span className="text-xs text-gray-500">{g.investigation_ref}</span>}
          </div>
          <p className="mt-1 text-sm text-gray-300">{g.purpose}</p>
          <p className="mt-1 text-xs text-gray-500">
            {t(tKey('requester'), 'Requester')}: {adminName[g.requester_admin_id] || String(g.requester_admin_id).slice(0, 8)}
            {' | '}{t(tKey('approverCol'), 'Approver')}: {adminName[g.approver_admin_id] || String(g.approver_admin_id).slice(0, 8)}
          </p>
          <p className="text-xs text-gray-500">
            {t(tKey('scope'), 'Scope')}: {(g.scope_user_ids || []).length} {t(tKey('users'), 'users')}
            {' | '}{t(tKey('expiresCol'), 'Expires')}: {ts(g.expires_at)}
          </p>
          {g.status === 'revoked' && g.revoke_reason && (
            <p className="mt-1 text-xs text-red-400/80">{t(tKey('revokeReasonLabel'), 'Revocation reason')}: {g.revoke_reason}</p>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          {g.status === 'pending' && (
            <button type="button" className={btnCls} onClick={() => approve(g)}>
              {t(tKey('approve'), 'Approve')}
            </button>
          )}
          {(g.status === 'pending' || g.status === 'active') && (
            <button type="button" className={dangerBtnCls} onClick={() => setRevokingId(g.id)}>
              {t(tKey('revoke'), 'Revoke')}
            </button>
          )}
        </div>
      </div>
      {revokingId === g.id && (
        <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/20 p-3">
          <Field label={t(tKey('revokeReason'), 'Revocation reason (optional)')}>
            <input className={inputCls} value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} placeholder={t(tKey('reasonPlaceholder'), 'Why is this contract ending?')} />
          </Field>
          <div className="mt-2 flex gap-2">
            <button type="button" className={dangerBtnCls} onClick={() => doRevoke(g)}>
              {t(tKey('confirmRevocation'), 'Confirm revocation')}
            </button>
            <button type="button" className={ghostBtnCls} onClick={() => { setRevokingId(null); setRevokeReason(''); }}>
              {t(tKey('cancel'), 'Cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {dialog}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 h-fit">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <KeyRound size={16} className="text-amber-400" />
            {t(tKey('requestAccess'), 'Request investigation access')}
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            {t(tKey('accessFormNote'), 'Purpose-limited, approver-tied, max 72 hours, max 25 users in scope. Self-approval is rejected.')}
          </p>
          <form onSubmit={submitRequest} className="mt-4 space-y-3">
            <Field label={t(tKey('approver'), 'Approver (a different admin)')}>
              <select className={inputCls} value={form.approver_id} onChange={(e) => setForm({ ...form, approver_id: e.target.value })} required>
                <option value="">{t(tKey('selectApprover'), 'Select an approver')}</option>
                {admins.map((a) => (
                  <option key={a.id} value={a.id}>
                    {[a.first_name, a.last_name].filter(Boolean).join(' ') || a.email} ({a.role})
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t(tKey('purpose'), 'Purpose (min 10 characters)')}>
              <textarea className={inputCls} rows={3} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} required />
            </Field>
            <Field label={t(tKey('scopeUserIds'), 'Scope user ids (comma or line separated)')}>
              <textarea className={inputCls} rows={2} value={form.scope_user_ids} onChange={(e) => setForm({ ...form, scope_user_ids: e.target.value })} placeholder="uuid-1, uuid-2" required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t(tKey('investigationRef'), 'Investigation ref')}>
                <input className={inputCls} value={form.investigation_ref} onChange={(e) => setForm({ ...form, investigation_ref: e.target.value })} placeholder="fraud-case-9" />
              </Field>
              <Field label={t(tKey('expiresAtAccess'), 'Expires at (max 72h)')}>
                <input type="datetime-local" className={inputCls} value={form.expires_at} max={maxExpiry} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
              </Field>
            </div>
            {saveError && <p className="text-sm text-red-400">{saveError}</p>}
            <button type="submit" className={btnCls} disabled={saving}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              {t(tKey('requestSubmit'), 'Submit request')}
            </button>
          </form>
        </div>

        <div className="lg:col-span-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-base font-semibold text-white">{t(tKey('grantsTitle'), 'Access grants')}</h2>
            <select className="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">{t(tKey('filterAll'), 'All')}</option>
              <option value="pending">{t(tKey('statusPending'), 'Pending')}</option>
              <option value="active">{t(tKey('statusActive'), 'Active')}</option>
              <option value="revoked">{t(tKey('statusRevoked'), 'Revoked')}</option>
              <option value="expired">{t(tKey('statusExpired'), 'Expired')}</option>
            </select>
          </div>
          {grantsLoading && <p className="mt-4 text-sm text-gray-400 flex items-center gap-2"><Loader2 size={16} className="animate-spin" /></p>}
          {grantsError && <div className="mt-4"><AdminErrorState message={t(tKey('loadFailed'), 'Failed to load the policy registry.')} onRetry={reloadGrants} /></div>}
          {!grantsLoading && !grantsError && (
            <div className="mt-4 space-y-4">
              {pending.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-yellow-300">{t(tKey('pendingGrants'), 'Pending approval')}</h3>
                  <div className="mt-2 space-y-3">{pending.map(grantCard)}</div>
                </div>
              )}
              {active.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-green-300">{t(tKey('activeGrants'), 'Active grants')}</h3>
                  <div className="mt-2 space-y-3">{active.map(grantCard)}</div>
                </div>
              )}
              {history.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-400">{t(tKey('grantHistory'), 'History')}</h3>
                  <div className="mt-2 space-y-3">{history.map(grantCard)}</div>
                </div>
              )}
              {grants.length === 0 && (
                <p className="text-sm text-gray-400">{t(tKey('noGrants'), 'No grants match this filter.')}</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
        <h2 className="text-base font-semibold text-white">{t(tKey('readsAudit'), 'Reads audit (investigation_read)')}</h2>
        <p className="mt-1 text-xs text-gray-500">
          {t(tKey('readsAuditNote'), 'Every elevated investigation read is written to the admin audit log with purpose and approver.')}
        </p>
        {readsLoading && <p className="mt-4 text-sm text-gray-400 flex items-center gap-2"><Loader2 size={16} className="animate-spin" /></p>}
        {readsError && <div className="mt-4"><AdminErrorState message={t(tKey('loadFailed'), 'Failed to load the policy registry.')} onRetry={reloadReads} /></div>}
        {!readsLoading && !readsError && reads.length === 0 && (
          <p className="mt-4 text-sm text-gray-400">{t(tKey('noReads'), 'No investigation reads recorded yet.')}</p>
        )}
        {!readsLoading && !readsError && reads.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500 border-b border-neutral-800">
                  <th className="py-2 pr-4">{t(tKey('readTime'), 'Time')}</th>
                  <th className="py-2 pr-4">{t(tKey('readBy'), 'Read by')}</th>
                  <th className="py-2 pr-4">{t(tKey('readTarget'), 'Target')}</th>
                  <th className="py-2">{t(tKey('readDetail'), 'Detail')}</th>
                </tr>
              </thead>
              <tbody>
                {reads.map((r) => (
                  <tr key={r.id} className="border-b border-neutral-800/60 text-gray-300">
                    <td className="py-2 pr-4 whitespace-nowrap text-xs">{ts(r.created_at)}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">{r.admin_name || r.admin_email || String(r.admin_id).slice(0, 8)}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{r.target_key || (r.target_id ? String(r.target_id).slice(0, 8) : '-')}</td>
                    <td className="py-2 text-xs text-gray-400 max-w-md truncate" title={r.description}>{r.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page root ────────────────────────────────────────────────────────────────

export default function GovernancePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('policies');

  const tabs = [
    { id: 'policies', label: t(tKey('tabPolicies'), 'Policies'), icon: Scale },
    { id: 'contracts', label: t(tKey('tabContracts'), 'Contracts'), icon: FileSignature },
    { id: 'privacy', label: t(tKey('tabPrivacy'), 'Privacy'), icon: ShieldCheck },
    { id: 'access', label: t(tKey('tabAccess'), 'Investigation Access'), icon: KeyRound },
  ];

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">{t(tKey('title'), 'Market Governance')}</h1>
        <p className="mt-1 text-sm text-gray-400">
          {t(tKey('subtitle'), 'Policy registry, contract records, privacy queue, and controlled investigation access.')}
        </p>
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className={tabCls(tab === id)} onClick={() => setTab(id)}>
            <Icon size={16} />{label}
          </button>
        ))}
      </div>
      {tab === 'policies' && <PoliciesTab />}
      {tab === 'contracts' && <ContractsTab />}
      {tab === 'privacy' && <PrivacyTab />}
      {tab === 'access' && <AccessTab />}
    </div>
  );
}
