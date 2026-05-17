import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Briefcase,
  Building2,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  DollarSign,
  Eye,
  Filter,
  Fingerprint,
  Globe,
  Hash,
  Info,
  LifeBuoy,
  Map,
  MapPin,
  MessageSquare,
  Phone,
  RefreshCw,
  Search,
  ShoppingBag,
  Shield,
  Smartphone,
  UserCheck,
  UserX,
  Users,
  Wrench,
  XCircle,
  Zap,
} from 'lucide-react';
import adminApi from '../../../lib/adminApi';

const TABS = [
  { id: 'suspects', label: 'Flagged Pairs', icon: AlertTriangle },
  { id: 'users', label: 'People & Accounts', icon: Users },
];

const SIGNAL_META = {
  same_phone: { icon: Phone, color: 'text-red-400', bg: 'bg-red-400/10 border-red-400/30' },
  same_ip: { icon: Hash, color: 'text-red-400', bg: 'bg-red-400/10 border-red-400/30' },
  same_ip_hash: { icon: Hash, color: 'text-orange-400', bg: 'bg-orange-400/10 border-orange-400/30' },
  same_name: { icon: Users, color: 'text-yellow-400', bg: 'bg-yellow-400/10 border-yellow-400/30' },
  same_device_terms: { icon: Smartphone, color: 'text-orange-400', bg: 'bg-orange-400/10 border-orange-400/30' },
  same_didit_hash: { icon: Fingerprint, color: 'text-red-500', bg: 'bg-red-500/10 border-red-500/30' },
  same_referral: { icon: Shield, color: 'text-blue-400', bg: 'bg-blue-400/10 border-blue-400/30' },
  close_created: { icon: RefreshCw, color: 'text-yellow-400', bg: 'bg-yellow-400/10 border-yellow-400/30' },
};

const SECTION_META = {
  people: {
    label: 'People & Businesses',
    icon: Users,
    tone: 'from-sky-500/18 via-sky-500/6 to-transparent border-sky-500/25',
    metrics: [
      { key: 'totalUsers', label: 'Users' },
      { key: 'verifiedUsers', label: 'Verified' },
      { key: 'totalBusinesses', label: 'Businesses' },
      { key: 'usersWithMultipleBusinesses', label: 'Multi-biz owners' },
    ],
  },
  marketplace: {
    label: 'Marketplace Jobs',
    icon: Briefcase,
    tone: 'from-amber-500/18 via-amber-500/6 to-transparent border-amber-500/25',
    metrics: [
      { key: 'totalJobs', label: 'Total jobs' },
      { key: 'openJobs', label: 'Open' },
      { key: 'activeJobs', label: 'Active' },
      { key: 'completedJobs', label: 'Completed' },
    ],
  },
  support: {
    label: 'Support & Risk',
    icon: LifeBuoy,
    tone: 'from-indigo-500/18 via-indigo-500/6 to-transparent border-indigo-500/25',
    metrics: [
      { key: 'totalTickets', label: 'Tickets' },
      { key: 'openTickets', label: 'Open' },
      { key: 'escalatedTickets', label: 'High priority' },
    ],
  },
  commerce: {
    label: 'Orders & Commerce',
    icon: ShoppingBag,
    tone: 'from-emerald-500/18 via-emerald-500/6 to-transparent border-emerald-500/25',
    metrics: [
      { key: 'totalOrders', label: 'Orders' },
      { key: 'paidOrders', label: 'Paid / processing' },
      { key: 'paidVolumeCents', label: 'Paid volume', format: 'cents' },
    ],
  },
  rentals: {
    label: 'Tool Rentals',
    icon: Wrench,
    tone: 'from-cyan-500/18 via-cyan-500/6 to-transparent border-cyan-500/25',
    metrics: [
      { key: 'totalListings', label: 'Listings' },
      { key: 'availableListings', label: 'Available' },
      { key: 'activeBookings', label: 'Live bookings' },
    ],
  },
  money: {
    label: 'Payments',
    icon: CreditCard,
    tone: 'from-violet-500/18 via-violet-500/6 to-transparent border-violet-500/25',
    metrics: [
      { key: 'totalPayments', label: 'Payments' },
      { key: 'pendingPayments', label: 'Pending / authorized' },
      { key: 'completedVolumeAmount', label: 'Captured volume', format: 'amount' },
    ],
  },
  consulting: {
    label: 'Consulting',
    icon: MessageSquare,
    tone: 'from-fuchsia-500/18 via-fuchsia-500/6 to-transparent border-fuchsia-500/25',
    metrics: [
      { key: 'totalSessions', label: 'Sessions' },
      { key: 'scheduledSessions', label: 'Scheduled' },
      { key: 'completedSessions', label: 'Completed' },
    ],
  },
};

