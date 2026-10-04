import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Landmark, BookOpen, Lock, FileDown, Plus, Loader2, Check } from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import { useAbortableFetch } from '../../../lib/useAbortableFetch';
import AdminErrorState from '../../../lib/AdminErrorState';
import useDestructiveConfirm from '../../../hooks/useDestructiveConfirm';
import { adminDate } from '../../../lib/formatters';

const BASE = '/admin/treasury';

function tKey(k) {
  return `wsTreasury.${k}`;
}

function formatMinor(minor, currency) {
  const n = Number(minor) / 100;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
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
const tabCls = (active) =>
  `flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${
    active ? 'bg-blue-600 text-white' : 'bg-neutral-800 text-gray-300 hover:bg-neutral-700'
  }`;

// ── Entities / Accounts tab ───────────────────────────────────────────────

function EntitiesTab() {
  const { t } = useTranslation();
  const [form, setForm] = useState({ code: '', name: '', country_code: '', base_currency: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const res = await adminApi.get(`${BASE}/entities`, { signal });
    return res.data.entities || [];
  }, []);
  const entities = data || [];

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      await adminApi.post(`${BASE}/entities`, form);
      setForm({ code: '', name: '', country_code: '', base_currency: '' });
      reload();
    } catch (err) {
      setSaveError(err.response?.data?.error || t(tKey('saveFailed'), 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
        <h2 className="text-base font-semibold text-white">{t(tKey('newEntity'), 'New entity')}</h2>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <Field label={t(tKey('code'), 'Code (uppercase)')}>
            <input className={inputCls} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="OXS-US" required />
          </Field>
          <Field label={t(tKey('name'), 'Name')}>
            <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t(tKey('countryCode'), 'Country (2 letters)')}>
              <input className={inputCls} value={form.country_code} onChange={(e) => setForm({ ...form, country_code: e.target.value.toUpperCase() })} placeholder="US" />
            </Field>
            <Field label={t(tKey('baseCurrency'), 'Base currency (3 letters)')}>
              <input className={inputCls} value={form.base_currency} onChange={(e) => setForm({ ...form, base_currency: e.target.value.toUpperCase() })} placeholder="USD" required />
            </Field>
          </div>
          {saveError && <p className="text-sm text-red-400">{saveError}</p>}
          <button type="submit" className={btnCls} disabled={saving}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            {t(tKey('createEntity'), 'Create entity')}
          </button>
        </form>
      </div>
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
        <h2 className="text-base font-semibold text-white">{t(tKey('entities'), 'Entities')}</h2>
        {loading && <p className="mt-3 text-sm text-gray-400"><Loader2 size={16} className="animate-spin" /></p>}
        {error && <AdminErrorState onRetry={reload} />}
        {!loading && !error && (
          <ul className="mt-3 space-y-2">
            {entities.length === 0 && <li className="text-sm text-gray-500">{t(tKey('noEntities'), 'No entities yet.')}</li>}
            {entities.map((e) => (
              <li key={e.id} className="flex items-center justify-between rounded-lg border border-neutral-800 px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-white">{e.name} <span className="text-gray-500">({e.code})</span></p>
                  <p className="text-xs text-gray-500">{e.base_currency}{e.country_code ? ` - ${e.country_code}` : ''}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${e.is_active ? 'bg-green-900 text-green-300' : 'bg-neutral-700 text-gray-400'}`}>
                  {e.is_active ? t(tKey('active'), 'Active') : t(tKey('inactive'), 'Inactive')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <AccountsPanel entities={entities} t={t} />
    </div>
  );
}

function AccountsPanel({ entities, t }) {
  const [entityId, setEntityId] = useState('');
  const [form, setForm] = useState({ code: '', name: '', currency: '', account_type: 'asset' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    if (!entityId) return [];
    const res = await adminApi.get(`${BASE}/accounts`, { params: { entity_id: entityId }, signal });
    return res.data.accounts || [];
  }, [entityId]);
  const accounts = data || [];

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      await adminApi.post(`${BASE}/accounts`, { ...form, entity_id: Number(entityId) });
      setForm({ code: '', name: '', currency: '', account_type: 'asset' });
      reload();
    } catch (err) {
      setSaveError(err.response?.data?.error || t(tKey('saveFailed'), 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-white">{t(tKey('accounts'), 'Chart of accounts')}</h2>
        <select className={`${inputCls} w-auto`} value={entityId} onChange={(e) => setEntityId(e.target.value)}>
          <option value="">{t(tKey('selectEntity'), 'Select an entity')}</option>
          {entities.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.code})</option>)}
        </select>
      </div>
      {entityId && (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t(tKey('code'), 'Code (uppercase)')}>
                <input className={inputCls} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="1000" required />
              </Field>
              <Field label={t(tKey('accountType'), 'Type')}>
                <select className={inputCls} value={form.account_type} onChange={(e) => setForm({ ...form, account_type: e.target.value })}>
                  {['asset', 'liability', 'equity', 'revenue', 'expense'].map((ty) => <option key={ty} value={ty}>{ty}</option>)}
                </select>
              </Field>
            </div>
            <Field label={t(tKey('name'), 'Name')}>
              <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </Field>
            <Field label={t(tKey('currency'), 'Currency (3 letters)')}>
              <input className={inputCls} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} placeholder="USD" required />
            </Field>
            {saveError && <p className="text-sm text-red-400">{saveError}</p>}
            <button type="submit" className={btnCls} disabled={saving}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              {t(tKey('createAccount'), 'Create account')}
            </button>
          </form>
          <div>
            {loading && <p className="text-sm text-gray-400"><Loader2 size={16} className="animate-spin" /></p>}
            {error && <AdminErrorState onRetry={reload} />}
            {!loading && !error && (
              <ul className="space-y-2">
                {accounts.length === 0 && <li className="text-sm text-gray-500">{t(tKey('noAccounts'), 'No accounts for this entity.')}</li>}
                {accounts.map((a) => (
                  <li key={a.id} className="flex items-center justify-between rounded-lg border border-neutral-800 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-white">{a.code} - {a.name}</p>
                      <p className="text-xs text-gray-500">{a.account_type} - {a.currency}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Journal tab ─────────────────────────────────────────────────────────────

function JournalTab() {
  const { t } = useTranslation();
  const [entityId, setEntityId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [form, setForm] = useState({ debit_account_id: '', credit_account_id: '', amount: '', currency: '', description: '', reference: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  // Idempotency key for the journal post: stable per identical form content so
  // a timed-out submit that the admin retries posts once instead of twice.
  // A changed field is a different command and gets a fresh key.
  const idempotencyRef = useRef(null);

  const entitiesFetch = useAbortableFetch(async (signal) => {
    const res = await adminApi.get(`${BASE}/entities`, { signal });
    return res.data.entities || [];
  }, []);
  const entities = entitiesFetch.data || [];

  const accountsFetch = useAbortableFetch(async (signal) => {
    if (!entityId) return [];
    const res = await adminApi.get(`${BASE}/accounts`, { params: { entity_id: entityId }, signal });
    return res.data.accounts || [];
  }, [entityId]);
  const accounts = accountsFetch.data || [];

  const periodsFetch = useAbortableFetch(async (signal) => {
    if (!entityId) return [];
    const res = await adminApi.get(`${BASE}/periods`, { params: { entity_id: entityId }, signal });
    return res.data.periods || [];
  }, [entityId]);
  const periods = periodsFetch.data || [];
  const openPeriods = periods.filter((p) => p.status === 'open');

  const journalFetch = useAbortableFetch(async (signal) => {
    if (!entityId) return [];
    const res = await adminApi.get(`${BASE}/journal`, {
      params: { entity_id: entityId, period_id: periodId || undefined },
      signal,
    });
    return res.data.entries || [];
  }, [entityId, periodId]);
  const entries = journalFetch.data || [];

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const amountMinor = Math.round(Number(form.amount) * 100);
      const fingerprint = JSON.stringify({
        entity_id: entityId, period_id: periodId,
        debit_account_id: form.debit_account_id, credit_account_id: form.credit_account_id,
        amount: form.amount, currency: form.currency,
        description: form.description, reference: form.reference,
      });
      const prior = idempotencyRef.current;
      const idempotencyKey = prior && prior.fingerprint === fingerprint
        ? prior.key
        : (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
      idempotencyRef.current = { fingerprint, key: idempotencyKey };
      await adminApi.post(`${BASE}/journal`, {
        entity_id: Number(entityId),
        period_id: Number(periodId),
        debit_account_id: Number(form.debit_account_id),
        credit_account_id: Number(form.credit_account_id),
        amount_minor: amountMinor,
        currency: form.currency.toUpperCase(),
        description: form.description,
        reference: form.reference || undefined,
        idempotency_key: idempotencyKey,
      });
      idempotencyRef.current = null;
      setForm({ debit_account_id: '', credit_account_id: '', amount: '', currency: '', description: '', reference: '' });
      journalFetch.reload();
    } catch (err) {
      setSaveError(err.response?.data?.error || t(tKey('saveFailed'), 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
        <h2 className="text-base font-semibold text-white">{t(tKey('postEntry'), 'Post journal entry')}</h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label={t(tKey('entity'), 'Entity')}>
            <select className={inputCls} value={entityId} onChange={(e) => { setEntityId(e.target.value); setPeriodId(''); }}>
              <option value="">{t(tKey('selectEntity'), 'Select an entity')}</option>
              {entities.map((en) => <option key={en.id} value={en.id}>{en.name} ({en.code})</option>)}
            </select>
          </Field>
          <Field label={t(tKey('period'), 'Period (open only)')}>
            <select className={inputCls} value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
              <option value="">{t(tKey('selectPeriod'), 'Select a period')}</option>
              {openPeriods.map((p) => <option key={p.id} value={p.id}>{p.period_start} to {p.period_end}</option>)}
            </select>
          </Field>
        </div>
        {entityId && periodId && (
          <form onSubmit={submit} className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t(tKey('debitAccount'), 'Debit account')}>
                <select className={inputCls} value={form.debit_account_id} onChange={(e) => setForm({ ...form, debit_account_id: e.target.value })} required>
                  <option value="">-</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name} ({a.currency})</option>)}
                </select>
              </Field>
              <Field label={t(tKey('creditAccount'), 'Credit account')}>
                <select className={inputCls} value={form.credit_account_id} onChange={(e) => setForm({ ...form, credit_account_id: e.target.value })} required>
                  <option value="">-</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name} ({a.currency})</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t(tKey('amount'), 'Amount (major units)')}>
                <input className={inputCls} type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
              </Field>
              <Field label={t(tKey('currency'), 'Currency (3 letters)')}>
                <input className={inputCls} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} placeholder="USD" required />
              </Field>
            </div>
            <Field label={t(tKey('description'), 'Description')}>
              <input className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
            </Field>
            <Field label={t(tKey('reference'), 'Reference (optional)')}>
              <input className={inputCls} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </Field>
            {saveError && <p className="text-sm text-red-400">{saveError}</p>}
            <button type="submit" className={btnCls} disabled={saving}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              {t(tKey('post'), 'Post entry')}
            </button>
          </form>
        )}
      </div>
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
        <h2 className="text-base font-semibold text-white">{t(tKey('journal'), 'Journal')}</h2>
        {journalFetch.loading && <p className="mt-3 text-sm text-gray-400"><Loader2 size={16} className="animate-spin" /></p>}
        {journalFetch.error && <AdminErrorState onRetry={journalFetch.reload} />}
        {!journalFetch.loading && !journalFetch.error && (
          <ul className="mt-3 max-h-96 space-y-2 overflow-y-auto">
            {entries.length === 0 && <li className="text-sm text-gray-500">{t(tKey('noEntries'), 'No entries found.')}</li>}
            {entries.map((e) => (
              <li key={e.id} className="rounded-lg border border-neutral-800 px-3 py-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-white">{formatMinor(e.amount_minor, e.currency)}</p>
                  <p className="text-xs text-gray-500">{adminDate(e.created_at, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                </div>
                <p className="mt-1 text-xs text-gray-400">{e.debit_code} - {e.debit_name} / {e.credit_code} - {e.credit_name}</p>
                <p className="text-xs text-gray-500">{e.description}{e.reference ? ` (${e.reference})` : ''}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Period close tab ────────────────────────────────────────────────────────

function PeriodCloseTab() {
  const { t } = useTranslation();
  const { confirmDestructive, dialog } = useDestructiveConfirm();
  const [entityId, setEntityId] = useState('');
  const [periodForm, setPeriodForm] = useState({ period_start: '', period_end: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const entitiesFetch = useAbortableFetch(async (signal) => {
    const res = await adminApi.get(`${BASE}/entities`, { signal });
    return res.data.entities || [];
  }, []);
  const entities = entitiesFetch.data || [];

  const periodsFetch = useAbortableFetch(async (signal) => {
    if (!entityId) return [];
    const res = await adminApi.get(`${BASE}/periods`, { params: { entity_id: entityId }, signal });
    return res.data.periods || [];
  }, [entityId]);
  const periods = periodsFetch.data || [];

  const loadSummary = async (period) => {
    setSelected(period);
    setSummaryLoading(true);
    setSummary(null);
    try {
      const res = await adminApi.get(`${BASE}/periods/${period.id}/summary`);
      setSummary(res.data);
    } catch (err) {
      setSummary({ error: err.response?.data?.error || t(tKey('loadFailed'), 'Load failed.') });
    } finally {
      setSummaryLoading(false);
    }
  };

  const createPeriod = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      await adminApi.post(`${BASE}/periods`, { entity_id: Number(entityId), ...periodForm });
      setPeriodForm({ period_start: '', period_end: '' });
      periodsFetch.reload();
    } catch (err) {
      setSaveError(err.response?.data?.error || t(tKey('saveFailed'), 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  const closePeriod = async (period) => {
    const confirmed = await confirmDestructive({
      title: t(tKey('closePeriodTitle'), 'Close period'),
      description: t(tKey('closePeriodConfirm'), 'Closing locks this period. No more journal entries can be posted to it. This cannot be undone.'),
      confirmLabel: t(tKey('closePeriod'), 'Close period'),
      requireTypeText: 'CLOSE',
    });
    if (!confirmed) return;
    try {
      await adminApi.post(`${BASE}/periods/${period.id}/close`, { entity_id: Number(entityId) });
      periodsFetch.reload();
      if (selected?.id === period.id) loadSummary(period);
    } catch (err) {
      alert(err.response?.data?.error || t(tKey('saveFailed'), 'Save failed.'));
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {dialog}
      <div className="space-y-6">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
          <h2 className="text-base font-semibold text-white">{t(tKey('periods'), 'Periods')}</h2>
          <Field label={t(tKey('entity'), 'Entity')}>
            <select className={`${inputCls} mt-1`} value={entityId} onChange={(e) => { setEntityId(e.target.value); setSelected(null); setSummary(null); }}>
              <option value="">{t(tKey('selectEntity'), 'Select an entity')}</option>
              {entities.map((en) => <option key={en.id} value={en.id}>{en.name} ({en.code})</option>)}
            </select>
          </Field>
          {entityId && (
            <form onSubmit={createPeriod} className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label={t(tKey('periodStart'), 'Period start')}>
                  <input type="date" className={inputCls} value={periodForm.period_start} onChange={(e) => setPeriodForm({ ...periodForm, period_start: e.target.value })} required />
                </Field>
                <Field label={t(tKey('periodEnd'), 'Period end')}>
                  <input type="date" className={inputCls} value={periodForm.period_end} onChange={(e) => setPeriodForm({ ...periodForm, period_end: e.target.value })} required />
                </Field>
              </div>
              {saveError && <p className="text-sm text-red-400">{saveError}</p>}
              <button type="submit" className={btnCls} disabled={saving}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                {t(tKey('createPeriod'), 'Create period')}
              </button>
            </form>
          )}
        </div>
        {entityId && (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
            {periodsFetch.loading && <p className="text-sm text-gray-400"><Loader2 size={16} className="animate-spin" /></p>}
            {periodsFetch.error && <AdminErrorState onRetry={periodsFetch.reload} />}
            {!periodsFetch.loading && !periodsFetch.error && (
              <ul className="space-y-2">
                {periods.length === 0 && <li className="text-sm text-gray-500">{t(tKey('noPeriods'), 'No periods yet.')}</li>}
                {periods.map((p) => (
                  <li key={p.id} className="flex items-center justify-between rounded-lg border border-neutral-800 px-3 py-2">
                    <button type="button" className="text-left" onClick={() => loadSummary(p)}>
                      <p className="text-sm font-medium text-white hover:underline">{p.period_start} to {p.period_end}</p>
                      <p className="text-xs text-gray-500">{p.status === 'closed' ? t(tKey('closed'), 'Closed') : t(tKey('open'), 'Open')}</p>
                    </button>
                    {p.status === 'open' ? (
                      <button type="button" onClick={() => closePeriod(p)} className="inline-flex items-center gap-1 rounded-lg bg-red-900/60 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-900">
                        <Lock size={14} />{t(tKey('closePeriod'), 'Close period')}
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-gray-500"><Lock size={14} />{adminDate(p.closed_at, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
        <h2 className="text-base font-semibold text-white">{t(tKey('periodSummary'), 'Period summary')}</h2>
        {summaryLoading && <p className="mt-3 text-sm text-gray-400"><Loader2 size={16} className="animate-spin" /></p>}
        {summary?.error && <p className="mt-3 text-sm text-red-400">{summary.error}</p>}
        {summary && !summary.error && (
          <div className="mt-3">
            <p className="text-xs text-gray-500">{t(tKey('computedNote'), 'Balances are computed from journal entries. No adjusting entries are posted.')}</p>
            <ul className="mt-3 space-y-2">
              {summary.accounts.map((a) => (
                <li key={a.account_id} className="rounded-lg border border-neutral-800 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-white">{a.code} - {a.name}</p>
                    <p className="text-sm text-gray-300">{formatMinor(a.balance_minor, a.currency)}</p>
                  </div>
                  <p className="text-xs text-gray-500">
                    {t(tKey('debits'), 'Debits')}: {formatMinor(a.debit_total_minor, a.currency)} - {t(tKey('credits'), 'Credits')}: {formatMinor(a.credit_total_minor, a.currency)}
                  </p>
                </li>
              ))}
            </ul>
            <div className="mt-4 border-t border-neutral-800 pt-3">
              {Object.entries(summary.totals || {}).map(([cur, tot]) => (
                <p key={cur} className="text-sm text-gray-300">
                  {cur}: {t(tKey('debits'), 'Debits')} {formatMinor(tot.debits_minor, cur)} - {t(tKey('credits'), 'Credits')} {formatMinor(tot.credits_minor, cur)}
                </p>
              ))}
            </div>
          </div>
        )}
        {!summary && !summaryLoading && <p className="mt-3 text-sm text-gray-500">{t(tKey('selectPeriodHint'), 'Select a period to see its summary.')}</p>}
      </div>
    </div>
  );
}

// ── Tax exports tab ─────────────────────────────────────────────────────────

function TaxExportTab() {
  const { t } = useTranslation();
  const [entityId, setEntityId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [exportData, setExportData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const entitiesFetch = useAbortableFetch(async (signal) => {
    const res = await adminApi.get(`${BASE}/entities`, { signal });
    return res.data.entities || [];
  }, []);
  const entities = entitiesFetch.data || [];

  const periodsFetch = useAbortableFetch(async (signal) => {
    if (!entityId) return [];
    const res = await adminApi.get(`${BASE}/periods`, { params: { entity_id: entityId }, signal });
    return res.data.periods || [];
  }, [entityId]);
  const periods = periodsFetch.data || [];

  const runExport = async (format, asBlob = false) => {
    const params = { entity_id: entityId, period_id: periodId, format };
    if (asBlob) {
      setDownloading(true);
      try {
        const res = await adminApi.get(`${BASE}/tax-export`, { params, responseType: 'blob' });
        const url = URL.createObjectURL(res.data);
        const a = document.createElement('a');
        a.href = url;
        a.download = `treasury-tax-export-${periodId}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        setError(err.response?.data?.error || t(tKey('exportFailed'), 'Export failed.'));
      } finally {
        setDownloading(false);
      }
      return;
    }
    setLoading(true);
    setError(null);
    setExportData(null);
    try {
      const res = await adminApi.get(`${BASE}/tax-export`, { params });
      setExportData(res.data);
    } catch (err) {
      setError(err.response?.data?.error || t(tKey('exportFailed'), 'Export failed.'));
    } finally {
      setLoading(false);
    }
  };

  const previewEntries = useMemo(() => (exportData?.entries || []).slice(0, 25), [exportData]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
        <h2 className="text-base font-semibold text-white">{t(tKey('taxExport'), 'Tax export')}</h2>
        <p className="mt-1 text-xs text-gray-500">{t(tKey('taxExportNote'), 'Export scaffolding only. Actual tax filing stays an operational task.')}</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label={t(tKey('entity'), 'Entity')}>
            <select className={inputCls} value={entityId} onChange={(e) => { setEntityId(e.target.value); setPeriodId(''); setExportData(null); }}>
              <option value="">{t(tKey('selectEntity'), 'Select an entity')}</option>
              {entities.map((en) => <option key={en.id} value={en.id}>{en.name} ({en.code})</option>)}
            </select>
          </Field>
          <Field label={t(tKey('period'), 'Period')}>
            <select className={inputCls} value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
              <option value="">{t(tKey('selectPeriod'), 'Select a period')}</option>
              {periods.map((p) => <option key={p.id} value={p.id}>{p.period_start} to {p.period_end} ({p.status})</option>)}
            </select>
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" className={btnCls} disabled={!entityId || !periodId || loading} onClick={() => runExport('json')}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />}
            {t(tKey('previewJson'), 'Preview JSON')}
          </button>
          <button type="button" className={btnCls} disabled={!entityId || !periodId || downloading} onClick={() => runExport('csv', true)}>
            {downloading ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />}
            {t(tKey('downloadCsv'), 'Download CSV')}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        {exportData && (
          <div className="mt-4">
            <p className="text-sm font-medium text-white">{t(tKey('totals'), 'Totals')}</p>
            <ul className="mt-2 space-y-1">
              {Object.entries(exportData.totals || {}).map(([cur, tot]) => (
                <li key={cur} className="text-sm text-gray-300">
                  {cur}: {formatMinor(tot.total_minor, cur)} ({tot.entries} {t(tKey('entries'), 'entries')})
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
        <h2 className="text-base font-semibold text-white">{t(tKey('preview'), 'Preview')}</h2>
        {!exportData && <p className="mt-3 text-sm text-gray-500">{t(tKey('runExportHint'), 'Run a preview to see the first entries.')}</p>}
        {previewEntries.length > 0 && (
          <ul className="mt-3 max-h-96 space-y-2 overflow-y-auto">
            {previewEntries.map((e) => (
              <li key={e.id} className="rounded-lg border border-neutral-800 px-3 py-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-white">{formatMinor(e.amount_minor, e.currency)}</p>
                  <p className="text-xs text-gray-500">{adminDate(e.created_at, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                </div>
                <p className="text-xs text-gray-400">{e.debit_code} to {e.credit_code}: {e.description}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Page root ───────────────────────────────────────────────────────────────

export default function TreasuryPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('entities');

  const tabs = [
    { id: 'entities', label: t(tKey('tabEntities'), 'Entities / Accounts'), icon: Landmark },
    { id: 'journal', label: t(tKey('tabJournal'), 'Journal'), icon: BookOpen },
    { id: 'close', label: t(tKey('tabClose'), 'Period Close'), icon: Lock },
    { id: 'tax', label: t(tKey('tabTax'), 'Tax Exports'), icon: FileDown },
  ];

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">{t(tKey('title'), 'Treasury')}</h1>
        <p className="mt-1 text-sm text-gray-400">{t(tKey('subtitle'), 'Entity accounting, journal entries, period close, and tax export scaffolding.')}</p>
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className={tabCls(tab === id)} onClick={() => setTab(id)}>
            <Icon size={16} />{label}
          </button>
        ))}
      </div>
      {tab === 'entities' && <EntitiesTab />}
      {tab === 'journal' && <JournalTab />}
      {tab === 'close' && <PeriodCloseTab />}
      {tab === 'tax' && <TaxExportTab />}
    </div>
  );
}
