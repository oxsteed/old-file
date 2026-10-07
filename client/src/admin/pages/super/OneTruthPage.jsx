import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Briefcase,
  Building2,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  GitCompareArrows,
  CreditCard,
  DollarSign,
  ExternalLink,
  Eye,
  Filter,
  Fingerprint,
  Globe,
  Hash,
  Info,
  KeyRound,
  LifeBuoy,
  Map,
  MapPin,
  MessageSquare,
  Phone,
  RefreshCw,
  Send,
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
import { SuggestDropdown } from '../../../components/SuggestDropdown';
import '../../lib/suggestDropdownAdmin.css';

const TABS = [
  { id: 'suspects', labelKey: 'adminOneTruthTabSuspects', icon: AlertTriangle },
  { id: 'users', labelKey: 'adminOneTruthTabUsers', icon: Users },
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
    labelKey: 'adminOneTruthSectionPeople',
    icon: Users,
    tone: 'from-sky-500/18 via-sky-500/6 to-transparent border-sky-500/25',
    metrics: [
      { key: 'totalUsers', labelKey: 'adminOneTruthMetricUsers' },
      { key: 'verifiedUsers', labelKey: 'adminOneTruthMetricVerified' },
      { key: 'totalBusinesses', labelKey: 'adminOneTruthMetricBusinesses' },
      { key: 'usersWithMultipleBusinesses', labelKey: 'adminOneTruthMetricMultiBiz' },
    ],
  },
  marketplace: {
    labelKey: 'adminOneTruthSectionMarketplace',
    icon: Briefcase,
    tone: 'from-amber-500/18 via-amber-500/6 to-transparent border-amber-500/25',
    metrics: [
      { key: 'totalJobs', labelKey: 'adminOneTruthMetricTotalJobs' },
      { key: 'openJobs', labelKey: 'adminOneTruthMetricOpen' },
      { key: 'activeJobs', labelKey: 'adminOneTruthMetricActive' },
      { key: 'completedJobs', labelKey: 'adminOneTruthMetricCompleted' },
    ],
  },
  support: {
    labelKey: 'adminOneTruthSectionSupport',
    icon: LifeBuoy,
    tone: 'from-indigo-500/18 via-indigo-500/6 to-transparent border-indigo-500/25',
    metrics: [
      { key: 'totalTickets', labelKey: 'adminOneTruthMetricTickets' },
      { key: 'openTickets', labelKey: 'adminOneTruthMetricOpen' },
      { key: 'escalatedTickets', labelKey: 'adminOneTruthMetricEscalated' },
    ],
  },
  commerce: {
    labelKey: 'adminOneTruthSectionCommerce',
    icon: ShoppingBag,
    tone: 'from-emerald-500/18 via-emerald-500/6 to-transparent border-emerald-500/25',
    metrics: [
      { key: 'totalOrders', labelKey: 'adminOneTruthMetricOrders' },
      { key: 'paidOrders', labelKey: 'adminOneTruthMetricPaidProcessing' },
      { key: 'volumeByCurrency', labelKey: 'adminOneTruthMetricPaidVolume', format: 'centsByCurrency' },
    ],
  },
  rentals: {
    labelKey: 'adminOneTruthSectionRentals',
    icon: Wrench,
    tone: 'from-cyan-500/18 via-cyan-500/6 to-transparent border-cyan-500/25',
    metrics: [
      { key: 'totalListings', labelKey: 'adminOneTruthMetricListings' },
      { key: 'availableListings', labelKey: 'adminOneTruthMetricAvailable' },
      { key: 'activeBookings', labelKey: 'adminOneTruthMetricLiveBookings' },
    ],
  },
  money: {
    labelKey: 'adminOneTruthSectionMoney',
    icon: CreditCard,
    tone: 'from-violet-500/18 via-violet-500/6 to-transparent border-violet-500/25',
    metrics: [
      { key: 'totalPayments', labelKey: 'adminOneTruthMetricPayments' },
      { key: 'pendingPayments', labelKey: 'adminOneTruthMetricPendingAuthorized' },
      { key: 'volumeByCurrency', labelKey: 'adminOneTruthMetricCapturedVolume', format: 'moneyByCurrency' },
    ],
    links: [
      { labelKey: 'adminOneTruthLinkTreasury', to: '/admin/super/treasury' },
      { labelKey: 'adminOneTruthLinkReconciliation', to: '/admin/super/oxsteed-credit/reconciliation' },
    ],
  },
  consulting: {
    labelKey: 'adminOneTruthSectionConsulting',
    icon: MessageSquare,
    tone: 'from-fuchsia-500/18 via-fuchsia-500/6 to-transparent border-fuchsia-500/25',
    metrics: [
      { key: 'totalSessions', labelKey: 'adminOneTruthMetricSessions' },
      { key: 'scheduledSessions', labelKey: 'adminOneTruthMetricScheduled' },
      { key: 'completedSessions', labelKey: 'adminOneTruthMetricCompleted' },
    ],
  },
};

function formatValue(value, format) {
  if (value == null) return '—';
  if (format === 'cents') return `$${(Number(value) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (format === 'amount') return `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return Number(value).toLocaleString('en-US');
}