function formatValue(value, format) {
  if (value == null) return '—';
  if (format === 'cents') return `$${(Number(value) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (format === 'amount') return `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return Number(value).toLocaleString('en-US');
}

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

function buildScopeParams({ country, regionId }) {
  return {
    ...(country ? { country } : {}),
    ...(regionId ? { regionId } : {}),
  };
}

function StatCard({ icon: Icon, label, value, hint, color = 'text-white' }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-[#111318] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{label}</span>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-800 bg-gray-900/70">
          <Icon className="h-4 w-4 text-gray-400" />
        </div>
      </div>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      {hint && <p className="mt-2 text-xs leading-5 text-gray-500">{hint}</p>}
    </div>
  );
}

function Pagination({ page, totalPages, onPage }) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-6 flex items-center justify-center gap-2">
      <button
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        className="rounded-lg border border-gray-700 p-1.5 text-gray-400 transition hover:text-white disabled:opacity-30"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="text-sm text-gray-400">Page {page} of {totalPages}</span>
      <button
        onClick={() => onPage(page + 1)}
        disabled={page >= totalPages}
        className="rounded-lg border border-gray-700 p-1.5 text-gray-400 transition hover:text-white disabled:opacity-30"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function ScopeBadge({ icon: Icon, label, value }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-gray-700 bg-gray-900/70 px-3 py-1.5 text-xs text-gray-300">
      <Icon className="h-3.5 w-3.5 text-gray-500" />
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-white">{value}</span>
    </div>
  );
}

function SignalBadge({ signal }) {
  const meta = SIGNAL_META[signal.type] || { icon: AlertTriangle, color: 'text-gray-400', bg: 'bg-gray-800 border-gray-600' };
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${meta.bg} ${meta.color}`}>
      <Icon className="h-3 w-3" />
      {signal.label}
      <span className="opacity-60">×{signal.weight}</span>
    </span>
  );
}

function OperationChip({ label, value, tone = 'default' }) {
  const tones = {
    default: 'border-gray-700 bg-gray-900/75 text-gray-300',
    warm: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
    cool: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
    good: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    violet: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  };

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${tones[tone] || tones.default}`}>
      <span>{label}</span>
      <span className="text-white">{value}</span>
    </span>
  );
}

function UserMiniCard({ user, onClick }) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Unknown';
  const bizCount = user.businesses?.length ?? user.business_count ?? 0;
  const status = user.is_banned ? 'banned' : (!user.is_active ? 'inactive' : 'active');
  const statusColors = {
    active: 'text-emerald-400',
    inactive: 'text-yellow-400',
    banned: 'text-red-400',
  };

  return (
    <button
      onClick={onClick}
      className="w-full rounded-2xl border border-gray-700 bg-gray-900/65 p-4 text-left transition hover:border-gray-500"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{name}</p>
          <p className="truncate text-xs text-gray-400">{user.email}</p>
          {(user.city || user.state || user.country) && (
            <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
              <MapPin className="h-3 w-3" />
              {[user.city, user.state, user.country].filter(Boolean).join(', ')}
            </p>
          )}
        </div>
        <span className={`text-xs font-semibold uppercase ${statusColors[status]}`}>{status}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <OperationChip label="Businesses" value={bizCount} tone="cool" />
        <OperationChip label="Jobs" value={(user.ops?.jobsPosted || 0) + (user.ops?.jobsWorked || 0)} />
        <OperationChip label="Support" value={user.ops?.supportTickets || 0} tone="violet" />
      </div>
    </button>
  );
}

