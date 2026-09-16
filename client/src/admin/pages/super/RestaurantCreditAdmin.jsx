import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CreditCard,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Wallet,
  XCircle,
} from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import { formatCreditDateTime } from '../../../lib/creditDateTime';

const PAGE_SIZE = 25;

function getErrorMessage(error, fallback = 'Something went wrong.') {
  return error?.response?.data?.message || error?.response?.data?.error || fallback;
}

function money(cents, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format((Number(cents) || 0) / 100);
  } catch {
    return `${((Number(cents) || 0) / 100).toFixed(2)} ${currency || 'USD'}`;
  }
}

function dateTime(value) {
  return formatCreditDateTime(value, value ? 'Unknown time' : 'No activity yet');
}

function shortId(value) {
  if (!value) return '-';
  const text = String(value);
  return text.length > 14 ? `${text.slice(0, 8)}...${text.slice(-4)}` : text;
}

function statusTone(status) {
  switch (status) {
    case 'active':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    case 'suspended':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    case 'closed':
      return 'border-red-500/30 bg-red-500/10 text-red-300';
    case 'pending':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
    case 'approved':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    case 'cancelled':
    case 'expired':
      return 'border-gray-700 bg-gray-800/70 text-gray-400';
    default:
      return 'border-gray-700 bg-gray-900/70 text-gray-400';
  }
}

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${statusTone(status)}`}>
      {String(status || 'unknown').replace(/_/g, ' ')}
    </span>
  );
}

function MetricCard({ icon: Icon, label, value, hint, tone = 'text-white' }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">{label}</p>
          <p className={`mt-2 text-2xl font-semibold sm:text-3xl ${tone}`}>{value}</p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-800 bg-gray-900/80">
          <Icon className="h-4 w-4 text-gray-300" />
        </div>
      </div>
      <p className="mt-3 text-xs leading-5 text-gray-500">{hint}</p>
    </div>
  );
}

function EmptyState({ title, detail }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-800 bg-gray-950/30 px-5 py-10 text-center">
      <Wallet className="mx-auto h-8 w-8 text-gray-700" />
      <p className="mt-3 text-sm font-semibold text-gray-300">{title}</p>
      {detail && <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-gray-500">{detail}</p>}
    </div>
  );
}

function SectionHeader({ eyebrow, title, detail, action }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-orange-300">{eyebrow}</p>}
        <h2 className="mt-1 text-lg font-semibold text-white">{title}</h2>
        {detail && <p className="mt-1 text-sm leading-6 text-gray-500">{detail}</p>}
      </div>
      {action}
    </div>
  );
}

function ConfirmDialog({ modal, busy, error, onChange, onClose, onConfirm }) {
  if (!modal) return null;
  const needsReason = ['decline', 'release', 'status'].includes(modal.kind);
  const requiresReason = modal.kind === 'decline' || modal.kind === 'release' || (modal.kind === 'status' && modal.status === 'suspended');
  const isApproval = modal.kind === 'approve';
  const isStatus = modal.kind === 'status';
  const canConfirm = !busy && (!requiresReason || modal.reason?.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="restaurant-credit-dialog-title">
      <div className="w-full max-w-lg rounded-2xl border border-gray-700 bg-[#111318] p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-300">Confirm audited action</p>
            <h2 id="restaurant-credit-dialog-title" className="mt-2 text-xl font-semibold text-white">{modal.title}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-800 hover:text-white" aria-label="Close dialog">
            <XCircle className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-3 text-sm leading-6 text-gray-400">This action changes a live restaurant credit record and is written to the immutable operator audit trail.</p>

        {isStatus && (
          <label className="mt-5 block text-sm font-medium text-gray-300">
            New wallet status
            <select
              value={modal.status || 'suspended'}
              onChange={(event) => onChange({ status: event.target.value })}
              className="mt-2 w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-white outline-none focus:border-orange-400"
            >
              <option value="suspended">Suspended</option>
              <option value="active">Active</option>
            </select>
          </label>
        )}

        {isApproval ? (
          <label className="mt-5 block text-sm font-medium text-gray-300">
            Approval note <span className="font-normal text-gray-500">(optional)</span>
            <textarea
              value={modal.approvalNote || ''}
              onChange={(event) => onChange({ approvalNote: event.target.value })}
              rows={3}
              maxLength={500}
              placeholder="Why this load was approved"
              className="mt-2 w-full resize-y rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-white placeholder:text-gray-600 outline-none focus:border-orange-400"
            />
          </label>
        ) : needsReason ? (
          <label className="mt-5 block text-sm font-medium text-gray-300">
            Reason {requiresReason ? <span className="text-orange-300">*</span> : <span className="font-normal text-gray-500">(optional)</span>}
            <textarea
              value={modal.reason || ''}
              onChange={(event) => onChange({ reason: event.target.value })}
              rows={3}
              maxLength={500}
              placeholder="Enter a clear operational reason"
              className="mt-2 w-full resize-y rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-white placeholder:text-gray-600 outline-none focus:border-orange-400"
            />
          </label>
        ) : null}

        {error && <p className="mt-4 rounded-xl border border-red-500/30 bg-red-950/30 px-3 py-2 text-sm text-red-300">{error}</p>}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-gray-700 px-4 py-3 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={!canConfirm} className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirm action
          </button>
        </div>
      </div>
    </div>
  );
}

function WalletDetail({ detail, onStatus, onRelease }) {
  const wallet = detail.wallet;
  const canSuspend = wallet.status === 'active';
  const canChangeStatus = wallet.status !== 'closed';
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-300">Wallet detail</p>
          <h2 className="mt-1 truncate text-xl font-semibold text-white">{wallet.customerName || wallet.customerEmail || shortId(wallet.customerId)}</h2>
          <p className="mt-1 break-all text-xs text-gray-500">{wallet.customerEmail || wallet.customerId} · {wallet.restaurantName || shortId(wallet.restaurantId)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={wallet.status} />
          <button type="button" onClick={() => onStatus(wallet)} disabled={!canChangeStatus} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40">
            {wallet.status === 'closed' ? 'Wallet closed' : canSuspend ? 'Suspend wallet' : 'Reactivate wallet'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-800 bg-gray-950/40 p-3"><p className="text-xs text-gray-500">Ledger balance</p><p className="mt-1 text-lg font-semibold text-white">{money(wallet.balanceCents, wallet.currencyCode)}</p></div>
        <div className="rounded-xl border border-gray-800 bg-gray-950/40 p-3"><p className="text-xs text-gray-500">Reserved</p><p className="mt-1 text-lg font-semibold text-amber-300">{money(wallet.reservedCents, wallet.currencyCode)}</p></div>
        <div className="rounded-xl border border-gray-800 bg-gray-950/40 p-3"><p className="text-xs text-gray-500">Available</p><p className="mt-1 text-lg font-semibold text-emerald-300">{money(wallet.availableBalanceCents, wallet.currencyCode)}</p></div>
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-950/30 p-3 text-xs text-gray-500">
        <span className="font-semibold text-gray-300">Account:</span> {wallet.accountId} · <span className="font-semibold text-gray-300">Ledger version:</span> {wallet.ledgerVersion} · <span className="font-semibold text-gray-300">Updated:</span> {dateTime(wallet.updatedAt)}
      </div>

      <HistorySection title="Pending and past load requests" count={detail.loadRequests?.length}>
        {!detail.loadRequests?.length ? <p className="text-sm text-gray-500">No load requests for this wallet.</p> : (
          <div className="space-y-2">
            {detail.loadRequests.slice(0, 8).map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-800 bg-gray-950/35 p-3">
                <div><div className="flex flex-wrap items-center gap-2"><StatusBadge status={item.status} /><span className="text-sm font-semibold text-white">{money(item.amountCents, item.currencyCode)}</span></div><p className="mt-1 text-xs text-gray-500">{item.note || 'No note'} · {dateTime(item.createdAt)}</p></div>
                <span className="text-xs text-gray-600">#{item.id}</span>
              </div>
            ))}
          </div>
        )}
      </HistorySection>

      <HistorySection title="Active holds" count={detail.holds?.filter((hold) => hold.status === 'active').length || 0}>
        {!detail.holds?.length ? <p className="text-sm text-gray-500">No holds recorded.</p> : (
          <div className="space-y-2">
            {detail.holds.slice(0, 8).map((hold) => (
              <div key={hold.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-800 bg-gray-950/35 p-3">
                <div><div className="flex flex-wrap items-center gap-2"><StatusBadge status={hold.status} /><span className="text-sm font-semibold text-white">{money(hold.amountCents, hold.currencyCode)}</span></div><p className="mt-1 text-xs text-gray-500">{hold.purpose || 'Credit hold'} · {dateTime(hold.createdAt)}</p></div>
                {hold.status === 'active' && <button type="button" onClick={() => onRelease(hold)} className="rounded-lg border border-amber-500/40 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/10">Release hold</button>}
              </div>
            ))}
          </div>
        )}
      </HistorySection>

      <HistorySection title="Wallet transfers" count={detail.transfers?.length}>
        {!detail.transfers?.length ? <p className="text-sm text-gray-500">No wallet-to-wallet transfers recorded.</p> : (
          <div className="space-y-2">
            {detail.transfers.slice(0, 12).map((transfer) => {
              const outgoing = String(transfer.senderAccountId) === String(wallet.accountId);
              return <div key={transfer.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-800 bg-gray-950/35 p-3"><div><div className="flex flex-wrap items-center gap-2"><StatusBadge status={transfer.status} /><span className={`text-sm font-semibold ${outgoing ? 'text-red-300' : 'text-emerald-300'}`}>{outgoing ? '-' : '+'}{money(transfer.amountCents, transfer.currencyCode)}</span></div><p className="mt-1 text-xs text-gray-500">{outgoing ? 'To' : 'From'} wallet {shortId(outgoing ? transfer.recipientAccountId : transfer.senderAccountId)}{transfer.memo ? ` · ${transfer.memo}` : ''}</p></div><span className="text-xs text-gray-600">{dateTime(transfer.createdAt)}</span></div>;
            })}
          </div>
        )}
      </HistorySection>

      <HistorySection title="Ledger activity" count={detail.ledger?.length}>
        {!detail.ledger?.length ? <p className="text-sm text-gray-500">No ledger entries recorded.</p> : (
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="min-w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-2 font-medium">Entry</th><th className="px-3 py-2 font-medium">Amount</th><th className="px-3 py-2 font-medium">Balance after</th><th className="px-3 py-2 font-medium">Posted</th></tr></thead><tbody className="divide-y divide-gray-800">
              {detail.ledger.slice(0, 20).map((entry) => <tr key={entry.id} className="text-gray-300"><td className="px-3 py-2"><span className="font-semibold text-white">{entry.entryType}</span><span className="ml-2 text-gray-600">#{entry.id}</span><p className="mt-1 max-w-[220px] truncate text-gray-500">{entry.description || 'No description'}</p></td><td className="whitespace-nowrap px-3 py-2">{money(entry.amountCents, entry.currencyCode)}</td><td className="whitespace-nowrap px-3 py-2">{money(entry.balanceAfterCents, entry.currencyCode)}</td><td className="whitespace-nowrap px-3 py-2 text-gray-500">{dateTime(entry.createdAt)}</td></tr>)}
            </tbody></table>
          </div>
        )}
      </HistorySection>

      <HistorySection title="Operator audit history" count={detail.operatorAudit?.length}>
        {!detail.operatorAudit?.length ? <p className="text-sm text-gray-500">No operator actions recorded for this wallet.</p> : (
          <div className="space-y-2">{detail.operatorAudit.slice(0, 12).map((event) => <div key={event.id} className="rounded-xl border border-gray-800 bg-gray-950/35 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold text-white">{String(event.actionType || 'operator action').replace(/_/g, ' ')}</span><span className="text-xs text-gray-600">{dateTime(event.createdAt)}</span></div><p className="mt-1 text-xs text-gray-500">{event.operatorName || event.operatorEmail || 'System operator'} · correlation {shortId(event.correlationId)}</p></div>)}</div>
        )}
      </HistorySection>

      <HistorySection title="Wallet-linked payments" count={detail.payments?.length}>
        {!detail.payments?.length ? <p className="text-sm text-gray-500">No wallet-linked restaurant payments recorded.</p> : (
          <div className="overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-2 font-medium">Payment</th><th className="px-3 py-2 font-medium">Amount</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Created</th></tr></thead><tbody className="divide-y divide-gray-800">{detail.payments.slice(0, 12).map((payment) => <tr key={payment.id} className="text-gray-300"><td className="px-3 py-2"><span className="font-semibold text-white">{payment.paymentType || 'payment'}</span><p className="mt-1 text-gray-500">{payment.reference || payment.foodOrderId || `#${payment.id}`}</p></td><td className="whitespace-nowrap px-3 py-2">{money(payment.amountCents)}</td><td className="px-3 py-2"><StatusBadge status={payment.status} /></td><td className="whitespace-nowrap px-3 py-2 text-gray-500">{dateTime(payment.createdAt)}</td></tr>)}</tbody></table></div>
        )}
      </HistorySection>
    </div>
  );
}

