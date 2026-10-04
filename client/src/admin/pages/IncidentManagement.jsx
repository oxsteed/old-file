import { Fragment, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  AlertTriangle, Bell, CheckCircle2, RefreshCw, ShieldAlert, Siren,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import { SuggestDropdown } from '../../components/SuggestDropdown';
import '../lib/suggestDropdownAdmin.css';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import { useHasGrant } from '../lib/GrantGuard';
import AdminErrorState from '../lib/AdminErrorState';

// Grant scope for incident mutations. Keep in sync with the
// adminRouteManifest 'incidents' entry (grant: 'manage_operations').
const INCIDENT_GRANT = 'manage_operations';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'warning', 'info'];

function severityTone(severity) {
  switch (String(severity || '').toLowerCase()) {
    case 'critical':
      return 'border-red-500/50 bg-red-950/50 text-red-300';
    case 'high':
      return 'border-orange-500/50 bg-orange-950/40 text-orange-300';
    case 'medium':
      return 'border-amber-500/50 bg-amber-950/40 text-amber-300';
    case 'low':
      return 'border-sky-500/50 bg-sky-950/40 text-sky-300';
    case 'warning':
      return 'border-yellow-500/50 bg-yellow-950/40 text-yellow-300';
    case 'info':
      return 'border-gray-500/50 bg-gray-800/60 text-gray-300';
    default:
      return 'border-gray-600 bg-gray-800/40 text-gray-400';
  }
}

function statusTone(status) {
  switch (status) {
    case 'resolved':
      return 'border-emerald-500/50 bg-emerald-950/40 text-emerald-300';
    case 'acknowledged':
      return 'border-amber-500/50 bg-amber-950/40 text-amber-300';
    default:
      return 'border-red-500/50 bg-red-950/50 text-red-300';
  }
}

function incidentStatus(incident) {
  if (incident?.resolved_at) return 'resolved';
  if (incident?.acknowledged_at) return 'acknowledged';
  return 'open';
}

function formatDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

function severityLabel(t, severity) {
  const key = String(severity || '').toLowerCase();
  return SEVERITIES.includes(key)
    ? t(`adminIncidents.severity.${key}`)
    : t('adminIncidents.severity.unknown', { defaultValue: key || 'unknown' });
}

function SummaryCard({ icon: Icon, label, value, tone = 'text-white' }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
      <span className="rounded-xl bg-orange-500/15 p-2 text-orange-300" aria-hidden="true">
        <Icon size={18} />
      </span>
      <div>
        <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
        <div className={`mt-0.5 text-xl font-semibold ${tone}`}>{value}</div>
      </div>
    </div>
  );
}

