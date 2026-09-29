import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, Download, UserPlus, X, MessageSquare, MoreHorizontal,
  ChevronUp, ChevronDown, Shield, ShieldCheck, MapPin, Star,
  Ban, CheckCircle, Key, Eye, RotateCcw,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';

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

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function activityInfo(lastLoginAt) {
  if (!lastLoginAt) return { color: 'bg-gray-600', label: 'Never logged in', key: 'never' };
  const diffH = (Date.now() - new Date(lastLoginAt)) / 3_600_000;
  if (diffH < 1)   return { color: 'bg-green-400',  label: 'Online recently',      key: 'online'   };
  if (diffH < 168) return { color: 'bg-yellow-400', label: 'Active this week',     key: 'recent'   };
  if (diffH < 720) return { color: 'bg-gray-400',   label: 'Active this month',    key: 'moderate' };
  return               { color: 'bg-red-500',    label: 'Inactive 30+ days',    key: 'inactive' };
}

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

function fmtRelative(d) {
  if (!d) return '-';
  const diffH = (Date.now() - new Date(d)) / 3_600_000;
  if (diffH < 1)   return 'Just now';
  if (diffH < 24)  return `${Math.floor(diffH)}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7)   return `${diffD}d ago`;
  if (diffD < 30)  return `${Math.floor(diffD / 7)}w ago`;
  if (diffD < 365) return `${Math.floor(diffD / 30)}mo ago`;
  return `${Math.floor(diffD / 365)}y ago`;
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
      setError(err.response?.data?.error || 'Failed to create user.');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={() => !busy && onClose()}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-white text-base">Create User Account</h3>
          <button onClick={onClose} disabled={busy} className="text-gray-500 hover:text-white transition"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[['first_name', 'First Name'], ['last_name', 'Last Name']].map(([k, label]) => (
              <div key={k}>
                <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
                <input required value={form[k]} onChange={e => set(k, e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm
                             text-white placeholder-gray-500 focus:outline-none focus:border-orange-500" />
              </div>
            ))}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Email</label>
            <input type="email" required value={form.email} onChange={e => set('email', e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm
                         text-white placeholder-gray-500 focus:outline-none focus:border-orange-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Password <span className="text-gray-600">(min 8 chars)</span></label>
            <input type="password" required minLength={8} value={form.password} onChange={e => set('password', e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm
                         text-white placeholder-gray-500 focus:outline-none focus:border-orange-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Account type</label>
            <select value={form.account_type} onChange={e => set('account_type', e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm
                         text-gray-300 focus:outline-none focus:border-orange-500">
              {QUICK_CREATE_ACCOUNT_TYPES.map((accountType) => (
                <option key={accountType.value} value={accountType.value}>
                  {accountType.label}
                </option>
              ))}
            </select>
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={busy}
              className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 text-gray-300
                         rounded-lg text-sm font-medium hover:bg-gray-700 transition disabled:opacity-50">
              Cancel
            </button>
            <button type="submit" disabled={busy}
              className="flex-1 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white
                         rounded-lg text-sm font-semibold transition disabled:opacity-50">
              {busy ? 'Creating…' : 'Create User'}
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
      setErr(error.response?.data?.error || 'Failed to reset password.');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={() => !busy && onClose()}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-white text-sm flex items-center gap-2">
            <Key size={15} className="text-orange-400" /> Reset Password
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition"><X size={16} /></button>
        </div>
        {done ? (
          <div className="text-center py-4">
            <CheckCircle size={32} className="text-green-400 mx-auto mb-2" />
            <p className="text-white text-sm font-medium">Password reset successfully.</p>
            <p className="text-gray-400 text-xs mt-1">All sessions for {user.first_name} have been invalidated.</p>
            <button onClick={onClose} className="mt-4 px-4 py-2 bg-gray-700 text-gray-200 rounded-lg text-sm hover:bg-gray-600 transition">Close</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-gray-400 text-xs">Setting a new password for <span className="text-white font-medium">{user.first_name} {user.last_name}</span>. Their active sessions will be invalidated.</p>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">New Password <span className="text-gray-600">(min 8 chars)</span></label>
              <input type="password" required minLength={8} value={pw} onChange={e => setPw(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm
                           text-white focus:outline-none focus:border-orange-500" />
            </div>
            {err && <p className="text-red-400 text-xs">{err}</p>}
            <div className="flex gap-3">
              <button type="button" onClick={onClose} disabled={busy}
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 text-gray-300 rounded-lg text-sm hover:bg-gray-700 transition disabled:opacity-50">
                Cancel
              </button>
              <button type="submit" disabled={busy || pw.length < 8}
                className="flex-1 px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50">
                {busy ? 'Resetting…' : 'Reset'}
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
function QuickActionsMenu({ user, isSuper, onMessage, onToggleBan, onResetPw, onRefresh, onCancelPendingDeletion }) {
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
        className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-700 transition disabled:opacity-40">
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-40 w-48 bg-gray-900 border border-gray-700
                        rounded-xl shadow-2xl overflow-hidden py-1">
          <Link to={`/admin/users/${user.id}`} onClick={() => setOpen(false)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left rounded-lg
                       text-gray-300 hover:bg-gray-700 transition">
            <Eye size={13} /> View profile
          </Link>
          <button onClick={() => { setOpen(false); onMessage(user); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left rounded-lg text-gray-300 hover:bg-gray-700 transition">
            <MessageSquare size={13} /> Send message
          </button>
          <div className="border-t border-gray-800 my-1" />
          {isSuper && user.deletion_scheduled_at && user.deletion_type !== 'self' && (
            <button
              type="button"
              onClick={async () => {
                setOpen(false);
                if (!window.confirm(`Cancel pending deletion for ${user.email}? They will show as Active again.`)) return;
                setBusy(true);
                try {
                  await onCancelPendingDeletion(user);
                } finally {
                  setBusy(false);
                }
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left rounded-lg text-orange-300 hover:bg-orange-900/25 transition"
            >
              <RotateCcw size={13} /> Cancel pending deletion
            </button>
          )}
          <button onClick={doToggleBan}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left rounded-lg transition
              ${user.is_active ? 'text-red-400 hover:bg-red-900/30' : 'text-green-400 hover:bg-green-900/30'}`}>
            {user.is_active ? <><Ban size={13} /> Suspend account</> : <><CheckCircle size={13} /> Reactivate account</>}
          </button>
          {isSuper && (
            <button onClick={() => { setOpen(false); onResetPw(user); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left rounded-lg text-orange-400 hover:bg-orange-900/20 transition">
              <Key size={13} /> Reset password
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
function StatsBar({ summary }) {
  if (!summary) return null;
  const stats = [
    { label: 'Total Users',    value: Number(summary.total).toLocaleString(),        color: 'text-white'         },
    { label: 'Active',         value: Number(summary.active).toLocaleString(),        color: 'text-green-400'     },
    { label: 'Suspended',      value: Number(summary.suspended).toLocaleString(),     color: 'text-red-400'       },
    { label: 'Helpers',        value: Number(summary.helpers).toLocaleString(),       color: 'text-orange-400'    },
    { label: 'Customers',      value: Number(summary.customers).toLocaleString(),     color: 'text-blue-400'      },
    { label: 'New This Week',  value: Number(summary.new_this_week).toLocaleString(), color: 'text-purple-400'    },
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
  const isSuper       = me?.role === 'super_admin';

  const [filters, setFilters] = useState({
    search: '', role: '', status: '', plan: '', location: '',
    page: 1, limit: 25, sort: 'created_at', order: 'desc',
  });
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

  // Clear selection when page/filters change
  useEffect(() => { setSelected(new Set()); }, [filters]);

  const update = (key, val) => setFilters(f => ({ ...f, [key]: val, page: 1 }));
  const setPage = (p) => setFilters(f => ({ ...f, page: p }));

  const onSort = (col) => {
    setFilters(f => ({
      ...f,
      sort: col,
      order: f.sort === col && f.order === 'desc' ? 'asc' : 'desc',
      page: 1,
    }));
  };

  // Export (respects current filters)
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
    } catch (err) { console.error(err); }
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
      showToast(`${user.first_name} ${user.is_active ? 'suspended' : 'reactivated'}.`);
      fetchUsers();
    } catch (err) {
      showToast(err.response?.data?.error || 'Action failed.', 'error');
    }
  };

  const handleCancelPendingDeletion = async (user) => {
    try {
      await adminApi.post(`/admin/users/${user.id}/cancel-pending-deletion`);
      showToast(`Pending deletion cleared for ${user.first_name}.`);
      await fetchUsers();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to cancel pending deletion.', 'error');
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
    showToast(`${done} user(s) ${suspend ? 'suspended' : 'reactivated'}.`);
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
      showToast(`Message sent to ${msgTarget.first_name}.`);
      closeMessage();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to send.', 'error');
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
          <h1 className="text-2xl font-bold text-white">Users</h1>
          <p className="text-gray-400 text-sm mt-0.5">{total.toLocaleString()} users matching current filters</p>
          {lastUpdated && <p className="mt-1 text-xs text-gray-600">Updated {lastUpdated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={fetchUsers} disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-700 transition disabled:opacity-50"
            title="Refresh users">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          {isSuper && (
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg transition">
              <UserPlus size={15} /> Create User
            </button>
          )}
          {isSuper && (
            <button onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-gray-200 text-sm font-medium rounded-lg hover:bg-gray-600 transition">
              <Download size={15} /> Export CSV
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span>{error?.response?.data?.error || error?.message || 'Could not load users.'}</span>
          <button type="button" onClick={fetchUsers} disabled={loading} className="rounded-lg border border-red-400/30 px-3 py-1.5 text-xs font-semibold hover:bg-red-500/10 disabled:opacity-50">Try again</button>
        </div>
      )}

      {/* ── Summary Stats ── */}
      <StatsBar summary={summary} />

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-2.5 mb-4">
        {/* Search */}
        <div className="relative flex-1 min-w-52">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" placeholder="Search name, email, phone..."
            value={filters.search} onChange={e => update('search', e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm
                       text-white placeholder-gray-500 focus:outline-none focus:border-orange-500" />
        </div>

        {/* Location */}
        <div className="relative min-w-40">
          <MapPin size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" placeholder="City, state, zip..."
            value={filters.location} onChange={e => update('location', e.target.value)}
            className="w-full pl-8 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm
                       text-white placeholder-gray-500 focus:outline-none focus:border-orange-500" />
        </div>

        {/* Role / Status / Plan dropdowns */}
        {[
          { key: 'role',   options: ROLES,    label: 'All Roles'   },
          { key: 'status', options: STATUSES, label: 'All Status'  },
          { key: 'plan',   options: PLANS,    label: 'All Plans'   },
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
          {SORT_COLS.map(c => <option key={c.key} value={c.key}>Sort: {c.label}</option>)}
        </select>

        {/* Page size */}
        <select value={filters.limit} onChange={e => setFilters(f => ({ ...f, limit: Number(e.target.value), page: 1 }))}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm
                     text-gray-300 focus:outline-none focus:border-orange-500">
          {PAGE_SIZES.map(n => <option key={n} value={n}>{n} / page</option>)}
        </select>
      </div>

      {/* ── Bulk Actions ── */}
      {someSelected && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2.5 bg-orange-500/10 border border-orange-500/30 rounded-xl">
          <span className="text-orange-300 text-sm font-medium">{selected.size} selected</span>
          <button onClick={() => bulkToggleBan(true)} disabled={bulkBusy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/50 text-red-300 rounded-lg text-xs font-medium hover:bg-red-900 transition disabled:opacity-50">
            <Ban size={12} /> Suspend selected
          </button>
          <button onClick={() => bulkToggleBan(false)} disabled={bulkBusy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-900/50 text-green-300 rounded-lg text-xs font-medium hover:bg-green-900 transition disabled:opacity-50">
            <CheckCircle size={12} /> Reactivate selected
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
                    className="text-gray-400 hover:text-white transition">
                    {allSelected
                      ? <div className="w-4 h-4 rounded bg-orange-500 flex items-center justify-center"><div className="w-2.5 h-0.5 bg-white rounded" /></div>
                      : <div className="w-4 h-4 rounded border border-gray-600" />}
                  </button>
                </th>
                <SortHeader col="first_name"    label="User"        currentSort={filters.sort} currentOrder={filters.order} onSort={onSort} />
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider font-semibold text-gray-400">Location</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider font-semibold text-gray-400">Role</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider font-semibold text-gray-400">Plan</th>
                <SortHeader col="avg_rating"    label="Rating"      currentSort={filters.sort} currentOrder={filters.order} onSort={onSort} />
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider font-semibold text-gray-400">Jobs</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider font-semibold text-gray-400">Verified</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider font-semibold text-gray-400">Status</th>
                <SortHeader col="created_at"    label="Joined"      currentSort={filters.sort} currentOrder={filters.order} onSort={onSort} />
                <SortHeader col="last_login_at" label="Last Active"  currentSort={filters.sort} currentOrder={filters.order} onSort={onSort} />
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {loading ? (
                <tr><td colSpan={12} className="px-4 py-12 text-center text-gray-500">Loading…</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={12} className="px-4 py-12 text-center text-gray-500">{error ? 'User data is unavailable.' : 'No users found.'}</td></tr>
              ) : users.map(user => {
                const activity = activityInfo(user.last_login_at);
                const isSelected = selected.has(user.id);
                return (
                  <tr key={user.id}
                    className={`transition-colors ${isSelected ? 'bg-orange-500/5' : 'hover:bg-gray-750'}`}>

                    {/* Checkbox */}
                    <td className="px-4 py-3">
                      <button onClick={() => toggleOne(user.id)} className="text-gray-400 hover:text-orange-400 transition">
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
                      ) : <span className="text-gray-600 text-xs">Free</span>}
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
                      <span title="Posted">{user.jobs_posted ?? 0}</span>
                      <span className="text-gray-600 mx-1">/</span>
                      <span title="Completed as helper">{user.jobs_completed_as_helper ?? 0}</span>
                    </td>

                    {/* Verified badges */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {user.email_verified && (
                          <span title="Email verified" className="text-blue-400">
                            <ShieldCheck size={13} />
                          </span>
                        )}
                        {user.is_identity_verified && (
                          <span title="ID verified" className="text-green-400">
                            <Shield size={13} />
                          </span>
                        )}
                        {user.is_background_checked && (
                          <span title="Background checked" className="text-purple-400">
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
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-900/50 text-orange-400 border border-orange-500/30" title={`Deletion scheduled: ${new Date(user.deletion_scheduled_at).toLocaleDateString()}`}>
                          {user.deletion_type === 'self' ? 'Self-deleted' : 'Pending deletion'}
                        </span>
                      ) : (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          user.is_active ? 'bg-green-900 text-green-400' : 'bg-red-900 text-red-400'
                        }`}>
                          {user.is_active ? 'Active' : 'Suspended'}
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
                        {user.last_login_at ? fmtRelative(user.last_login_at) : <span className="text-gray-600">Never</span>}
                      </span>
                    </td>

                    {/* Quick actions */}
                    <td className="px-3 py-3">
                      <QuickActionsMenu
                        user={user}
                        isSuper={isSuper}
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
              Page {filters.page} of {pages} &nbsp;·&nbsp; {total.toLocaleString()} results
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(1)} disabled={filters.page <= 1}
                className="px-2 py-1.5 bg-gray-700 text-gray-300 text-xs rounded-lg disabled:opacity-40 hover:bg-gray-600 transition">«</button>
              <button onClick={() => setPage(Math.max(1, filters.page - 1))} disabled={filters.page <= 1}
                className="px-3 py-1.5 bg-gray-700 text-gray-300 text-xs rounded-lg disabled:opacity-40 hover:bg-gray-600 transition">← Prev</button>

              {/* Page number pills */}
              {Array.from({ length: Math.min(5, pages) }, (_, i) => {
                let p;
                if (pages <= 5) p = i + 1;
                else if (filters.page <= 3) p = i + 1;
                else if (filters.page >= pages - 2) p = pages - 4 + i;
                else p = filters.page - 2 + i;
                return (
                  <button key={p} onClick={() => setPage(p)}
                    className={`px-3 py-1.5 text-xs rounded-lg transition ${
                      p === filters.page
                        ? 'bg-orange-500 text-white font-semibold'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}>{p}</button>
                );
              })}

              <button onClick={() => setPage(Math.min(pages, filters.page + 1))} disabled={filters.page >= pages}
                className="px-3 py-1.5 bg-gray-700 text-gray-300 text-xs rounded-lg disabled:opacity-40 hover:bg-gray-600 transition">Next →</button>
              <button onClick={() => setPage(pages)} disabled={filters.page >= pages}
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
                <MessageSquare size={15} className="text-blue-400" /> Message {msgTarget.first_name}
              </h2>
              <button onClick={closeMessage} className="text-gray-500 hover:text-white transition p-1"><X size={15} /></button>
            </div>
            <form onSubmit={handleSendMessage} className="p-5">
              <p className="text-xs text-gray-400 mb-3">
                This message will appear in {msgTarget.first_name}'s inbox as a system message and is logged in the audit trail.
              </p>
              <textarea autoFocus required rows={5} maxLength={4000} value={msgText}
                onChange={e => setMsgText(e.target.value)}
                placeholder={`Write a message to ${msgTarget.first_name}…`}
                className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm
                           text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none" />
              <div className="flex justify-between items-center mt-4">
                <span className="text-xs text-gray-500">{msgText.length} / 4000</span>
                <div className="flex gap-2">
                  <button type="button" onClick={closeMessage} disabled={msgSending}
                    className="px-4 py-2 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-50 transition">
                    Cancel
                  </button>
                  <button type="submit" disabled={msgSending || !msgText.trim()}
                    className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition font-medium">
                    {msgSending ? 'Sending…' : 'Send Message'}
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
