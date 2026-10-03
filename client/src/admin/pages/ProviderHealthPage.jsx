import { useCallback, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, CheckCircle2, MinusCircle, RefreshCw, ShieldAlert, XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';

// V2-P1-07 — one operator view over the uniform provider-health contract.
// Server: GET /api/provider-health (admin + manage_operations).

const STATUS_TONE = {
  ok: 'border-emerald-700/60 bg-emerald-950/40 text-emerald-300',
  degraded: 'border-amber-700/60 bg-amber-950/40 text-amber-300',
  down: 'border-red-700/60 bg-red-950/40 text-red-300',
  not_configured: 'border-gray-700 bg-gray-900/60 text-gray-400',
  unknown: 'border-sky-700/60 bg-sky-950/40 text-sky-300',
};

const STATUS_ICON = {
  ok: CheckCircle2,
  degraded: AlertTriangle,
  down: XCircle,
  not_configured: MinusCircle,
  unknown: Activity,
};

const CIRCUIT_TONE = {
  closed: 'text-emerald-300',
  open: 'text-red-300',
  half_open: 'text-amber-300',
};

function StatusPill({ status, t }) {
  const Icon = STATUS_ICON[status] || Activity;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_TONE[status] || STATUS_TONE.unknown}`}>
      <Icon size={13} aria-hidden="true" />
      {t(`adminProviderHealth.status.${status === 'not_configured' ? 'notConfigured' : status}`, { defaultValue: status })}
    </span>
  );
}

function Field({ label, children }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-sm text-gray-200">{children}</div>
    </div>
  );
}

function ProviderCard({ provider, t, onResetCircuit, resetting }) {
  const [confirmingReset, setConfirmingReset] = useState(false);

  const retry = provider.retryPolicy || {};
  const circuit = provider.circuit || {};
  const budget = provider.budget || {};
  const rotation = provider.rotationPolicy || {};

  const handleReset = useCallback(async () => {
    if (!confirmingReset) {
      setConfirmingReset(true);
      return;
    }
    setConfirmingReset(false);
    await onResetCircuit(provider.id);
  }, [confirmingReset, onResetCircuit, provider.id]);

  return (
    <article className="rounded-2xl border border-gray-800 bg-gray-950/70 p-5 shadow-sm" aria-label={t(`adminProviderHealth.providers.${provider.id}.name`, { defaultValue: provider.name })}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">
            {t(`adminProviderHealth.providers.${provider.id}.name`, { defaultValue: provider.name })}
          </h2>
          <p className="mt-1 max-w-xl text-sm text-gray-400">
            {t(`adminProviderHealth.providers.${provider.id}.description`, { defaultValue: '' })}
          </p>
        </div>
        <StatusPill status={provider.status} t={t} />
      </div>

      {provider.detail && (
        <p className="mt-3 rounded-lg bg-gray-900/60 px-3 py-2 font-mono text-xs text-gray-400">{provider.detail}</p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('adminProviderHealth.fields.owner')}>{provider.owner}</Field>
        <Field label={t('adminProviderHealth.fields.alertChannel')}>{provider.alertChannel}</Field>
        <Field label={t('adminProviderHealth.fields.lastProbe')}>
          {provider.probedAt ? new Date(provider.probedAt).toLocaleString() : '—'}
          {typeof provider.latencyMs === 'number' && ` (${provider.latencyMs}ms)`}
        </Field>
        <Field label={t('adminProviderHealth.fields.dependencies')}>
          <span className="font-mono text-xs">{(provider.dependencies || []).join(', ')}</span>
        </Field>
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400">{t('adminProviderHealth.fields.capabilities')}</h3>
        <ul className="mt-2 divide-y divide-gray-800/80 rounded-xl border border-gray-800">
          {(provider.capabilities || []).map((cap) => (
            <li key={cap.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-gray-100">{t(cap.labelKey, { defaultValue: cap.id })}</span>
                <span className="rounded-full border border-gray-700 px-2 py-0.5 font-mono text-[11px] text-gray-300">
                  {t(`adminProviderHealth.failureMode.${cap.failureMode}`, { defaultValue: cap.failureMode })}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                <span className="font-medium text-gray-300">{t('adminProviderHealth.fields.customerSafe')}: </span>
                {t(cap.customerSafeKey, { defaultValue: '' })}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-gray-500">
          {t(`adminProviderHealth.providers.${provider.id}.customerSafeSummary`, { defaultValue: '' })}
        </p>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400">{t('adminProviderHealth.fields.retryPolicy')}</h3>
          <p className="mt-2 text-xs text-gray-300">
            {t('adminProviderHealth.retry.attempts', { count: retry.maxAttempts })}
            {' · '}
            {t('adminProviderHealth.retry.backoff', { backoff: retry.backoff, base: retry.baseDelayMs, max: retry.maxDelayMs })}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {t('adminProviderHealth.retry.retryOn', { list: (retry.retryOn || []).join(', ') })}
            {retry.jitter ? ` ${t('adminProviderHealth.retry.jitter')}` : ''}
          </p>
          {retry.noteKey && <p className="mt-1 text-xs italic text-gray-500">{t(retry.noteKey)}</p>}
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400">{t('adminProviderHealth.fields.circuitBreaker')}</h3>
          <p className="mt-2 text-xs">
            <span className={`font-semibold ${CIRCUIT_TONE[circuit.state] || 'text-gray-300'}`}>
              {t(`adminProviderHealth.circuit.state.${circuit.state === 'half_open' ? 'halfOpen' : circuit.state}`, { defaultValue: circuit.state })}
            </span>
            <span className="text-gray-400">
              {' · '}
              {t('adminProviderHealth.circuit.config', {
                failures: provider.circuitBreaker?.failureThreshold,
                timeout: Math.round((provider.circuitBreaker?.resetTimeoutMs || 0) / 1000),
              })}
            </span>
          </p>
          <button
            type="button"
            onClick={handleReset}
            disabled={resetting}
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:cursor-wait disabled:opacity-60"
          >
            <ShieldAlert size={13} aria-hidden="true" />
            {confirmingReset ? t('adminProviderHealth.circuit.confirmReset') : t('adminProviderHealth.circuit.reset')}
          </button>
          {confirmingReset && (
            <button
              type="button"
              onClick={() => setConfirmingReset(false)}
              className="ml-2 rounded-lg px-3 py-1.5 text-xs text-gray-400 underline hover:text-gray-200"
            >
              {t('adminProviderHealth.circuit.cancel')}
            </button>
          )}
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400">{t('adminProviderHealth.fields.budget')}</h3>
          <p className="mt-2 text-xs text-gray-300">
            {budget.monthlyUsd != null
              ? t('adminProviderHealth.budget.monthly', { amount: budget.monthlyUsd })
              : t('adminProviderHealth.budget.noFixed')}
          </p>
          {budget.noteKey && <p className="mt-1 text-xs text-gray-500">{t(budget.noteKey)}</p>}
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400">{t('adminProviderHealth.fields.rotation')}</h3>
          <p className="mt-2 text-xs text-gray-300">
            {rotation.keyRotationDays != null
              ? t('adminProviderHealth.rotation.everyDays', { days: rotation.keyRotationDays })
              : t('adminProviderHealth.rotation.noCredentials')}
          </p>
          {rotation.procedureKey && <p className="mt-1 text-xs text-gray-500">{t(rotation.procedureKey)}</p>}
        </div>
      </div>
    </article>
  );
}

export default function ProviderHealthPage() {
  const { t } = useTranslation();
  const [resetting, setResetting] = useState(null);

  const { data, loading, error, reload } = useAbortableFetch(
    useCallback(async (signal) => {
      const res = await adminApi.get('/provider-health', { signal });
      return res.data;
    }, []),
    []
  );

  const providers = useMemo(() => data?.providers || [], [data]);
  const counts = useMemo(() => {
    const next = { ok: 0, degraded: 0, down: 0, not_configured: 0, unknown: 0 };
    for (const p of providers) {
      if (p.status in next) next[p.status] += 1;
    }
    return next;
  }, [providers]);

  const handleResetCircuit = useCallback(async (providerId) => {
    setResetting(providerId);
    try {
      await adminApi.post(`/provider-health/${providerId}/circuit/reset`);
      await reload();
    } catch (err) {
      // Surface via reload error state on next fetch; keep the page usable.
    } finally {
      setResetting(null);
    }
  }, [reload]);

  return (
    <section className="min-h-full bg-gray-900 p-5 text-gray-100 sm:p-6 lg:p-8" aria-labelledby="provider-health-title">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-orange-300">
              <Activity size={15} aria-hidden="true" />
              {t('adminProviderHealth.eyebrow')}
            </div>
            <h1 id="provider-health-title" className="text-3xl font-bold tracking-tight text-white">
              {t('adminProviderHealth.title')}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-gray-400">{t('adminProviderHealth.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={() => reload()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
            {t('adminProviderHealth.refresh')}
          </button>
        </div>

        {data?.generatedAt && (
          <p className="mt-4 text-xs text-gray-500" aria-live="polite">
            {t('adminProviderHealth.updatedAt', { time: new Date(data.generatedAt).toLocaleString() })}
          </p>
        )}

        {!loading && !error && providers.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2" aria-label={t('adminProviderHealth.summaryLabel')}>
            {Object.entries(counts).map(([status, count]) => (
              <span key={status} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${STATUS_TONE[status]}`}>
                {t(`adminProviderHealth.status.${status === 'not_configured' ? 'notConfigured' : status}`, { defaultValue: status })}: {count}
              </span>
            ))}
          </div>
        )}

        {error && (
          <div role="alert" className="mt-6 flex items-center justify-between gap-3 rounded-xl border border-red-700/50 bg-red-950/30 px-4 py-3 text-sm text-red-200">
            <span>{error.message || t('adminProviderHealth.loadError')}</span>
            <button type="button" onClick={() => reload()} className="rounded px-2 py-1 font-medium underline focus:outline-none focus:ring-2 focus:ring-red-300">
              {t('adminProviderHealth.retryButton')}
            </button>
          </div>
        )}

        {loading && providers.length === 0 ? (
          <div className="mt-8 grid gap-5" aria-busy="true" aria-label={t('adminProviderHealth.loading')}>
            {[0, 1, 2].map((i) => <div key={i} className="h-72 animate-pulse rounded-2xl border border-gray-800 bg-gray-950/60" />)}
          </div>
        ) : (
          <div className="mt-8 grid gap-5">
            {providers.map((provider) => (
              <ProviderCard key={provider.id} provider={provider} t={t} onResetCircuit={handleResetCircuit} resetting={resetting === provider.id} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
