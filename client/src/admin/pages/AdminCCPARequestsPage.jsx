import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Filter, RefreshCw, Calendar, Mail, MoreVertical, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';

const REQUEST_TYPES = [
  { value: '', i18nKey: 'type.all' },
  { value: 'data_access', i18nKey: 'type.dataAccess' },
  { value: 'deletion', i18nKey: 'type.deletion' },
  { value: 'opt_out', i18nKey: 'type.optOut' },
];

const STATUS_OPTIONS = [
  { value: '', i18nKey: 'status.all' },
  { value: 'pending', i18nKey: 'status.pending' },
  { value: 'processing', i18nKey: 'status.processing' },
  { value: 'awaiting_user', i18nKey: 'status.awaitingUser' },
  { value: 'completed', i18nKey: 'status.completed' },
  { value: 'expired', i18nKey: 'status.expired' },
  { value: 'denied', i18nKey: 'status.denied' },
];

const SORT_OPTIONS = [
  { value: 'newest', i18nKey: 'sort.newest' },
  { value: 'oldest', i18nKey: 'sort.oldest' },
  { value: 'due_soon', i18nKey: 'sort.dueSoon' },
  { value: 'overdue', i18nKey: 'sort.overdue' },
];

const CATEGORY_I18N_KEYS = {
  profile: 'category.profile',
  messages: 'category.messages',
  payments: 'category.payments',
  background_check: 'category.backgroundCheck',
  jobs: 'category.jobs',
  applications: 'category.applications',
};

