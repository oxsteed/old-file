import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Clock3, RefreshCw, ShieldCheck, Store, WalletCards, X } from 'lucide-react';
import adminApi from '../../../lib/adminApi';

function money(cents, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format((Number(cents) || 0) / 100);
  } catch {
    return `${((Number(cents) || 0) / 100).toFixed(2)} ${currency || 'USD'}`;
  }
}

function dateTime(value) {
  if (!value) return 'Not posted';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function statusClass(status) {
  if (['active', 'posted'].includes(status)) return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (['pending', 'captured', 'released'].includes(status)) return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
  if (['suspended', 'expired', 'reversed', 'voided'].includes(status)) return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  return 'border-gray-700 bg-gray-900 text-gray-400';
}

function Badge({ status }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${statusClass(status)}`}>{String(status || 'unknown').replace(/_/g, ' ')}</span>;
}

function transactionLabel(transaction) {
  const labels = {
    load: 'Credit grant',
    purchase: 'Restaurant purchase',
    refund: 'Purchase refund',
    transfer: 'Customer transfer',
    adjustment: 'Account adjustment',
    settlement: 'Partner settlement',
    fee: 'Credit fee',
    expiration: 'Credit expiration',
    chargeback: 'Chargeback',
  };
  return labels[transaction.transactionType] || String(transaction.transactionType || 'Ledger transaction').replace(/_/g, ' ');
}

export default function OxsteedCreditCustomerDetail({ account, onClose, busy = false }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    if (!account?.customerId) return;
    setLoading(true);
    setError('');
    try {
      const [response, eligibleResponse] = await Promise.all([
        adminApi.get(`/admin/super/oxsteed-credit/accounts/${account.customerId}`, { params: { currencyCode: account.currencyCode } }),
        adminApi.get(`/admin/super/oxsteed-credit/accounts/${account.customerId}/eligible-partners`, { params: { currencyCode: account.currencyCode, limit: 50, offset: 0 } }).catch(() => null),
      ]);
      setDetail({
        ...(response.data || {}),
        eligiblePartners: eligibleResponse?.data?.partners || [],
        eligiblePartnerPagination: eligibleResponse?.data?.pagination || null,
      });
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Unable to load this customer Credit profile.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    if (!account?.customerId) return undefined;
    setDetail(null);
    setError('');
    setLoading(true);
    Promise.all([
      adminApi.get(`/admin/super/oxsteed-credit/accounts/${account.customerId}`, { params: { currencyCode: account.currencyCode } }),
      adminApi.get(`/admin/super/oxsteed-credit/accounts/${account.customerId}/eligible-partners`, { params: { currencyCode: account.currencyCode, limit: 50, offset: 0 } }).catch(() => null),
    ])
      .then(([response, eligibleResponse]) => { if (mounted) setDetail({ ...(response.data || {}), eligiblePartners: eligibleResponse?.data?.partners || [], eligiblePartnerPagination: eligibleResponse?.data?.pagination || null }); })
      .catch((err) => { if (mounted) setError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Unable to load this customer Credit profile.'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [account?.customerId, account?.currencyCode]);

  const profile = detail?.account || account;
  const transactions = detail?.transactions || [];
  const holds = detail?.holds || [];
  const entitlements = detail?.entitlements || [];
  const auditEvents = detail?.auditEvents || [];
  const disputes = detail?.disputes || [];
  const eligiblePartners = detail?.eligiblePartners || [];
  const eligiblePartnerPagination = detail?.eligiblePartnerPagination || null;

  return <section className="rounded-2xl border border-sky-500/25 bg-[#0e1622] p-4 shadow-lg shadow-sky-950/10 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-sky-300">Customer 360</p>
        <h2 className="mt-1 text-lg font-semibold text-white">Credit profile and spend access</h2>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-gray-400">One read-only view of this customer wallet, all restaurant assignments, reserved funds, and ledger history. Assignment rows can cover multiple restaurants without combining their agreements or currencies.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={load} disabled={loading || busy || !account} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-950/60 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"><RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} /> Refresh profile</button>
        <button type="button" onClick={onClose} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-950/60 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800"><X className="h-3.5 w-3.5" /> Close</button>
      </div>
    </div>

    {error && <div className="mt-4 rounded-xl border border-red-500/30 bg-red-950/20 px-3 py-3 text-xs text-red-300">{error}</div>}
    {loading && !detail && <div className="mt-5 rounded-xl border border-gray-800 bg-gray-950/40 px-4 py-10 text-center text-sm text-gray-500">Loading the customer Credit profile...</div>}
    {!loading && !error && detail && <>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-xl border border-gray-800 bg-gray-950/45 p-3 sm:col-span-2"><div className="flex items-center gap-2"><WalletCards className="h-4 w-4 text-orange-400" /><strong className="text-sm text-white">{profile.name || 'Unnamed customer'}</strong></div><p className="mt-1 text-xs text-gray-500">{profile.email || 'No email on file'}</p><p className="mt-2 break-all font-mono text-[10px] text-gray-700">{profile.customerId}</p></div>
        <div className="rounded-xl border border-gray-800 bg-gray-950/45 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">Balance</span><strong className="mt-2 block text-lg text-white">{money(profile.balanceCents, profile.currencyCode)}</strong></div>
        <div className="rounded-xl border border-gray-800 bg-gray-950/45 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">Available</span><strong className="mt-2 block text-lg text-emerald-300">{money(profile.availableBalanceCents, profile.currencyCode)}</strong></div>
        <div className="rounded-xl border border-gray-800 bg-gray-950/45 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">Wallet state</span><div className="mt-2"><Badge status={profile.status} /></div><p className="mt-2 text-[10px] text-gray-600">Ledger v{profile.ledgerVersion || 0} · {profile.currencyCode}</p></div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-xl border border-gray-800 bg-gray-950/35 p-4">
          <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange-400">Spend permissions</p><h3 className="mt-1 text-sm font-semibold text-white">Restaurant assignments</h3></div><span className="rounded-full border border-gray-700 px-2 py-1 text-[10px] font-semibold text-gray-500">{entitlements.length} records</span></div>
          <div className="mt-3 space-y-2">{!entitlements.length ? <p className="rounded-lg border border-dashed border-gray-800 px-3 py-6 text-center text-xs text-gray-600">No customer-specific assignments. Partner-wide agreements may still apply.</p> : entitlements.map((entitlement) => <div key={entitlement.id} className="rounded-lg border border-gray-800 bg-gray-950/55 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div className="flex items-center gap-2"><Store className="h-4 w-4 text-sky-300" /><strong className="text-sm text-white">{entitlement.restaurantName || `Restaurant ${entitlement.restaurantId}`}</strong></div><Badge status={entitlement.status} /></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500"><span>{entitlement.currencyCode || 'USD'}</span><span>Agreement v{entitlement.agreementVersion || '?'}</span>{entitlement.maxTransactionCents ? <span>Max {money(entitlement.maxTransactionCents, entitlement.currencyCode)}</span> : null}{entitlement.dailyLimitCents ? <span>Daily {money(entitlement.dailyLimitCents, entitlement.currencyCode)}</span> : null}</div>{entitlement.reason && <p className="mt-2 text-[11px] leading-4 text-gray-600">{entitlement.reason}</p>}</div>)}</div>
          <div className="mt-5 border-t border-gray-800 pt-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">Effective access</p><h4 className="mt-1 text-sm font-semibold text-white">Where this customer can spend now</h4></div><span className="rounded-full border border-emerald-500/25 px-2 py-1 text-[10px] font-semibold text-emerald-300">{eligiblePartners.length}{eligiblePartnerPagination?.hasMore ? '+' : ''} restaurants</span></div><p className="mt-2 text-[11px] leading-5 text-gray-500">This is the same centrally enforced eligibility result used by checkout, including rail status, wallet state, active agreements, entitlements, currency, and restaurant status.</p><div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">{!eligiblePartners.length ? <p className="rounded-lg border border-dashed border-gray-800 px-3 py-6 text-center text-xs text-gray-600">No restaurant is currently spendable for this customer and currency.</p> : eligiblePartners.map((partner) => <div key={partner.partnerId} className="rounded-lg border border-emerald-500/15 bg-emerald-950/10 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-300" /><strong className="text-sm text-white">{partner.restaurantName || 'Partner restaurant'}</strong></div><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-300">Spendable now</span></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500"><span>{[partner.city, partner.state].filter(Boolean).join(', ') || 'Location not listed'}</span><span>{partner.currencyCode || profile.currencyCode}</span>{partner.allowedOrderTypes?.length ? <span>{partner.allowedOrderTypes.join(', ')}</span> : null}{partner.maxTransactionCents ? <span>Max {money(partner.maxTransactionCents, partner.currencyCode)}</span> : null}{partner.dailyCustomerLimitCents ? <span>Daily {money(partner.dailyCustomerLimitCents, partner.currencyCode)}</span> : null}</div></div>)}</div></div>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-950/35 p-4">
          <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange-400">Reserved funds</p><h3 className="mt-1 text-sm font-semibold text-white">Holds and authorizations</h3></div><span className="rounded-full border border-gray-700 px-2 py-1 text-[10px] font-semibold text-gray-500">{holds.length} records</span></div>
          <div className="mt-3 space-y-2">{!holds.length ? <p className="rounded-lg border border-dashed border-gray-800 px-3 py-6 text-center text-xs text-gray-600">No holds recorded for this wallet.</p> : holds.map((hold) => <div key={hold.id} className="rounded-lg border border-gray-800 bg-gray-950/55 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><strong className="text-sm text-white">{hold.restaurantName || 'Restaurant authorization'}</strong><p className="mt-1 text-xs text-gray-500">{money(hold.amountCents, hold.currencyCode)} · expires {dateTime(hold.expiresAt)}</p></div><Badge status={hold.status} /></div>{hold.referenceId && <p className="mt-2 break-all font-mono text-[10px] text-gray-700">Reference: {hold.referenceId}</p>}</div>)}</div>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-950/10 p-4">
        <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">Customer reviews</p><h3 className="mt-1 text-sm font-semibold text-white">Credit disputes</h3></div><span className="inline-flex items-center gap-1.5 rounded-full border border-gray-700 px-2 py-1 text-[10px] font-semibold text-gray-500"><AlertTriangle className="h-3 w-3 text-amber-300" /> {disputes.length} records</span></div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">{!disputes.length ? <p className="rounded-lg border border-dashed border-gray-800 px-3 py-6 text-center text-xs text-gray-600 md:col-span-2">No Credit disputes recorded for this customer.</p> : disputes.map((dispute) => <div key={dispute.id} className="rounded-lg border border-gray-800 bg-gray-950/55 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><strong className="text-sm text-white">{dispute.restaurantName || 'OxSteed Credit transaction'}</strong><Badge status={dispute.status} /></div><p className="mt-2 text-[11px] font-semibold capitalize text-amber-200">{String(dispute.reasonCode || 'other').replace(/_/g, ' ')}</p>{dispute.amountCents !== null && dispute.amountCents !== undefined && <p className="mt-1 text-[11px] text-gray-500">{money(dispute.amountCents, dispute.currencyCode || profile.currencyCode)} · {String(dispute.transactionType || 'transaction').replace(/_/g, ' ')}</p>}<p className="mt-1 text-[11px] leading-4 text-gray-400">{dispute.description}</p><p className="mt-2 break-all font-mono text-[10px] text-gray-700">Transaction {dispute.transactionId} · Opened {dateTime(dispute.openedAt)}</p>{dispute.resolution && <p className="mt-2 text-[11px] leading-4 text-emerald-300">Resolution: {dispute.resolution}</p>}</div>)}</div>
      </div>

      <div className="mt-5 rounded-xl border border-gray-800 bg-gray-950/35 p-4">
        <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange-400">Ledger activity</p><h3 className="mt-1 text-sm font-semibold text-white">Recent wallet transactions</h3></div><span className="rounded-full border border-gray-700 px-2 py-1 text-[10px] font-semibold text-gray-500">Latest {transactions.length}</span></div>
        <div className="mt-3 overflow-x-auto rounded-lg border border-gray-800"><table className="min-w-[920px] w-full text-left text-xs"><thead className="bg-gray-950/75 text-gray-500"><tr><th className="px-3 py-3 font-medium">When</th><th className="px-3 py-3 font-medium">Activity</th><th className="px-3 py-3 font-medium">Restaurant</th><th className="px-3 py-3 font-medium">Status</th><th className="px-3 py-3 font-medium">Amount</th><th className="px-3 py-3 font-medium">Reference</th></tr></thead><tbody className="divide-y divide-gray-800">{!transactions.length ? <tr><td colSpan="6" className="px-3 py-8 text-center text-gray-600">No ledger activity for this wallet yet.</td></tr> : transactions.map((transaction) => { const debit = transaction.direction === 'debit'; return <tr key={transaction.id}><td className="px-3 py-3 text-gray-500">{dateTime(transaction.postedAt || transaction.createdAt)}</td><td className="px-3 py-3"><span className="inline-flex items-center gap-1.5 text-white">{debit ? <ArrowUpRight className="h-3.5 w-3.5 text-amber-300" /> : <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-300" />}{transactionLabel(transaction)}</span><p className="mt-1 text-gray-600">{transaction.description || transaction.actorType || 'Ledger entry'}</p></td><td className="px-3 py-3 text-gray-400">{transaction.restaurantName || 'OxSteed Credit'}</td><td className="px-3 py-3"><Badge status={transaction.status} /></td><td className={`px-3 py-3 font-semibold ${debit ? 'text-amber-300' : 'text-emerald-300'}`}>{debit ? '-' : '+'}{money(transaction.amountCents, transaction.currencyCode)}</td><td className="max-w-[220px] break-all px-3 py-3 font-mono text-[10px] text-gray-600">{transaction.orderId ? `Food order #${transaction.orderId}` : transaction.referenceId || transaction.id}</td></tr>; })}</tbody></table></div>
      </div>

      <div className="mt-5 rounded-xl border border-gray-800 bg-gray-950/35 p-4">
        <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange-400">Control history</p><h3 className="mt-1 text-sm font-semibold text-white">Customer Credit audit events</h3></div><span className="rounded-full border border-gray-700 px-2 py-1 text-[10px] font-semibold text-gray-500">Latest {auditEvents.length}</span></div>
        <div className="mt-3 space-y-2">{!auditEvents.length ? <p className="rounded-lg border border-dashed border-gray-800 px-3 py-6 text-center text-xs text-gray-600">No customer-specific Credit controls have been recorded.</p> : auditEvents.slice(0, 20).map((event) => <div key={event.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950/55 px-3 py-3"><div><strong className="font-mono text-[11px] text-orange-300">{event.actionType}</strong><p className="mt-1 text-xs text-gray-400">{event.reason || 'No reason recorded'}</p><p className="mt-1 text-[10px] text-gray-700">{event.resourceType} · {event.resourceId} · {event.actorUserId || 'System'}</p></div><span className="text-[10px] text-gray-600">{dateTime(event.createdAt)}</span></div>)}</div>
      </div>
    </>}
  </section>;
}
