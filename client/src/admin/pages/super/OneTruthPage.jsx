import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Building2, AlertTriangle, Search, RefreshCw,
  ChevronLeft, ChevronRight, Eye, Shield, Zap,
  CheckCircle, XCircle, Clock, Fingerprint, Smartphone,
  Phone, Hash, GitBranch, UserX, Info,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL?.replace(/\/$/, '') || '';

async function apiFetch(path) {
  const token = localStorage.getItem('accessToken');
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── signal metadata ────────────────────────────────────────────────────────
const SIGNAL_META = {
  same_phone:         { icon: Phone,       color: 'text-red-400',    bg: 'bg-red-400/10 border-red-400/30' },
  same_ip:            { icon: Hash,        color: 'text-red-400',    bg: 'bg-red-400/10 border-red-400/30' },
  same_ip_hash:       { icon: Hash,        color: 'text-orange-400', bg: 'bg-orange-400/10 border-orange-400/30' },
  same_name:          { icon: Users,       color: 'text-yellow-400', bg: 'bg-yellow-400/10 border-yellow-400/30' },
  same_device_terms:  { icon: Smartphone,  color: 'text-orange-400', bg: 'bg-orange-400/10 border-orange-400/30' },
  same_didit_hash:    { icon: Fingerprint, color: 'text-red-500',    bg: 'bg-red-500/10 border-red-500/30' },
  same_referral:      { icon: GitBranch,   color: 'text-blue-400',   bg: 'bg-blue-400/10 border-blue-400/30' },
  close_created:      { icon: Clock,       color: 'text-yellow-400', bg: 'bg-yellow-400/10 border-yellow-400/30' },
};

function scoreColor(score) {
  if (score >= 6) return 'text-red-400';
  if (score >= 4) return 'text-orange-400';
  return 'text-yellow-400';
}

function scoreBg(score) {
  if (score >= 6) return 'bg-red-400/10 border-red-400/40';
  if (score >= 4) return 'bg-orange-400/10 border-orange-400/40';
  return 'bg-yellow-400/10 border-yellow-400/40';
}

function riskLabel(score) {
  if (score >= 6) return 'High Risk';
  if (score >= 4) return 'Medium Risk';
  return 'Low Risk';
}

// ─── sub-components ─────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, color = 'text-white' }) {
  return (
    <div className="bg-[#111318] border border-gray-800 rounded-2xl p-5 flex items-center gap-4">
      <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5 text-gray-400" />
      </div>
      <div>
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
        <p className={`text-2xl font-bold ${color}`}>{value ?? '—'}</p>
      </div>
    </div>
  );
}

function Pagination({ page, totalPages, onPage }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 mt-6">
      <button
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        className="p-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white disabled:opacity-30 transition"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="text-sm text-gray-400">Page {page} of {totalPages}</span>
      <button
        onClick={() => onPage(page + 1)}
        disabled={page >= totalPages}
        className="p-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white disabled:opacity-30 transition"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

function UserMiniCard({ user, onClick }) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Unknown';
  const bizCount = user.businesses?.length ?? user.business_count ?? 0;
  const status = user.is_banned ? 'banned' : (!user.is_active ? 'inactive' : 'active');
  const statusColors = { active: 'text-emerald-400', inactive: 'text-yellow-400', banned: 'text-red-400' };

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-gray-900/60 border border-gray-700 rounded-xl p-4 hover:border-gray-500 transition group"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-sm truncate group-hover:text-orange-400 transition">{name}</p>
          <p className="text-gray-400 text-xs truncate">{user.email}</p>
          {(user.city || user.state) && (
            <p className="text-gray-500 text-xs mt-0.5">{[user.city, user.state].filter(Boolean).join(', ')}</p>
          )}
        </div>
        <span className={`text-xs font-semibold shrink-0 ${statusColors[status]}`}>
          {status}
        </span>
      </div>
      <div className="flex items-center gap-3 mt-2">
        <span className="text-xs text-gray-500 flex items-center gap-1">
          <Building2 className="w-3 h-3" />
          {bizCount} {bizCount === 1 ? 'business' : 'businesses'}
        </span>
        <span className="text-xs text-gray-600">
          Joined {new Date(user.created_at).toLocaleDateString()}
        </span>
      </div>
      {user.businesses?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {user.businesses.slice(0, 3).map(b => (
            <span key={b.id} className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded-full truncate max-w-[120px]">
              {b.business_name}
            </span>
          ))}
          {user.businesses.length > 3 && (
            <span className="text-xs text-gray-500">+{user.businesses.length - 3} more</span>
          )}
        </div>
      )}
    </button>
  );
}

