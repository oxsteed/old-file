import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  Ban, CheckCircle2, FileWarning, History,
  Layers, Pause, Play, RefreshCw, RotateCcw, ShieldCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import { useHasGrant } from '../../lib/GrantGuard';
import ConfirmDialog from '../../lib/ConfirmDialog';
import { adminDate } from '../../lib/formatters';
import './StatementOperations.css';

const BASE = '/admin/statements';
const PAGE_LIMIT = 25;

const TABS = ['runs', 'failures', 'amendments', 'audit', 'alerts'];

function shortId(id) {
  return typeof id === 'string' && id.length > 8 ? id.slice(0, 8) : id;
}

function StatePill({ value, t }) {
  const map = {
    running: 'stmtops-pill stmtops-pill-blue',
    paused: 'stmtops-pill stmtops-pill-amber',
    completed: 'stmtops-pill stmtops-pill-green',
    failed: 'stmtops-pill stmtops-pill-red',
    cancelled: 'stmtops-pill stmtops-pill-gray',
    pending: 'stmtops-pill stmtops-pill-gray',
    dead_letter: 'stmtops-pill stmtops-pill-red',
    proposed: 'stmtops-pill stmtops-pill-amber',
    approved: 'stmtops-pill stmtops-pill-green',
    rejected: 'stmtops-pill stmtops-pill-red',
  };
  return <span className={map[value] || 'stmtops-pill stmtops-pill-gray'}>{t(`statementOps.state_${value}`, { defaultValue: value })}</span>;
}

function ErrorNote({ message }) {
  if (!message) return null;
  return (
    <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
      {message}
    </div>
  );
}

function Pager({ page, total, limit, onPage, t }) {
  const pages = Math.max(1, Math.ceil((total || 0) / limit));
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-gray-400">
      <span>{t('statementOps.pageOf', { page, pages })}</span>
      <div className="flex gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}
          className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-gray-200 disabled:opacity-40 hover:bg-gray-700">
          {t('statementOps.prev')}
        </button>
        <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}
          className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-gray-200 disabled:opacity-40 hover:bg-gray-700">
          {t('statementOps.next')}
        </button>
      </div>
    </div>
  );
}

export default function StatementOperations() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('runs');
  const [lastLoadedAt, setLastLoadedAt] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const { allowed: canOperate } = useHasGrant('manage_operations');
  const { allowed: canDecide } = useHasGrant('manage_financials');

  const refresh = useCallback(() => setRefreshTick((v) => v + 1), []);

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-orange-500/20 bg-orange-500/10 p-2">
              <Layers size={19} className="text-orange-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">{t('statementOps.title')}</h1>
          </div>
          <p className="text-gray-400 text-sm mt-1">{t('statementOps.subtitle')}</p>
          {lastLoadedAt && (
            <p className="text-gray-500 text-xs mt-1">
              {t('statementOps.lastLoaded', { when: adminDate(lastLoadedAt) })}
            </p>
          )}
        </div>
        <button type="button" onClick={refresh}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-700 bg-gray-800 text-sm text-gray-200 hover:bg-gray-700 transition">
          <RefreshCw size={14} />
          {t('statementOps.refresh')}
        </button>
      </div>

      <div className="stmtops-tabs mb-6" role="tablist">
        {TABS.map((key) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`stmtops-tab ${tab === key ? 'stmtops-tab-active' : ''}`}>
            {t(`statementOps.tab_${key}`)}
          </button>
        ))}
      </div>

      {tab === 'runs' && (
        <RunsTab key={`runs-${refreshTick}`} t={t} canOperate={canOperate} onLoaded={setLastLoadedAt} />
      )}
      {tab === 'failures' && (
        <FailuresTab key={`failures-${refreshTick}`} t={t} canOperate={canOperate} onLoaded={setLastLoadedAt} />
      )}
      {tab === 'amendments' && (
        <AmendmentsTab key={`amendments-${refreshTick}`} t={t} canDecide={canDecide} onLoaded={setLastLoadedAt} />
      )}
      {tab === 'audit' && (
        <AuditTab key={`audit-${refreshTick}`} t={t} onLoaded={setLastLoadedAt} />
      )}
      {tab === 'alerts' && (
        <AlertsTab key={`alerts-${refreshTick}`} t={t} onLoaded={setLastLoadedAt} />
      )}
    </div>
  );
}

