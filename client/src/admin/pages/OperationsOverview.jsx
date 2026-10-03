import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, AlertTriangle, CheckCircle2, CreditCard, ExternalLink,
  Headphones, Package, RefreshCw, Truck, Users, Utensils, Wallet, Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import { adminRoute } from '../adminRouteManifest';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import { useHasGrant } from '../lib/GrantGuard';

// Read-only command center: mutations stay inside authoritative modules.
const ICONS = {
  delivery: Truck,
  jobs: Users,
  orders: Utensils,
  support: Headphones,
  payments: CreditCard,
  disputes: AlertTriangle,
  queues: Activity,
  integrations: Zap,
  credit: Wallet,
  sla: Activity,
  risk: AlertTriangle,
  dataGovernance: Package,
  changeControl: CheckCircle2,
  observability: Activity,
  crm: Users,
};

function count(summary) {
  return summary?.available ? Number(summary.count || summary.total || 0) : null;
}

function statusEntries(summary) {
  return Object.entries(summary?.statuses || {}).sort((a, b) => b[1] - a[1]);
}

function statusLabel(t, status) {
  return t(`adminOperations.status.${status}`, {
    defaultValue: String(status).replaceAll('_', ' '),
  });
}

function Metric({ label, value, tone = 'text-white' }) {
  return (
    <div className="rounded-lg border border-gray-700/70 bg-gray-900/40 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${tone}`}>{value ?? '—'}</div>
    </div>
  );
}