// P1 item 14: currency-aware money rendering. Mixed-currency volumes are
// never collapsed under a single "$": each currency gets its own line with
// its own symbol via Intl.
function formatMoneyAmount(value, currency) {
  const code = (currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(Number(value) || 0);
  } catch {
    return `${code} ${(Number(value) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

function CurrencyList({ items, cents = false }) {
  if (!items?.length) return <span className="text-lg font-semibold text-white">—</span>;
  return (
    <div className="space-y-1">
      {items.map((item) => (
        <p key={item.currency} className="text-lg font-semibold text-white">
          {formatMoneyAmount(cents ? (Number(item.amountCents) || 0) / 100 : item.amount, item.currency)}
        </p>
      ))}
    </div>
  );
}

function renderMetricValue(value, format) {
  if (format === 'moneyByCurrency') return <CurrencyList items={value} />;
  if (format === 'centsByCurrency') return <CurrencyList items={value} cents />;
  return <p className="mt-2 text-lg font-semibold text-white">{formatValue(value, format)}</p>;
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

function riskLabel(score, t) {
  if (score >= 6) return t('adminOneTruthRiskHigh');
  if (score >= 4) return t('adminOneTruthRiskMedium');
  return t('adminOneTruthRiskLow');
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
  const { t } = useTranslation();
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
      <span className="text-sm text-gray-400">{t('adminOneTruthPageOf', { page, totalPages })}</span>
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
  const { t } = useTranslation();
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || t('adminOneTruthUnknownUser');
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
        <span className={`text-xs font-semibold uppercase ${statusColors[status]}`}>{status === 'banned' ? t('adminOneTruthStatusBanned') : status === 'inactive' ? t('adminOneTruthStatusInactive') : t('adminOneTruthStatusActive')}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <OperationChip label={t('adminOneTruthChipBusinesses')} value={bizCount} tone="cool" />
        <OperationChip label={t('adminOneTruthChipJobs')} value={(user.ops?.jobsPosted || 0) + (user.ops?.jobsWorked || 0)} />
        <OperationChip label={t('adminOneTruthChipSupport')} value={user.ops?.supportTickets || 0} tone="violet" />
      </div>
    </button>
  );
}

function SuspectPairCard({ pair, onViewUser, onCompare, onReviewSaved }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState('');
  const reviewStatus = pair.review?.status;

  const saveReview = async (status) => {
    setSaving(status);
    try {
      const { data } = await adminApi.post('/admin/one-truth/pairs/review', {
        userAId: pair.userA.id,
        userBId: pair.userB.id,
        status,
      });
      onReviewSaved(pair.pairKey || pair.id, data.review);
    } finally {
      setSaving('');
    }
  };

  const reviewBadge = reviewStatus && (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
      reviewStatus === 'confirmed' ? 'bg-red-500/15 text-red-300'
        : reviewStatus === 'dismissed' ? 'bg-gray-700/60 text-gray-400'
          : 'bg-sky-500/15 text-sky-300'
    }`}>
      {reviewStatus === 'reviewed' ? t('adminOneTruthFilterReviewedStatus')
        : reviewStatus === 'confirmed' ? t('adminOneTruthFilterConfirmed')
          : t('adminOneTruthFilterDismissed')}
    </span>
  );

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
            <p className={`flex items-center gap-2 text-sm font-semibold ${scoreColor(pair.score)}`}>
              {riskLabel(pair.score, t)}
              {reviewBadge}
            </p>
            <p className="text-xs text-gray-400">{t('adminOneTruthCrossSignals', { count: pair.signals.length })}</p>
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
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('adminOneTruthSignals')}</p>
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

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onCompare(pair)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs font-semibold text-orange-300 transition hover:border-orange-500/50"
            >
              <GitCompareArrows className="h-3.5 w-3.5" />
              {t('adminOneTruthCompare')}
            </button>
            {[
              { status: 'reviewed', labelKey: 'adminOneTruthMarkReviewed' },
              { status: 'confirmed', labelKey: 'adminOneTruthMarkConfirmed' },
              { status: 'dismissed', labelKey: 'adminOneTruthMarkDismissed' },
            ].map((action) => (
              <button
                key={action.status}
                onClick={() => saveReview(action.status)}
                disabled={saving !== ''}
                className="rounded-xl border border-gray-700 px-3 py-2 text-xs font-medium text-gray-300 transition hover:border-gray-500 hover:text-white disabled:opacity-50"
              >
                {saving === action.status ? t('common.saving') : t(action.labelKey)}
              </button>
            ))}
            <button
              onClick={() => navigate('/admin/moderation')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-700 px-3 py-2 text-xs font-medium text-gray-300 transition hover:border-gray-500 hover:text-white"
            >
              {t('adminOneTruthHandoffModeration')}
              <ExternalLink className="h-3 w-3" />
            </button>
            <button
              onClick={() => navigate('/admin/enforcement')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-700 px-3 py-2 text-xs font-medium text-gray-300 transition hover:border-gray-500 hover:text-white"
            >
              {t('adminOneTruthHandoffEnforcement')}
              <ExternalLink className="h-3 w-3" />
            </button>
          </div>

          <div className="flex items-start gap-2 text-xs text-gray-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t('adminOneTruthPairHint')}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricSectionCard({ sectionKey, stats }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const meta = SECTION_META[sectionKey];
  if (!meta || !stats) return null;
  const Icon = meta.icon;

  return (
    <div className={`rounded-3xl border bg-gradient-to-br p-5 ${meta.tone}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t(meta.labelKey)}</p>
          <p className="mt-2 text-sm leading-6 text-gray-300">
            {t('adminOneTruthMetricSectionDetail')}
          </p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
          <Icon className="h-5 w-5 text-white" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {meta.metrics.map((metric) => (
          <div key={metric.key} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-gray-500">{t(metric.labelKey)}</p>
            <div className="mt-2">{renderMetricValue(stats[metric.key], metric.format)}</div>
          </div>
        ))}
      </div>

      {meta.links?.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {meta.links.map((link) => (
            <button
              key={link.to}
              onClick={() => navigate(link.to)}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-xs font-medium text-gray-300 transition hover:border-white/30 hover:text-white"
            >
              {t(link.labelKey)}
              <ExternalLink className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UserCard({ user, onView }) {
  const { t } = useTranslation();
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || t('adminOneTruthUnknownUser');
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
          {isBanned && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-400">{t('adminOneTruthStatusBanned')}</span>}
          {!isBanned && !isActive && <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-xs font-medium text-yellow-400">{t('adminOneTruthStatusInactive')}</span>}
          {!isBanned && isActive && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">{t('adminOneTruthStatusActive')}</span>}
          {user.identity_verified && <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-300">{t('adminOneTruthVerified')}</span>}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        <OperationChip label={t('adminOneTruthChipBusinesses')} value={bizCount} tone="cool" />
        <OperationChip label={t('adminOneTruthChipJobsPosted')} value={user.ops?.jobsPosted || 0} />
        <OperationChip label={t('adminOneTruthChipJobsWorked')} value={user.ops?.jobsWorked || 0} tone="warm" />
        <OperationChip label={t('adminOneTruthChipOrders')} value={user.ops?.orders || 0} tone="good" />
        <OperationChip label={t('adminOneTruthChipSupport')} value={user.ops?.supportTickets || 0} tone="violet" />
        <OperationChip label={t('adminOneTruthChipTools')} value={user.ops?.toolsListed || 0} />
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
          {user.businesses.length > 4 && <span className="text-xs text-gray-600">{t('adminOneTruthMore', { count: user.businesses.length - 4 })}</span>}
        </div>
      )}

      <button
        onClick={onView}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-gray-700 py-2 text-xs font-semibold text-gray-400 transition hover:border-gray-500 hover:text-white"
      >
        <Eye className="h-3.5 w-3.5" />
        {t('adminOneTruthViewProfile')}
      </button>
    </div>
  );
}

// ── P1 item 12.1: coverage / pipeline watermark KPIs ────────────────────────

function CoverageCard({ coverage }) {
  const { t } = useTranslation();
  if (!coverage) return null;
  const cards = [
    { labelKey: 'adminOneTruthCoverageEvaluated', value: coverage.evaluatedUsers, color: 'text-sky-300' },
    { labelKey: 'adminOneTruthCoverageUnevaluated', value: coverage.unevaluatedUsers, color: 'text-yellow-300' },
    { labelKey: 'adminOneTruthCoverageOpenPairs', value: coverage.openPairs, color: 'text-orange-300' },
    { labelKey: 'adminOneTruthCoverageConfirmed', value: coverage.confirmedCases, color: 'text-emerald-300' },
  ];
  const sourceLabel = (key) => key === 'duplicate_detection'
    ? t('adminOneTruthCoverageSourceDuplicates')
    : t('adminOneTruthCoverageSourceFraudCases');
  const formatAsOf = (iso) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <div className="rounded-3xl border border-gray-800 bg-[#111318] p-5">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('adminOneTruthCoverageTitle')}</p>
        <p className="mt-2 text-sm leading-6 text-gray-400">{t('adminOneTruthCoverageSubtitle')}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.labelKey} className="rounded-2xl border border-gray-800 bg-gray-900/60 px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-gray-500">{t(card.labelKey)}</p>
            <p className={`mt-2 text-2xl font-semibold ${card.color}`}>{formatValue(card.value)}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('adminOneTruthCoverageSources')}</p>
        {(coverage.sources || []).map((source) => (
          <div key={source.key} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-gray-800 bg-gray-900/40 px-4 py-2.5 text-sm">
            <span className="font-medium text-gray-200">{sourceLabel(source.key)}</span>
            <span className="text-xs text-gray-500">
              {t('adminOneTruthCoverageAsOf')}: {formatAsOf(source.asOf)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── P1 item 12.4: suspect queue ops filters ─────────────────────────────────

function SuspectFilters({ meta, values, onChange, onClear }) {
  const { t } = useTranslation();
  const set = (key) => (event) => onChange({ ...values, [key]: event.target.value });
  const reviewOptions = [
    { value: 'all', labelKey: 'adminOneTruthFilterAllReviewed' },
    { value: 'open', labelKey: 'adminOneTruthFilterOpen' },
    { value: 'reviewed', labelKey: 'adminOneTruthFilterReviewedStatus' },
    { value: 'confirmed', labelKey: 'adminOneTruthFilterConfirmed' },
    { value: 'dismissed', labelKey: 'adminOneTruthFilterDismissed' },
  ];
  const selectClass = 'rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none focus:border-orange-500';
  const inputClass = 'w-24 rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none focus:border-orange-500';

  return (
    <div className="rounded-3xl border border-gray-800 bg-[#111318] p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">{t('adminOneTruthFilterSignal')}</span>
          <select value={values.signal} onChange={set('signal')} className={selectClass}>
            <option value="">{t('adminOneTruthFilterAllSignals')}</option>
            {(meta?.signalTypes || []).map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">{t('adminOneTruthFilterMinScore')}</span>
          <input value={values.minScore} onChange={set('minScore')} inputMode="numeric" placeholder="0" className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">{t('adminOneTruthFilterMaxScore')}</span>
          <input value={values.maxScore} onChange={set('maxScore')} inputMode="numeric" placeholder="99" className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">{t('adminOneTruthFilterReviewed')}</span>
          <select value={values.reviewed} onChange={set('reviewed')} className={selectClass}>
            {reviewOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">{t('adminOneTruthFilterCohort')}</span>
          <select value={values.cohort} onChange={set('cohort')} className={selectClass}>
            <option value="">{t('adminOneTruthFilterAllCohorts')}</option>
            {(meta?.cohorts || []).map((cohort) => (
              <option key={cohort} value={cohort}>{cohort}</option>
            ))}
          </select>
        </label>
        <button
          onClick={onClear}
          className="rounded-xl border border-gray-700 px-3 py-2 text-sm text-gray-300 transition hover:border-gray-500 hover:text-white"
        >
          {t('adminOneTruthFilterClear')}
        </button>
      </div>
    </div>
  );
}

// ── P1 item 12.3: side-by-side evidence / counterevidence drawer ────────────

function evidenceRows(userA, userB, t) {
  const name = (u) => [u.first_name, u.last_name].filter(Boolean).join(' ') || '—';
  const location = (u) => [u.city, u.state, u.country].filter(Boolean).join(', ') || '—';
  const yesNo = (v) => (v ? t('common.yes') : t('common.no'));
  const rows = [
    { labelKey: 'adminOneTruthEvidenceName', a: name(userA), b: name(userB) },
    { labelKey: 'adminOneTruthEvidenceEmail', a: userA.email || '—', b: userB.email || '—' },
    { labelKey: 'adminOneTruthEvidencePhone', a: userA.phone || userA.phone_number || '—', b: userB.phone || userB.phone_number || '—' },
    { labelKey: 'adminOneTruthEvidenceLastIp', a: userA.last_login_ip || '—', b: userB.last_login_ip || '—' },
    { labelKey: 'adminOneTruthEvidenceDevice', a: (userA.terms_acceptance_ua || '—').slice(0, 80), b: (userB.terms_acceptance_ua || '—').slice(0, 80) },
    { labelKey: 'adminOneTruthEvidenceIdentity', a: yesNo(userA.identity_verified), b: yesNo(userB.identity_verified) },
    { labelKey: 'adminOneTruthEvidenceDidit', a: userA.didit_identity_hash ? t('adminOneTruthEvidencePresent') : t('adminOneTruthEvidenceAbsent'), b: userB.didit_identity_hash ? t('adminOneTruthEvidencePresent') : t('adminOneTruthEvidenceAbsent') },
    { labelKey: 'adminOneTruthEvidenceReferral', a: userA.referral_code || userA.referred_by || '—', b: userB.referral_code || userB.referred_by || '—' },
    { labelKey: 'adminOneTruthEvidenceCreated', a: userA.created_at ? new Date(userA.created_at).toLocaleDateString() : '—', b: userB.created_at ? new Date(userB.created_at).toLocaleDateString() : '—' },
    { labelKey: 'adminOneTruthEvidenceLocation', a: location(userA), b: location(userB) },
    { labelKey: 'adminOneTruthEvidenceBusinesses', a: String(userA.businesses?.length ?? userA.business_count ?? 0), b: String(userB.businesses?.length ?? userB.business_count ?? 0) },
    { labelKey: 'adminOneTruthEvidenceJobs', a: `${userA.ops?.jobsPosted || 0} / ${userA.ops?.jobsWorked || 0}`, b: `${userB.ops?.jobsPosted || 0} / ${userB.ops?.jobsWorked || 0}` },
  ];
  return rows.map((row) => ({
    ...row,
    match: row.a !== '—' && row.b !== '—' && String(row.a).toLowerCase() === String(row.b).toLowerCase(),
  }));
}

function EvidenceDrawer({ pair, onClose, onReviewSaved }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [saving, setSaving] = useState('');
  const [saveError, setSaveError] = useState('');
  if (!pair) return null;

  const rows = evidenceRows(pair.userA, pair.userB, t);
  const handoffs = [
    { labelKey: 'adminOneTruthHandoffModeration', to: '/admin/moderation' },
    { labelKey: 'adminOneTruthHandoffEnforcement', to: '/admin/enforcement' },
  ];

  const saveReview = async (status) => {
    setSaving(status);
    setSaveError('');
    try {
      const { data } = await adminApi.post('/admin/one-truth/pairs/review', {
        userAId: pair.userA.id,
        userBId: pair.userB.id,
        status,
      });
      onReviewSaved(pair.pairKey || pair.id, data.review);
    } catch {
      setSaveError(t('adminOneTruthReviewFailed'));
    } finally {
      setSaving('');
    }
  };

  const reviewButtons = [
    { status: 'reviewed', labelKey: 'adminOneTruthMarkReviewed' },
    { status: 'confirmed', labelKey: 'adminOneTruthMarkConfirmed' },
    { status: 'dismissed', labelKey: 'adminOneTruthMarkDismissed' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-2xl flex-col overflow-hidden bg-[#111318] shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('adminOneTruthEvidenceTitle')}</p>
            <p className="mt-1 text-sm text-gray-300">
              {[pair.userA.first_name, pair.userA.last_name].filter(Boolean).join(' ') || pair.userA.email}
              {'  vs  '}
              {[pair.userB.first_name, pair.userB.last_name].filter(Boolean).join(' ') || pair.userB.email}
            </p>
          </div>
          <button onClick={onClose} className="rounded-xl border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:border-gray-500 hover:text-white">
            {t('adminOneTruthEvidenceClose')}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="overflow-hidden rounded-2xl border border-gray-800">
            <div className="grid grid-cols-[1fr_1fr_1fr] gap-px bg-gray-800 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
              <div className="bg-[#111318] px-4 py-3">{t('adminOneTruthEvidenceField')}</div>
              <div className="bg-[#111318] px-4 py-3">{t('adminOneTruthEvidenceSideA')}</div>
              <div className="bg-[#111318] px-4 py-3">{t('adminOneTruthEvidenceSideB')}</div>
            </div>
            {rows.map((row) => (
              <div key={row.labelKey} className={`grid grid-cols-[1fr_1fr_1fr] gap-px bg-gray-800 text-sm ${row.match ? 'bg-emerald-500/5' : ''}`}>
                <div className="bg-[#14171d] px-4 py-2.5 font-medium text-gray-400">
                  {t(row.labelKey)}
                  <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${row.match ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-700/60 text-gray-400'}`}>
                    {row.match ? t('adminOneTruthEvidenceMatch') : t('adminOneTruthEvidenceDiffers')}
                  </span>
                </div>
                <div className="break-words bg-[#111318] px-4 py-2.5 text-gray-200">{row.a}</div>
                <div className="break-words bg-[#111318] px-4 py-2.5 text-gray-200">{row.b}</div>
              </div>
            ))}
          </div>

          <p className="mt-3 text-xs leading-5 text-gray-500">{t('adminOneTruthEvidenceHint')}</p>

          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('adminOneTruthHandoffsTitle')}</p>
            <div className="flex flex-wrap gap-2">
              {[pair.userA, pair.userB].map((user, index) => (
                <button
                  key={user.id || index}
                  onClick={() => navigate(`/admin/customers/${user.id}/360`)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 transition hover:border-sky-500/50"
                >
                  {t('adminOneTruthHandoffCustomer')} {index === 0 ? 'A' : 'B'}
                  <ExternalLink className="h-3 w-3" />
                </button>
              ))}
              {[pair.userA, pair.userB].map((user, index) => (user.businesses?.[0] ? (
                <button
                  key={`biz-${user.id || index}`}
                  onClick={() => navigate(`/admin/businesses/${user.businesses[0].id}/360`)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-300 transition hover:border-violet-500/50"
                >
                  {t('adminOneTruthHandoffBusiness')} {index === 0 ? 'A' : 'B'}
                  <ExternalLink className="h-3 w-3" />
                </button>
              ) : null))}
              {handoffs.map((handoff) => (
                <button
                  key={handoff.to}
                  onClick={() => navigate(handoff.to)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-gray-700 bg-gray-900/70 px-3 py-1.5 text-xs font-medium text-gray-300 transition hover:border-gray-500 hover:text-white"
                >
                  {t(handoff.labelKey)}
                  <ExternalLink className="h-3 w-3" />
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-gray-800 p-5">
          {saveError && <p className="mb-3 text-sm text-red-400">{saveError}</p>}
          <div className="flex flex-wrap gap-2">
            {reviewButtons.map((button) => (
              <button
                key={button.status}
                onClick={() => saveReview(button.status)}
                disabled={saving !== ''}
                className="rounded-2xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50"
              >
                {saving === button.status ? t('common.saving') : t(button.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── P1 item 11/12.2/12.5: request investigation access ───────────────────────

function AccessRequestPanel() {
  const { t } = useTranslation();
  const [approverEmail, setApproverEmail] = useState('');
  const [purpose, setPurpose] = useState('');
  const [scope, setScope] = useState('');
  const [investigationRef, setInvestigationRef] = useState('');
  const [expiryHours, setExpiryHours] = useState('24');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setSending(true);
    setError('');
    try {
      await adminApi.post('/admin/one-truth/access-request', {
        approver_email: approverEmail.trim(),
        purpose: purpose.trim(),
        scope: scope.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean),
        investigation_ref: investigationRef.trim(),
        expires_at: new Date(Date.now() + Number(expiryHours) * 3600 * 1000).toISOString(),
      });
      setSent(true);
    } catch (err) {
      setError(err.response?.data?.error || t('adminOneTruthAccessFailed'));
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl border border-emerald-500/25 bg-emerald-500/5 p-8 text-center">
        <CheckCircle className="mx-auto mb-3 h-10 w-10 text-emerald-400" />
        <p className="text-lg font-semibold text-white">{t('adminOneTruthAccessRequestTitle')}</p>
        <p className="mt-2 text-sm leading-6 text-gray-300">{t('adminOneTruthAccessPending')}</p>
      </div>
    );
  }

  const inputClass = 'w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white outline-none transition focus:border-orange-500';

  return (
    <div className="mx-auto max-w-xl rounded-3xl border border-gray-800 bg-[#111318] p-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-500/25 bg-orange-500/10">
          <KeyRound className="h-5 w-5 text-orange-400" />
        </div>
        <div>
          <p className="text-lg font-semibold text-white">{t('adminOneTruthAccessRequiredTitle')}</p>
          <p className="mt-1 text-sm leading-6 text-gray-400">{t('adminOneTruthAccessRequiredText')}</p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('adminOneTruthAccessApproverEmail')}</span>
          <input value={approverEmail} onChange={(e) => setApproverEmail(e.target.value)} required type="email" className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('adminOneTruthAccessPurpose')}</span>
          <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} required rows={3} placeholder={t('adminOneTruthAccessPurposePlaceholder')} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('adminOneTruthAccessScope')}</span>
          <textarea value={scope} onChange={(e) => setScope(e.target.value)} required rows={3} placeholder={t('adminOneTruthAccessScopePlaceholder')} className={inputClass} />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('adminOneTruthAccessRef')}</span>
            <input value={investigationRef} onChange={(e) => setInvestigationRef(e.target.value)} className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('adminOneTruthAccessExpiry')}</span>
            <select value={expiryHours} onChange={(e) => setExpiryHours(e.target.value)} className={inputClass}>
              <option value="24">{t('adminOneTruthAccessExpiry24')}</option>
              <option value="48">{t('adminOneTruthAccessExpiry48')}</option>
              <option value="72">{t('adminOneTruthAccessExpiry72')}</option>
            </select>
          </label>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={sending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
          {t('adminOneTruthAccessSubmit')}
        </button>
      </form>
    </div>
  );
}

export default function OneTruthPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [filtersData, setFiltersData] = useState({ countries: [], regions: [] });
  const [filtersLoading, setFiltersLoading] = useState(true);

  const [country, setCountry] = useState('');
  const [regionId, setRegionId] = useState('');

  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState('');

  // P1 item 11/12.2: when the read gate returns 403
  // investigation_access_required, the page becomes a request-access flow.
  const [accessDenied, setAccessDenied] = useState(false);

  const [tab, setTab] = useState('suspects');

  const [suspects, setSuspects] = useState([]);
  const [suspectTotal, setSuspectTotal] = useState(0);
  const [suspectPage, setSuspectPage] = useState(1);
  const [suspectPages, setSuspectPages] = useState(1);
  const [suspectLoading, setSuspectLoading] = useState(false);
  const [suspectError, setSuspectError] = useState('');
  const [suspectFilterMeta, setSuspectFilterMeta] = useState({ signalTypes: [], cohorts: [], reviewStatuses: [] });
  // P1 item 12.4: suspect queue ops filters.
  const [suspectFilters, setSuspectFilters] = useState({
    signal: '',
    minScore: '',
    maxScore: '',
    reviewed: 'all',
    cohort: '',
  });
  // P1 item 12.3: evidence drawer pair.
  const [evidencePair, setEvidencePair] = useState(null);

  const [users, setUsers] = useState([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userPage, setUserPage] = useState(1);
  const [userPages, setUserPages] = useState(1);
  const [userSearch, setUserSearch] = useState('');
  const [userSearchInput, setUserSearchInput] = useState('');

  // Typeahead suggestions from the latest loaded user rows.
  const oneTruthUserSuggestItems = useMemo(() => {
    const seen = new Set();
    const items = [];
    for (const user of users) {
      if (user.id == null || seen.has(user.id)) continue;
      seen.add(user.id);
      const title = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || String(user.id);
      items.push({ id: user.id, title, meta: user.email || undefined });
    }
    return items;
  }, [users]);
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

  // P1 item 11: a 403 with code investigation_access_required means the
  // analyst holds no active grant; the page switches to the request flow.
  const handleReadError = useCallback((err) => {
    if (err.response?.data?.code === 'investigation_access_required') {
      setAccessDenied(true);
      return true;
    }
    return false;
  }, []);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError('');
    try {
      const { data } = await adminApi.get('/admin/one-truth/stats', {
        params: activeScope,
      });
      setStats(data);
    } catch (err) {
      if (!handleReadError(err)) {
        setStatsError(err.response?.data?.error || err.message || t('adminOneTruthStatsFailed'));
      }
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, [activeScope.country, activeScope.regionId, t, handleReadError]);

  const loadSuspects = useCallback(async (page = 1, filters = suspectFilters) => {
    setSuspectLoading(true);
    setSuspectError('');
    try {
      const { data } = await adminApi.get('/admin/one-truth/suspects', {
        params: {
          page,
          limit: 20,
          ...activeScope,
          ...(filters.signal ? { signal: filters.signal } : {}),
          ...(filters.minScore !== '' ? { minScore: filters.minScore } : {}),
          ...(filters.maxScore !== '' ? { maxScore: filters.maxScore } : {}),
          ...(filters.reviewed && filters.reviewed !== 'all' ? { reviewed: filters.reviewed } : {}),
          ...(filters.cohort ? { cohort: filters.cohort } : {}),
        },
      });
      setSuspects(data.pairs || []);
      setSuspectTotal(data.total || 0);
      setSuspectPage(data.page || 1);
      setSuspectPages(data.totalPages || 1);
      setSuspectFilterMeta(data.filterMeta || { signalTypes: [], cohorts: [], reviewStatuses: [] });
    } catch (err) {
      if (!handleReadError(err)) {
        setSuspectError(err.response?.data?.error || err.message || t('adminOneTruthDetectionFailed'));
      }
    } finally {
      setSuspectLoading(false);
    }
  }, [activeScope.country, activeScope.regionId, t, suspectFilters, handleReadError]);

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
      if (!handleReadError(err)) {
        setUsersError(err.response?.data?.error || err.message || t('adminOneTruthUsersFailed'));
      }
    } finally {
      setUsersLoading(false);
    }
  }, [activeScope.country, activeScope.regionId, t, handleReadError]);

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

  const handleReviewSaved = useCallback((pairKey, review) => {
    setSuspects((prev) => prev.map((pair) =>
      (pair.pairKey || pair.id) === pairKey ? { ...pair, review } : pair
    ));
    setEvidencePair((prev) => (prev && (prev.pairKey || prev.id) === pairKey ? { ...prev, review } : prev));
  }, []);

  const handleSuspectFilterChange = (next) => {
    setSuspectFilters(next);
    setSuspectPage(1);
  };

  const handleSuspectFilterClear = () => {
    setSuspectFilters({ signal: '', minScore: '', maxScore: '', reviewed: 'all', cohort: '' });
    setSuspectPage(1);
  };

  // P1 item 11/12.2: no active grant — the page becomes the request flow.
  if (accessDenied) {
    return (
      <div className="min-h-screen bg-[#0b0d11] px-4 py-12 text-white sm:px-6">
        <AccessRequestPanel />
      </div>
    );
  }

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
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-300/80">{t('adminOneTruthSuperAdmin')}</p>
                      <h1 className="text-3xl font-semibold text-white">{t('adminOneTruthTitle')}</h1>
                    </div>
                  </div>
                  <p className="max-w-2xl text-sm leading-7 text-gray-300">
                    {t('adminOneTruthSubtitle')}
                  </p>
                </div>

                <button
                  onClick={handleRefresh}
                  className="inline-flex items-center gap-2 rounded-2xl border border-gray-700 bg-gray-900/70 px-3 py-2 text-sm text-gray-300 transition hover:text-white"
                >
                  <RefreshCw className={`h-4 w-4 ${statsLoading || suspectLoading || usersLoading ? 'animate-spin' : ''}`} />
                  {t('common.refresh')}
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                <ScopeBadge icon={Globe} label={t('adminOneTruthScopeCountry')} value={country || t('adminOneTruthAllMarkets')} />
                <ScopeBadge icon={Map} label={t('adminOneTruthScopeRegion')} value={selectedRegion?.name || t('adminOneTruthAllRegions')} />
                <ScopeBadge icon={Users} label={t('adminOneTruthScopePeople')} value={statsLoading ? '…' : formatValue(peopleStats.totalUsers)} />
                <ScopeBadge icon={Building2} label={t('adminOneTruthStatBusinesses')} value={statsLoading ? '…' : formatValue(peopleStats.totalBusinesses)} />
              </div>

              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <StatCard
                  icon={Users}
                  label={t('adminOneTruthStatUsersInScope')}
                  value={statsLoading ? '…' : formatValue(stats?.totalUsers)}
                  hint={t('adminOneTruthStatUsersInScopeHint')}
                  color="text-sky-300"
                />
                <StatCard
                  icon={Building2}
                  label={t('adminOneTruthStatBusinesses')}
                  value={statsLoading ? '…' : formatValue(stats?.totalBusinesses)}
                  hint={t('adminOneTruthStatBusinessesHint')}
                  color="text-blue-300"
                />
                <StatCard
                  icon={UserCheck}
                  label={t('adminOneTruthStatVerified')}
                  value={statsLoading ? '…' : formatValue(peopleStats.verifiedUsers)}
                  hint={t('adminOneTruthStatVerifiedHint')}
                  color="text-emerald-300"
                />
                <StatCard
                  icon={AlertTriangle}
                  label={t('adminOneTruthStatFlagged')}
                  value={suspectLoading ? '…' : formatValue(stats?.flaggedPairs ?? suspectTotal)}
                  hint={t('adminOneTruthStatFlaggedHint')}
                  color="text-orange-300"
                />
              </div>
            </div>

            <div className="rounded-[26px] border border-gray-800 bg-[#111318] p-5">
              <div className="mb-4 flex items-center gap-2">
                <Filter className="h-4 w-4 text-orange-400" />
                <p className="text-sm font-semibold text-white">{t('adminOneTruthScopeFilters')}</p>
              </div>

              <div className="space-y-4">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('adminOneTruthCountry')}</span>
                  <select
                    value={country}
                    onChange={(event) => setCountry(event.target.value)}
                    className="w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-3 text-sm text-white outline-none transition focus:border-orange-500"
                    disabled={filtersLoading}
                  >
                    <option value="">{t('adminOneTruthAllCountries')}</option>
                    {filtersData.countries.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.name} ({option.code})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('adminOneTruthRegion')}</span>
                  <select
                    value={regionId}
                    onChange={(event) => setRegionId(event.target.value)}
                    className="w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-3 text-sm text-white outline-none transition focus:border-orange-500"
                    disabled={filtersLoading}
                  >
                    <option value="">{t('adminOneTruthAllAdminRegions')}</option>
                    {filtersData.regions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}: {option.coverageLabel}{option.supported === false ? ` (${t('adminOneTruthRegionUnsupported')})` : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  onClick={clearFilters}
                  disabled={!country && !regionId}
                  className="w-full rounded-2xl border border-gray-700 px-3 py-2.5 text-sm font-medium text-gray-300 transition hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t('adminOneTruthClearScope')}
                </button>

                <div className="rounded-2xl border border-orange-500/20 bg-orange-500/6 p-4 text-sm leading-6 text-gray-300">
                  {t('adminOneTruthScopeHelp')}
                </div>
              </div>
            </div>
          </div>
        </div>

        {statsError && (
          <div className="rounded-2xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-300">
            {statsError}
          </div>
        )}

        {stats?.warnings?.length > 0 && (
          <div className="rounded-2xl border border-yellow-500/25 bg-yellow-500/8 p-4 text-sm text-yellow-200">
            <div className="mb-2 flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" />
              {t('adminOneTruthScopeNotes')}
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
          <MetricSectionCard sectionKey="consulting" stats={stats?.sections?.consulting} />
        </div>

        <CoverageCard coverage={stats?.coverage} />

        <div className="rounded-3xl border border-gray-800 bg-[#111318] p-5">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-orange-500/25 bg-orange-500/10">
              <Zap className="h-4 w-4 text-orange-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{t('adminOneTruthPolicyTitle')}</p>
              <p className="mt-1 text-sm leading-6 text-gray-400">
                {t('adminOneTruthPolicyText')}
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
              {t(item.labelKey)}
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
            <SuspectFilters
              meta={suspectFilterMeta}
              values={suspectFilters}
              onChange={handleSuspectFilterChange}
              onClear={handleSuspectFilterClear}
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-gray-400">
                {suspectLoading ? t('adminOneTruthRunningDetection') : t('adminOneTruthSuspectedPairs', { count: suspectTotal })}
              </p>
              <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-yellow-400" /> {t('adminOneTruthLegendLow')}</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-orange-400" /> {t('adminOneTruthLegendMedium')}</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-red-400" /> {t('adminOneTruthLegendHigh')}</span>
              </div>
            </div>

            {suspectLoading && (
              <div className="py-14 text-center text-gray-500">
                <RefreshCw className="mx-auto mb-3 h-6 w-6 animate-spin" />
                {t('adminOneTruthRunningDetection')}
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
                <p className="font-semibold text-emerald-400">{t('adminOneTruthNoSuspects')}</p>
                <p className="mt-1 text-sm text-gray-500">{t('adminOneTruthNoSuspectsHint')}</p>
              </div>
            )}

            {!suspectLoading && suspects.map((pair) => (
              <SuspectPairCard
                key={pair.pairKey || pair.id}
                pair={pair}
                onViewUser={handleViewUser}
                onCompare={setEvidencePair}
                onReviewSaved={handleReviewSaved}
              />
            ))}

            <Pagination page={suspectPage} totalPages={suspectPages} onPage={(page) => loadSuspects(page, suspectFilters)} />
          </div>
        )}

        {tab === 'users' && (
          <div className="space-y-4">
            <div className="rounded-3xl border border-gray-800 bg-[#111318] p-4">
              <form onSubmit={handleUserSearch} className="flex flex-col gap-3 lg:flex-row">
                <SuggestDropdown
                  id="one-truth-user-search"
                  items={oneTruthUserSuggestItems}
                  value={userSearchInput}
                  onQueryChange={setUserSearchInput}
                  onSelect={(item) => setUserSearchInput(item.title || '')}
                  recentsKey="oxsteed_admin_one_truth_user_search_recents"
                  placeholder={t('adminOneTruthUserSearchPlaceholder')}
                  ariaLabel={t('adminOneTruthUserSearchPlaceholder')}
                  className="sd-admin-dark flex-1"
                />
                <button
                  type="submit"
                  className="rounded-2xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-orange-600"
                >
                  {t('common.search')}
                </button>
              </form>

              <div className="mt-4 flex flex-wrap gap-2">
                <OperationChip label={t('adminOneTruthChipUsersInScope')} value={usersLoading ? '…' : userTotal.toLocaleString()} tone="cool" />
                <OperationChip label={t('adminOneTruthChipCountryFilter')} value={country || t('common.all')} />
                <OperationChip label={t('adminOneTruthChipRegionFilter')} value={selectedRegion?.name || t('common.all')} tone="violet" />
              </div>
            </div>

            {usersLoading && (
              <div className="py-12 text-center text-gray-500">
                <RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />
                {t('adminOneTruthLoadingUsers')}
              </div>
            )}

            {!usersLoading && usersError && (
              <div className="rounded-2xl border border-red-400/20 bg-red-400/5 py-8 text-center text-red-400">
                {usersError}
              </div>
            )}

            {!usersLoading && !usersError && users.length === 0 && (
              <div className="rounded-2xl border border-gray-800 bg-[#111318] py-12 text-center text-gray-500">
                {t('adminOneTruthNoUsers')}
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

        <EvidenceDrawer
          pair={evidencePair}
          onClose={() => setEvidencePair(null)}
          onReviewSaved={handleReviewSaved}
        />
      </div>
    </div>
  );
}
