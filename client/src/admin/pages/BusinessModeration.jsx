import { useState } from 'react';
import {
  Building2, Search, ToggleLeft, ToggleRight, X, Eye, Edit2, Users,
  MessageSquare, Trash2, Flag, AlertCircle, TrendingUp
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';

const STATUS_FILTERS = [
  { value: '',         labelKey: 'statusAll'      },
  { value: 'active',   labelKey: 'statusActive'   },
  { value: 'inactive', labelKey: 'statusInactive' },
];

const ACTIVITY_FILTERS = [
  { value: '',              labelKey: 'activityAll'     },
  { value: 'no_jobs',       labelKey: 'activityNoJobs'  },
  { value: 'incomplete',    labelKey: 'activityIncomplete' },
  { value: 'no_revenue',    labelKey: 'activityNoRevenue' },
  { value: 'active_jobs',   labelKey: 'activityActiveJobs' },
];

const SORT_OPTIONS = [
  { value: 'name',        labelKey: 'sortName'        },
  { value: 'created_asc', labelKey: 'sortOldest'      },
  { value: 'created_desc',labelKey: 'sortNewest'      },
  { value: 'jobs',        labelKey: 'sortMostJobs'    },
  { value: 'activity',    labelKey: 'sortMostRecent'  },
];

// English fallback labels for the filter/sort option keys above. The locale
// pass replaces them with real translations; defaultValue keeps the English
// wording until then.
const OPTION_DEFAULTS = {
  statusAll: 'All', statusActive: 'Active', statusInactive: 'Inactive',
  activityAll: 'All Activity', activityNoJobs: 'No Jobs Posted',
  activityIncomplete: 'Incomplete Setup', activityNoRevenue: 'No Revenue',
  activityActiveJobs: 'Active Jobs',
  sortName: 'Name (A-Z)', sortOldest: 'Oldest First', sortNewest: 'Newest First',
  sortMostJobs: 'Most Jobs', sortMostRecent: 'Most Recently Active',
};

function optionLabel(t, labelKey) {
  return t(`adminBusinessModeration.${labelKey}`, { defaultValue: OPTION_DEFAULTS[labelKey] || labelKey });
}

function statusBadge(isActive) {
  return isActive
    ? 'bg-green-500/20 text-green-400'
    : 'bg-red-500/20 text-red-400';
}

function activityBadge(activity) {
  const styles = {
    active: 'bg-green-500/20 text-green-400',
    dormant: 'bg-yellow-500/20 text-yellow-400',
    inactive: 'bg-red-500/20 text-red-400',
    setup: 'bg-blue-500/20 text-blue-400',
  };
  return styles[activity] || styles.inactive;
}

// ─── Business Avatar ──────────────────────────────────────────────────────────

function BusinessAvatar({ business }) {
  const bgColor = ['bg-blue-500', 'bg-purple-500', 'bg-pink-500', 'bg-green-500', 'bg-orange-500'];
  const hash = (business.id?.toString() || '').charCodeAt(0) || 0;
  const bg = bgColor[hash % bgColor.length];
  const initials = (business.business_name || '')
    .split(' ')
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase();

  return (
    <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
      {initials || 'B'}
    </div>
  );
}

// ─── Reason Modal ─────────────────────────────────────────────────────────────

function ReasonModal({ business, actionType, onConfirm, onClose, loading }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [error,  setError]  = useState('');

  const actionLabels = {
    toggle: business.is_active ? t('adminBusinessModeration.actionDeactivate', { defaultValue: 'Deactivate' }) : t('adminBusinessModeration.actionReactivate', { defaultValue: 'Reactivate' }),
    suspend: t('adminBusinessModeration.actionSuspend', { defaultValue: 'Suspend' }),
    delete: t('adminBusinessModeration.actionDelete', { defaultValue: 'Delete' }),
    flag: t('adminBusinessModeration.actionFlag', { defaultValue: 'Flag for Review' }),
  };

  const handle = () => {
    if (!reason.trim()) { setError(t('adminBusinessModeration.reasonRequired', { defaultValue: 'A reason is required.' })); return; }
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
            <h3 className="font-bold text-white text-base">
              {t('adminBusinessModeration.modalTitle', { defaultValue: '{{action}} business', action: actionLabels[actionType] })}
            </h3>
            <p className="text-gray-400 text-sm mt-0.5 truncate max-w-xs">
              {business.business_name}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            aria-label={t('common.aria.closeButton')}
            className="text-gray-500 hover:text-white transition p-1"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            {t('adminBusinessModeration.reasonLabel', { defaultValue: 'Reason' })} <span className="text-red-400">*</span>
          </label>
          <textarea
            rows={3}
            value={reason}
            onChange={e => { setReason(e.target.value); setError(''); }}
            placeholder={t('adminBusinessModeration.reasonPlaceholder', { defaultValue: 'Explain why you are taking this action…' })}
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
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-semibold transition
                        disabled:opacity-50 disabled:cursor-not-allowed text-white
                        ${actionType === 'delete'
                          ? 'bg-red-600 hover:bg-red-700'
                          : actionType === 'toggle' && business.is_active
                          ? 'bg-red-600 hover:bg-red-700'
                          : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {loading ? t('adminConfirmDialog.working') : actionLabels[actionType]}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Action Menu ──────────────────────────────────────────────────────────────

function ActionMenu({ business, onToggle, onSuspend, onDelete, onFlag, onViewProfile }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="px-2 py-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition text-xl"
        title={t('adminBusinessModeration.moreActions', { defaultValue: 'More actions' })}
        aria-label={t('adminBusinessModeration.moreActions', { defaultValue: 'More actions' })}
      >
        ⋯
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-40 w-48">
          <button
            onClick={() => { onViewProfile(); setOpen(false); }}
            className="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2 border-b border-gray-700"
          >
            <Eye size={14} /> {t('adminBusinessModeration.viewProfile', { defaultValue: 'View Profile' })}
          </button>
          <button
            onClick={() => { onToggle(); setOpen(false); }}
            className="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2 border-b border-gray-700"
          >
            {business.is_active ? <ToggleLeft size={14} /> : <ToggleRight size={14} />}
            {business.is_active ? t('adminBusinessModeration.actionDeactivate', { defaultValue: 'Deactivate' }) : t('adminBusinessModeration.actionReactivate', { defaultValue: 'Reactivate' })}
          </button>
          <button
            onClick={() => { onFlag(); setOpen(false); }}
            className="w-full text-left px-4 py-2.5 text-sm text-yellow-400 hover:bg-gray-700 flex items-center gap-2 border-b border-gray-700"
          >
            <Flag size={14} /> {t('adminBusinessModeration.actionFlag', { defaultValue: 'Flag for Review' })}
          </button>
          <button
            onClick={() => { onDelete(); setOpen(false); }}
            className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-gray-700 flex items-center gap-2"
          >
            <Trash2 size={14} /> {t('adminBusinessModeration.actionDelete', { defaultValue: 'Delete' })}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BusinessModeration() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [activityFilter, setActivityFilter] = useState('');
  const [sortBy, setSortBy] = useState('created_desc');
  const [page, setPage] = useState(1);

  const [modal, setModal] = useState(null); // { business, actionType }
  const [actionBusy, setActionBusy] = useState(false);
  const navigate = useNavigate();

  // Abortable list load. On failure the previous queue stays visible and an
  // error state is shown; the list is never cleared into a false empty queue.
  const { data, error, loading, reload } = useAbortableFetch(async (signal) => {
    const params = { page };
    if (search) params.search = search;
    if (statusFilter) params.status = statusFilter;
    if (activityFilter) params.activity = activityFilter;
    if (sortBy) params.sort = sortBy;

    const { data } = await adminApi.get('/admin/businesses', { params, signal });
    return {
      businesses: data.businesses || [],
      stats: {
        total: data.total || 0,
        active: data.stats?.active || 0,
        inactive: data.stats?.inactive || 0,
        newThisMonth: data.stats?.newThisMonth || 0,
        dormant: data.stats?.dormant || 0,
      },
    };
  }, [search, statusFilter, activityFilter, sortBy, page]);

  const businesses = data?.businesses ?? [];
  const stats = data?.stats ?? {
    total: 0,
    active: 0,
    inactive: 0,
    newThisMonth: 0,
    dormant: 0,
  };

  const resetPage = (setter) => (val) => { setter(val); setPage(1); };

  const handleAction = async (actionType, reason) => {
    setActionBusy(true);
    try {
      const endpoint = actionType === 'toggle'
        ? `/admin/businesses/${modal.business.id}/toggle`
        : `/admin/businesses/${modal.business.id}/${actionType}`;

      await adminApi.put(endpoint, { reason });

      setModal(null);
      reload();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminConfirmDialog.actionFailed'));
    } finally {
      setActionBusy(false);
    }
  };

  const col = 'px-4 py-3 text-sm';

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Building2 size={24} className="text-orange-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">{t('adminBusinessModeration.title', { defaultValue: 'Business Moderation' })}</h1>
          <p className="text-gray-400 text-sm mt-0.5">{t('adminBusinessModeration.subtitle', { defaultValue: 'Manage and monitor all businesses on the platform' })}</p>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <p className="text-gray-400 text-xs font-medium mb-1">{t('adminBusinessModeration.statTotal', { defaultValue: 'TOTAL' })}</p>
          <p className="text-white text-2xl font-bold">{stats.total}</p>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <p className="text-gray-400 text-xs font-medium mb-1">{t('adminBusinessModeration.statActive', { defaultValue: 'ACTIVE' })}</p>
          <p className="text-green-400 text-2xl font-bold">{stats.active}</p>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <p className="text-gray-400 text-xs font-medium mb-1">{t('adminBusinessModeration.statInactive', { defaultValue: 'INACTIVE' })}</p>
          <p className="text-red-400 text-2xl font-bold">{stats.inactive}</p>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <p className="text-gray-400 text-xs font-medium mb-1">{t('adminBusinessModeration.statNewThisMonth', { defaultValue: 'NEW THIS MONTH' })}</p>
          <p className="text-blue-400 text-2xl font-bold">{stats.newThisMonth}</p>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <p className="text-gray-400 text-xs font-medium mb-1">{t('adminBusinessModeration.statDormant', { defaultValue: 'DORMANT' })}</p>
          <p className="text-yellow-400 text-2xl font-bold">{stats.dormant}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-3 mb-6">
        {/* Row 1: Search + Status */}
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder={t('adminBusinessModeration.searchPlaceholder', { defaultValue: 'Search by name, owner, email…' })}
              value={search}
              onChange={e => resetPage(setSearch)(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg
                         text-white text-sm placeholder-gray-500 focus:border-orange-500 focus:outline-none"
            />
          </div>
          <div className="flex gap-2">
            {STATUS_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => resetPage(setStatusFilter)(f.value)}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
                  statusFilter === f.value
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'
                }`}
              >
                {optionLabel(t, f.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: Activity + Sort */}
        <div className="flex flex-col lg:flex-row gap-3">
          <select
            value={activityFilter}
            onChange={e => resetPage(setActivityFilter)(e.target.value)}
            className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm
                       focus:border-orange-500 focus:outline-none"
          >
            {ACTIVITY_FILTERS.map(f => (
              <option key={f.value} value={f.value}>{optionLabel(t, f.labelKey)}</option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={e => resetPage(setSortBy)(e.target.value)}
            className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm
                       focus:border-orange-500 focus:outline-none"
          >
            {SORT_OPTIONS.map(s => (
              <option key={s.value} value={s.value}>{optionLabel(t, s.labelKey)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1200px]">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminBusinessModeration.colBusiness', { defaultValue: 'BUSINESS' })}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminBusinessModeration.colOwner', { defaultValue: 'OWNER' })}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminBusinessModeration.colLocation', { defaultValue: 'LOCATION' })}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminBusinessModeration.colCategory', { defaultValue: 'CATEGORY' })}</th>
                <th className="text-center text-gray-400 font-medium px-4 py-3">{t('adminBusinessModeration.colJobs', { defaultValue: 'JOBS' })}</th>
                <th className="text-center text-gray-400 font-medium px-4 py-3">{t('adminBusinessModeration.colMembers', { defaultValue: 'MEMBERS' })}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminBusinessModeration.colStatus', { defaultValue: 'STATUS' })}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminBusinessModeration.colCreated', { defaultValue: 'CREATED' })}</th>
                <th className="text-center text-gray-400 font-medium px-4 py-3">{t('adminBusinessModeration.colActions', { defaultValue: 'ACTIONS' })}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="text-center text-gray-400 py-12">{t('adminBusinessModeration.loading', { defaultValue: 'Loading…' })}</td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={9} className="text-center py-12">
                    <AdminErrorState onRetry={reload} />
                  </td>
                </tr>
              ) : businesses.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center text-gray-400 py-12">{t('adminBusinessModeration.noBusinesses', { defaultValue: 'No businesses found.' })}</td>
                </tr>
              ) : businesses.map(b => (
                <tr key={b.id} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors">
                  <td className={`${col}`}>
                    <div className="flex items-center gap-3">
                      <BusinessAvatar business={b} />
                      <div>
                        <p className="text-white font-medium">{b.business_name}</p>
                        <p className="text-gray-500 text-xs">{b.business_type || t('adminBusinessModeration.unknownType', { defaultValue: 'Unknown' })}</p>
                      </div>
                    </div>
                  </td>
                  <td className={col}>
                    <p className="text-gray-300">{b.owner_name || '-'}</p>
                    <p className="text-gray-500 text-xs">{b.owner_email || '-'}</p>
                  </td>
                  <td className={`${col} text-gray-400`}>
                    {b.address_city && b.address_state
                      ? `${b.address_city}, ${b.address_state}`
                      : b.address_city || b.address_state || '-'}
                  </td>
                  <td className={`${col} text-gray-400 capitalize`}>
                    {b.category || '-'}
                  </td>
                  <td className={`${col} text-center text-gray-300 font-medium`}>
                    {b.job_count ?? 0}
                  </td>
                  <td className={`${col} text-center text-gray-300 font-medium`}>
                    {b.member_count ?? 0}
                  </td>
                  <td className={col}>
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${statusBadge(b.is_active)}`}>
                      {b.is_active ? t('adminBusinessModeration.activeBadge', { defaultValue: 'Active' }) : t('adminBusinessModeration.inactiveBadge', { defaultValue: 'Inactive' })}
                    </span>
                  </td>
                  <td className={`${col} text-gray-400`}>
                    {b.created_at ? new Date(b.created_at).toLocaleDateString() : '-'}
                  </td>
                  <td className={`${col} text-center`}>
                    <ActionMenu
                      business={b}
                      onToggle={() => setModal({ business: b, actionType: 'toggle' })}
                      onSuspend={() => setModal({ business: b, actionType: 'suspend' })}
                      onDelete={() => setModal({ business: b, actionType: 'delete' })}
                      onFlag={() => setModal({ business: b, actionType: 'flag' })}
                      onViewProfile={() => navigate(`/admin/businesses/${b.id}`)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {stats.total > 25 && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-400">
          <span>{t('adminBusinessModeration.pageSummary', { defaultValue: 'Page {{page}} · {{total}} total', page, total: stats.total })}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1 bg-gray-800 border border-gray-700 rounded-lg
                         disabled:opacity-40 hover:bg-gray-700 transition-colors"
            >
              {t('adminBusinessModeration.previous', { defaultValue: '← Prev' })}
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={businesses.length < 25}
              className="px-3 py-1 bg-gray-800 border border-gray-700 rounded-lg
                         disabled:opacity-40 hover:bg-gray-700 transition-colors"
            >
              {t('adminBusinessModeration.next', { defaultValue: 'Next →' })}
            </button>
          </div>
        </div>
      )}

      {/* Action Modal */}
      {modal && (
        <ReasonModal
          business={modal.business}
          actionType={modal.actionType}
          onConfirm={(reason) => handleAction(modal.actionType, reason)}
          onClose={() => !actionBusy && setModal(null)}
          loading={actionBusy}
        />
      )}
    </div>
  );
}
