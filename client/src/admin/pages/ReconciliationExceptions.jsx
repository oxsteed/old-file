import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  Filter,
  RefreshCw,
  UserCheck,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';
import ConfirmDialog from '../lib/ConfirmDialog';

// ─── Server contract ──────────────────────────────────────────────────────────
// server/routes/reconciliation.js is mounted at /api/admin/reconciliation
// (mount line reported for server/index.js). adminApi's baseURL is /api.
// If the mount prefix ever changes, update only these constants.
//   GET  /admin/reconciliation?domain=&status=&severity=&page=&limit=
//     -> { data:[...], pagination:{page,limit,total},
//          counts:{stuck_refund_attempts, failed_credit_runs_7d, unsettled_payouts_48h} }
//   POST /admin/reconciliation/exceptions/:id/assign      { admin_id }
//   POST /admin/reconciliation/exceptions/:id/acknowledge
//   POST /admin/reconciliation/exceptions/:id/resolve
// All endpoints are requireAdmin-gated on the server.
const API_BASE = '/admin/reconciliation';
const EXCEPTION_BASE = '/admin/reconciliation/exceptions';

// Admin accounts feed the owner dropdown. It requires the
// manage_admin_accounts grant; a 403 degrades to a plain admin-ID input.
const ADMIN_ACCOUNTS_URL = '/admin/super/admin-accounts';

const PAGE_LIMIT = 25;

// Drill-down target per exception domain. All paths verified against
// client/src/admin/adminRouteManifest.js.
const DOMAIN_LINKS = {
  credit: '/admin/super/oxsteed-credit',
  payment_refund: '/admin/payments',
  marketplace_refund: '/admin/orders',
  external_refund: '/admin/payments',
  payout_settlement: '/admin/super/payouts',
};

const DOMAIN_OPTIONS = [
  { value: '', i18nKey: 'filters.domainAll' },
  { value: 'credit', i18nKey: 'domain.credit' },
  { value: 'payment_refund', i18nKey: 'domain.paymentRefund' },
  { value: 'marketplace_refund', i18nKey: 'domain.marketplaceRefund' },
  { value: 'external_refund', i18nKey: 'domain.externalRefund' },
  { value: 'payout_settlement', i18nKey: 'domain.payoutSettlement' },
];

const SEVERITY_OPTIONS = [
  { value: '', i18nKey: 'filters.severityAll' },
  { value: 'info', i18nKey: 'severity.info' },
  { value: 'warning', i18nKey: 'severity.warning' },
  { value: 'critical', i18nKey: 'severity.critical' },
];

const STATUS_OPTIONS = [
  { value: '', i18nKey: 'filters.statusAll' },
  { value: 'open', i18nKey: 'status.open' },
  { value: 'acknowledged', i18nKey: 'status.acknowledged' },
  { value: 'resolved', i18nKey: 'status.resolved' },
];

const SEVERITY_STYLES = {
  info: 'bg-gray-500/20 text-gray-300',
  warning: 'bg-orange-500/20 text-orange-400',
  critical: 'bg-red-500/20 text-red-400',
};

const STATUS_STYLES = {
  open: 'bg-red-500/20 text-red-400',
  acknowledged: 'bg-yellow-500/20 text-yellow-400',
  resolved: 'bg-green-500/20 text-green-400',
};

const KNOWN_STATUSES = Object.keys(STATUS_STYLES);

function formatAge(iso, t) {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return t('adminReconciliation.age.justNow');
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return t('adminReconciliation.age.justNow');
  if (minutes < 60) return t('adminReconciliation.age.minutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t('adminReconciliation.age.hours', { count: hours });
  return t('adminReconciliation.age.days', { count: Math.floor(hours / 24) });
}

function adminDisplayName(admin) {
  const name = `${admin.first_name || ''} ${admin.last_name || ''}`.trim();
  return name || admin.email || String(admin.id);
}

// ─── Badges ───────────────────────────────────────────────────────────────────

function SeverityBadge({ severity }) {
  const { t } = useTranslation();
  const style = SEVERITY_STYLES[severity] || SEVERITY_STYLES.info;
  const label = t(`adminReconciliation.severity.${severity}`, { defaultValue: severity });
  return (
    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${style}`}>
      {label}
    </span>
  );
}

function StatusBadge({ status }) {
  const { t } = useTranslation();
  const style = STATUS_STYLES[status] || 'bg-gray-500/20 text-gray-400';
  const label = KNOWN_STATUSES.includes(status)
    ? t(`adminReconciliation.status.${status}`)
    : String(status ?? '').replace(/_/g, ' ');
  return (
    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${style}`}>
      {label}
    </span>
  );
}