function SuspectPairCard({ pair, onViewUser }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`overflow-hidden rounded-2xl border transition ${scoreBg(pair.score)}`}>
      <button
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-4 p-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl border text-sm font-bold ${scoreBg(pair.score)} ${scoreColor(pair.score)}`}>
            {pair.score}
          </div>
          <div>
            <p className={`text-sm font-semibold ${scoreColor(pair.score)}`}>{riskLabel(pair.score)}</p>
            <p className="text-xs text-gray-400">{pair.signals.length} cross-account signal{pair.signals.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <div className="hidden text-right sm:block">
          <p className="text-sm text-gray-200">
            {[pair.userA.first_name, pair.userA.last_name].filter(Boolean).join(' ') || pair.userA.email}
          </p>
          <p className="text-xs text-gray-500">
            {[pair.userB.first_name, pair.userB.last_name].filter(Boolean).join(' ') || pair.userB.email}
          </p>
        </div>
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-white/5 p-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Signals</p>
            <div className="flex flex-wrap gap-2">
              {pair.signals.map((signal, index) => (
                <SignalBadge key={`${pair.id}-${index}`} signal={signal} />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <UserMiniCard user={pair.userA} onClick={() => onViewUser(pair.userA.id)} />
            <UserMiniCard user={pair.userB} onClick={() => onViewUser(pair.userB.id)} />
          </div>

          <div className="flex items-start gap-2 text-xs text-gray-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Open either account to review full activity, business ownership, and enforcement actions before resolving the duplicate risk.
          </div>
        </div>
      )}
    </div>
  );
}

function MetricSectionCard({ sectionKey, stats }) {
  const meta = SECTION_META[sectionKey];
  if (!meta || !stats) return null;
  const Icon = meta.icon;

  return (
    <div className={`rounded-3xl border bg-gradient-to-br p-5 ${meta.tone}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{meta.label}</p>
          <p className="mt-2 text-sm leading-6 text-gray-300">
            Operational truth for this scope, updated from the live admin data sources behind One Truth.
          </p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
          <Icon className="h-5 w-5 text-white" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {meta.metrics.map((metric) => (
          <div key={metric.key} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-gray-500">{metric.label}</p>
            <p className="mt-2 text-lg font-semibold text-white">{formatValue(stats[metric.key], metric.format)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function UserCard({ user, onView }) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Unknown';
  const bizCount = parseInt(user.business_count ?? user.businesses?.length ?? 0, 10);
  const isActive = user.is_active !== false;
  const isBanned = user.is_banned === true;

  return (
    <div className="rounded-3xl border border-gray-800 bg-[#111318] p-4 transition hover:border-gray-600">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{name}</p>
          <p className="truncate text-xs text-gray-400">{user.email}</p>
          {(user.city || user.state || user.country) && (
            <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
              <MapPin className="h-3.5 w-3.5" />
              {[user.city, user.state, user.country].filter(Boolean).join(', ')}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          {isBanned && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-400">Banned</span>}
          {!isBanned && !isActive && <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-xs font-medium text-yellow-400">Inactive</span>}
          {!isBanned && isActive && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">Active</span>}
          {user.identity_verified && <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-300">Verified</span>}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        <OperationChip label="Businesses" value={bizCount} tone="cool" />
        <OperationChip label="Jobs posted" value={user.ops?.jobsPosted || 0} />
        <OperationChip label="Jobs worked" value={user.ops?.jobsWorked || 0} tone="warm" />
        <OperationChip label="Orders" value={user.ops?.orders || 0} tone="good" />
        <OperationChip label="Support" value={user.ops?.supportTickets || 0} tone="violet" />
        <OperationChip label="Tools" value={user.ops?.toolsListed || 0} />
      </div>

      {user.businesses?.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1">
          {user.businesses.slice(0, 4).map((business) => (
            <span
              key={business.id}
              className={`max-w-[150px] truncate rounded-full border px-2 py-0.5 text-xs ${
                business.is_active
                  ? 'border-blue-500/30 bg-blue-500/10 text-blue-300'
                  : 'border-gray-700 bg-gray-800 text-gray-500 line-through'
              }`}
              title={business.business_name}
            >
              {business.business_name}
            </span>
          ))}
          {user.businesses.length > 4 && <span className="text-xs text-gray-600">+{user.businesses.length - 4} more</span>}
        </div>
      )}

      <button
        onClick={onView}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-gray-700 py-2 text-xs font-semibold text-gray-400 transition hover:border-gray-500 hover:text-white"
      >
        <Eye className="h-3.5 w-3.5" />
        View Profile
      </button>
    </div>
  );
}

export default function OneTruthPage() {
  const navigate = useNavigate();

  const [filtersData, setFiltersData] = useState({ countries: [], regions: [] });
  const [filtersLoading, setFiltersLoading] = useState(true);

  const [country, setCountry] = useState('');
  const [regionId, setRegionId] = useState('');

  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const [tab, setTab] = useState('suspects');

  const [suspects, setSuspects] = useState([]);
  const [suspectTotal, setSuspectTotal] = useState(0);
  const [suspectPage, setSuspectPage] = useState(1);
  const [suspectPages, setSuspectPages] = useState(1);
  const [suspectLoading, setSuspectLoading] = useState(false);
  const [suspectError, setSuspectError] = useState('');

  const [users, setUsers] = useState([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userPage, setUserPage] = useState(1);
  const [userPages, setUserPages] = useState(1);
  const [userSearch, setUserSearch] = useState('');
  const [userSearchInput, setUserSearchInput] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');

  const activeScope = buildScopeParams({ country, regionId });
  const selectedRegion = filtersData.regions.find((region) => region.id === regionId);

  const loadFilters = useCallback(async () => {
    setFiltersLoading(true);
    try {
      const { data } = await adminApi.get('/admin/one-truth/filters');
      setFiltersData({
        countries: data.countries || [],
        regions: data.regions || [],
      });
    } finally {
      setFiltersLoading(false);
    }
  }, []);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const { data } = await adminApi.get('/admin/one-truth/stats', {
        params: activeScope,
      });
      setStats(data);
    } catch {
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, [activeScope.country, activeScope.regionId]);

  const loadSuspects = useCallback(async (page = 1) => {
    setSuspectLoading(true);
    setSuspectError('');
    try {
      const { data } = await adminApi.get('/admin/one-truth/suspects', {
        params: {
          page,
          limit: 20,
          ...activeScope,
        },
      });
      setSuspects(data.pairs || []);
      setSuspectTotal(data.total || 0);
      setSuspectPage(data.page || 1);
      setSuspectPages(data.totalPages || 1);
    } catch (err) {
      setSuspectError(err.response?.data?.error || err.message || 'Failed to run duplicate detection.');
    } finally {
      setSuspectLoading(false);
    }
  }, [activeScope.country, activeScope.regionId]);

  const loadUsers = useCallback(async (page = 1, search = '') => {
    setUsersLoading(true);
    setUsersError('');
    try {
      const { data } = await adminApi.get('/admin/one-truth/users', {
        params: {
          page,
          limit: 24,
          ...(search ? { search } : {}),
          ...activeScope,
        },
      });
      setUsers(data.users || []);
      setUserTotal(data.total || 0);
      setUserPage(data.page || 1);
      setUserPages(data.totalPages || 1);
    } catch (err) {
      setUsersError(err.response?.data?.error || err.message || 'Failed to load users.');
    } finally {
      setUsersLoading(false);
    }
  }, [activeScope.country, activeScope.regionId]);

  useEffect(() => {
    loadFilters();
  }, [loadFilters]);

  useEffect(() => {
    loadStats();
    if (tab === 'suspects') loadSuspects(1);
    if (tab === 'users') loadUsers(1, userSearch);
  }, [country, regionId, tab, loadStats, loadSuspects, loadUsers, userSearch]);

  const handleRefresh = () => {
    loadStats();
    if (tab === 'suspects') loadSuspects(suspectPage);
    if (tab === 'users') loadUsers(userPage, userSearch);
  };

  const handleUserSearch = (event) => {
    event.preventDefault();
    setUserSearch(userSearchInput);
    loadUsers(1, userSearchInput);
  };

  const handleViewUser = (userId) => {
    navigate(`/admin/users/${userId}`);
  };

  const clearFilters = () => {
    setCountry('');
    setRegionId('');
  };

  const peopleStats = stats?.sections?.people || {};

  return (
    <div className="min-h-screen bg-[#0b0d11] px-4 py-6 text-white sm:px-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="overflow-hidden rounded-[28px] border border-gray-800 bg-gradient-to-br from-[#12151c] via-[#0e1117] to-[#0b0d11]">
          <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.3fr)_420px] lg:p-7">
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-500/25 bg-orange-500/12">
                      <Shield className="h-5 w-5 text-orange-400" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-300/80">Super Admin</p>
                      <h1 className="text-3xl font-semibold text-white">One Truth</h1>
                    </div>
                  </div>
                  <p className="max-w-2xl text-sm leading-7 text-gray-300">
                    Expanded operations truth layer for identity, staffing, support, commerce, jobs, payments, and launch-market health. Use country or region scope to inspect a market before you hire, investigate, or intervene.
                  </p>
                </div>

                <button
                  onClick={handleRefresh}
                  className="inline-flex items-center gap-2 rounded-2xl border border-gray-700 bg-gray-900/70 px-3 py-2 text-sm text-gray-300 transition hover:text-white"
                >
                  <RefreshCw className={`h-4 w-4 ${statsLoading || suspectLoading || usersLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                <ScopeBadge icon={Globe} label="Country" value={country || 'All markets'} />
                <ScopeBadge icon={Map} label="Region" value={selectedRegion?.name || 'All regions'} />
                <ScopeBadge icon={Users} label="People" value={statsLoading ? '…' : formatValue(peopleStats.totalUsers)} />
                <ScopeBadge icon={Building2} label="Businesses" value={statsLoading ? '…' : formatValue(peopleStats.totalBusinesses)} />
              </div>

              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <StatCard
                  icon={Users}
                  label="Users In Scope"
                  value={statsLoading ? '…' : formatValue(stats?.totalUsers)}
                  hint="Customer, helper, and provider accounts that match the selected market scope."
                  color="text-sky-300"
                />
                <StatCard
                  icon={Building2}
                  label="Businesses"
                  value={statsLoading ? '…' : formatValue(stats?.totalBusinesses)}
                  hint="Registered businesses tied to this geography."
                  color="text-blue-300"
                />
                <StatCard
                  icon={UserCheck}
                  label="Verified Users"
                  value={statsLoading ? '…' : formatValue(peopleStats.verifiedUsers)}
                  hint="Identity-verified accounts in the selected operational scope."
                  color="text-emerald-300"
                />
                <StatCard
                  icon={AlertTriangle}
                  label="Flagged Pairs"
                  value={suspectLoading ? '…' : formatValue(stats?.flaggedPairs ?? suspectTotal)}
                  hint="Duplicate-account investigations surfaced by One Truth signals."
                  color="text-orange-300"
                />
              </div>
            </div>

            <div className="rounded-[26px] border border-gray-800 bg-[#111318] p-5">
              <div className="mb-4 flex items-center gap-2">
                <Filter className="h-4 w-4 text-orange-400" />
                <p className="text-sm font-semibold text-white">Scope Filters</p>
              </div>

              <div className="space-y-4">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Country</span>
                  <select
                    value={country}
                    onChange={(event) => setCountry(event.target.value)}
                    className="w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-3 text-sm text-white outline-none transition focus:border-orange-500"
                    disabled={filtersLoading}
                  >
                    <option value="">All countries</option>
                    {filtersData.countries.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.name} ({option.code})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Region</span>
                  <select
                    value={regionId}
                    onChange={(event) => setRegionId(event.target.value)}
                    className="w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-3 text-sm text-white outline-none transition focus:border-orange-500"
                    disabled={filtersLoading}
                  >
                    <option value="">All admin regions</option>
                    {filtersData.regions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name} — {option.coverageLabel}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  onClick={clearFilters}
                  disabled={!country && !regionId}
                  className="w-full rounded-2xl border border-gray-700 px-3 py-2.5 text-sm font-medium text-gray-300 transition hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear scope
                </button>

                <div className="rounded-2xl border border-orange-500/20 bg-orange-500/6 p-4 text-sm leading-6 text-gray-300">
                  Filter by a whole country when you’re evaluating launch readiness for a market. Filter by an admin region when you want the operational truth for a province, state, city cluster, or assigned territory.
                </div>
              </div>
            </div>
          </div>
        </div>

        {stats?.warnings?.length > 0 && (
          <div className="rounded-2xl border border-yellow-500/25 bg-yellow-500/8 p-4 text-sm text-yellow-200">
            <div className="mb-2 flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" />
              Scope notes
            </div>
            <div className="space-y-1 text-yellow-100/90">
              {stats.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-3">
          <MetricSectionCard sectionKey="people" stats={stats?.sections?.people} />
          <MetricSectionCard sectionKey="marketplace" stats={stats?.sections?.marketplace} />
          <MetricSectionCard sectionKey="support" stats={stats?.sections?.support} />
          <MetricSectionCard sectionKey="commerce" stats={stats?.sections?.commerce} />
          <MetricSectionCard sectionKey="rentals" stats={stats?.sections?.rentals} />
          <MetricSectionCard sectionKey="money" stats={stats?.sections?.money} />
        </div>

        <div className="rounded-3xl border border-gray-800 bg-[#111318] p-5">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-orange-500/25 bg-orange-500/10">
              <Zap className="h-4 w-4 text-orange-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Policy and investigation intent</p>
              <p className="mt-1 text-sm leading-6 text-gray-400">
                OxSteed allows one account per person. A person may operate multiple businesses under that account, but duplicate personal accounts create trust, safety, support, and payment risk across the platform. One Truth now gives that investigation context alongside wider operational reality.
              </p>
            </div>
          </div>
        </div>

        <div className="flex border-b border-gray-800">
          {TABS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-medium transition ${
                tab === item.id
                  ? 'border-orange-500 text-orange-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
              {item.id === 'suspects' && suspectTotal > 0 && (
                <span className="rounded-full bg-orange-500/20 px-1.5 py-0.5 text-xs font-bold text-orange-400">
                  {suspectTotal}
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === 'suspects' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-gray-400">
                {suspectLoading ? 'Running duplicate detection…' : `${suspectTotal.toLocaleString()} suspected duplicate pair${suspectTotal !== 1 ? 's' : ''} found in this scope`}
              </p>
              <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-yellow-400" /> Low risk (2–3)</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-orange-400" /> Medium risk (4–5)</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-red-400" /> High risk (6+)</span>
              </div>
            </div>

            {suspectLoading && (
              <div className="py-14 text-center text-gray-500">
                <RefreshCw className="mx-auto mb-3 h-6 w-6 animate-spin" />
                Running duplicate detection…
              </div>
            )}

            {!suspectLoading && suspectError && (
              <div className="rounded-2xl border border-red-400/20 bg-red-400/5 py-8 text-center text-red-400">
                {suspectError}
              </div>
            )}

            {!suspectLoading && !suspectError && suspects.length === 0 && (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 py-12 text-center">
                <CheckCircle className="mx-auto mb-3 h-8 w-8 text-emerald-400" />
                <p className="font-semibold text-emerald-400">No suspected duplicates found</p>
                <p className="mt-1 text-sm text-gray-500">This scope looks clean based on the available identity and behavior signals.</p>
              </div>
            )}

            {!suspectLoading && suspects.map((pair) => (
              <SuspectPairCard key={pair.id} pair={pair} onViewUser={handleViewUser} />
            ))}

            <Pagination page={suspectPage} totalPages={suspectPages} onPage={(page) => loadSuspects(page)} />
          </div>
        )}

        {tab === 'users' && (
          <div className="space-y-4">
            <div className="rounded-3xl border border-gray-800 bg-[#111318] p-4">
              <form onSubmit={handleUserSearch} className="flex flex-col gap-3 lg:flex-row">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    value={userSearchInput}
                    onChange={(event) => setUserSearchInput(event.target.value)}
                    placeholder="Search by name or email…"
                    className="w-full rounded-2xl border border-gray-700 bg-gray-900 py-3 pl-9 pr-4 text-sm text-white outline-none transition focus:border-orange-500"
                  />
                </div>
                <button
                  type="submit"
                  className="rounded-2xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-orange-600"
                >
                  Search
                </button>
              </form>

              <div className="mt-4 flex flex-wrap gap-2">
                <OperationChip label="Users in scope" value={usersLoading ? '…' : userTotal.toLocaleString()} tone="cool" />
                <OperationChip label="Country filter" value={country || 'All'} />
                <OperationChip label="Region filter" value={selectedRegion?.name || 'All'} tone="violet" />
              </div>
            </div>

            {usersLoading && (
              <div className="py-12 text-center text-gray-500">
                <RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />
                Loading users…
              </div>
            )}

            {!usersLoading && usersError && (
              <div className="rounded-2xl border border-red-400/20 bg-red-400/5 py-8 text-center text-red-400">
                {usersError}
              </div>
            )}

            {!usersLoading && !usersError && users.length === 0 && (
              <div className="rounded-2xl border border-gray-800 bg-[#111318] py-12 text-center text-gray-500">
                No users found for this scope.
              </div>
            )}

            {!usersLoading && !usersError && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {users.map((user) => (
                  <UserCard key={user.id} user={user} onView={() => handleViewUser(user.id)} />
                ))}
              </div>
            )}

            <Pagination page={userPage} totalPages={userPages} onPage={(page) => loadUsers(page, userSearch)} />
          </div>
        )}
      </div>
    </div>
  );
}