function RunsTab({ t, canOperate, onLoaded }) {
  const [runs, setRuns] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await adminApi.get(`${BASE}/ops/runs`, { params: { page, limit: PAGE_LIMIT } });
      setRuns(data.items || []);
      setTotal(data.total || 0);
      onLoaded(new Date());
    } catch (err) {
      setError(err.response?.data?.error || t('statementOps.errorLoad'));
    } finally {
      setLoading(false);
    }
  }, [page, t, onLoaded]);

  useEffect(() => { load(); }, [load]);

  const mutate = async (runId, verb, reason) => {
    await adminApi.post(`${BASE}/ops/runs/${runId}/${verb}`, { reason });
    setConfirm(null);
    load();
  };

  return (
    <div>
      <ErrorNote message={error} />
      {loading ? (
        <p className="text-gray-400 text-sm">{t('statementOps.loading')}</p>
      ) : runs.length === 0 ? (
        <p className="text-gray-400 text-sm">{t('statementOps.runsEmpty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-900 text-left text-gray-400">
                <th className="px-4 py-3 font-medium">{t('statementOps.colRun')}</th>
                <th className="px-4 py-3 font-medium">{t('statementOps.colProduct')}</th>
                <th className="px-4 py-3 font-medium">{t('statementOps.colPeriod')}</th>
                <th className="px-4 py-3 font-medium">{t('statementOps.colState')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('statementOps.colExpected')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('statementOps.colIssued')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('statementOps.colFailed')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('statementOps.colQueueAge')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('statementOps.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <Fragment key={run.runId}>
                  <tr className="border-t border-gray-800 hover:bg-gray-900/50">
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => setExpandedId(expandedId === run.runId ? null : run.runId)}
                        className="font-mono text-orange-300 hover:text-orange-200" title={run.runId}>
                        {shortId(run.runId)}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-300">{run.product}</td>
                    <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{run.period?.from} / {run.period?.to}</td>
                    <td className="px-4 py-3"><StatePill value={run.state} t={t} /></td>
                    <td className="px-4 py-3 text-right text-gray-200">{run.expected}</td>
                    <td className="px-4 py-3 text-right text-gray-200">{run.issued}</td>
                    <td className="px-4 py-3 text-right text-gray-200">{run.failed}</td>
                    <td className="px-4 py-3 text-right text-gray-200">
                      {run.oldestQueueAgeSec == null ? '-' : t('statementOps.secondsAgo', { n: run.oldestQueueAgeSec })}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {canOperate && run.state === 'running' && (
                        <button type="button"
                          onClick={() => setConfirm({ runId: run.runId, verb: 'pause' })}
                          className="inline-flex items-center gap-1 rounded-lg border border-amber-600/40 bg-amber-600/10 px-2.5 py-1 text-xs text-amber-300 hover:bg-amber-600/20">
                          <Pause size={12} />{t('statementOps.pause')}
                        </button>
                      )}
                      {canOperate && run.state === 'paused' && (
                        <button type="button"
                          onClick={() => setConfirm({ runId: run.runId, verb: 'resume' })}
                          className="inline-flex items-center gap-1 rounded-lg border border-green-600/40 bg-green-600/10 px-2.5 py-1 text-xs text-green-300 hover:bg-green-600/20">
                          <Play size={12} />{t('statementOps.resume')}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expandedId === run.runId && (
                    <tr className="border-t border-gray-800 bg-gray-900/30">
                      <td colSpan={9} className="px-4 py-4">
                        <RunDetail runId={run.runId} t={t} canOperate={canOperate} onChanged={load} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} total={total} limit={PAGE_LIMIT} onPage={setPage} t={t} />

      {confirm && (
        <ConfirmDialog
          open
          title={t(confirm.verb === 'pause' ? 'statementOps.confirmPauseTitle' : 'statementOps.confirmResumeTitle')}
          message={t(confirm.verb === 'pause' ? 'statementOps.confirmPauseBody' : 'statementOps.confirmResumeBody')}
          requireReason
          reasonPlaceholder={t('statementOps.reasonPlaceholder')}
          confirmLabel={t(confirm.verb === 'pause' ? 'statementOps.pause' : 'statementOps.resume')}
          onClose={() => setConfirm(null)}
          onConfirm={(reason) => mutate(confirm.runId, confirm.verb, reason)}
        />
      )}
    </div>
  );
}

function RunDetail({ runId, t, canOperate, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmRetry, setConfirmRetry] = useState(null);
  const [confirmReconcile, setConfirmReconcile] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await adminApi.get(`${BASE}/ops/runs/${encodeURIComponent(runId)}`);
      setDetail(data);
    } catch (err) {
      setError(err.response?.data?.error || t('statementOps.errorLoad'));
    } finally {
      setLoading(false);
    }
  }, [runId, t]);

  useEffect(() => { load(); }, [load]);

  const doRetry = async (jobId, reason) => {
    await adminApi.post(`${BASE}/ops/jobs/${encodeURIComponent(jobId)}/retry`, { reason });
    setConfirmRetry(null);
    load();
    if (onChanged) onChanged();
  };

  const doReconcile = async (reason) => {
    setReconciling(true);
    try {
      const { data } = await adminApi.post(`${BASE}/ops/artifacts/reconcile`, { reason });
      setReconcileResult(data);
    } catch (err) {
      setError(err.response?.data?.error || t('statementOps.errorLoad'));
    } finally {
      setReconciling(false);
    }
  };

  if (loading) return <p className="text-gray-400 text-sm">{t('statementOps.loading')}</p>;
  if (error) return <ErrorNote message={error} />;
  if (!detail) return null;

  const counts = Object.entries(detail.stateCounts || {});
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {counts.map(([state, n]) => (
          <span key={state} className="inline-flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-1.5 text-xs text-gray-300">
            <StatePill value={state} t={t} /><span className="font-semibold">{n}</span>
          </span>
        ))}
        <span className="inline-flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-1.5 text-xs text-gray-400">
          {t('statementOps.detailAsOf', { when: adminDate(detail.meta?.asOf) })}
        </span>
      </div>

      {detail.failures && detail.failures.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-gray-900 text-left text-gray-400">
                <th className="px-3 py-2 font-medium">{t('statementOps.colJob')}</th>
                <th className="px-3 py-2 font-medium">{t('statementOps.colOwner')}</th>
                <th className="px-3 py-2 font-medium">{t('statementOps.colReason')}</th>
                <th className="px-3 py-2 font-medium">{t('statementOps.colCorrelation')}</th>
                <th className="px-3 py-2 font-medium text-right">{t('statementOps.colAttempts')}</th>
                <th className="px-3 py-2 font-medium">{t('statementOps.colNextRetry')}</th>
                <th className="px-3 py-2 font-medium">{t('statementOps.colRecommended')}</th>
                <th className="px-3 py-2 font-medium text-right">{t('statementOps.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {detail.failures.map((f) => (
                <tr key={f.jobId} className="border-t border-gray-800">
                  <td className="px-3 py-2 font-mono text-orange-300" title={f.jobId}>{shortId(f.jobId)}</td>
                  <td className="px-3 py-2 text-gray-300">{f.leaseOwner || '-'}</td>
                  <td className="px-3 py-2 text-gray-300 max-w-xs truncate" title={f.lastError || ''}>{f.lastError || '-'}</td>
                  <td className="px-3 py-2 font-mono text-gray-400 max-w-xs truncate" title={f.correlationId || ''}>{f.correlationId || '-'}</td>
                  <td className="px-3 py-2 text-right text-gray-200">{f.attempts}/{f.maxAttempts}</td>
                  <td className="px-3 py-2 text-gray-300 whitespace-nowrap">{f.nextRetryAt ? adminDate(f.nextRetryAt) : '-'}</td>
                  <td className="px-3 py-2 text-gray-300">{f.recommendedAction || '-'}</td>
                  <td className="px-3 py-2 text-right">
                    {canOperate && (f.state === 'failed' || f.state === 'dead_letter') && (
                      <button type="button" onClick={() => setConfirmRetry(f.jobId)}
                        className="inline-flex items-center gap-1 rounded-lg border border-blue-600/40 bg-blue-600/10 px-2.5 py-1 text-xs text-blue-300 hover:bg-blue-600/20">
                        <RotateCcw size={12} />{t('statementOps.retry')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canOperate && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={reconciling} onClick={() => setConfirmReconcile(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-gray-200 hover:bg-gray-700 disabled:opacity-50">
            <ShieldCheck size={13} />
            {reconciling ? t('statementOps.reconciling') : t('statementOps.reconcileArtifacts')}
          </button>
          {reconcileResult && (
            <span className="text-xs text-gray-300">
              {t('statementOps.reconcileSummary', {
                checked: reconcileResult.checked, missing: reconcileResult.missing, corrupt: reconcileResult.corrupt,
              })}
            </span>
          )}
        </div>
      )}

      {confirmReconcile && (
        <ConfirmDialog
          open
          title={t('statementOps.confirmReconcileTitle')}
          message={t('statementOps.confirmReconcileBody')}
          requireReason
          reasonPlaceholder={t('statementOps.reasonPlaceholder')}
          confirmLabel={t('statementOps.reconcileArtifacts')}
          onClose={() => setConfirmReconcile(false)}
          onConfirm={async (reason) => { setConfirmReconcile(false); await doReconcile(reason); }}
        />
      )}

      {confirmRetry && (
        <ConfirmDialog
          open
          title={t('statementOps.confirmRetryTitle')}
          message={t('statementOps.confirmRetryBody')}
          requireReason
          reasonPlaceholder={t('statementOps.reasonPlaceholder')}
          confirmLabel={t('statementOps.retry')}
          onClose={() => setConfirmRetry(null)}
          onConfirm={(reason) => doRetry(confirmRetry, reason)}
        />
      )}
    </div>
  );
}
function FailureRow({ f, t, canOperate, onRetry }) {
  const ref = f.jobId || f.attemptId || f.eventId;
  const detail = f.type === 'generation'
    ? `${f.product || ''} ${f.currencyCode || ''}`.trim()
    : f.type === 'notification'
      ? f.eventType
      : f.objectKey;
  const state = f.state || f.outcome;
  const attempts = f.type === 'generation'
    ? `${f.attempts}/${f.maxAttempts}`
    : f.attempt != null ? String(f.attempt) : String(f.attempts ?? '-');
  const when = f.type === 'generation' ? f.nextRetryAt : f.createdAt;
  const retryable = canOperate && f.type === 'generation' && (f.state === 'failed' || f.state === 'dead_letter');
  return (
    <tr className="border-t border-gray-800 hover:bg-gray-900/50">
      <td className="px-4 py-3 font-mono text-orange-300" title={ref}>{shortId(ref)}</td>
      <td className="px-4 py-3 text-gray-300">{t(`statementOps.failureType_${f.type}`, { defaultValue: f.type })}</td>
      <td className="px-4 py-3 text-gray-300 max-w-xs truncate" title={detail || ''}>{detail || '-'}</td>
      <td className="px-4 py-3">{state ? <StatePill value={state} t={t} /> : <span className="text-gray-500">-</span>}</td>
      <td className="px-4 py-3 text-right text-gray-200">{attempts}</td>
      <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{when ? adminDate(when) : '-'}</td>
      <td className="px-4 py-3 text-right">
        {retryable && (
          <button type="button" onClick={() => onRetry(f.jobId)}
            className="inline-flex items-center gap-1 rounded-lg border border-blue-600/40 bg-blue-600/10 px-2.5 py-1 text-xs text-blue-300 hover:bg-blue-600/20">
            <RotateCcw size={12} />{t('statementOps.retry')}
          </button>
        )}
      </td>
    </tr>
  );
}

function FailuresTab({ t, canOperate, onLoaded }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ type: '', product: '', currency: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmRetry, setConfirmRetry] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await adminApi.get(`${BASE}/ops/failures`, {
        params: { page, limit: PAGE_LIMIT, ...filters },
      });
      setItems(data.items || []);
      setTotal(data.total || 0);
      onLoaded(new Date());
    } catch (err) {
      setError(err.response?.data?.error || t('statementOps.errorLoad'));
    } finally {
      setLoading(false);
    }
  }, [page, filters, t, onLoaded]);

  useEffect(() => { load(); }, [load]);

  const doRetry = async (jobId, reason) => {
    await adminApi.post(`${BASE}/ops/jobs/${encodeURIComponent(jobId)}/retry`, { reason });
    setConfirmRetry(null);
    load();
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-300">
          {t('statementOps.filterType')}
          <select value={filters.type} onChange={(e) => { setPage(1); setFilters({ ...filters, type: e.target.value }); }}
            className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-gray-200">
            <option value="">{t('statementOps.all')}</option>
            {['generation', 'storage', 'reconciliation', 'notification'].map((v) => (
              <option key={v} value={v}>{t(`statementOps.failureType_${v}`)}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          {t('statementOps.filterProduct')}
          <select value={filters.product} onChange={(e) => { setPage(1); setFilters({ ...filters, product: e.target.value }); }}
            className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-gray-200">
            <option value="">{t('statementOps.all')}</option>
            <option value="oxsteed">oxsteed</option>
            <option value="restaurant">restaurant</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          {t('statementOps.filterCurrency')}
          <input value={filters.currency} maxLength={3}
            onChange={(e) => { setPage(1); setFilters({ ...filters, currency: e.target.value.toUpperCase() }); }}
            placeholder="USD"
            className="w-20 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-gray-200" />
        </label>
      </div>

      <ErrorNote message={error} />
      {loading ? (
        <p className="text-gray-400 text-sm">{t('statementOps.loading')}</p>
      ) : items.length === 0 ? (
        <p className="text-gray-400 text-sm">{t('statementOps.failuresEmpty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-900 text-left text-gray-400">
                <th className="px-4 py-3 font-medium">{t('statementOps.colReference')}</th>
                <th className="px-4 py-3 font-medium">{t('statementOps.colType')}</th>
                <th className="px-4 py-3 font-medium">{t('statementOps.colDetail')}</th>
                <th className="px-4 py-3 font-medium">{t('statementOps.colState')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('statementOps.colAttempts')}</th>
                <th className="px-4 py-3 font-medium">{t('statementOps.colTime')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('statementOps.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((f) => (
                <FailureRow key={`${f.type}-${f.jobId || f.attemptId || f.eventId}`} f={f} t={t}
                  canOperate={canOperate} onRetry={setConfirmRetry} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} total={total} limit={PAGE_LIMIT} onPage={setPage} t={t} />

      {confirmRetry && (
        <ConfirmDialog
          open
          title={t('statementOps.confirmRetryTitle')}
          message={t('statementOps.confirmRetryBody')}
          requireReason
          reasonPlaceholder={t('statementOps.reasonPlaceholder')}
          confirmLabel={t('statementOps.retry')}
          onClose={() => setConfirmRetry(null)}
          onConfirm={(reason) => doRetry(confirmRetry, reason)}
        />
      )}
    </div>
  );
}

function AmendmentsTab({ t, canDecide, onLoaded }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('proposed');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await adminApi.get(`${BASE}/ops/amendments`, {
        params: { page, limit: PAGE_LIMIT, status },
      });
      setItems(data.items || []);
      setTotal(data.total || 0);
      onLoaded(new Date());
    } catch (err) {
      setError(err.response?.data?.error || t('statementOps.errorLoad'));
    } finally {
      setLoading(false);
    }
  }, [page, status, t, onLoaded]);

  useEffect(() => { load(); }, [load]);

  const decide = async (id, verb, reason) => {
    await adminApi.post(`${BASE}/ops/amendments/${encodeURIComponent(id)}/${verb}`, { reason });
    setConfirm(null);
    load();
  };

  return (
    <div>
      <p className="mb-4 text-xs text-gray-500">{t('statementOps.amendmentsWorkerNote')}</p>
      <div className="mb-4 flex gap-2">
        {['proposed', 'approved', 'rejected', ''].map((s) => (
          <button key={s || 'all'} type="button"
            onClick={() => { setPage(1); setStatus(s); }}
            className={`rounded-lg px-3 py-1.5 text-xs border ${status === s ? 'border-orange-500/50 bg-orange-500/10 text-orange-300' : 'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
            {s === '' ? t('statementOps.all') : t(`statementOps.amendmentStatus_${s}`, { defaultValue: s })}
          </button>
        ))}
      </div>

      <ErrorNote message={error} />
      {loading ? (
        <p className="text-gray-400 text-sm">{t('statementOps.loading')}</p>
      ) : items.length === 0 ? (
        <p className="text-gray-400 text-sm">{t('statementOps.amendmentsEmpty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-900 text-left text-gray-400">
                <th className="px-4 py-3 font-medium">{t('statementOps.colProposal')}</th>
                <th className="px-4 py-3 font-medium">{t('statementOps.colDocument')}</th>
                <th className="px-4 py-3 font-medium">{t('statementOps.colReason')}</th>
                <th className="px-4 py-3 font-medium">{t('statementOps.colInitiator')}</th>
                <th className="px-4 py-3 font-medium">{t('statementOps.colProposedAt')}</th>
                <th className="px-4 py-3 font-medium">{t('statementOps.colStatus')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('statementOps.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-t border-gray-800 hover:bg-gray-900/50">
                  <td className="px-4 py-3 font-mono text-orange-300" title={p.id}>{shortId(p.id)}</td>
                  <td className="px-4 py-3 font-mono text-gray-400 max-w-xs truncate" title={p.issuanceKey}>{p.issuanceKey}</td>
                  <td className="px-4 py-3 text-gray-300 max-w-xs truncate" title={p.reason}>{p.reason}</td>
                  <td className="px-4 py-3 font-mono text-gray-400" title={p.proposedBy}>{shortId(p.proposedBy)}</td>
                  <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{p.proposedAt ? adminDate(p.proposedAt) : '-'}</td>
                  <td className="px-4 py-3"><StatePill value={p.status} t={t} /></td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {canDecide && p.status === 'proposed' && (
                      <>
                        <button type="button" onClick={() => setConfirm({ id: p.id, verb: 'approve' })}
                          className="mr-2 inline-flex items-center gap-1 rounded-lg border border-green-600/40 bg-green-600/10 px-2.5 py-1 text-xs text-green-300 hover:bg-green-600/20">
                          <CheckCircle2 size={12} />{t('statementOps.approve')}
                        </button>
                        <button type="button" onClick={() => setConfirm({ id: p.id, verb: 'reject' })}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-600/40 bg-red-600/10 px-2.5 py-1 text-xs text-red-300 hover:bg-red-600/20">
                          <Ban size={12} />{t('statementOps.reject')}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} total={total} limit={PAGE_LIMIT} onPage={setPage} t={t} />

      {confirm && (
        <ConfirmDialog
          open
          title={t(confirm.verb === 'approve' ? 'statementOps.confirmApproveTitle' : 'statementOps.confirmRejectTitle')}
          message={t(confirm.verb === 'approve' ? 'statementOps.confirmApproveBody' : 'statementOps.confirmRejectBody')}
          requireReason
          reasonPlaceholder={t('statementOps.reasonPlaceholder')}
          confirmLabel={t(confirm.verb === 'approve' ? 'statementOps.approve' : 'statementOps.reject')}
          danger={confirm.verb === 'reject'}
          onClose={() => setConfirm(null)}
          onConfirm={(reason) => decide(confirm.id, confirm.verb, reason)}
        />
      )}
    </div>
  );
}

function AuditTab({ t, onLoaded }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await adminApi.get(`${BASE}/audit`, {
        params: { page, limit: 50, action: actionFilter || undefined },
      });
      setItems(data.items || []);
      setTotal(data.total || 0);
      onLoaded(new Date());
    } catch (err) {
      setError(err.response?.data?.error || t('statementOps.errorLoad'));
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter, t, onLoaded]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-300">
          {t('statementOps.filterAction')}
          <input value={actionFilter} onChange={(e) => { setPage(1); setActionFilter(e.target.value); }}
            placeholder={t('statementOps.filterActionPlaceholder')}
            className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-gray-200" />
        </label>
        <span className="text-xs text-gray-500">{t('statementOps.auditImmutableNote')}</span>
      </div>

      <ErrorNote message={error} />
      {loading ? (
        <p className="text-gray-400 text-sm">{t('statementOps.loading')}</p>
      ) : items.length === 0 ? (
        <p className="text-gray-400 text-sm">{t('statementOps.auditEmpty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-900 text-left text-gray-400">
                <th className="px-4 py-3 font-medium">{t('statementOps.colTime')}</th>
                <th className="px-4 py-3 font-medium">{t('statementOps.colActor')}</th>
                <th className="px-4 py-3 font-medium">{t('statementOps.colAction')}</th>
                <th className="px-4 py-3 font-medium">{t('statementOps.colTarget')}</th>
                <th className="px-4 py-3 font-medium">{t('statementOps.colOutcome')}</th>
                <th className="px-4 py-3 font-medium">{t('statementOps.colReason')}</th>
                <th className="px-4 py-3 font-medium">{t('statementOps.colCorrelation')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.eventId} className="border-t border-gray-800 hover:bg-gray-900/50">
                  <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{e.occurredAt ? adminDate(e.occurredAt) : '-'}</td>
                  <td className="px-4 py-3 text-gray-300 max-w-xs truncate" title={e.actorEmail || e.actorId || ''}>
                    {e.actorName || (e.actorId ? shortId(e.actorId) : '-')}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-200">{e.action}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400 max-w-xs truncate" title={e.targetKey || e.targetId || ''}>
                    {e.targetKey || (e.targetId ? shortId(String(e.targetId)) : '-')}
                  </td>
                  <td className="px-4 py-3 text-gray-300">{e.outcome || '-'}</td>
                  <td className="px-4 py-3 text-gray-300 max-w-xs truncate" title={e.reason || ''}>{e.reason || '-'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400 max-w-xs truncate" title={e.correlationId || ''}>
                    {e.correlationId ? shortId(e.correlationId) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} total={total} limit={50} onPage={setPage} t={t} />
    </div>
  );
}

function AlertsTab({ t, onLoaded }) {
  const [alerts, setAlerts] = useState([]);
  const [evaluatedAt, setEvaluatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await adminApi.get(`${BASE}/ops/alerts`);
      setAlerts(data.alerts || []);
      setEvaluatedAt(data.evaluatedAt || null);
      onLoaded(new Date());
    } catch (err) {
      setError(err.response?.data?.error || t('statementOps.errorLoad'));
    } finally {
      setLoading(false);
    }
  }, [t, onLoaded]);

  useEffect(() => { load(); }, [load]);

  const sevClass = { high: 'stmtops-pill stmtops-pill-red', medium: 'stmtops-pill stmtops-pill-amber', low: 'stmtops-pill stmtops-pill-blue' };

  return (
    <div>
      <ErrorNote message={error} />
      {evaluatedAt && (
        <p className="mb-4 text-xs text-gray-500">
          {t('statementOps.alertsEvaluatedAt', { when: adminDate(evaluatedAt) })}
        </p>
      )}
      {loading ? (
        <p className="text-gray-400 text-sm">{t('statementOps.loading')}</p>
      ) : alerts.length === 0 ? (
        <div className="rounded-xl border border-green-600/30 bg-green-600/10 px-4 py-6 text-center">
          <CheckCircle2 size={22} className="mx-auto mb-2 text-green-400" />
          <p className="text-sm text-green-300">{t('statementOps.alertsEmpty')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((a, i) => (
            <div key={`${a.code}-${i}`} className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className={sevClass[a.severity] || 'stmtops-pill stmtops-pill-gray'}>
                  {t(`statementOps.severity_${a.severity}`, { defaultValue: a.severity })}
                </span>
                <span className="font-mono text-xs text-gray-500">{a.code}</span>
                <span className="text-sm font-semibold text-gray-100">{a.title}</span>
              </div>
              <p className="text-sm text-gray-300">{a.detail}</p>
              {a.recommendedAction && (
                <p className="mt-1 text-xs text-gray-500">
                  <FileWarning size={11} className="mr-1 inline" />
                  {a.recommendedAction}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 flex items-center gap-2 text-xs text-gray-500">
        <History size={12} />
        <span>{t('statementOps.alertsThresholdNote')}</span>
      </div>
    </div>
  );
}
