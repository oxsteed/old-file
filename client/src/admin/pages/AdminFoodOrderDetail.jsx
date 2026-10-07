import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  FileText,
  Loader2,
  Package,
  RefreshCw,
  RotateCcw,
  UserRound,
  Utensils,
  WalletCards,
  XCircle,
} from 'lucide-react';

function formatMoney(cents, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
    }).format((Number(cents) || 0) / 100);
  } catch {
    return `${((Number(cents) || 0) / 100).toFixed(2)} ${currency || 'USD'}`;
  }
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function humanize(value, notProvidedLabel) {
  if (!value) return notProvidedLabel || 'Not provided';
  return String(value).replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(status) {
  switch (String(status || '').toLowerCase()) {
    case 'completed':
    case 'ready':
    case 'paid':
    case 'refunded':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    case 'confirmed':
    case 'accepted':
    case 'preparing':
    case 'partially_refunded':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    case 'cancelled':
    case 'failed':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-300';
    default:
      return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
  }
}

function StatusBadge({ children, status }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${statusTone(status)}`}>
      {children}
    </span>
  );
}

function DetailRow({ icon: Icon, label, value, valueClass = 'text-gray-200' }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-gray-800/80 bg-gray-950/35 px-3 py-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-600" />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-600">{label}</p>
        <p className={`mt-1 break-words text-sm ${valueClass}`}>{value || '—'}</p>
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, detail, tone = 'text-white' }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">{label}</p>
          <p className={`mt-2 truncate text-xl font-semibold sm:text-2xl ${tone}`}>{value}</p>
        </div>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-800 bg-gray-900/80">
          <Icon className="h-4 w-4 text-gray-400" />
        </span>
      </div>
      <p className="mt-2 truncate text-xs text-gray-600">{detail}</p>
    </div>
  );
}

function SectionCard({ eyebrow, title, detail, icon: Icon, children, className = '' }) {
  return (
    <section className={`rounded-3xl border border-gray-800 bg-[#111318] p-5 sm:p-6 ${className}`}>
      <div className="flex items-start gap-3">
        {Icon && (
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-orange-500/20 bg-orange-500/10 text-orange-300">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-300">{eyebrow}</p>}
          <h2 className="mt-1 text-lg font-semibold text-white">{title}</h2>
          {detail && <p className="mt-1 text-sm leading-6 text-gray-500">{detail}</p>}
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function LoadingState() {
  return (
    <div className="mx-auto w-full max-w-[1450px] space-y-6 p-4 pb-10 sm:p-6 lg:p-8">
      <div className="h-5 w-32 animate-pulse rounded bg-gray-800" />
      <div className="rounded-3xl border border-gray-800 bg-[#111318] p-6 sm:p-8">
        <div className="h-3 w-24 animate-pulse rounded bg-gray-800" />
        <div className="mt-4 h-9 w-64 animate-pulse rounded bg-gray-800" />
        <div className="mt-3 h-4 w-80 max-w-full animate-pulse rounded bg-gray-900" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => <div key={item} className="h-32 animate-pulse rounded-2xl border border-gray-800 bg-[#111318]" />)}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="h-80 animate-pulse rounded-3xl border border-gray-800 bg-[#111318]" />
        <div className="h-80 animate-pulse rounded-3xl border border-gray-800 bg-[#111318]" />
      </div>
    </div>
  );
}

export default function AdminFoodOrderDetail() {
  const { t } = useTranslation();
  const ta = (key, opts = {}) => t(`adminFoodOrderDetail.${key}`, opts);
  const { id } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refunding, setRefunding] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get(`/api/admin/food-orders/${id}`, {
        params: { purpose: 'admin_detail_view' },
      });
      setOrder(data.order);
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      console.error('Failed to load food order', err);
      setError(err.response?.data?.error || 'We could not load this order. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const handleRefund = async () => {
    setError('');
    setNotice('');
    if (!refundReason.trim()) {
      setError('A refund reason is required.');
      return;
    }

    const amount = refundAmount.trim() ? Number(refundAmount) : Number(order?.total_cents);
    if (!Number.isInteger(amount) || amount <= 0 || amount > Number(order?.total_cents)) {
      setError(`Enter a whole-number amount between 1 and ${order?.total_cents || 0} cents.`);
      return;
    }

    setRefunding(true);
    try {
      await axios.post(`/api/admin/food-orders/${id}/refund`, {
        amount_cents: refundAmount.trim() ? amount : undefined,
        reason: refundReason.trim(),
      });
      setNotice('Refund recorded successfully.');
      setRefundAmount('');
      setRefundReason('');
      await load();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'The refund could not be recorded.');
    } finally {
      setRefunding(false);
    }
  };

  if (loading && !order) return <LoadingState />;

  if (!order) {
    return (
      <div className="mx-auto w-full max-w-[900px] space-y-5 p-4 pb-10 sm:p-6 lg:p-8">
        <Link to="/admin/food-orders" className="inline-flex items-center gap-2 text-sm font-semibold text-gray-400 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Back to food orders
        </Link>
        <div role="alert" className="rounded-3xl border border-rose-500/30 bg-rose-950/20 p-8 text-center">
          <XCircle className="mx-auto h-9 w-9 text-rose-400" />
          <h1 className="mt-4 text-xl font-semibold text-white">{ta('notFound')}</h1>
          <p className="mt-2 text-sm text-gray-400">{error || 'This order may have been removed or you may not have access to it.'}</p>
          <button type="button" onClick={load} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-400">
            <RefreshCw className="h-4 w-4" /> Try again
          </button>
        </div>
      </div>
    );
  }

  const canRefund = ['paid', 'partially_refunded'].includes(order.payment_status);
  const currency = order.currency_code || 'USD';
  const metadata = typeof order.metadata === 'string'
    ? (() => { try { return JSON.parse(order.metadata); } catch { return {}; } })()
    : (order.metadata || {});
  const paymentMode = order.payment_mode || metadata.payment_mode || metadata.paymentMode || (order.stripe_payment_intent_id ? 'card' : '—');
  const guestContact = [order.guest_name, order.guest_phone, order.guest_email].filter(Boolean).join(' · ');

  return (
    <div className="min-h-full bg-gray-950 text-gray-100">
      <div className="mx-auto w-full max-w-[1450px] space-y-6 p-4 pb-10 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/admin/food-orders" className="inline-flex items-center gap-2 text-sm font-semibold text-gray-400 transition hover:text-white">
            <ArrowLeft className="h-4 w-4" /> Back to food orders
          </Link>
          <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900/70 px-3 py-2 text-sm font-semibold text-gray-300 transition hover:bg-gray-800 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        <header className="rounded-3xl border border-gray-800 bg-gradient-to-br from-[#17131d] via-[#111318] to-[#101923] p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-400">{ta('kicker')}</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Order #{order.id}</h1>
              <p className="mt-2 flex items-center gap-2 text-sm text-gray-400"><Utensils className="h-4 w-4 text-orange-300" /> {order.restaurant_name || ta('restaurantFallback')}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={order.status}>{humanize(order.status, ta('notProvided'))}</StatusBadge>
              <StatusBadge status={order.payment_status}>{humanize(order.payment_status, ta('notProvided'))}</StatusBadge>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/10 pt-4 text-xs text-gray-500">
            <span className="inline-flex items-center gap-2"><CalendarClock className="h-3.5 w-3.5" /> Created {formatDate(order.created_at)}</span>
            {order.updated_at && <span className="inline-flex items-center gap-2"><RefreshCw className="h-3.5 w-3.5" /> Updated {formatDate(order.updated_at)}</span>}
          </div>
        </header>

        {error && (
          <div role="alert" aria-live="assertive" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-500/30 bg-rose-950/25 px-4 py-3 text-sm text-rose-300">
            <span className="inline-flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" /> {error}</span>
            <button type="button" onClick={load} disabled={loading} className="rounded-lg border border-rose-400/30 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/10 disabled:opacity-50">{ta('retry')}</button>
          </div>
        )}
        {notice && <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-950/25 px-4 py-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" /> {notice}</div>}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={CircleDollarSign} label="Order total" value={formatMoney(order.total_cents, currency)} detail={currency} />
          <MetricCard icon={ClipboardList} label="Queue" value={order.queue_number || '—'} detail={humanize(order.fulfillment_type, ta('notProvided'))} />
          <MetricCard icon={Package} label="Items" value={items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)} detail={`${items.length} line item${items.length === 1 ? '' : 's'}`} />
          <MetricCard icon={CreditCard} label={ta('paymentMode')} value={humanize(paymentMode, ta('notProvided'))} detail={order.stripe_payment_intent_id ? ta('stripeAttached') : ta('noStripeIntent')} />
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <div className="space-y-6">
            <SectionCard eyebrow="Order contents" title="Items in this order" detail="Review quantities and recorded prices before taking an administrative action." icon={Package}>
              {items.length ? (
                <div className="overflow-hidden rounded-2xl border border-gray-800">
                  <div className="hidden grid-cols-[minmax(0,1fr)_80px_130px] gap-4 border-b border-gray-800 bg-gray-950/60 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500 sm:grid">
                    <span>{ta('itemHeader')}</span><span>{ta('qtyHeader')}</span><span className="text-right">{ta('priceHeader')}</span>
                  </div>
                  <div className="divide-y divide-gray-800">
                    {items.map((item) => (
                      <div key={item.id} className="grid gap-2 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_80px_130px] sm:items-center sm:gap-4">
                        <div className="min-w-0"><p className="truncate text-sm font-semibold text-gray-100">{item.name || ta('unnamedItem')}</p>{item.description && <p className="mt-1 truncate text-xs text-gray-500">{item.description}</p>}</div>
                        <p className="text-xs text-gray-500"><span className="sm:hidden">Qty </span>{item.quantity || 0}</p>
                        <p className="text-sm font-semibold text-gray-200 sm:text-right">{formatMoney(item.price_cents, currency)}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between border-t border-gray-800 bg-gray-950/60 px-4 py-4"><span className="text-sm font-semibold text-gray-400">{ta('orderTotal')}</span><span className="text-lg font-semibold text-white">{formatMoney(order.total_cents, currency)}</span></div>
                </div>
              ) : <p className="rounded-2xl border border-dashed border-gray-800 px-4 py-8 text-center text-sm text-gray-500">No line items were recorded for this order.</p>}
            </SectionCard>

            <SectionCard eyebrow="Customer and fulfillment" title="Order context" detail="The operational details associated with this order." icon={UserRound}>
              <div className="grid gap-3 sm:grid-cols-2">
                <DetailRow icon={UserRound} label={ta('guest')} value={guestContact || ta('noGuestDetails')} />
                <DetailRow icon={Utensils} label="Restaurant" value={order.restaurant_name} />
                <DetailRow icon={ClipboardList} label="Fulfillment" value={humanize(order.fulfillment_type, ta('notProvided'))} />
                <DetailRow icon={Package} label={ta('queueNumber')} value={order.queue_number || ta('notAssigned')} />
              </div>
            </SectionCard>
          </div>

          <div className="space-y-6">
            <SectionCard eyebrow="Payment and audit" title="Payment details" detail="Payment metadata is shown for administrative review." icon={WalletCards}>
              <div className="space-y-3">
                <DetailRow icon={CreditCard} label="Payment status" value={humanize(order.payment_status, ta('notProvided'))} valueClass="font-semibold" />
                <DetailRow icon={WalletCards} label={ta('paymentMode')} value={humanize(paymentMode, ta('notProvided'))} />
                <DetailRow icon={FileText} label={ta('stripeIntent')} value={order.stripe_payment_intent_id || ta('notProvided')} valueClass="font-mono text-xs" />
                <DetailRow icon={CalendarClock} label="Created" value={formatDate(order.created_at)} />
              </div>
            </SectionCard>

            {canRefund ? (
              <section className="rounded-3xl border border-amber-500/25 bg-gradient-to-br from-amber-950/25 to-[#111318] p-5 sm:p-6">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/10 text-amber-300"><RotateCcw className="h-4 w-4" /></span>
                  <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">{ta('financialAction')}</p><h2 className="mt-1 text-lg font-semibold text-white">{ta('refundTitle')}</h2><p className="mt-1 text-sm leading-6 text-gray-400">{ta('refundWarning')}</p></div>
                </div>
                <div className="mt-5 space-y-4">
                  <label className="block text-sm font-medium text-gray-300">Partial refund amount <span className="font-normal text-gray-500">(cents, optional)</span><input type="number" min="1" max={order.total_cents} step="1" inputMode="numeric" value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} placeholder={`Leave blank for full refund (${order.total_cents} cents)`} className="mt-2 w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white placeholder:text-gray-600 outline-none focus:border-amber-400" /></label>
                  <label className="block text-sm font-medium text-gray-300">Reason <span className="text-amber-300">*</span><textarea value={refundReason} onChange={(event) => setRefundReason(event.target.value)} rows={4} maxLength={500} placeholder="Explain why this refund is being issued" className="mt-2 w-full resize-y rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white placeholder:text-gray-600 outline-none focus:border-amber-400" /></label>
                  <button type="button" onClick={handleRefund} disabled={refunding} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-gray-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50">{refunding ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}{refunding ? ta('processingRefund') : ta('issueRefund')}</button>
                </div>
              </section>
            ) : (
              <section className="rounded-3xl border border-gray-800 bg-[#111318] p-5 sm:p-6">
                <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-800 bg-gray-900 text-gray-500"><CheckCircle2 className="h-4 w-4" /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">{ta('financialAction')}</p><h2 className="mt-1 text-lg font-semibold text-white">{ta('refundUnavailable')}</h2><p className="mt-1 text-sm leading-6 text-gray-500">{ta('refundUnavailableHint')}</p></div></div>
              </section>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-900 pt-2 text-xs text-gray-600">
          <span>Administrative order detail · access is recorded in the audit log.</span>
          <button type="button" onClick={() => navigate('/admin/food-orders')} className="inline-flex items-center gap-1 text-gray-500 hover:text-white">Return to all orders <ArrowLeft className="h-3.5 w-3.5 rotate-180" /></button>
        </div>
      </div>
    </div>
  );
}