const STATUS_I18N_KEYS = {
  pending: 'status.pending',
  processing: 'status.processing',
  awaiting_user: 'status.awaitingUser',
  completed: 'status.completed',
  expired: 'status.expired',
  denied: 'status.denied',
};

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const { t } = useTranslation();
  const styles = {
    pending: 'bg-yellow-500/20 text-yellow-400',
    processing: 'bg-blue-500/20 text-blue-400',
    awaiting_user: 'bg-purple-500/20 text-purple-400',
    completed: 'bg-green-500/20 text-green-400',
    expired: 'bg-gray-500/20 text-gray-400',
    denied: 'bg-red-500/20 text-red-400',
  };

  const i18nKey = STATUS_I18N_KEYS[status];

  return (
    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${styles[status] || styles.pending}`}>
      {i18nKey ? t(`adminCcpaRequests.${i18nKey}`) : t('adminCcpaRequests.status.unknown')}
    </span>
  );
}

// ─── Request Detail Modal ──────────────────────────────────────────────────────

function RequestDetailModal({ request, onClose, onStatusChange }) {
  const { t } = useTranslation();
  const typeLabel = (value) => {
    const opt = REQUEST_TYPES.find(o => o.value === value);
    return opt ? t(`adminCcpaRequests.${opt.i18nKey}`) : String(value ?? '').replace(/_/g, ' ');
  };
  const [newStatus, setNewStatus] = useState(request?.status);
  const [adminNotes, setAdminNotes] = useState(request?.admin_notes || '');
  const [fulfillmentDate, setFulfillmentDate] = useState(request?.fulfillment_date || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await adminApi.put(`/admin/legal/ccpa-requests/${request.id}`, {
        status: newStatus,
        adminNotes,
        fulfillmentDate,
      });
      onStatusChange();
      onClose();
    } catch (err) {
      console.error('Failed to update request:', err);
      toast.error(t('adminCcpaRequests.modal.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const daysRemaining = request ? Math.ceil((new Date(request.dueDate) - new Date()) / (1000 * 60 * 60 * 24)) : 0;
  const isOverdue = daysRemaining < 0;
  const isUrgent = daysRemaining < 5 && daysRemaining >= 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 border border-gray-700 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
          <h2 className="text-white font-bold">{t('adminCcpaRequests.modal.title')}</h2>
          <button onClick={onClose} aria-label={t('common.aria.closeButton')} className="text-gray-400 hover:text-white">✕</button>
        </div>

        <div className="p-6 space-y-6">
          {/* Request Info */}
          <div>
            <h3 className="text-gray-300 text-sm font-semibold mb-3">{t('adminCcpaRequests.modal.requestInfo')}</h3>
            <div className="grid grid-cols-2 gap-4 text-sm bg-gray-900 rounded-lg p-4 border border-gray-700">
              <div>
                <p className="text-gray-500 mb-1">{t('adminCcpaRequests.modal.fieldRequestId')}</p>
                <p className="text-gray-300 font-mono text-xs">{request.id}</p>
              </div>
              <div>
                <p className="text-gray-500 mb-1">{t('adminCcpaRequests.modal.fieldType')}</p>
                <p className="text-gray-300 capitalize">{typeLabel(request.type)}</p>
              </div>
              <div>
                <p className="text-gray-500 mb-1">{t('adminCcpaRequests.modal.fieldSubmitted')}</p>
                <p className="text-gray-300">{new Date(request.submittedDate).toLocaleDateString()}</p>
              </div>
              <div>
                <p className="text-gray-500 mb-1">{t('adminCcpaRequests.modal.fieldDueDate')}</p>
                <p className={`${isOverdue ? 'text-red-400' : isUrgent ? 'text-yellow-400' : 'text-gray-300'}`}>
                  {new Date(request.dueDate).toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>

          {/* User Info */}
          <div>
            <h3 className="text-gray-300 text-sm font-semibold mb-3">{t('adminCcpaRequests.modal.userInfo')}</h3>
            <div className="grid grid-cols-2 gap-4 text-sm bg-gray-900 rounded-lg p-4 border border-gray-700">
              <div>
                <p className="text-gray-500 mb-1">{t('adminCcpaRequests.modal.fieldEmail')}</p>
                <p className="text-gray-300">{request.email}</p>
              </div>
              <div>
                <p className="text-gray-500 mb-1">{t('adminCcpaRequests.modal.fieldName')}</p>
                <p className="text-gray-300">{request.name}</p>
              </div>
              <div>
                <p className="text-gray-500 mb-1">{t('adminCcpaRequests.modal.fieldPhone')}</p>
                <p className="text-gray-300">{request.phone || t('adminCcpaRequests.notAvailable')}</p>
              </div>
              <div>
                <p className="text-gray-500 mb-1">{t('adminCcpaRequests.modal.fieldAddress')}</p>
                <p className="text-gray-300 text-xs">{request.address || t('adminCcpaRequests.notAvailable')}</p>
              </div>
            </div>
          </div>

          {/* Request Details */}
          {request.requestNotes && (
            <div>
              <h3 className="text-gray-300 text-sm font-semibold mb-3">{t('adminCcpaRequests.modal.requestDetails')}</h3>
              <p className="text-gray-300 bg-gray-900 rounded-lg p-4 border border-gray-700 text-sm">
                {request.requestNotes}
              </p>
            </div>
          )}

          {/* Data Categories (for Access requests) */}
          {request.type === 'data_access' && (
            <div>
              <h3 className="text-gray-300 text-sm font-semibold mb-3">{t('adminCcpaRequests.modal.dataCategories')}</h3>
              <div className="space-y-2 bg-gray-900 rounded-lg p-4 border border-gray-700">
                {['profile', 'messages', 'payments', 'background_check', 'jobs', 'applications'].map(cat => (
                  <label key={cat} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      defaultChecked={true}
                      className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-orange-500 focus:ring-orange-500"
                    />
                    <span className="text-gray-300 text-sm capitalize">{t(`adminCcpaRequests.${CATEGORY_I18N_KEYS[cat]}`)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Status Management */}
          <div>
            <h3 className="text-gray-300 text-sm font-semibold mb-3">{t('adminCcpaRequests.modal.statusManagement')}</h3>
            <div className="space-y-4 bg-gray-900 rounded-lg p-4 border border-gray-700">
              <div>
                <label className="block text-gray-400 text-sm mb-2">{t('adminCcpaRequests.modal.currentStatus')}</label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
                >
                  {STATUS_OPTIONS.slice(1).map(opt => (
                    <option key={opt.value} value={opt.value}>{t(`adminCcpaRequests.${opt.i18nKey}`)}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-gray-400 text-sm mb-2">{t('adminCcpaRequests.modal.fulfillmentDate')}</label>
                <input
                  type="date"
                  value={fulfillmentDate}
                  onChange={(e) => setFulfillmentDate(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block text-gray-400 text-sm mb-2">{t('adminCcpaRequests.modal.adminNotes')}</label>
                <textarea
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  maxLength={500}
                  rows={3}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500 resize-none"
                  placeholder={t('adminCcpaRequests.modal.adminNotesPlaceholder')}
                />
                <p className="text-gray-500 text-xs mt-1">{adminNotes.length}/500</p>
              </div>
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-gray-800 border-t border-gray-700 px-6 py-4 flex justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition"
          >
            {t('adminCcpaRequests.modal.close')}
          </button>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                // Await the send so a failure is surfaced instead of silently dropped.
                try {
                  await adminApi.post(`/admin/legal/ccpa-requests/${request.id}/send-notification`, {
                    message: t('adminCcpaRequests.modal.notificationMessage'),
                  });
                  toast.success(t('adminCcpaRequests.modal.notificationSent'));
                } catch (err) {
                  console.error('Failed to send notification:', err);
                  toast.error(t('adminCcpaRequests.modal.notificationFailed'));
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
            >
              <Mail size={16} />
              {t('adminCcpaRequests.modal.sendEmail')}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition disabled:opacity-50"
            >
              {saving ? t('adminCcpaRequests.modal.saving') : t('adminCcpaRequests.modal.saveChanges')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminCCPARequestsPage() {
  const { t } = useTranslation();
  const typeLabel = (value) => {
    const opt = REQUEST_TYPES.find(o => o.value === value);
    return opt ? t(`adminCcpaRequests.${opt.i18nKey}`) : String(value ?? '').replace(/_/g, ' ');
  };
  // Filters
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('due_soon');
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [selectedRequest, setSelectedRequest] = useState(null);

  const { data, error, loading, reload } = useAbortableFetch(async (signal) => {
    const res = await adminApi.get('/admin/legal/ccpa-requests', {
      params: {
        status: status || undefined,
        type: type || undefined,
        search: search || undefined,
        sort,
        page,
        limit,
      },
      signal,
    });
    return {
      requests: res.data.requests || [],
      totalCount: res.data.total || 0,
      stats: res.data.stats,
    };
  }, [status, type, search, sort, page, limit]);

  const requests = data?.requests ?? [];
  const totalCount = data?.totalCount ?? 0;
  const stats = data?.stats ?? null;

  const handleDetailClose = () => {
    setSelectedRequest(null);
  };

  const handleStatusChange = () => {
    reload();
  };

  const pages = Math.ceil(totalCount / limit);

  // Determine row color based on SLA
  const getRowClass = (request) => {
    const daysRemaining = Math.ceil((new Date(request.dueDate) - new Date()) / (1000 * 60 * 60 * 24));
    if (request.status === 'completed') return 'bg-green-500/10';
    if (daysRemaining < 0) return 'bg-red-500/10';
    if (daysRemaining < 5) return 'bg-yellow-500/10';
    return '';
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-white font-bold text-3xl mb-2">{t('adminCcpaRequests.title')}</h1>
          <p className="text-gray-400 text-sm">{t('adminCcpaRequests.subtitle')}</p>
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

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <p className="text-gray-400 text-sm mb-2">{t('adminCcpaRequests.stats.total')}</p>
            <p className="text-white text-3xl font-bold">{stats.totalRequests}</p>
          </div>

          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <p className="text-gray-400 text-sm mb-2">{t('adminCcpaRequests.status.pending')}</p>
            <p className="text-yellow-400 text-3xl font-bold">{stats.pendingRequests}</p>
          </div>

          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <p className="text-gray-400 text-sm mb-2">{t('adminCcpaRequests.stats.thisMonth')}</p>
            <p className="text-green-400 text-3xl font-bold">{stats.completedThisMonth}</p>
          </div>

          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <p className="text-gray-400 text-sm mb-2">{t('adminCcpaRequests.stats.avgResponse')}</p>
            <p className="text-white text-3xl font-bold">{stats.avgResponseDays}</p>
            <p className="text-gray-500 text-xs mt-2">{t('adminCcpaRequests.stats.daysUnit')}</p>
          </div>
        </div>
      )}

      {/* SLA Tracker */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-green-500/20 border border-green-500/50 rounded-xl p-4">
            <p className="text-green-400 font-semibold text-sm mb-1">{t('adminCcpaRequests.sla.onTrack')}</p>
            <p className="text-green-300 text-2xl font-bold">{stats.onTrack}</p>
          </div>

          <div className="bg-yellow-500/20 border border-yellow-500/50 rounded-xl p-4">
            <p className="text-yellow-400 font-semibold text-sm mb-1">{t('adminCcpaRequests.sla.dueSoon')}</p>
            <p className="text-yellow-300 text-2xl font-bold">{stats.dueWithinFiveDays}</p>
          </div>

          <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-4">
            <p className="text-red-400 font-semibold text-sm mb-1">{t('adminCcpaRequests.sla.overdue')}</p>
            <p className="text-red-300 text-2xl font-bold">{stats.overdue}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={16} className="text-gray-400" />
          <span className="text-gray-300 font-semibold">{t('adminCcpaRequests.filters.title')}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Search */}
          <div>
            <label className="block text-gray-400 text-sm mb-2">{t('adminCcpaRequests.filters.searchEmail')}</label>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
              <input
                type="text"
                placeholder="user@example.com"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="w-full pl-10 pr-4 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>

          {/* Type */}
          <div>
            <label className="block text-gray-400 text-sm mb-2">{t('adminCcpaRequests.filters.type')}</label>
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
            >
              {REQUEST_TYPES.map(opt => (
                <option key={opt.value} value={opt.value}>{t(`adminCcpaRequests.${opt.i18nKey}`)}</option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div>
            <label className="block text-gray-400 text-sm mb-2">{t('adminCcpaRequests.filters.status')}</label>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
            >
              {STATUS_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{t(`adminCcpaRequests.${opt.i18nKey}`)}</option>
              ))}
            </select>
          </div>

          {/* Sort */}
          <div>
            <label className="block text-gray-400 text-sm mb-2">{t('adminCcpaRequests.filters.sort')}</label>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
            >
              {SORT_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{t(`adminCcpaRequests.${opt.i18nKey}`)}</option>
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
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">{t('adminCcpaRequests.table.requestId')}</th>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">{t('adminCcpaRequests.table.userEmail')}</th>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">{t('adminCcpaRequests.table.type')}</th>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">{t('adminCcpaRequests.table.submitted')}</th>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">{t('adminCcpaRequests.table.dueDate')}</th>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">{t('adminCcpaRequests.table.status')}</th>
                <th className="px-6 py-4 text-center text-gray-400 font-semibold">{t('adminCcpaRequests.table.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {loading ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center">
                    <div className="flex justify-center">
                      <div className="animate-spin w-6 h-6 border-3 border-orange-500 border-t-transparent rounded-full" />
                    </div>
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center text-gray-400">
                    {t('adminCcpaRequests.table.loadFailed')}
                  </td>
                </tr>
              ) : requests.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center text-gray-400">
                    {t('adminCcpaRequests.table.empty')}
                  </td>
                </tr>
              ) : (
                requests.map(request => {
                  const daysRemaining = Math.ceil((new Date(request.dueDate) - new Date()) / (1000 * 60 * 60 * 24));
                  return (
                    <tr key={request.id} className={`hover:bg-gray-700/50 transition ${getRowClass(request)}`}>
                      <td className="px-6 py-4 text-gray-300 font-mono text-xs">{request.id}</td>
                      <td className="px-6 py-4">
                        <div>
                          <p className="text-white">{request.email}</p>
                          <p className="text-gray-500 text-xs">{request.name}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-300 capitalize">
                        {typeLabel(request.type)}
                      </td>
                      <td className="px-6 py-4 text-gray-300 text-xs">
                        {new Date(request.submittedDate).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-xs">
                          <p className="text-gray-300">{new Date(request.dueDate).toLocaleDateString()}</p>
                          <p className={`text-xs ${
                            daysRemaining < 0 ? 'text-red-400' :
                            daysRemaining < 5 ? 'text-yellow-400' :
                            'text-gray-500'
                          }`}>
                            {daysRemaining < 0 ? t('adminCcpaRequests.daysOverdue', { count: Math.abs(daysRemaining) }) : t('adminCcpaRequests.daysLeft', { count: daysRemaining })}
                          </p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={request.status} />
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button
                          onClick={() => setSelectedRequest(request)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs transition"
                        >
                          <Eye size={14} />
                          {t('adminCcpaRequests.row.view')}
                        </button>
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
            {t('adminCcpaRequests.pagination', { from: (page - 1) * limit + 1, to: Math.min(page * limit, totalCount), total: totalCount })}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('adminCcpaRequests.pagination.previous')}
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
              {t('adminCcpaRequests.pagination.next')}
            </button>
          </div>
        </div>
      </div>

      {/* Detail Modal */}
      {selectedRequest && (
        <RequestDetailModal
          request={selectedRequest}
          onClose={handleDetailClose}
          onStatusChange={handleStatusChange}
        />
      )}
    </div>
  );
}