// ─── Owner assignment control ─────────────────────────────────────────────────

function AssignControl({ exception, admins, adminsUnavailable, busy, onAssign }) {
  const { t } = useTranslation();
  const [manualId, setManualId] = useState('');

  if (adminsUnavailable) {
    // No manage_admin_accounts grant: fall back to a plain admin-ID input.
    return (
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={manualId}
          onChange={(e) => setManualId(e.target.value)}
          placeholder={t('adminReconciliation.actions.adminIdPlaceholder')}
          aria-label={t('adminReconciliation.actions.assignLabel')}
          disabled={busy}
          className="w-24 px-2 py-1.5 bg-gray-700 border border-gray-600 text-white rounded text-xs focus:outline-none focus:border-orange-500 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => manualId.trim() && onAssign(exception, manualId.trim())}
          disabled={busy || !manualId.trim()}
          aria-label={t('adminReconciliation.actions.assignLabel')}
          className="p-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition disabled:opacity-50"
        >
          <UserCheck size={14} />
        </button>
      </div>
    );
  }

  return (
    <select
      value={exception.owner_admin_id || ''}
      onChange={(e) => e.target.value && onAssign(exception, e.target.value)}
      disabled={busy}
      aria-label={t('adminReconciliation.actions.assignLabel')}
      className="max-w-[9rem] px-2 py-1.5 bg-gray-700 border border-gray-600 text-white rounded text-xs focus:outline-none focus:border-orange-500 disabled:opacity-50"
    >
      <option value="">{t('adminReconciliation.actions.assignPlaceholder')}</option>
      {admins.map((admin) => (
        <option key={admin.id} value={admin.id}>
          {adminDisplayName(admin)}
        </option>
      ))}
    </select>
  );
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow({ cols }) {
  return (
    <tr>
      {Array.from({ length: cols }, (_, i) => (
        <td key={i} className="px-6 py-4">
          <div className="h-4 rounded bg-gray-700/60 animate-pulse" />
        </td>
      ))}
    </tr>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ReconciliationExceptions() {
  const { t } = useTranslation();

  const [domain, setDomain] = useState('');
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [resolveTarget, setResolveTarget] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [adminsUnavailable, setAdminsUnavailable] = useState(false);

  const { data, error, loading, reload } = useAbortableFetch(async (signal) => {
    const res = await adminApi.get(API_BASE, {
      params: {
        domain: domain || undefined,
        severity: severity || undefined,
        status: status || undefined,
        page,
        limit: PAGE_LIMIT,
      },
      signal,
    });
    return {
      exceptions: res.data.data || [],
      pagination: res.data.pagination || { page: 1, limit: PAGE_LIMIT, total: 0 },
      counts: res.data.counts || {},
    };
  }, [domain, severity, status, page]);

  // Admin accounts for the owner dropdown. A 403 (no manage_admin_accounts
  // grant) is not fatal: the assign control degrades to an admin-ID input.
  useEffect(() => {
    let cancelled = false;
    adminApi
      .get(ADMIN_ACCOUNTS_URL)
      .then(({ data: res }) => {
        if (!cancelled) setAdmins(res.admins || []);
      })
      .catch(() => {
        if (!cancelled) setAdminsUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const exceptions = data?.exceptions ?? [];
  const pagination = data?.pagination ?? { page: 1, limit: PAGE_LIMIT, total: 0 };
  const counts = data?.counts ?? {};
  const totalPages = Math.max(1, Math.ceil(pagination.total / PAGE_LIMIT));

  const ownerName = useMemo(
    () => (ownerId) => {
      if (!ownerId) return t('adminReconciliation.owner.unassigned');
      const admin = admins.find((a) => String(a.id) === String(ownerId));
      if (!admin) return String(ownerId).slice(0, 8);
      return adminDisplayName(admin);
    },
    [admins, t]
  );

  const domainLabel = (value) => {
    const opt = DOMAIN_OPTIONS.find((o) => o.value === value);
    return opt ? t(`adminReconciliation.${opt.i18nKey}`) : String(value ?? '').replace(/_/g, ' ');
  };

  const serverError = (err, fallbackKey) =>
    err?.response?.data?.error || err?.response?.data?.message || t(fallbackKey);

  const runAction = async (exception, action, payload, successKey, failedKey) => {
    const key = `${exception.id}:${action}`;
    if (busyKey) return;
    setBusyKey(key);
    try {
      await adminApi.post(`${EXCEPTION_BASE}/${exception.id}/${action}`, payload);
      toast.success(t(successKey));
      reload();
    } catch (err) {
      console.error(`Reconciliation ${action} failed:`, err);
      toast.error(serverError(err, failedKey));
    } finally {
      setBusyKey(null);
    }
  };

  const handleAssign = (exception, adminId) =>
    runAction(
      exception,
      'assign',
      { admin_id: adminId },
      'adminReconciliation.actions.assigned',
      'adminReconciliation.actions.assignFailed'
    );

  const handleAcknowledge = (exception) =>
    runAction(
      exception,
      'acknowledge',
      undefined,
      'adminReconciliation.actions.acknowledged',
      'adminReconciliation.actions.acknowledgeFailed'
    );

  const handleResolveConfirm = async () => {
    const target = resolveTarget;
    const key = `${target.id}:resolve`;
    setBusyKey(key);
    try {
      await adminApi.post(`${EXCEPTION_BASE}/${target.id}/resolve`);
      toast.success(t('adminReconciliation.actions.resolved'));
      reload();
    } catch (err) {
      console.error('Reconciliation resolve failed:', err);
      // Throw so ConfirmDialog keeps the dialog open and surfaces the error.
      throw new Error(serverError(err, 'adminReconciliation.actions.resolveFailed'));
    } finally {
      setBusyKey(null);
    }
  };

  const resetPage = (setter) => (e) => {
    setter(e.target.value);
    setPage(1);
  };

  const statCards = [
    {
      key: 'stuck',
      label: t('adminReconciliation.stats.stuckRefundAttempts'),
      value: counts.stuck_refund_attempts,
      icon: AlertTriangle,
      color: 'text-red-400',
    },
    {
      key: 'failed',
      label: t('adminReconciliation.stats.failedCreditRuns'),
      value: counts.failed_credit_runs_7d,
      icon: XCircle,
      color: 'text-orange-400',
    },
    {
      key: 'unsettled',
      label: t('adminReconciliation.stats.unsettledPayouts'),
      value: counts.unsettled_payouts_48h,
      icon: Clock,
      color: 'text-yellow-400',
    },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-white font-bold text-3xl mb-2">{t('adminReconciliation.title')}</h1>
          <p className="text-gray-400 text-sm">{t('adminReconciliation.subtitle')}</p>
        </div>
        <button
          onClick={reload}
          disabled={loading}
          aria-label={t('common.refresh')}
          className="p-2.5 bg-gray-700 border border-gray-600 text-gray-400 rounded-lg hover:text-white transition disabled:opacity-50"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Error */}
      {error && <AdminErrorState onRetry={reload} />}

      {/* Live counts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {statCards.map((card) => (
          <div key={card.key} className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-2">
              <card.icon size={16} className={card.color} />
              <p className="text-gray-400 text-sm">{card.label}</p>
            </div>
            {loading && !data ? (
              <div className="h-9 w-20 rounded bg-gray-700/60 animate-pulse" />
            ) : (
              <p className={`text-3xl font-bold ${card.color}`}>{card.value ?? 0}</p>
            )}
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={16} className="text-gray-400" />
          <span className="text-gray-300 font-semibold">{t('adminReconciliation.filters.title')}</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-gray-400 text-sm mb-2">
              {t('adminReconciliation.filters.domain')}
            </label>
            <select
              value={domain}
              onChange={resetPage(setDomain)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
            >
              {DOMAIN_OPTIONS.map((opt) => (
                <option key={opt.value || 'all'} value={opt.value}>
                  {t(`adminReconciliation.${opt.i18nKey}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-gray-400 text-sm mb-2">
              {t('adminReconciliation.filters.severity')}
            </label>
            <select
              value={severity}
              onChange={resetPage(setSeverity)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
            >
              {SEVERITY_OPTIONS.map((opt) => (
                <option key={opt.value || 'all'} value={opt.value}>
                  {t(`adminReconciliation.${opt.i18nKey}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-gray-400 text-sm mb-2">
              {t('adminReconciliation.filters.status')}
            </label>
            <select
              value={status}
              onChange={resetPage(setStatus)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value || 'all'} value={opt.value}>
                  {t(`adminReconciliation.${opt.i18nKey}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 border-b border-gray-700">
              <tr>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">{t('adminReconciliation.table.severity')}</th>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">{t('adminReconciliation.table.domain')}</th>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">{t('adminReconciliation.table.summary')}</th>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">{t('adminReconciliation.table.age')}</th>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">{t('adminReconciliation.table.owner')}</th>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">{t('adminReconciliation.table.status')}</th>
                <th className="px-6 py-4 text-center text-gray-400 font-semibold">{t('adminReconciliation.table.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {loading && !data ? (
                <>
                  <SkeletonRow cols={7} />
                  <SkeletonRow cols={7} />
                  <SkeletonRow cols={7} />
                </>
              ) : exceptions.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center text-gray-400">
                    {t('adminReconciliation.table.empty')}
                  </td>
                </tr>
              ) : (
                exceptions.map((exception) => {
                  const drillDown = DOMAIN_LINKS[exception.domain];
                  const busy = busyKey?.startsWith(`${exception.id}:`);
                  return (
                    <tr key={exception.id} className="hover:bg-gray-700/50 transition">
                      <td className="px-6 py-4">
                        <SeverityBadge severity={exception.severity} />
                      </td>
                      <td className="px-6 py-4">
                        {drillDown ? (
                          <Link
                            to={drillDown}
                            title={t('adminReconciliation.actions.drillDown', { domain: domainLabel(exception.domain) })}
                            className="inline-flex items-center gap-1 text-orange-400 hover:text-orange-300 font-medium"
                          >
                            {domainLabel(exception.domain)}
                            <ExternalLink size={13} />
                          </Link>
                        ) : (
                          <span className="text-gray-300">{domainLabel(exception.domain)}</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-gray-200">{exception.summary}</p>
                        {exception.reference_id && (
                          <p className="text-gray-500 text-xs font-mono mt-1">
                            {t('adminReconciliation.table.reference', { id: exception.reference_id })}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-300 whitespace-nowrap">
                        {formatAge(exception.created_at, t)}
                      </td>
                      <td className="px-6 py-4 text-gray-300 text-xs">
                        {ownerName(exception.owner_admin_id)}
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={exception.status} />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-2">
                          <AssignControl
                            exception={exception}
                            admins={admins}
                            adminsUnavailable={adminsUnavailable}
                            busy={busy}
                            onAssign={handleAssign}
                          />
                          <button
                            type="button"
                            onClick={() => handleAcknowledge(exception)}
                            disabled={busy || exception.status !== 'open'}
                            title={t('adminReconciliation.actions.acknowledge')}
                            aria-label={t('adminReconciliation.actions.acknowledge')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-blue-600/80 hover:bg-blue-600 text-white rounded text-xs transition disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <CheckCheck size={14} />
                            <span className="hidden xl:inline">{t('adminReconciliation.actions.acknowledge')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setResolveTarget(exception)}
                            disabled={busy || exception.status === 'resolved'}
                            title={t('adminReconciliation.actions.resolve')}
                            aria-label={t('adminReconciliation.actions.resolve')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-green-600/80 hover:bg-green-600 text-white rounded text-xs transition disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Check size={14} />
                            <span className="hidden xl:inline">{t('adminReconciliation.actions.resolve')}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="bg-gray-900 border-t border-gray-700 px-6 py-4 flex items-center justify-between">
          <p className="text-gray-400 text-sm">
            {t('adminReconciliation.pagination.showing', {
              from: pagination.total === 0 ? 0 : (page - 1) * PAGE_LIMIT + 1,
              to: Math.min(page * PAGE_LIMIT, pagination.total),
              total: pagination.total,
            })}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('adminReconciliation.pagination.previous')}
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('adminReconciliation.pagination.next')}
            </button>
          </div>
        </div>
      </div>

      {/* Resolve confirmation */}
      <ConfirmDialog
        open={!!resolveTarget}
        title={t('adminReconciliation.actions.resolveTitle')}
        message={t('adminReconciliation.actions.resolveMessage')}
        confirmLabel={t('adminReconciliation.actions.resolve')}
        danger
        onConfirm={handleResolveConfirm}
        onClose={() => setResolveTarget(null)}
      />
    </div>
  );
}