function SignalBadge({ signal }) {
  const meta = SIGNAL_META[signal.type] || { icon: AlertTriangle, color: 'text-gray-400', bg: 'bg-gray-800 border-gray-600' };
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${meta.bg} ${meta.color}`}>
      <Icon className="w-3 h-3" />
      {signal.label}
      <span className="opacity-60">×{signal.weight}</span>
    </span>
  );
}

function SuspectPairCard({ pair, onViewUser }) {
  const [expanded, setExpanded] = useState(false);
  const { userA, userB, signals, score } = pair;

  return (
    <div className={`border rounded-2xl overflow-hidden transition ${scoreBg(score)}`}>
      {/* Header */}
      <div
        className="flex items-center justify-between gap-4 p-4 cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-3">
          <div className={`flex items-center justify-center w-10 h-10 rounded-xl font-bold text-sm border ${scoreBg(score)} ${scoreColor(score)}`}>
            {score}
          </div>
          <div>
            <p className={`font-semibold text-sm ${scoreColor(score)}`}>{riskLabel(score)}</p>
            <p className="text-xs text-gray-400">{signals.length} signal{signals.length !== 1 ? 's' : ''} detected</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="hidden sm:inline">
            {[userA.first_name, userA.last_name].filter(Boolean).join(' ') || userA.email}
            {' '}⟷{' '}
            {[userB.first_name, userB.last_name].filter(Boolean).join(' ') || userB.email}
          </span>
          <ChevronRight className={`w-4 h-4 transition ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </div>

      {expanded && (
        <div className="border-t border-white/5 p-4 space-y-4">
          {/* Signals */}
          <div>
            <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-2">Signals</p>
            <div className="flex flex-wrap gap-2">
              {signals.map((s, i) => <SignalBadge key={i} signal={s} />)}
            </div>
          </div>

          {/* Users side by side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <UserMiniCard user={userA} onClick={() => onViewUser(userA.id)} />
            <UserMiniCard user={userB} onClick={() => onViewUser(userB.id)} />
          </div>

          <div className="text-xs text-gray-600 flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Click a user card to open their full profile in the admin user detail page.
            To enforce the one-account policy, you can ban or deactivate one of the accounts there.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── main page ───────────────────────────────────────────────────────────────

const TABS = [
  { id: 'suspects', label: 'Flagged Pairs', icon: AlertTriangle },
  { id: 'users',    label: 'All Users',     icon: Users },
];

export default function OneTruthPage() {
  const navigate = useNavigate();

  // Stats
  const [stats, setStats]         = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Active tab
  const [tab, setTab] = useState('suspects');

  // Suspects
  const [suspects, setSuspects]   = useState([]);
  const [suspectTotal, setSuspectTotal] = useState(0);
  const [suspectPage, setSuspectPage]   = useState(1);
  const [suspectPages, setSuspectPages] = useState(1);
  const [suspectLoading, setSuspectLoading] = useState(false);
  const [suspectError, setSuspectError]     = useState('');

  // Users
  const [users, setUsers]         = useState([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userPage, setUserPage]   = useState(1);
  const [userPages, setUserPages] = useState(1);
  const [userSearch, setUserSearch] = useState('');
  const [userSearchInput, setUserSearchInput] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError]     = useState('');

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const data = await apiFetch('/api/admin/one-truth/stats');
      setStats(data);
    } catch {
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const loadSuspects = useCallback(async (page = 1) => {
    setSuspectLoading(true);
    setSuspectError('');
    try {
      const data = await apiFetch(`/api/admin/one-truth/suspects?page=${page}&limit=20`);
      setSuspects(data.pairs);
      setSuspectTotal(data.total);
      setSuspectPage(data.page);
      setSuspectPages(data.totalPages);
    } catch (err) {
      setSuspectError(err.message);
    } finally {
      setSuspectLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async (page = 1, search = '') => {
    setUsersLoading(true);
    setUsersError('');
    try {
      const qs = new URLSearchParams({ page, limit: 25, ...(search ? { search } : {}) });
      const data = await apiFetch(`/api/admin/one-truth/users?${qs}`);
      setUsers(data.users);
      setUserTotal(data.total);
      setUserPage(data.page);
      setUserPages(data.totalPages);
    } catch (err) {
      setUsersError(err.message);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  useEffect(() => {
    if (tab === 'suspects') loadSuspects(1);
    if (tab === 'users')    loadUsers(1, userSearch);
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUserSearch = (e) => {
    e.preventDefault();
    setUserSearch(userSearchInput);
    loadUsers(1, userSearchInput);
  };

  const handleViewUser = (userId) => {
    navigate(`/admin/users/${userId}`);
  };

  return (
    <div className="min-h-screen bg-[#0b0d11] text-white px-4 sm:px-6 py-6 space-y-6">

      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-orange-500/15 border border-orange-500/30 flex items-center justify-center">
              <Shield className="w-5 h-5 text-orange-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">One Truth</h1>
          </div>
          <p className="text-sm text-gray-400 max-w-lg">
            One account per person. Review the user–business graph and investigate
            accounts that may violate the single-account policy.
          </p>
        </div>
        <button
          onClick={() => { loadStats(); if (tab === 'suspects') loadSuspects(suspectPage); else loadUsers(userPage, userSearch); }}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white border border-gray-700 rounded-xl px-3 py-2 transition"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={Users}     label="Total Users"          value={statsLoading ? '…' : stats?.totalUsers} />
        <StatCard icon={Building2} label="Total Businesses"     value={statsLoading ? '…' : stats?.totalBusinesses} />
        <StatCard icon={Building2} label="Multi-biz Users"      value={statsLoading ? '…' : stats?.usersWithMultipleBusinesses} color="text-blue-400" />
        <StatCard icon={XCircle}   label="Inactive Users"       value={statsLoading ? '…' : stats?.inactiveUsers} color="text-yellow-400" />
        <StatCard icon={UserX}     label="Banned Users"         value={statsLoading ? '…' : stats?.bannedUsers} color="text-red-400" />
        <StatCard icon={AlertTriangle} label="Flagged Pairs"    value={suspectLoading ? '…' : suspectTotal} color="text-orange-400" />
      </div>

      {/* Policy callout */}
      <div className="flex items-start gap-3 bg-orange-500/5 border border-orange-500/20 rounded-2xl p-4">
        <Zap className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
        <div className="text-sm text-gray-300">
          <strong className="text-white">OxSteed Policy:</strong> Each person may hold only one account.
          They may create multiple businesses under that single account, but registering a second personal account is a policy violation.
          Use this page to identify and investigate suspected duplicate accounts.
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition ${
              tab === t.id
                ? 'border-orange-500 text-orange-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            {t.id === 'suspects' && suspectTotal > 0 && (
              <span className="ml-1 bg-orange-500/20 text-orange-400 text-xs font-bold px-1.5 py-0.5 rounded-full">
                {suspectTotal}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Suspects tab ── */}
      {tab === 'suspects' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">
              {suspectLoading ? 'Scanning for duplicate signals…' : `${suspectTotal} suspected duplicate pair${suspectTotal !== 1 ? 's' : ''} found`}
            </p>
          </div>

          {/* Score legend */}
          <div className="flex flex-wrap gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block"></span> Low risk (score 2–3)</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block"></span> Medium risk (score 4–5)</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block"></span> High risk (score 6+)</span>
          </div>

          {suspectLoading && (
            <div className="py-12 text-center text-gray-500">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3" />
              Running duplicate detection…
            </div>
          )}

          {!suspectLoading && suspectError && (
            <div className="py-8 text-center text-red-400 bg-red-400/5 border border-red-400/20 rounded-2xl">
              {suspectError}
            </div>
          )}

          {!suspectLoading && !suspectError && suspects.length === 0 && (
            <div className="py-12 text-center bg-emerald-500/5 border border-emerald-500/20 rounded-2xl">
              <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-3" />
              <p className="text-emerald-400 font-semibold">No suspected duplicates found</p>
              <p className="text-gray-500 text-sm mt-1">All accounts appear distinct based on available signals.</p>
            </div>
          )}

          {!suspectLoading && suspects.map(pair => (
            <SuspectPairCard key={pair.id} pair={pair} onViewUser={handleViewUser} />
          ))}

          <Pagination page={suspectPage} totalPages={suspectPages} onPage={(p) => loadSuspects(p)} />
        </div>
      )}

      {/* ── Users tab ── */}
      {tab === 'users' && (
        <div className="space-y-4">
          {/* Search */}
          <form onSubmit={handleUserSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                value={userSearchInput}
                onChange={e => setUserSearchInput(e.target.value)}
                placeholder="Search by name or email…"
                className="w-full pl-9 pr-4 py-2.5 bg-gray-900 border border-gray-700 rounded-xl text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-orange-500 transition"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-xl transition"
            >
              Search
            </button>
          </form>

          <p className="text-sm text-gray-500">
            {usersLoading ? 'Loading…' : `${userTotal.toLocaleString()} user${userTotal !== 1 ? 's' : ''}`}
          </p>

          {usersLoading && (
            <div className="py-12 text-center text-gray-500">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
              Loading users…
            </div>
          )}

          {!usersLoading && usersError && (
            <div className="py-8 text-center text-red-400 bg-red-400/5 border border-red-400/20 rounded-2xl">
              {usersError}
            </div>
          )}

          {!usersLoading && !usersError && users.length === 0 && (
            <div className="py-10 text-center text-gray-500">No users found.</div>
          )}

          {!usersLoading && !usersError && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {users.map(u => (
                <UserCard key={u.id} user={u} onView={() => handleViewUser(u.id)} />
              ))}
            </div>
          )}

          <Pagination page={userPage} totalPages={userPages} onPage={p => loadUsers(p, userSearch)} />
        </div>
      )}
    </div>
  );
}