export default function IncidentManagement() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [resolvingId, setResolvingId] = useState(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(null); // { id, action } while a mutation is in flight
  const [lastUpdated, setLastUpdated] = useState(null);
  const { allowed: canManage, loading: grantLoading } = useHasGrant(INCIDENT_GRANT);

  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    try {
      const response = await adminApi.get('/monitoring/incident-summary', {
        params: { hours: 24 },
        signal,
      });
      return response.data;
    } catch (err) {
      if (err?.name === 'AbortError' || err?.code === 'ERR_CANCELED') throw err;
      const wrapped = new Error(err?.response?.data?.error || t('adminIncidents.loadErrorMessage'));
      wrapped.cause = err;
      throw wrapped;
    }
  }, [t]);

  useEffect(() => {
    if (data?.timestamp) setLastUpdated(new Date(data.timestamp));
  }, [data]);

  // Auto-refresh every 30s while the tab is visible (same pattern as OperationsOverview).
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

  const incidents = useMemo(() => data?.recentIncidents || [], [data]);
  const openCount = useMemo(() => incidents.filter((i) => !i.resolved_at).length, [incidents]);
  const activeAlertCount = Array.isArray(data?.activeAlerts) ? data.activeAlerts.length : 0;

  // Typeahead items for the incident search, fed from the client-side rows.
  const incidentSuggestItems = useMemo(() => {
    const items = [];
    for (const incident of incidents) {
      const title = incident.type || '';
      if (!title) continue;
      const message = String(incident.message || '').slice(0, 80);
      items.push({
        id: `incident:${incident.id}`,
        title,
        meta: [severityLabel(t, incident.severity), message].filter(Boolean).join(' · '),
      });
    }
    return items;
  }, [incidents, t]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return incidents.filter((incident) => {
      const status = incidentStatus(incident);
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (severityFilter !== 'all' && String(incident.severity || '').toLowerCase() !== severityFilter) return false;
      if (query) {
        const haystack = `${incident.type || ''} ${incident.message || ''}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [incidents, statusFilter, severityFilter, search]);

  const acknowledge = async (incident) => {
    if (busy || !canManage) return;
    setBusy({ id: incident.id, action: 'acknowledge' });
    try {
      await adminApi.post(`/monitoring/incidents/${incident.id}/acknowledge`);
      toast.success(t('adminIncidents.acknowledged'));
      reload();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminIncidents.acknowledgeFailed'));
    } finally {
      setBusy(null);
    }
  };

  const resolveIncident = async (incident) => {
    if (busy || !canManage) return;
    setBusy({ id: incident.id, action: 'resolve' });
    try {
      await adminApi.post(`/monitoring/incidents/${incident.id}/resolve`, { resolutionNotes: notes });
      toast.success(t('adminIncidents.resolved'));
      setResolvingId(null);
      setNotes('');
      reload();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminIncidents.resolveFailed'));
    } finally {
      setBusy(null);
    }
  };

  const showActions = canManage && !grantLoading;
  const columnCount = 9;

  return (
    <section className="min-h-full bg-gray-900 p-5 text-gray-100 sm:p-6 lg:p-8" aria-labelledby="incidents-title">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-orange-300">
              <Siren size={15} aria-hidden="true" />
              {t('adminIncidents.eyebrow')}
            </div>
            <h1 id="incidents-title" className="text-3xl font-bold tracking-tight text-white">
              {t('adminIncidents.title')}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-gray-400">{t('adminIncidents.description')}</p>
          </div>
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
            {t('adminIncidents.refresh')}
          </button>
        </div>

        <div className="mt-5 text-xs text-gray-500" aria-live="polite">
          {lastUpdated && <span>{t('adminIncidents.updated', { time: lastUpdated.toLocaleTimeString() })}</span>}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <SummaryCard icon={Bell} label={t('adminIncidents.summaryActiveAlerts')} value={activeAlertCount} tone="text-amber-300" />
          <SummaryCard icon={ShieldAlert} label={t('adminIncidents.summaryOpenIncidents')} value={openCount} tone="text-red-300" />
          <SummaryCard icon={AlertTriangle} label={t('adminIncidents.summaryLast24h')} value={data?.durableIncidentCount ?? 0} />
        </div>

        <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-gray-800 bg-gray-950/70 p-4 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1">
            <label htmlFor="incident-status-filter" className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {t('adminIncidents.filterStatus')}
            </label>
            <select
              id="incident-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              <option value="all">{t('adminIncidents.status.all')}</option>
              <option value="open">{t('adminIncidents.status.open')}</option>
              <option value="acknowledged">{t('adminIncidents.status.acknowledged')}</option>
              <option value="resolved">{t('adminIncidents.status.resolved')}</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="incident-severity-filter" className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {t('adminIncidents.filterSeverity')}
            </label>
            <select
              id="incident-severity-filter"
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              <option value="all">{t('adminIncidents.severity.all')}</option>
              {SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>{t(`adminIncidents.severity.${severity}`)}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="incident-search" className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {t('adminIncidents.filterSearch')}
            </label>
            <SuggestDropdown
              id="incident-search"
              items={incidentSuggestItems}
              value={search}
              onQueryChange={setSearch}
              onSelect={(item) => setSearch(item.title || '')}
              recentsKey="oxsteed_admin_incident_recents"
              placeholder={t('adminIncidents.searchPlaceholder')}
              ariaLabel={t('adminIncidents.filterSearch')}
              className="sd-admin-dark"
            />
          </div>
        </div>

        {error ? (
          <div className="mt-6">
            <AdminErrorState
              title={t('adminIncidents.loadErrorTitle')}
              message={error.message || t('adminIncidents.loadErrorMessage')}
              onRetry={reload}
            />
          </div>
        ) : loading && !data ? (
          <div className="mt-6 space-y-3" aria-busy="true" aria-label={t('adminIncidents.loading')}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl border border-gray-800 bg-gray-950/60" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-gray-700 bg-gray-950/40 px-6 py-12 text-center">
            <CheckCircle2 size={28} className="mx-auto text-emerald-400" aria-hidden="true" />
            <h2 className="mt-3 text-base font-semibold text-white">{t('adminIncidents.emptyTitle')}</h2>
            <p className="mt-1 text-sm text-gray-400">{t('adminIncidents.emptyMessage')}</p>
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-2xl border border-gray-800">
            <table className="min-w-full divide-y divide-gray-800 text-sm">
              <thead className="bg-gray-950/80">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{t('adminIncidents.table.severity')}</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{t('adminIncidents.table.type')}</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{t('adminIncidents.table.message')}</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{t('adminIncidents.table.occurrences')}</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{t('adminIncidents.table.firstSeen')}</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{t('adminIncidents.table.lastSeen')}</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{t('adminIncidents.table.acknowledged')}</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{t('adminIncidents.table.status')}</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{t('adminIncidents.table.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/70 bg-gray-950/40">
                {filtered.map((incident) => {
                  const status = incidentStatus(incident);
                  const isBusy = busy?.id === incident.id;
                  const firstSeen = formatDateTime(incident.created_at);
                  const lastSeen = formatDateTime(incident.last_seen_at);
                  const ackAt = formatDateTime(incident.acknowledged_at);
                  return (
                    <Fragment key={incident.id}>
                      <tr className="align-top hover:bg-gray-900/40">
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${severityTone(incident.severity)}`}>
                            {severityLabel(t, incident.severity)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-300">{incident.type}</td>
                        <td className="max-w-xs px-4 py-3 text-gray-200">
                          <span className="line-clamp-2" title={incident.message}>{incident.message}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-gray-300">{incident.occurrence_count ?? 1}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">{firstSeen || 'N/A'}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">{lastSeen || 'N/A'}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">
                          {ackAt ? (
                            <>
                              <div>{ackAt}</div>
                              {incident.acknowledged_by && (
                                <div className="mt-0.5 text-gray-500">{t('adminIncidents.acknowledgedBy', { id: incident.acknowledged_by })}</div>
                              )}
                            </>
                          ) : (
                            <span className="text-gray-500">{t('adminIncidents.notAcknowledged')}</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusTone(status)}`}>
                            {t(`adminIncidents.status.${status}`)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {showActions && (
                            <div className="flex items-center gap-2">
                              {status === 'open' && (
                                <button
                                  type="button"
                                  onClick={() => acknowledge(incident)}
                                  disabled={Boolean(busy)}
                                  className="rounded-lg border border-amber-600/60 bg-amber-950/30 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-900/40 focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:cursor-wait disabled:opacity-60"
                                >
                                  {isBusy && busy.action === 'acknowledge' ? t('adminIncidents.acknowledging') : t('adminIncidents.acknowledge')}
                                </button>
                              )}
                              {status !== 'resolved' && (
                                <button
                                  type="button"
                                  onClick={() => { setResolvingId(incident.id); setNotes(''); }}
                                  disabled={Boolean(busy)}
                                  className="rounded-lg border border-emerald-600/60 bg-emerald-950/30 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-900/40 focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:cursor-wait disabled:opacity-60"
                                >
                                  {t('adminIncidents.resolve')}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                      {resolvingId === incident.id && (
                        <tr className="bg-gray-900/50">
                          <td colSpan={columnCount} className="px-4 py-4">
                            <label htmlFor={`resolve-notes-${incident.id}`} className="text-xs font-medium uppercase tracking-wide text-gray-500">
                              {t('adminIncidents.resolveNotesLabel')}
                            </label>
                            <textarea
                              id={`resolve-notes-${incident.id}`}
                              value={notes}
                              onChange={(e) => setNotes(e.target.value)}
                              rows={3}
                              maxLength={2000}
                              placeholder={t('adminIncidents.resolveNotesPlaceholder')}
                              className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                            />
                            <div className="mt-3 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => resolveIncident(incident)}
                                disabled={Boolean(busy)}
                                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:cursor-wait disabled:opacity-60"
                              >
                                {isBusy && busy.action === 'resolve' ? t('adminIncidents.resolving') : t('adminIncidents.confirmResolve')}
                              </button>
                              <button
                                type="button"
                                onClick={() => { setResolvingId(null); setNotes(''); }}
                                disabled={Boolean(busy)}
                                className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-60"
                              >
                                {t('adminIncidents.cancel')}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