function SectionCard({ section, title, description, t, canLink }) {
  const Icon = ICONS[section.key] || Package;
  const unavailableReason = section.reason === 'permission_required'
    ? t('adminOperations.permissionRequired')
    : section.reason === 'not_configured'
      ? t('adminOperations.notConfigured')
      : t('adminOperations.unavailable');
  const summaries = [section.statuses, section.reconciliation, section.tickets, section.queue, section.privacy, section.conversations, section.leads, section.clients];
  const statusSummary = summaries.find((summary) => summary?.available) || summaries.find(Boolean);
  const statuses = statusEntries(statusSummary);
  const total = count(statusSummary);

  return (
    <article className="rounded-2xl border border-gray-800 bg-gray-950/70 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-orange-500/15 p-2 text-orange-300" aria-hidden="true">
            <Icon size={20} />
          </span>
          <div>
            <h2 className="font-semibold text-white">{title}</h2>
            <p className="mt-1 text-sm text-gray-400">{description}</p>
          </div>
        </div>
        {section.available ? (
          <CheckCircle2 size={18} className="text-emerald-400" aria-label={t('adminOperations.available')} />
        ) : (
          <AlertTriangle size={18} className="text-amber-300" aria-label={unavailableReason} />
        )}
      </div>

      {!section.available ? (
        <div className="mt-5 rounded-xl border border-amber-700/40 bg-amber-900/15 px-4 py-3 text-sm text-amber-200">
          {unavailableReason}
          {section.correlation_id && (
            <div className="mt-2 text-xs text-amber-300/80">
              {t('adminOperations.correlationId', { id: section.correlation_id })}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Metric label={t('adminOperations.total')} value={total} />
            {section.openIssues && <Metric label={t('adminOperations.openIssues')} value={count(section.openIssues)} tone="text-amber-300" />}
            {section.pendingEvents && <Metric label={t('adminOperations.pendingEvents')} value={count(section.pendingEvents)} tone="text-amber-300" />}
            {section.eventsLast24h && <Metric label={t('adminOperations.eventsLast24h')} value={count(section.eventsLast24h)} />}
            {section.connected && <Metric label={t('adminOperations.connected')} value={count(section.connected)} tone="text-emerald-300" />}
            {section.pendingWebhooks && <Metric label={t('adminOperations.pendingWebhooks')} value={count(section.pendingWebhooks)} tone="text-amber-300" />}
            {section.openBreaches && <Metric label={t('adminOperations.openBreaches')} value={count(section.openBreaches)} tone="text-red-300" />}
            {section.openIncidents && <Metric label={t('adminOperations.openIncidents')} value={count(section.openIncidents)} tone="text-red-300" />}
            {section.securityFailures24h && <Metric label={t('adminOperations.securityFailures24h')} value={count(section.securityFailures24h)} tone="text-red-300" />}
            {section.changes24h && <Metric label={t('adminOperations.changes24h')} value={count(section.changes24h)} />}
            {section.enabledFlags && <Metric label={t('adminOperations.enabledFlags')} value={count(section.enabledFlags)} tone="text-purple-300" />}
            {section.failedDeliveryEvents && <Metric label={t('adminOperations.failedDeliveryEvents')} value={count(section.failedDeliveryEvents)} tone="text-red-300" />}
            {section.failedWebhooks && <Metric label={t('adminOperations.failedWebhooks')} value={count(section.failedWebhooks)} tone="text-red-300" />}
          </div>
          {statuses.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2" aria-label={t('adminOperations.statusBreakdown')}>
              {statuses.slice(0, 6).map(([status, value]) => (
                <span key={status} className="rounded-full border border-gray-700 px-2.5 py-1 text-xs text-gray-300">
                  {statusLabel(t, status)}: {value}
                </span>
              ))}
            </div>
          )}
          {section.key === 'support' && section.queue?.available && (
            <p className="mt-3 text-xs text-gray-400">
              {t('adminOperations.supportQueue', { count: count(section.queue) })}
            </p>
          )}
          {section.key === 'credit' && section.disputes?.available && (
            <p className="mt-3 text-xs text-gray-400">
              {t('adminOperations.creditDisputes', { count: count(section.disputes) })}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
            <span>{t('adminOperations.source')}: <code className="font-mono text-gray-400">{section.source || 'unknown'}</code></span>
            {section.correlation_id && (
              <span>{t('adminOperations.correlationId', { id: section.correlation_id })}</span>
            )}
          </div>
          {canLink && section.route && (
            section.route.startsWith('/admin/') ? (
              <Link
                to={section.route}
                className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-orange-300 hover:text-orange-200 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 focus:ring-offset-gray-950 rounded"
              >
                {t('adminOperations.openModule')}
                <ExternalLink size={14} aria-hidden="true" />
              </Link>
            ) : (
              <a
                href={section.route}
                className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-orange-300 hover:text-orange-200 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 focus:ring-offset-gray-950 rounded"
              >
                {t('adminOperations.openModule')}
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            )
          )}
          {section.key === 'risk' && (
            <Link
              to={adminRoute('incidents').path}
              className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-orange-300 hover:text-orange-200 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 focus:ring-offset-gray-950 rounded"
            >
              {t('adminOperations.manageIncidents')}
              <ExternalLink size={14} aria-hidden="true" />
            </Link>
          )}
          {section.key === 'integrations' && (
            <Link
              to={adminRoute('providerHealth').path}
              className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-orange-300 hover:text-orange-200 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 focus:ring-offset-gray-950 rounded"
            >
              {t('adminProviderHealth.title')}
              <ExternalLink size={14} aria-hidden="true" />
            </Link>
          )}
        </>
      )}
    </article>
  );
}

export default function OperationsOverview() {
  const { t } = useTranslation();
  const [lastUpdated, setLastUpdated] = useState(null);
  const { allowed: canViewFinancials } = useHasGrant('view_financials');
  const { allowed: canManageSettings } = useHasGrant('manage_settings');
  const { allowed: canViewAuditLog } = useHasGrant('view_audit_log');
  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    try {
      const response = await adminApi.get('/admin/operations/overview', { signal });
      return response.data;
    } catch (err) {
      if (err?.name === 'AbortError' || err?.code === 'ERR_CANCELED') throw err;
      const wrapped = new Error(err?.response?.data?.error || t('adminOperations.loadError'));
      wrapped.cause = err;
      throw wrapped;
    }
  }, [t]);

  useEffect(() => {
    if (data?.generated_at) setLastUpdated(new Date(data.generated_at));
  }, [data]);

  // Keep the command center useful during an active operations shift without
  // polling hidden tabs or creating a client-side status store. The API
  // remains authoritative and useAbortableFetch drops stale responses.
  useEffect(() => {
    let timer;
    const schedule = () => {
      window.clearTimeout(timer);
      if (document.visibilityState !== 'visible') return;
      timer = window.setTimeout(() => {
        reload();
        schedule();
      }, 30_000);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') reload();
      schedule();
    };
    schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [reload]);

  const sections = useMemo(() => data?.sections || {}, [data]);
  const cards = [
    ['delivery', t('adminOperations.deliveryTitle'), t('adminOperations.deliveryDescription')],
    ['jobs', t('adminOperations.jobsTitle'), t('adminOperations.jobsDescription')],
    ['orders', t('adminOperations.ordersTitle'), t('adminOperations.ordersDescription')],
    ['support', t('adminOperations.supportTitle'), t('adminOperations.supportDescription')],
    ['payments', t('adminOperations.paymentsTitle'), t('adminOperations.paymentsDescription')],
    ['disputes', t('adminOperations.disputesTitle'), t('adminOperations.disputesDescription')],
    ['queues', t('adminOperations.queuesTitle'), t('adminOperations.queuesDescription')],
    ['integrations', t('adminOperations.integrationsTitle'), t('adminOperations.integrationsDescription')],
    ['credit', t('adminOperations.creditTitle'), t('adminOperations.creditDescription')],
    ['sla', t('adminOperations.slaTitle'), t('adminOperations.slaDescription')],
    ['risk', t('adminOperations.riskTitle'), t('adminOperations.riskDescription')],
    ['dataGovernance', t('adminOperations.dataGovernanceTitle'), t('adminOperations.dataGovernanceDescription')],
    ['changeControl', t('adminOperations.changeControlTitle'), t('adminOperations.changeControlDescription')],
    ['observability', t('adminOperations.observabilityTitle'), t('adminOperations.observabilityDescription')],
    ['crm', t('adminOperations.crmTitle'), t('adminOperations.crmDescription')],
  ];

  return (
    <section className="min-h-full bg-gray-900 p-5 text-gray-100 sm:p-6 lg:p-8" aria-labelledby="operations-title">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-orange-300">
              <Activity size={15} aria-hidden="true" />
              {t('adminOperations.eyebrow')}
            </div>
            <h1 id="operations-title" className="text-3xl font-bold tracking-tight text-white">
              {t('adminOperations.title')}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-gray-400">{t('adminOperations.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
            {t('adminOperations.refresh')}
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500" aria-live="polite">
          <span>{t('adminOperations.authoritativeNote')}</span>
          {lastUpdated && <span>{t('adminOperations.updated', { time: lastUpdated.toLocaleTimeString() })}</span>}
        </div>

        {error && (
          <div role="alert" className="mt-6 flex items-center justify-between gap-3 rounded-xl border border-red-700/50 bg-red-950/30 px-4 py-3 text-sm text-red-200">
            <span>{error.message}</span>
            <button type="button" onClick={reload} className="rounded px-2 py-1 font-medium underline focus:outline-none focus:ring-2 focus:ring-red-300">
              {t('adminOperations.retry')}
            </button>
          </div>
        )}

        {loading && !data ? (
          <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label={t('adminOperations.loading')}>
            {cards.map(([key]) => <div key={key} className="h-64 animate-pulse rounded-2xl border border-gray-800 bg-gray-950/60" />)}
          </div>
        ) : (
          <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {cards.map(([key, title, description]) => (
              <SectionCard
                key={key}
                section={sections[key] || { key, available: false, reason: 'temporarily_unavailable' }}
                title={title}
                description={description}
                t={t}
                    canLink={key === 'payments'
                      ? canViewFinancials
                      : key === 'integrations'
                        ? canManageSettings
                        : key === 'credit'
                        ? sections[key]?.available
                        : key === 'changeControl'
                          ? canViewAuditLog
                          : true}
              />
            ))}
          </div>
        )}
        <p className="mt-8 text-xs text-gray-500">{t('adminOperations.sourceDisclaimer')}</p>
      </div>
    </section>
  );
}
