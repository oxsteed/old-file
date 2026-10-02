import { useEffect, useMemo, useState, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Search, Download, UserPlus, X, MessageSquare, MoreHorizontal,
  ChevronUp, ChevronDown, Shield, ShieldCheck, MapPin, Star,
  Ban, CheckCircle, Key, Eye, RotateCcw,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import { useHasGrant } from '../lib/GrantGuard';
import { adminDate } from '../lib/formatters';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ROLES    = ['', 'customer', 'helper', 'helper_pro', 'broker'];
const PLANS    = ['', 'starter', 'pro', 'elite', 'broker'];
const STATUSES = ['', 'active', 'banned'];
const PAGE_SIZES = [25, 50, 100];
const QUICK_CREATE_ACCOUNT_TYPES = [
  { value: 'customer', label: 'Customer' },
  { value: 'investor', label: 'Investor' },
  { value: 'helper', label: 'Helper' },
  { value: 'helper_pro', label: 'Helper Pro' },
  { value: 'broker', label: 'Broker' },
  { value: 'logistics', label: 'Logistics' },
  { value: 'business_owner', label: 'Business Owner' },
  { value: 'consultant', label: 'Consultant' },
  { value: 'tool_owner', label: 'Tool Owner' },
  { value: 'franchise_applicant', label: 'Franchise Applicant' },
  { value: 'life_only', label: 'Life Only' },
  { value: 'business_manager', label: 'Business Manager' },
  { value: 'business_representative', label: 'Business Representative' },
  { value: 'business_employee', label: 'Business Employee' },
  { value: 'business_support_agent', label: 'Business Support Agent' },
  { value: 'employee', label: 'Employee' },
  { value: 'operations_employee', label: 'Operations Employee' },
  { value: 'compliance_employee', label: 'Compliance Employee' },
  { value: 'admin', label: 'Admin' },
  { value: 'super_admin', label: 'Super Admin' },
];

const SORT_COLS = [
  { key: 'first_name',   label: 'Name'        },
  { key: 'created_at',   label: 'Joined'      },
  { key: 'last_login_at',label: 'Last Active' },
  { key: 'avg_rating',   label: 'Rating'      },
];
const SORT_KEYS = new Set(SORT_COLS.map(({ key }) => key));

function positiveQueryInt(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function activityInfo(lastLoginAt, t) {
  if (!lastLoginAt) return { color: 'bg-gray-600', label: t('adminUsers.list.neverLoggedIn'), key: 'never' };
  const diffH = (Date.now() - new Date(lastLoginAt)) / 3_600_000;
  if (diffH < 1)   return { color: 'bg-green-400',  label: t('adminUsers.list.onlineRecently'), key: 'online' };
  if (diffH < 168) return { color: 'bg-yellow-400', label: t('adminUsers.list.activeThisWeek'), key: 'recent' };
  if (diffH < 720) return { color: 'bg-gray-400',   label: t('adminUsers.list.activeThisMonth'), key: 'moderate' };
  return { color: 'bg-red-500', label: t('adminUsers.list.inactiveThirtyDays'), key: 'inactive' };
}

function fmtDate(d) {
  return adminDate(d, { month: 'short', day: 'numeric', year: '2-digit' });
}

function fmtRelative(d, t) {
  if (!d) return '-';
  const diffH = (Date.now() - new Date(d)) / 3_600_000;
  if (diffH < 1)   return t('adminUsers.list.justNow');
  if (diffH < 24)  return t('adminUsers.list.hoursAgo', { count: Math.floor(diffH) });
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7)   return t('adminUsers.list.daysAgo', { count: diffD });
  if (diffD < 30)  return t('adminUsers.list.weeksAgo', { count: Math.floor(diffD / 7) });
  if (diffD < 365) return t('adminUsers.list.monthsAgo', { count: Math.floor(diffD / 30) });
  return t('adminUsers.list.yearsAgo', { count: Math.floor(diffD / 365) });
}

// Click-outside hook
function useClickOutside(ref, handler) {
  useEffect(() => {
    const listener = (e) => { if (ref.current && !ref.current.contains(e.target)) handler(); };
    document.addEventListener('mousedown', listener);
    return () => document.removeEventListener('mousedown', listener);
  }, [ref, handler]);
}

// ---------------------------------------------------------------------------
// CreateUserModal (unchanged from original)
// ---------------------------------------------------------------------------
function CreateUserModal({ onClose, onCreated }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', password: '', account_type: 'customer' });
  const [error, setError] = useState('');
  const [busy, setBusy]   = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const { data } = await adminApi.post('/admin/super/users/create-full', {
        ...form,
        role: form.account_type,
      });
      onCreated(data.user);
    } catch (err) {
      setError(err.response?.data?.error || t('adminUsers.list.createFailed'));
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={() => !busy && onClose()}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-white text-base">{t('adminUsers.list.createTitle')}</h3>
          <button onClick={onClose} disabled={busy} aria-label={t('common.close', { defaultValue: 'Close' })} className="text-gray-500 hover:text-white transition"><X size={18} aria-hidden="true" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[['first_name', t('adminUsers.list.firstName')], ['last_name', t('adminUsers.list.lastName')]].map(([k, label]) => (
              <div key={k}>
                <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
                <input required value={form[k]} onChange={e => set(k, e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm
                             text-white placeholder-gray-500 focus:outline-none focus:border-orange-500" />
              </div>
            ))}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">{t('adminUsers.list.email')}</label>
            <input type="email" required value={form.email} onChange={e => set('email', e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm
                         text-white placeholder-gray-500 focus:outline-none focus:border-orange-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">{t('adminUsers.list.password')} <span className="text-gray-600">{t('adminUsers.list.minChars')}</span></label>
            <input type="password" required minLength={8} value={form.password} onChange={e => set('password', e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm
                         text-white placeholder-gray-500 focus:outline-none focus:border-orange-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">{t('adminUsers.list.accountType')}</label>
            <select value={form.account_type} onChange={e => set('account_type', e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm
                         text-gray-300 focus:outline-none focus:border-orange-500">
              {QUICK_CREATE_ACCOUNT_TYPES.map((accountType) => (
                <option key={accountType.value} value={accountType.value}>
                  {t(`adminUsers.list.accountTypes.${accountType.value}`, { defaultValue: accountType.label })}
                </option>
              ))}
            </select>
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={busy}
              className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 text-gray-300
                         rounded-lg text-sm font-medium hover:bg-gray-700 transition disabled:opacity-50">
              {t('adminUsers.list.cancel')}
            </button>
            <button type="submit" disabled={busy}
              className="flex-1 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white
                         rounded-lg text-sm font-semibold transition disabled:opacity-50">
              {busy ? t('adminUsers.list.creating') : t('adminUsers.list.createUser')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ResetPasswordModal (super-admin only, used from quick-actions menu)
// ---------------------------------------------------------------------------
function ResetPasswordModal({ user, onClose }) {
  const { t } = useTranslation();
  const [pw, setPw]     = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr]   = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await adminApi.post(`/admin/users/${user.id}/password`, { newPassword: pw });
      setDone(true);
    } catch (error) {
      setErr(error.response?.data?.error || t('adminUsers.list.resetFailed'));
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={() => !busy && onClose()}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-white text-sm flex items-center gap-2">
            <Key size={15} className="text-orange-400" /> {t('adminUsers.list.resetPassword')}
          </h3>
          <button onClick={onClose} aria-label={t('common.close', { defaultValue: 'Close' })} className="text-gray-500 hover:text-white transition"><X size={16} aria-hidden="true" /></button>
        </div>
        {done ? (
          <div className="text-center py-4">
            <CheckCircle size={32} className="text-green-400 mx-auto mb-2" aria-hidden="true" />
            <p className="text-white text-sm font-medium">{t('adminUsers.list.resetSuccess')}</p>
            <p className="text-gray-400 text-xs mt-1">{t('adminUsers.list.sessionsInvalidated', { name: user.first_name })}</p>
            <button onClick={onClose} className="mt-4 px-4 py-2 bg-gray-700 text-gray-200 rounded-lg text-sm hover:bg-gray-600 transition">{t('common.close', { defaultValue: 'Close' })}</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-gray-400 text-xs">{t('adminUsers.list.settingPassword', { name: `${user.first_name} ${user.last_name}` })}</p>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">{t('adminUsers.list.newPassword')} <span className="text-gray-600">{t('adminUsers.list.minChars')}</span></label>
              <input type="password" required minLength={8} value={pw} onChange={e => setPw(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm
                           text-white focus:outline-none focus:border-orange-500" />
            </div>
            {err && <p className="text-red-400 text-xs">{err}</p>}
            <div className="flex gap-3">
              <button type="button" onClick={onClose} disabled={busy}
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 text-gray-300 rounded-lg text-sm hover:bg-gray-700 transition disabled:opacity-50">
                {t('adminUsers.list.cancel')}
              </button>
              <button type="submit" disabled={busy || pw.length < 8}
                className="flex-1 px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50">
                {busy ? t('adminUsers.list.resetting') : t('adminUsers.list.reset')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// QuickActionsMenu — "..." dropdown per row
// ---------------------------------------------------------------------------
function QuickActionsMenu({ user, isSuper, canMessage, onMessage, onToggleBan, onResetPw, onRefresh, onCancelPendingDeletion }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false));

  const doToggleBan = async () => {
    setOpen(false); setBusy(true);
    await onToggleBan(user);
    setBusy(false);
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} disabled={busy}
        aria-label={t('common.moreActions', { defaultValue: 'More actions' })}
        className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-700 transition disabled:opacity-40">
        <MoreHorizontal size={15} aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-40 w-48 bg-gray-900 border border-gray-700
                        rounded-xl shadow-2xl overflow-hidden py-1">
          <Link to={`/admin/users/${user.id}`} onClick={() => setOpen(false)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left rounded-lg
                       text-gray-300 hover:bg-gray-700 transition">
            <Eye size={13} /> {t('adminUsers.list.viewProfile')}
          </Link>
          {canMessage && (
            <button onClick={() => { setOpen(false); onMessage(user); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left rounded-lg text-gray-300 hover:bg-gray-700 transition">
              <MessageSquare size={13} /> {t('adminUsers.list.sendMessage')}
            </button>
          )}
          <div className="border-t border-gray-800 my-1" />
          {isSuper && user.deletion_scheduled_at && user.deletion_type !== 'self' && (
            <button
              type="button"
              onClick={async () => {
                setOpen(false);
                if (!window.confirm(t('adminUsers.list.cancelDeletionConfirm', { email: user.email }))) return;
                setBusy(true);
                try {
                  await onCancelPendingDeletion(user);
                } finally {
                  setBusy(false);
                }
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left rounded-lg text-orange-300 hover:bg-orange-900/25 transition"
            >
              <RotateCcw size={13} /> {t('adminUsers.list.cancelDeletion')}
            </button>
          )}
          <button onClick={doToggleBan}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left rounded-lg transition
              ${user.is_active ? 'text-red-400 hover:bg-red-900/30' : 'text-green-400 hover:bg-green-900/30'}`}>
            {user.is_active ? <><Ban size={13} /> {t('adminUsers.list.suspend')}</> : <><CheckCircle size={13} /> {t('adminUsers.list.reactivate')}</>}
          </button>
          {isSuper && (
            <button onClick={() => { setOpen(false); onResetPw(user); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left rounded-lg text-orange-400 hover:bg-orange-900/20 transition">
              <Key size={13} /> {t('adminUsers.list.resetPasswordAction')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatsBar
// ---------------------------------------------------------------------------
function StatsBar({ summary, t }) {
  if (!summary) return null;
  const stats = [
    { label: t('adminUsers.list.totalUsers'), value: Number(summary.total).toLocaleString(), color: 'text-white' },
    { label: t('adminUsers.list.active'), value: Number(summary.active).toLocaleString(), color: 'text-green-400' },
    { label: t('adminUsers.list.suspended'), value: Number(summary.suspended).toLocaleString(), color: 'text-red-400' },
    { label: t('adminUsers.list.helpers'), value: Number(summary.helpers).toLocaleString(), color: 'text-orange-400' },
    { label: t('adminUsers.list.customers'), value: Number(summary.customers).toLocaleString(), color: 'text-blue-400' },
    { label: t('adminUsers.list.newThisWeek'), value: Number(summary.new_this_week).toLocaleString(), color: 'text-purple-400' },
  ];
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
      {stats.map(({ label, value, color }) => (
        <div key={label} className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-3 text-center">
          <p className={`text-lg font-bold ${color}`}>{value}</p>
          <p className="text-gray-500 text-xs mt-0.5">{label}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SortableHeader
// ---------------------------------------------------------------------------
function SortHeader({ col, label, currentSort, currentOrder, onSort }) {
  const active = currentSort === col;
  return (
    <th className="px-4 py-3 text-left">
      <button onClick={() => onSort(col)}
        className={`flex items-center gap-1 text-xs uppercase tracking-wider font-semibold transition
          ${active ? 'text-orange-400' : 'text-gray-400 hover:text-gray-200'}`}>
        {label}
        <span className="ml-0.5">
          {active
            ? (currentOrder === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)
            : <ChevronDown size={11} className="opacity-30" />}
        </span>
      </button>
    </th>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function UsersList() {
  const { user: me }  = useAuth();
  const { t } = useTranslation();
  const isSuper       = me?.role === 'super_admin';
  const { allowed: canMessage } = useHasGrant('message_users');
  const { allowed: canExport } = useHasGrant('export_data');
  const [searchParams, setSearchParams] = useSearchParams();
  const queryFilters = useMemo(() => {
    const role = searchParams.get('role') || '';
    const status = searchParams.get('status') || '';
    const plan = searchParams.get('plan') || '';
    const limit = positiveQueryInt(searchParams.get('limit'), 25);
    return {
      search: searchParams.get('search') || '',
      role: ROLES.includes(role) ? role : '',
      status: STATUSES.includes(status) ? status : '',
      plan: PLANS.includes(plan) ? plan : '',
      location: searchParams.get('location') || '',
      page: positiveQueryInt(searchParams.get('page'), 1),
      limit: PAGE_SIZES.includes(limit) ? limit : 25,
      sort: SORT_KEYS.has(searchParams.get('sort')) ? searchParams.get('sort') : 'created_at',
      order: searchParams.get('order') === 'asc' ? 'asc' : 'desc',
    };
  }, [searchParams]);

  const [filters, setFilters] = useState(queryFilters);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Sequence-guarded + abortable: rapid filter changes can no longer resolve
  // out of order and clobber the table with stale results.
  const { data: usersData, loading, error, reload } = useAbortableFetch(async (signal) => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ''));
    const { data } = await adminApi.get('/admin/users', { params, signal });
    return data;
  }, [filters]);
  const users = usersData?.users || [];
  const total = usersData?.total || 0;
  const pages = usersData?.pages || 1;
  const summary = usersData?.summary || null;

  useEffect(() => {
    if (usersData) setLastUpdated(new Date());
  }, [usersData]);

  // Selection state for bulk actions
  const [selected, setSelected]       = useState(new Set());
  const [bulkBusy, setBulkBusy]       = useState(false);
  const [toastMsg, setToastMsg]       = useState(null);

  // Modals
  const [showCreate,  setShowCreate]  = useState(false);
  const [msgTarget,   setMsgTarget]   = useState(null);
  const [msgText,     setMsgText]     = useState('');
  const [msgSending,  setMsgSending]  = useState(false);
  const [resetTarget, setResetTarget] = useState(null);

  const showToast = (text, type = 'success') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 4000);
  };

  const fetchUsers = () => reload();

  // Dashboard deep links and browser back/forward navigation are part of the
  // users-page contract. Keep every supported URL filter authoritative without
  // allowing arbitrary values to reach the API.
  useEffect(() => {
    setFilters((current) => {
      const unchanged = Object.keys(queryFilters).every((key) => current[key] === queryFilters[key]);
      return unchanged ? current : queryFilters;
    });
  }, [queryFilters]);

  // Clear selection when page/filters change
  useEffect(() => { setSelected(new Set()); }, [filters]);

  const update = (key, val) => {
    setFilters(f => ({ ...f, [key]: val, page: 1 }));
    const next = new URLSearchParams(searchParams);
    if (val) next.set(key, String(val));
    else next.delete(key);
    if (key !== 'page') next.set('page', '1');
    setSearchParams(next, { replace: true });
  };
  const setPage = (p) => {
    setFilters(f => ({ ...f, page: p }));
    const next = new URLSearchParams(searchParams);
    next.set('page', String(p));
    setSearchParams(next, { replace: true });
  };

  const onSort = (col) => {
    const nextFilters = f => ({
      ...f,
      sort: col,
      order: f.sort === col && f.order === 'desc' ? 'asc' : 'desc',
      page: 1,
    });
    setFilters(nextFilters);
    const next = new URLSearchParams(searchParams);
    const nextState = nextFilters(filters);
    next.set('sort', nextState.sort);
    next.set('order', nextState.order);
    next.set('page', '1');
    setSearchParams(next, { replace: true });
  };

  // Export (note: the server export endpoint ignores query params, so this
  // downloads the full dataset rather than the filtered view)
  const handleExport = async () => {
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ''));
      const res = await adminApi.get('/admin/export/users', { params, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `oxsteed_users_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      showToast('User export failed. Please try again.', 'error');
    }
  };

  // Selection helpers
  const allIds = users.map(u => u.id);
  const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id));
  const someSelected = selected.size > 0;

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(allIds));
  };
  const toggleOne = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Toggle ban (single user) — backend clears admin scheduled deletion when unbanning
  const handleToggleBan = async (user) => {
    try {
      await adminApi.post(`/admin/users/${user.id}/ban`);
      showToast(t('adminUsers.list.userStatusChanged', { name: user.first_name, status: user.is_active ? t('adminUsers.list.suspended').toLowerCase() : t('adminUsers.list.reactivated').toLowerCase() }));
      fetchUsers();
    } catch (err) {
      showToast(err.response?.data?.error || t('adminUsers.list.actionFailed'), 'error');
    }
  };

  const handleCancelPendingDeletion = async (user) => {
    try {
      await adminApi.post(`/admin/users/${user.id}/cancel-pending-deletion`);
      showToast(t('adminUsers.list.pendingDeletionCleared', { name: user.first_name }));
      await fetchUsers();
    } catch (err) {
      showToast(err.response?.data?.error || t('adminUsers.list.cancelDeletionFailed'), 'error');
    }
  };

  // Bulk suspend / reactivate
  const bulkToggleBan = async (suspend) => {
    setBulkBusy(true);
    const ids = [...selected].filter(id => {
      const u = users.find(x => x.id === id);
      return u && (suspend ? u.is_active : !u.is_active);
    });
    let done = 0;
    for (const id of ids) {
      try { await adminApi.post(`/admin/users/${id}/ban`); done++; } catch {}
    }
    setBulkBusy(false);
    setSelected(new Set());
    fetchUsers();
    showToast(t('adminUsers.list.bulkStatusChanged', { count: done, status: suspend ? t('adminUsers.list.suspended').toLowerCase() : t('adminUsers.list.reactivated').toLowerCase() }));
  };

  // Message modal
  const openMessage = (user) => { setMsgTarget(user); setMsgText(''); };
  const closeMessage = () => { setMsgTarget(null); setMsgText(''); };
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!msgText.trim() || !msgTarget) return;
    setMsgSending(true);
    try {
      await adminApi.post(`/admin/super/users/${msgTarget.id}/message`, { content: msgText.trim() });
      showToast(t('adminUsers.list.messageSent', { name: msgTarget.first_name }));
      closeMessage();
    } catch (err) {
      showToast(err.response?.data?.error || t('adminUsers.list.sendFailed'), 'error');
    } finally { setMsgSending(false); }
  };

  return (
    <div className="p-4 sm:p-8">

      {/* ── Toast ── */}
      {toastMsg && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-2xl text-sm font-medium transition-all
          ${toastMsg.type === 'error' ? 'bg-red-900 text-red-200 border border-red-700'
                                      : 'bg-green-900 text-green-200 border border-green-700'}`}>
          {toastMsg.text}
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white">{t('adminUsers.list.title')}</h1>
          <p className="text-gray-400 text-sm mt-0.5">{t('adminUsers.list.matchingFilters', { count: total.toLocaleString() })}</p>
          {lastUpdated && <p className="mt-1 text-xs text-gray-600">{t('adminUsers.list.updated', { time: lastUpdated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) })}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={fetchUsers} disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-700 transition disabled:opacity-50"
            title={t('common.refresh', { defaultValue: 'Refresh' })}
            aria-label={t('common.refresh', { defaultValue: 'Refresh' })}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> {t('adminUsers.list.refresh')}
          </button>
          {isSuper && (
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg transition">
              <UserPlus size={15} /> {t('adminUsers.list.createUser')}
            </button>
          )}
          {(isSuper || canExport) && (
            <button onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-gray-200 text-sm font-medium rounded-lg hover:bg-gray-600 transition">
              <Download size={15} /> {t('adminUsers.list.exportCsv')}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span>{error?.response?.data?.error || error?.message || t('adminUsers.list.unavailable')}</span>
          <button type="button" onClick={fetchUsers} disabled={loading} className="rounded-lg border border-red-400/30 px-3 py-1.5 text-xs font-semibold hover:bg-red-500/10 disabled:opacity-50">{t('adminUsers.list.tryAgain')}</button>
        </div>
      )}

      {/* ── Summary Stats ── */}
      <StatsBar summary={summary} t={t} />

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-2.5 mb-4">
        {/* Search */}
        <div className="relative flex-1 min-w-[13rem]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" placeholder={t('adminUsers.list.searchPlaceholder')}
            value={filters.search} onChange={e => update('search', e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm
                       text-white placeholder-gray-500 focus:outline-none focus:border-orange-500" />
        </div>

        {/* Location */}
        <div className="relative min-w-40">
          <MapPin size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" placeholder={t('adminUsers.list.locationPlaceholder')}
            value={filters.location} onChange={e => update('location', e.target.value)}
            className="w-full pl-8 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm
                       text-white placeholder-gray-500 focus:outline-none focus:border-orange-500" />
        </div>

        {/* Role / Status / Plan dropdowns */}
        {[
          { key: 'role', options: ROLES, label: t('adminUsers.list.allRoles') },
          { key: 'status', options: STATUSES, label: t('adminUsers.list.allStatus') },
          { key: 'plan', options: PLANS, label: t('adminUsers.list.allPlans') },
        ].map(({ key, options, label }) => (
          <select key={key} value={filters[key]} onChange={e => update(key, e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm
                       text-gray-300 focus:outline-none focus:border-orange-500">
            <option value="">{label}</option>
            {options.filter(Boolean).map(o => <option key={o} value={o} className="capitalize">{o}</option>)}
          </select>
        ))}

        {/* Sort by */}
        <select value={filters.sort} onChange={e => onSort(e.target.value)}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm
                     text-gray-300 focus:outline-none focus:border-orange-500">
          {SORT_COLS.map(c => <option key={c.key} value={c.key}>{t('adminUsers.list.sortBy', { label: t(`adminUsers.list.sort.${c.key}`) })}</option>)}
        </select>

        {/* Page size */}
        <select value={filters.limit} onChange={e => update('limit', Number(e.target.value))}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm
                     text-gray-300 focus:outline-none focus:border-orange-500">
          {PAGE_SIZES.map(n => <option key={n} value={n}>{t('adminUsers.list.perPage', { count: n })}</option>)}
        </select>
      </div>

      {/* ── Bulk Actions ── */}
      {someSelected && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2.5 bg-orange-500/10 border border-orange-500/30 rounded-xl">
          <span className="text-orange-300 text-sm font-medium">{t('adminUsers.list.selected', { count: selected.size })}</span>
          <button onClick={() => bulkToggleBan(true)} disabled={bulkBusy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/50 text-red-300 rounded-lg text-xs font-medium hover:bg-red-900 transition disabled:opacity-50">
            <Ban size={12} /> {t('adminUsers.list.suspendSelected')}
          </button>
          <button onClick={() => bulkToggleBan(false)} disabled={bulkBusy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-900/50 text-green-300 rounded-lg text-xs font-medium hover:bg-green-900 transition disabled:opacity-50">
            <CheckCircle size={12} /> {t('adminUsers.list.reactivateSelected')}
          </button>
          <button onClick={() => setSelected(new Set())}
            className="ml-auto text-gray-500 hover:text-gray-300 transition">
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="bg-gray-800 border border-gray-700 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                {/* Checkbox all */}
                <th className="px-4 py-3 w-8">
                  <button onClick={toggleAll}
                    aria-label={allSelected ? t('common.clearSelection', { defaultValue: 'Clear selection' }) : t('common.selectAll', { defaultValue: 'Select all users on this page' })}
                    className="text-gray-400 hover:text-white transition">
                    {allSelected
                      ? <div className="w-4 h-4 rounded bg-orange-500 flex items-center justify-center"><div className="w-2.5 h-0.5 bg-white rounded" /></div>
                      : <div className="w-4 h-4 rounded border border-gray-600" />}
                  </button>
                </th>
                <SortHeader col="first_name" label={t('adminUsers.list.user')} currentSort={filters.sort} currentOrder={filters.order} onSort={onSort} />
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider font-semibold text-gray-400">{t('adminUsers.list.location')}</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider font-semibold text-gray-400">{t('adminUsers.list.role')}</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider font-semibold text-gray-400">{t('adminUsers.list.plan')}</th>
                <SortHeader col="avg_rating" label={t('adminUsers.list.rating')} currentSort={filters.sort} currentOrder={filters.order} onSort={onSort} />
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider font-semibold text-gray-400">{t('adminUsers.list.jobs')}</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider font-semibold text-gray-400">{t('adminUsers.list.verified')}</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider font-semibold text-gray-400">{t('adminUsers.list.status')}</th>
                <SortHeader col="created_at" label={t('adminUsers.list.joined')} currentSort={filters.sort} currentOrder={filters.order} onSort={onSort} />
                <SortHeader col="last_login_at" label={t('adminUsers.list.lastActive')} currentSort={filters.sort} currentOrder={filters.order} onSort={onSort} />
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {loading ? (
                <tr><td colSpan={12} className="px-4 py-12 text-center text-gray-500">{t('adminUsers.list.loading')}</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={12} className="px-4 py-12 text-center text-gray-500">{error ? t('adminUsers.list.unavailable') : t('adminUsers.list.noUsers')}</td></tr>
              ) : users.map(user => {
                const activity = activityInfo(user.last_login_at, t);
                const isSelected = selected.has(user.id);
                return (
                  <tr key={user.id}
                    className={`transition-colors ${isSelected ? 'bg-orange-500/5' : 'hover:bg-gray-700/40'}`}>

                    {/* Checkbox */}
                    <td className="px-4 py-3">
                      <button onClick={() => toggleOne(user.id)} aria-label={isSelected ? `Deselect ${user.first_name} ${user.last_name}` : `Select ${user.first_name} ${user.last_name}`} className="text-gray-400 hover:text-orange-400 transition">
                        {isSelected
                          ? <div className="w-4 h-4 rounded bg-orange-500 flex items-center justify-center"><div className="w-2.5 h-0.5 bg-white rounded" /></div>
                          : <div className="w-4 h-4 rounded border border-gray-600" />}
                      </button>
                    </td>

                    {/* User (avatar + name + email + activity dot) */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="relative flex-shrink-0">
                          <img src={user.avatar_url || '/default-avatar.png'} alt=""
                            className="w-8 h-8 rounded-full object-cover border border-gray-600" />
                          <span title={activity.label}
                            className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-gray-800 ${activity.color}`} />
                        </div>
                        <div className="min-w-0">
                          <Link to={`/admin/users/${user.id}`}
                            className="font-medium text-white text-sm hover:text-orange-300 transition truncate block">
                            {user.first_name} {user.last_name}
                          </Link>
                          <p className="text-xs text-gray-400 truncate">{user.email}</p>
                        </div>
                      </div>
                    </td>

                    {/* Location */}
                    <td className="px-4 py-3">
                      {user.city || user.state ? (
                        <div className="flex items-center gap-1 text-gray-300 text-xs">
                          <MapPin size={11} className="text-gray-500 flex-shrink-0" />
                          <span className="truncate max-w-28">
                            {[user.city, user.state].filter(Boolean).join(', ')}
                          </span>
                        </div>
                      ) : (
                        <span className="text-gray-600 text-xs">-</span>
                      )}
                    </td>

                    {/* Role */}
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium capitalize bg-gray-700 text-gray-300">
                        {user.role?.replace('_', ' ')}
                      </span>
                    </td>

                    {/* Plan */}
                    <td className="px-4 py-3">
                      {user.plan_slug ? (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                          user.plan_slug === 'elite'  ? 'bg-purple-900 text-purple-300' :
                          user.plan_slug === 'pro'    ? 'bg-blue-900   text-blue-300'   :
                          user.plan_slug === 'broker' ? 'bg-indigo-900 text-indigo-300' :
                                                        'bg-gray-700   text-gray-400'
                        }`}>{user.plan_slug}</span>
                      ) : <span className="text-gray-600 text-xs">{t('adminUsers.list.free')}</span>}
                    </td>

                    {/* Rating */}
                    <td className="px-4 py-3">
                      {user.avg_rating ? (
                        <div className="flex items-center gap-1">
                          <Star size={11} className="text-yellow-400 fill-yellow-400" />
                          <span className="text-gray-300 text-xs">{parseFloat(user.avg_rating).toFixed(1)}</span>
                          {user.total_reviews > 0 && (
                            <span className="text-gray-600 text-xs">({user.total_reviews})</span>
                          )}
                        </div>
                      ) : <span className="text-gray-600 text-xs">-</span>}
                    </td>

                    {/* Jobs */}
                    <td className="px-4 py-3 text-gray-300 text-xs whitespace-nowrap">
                      <span title={t('adminUsers.list.posted')}>{user.jobs_posted ?? 0}</span>
                      <span className="text-gray-600 mx-1">/</span>
                      <span title={t('adminUsers.list.completedAsHelper')}>{user.jobs_completed_as_helper ?? 0}</span>
                    </td>

                    {/* Verified badges */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {user.email_verified && (
                          <span title={t('adminUsers.list.emailVerified')} className="text-blue-400">
                            <ShieldCheck size={13} />
                          </span>
                        )}
                        {user.is_identity_verified && (
                          <span title={t('adminUsers.list.idVerified')} className="text-green-400">
                            <Shield size={13} />
                          </span>
                        )}
                        {user.is_background_checked && (
                          <span title={t('adminUsers.list.backgroundChecked')} className="text-purple-400">
                            <Shield size={13} />
                          </span>
                        )}
                        {!user.email_verified && !user.is_identity_verified && !user.is_background_checked && (
                          <span className="text-gray-600 text-xs">-</span>
                        )}
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      {user.deletion_scheduled_at ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-900/50 text-orange-400 border border-orange-500/30" title={`Deletion scheduled: ${adminDate(user.deletion_scheduled_at)}`}>
                          {user.deletion_type === 'self' ? t('adminUsers.list.selfDeleted') : t('adminUsers.list.pendingDeletion')}
                        </span>
                      ) : (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          user.is_active ? 'bg-green-900 text-green-400' : 'bg-red-900 text-red-400'
                        }`}>
                          {user.is_active ? t('adminUsers.list.active') : t('adminUsers.list.suspended')}
                        </span>
                      )}
                    </td>

                    {/* Joined */}
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                      {fmtDate(user.created_at)}
                    </td>

                    {/* Last Active */}
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                      <span title={user.last_login_at ? new Date(user.last_login_at).toLocaleString() : 'Never'}>
                        {user.last_login_at ? fmtRelative(user.last_login_at, t) : <span className="text-gray-600">{t('adminUsers.list.never')}</span>}
                      </span>
                    </td>

                    {/* Quick actions */}
                    <td className="px-3 py-3">
                      <QuickActionsMenu
                        user={user}
                        isSuper={isSuper}
                        canMessage={isSuper || canMessage}
                        onMessage={openMessage}
                        onToggleBan={handleToggleBan}
                        onResetPw={setResetTarget}
                        onRefresh={fetchUsers}
                        onCancelPendingDeletion={handleCancelPendingDeletion}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        {pages > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700">
            <p className="text-xs text-gray-500">
              {t('adminUsers.list.pageSummary', { page: filters.page, pages, count: total.toLocaleString() })}
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(1)} disabled={filters.page <= 1}
                aria-label={t('common.firstPage', { defaultValue: 'First page' })}
                className="px-2 py-1.5 bg-gray-700 text-gray-300 text-xs rounded-lg disabled:opacity-40 hover:bg-gray-600 transition">«</button>
              <button onClick={() => setPage(Math.max(1, filters.page - 1))} disabled={filters.page <= 1}
                aria-label={t('common.previous', { defaultValue: 'Previous page' })}
                className="px-3 py-1.5 bg-gray-700 text-gray-300 text-xs rounded-lg disabled:opacity-40 hover:bg-gray-600 transition">{t('adminUsers.list.previous')}</button>

              {/* Page number pills */}
              {Array.from({ length: Math.min(5, pages) }, (_, i) => {
                let p;
                if (pages <= 5) p = i + 1;
                else if (filters.page <= 3) p = i + 1;
                else if (filters.page >= pages - 2) p = pages - 4 + i;
                else p = filters.page - 2 + i;
                return (
                  <button key={p} onClick={() => setPage(p)}
                    aria-label={`Page ${p}`}
                    aria-current={p === filters.page ? 'page' : undefined}
                    className={`px-3 py-1.5 text-xs rounded-lg transition ${
                      p === filters.page
                        ? 'bg-orange-500 text-white font-semibold'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}>{p}</button>
                );
              })}

              <button onClick={() => setPage(Math.min(pages, filters.page + 1))} disabled={filters.page >= pages}
                aria-label={t('common.next', { defaultValue: 'Next page' })}
                className="px-3 py-1.5 bg-gray-700 text-gray-300 text-xs rounded-lg disabled:opacity-40 hover:bg-gray-600 transition">{t('adminUsers.list.next')}</button>
              <button onClick={() => setPage(pages)} disabled={filters.page >= pages}
                aria-label={t('common.lastPage', { defaultValue: 'Last page' })}
                className="px-2 py-1.5 bg-gray-700 text-gray-300 text-xs rounded-lg disabled:opacity-40 hover:bg-gray-600 transition">»</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Message modal ── */}
      {msgTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="font-semibold text-white flex items-center gap-2 text-sm">
                <MessageSquare size={15} className="text-blue-400" /> {t('adminUsers.list.messageTitle', { name: msgTarget.first_name })}
              </h2>
              <button onClick={closeMessage} aria-label={t('common.close', { defaultValue: 'Close' })} className="text-gray-500 hover:text-white transition p-1"><X size={15} aria-hidden="true" /></button>
            </div>
            <form onSubmit={handleSendMessage} className="p-5">
              <p className="text-xs text-gray-400 mb-3">
                {t('adminUsers.list.messageAudit', { name: msgTarget.first_name })}
              </p>
              <textarea autoFocus required rows={5} maxLength={4000} value={msgText}
                onChange={e => setMsgText(e.target.value)}
                placeholder={t('adminUsers.list.messagePlaceholder', { name: msgTarget.first_name })}
                className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm
                           text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none" />
              <div className="flex justify-between items-center mt-4">
                <span className="text-xs text-gray-500">{msgText.length} / 4000</span>
                <div className="flex gap-2">
                  <button type="button" onClick={closeMessage} disabled={msgSending}
                    className="px-4 py-2 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-50 transition">
                    {t('adminUsers.list.cancel')}
                  </button>
                  <button type="submit" disabled={msgSending || !msgText.trim()}
                    className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition font-medium">
                    {msgSending ? t('adminUsers.list.sending') : t('adminUsers.list.sendMessage')}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Reset password modal ── */}
      {resetTarget && (
        <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} />
      )}

      {/* ── Create user modal ── */}
      {isSuper && showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={(newUser) => {
            setShowCreate(false);
            // Re-fetch so the new user appears through the same guarded path.
            fetchUsers();
          }}
        />
      )}
    </div>
  );
}
