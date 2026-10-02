import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Rocket, GitBranch, Plug, Gauge, Plus, RefreshCw, RotateCcw,
  Send, AlertTriangle, CheckCircle, Loader2, ChevronRight,
} from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import { useAbortableFetch } from '../../../lib/useAbortableFetch';
import AdminErrorState from '../../../lib/AdminErrorState';
import { adminDate } from '../../../lib/formatters';

const TABS = ['releases', 'migrations', 'integrations', 'budgets'];
const QUEUE_KEYS = ['queue:payment-capture', 'queue:stripe-webhook', 'queue:notifications'];

function ts(d, fallback = '-') {
  if (!d) return fallback;
  return adminDate(d, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function shortSha(sha) {
  if (!sha) return '-';
  return String(sha).length > 12 ? String(sha).slice(0, 12) : String(sha);
}

// ── shared bits ─────────────────────────────────────────────────────────────

function Panel({ children, className = '' }) {
  return (
    <div className={`bg-gray-900 border border-gray-700 rounded-lg ${className}`}>
      {children}
    </div>
  );
}

function PanelTitle({ children }) {
  return <h3 className="text-sm font-semibold text-white px-5 pt-4">{children}</h3>;
}

function TableHead({ columns }) {
  return (
    <thead>
      <tr className="border-b border-gray-800">
        {columns.map((c) => (
          <th key={c} className="px-5 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">{c}</th>
        ))}
      </tr>
    </thead>
  );
}

function StatusBadge({ status }) {
  const { t } = useTranslation();
  const styles = {
    deployed:   'bg-green-900 text-green-300',
    rolled_back: 'bg-yellow-900 text-yellow-300',
    failed:     'bg-red-900 text-red-300',
    applied:    'bg-green-900 text-green-300',
  };
  return (
    <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${styles[status] || 'bg-gray-800 text-gray-300'}`}>
      {t(`wsReliability.status.${status}`, { defaultValue: status })}
    </span>
  );
}

// ── Releases tab ────────────────────────────────────────────────────────────

function ReleasesTab() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const { data: body } = await adminApi.get('/admin/super/reliability/releases', { signal });
    return body.releases || [];
  }, []);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ version: '', commit_sha: '', status: 'deployed', notes: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await adminApi.post('/admin/super/reliability/releases', form);
      setForm({ version: '', commit_sha: '', status: 'deployed', notes: '' });
      setShowForm(false);
      reload();
    } catch (err) {
      const fields = err.response?.data?.fields;
      setFormError(fields
        ? Object.values(fields).join(' ')
        : (err.response?.data?.error || t('wsReliability.releases.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">{t('wsReliability.releases.manualNote')}</p>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium text-white bg-purple-600 hover:bg-purple-500"
        >
          <Plus size={15} /> {t('wsReliability.releases.record')}
        </button>
      </div>

      {showForm && (
        <Panel className="p-5">
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1.5">{t('wsReliability.releases.version')}</label>
              <input
                value={form.version}
                onChange={(e) => setForm({ ...form, version: e.target.value })}
                placeholder="v2.14.0"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1.5">{t('wsReliability.releases.commitSha')}</label>
              <input
                value={form.commit_sha}
                onChange={(e) => setForm({ ...form, commit_sha: e.target.value })}
                placeholder="a1b2c3d4..."
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1.5">{t('wsReliability.releases.statusLabel')}</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
              >
                {['deployed', 'rolled_back', 'failed'].map((s) => (
                  <option key={s} value={s}>{t(`wsReliability.status.${s}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1.5">
                {t('wsReliability.releases.notes')} <span className="text-gray-600">({t('common.optional')})</span>
              </label>
              <input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
              />
            </div>
            {formError && (
              <p className="md:col-span-2 text-sm text-red-400">{formError}</p>
            )}
            <div className="md:col-span-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 rounded-md text-sm text-gray-300 bg-gray-800 border border-gray-700 hover:bg-gray-700"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-50"
              >
                {saving && <Loader2 size={15} className="animate-spin" />}
                {t('wsReliability.releases.save')}
              </button>
            </div>
          </form>
        </Panel>
      )}

      {loading && <p className="text-sm text-gray-500">{t('common.loading')}</p>}
      {error && <AdminErrorState onRetry={reload} />}
      {!loading && !error && (
        <Panel>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <TableHead columns={[
                t('wsReliability.releases.version'),
                t('wsReliability.releases.commitSha'),
                t('wsReliability.releases.statusLabel'),
                t('wsReliability.releases.deployedAt'),
                t('wsReliability.releases.notes'),
              ]} />
              <tbody>
                {(data || []).map((r) => (
                  <tr key={r.id} className="border-b border-gray-800 last:border-0">
                    <td className="px-5 py-3 font-medium text-white">{r.version}</td>
                    <td className="px-5 py-3 font-mono text-gray-300" title={r.commit_sha}>{shortSha(r.commit_sha)}</td>
                    <td className="px-5 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-5 py-3 text-gray-400">{ts(r.deployed_at)}</td>
                    <td className="px-5 py-3 text-gray-400 max-w-xs truncate">{r.notes || '-'}</td>
                  </tr>
                ))}
                {(!data || data.length === 0) && (
                  <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-500">{t('wsReliability.releases.empty')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

// ── Migrations tab ──────────────────────────────────────────────────────────

function MigrationsTab() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const { data: body } = await adminApi.get('/admin/super/reliability/migrations', { signal });
    return body.migrations || [];
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">{t('wsReliability.migrations.note')}</p>
        <button
          type="button"
          onClick={reload}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-gray-300 bg-gray-800 border border-gray-700 hover:bg-gray-700"
        >
          <RefreshCw size={15} /> {t('common.refresh')}
        </button>
      </div>
      {loading && <p className="text-sm text-gray-500">{t('common.loading')}</p>}
      {error && <AdminErrorState onRetry={reload} />}
      {!loading && !error && (
        <Panel>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <TableHead columns={[
                t('wsReliability.migrations.file'),
                t('wsReliability.migrations.statusLabel'),
                t('wsReliability.migrations.appliedAt'),
              ]} />
              <tbody>
                {(data || []).map((m) => (
                  <tr key={m.filename} className="border-b border-gray-800 last:border-0">
                    <td className="px-5 py-3 font-mono text-gray-200">{m.filename}</td>
                    <td className="px-5 py-3"><StatusBadge status={m.status} /></td>
                    <td className="px-5 py-3 text-gray-400">{ts(m.applied_at)}</td>
                  </tr>
                ))}
                {(!data || data.length === 0) && (
                  <tr><td colSpan={3} className="px-5 py-8 text-center text-gray-500">{t('wsReliability.migrations.empty')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

// ── Integrations tab ────────────────────────────────────────────────────────

function HealthSummary() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const { data: body } = await adminApi.get('/monitoring/health', { signal });
    return body;
  }, []);

  if (loading) return <p className="text-sm text-gray-500">{t('common.loading')}</p>;
  if (error) return <AdminErrorState title={t('wsReliability.integrations.healthFailed')} onRetry={reload} />;
  if (!data) return null;

  const healthy = data.status === 'healthy';
  return (
    <Panel className="p-5">
      <div className="flex items-center gap-3">
        {healthy
          ? <CheckCircle size={22} className="text-green-400" />
          : <AlertTriangle size={22} className="text-yellow-400" />}
        <div>
          <p className="text-sm font-semibold text-white">
            {t(healthy ? 'wsReliability.integrations.healthy' : 'wsReliability.integrations.degraded')}
          </p>
          <p className="text-xs text-gray-500">{t('wsReliability.integrations.healthCheckedAt', { when: ts(data.timestamp) })}</p>
        </div>
      </div>
      {(data.alerts || []).length > 0 && (
        <ul className="mt-4 space-y-2">
          {(data.alerts || []).map((a, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <ChevronRight size={15} className={a.severity === 'critical' ? 'text-red-400 mt-0.5' : 'text-yellow-400 mt-0.5'} />
              <span className="text-gray-300">{a.message}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function DeadLetterPanel() {
  const { t } = useTranslation();
  const [queue, setQueue] = useState(QUEUE_KEYS[0]);
  const [busy, setBusy] = useState(null);
  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const { data: body } = await adminApi.get('/admin/ops/queues/dead-letter', {
      params: { queue, limit: 50 }, signal,
    });
    return body.jobs || [];
  }, [queue]);

  const requeue = async (jobId) => {
    setBusy(jobId);
    try {
      await adminApi.post(`/admin/ops/queues/dead-letter/${jobId}/requeue`, { queue });
      reload();
    } catch {
      // Error is visible to the operator as a toast on the shared client;
      // refresh anyway so the row reflects reality.
      reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel>
      <div className="px-5 pt-4 flex items-center justify-between">
        <PanelTitle>{t('wsReliability.integrations.deadLetter')}</PanelTitle>
      </div>
      <div className="px-5 py-3 flex flex-wrap items-center gap-2">
        <select
          value={queue}
          onChange={(e) => setQueue(e.target.value)}
          className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
        >
          {QUEUE_KEYS.map((q) => <option key={q} value={q}>{q}</option>)}
        </select>
        <button
          type="button"
          onClick={reload}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-gray-300 bg-gray-800 border border-gray-700 hover:bg-gray-700"
        >
          <RefreshCw size={14} /> {t('common.refresh')}
        </button>
      </div>
      {loading && <p className="px-5 pb-5 text-sm text-gray-500">{t('common.loading')}</p>}
      {error && <div className="px-5 pb-5"><AdminErrorState onRetry={reload} /></div>}
      {!loading && !error && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <TableHead columns={[
              t('wsReliability.integrations.jobId'),
              t('wsReliability.integrations.reason'),
              t('wsReliability.integrations.action'),
            ]} />
            <tbody>
              {(data || []).map((job) => (
                <tr key={job.id || job.jobId} className="border-b border-gray-800 last:border-0">
                  <td className="px-5 py-3 font-mono text-gray-200 text-xs">{job.id || job.jobId}</td>
                  <td className="px-5 py-3 text-gray-400 max-w-md truncate">{job.error || job.reason || '-'}</td>
                  <td className="px-5 py-3">
                    <button
                      type="button"
                      disabled={busy === (job.id || job.jobId)}
                      onClick={() => requeue(job.id || job.jobId)}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-50"
                    >
                      {busy === (job.id || job.jobId)
                        ? <Loader2 size={13} className="animate-spin" />
                        : <RotateCcw size={13} />}
                      {t('wsReliability.integrations.requeue')}
                    </button>
                  </td>
                </tr>
              ))}
              {(!data || data.length === 0) && (
                <tr><td colSpan={3} className="px-5 py-8 text-center text-gray-500">{t('wsReliability.integrations.noDeadLetter')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function WebhookRetryPanel() {
  const { t } = useTranslation();
  const [deliveryId, setDeliveryId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const retry = async (e) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const { data } = await adminApi.post(`/admin/ops/webhooks/${deliveryId.trim()}/retry`);
      setResult({ ok: true, message: t('wsReliability.integrations.retryOk') });
      setDeliveryId('');
    } catch (err) {
      setResult({ ok: false, message: err.response?.data?.error || t('wsReliability.integrations.retryFailed') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="p-5">
      <PanelTitle>{t('wsReliability.integrations.webhookRetry')}</PanelTitle>
      <p className="text-sm text-gray-400 mt-1 mb-4">{t('wsReliability.integrations.webhookRetryNote')}</p>
      <form onSubmit={retry} className="flex flex-col sm:flex-row gap-2">
        <input
          value={deliveryId}
          onChange={(e) => setDeliveryId(e.target.value)}
          placeholder="delivery UUID"
          className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 font-mono focus:outline-none focus:border-purple-500"
        />
        <button
          type="submit"
          disabled={busy || !deliveryId.trim()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-50"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          {t('wsReliability.integrations.retry')}
        </button>
      </form>
      {result && (
        <p className={`mt-3 text-sm ${result.ok ? 'text-green-400' : 'text-red-400'}`}>{result.message}</p>
      )}
    </Panel>
  );
}

function IntegrationsTab() {
  return (
    <div className="space-y-4">
      <HealthSummary />
      <DeadLetterPanel />
      <WebhookRetryPanel />
    </div>
  );
}

// ── Budgets tab ─────────────────────────────────────────────────────────────

function BudgetsTab() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const { data: body } = await adminApi.get('/admin/super/reliability/budgets', { signal });
    return body.budgets || [];
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">{t('wsReliability.budgets.note')}</p>
        <button
          type="button"
          onClick={reload}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-gray-300 bg-gray-800 border border-gray-700 hover:bg-gray-700"
        >
          <RefreshCw size={15} /> {t('common.refresh')}
        </button>
      </div>
      {loading && <p className="text-sm text-gray-500">{t('common.loading')}</p>}
      {error && <AdminErrorState onRetry={reload} />}
      {!loading && !error && (
        <Panel>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <TableHead columns={[
                t('wsReliability.budgets.name'),
                t('wsReliability.budgets.maxConcurrent'),
                t('wsReliability.budgets.active'),
                t('wsReliability.budgets.queued'),
                t('wsReliability.budgets.queueTimeout'),
                t('wsReliability.budgets.statementTimeout'),
              ]} />
              <tbody>
                {(data || []).map((b) => (
                  <tr key={b.name} className="border-b border-gray-800 last:border-0">
                    <td className="px-5 py-3 font-medium text-white">{b.name}</td>
                    <td className="px-5 py-3 text-gray-300">{b.config?.maxConcurrent ?? '-'}</td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                        (b.state?.active ?? 0) >= (b.config?.maxConcurrent ?? Infinity)
                          ? 'bg-red-900 text-red-300'
                          : 'bg-gray-800 text-gray-300'
                      }`}>
                        {b.state?.active ?? '-'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-300">{b.state?.queued ?? '-'}</td>
                    <td className="px-5 py-3 text-gray-400">{b.config?.queueTimeoutMs != null ? `${b.config.queueTimeoutMs} ms` : '-'}</td>
                    <td className="px-5 py-3 text-gray-400">{b.config?.statementTimeoutMs != null ? `${b.config.statementTimeoutMs} ms` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────

const TAB_META = {
  releases:     { icon: Rocket,    labelKey: 'wsReliability.tabs.releases' },
  migrations:   { icon: GitBranch, labelKey: 'wsReliability.tabs.migrations' },
  integrations: { icon: Plug,      labelKey: 'wsReliability.tabs.integrations' },
  budgets:      { icon: Gauge,     labelKey: 'wsReliability.tabs.budgets' },
};

export default function ReliabilityPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('releases');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">{t('wsReliability.title')}</h1>
        <p className="text-sm text-gray-400 mt-1">{t('wsReliability.subtitle')}</p>
      </div>

      <div className="flex gap-1 border-b border-gray-800">
        {TABS.map((key) => {
          const { icon: Icon, labelKey } = TAB_META[key];
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${
                active
                  ? 'border-purple-500 text-white'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <Icon size={16} /> {t(labelKey)}
            </button>
          );
        })}
      </div>

      {tab === 'releases' && <ReleasesTab />}
      {tab === 'migrations' && <MigrationsTab />}
      {tab === 'integrations' && <IntegrationsTab />}
      {tab === 'budgets' && <BudgetsTab />}
    </div>
  );
}