function HistorySection({ title, count, children }) {
  return <section className="rounded-2xl border border-gray-800 bg-gray-950/20 p-4"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-white">{title}</h3><span className="text-xs text-gray-600">{count || 0}</span></div>{children}</section>;
}

export default function RestaurantCreditAdmin() {
  const [data, setData] = useState(null);
  const [detail, setDetail] = useState(null);
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState({ q: '', status: '', restaurantId: '' });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [modal, setModal] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {
        page,
        pageSize: PAGE_SIZE,
        ...(filters.q ? { q: filters.q } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.restaurantId ? { restaurantId: filters.restaurantId } : {}),
      };
      const response = await adminApi.get('/admin/super/restaurant-credit/overview', { params });
      setData(response.data);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load restaurant credit oversight.'));
    } finally {
      setLoading(false);
    }
  }, [filters.q, filters.restaurantId, filters.status, page]);

  const loadDetail = useCallback(async (accountId) => {
    if (!accountId) return;
    setDetailLoading(true);
    setDetailError('');
    try {
      const response = await adminApi.get(`/admin/super/restaurant-credit/wallets/${accountId}`);
      setDetail(response.data);
    } catch (err) {
      setDetail(null);
      setDetailError(getErrorMessage(err, 'Failed to load wallet detail.'));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { if (selectedAccountId) loadDetail(selectedAccountId); }, [loadDetail, selectedAccountId]);

  const refresh = async () => {
    await loadOverview();
    if (selectedAccountId) await loadDetail(selectedAccountId);
  };

  const selectWallet = (accountId) => {
    setSelectedAccountId(accountId);
    setDetail(null);
    setDetailError('');
  };

  const openModal = (nextModal) => {
    setActionError('');
    setModal(nextModal);
  };

  const runAction = async () => {
    if (!modal) return;
    setActionBusy(true);
    setActionError('');
    try {
      let path = '';
      let body = {};
      if (modal.kind === 'approve') {
        path = `/admin/super/restaurant-credit/load-requests/${modal.request.id}/approve`;
        body = { approvalNote: modal.approvalNote?.trim() || undefined };
      } else if (modal.kind === 'decline') {
        path = `/admin/super/restaurant-credit/load-requests/${modal.request.id}/decline`;
        body = { reason: modal.reason.trim() };
      } else if (modal.kind === 'release') {
        path = `/admin/super/restaurant-credit/holds/${modal.hold.id}/release`;
        body = { reason: modal.reason.trim() };
      } else if (modal.kind === 'status') {
        path = `/admin/super/restaurant-credit/wallets/${modal.wallet.accountId}/status`;
        body = { status: modal.status, reason: modal.reason?.trim() || undefined };
      }
      await adminApi.post(path, body);
      setModal(null);
      await refresh();
    } catch (err) {
      setActionError(getErrorMessage(err, 'The action could not be completed.'));
    } finally {
      setActionBusy(false);
    }
  };

  const summary = data?.summary || {};
  const pagination = data?.pagination || { page: 1, totalPages: 1, total: 0 };
  const wallets = data?.wallets || [];
  const pendingRequests = data?.pendingRequests || [];
  const summaryCurrency = Number(summary.currencyCount || 0) > 1 ? 'MULTI' : 'USD';
  const summaryMoney = (cents) => summaryCurrency === 'MULTI' ? 'Multiple' : money(cents, summaryCurrency);

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-6 pb-10">
      <header className="rounded-3xl border border-gray-800 bg-gradient-to-br from-[#17131d] via-[#111318] to-[#101923] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-300">Super Admin</span><span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300"><ShieldCheck className="h-3.5 w-3.5" /> Audit protected</span></div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Restaurant Credit Oversight</h1>
            <p className="mt-3 text-sm leading-6 text-gray-400 sm:text-base">See every restaurant-scoped customer wallet, load request, hold, payment reference, and operator action in one controlled workspace.</p>
          </div>
          <button type="button" onClick={refresh} disabled={loading || detailLoading} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900/70 px-4 py-3 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> Refresh data</button>
        </div>
      </header>

      {error && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-300"><span className="inline-flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{error}</span><button type="button" onClick={loadOverview} className="rounded-lg border border-red-500/40 px-3 py-2 font-semibold hover:bg-red-500/10">Retry</button></div>}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard icon={Wallet} label="Wallets" value={summary.totalWallets ?? '...'} hint={`${summary.totalRestaurants || 0} restaurants in scope`} />
        <MetricCard icon={CreditCard} label="Ledger balance" value={summaryMoney(summary.totalBalanceCents)} hint={`${summary.activeWallets || 0} active wallets`} />
        <MetricCard icon={CheckCircle2} label="Available" value={summaryMoney(summary.totalAvailableCents)} hint={`${summaryCurrency === 'MULTI' ? 'Multiple currencies' : summaryMoney(summary.totalReservedCents)} reserved`} tone="text-emerald-300" />
        <MetricCard icon={Clock3} label="Pending loads" value={summary.pendingLoadRequests ?? '...'} hint={summaryMoney(summary.pendingLoadAmountCents)} tone="text-sky-300" />
        <MetricCard icon={AlertTriangle} label="Active holds" value={summary.activeHolds ?? '...'} hint={summaryMoney(summary.activeHoldAmountCents)} tone="text-amber-300" />
      </section>

      <section className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <form className="min-w-0 flex-1" onSubmit={(event) => { event.preventDefault(); setPage(1); setFilters((current) => ({ ...current, q: searchInput.trim() })); }}>
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Search customer, email, restaurant, or wallet ID</label>
            <div className="mt-2 flex gap-2"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search restaurant credit..." className="w-full rounded-xl border border-gray-700 bg-gray-950 px-10 py-3 text-sm text-white placeholder:text-gray-600 outline-none focus:border-orange-400" /></div><button type="submit" className="rounded-xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-400">Search</button></div>
          </form>
          <label className="w-full lg:max-w-[220px]"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Wallet status</span><select value={filters.status} onChange={(event) => { setPage(1); setFilters((current) => ({ ...current, status: event.target.value })); }} className="mt-2 w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400"><option value="">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="closed">Closed</option></select></label>
          <label className="w-full lg:max-w-[260px]"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Restaurant</span><select value={filters.restaurantId} onChange={(event) => { setPage(1); setFilters((current) => ({ ...current, restaurantId: event.target.value })); }} className="mt-2 w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400"><option value="">All restaurants</option>{(data?.restaurants || []).map((restaurant) => <option key={restaurant.id} value={restaurant.id}>{restaurant.name}</option>)}</select></label>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500"><span>{pagination.total || 0} wallet accounts · results are restaurant-scoped and audit visible</span>{(filters.q || filters.status || filters.restaurantId) && <button type="button" onClick={() => { setSearchInput(''); setPage(1); setFilters({ q: '', status: '', restaurantId: '' }); }} className="font-semibold text-orange-300 hover:text-orange-200">Clear filters</button>}</div>
      </section>

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)]">
        <section className="min-w-0 rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5">
          <SectionHeader eyebrow="Wallet directory" title="Customer credit accounts" detail="Select an account to inspect the full ledger and linked operational history." />
          <div className="mt-5">
            {loading && !data ? <div className="flex items-center justify-center py-16 text-gray-500"><Loader2 className="h-6 w-6 animate-spin text-orange-400" /></div> : !wallets.length ? <EmptyState title="No wallet accounts found" detail="Wallets appear here after a customer has a restaurant-scoped credit account." /> : <div className="overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[720px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">Customer</th><th className="px-3 py-3 font-medium">Restaurant</th><th className="px-3 py-3 font-medium">Balance</th><th className="px-3 py-3 font-medium">Available</th><th className="px-3 py-3 font-medium">Status</th><th className="px-3 py-3 font-medium">Activity</th></tr></thead><tbody className="divide-y divide-gray-800">{wallets.map((wallet) => <tr key={wallet.accountId} onClick={() => selectWallet(wallet.accountId)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') selectWallet(wallet.accountId); }} tabIndex={0} className={`cursor-pointer text-gray-300 transition hover:bg-gray-900/70 focus:bg-gray-900/70 focus:outline-none ${String(selectedAccountId) === String(wallet.accountId) ? 'bg-orange-500/10' : ''}`}><td className="max-w-[220px] px-3 py-3"><p className="truncate font-semibold text-white">{wallet.customerName || wallet.customerEmail || shortId(wallet.customerId)}</p><p className="mt-1 truncate text-gray-600">{wallet.customerEmail || shortId(wallet.customerId)}</p></td><td className="max-w-[170px] truncate px-3 py-3 text-gray-400">{wallet.restaurantName || shortId(wallet.restaurantId)}</td><td className="whitespace-nowrap px-3 py-3 font-semibold text-white">{money(wallet.balanceCents, wallet.currencyCode)}</td><td className="whitespace-nowrap px-3 py-3 text-emerald-300">{money(wallet.availableBalanceCents, wallet.currencyCode)}</td><td className="px-3 py-3"><StatusBadge status={wallet.status} /></td><td className="whitespace-nowrap px-3 py-3 text-gray-500">{dateTime(wallet.lastActivityAt)}</td></tr>)}</tbody></table></div>}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-800 pt-4 text-xs text-gray-500"><span>Page {pagination.page || page} of {pagination.totalPages || 1}</span><div className="flex gap-2"><button type="button" disabled={(pagination.page || page) <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} className="inline-flex items-center gap-1 rounded-lg border border-gray-700 px-3 py-2 font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /> Previous</button><button type="button" disabled={(pagination.page || page) >= (pagination.totalPages || 1) || loading} onClick={() => setPage((current) => current + 1)} className="inline-flex items-center gap-1 rounded-lg border border-gray-700 px-3 py-2 font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-40">Next <ChevronRight className="h-4 w-4" /></button></div></div>
        </section>

        <aside className="min-w-0 rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5">
          {detailLoading ? <div className="flex items-center justify-center py-24 text-gray-500"><Loader2 className="h-6 w-6 animate-spin text-orange-400" /></div> : detailError ? <div className="space-y-3 py-16 text-center"><AlertTriangle className="mx-auto h-8 w-8 text-red-400" /><p className="text-sm text-red-300">{detailError}</p><button type="button" onClick={() => loadDetail(selectedAccountId)} className="rounded-lg border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800">Retry</button></div> : detail ? <WalletDetail detail={detail} onStatus={(wallet) => openModal({ kind: 'status', title: wallet.status === 'active' ? 'Suspend wallet' : 'Reactivate wallet', wallet, status: wallet.status === 'active' ? 'suspended' : 'active', reason: '' })} onRelease={(hold) => openModal({ kind: 'release', title: 'Release credit hold', hold, reason: '' })} /> : <div className="flex min-h-[360px] flex-col items-center justify-center text-center"><FileText className="h-9 w-9 text-gray-700" /><h2 className="mt-4 text-lg font-semibold text-white">Select a wallet</h2><p className="mt-2 max-w-sm text-sm leading-6 text-gray-500">The detail panel keeps the customer, restaurant, ledger, holds, payments, and operator history together.</p></div>}
        </aside>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5"><SectionHeader eyebrow="Maker-checker queue" title="Pending credit load requests" detail="Approvals post through the existing idempotent wallet ledger and require a second operator." />{!pendingRequests.length ? <div className="mt-5"><EmptyState title="No pending load requests" detail="New merchant load requests will appear here for review." /></div> : <div className="mt-5 space-y-3">{pendingRequests.slice(0, 8).map((request) => <div key={request.id} className="rounded-xl border border-gray-800 bg-gray-950/35 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><StatusBadge status={request.status} /><span className="text-base font-semibold text-white">{money(request.amountCents, request.currencyCode)}</span></div><p className="mt-2 text-sm text-gray-300">{request.customerName || request.customerEmail || shortId(request.customerId)}</p><p className="mt-1 text-xs text-gray-500">{request.restaurantName || shortId(request.restaurantId)} · requested by {request.requestedByName || shortId(request.requestedByUserId)} · {dateTime(request.createdAt)}</p>{request.note && <p className="mt-2 text-xs leading-5 text-gray-500">{request.note}</p>}</div><div className="flex shrink-0 gap-2"><button type="button" onClick={() => openModal({ kind: 'decline', title: 'Decline credit load', request, reason: '' })} className="rounded-lg border border-red-500/30 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/10">Decline</button><button type="button" onClick={() => openModal({ kind: 'approve', title: 'Approve credit load', request, approvalNote: '' })} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500">Approve</button></div></div></div>)}</div>}</section>
        <section className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5"><SectionHeader eyebrow="Audit stream" title="Recent wallet activity" detail="Ledger entries are append-only and include correlation and actor metadata." />{!data?.recentActivity?.length ? <div className="mt-5"><EmptyState title="No wallet activity yet" detail="Posted credits, debits, refunds, and adjustments will appear here." /></div> : <div className="mt-5 space-y-2">{data.recentActivity.slice(0, 10).map((entry) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-800 bg-gray-950/35 p-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-white">{entry.entryType}</span><span className="text-xs text-gray-600">{entry.customerName || shortId(entry.customerId)} · {entry.restaurantName || shortId(entry.restaurantId)}</span></div><p className="mt-1 truncate text-xs text-gray-500">{entry.description || 'No description'} · {dateTime(entry.createdAt)}</p></div><span className="whitespace-nowrap text-sm font-semibold text-gray-200">{money(entry.amountCents, entry.currencyCode)}</span></div>)}</div>}</section>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-sky-500/20 bg-sky-950/20 p-4 text-sm leading-6 text-sky-200"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" /><p><span className="font-semibold">Control boundary:</span> this console never edits the append-only ledger directly. Status changes, hold releases, and load approvals use transaction-safe services and create both wallet-operator and Super Admin audit entries.</p></div>

      <ConfirmDialog modal={modal} busy={actionBusy} error={actionError} onClose={() => { if (!actionBusy) setModal(null); }} onChange={(changes) => setModal((current) => ({ ...current, ...changes }))} onConfirm={runAction} />
    </main>
  );
}
