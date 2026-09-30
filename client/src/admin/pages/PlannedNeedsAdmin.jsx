import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import adminApi from '../../lib/adminApi';

const ALL_STATUSES = [
  'all', 'planned', 'funding', 'activating_soon', 'published',
  'cancelled', 'completed', 'regenerated',
];

const TERMINAL = ['cancelled', 'completed', 'regenerated'];

function statusBadge(status) {
  switch (status) {
    case 'activating_soon': return 'bg-orange-500/20 text-orange-400';
    case 'published':       return 'bg-blue-500/20 text-blue-400';
    case 'cancelled':       return 'bg-red-500/20 text-red-400';
    case 'completed':       return 'bg-green-500/20 text-green-400';
    default:                return 'bg-gray-500/20 text-gray-400';
  }
}

// Parse a date-only (YYYY-MM-DD) value as local time. `new Date('2026-09-30')`
// is parsed as UTC midnight, which renders a day early west of UTC.
function parseLocalDate(value) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(value);
}

function formatCost(value) {
  if (value == null) return '-';
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return `$${num.toLocaleString()}`;
}

// ─── Action modal ─────────────────────────────────────────────────────────────

function ActionModal({ item, actionType, onConfirm, onClose, loading }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [error,  setError]  = useState('');

  const isCancel = actionType === 'force-cancel';
  const title = isCancel ? t('adminPlannedNeeds.modalTitleForceCancel') : t('adminPlannedNeeds.modalTitleCancelAutopublish');

  const handle = () => {
    if (!reason.trim()) { setError(t('adminPlannedNeeds.reasonRequired')); return; }
    onConfirm(reason.trim());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={() => !loading && onClose()}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-bold text-white text-base">{title}</h3>
            <p className="text-gray-400 text-sm mt-0.5 truncate max-w-xs">{item.title}</p>
          </div>
          <button onClick={onClose} disabled={loading} className="text-gray-500 hover:text-white transition p-1">
            <X size={16} />
          </button>
        </div>

        {isCancel && item.published_job_id && (
          <div className="mb-4 p-3 bg-yellow-900/30 border border-yellow-700/40 rounded-lg">
            <p className="text-yellow-300 text-xs">
              {t('adminPlannedNeeds.publishedJobWarning', { id: item.published_job_id })}
            </p>
          </div>
        )}

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            {t('adminPlannedNeeds.reasonLabel')} <span className="text-red-400">*</span>
          </label>
          <textarea
            rows={3}
            value={reason}
            onChange={e => { setReason(e.target.value); setError(''); }}
            placeholder={t('adminPlannedNeeds.reasonPlaceholder')}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg text-white text-sm
                       p-2.5 placeholder-gray-500 focus:border-orange-500 focus:outline-none resize-none"
          />
          {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 text-gray-300
                       rounded-lg text-sm font-medium hover:bg-gray-700 transition disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handle}
            disabled={loading || !reason.trim()}
            className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm
                       font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? t('adminPlannedNeeds.saving') : t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function PlannedNeedsAdmin() {
  const { t } = useTranslation();
  const [needs,       setNeeds]       = useState([]);
  const [total,       setTotal]       = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page,        setPage]        = useState(1);

  const [modal,       setModal]       = useState(null); // { item, actionType }
  const [actionBusy,  setActionBusy]  = useState(false);

  const fetchNeeds = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page };
      if (search)                             params.search = search;
      if (statusFilter && statusFilter !== 'all') params.status = statusFilter;
      const { data } = await adminApi.get('/admin/planned-needs', { params });
      setNeeds(data.needs || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to fetch planned needs:', err);
      setNeeds([]);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, page]);

  useEffect(() => { fetchNeeds(); }, [fetchNeeds]);

  const resetPage = (setter) => (val) => { setter(val); setPage(1); };

  const handleAction = async (reason) => {
    const { item, actionType } = modal;
    setActionBusy(true);
    try {
      await adminApi.post(`/admin/planned-needs/${item.id}/${actionType}`, { reason });
      setModal(null);
      fetchNeeds();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminPlannedNeeds.actionFailed'));
    } finally {
      setActionBusy(false);
    }
  };

  const col = 'px-4 py-3 text-sm';

  const STATUS_LABELS = {
    all: t('adminPlannedNeeds.statusAll'),
    planned: t('adminPlannedNeeds.statusPlanned'),
    funding: t('adminPlannedNeeds.statusFunding'),
    activating_soon: t('adminPlannedNeeds.statusActivatingSoon'),
    published: t('adminPlannedNeeds.statusPublished'),
    cancelled: t('adminPlannedNeeds.statusCancelled'),
    completed: t('adminPlannedNeeds.statusCompleted'),
    regenerated: t('adminPlannedNeeds.statusRegenerated'),
  };

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <ClipboardList size={22} className="text-orange-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">{t('adminPlannedNeeds.title')}</h1>
          <p className="text-gray-400 text-sm mt-0.5">{t('adminPlannedNeeds.recordsCount', { count: total })}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            placeholder={t('adminPlannedNeeds.searchPlaceholder')}
            value={search}
            onChange={e => resetPage(setSearch)(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg
                       text-white text-sm placeholder-gray-500 focus:border-orange-500 focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => resetPage(setStatusFilter)(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-2
                     focus:border-orange-500 focus:outline-none"
        >
          {ALL_STATUSES.map(s => (
            <option key={s} value={s}>
              {STATUS_LABELS[s] || s}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminPlannedNeeds.colTitle')}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminPlannedNeeds.colOwner')}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminPlannedNeeds.colCategory')}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminPlannedNeeds.colStatus')}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminPlannedNeeds.colDue')}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminPlannedNeeds.colCost')}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminPlannedNeeds.colRecurrence')}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminPlannedNeeds.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center text-gray-400 py-12">{t('adminPlannedNeeds.loading')}</td>
                </tr>
              ) : needs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center text-gray-400 py-12">{t('adminPlannedNeeds.noResults')}</td>
                </tr>
              ) : needs.map(n => (
                <tr key={n.id} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors">
                  <td className={`${col} max-w-[200px]`}>
                    <p className="text-white font-medium truncate">{n.title}</p>
                  </td>
                  <td className={col}>
                    <p className="text-gray-300">{n.owner_name || '-'}</p>
                    <p className="text-gray-500 text-xs">{n.owner_email || '-'}</p>
                  </td>
                  <td className={`${col} text-gray-400 capitalize`}>
                    {(n.category || '-').replace(/_/g, ' ')}
                  </td>
                  <td className={col}>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusBadge(n.status)}`}>
                      {(n.status || '').replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className={`${col} text-gray-400`}>
                    {n.due_date ? parseLocalDate(n.due_date).toLocaleDateString() : '-'}
                  </td>
                  <td className={`${col} text-white`}>
                    {formatCost(n.estimated_cost)}
                  </td>
                  <td className={`${col} text-gray-400 capitalize`}>
                    {n.recurrence_type || 'one-time'}
                  </td>
                  <td className={col}>
                    <div className="flex gap-2 flex-wrap">
                      {n.status === 'activating_soon' && (
                        <button
                          onClick={() => setModal({ item: n, actionType: 'cancel-autopublish' })}
                          className="px-2.5 py-1.5 bg-yellow-900/40 text-yellow-400 hover:bg-yellow-900/70
                                     text-xs font-medium rounded-lg transition whitespace-nowrap"
                        >
                          {t('adminPlannedNeeds.cancelAutopublish')}
                        </button>
                      )}
                      {!TERMINAL.includes(n.status) && (
                        <button
                          onClick={() => setModal({ item: n, actionType: 'force-cancel' })}
                          className="px-2.5 py-1.5 bg-red-500/10 text-red-400 hover:bg-red-500/20
                                     text-xs font-medium rounded-lg transition whitespace-nowrap"
                        >
                          {t('adminPlannedNeeds.forceCancel')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {total > 25 && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-400">
          <span>{t('adminPlannedNeeds.pageTotal', { page, total })}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1 bg-gray-800 border border-gray-700 rounded-lg
                         disabled:opacity-40 hover:bg-gray-700 transition-colors"
            >
              {t('adminPlannedNeeds.prev')}
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={needs.length < 25}
              className="px-3 py-1 bg-gray-800 border border-gray-700 rounded-lg
                         disabled:opacity-40 hover:bg-gray-700 transition-colors"
            >
              {t('adminPlannedNeeds.next')}
            </button>
          </div>
        </div>
      )}

      {/* Action modal */}
      {modal && (
        <ActionModal
          item={modal.item}
          actionType={modal.actionType}
          onConfirm={handleAction}
          onClose={() => !actionBusy && setModal(null)}
          loading={actionBusy}
        />
      )}
    </div>
  );
}
