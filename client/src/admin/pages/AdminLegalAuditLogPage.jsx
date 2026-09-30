import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Filter, RefreshCw, ChevronDown, Download } from 'lucide-react';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';

const NS = 'adminLegalAuditLog';

const ACTION_TYPES = [
  { value: '', labelKey: 'allActions' },
  { value: 'acceptance', labelKey: 'actionAcceptance' },
  { value: 'request_approval', labelKey: 'actionRequestApproval' },
  { value: 'approved', labelKey: 'actionApproved' },
  { value: 'published', labelKey: 'actionPublished' },
  { value: 'revoked', labelKey: 'actionRevoked' },
  { value: 'requested_signature', labelKey: 'actionRequestedSignature' },
];

const DOCUMENT_TYPES = [
  { value: '', labelKey: 'allDocuments' },
  { value: 'contractor_agreement', labelKey: 'docContractorAgreement' },
  { value: 'dispute_resolution', labelKey: 'docDisputeResolution' },
  { value: 'account_termination', labelKey: 'docAccountTermination' },
  { value: 'privacy_policy', labelKey: 'docPrivacyPolicy' },
  { value: 'biometric_data', labelKey: 'docBiometricData' },
  { value: 'harassment_policy', labelKey: 'docHarassmentPolicy' },
  { value: 'background_check', labelKey: 'docBackgroundCheck' },
  { value: 'arbitration', labelKey: 'docArbitration' },
  { value: 'escrow_policy', labelKey: 'docEscrowPolicy' },
];

const ACTOR_TYPES = [
  { value: '', labelKey: 'allActors' },
  { value: 'super_admin', labelKey: 'actorSuperAdmin' },
  { value: 'admin', labelKey: 'actorAdmin' },
  { value: 'user', labelKey: 'actorUser' },
];

const STATUS_TYPES = [
  { value: '', labelKey: 'allStatuses' },
  { value: 'completed', labelKey: 'statusCompleted' },
  { value: 'pending', labelKey: 'statusPending' },
  { value: 'failed', labelKey: 'statusFailed' },
];