// Full user card for the all-users tab
function UserCard({ user, onView }) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Unknown';
  const bizCount = parseInt(user.business_count ?? user.businesses?.length ?? 0);
  const isActive = user.is_active !== false;
  const isBanned = user.is_banned === true;

  return (
    <div className="bg-[#111318] border border-gray-800 rounded-2xl p-4 hover:border-gray-600 transition">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-sm truncate">{name}</p>
          <p className="text-gray-400 text-xs truncate">{user.email}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {isBanned && (
            <span className="text-xs bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full font-medium">Banned</span>
          )}
          {!isBanned && !isActive && (
            <span className="text-xs bg-yellow-500/15 text-yellow-400 px-2 py-0.5 rounded-full font-medium">Inactive</span>
          )}
          {!isBanned && isActive && (
            <span className="text-xs bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-full font-medium">Active</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs text-gray-500 mb-3">
        <span className="flex items-center gap-1">
          <Building2 className="w-3.5 h-3.5" />
          {bizCount} {bizCount === 1 ? 'business' : 'businesses'}
        </span>
        <span>{user.role || 'customer'}</span>
        <span>{new Date(user.created_at).toLocaleDateString()}</span>
      </div>

      {user.businesses?.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {user.businesses.slice(0, 4).map(b => (
            <span
              key={b.id}
              className={`text-xs px-2 py-0.5 rounded-full border ${
                b.is_active
                  ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                  : 'bg-gray-800 border-gray-700 text-gray-500 line-through'
              } truncate max-w-[130px]`}
              title={b.business_name}
            >
              {b.business_name}
            </span>
          ))}
          {user.businesses.length > 4 && (
            <span className="text-xs text-gray-600">+{user.businesses.length - 4}</span>
          )}
        </div>
      )}

      <button
        onClick={onView}
        className="w-full flex items-center justify-center gap-2 text-xs font-semibold text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 rounded-xl py-2 transition"
      >
        <Eye className="w-3.5 h-3.5" /> View Profile
      </button>
    </div>
  );
}