const STATUS_I18N = { completed: 'statusCompleted', pending: 'statusPending', failed: 'statusFailed' };

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const { t } = useTranslation();
  const styles = {
    completed: 'bg-green-500/20 text-green-400',
    pending: 'bg-yellow-500/20 text-yellow-400',
    failed: 'bg-red-500/20 text-red-400',
  };
  return (
    <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${styles[status] || styles.pending}`}>
      {STATUS_I18N[status] ? t(`${NS}.${STATUS_I18N[status]}`) : status}
    </span>
  );
}

// ─── Detail Row Expander ──────────────────────────────────────────────────────

function DetailsRow({ event, isExpanded, onToggle }) {
  const { t } = useTranslation();
  if (!isExpanded) return null;

  return (
    <tr className="bg-gray-900 border-t border-gray-700">
      <td colSpan="8" className="px-6 py-4">
        <div className="space-y-4">
          <div>
            <h4 className="text-white font-semibold text-sm mb-2">{t(`${NS}.metadata`)}</h4>
            <pre className="bg-gray-950 border border-gray-700 rounded p-3 text-gray-300 text-xs font-mono overflow-auto max-h-40">
              {JSON.stringify(event.metadata || {}, null, 2)}
            </pre>
          </div>
          {event.error_message && (
            <div>
              <h4 className="text-red-400 font-semibold text-sm mb-2">{t(`${NS}.errorMessage`)}</h4>
              <p className="text-red-300 text-xs bg-red-500/10 border border-red-500/30 rounded p-2">{event.error_message}</p>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminLegalAuditLogPage() {
  const { t } = useTranslation();
  const [expandedRows, setExpandedRows] = useState({});

  // Filter state
  const [search, setSearch] = useState('');
  const [actionType, setActionType] = useState('');
  const [documentType, setDocumentType] = useState('');
  const [actorType, setActorType] = useState('');
  const [status, setStatus] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [limit] = useState(50);

  const [exportError, setExportError] = useState('');

  const { data, error, loading, reload } = useAbortableFetch(async (signal) => {
    const params = {
      search: search || undefined,
      action: actionType || undefined,
      documentType: documentType || undefined,
      actor: actorType || undefined,
      status: status || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      page,
      limit,
    };

    const res = await adminApi.get('/admin/legal/audit-log', { params, signal });
    return {
      events: res.data.events || [],
      totalCount: res.data.total || 0,
      stats: res.data.stats,
    };
  }, [search, actionType, documentType, actorType, status, startDate, endDate, page, limit]);

  const events = data?.events ?? [];
  const totalCount = data?.totalCount ?? 0;
  const stats = data?.stats ?? null;

  const toggleExpanded = (eventId) => {
    setExpandedRows(prev => ({
      ...prev,
      [eventId]: !prev[eventId],
    }));
  };

  const handleExportCSV = async () => {
    try {
      const params = {
        search: search || undefined,
        action: actionType || undefined,
        documentType: documentType || undefined,
        actor: actorType || undefined,
        status: status || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      };

      const res = await adminApi.get('/admin/legal/audit-log/export/csv', {
        params,
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
    } catch (err) {
      setExportError(t(`${NS}.exportFailed`));
    }
  };

  const pages = Math.ceil(totalCount / limit);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-white font-bold text-3xl mb-2">{t(`${NS}.title`)}</h1>
          <p className="text-gray-400 text-sm">{t(`${NS}.subtitle`)}</p>
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

      {/* Error Alert */}
      {error && (
        <AdminErrorState onRetry={reload} />
      )}
      {exportError && (
        <div className="bg-red-500/20 border border-red-500/50 text-red-300 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
          <span>⚠️</span>
          <span>{exportError}</span>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <p className="text-gray-400 text-sm mb-2">{t(`${NS}.statTotal`)}</p>
            <p className="text-white text-3xl font-bold">{stats.total_entries}</p>
          </div>

          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <p className="text-gray-400 text-sm mb-2">{t(`${NS}.statThisWeek`)}</p>
            <p className="text-white text-3xl font-bold">{stats.this_week}</p>
          </div>

          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <p className="text-gray-400 text-sm mb-2">{t(`${NS}.statFailed`)}</p>
            <p className="text-red-400 text-3xl font-bold">{stats.failed_actions}</p>
          </div>

          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <p className="text-gray-400 text-sm mb-2">{t(`${NS}.statAdminActions`)}</p>
            <p className="text-white text-3xl font-bold">{stats.admin_actions}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={16} className="text-gray-400" />
          <span className="text-gray-300 font-semibold">{t(`${NS}.filtersTitle`)}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Search */}
          <div>
            <label className="block text-gray-400 text-sm mb-2">{t(`${NS}.searchLabel`)}</label>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
              <input
                type="text"
                placeholder={t(`${NS}.searchPlaceholder`)}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="w-full pl-10 pr-4 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>

          {/* Action Type */}
          <div>
            <label className="block text-gray-400 text-sm mb-2">{t(`${NS}.actionLabel`)}</label>
            <select
              value={actionType}
              onChange={(e) => {
                setActionType(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
            >
              {ACTION_TYPES.map(opt => (
                <option key={opt.value} value={opt.value}>{t(`${NS}.${opt.labelKey}`)}</option>
              ))}
            </select>
          </div>

          {/* Document Type */}
          <div>
            <label className="block text-gray-400 text-sm mb-2">{t(`${NS}.documentLabel`)}</label>
            <select
              value={documentType}
              onChange={(e) => {
                setDocumentType(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
            >
              {DOCUMENT_TYPES.map(opt => (
                <option key={opt.value} value={opt.value}>{t(`${NS}.${opt.labelKey}`)}</option>
              ))}
            </select>
          </div>

          {/* Actor Type */}
          <div>
            <label className="block text-gray-400 text-sm mb-2">{t(`${NS}.actorLabel`)}</label>
            <select
              value={actorType}
              onChange={(e) => {
                setActorType(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
            >
              {ACTOR_TYPES.map(opt => (
                <option key={opt.value} value={opt.value}>{t(`${NS}.${opt.labelKey}`)}</option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div>
            <label className="block text-gray-400 text-sm mb-2">{t(`${NS}.statusFilterLabel`)}</label>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
            >
              {STATUS_TYPES.map(opt => (
                <option key={opt.value} value={opt.value}>{t(`${NS}.${opt.labelKey}`)}</option>
              ))}
            </select>
          </div>

          {/* Start Date */}
          <div>
            <label className="block text-gray-400 text-sm mb-2">{t(`${NS}.fromDate`)}</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
            />
          </div>

          {/* End Date */}
          <div>
            <label className="block text-gray-400 text-sm mb-2">{t(`${NS}.toDate`)}</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition"
          >
            <Download size={16} />
            {t(`${NS}.exportCsv`)}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 border-b border-gray-700">
              <tr>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">{t(`${NS}.thTimestamp`)}</th>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">{t(`${NS}.thAction`)}</th>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">{t(`${NS}.thDocument`)}</th>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">{t(`${NS}.thActor`)}</th>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">{t(`${NS}.thResource`)}</th>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">{t(`${NS}.thIpAddress`)}</th>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">{t(`${NS}.thStatus`)}</th>
                <th className="px-6 py-4 text-center text-gray-400 font-semibold">{t(`${NS}.thDetails`)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {loading && events.length === 0 ? (
                <tr>
                  <td colSpan="8" className="px-6 py-12 text-center">
                    <div className="flex justify-center">
                      <div className="animate-spin w-6 h-6 border-3 border-orange-500 border-t-transparent rounded-full" />
                    </div>
                  </td>
                </tr>
              ) : error ? null : events.length === 0 ? (
                <tr>
                  <td colSpan="8" className="px-6 py-12 text-center text-gray-400">
                    {t(`${NS}.noEntries`)}
                  </td>
                </tr>
              ) : (
                events.flatMap(event => [
                  <tr key={event.id} className="hover:bg-gray-700/50 transition">
                    <td className="px-6 py-4 text-gray-300 text-xs whitespace-nowrap">
                      {new Date(event.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-gray-300 capitalize">
                      {event.action?.replace(/_/g, ' ')}
                    </td>
                    <td className="px-6 py-4 text-gray-300 capitalize">
                      {event.document_type?.replace(/_/g, ' ')}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs">
                          {event.actor_type?.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-gray-300 text-xs">{event.actor_name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-gray-300 text-xs">
                        <p>{event.resource_email}</p>
                        {event.resource_title && <p className="text-gray-500">{event.resource_title}</p>}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-400 text-xs font-mono">
                      {event.ip_address}
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={event.status} />
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => toggleExpanded(event.id)}
                        className="p-1.5 hover:bg-gray-700 rounded transition"
                      >
                        <ChevronDown
                          size={16}
                          className={`text-gray-400 transition ${expandedRows[event.id] ? 'rotate-180' : ''}`}
                        />
                      </button>
                    </td>
                  </tr>,
                  <DetailsRow
                    key={`details-${event.id}`}
                    event={event}
                    isExpanded={expandedRows[event.id]}
                    onToggle={() => toggleExpanded(event.id)}
                  />,
                ])
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="bg-gray-900 border-t border-gray-700 px-6 py-4 flex items-center justify-between">
          <p className="text-gray-400 text-sm">
            {t(`${NS}.pagination`, { from: (page - 1) * limit + 1, to: Math.min(page * limit, totalCount), total: totalCount })}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t(`${NS}.previous`)}
            </button>
            <div className="flex items-center gap-2">
              {Array.from({ length: Math.min(pages, 5) }, (_, i) => {
                const pageNum = page <= 3 ? i + 1 : page - 2 + i;
                return pageNum <= pages ? (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`w-8 h-8 rounded text-sm transition ${
                      pageNum === page
                        ? 'bg-orange-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {pageNum}
                  </button>
                ) : null;
              })}
              {pages > 5 && <span className="text-gray-400">...</span>}
            </div>
            <button
              onClick={() => setPage(p => Math.min(pages, p + 1))}
              disabled={page === pages}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t(`${NS}.next`)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
