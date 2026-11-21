import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

function fmtCents(cents) {
  if (cents == null || Number.isNaN(Number(cents))) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(cents) / 100);
}

// Read-only buyer view of one marketplace order. No pay, refund, or
// edit actions live here; the fetch is buyer-scoped on the server.
// Group 1, item 35: the customer can open a return request here. A return
// request records the request only; it never issues a refund.
export default function MarketplaceOrderPage() {
  const { t } = useTranslation();
  const { orderId } = useParams();
  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);
  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [returnRequests, setReturnRequests] = useState([]);
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [returnError, setReturnError] = useState('');
  const [returnSaving, setReturnSaving] = useState(false);

  const loadReturns = () => {
    api.get(`/orders/${orderId}/return`)
      .then((r) => setReturnRequests(Array.isArray(r.data?.data) ? r.data.data : []))
      .catch(() => setReturnRequests([]));
  };

  async function submitReturn() {
    if (!returnReason.trim()) {
      setReturnError(t('lifePages.order.returnReasonRequired'));
      return;
    }
    setReturnSaving(true);
    setReturnError('');
    try {
      await api.post(`/orders/${orderId}/return`, { reason: returnReason.trim() });
      setReturnReason('');
      setShowReturnForm(false);
      loadReturns();
    } catch (err) {
      setReturnError(err?.response?.data?.error || err?.response?.data?.message || t('lifePages.order.returnFailed'));
    } finally {
      setReturnSaving(false);
    }
  }

  async function cancelReturn(returnId) {
    try {
      await api.post(`/orders/${orderId}/return/${returnId}/cancel`);
      loadReturns();
    } catch {
      // The request list refreshes below; a stale cancel surfaces there.
      loadReturns();
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setNotFound(false);
    api.get(`/carts/orders/${orderId}`)
      .then((r) => {
        if (cancelled) return;
        setOrder(r.data?.data?.order || null);
        setItems(Array.isArray(r.data?.data?.items) ? r.data.data.items : []);
        setPayment(r.data?.data?.payment || null);
        loadReturns();
      })
      .catch((err) => {
        if (cancelled) return;
        if (err?.response?.status === 404) setNotFound(true);
        else setFailed(true);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orderId, attempt]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg, #030712)', color: 'var(--color-text, #f3f4f6)' }}>
      <Navbar />
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-8 flex flex-col gap-6">
        {loading ? (
          <p className="text-sm" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>{t('lifePages.loading')}</p>
        ) : notFound ? (
          <div>
            <h1 className="text-2xl font-bold">{t('lifePages.order.notFound')}</h1>
            <p className="text-sm mt-2" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>{t('lifePages.order.notFoundBody')}</p>
            <Link to="/products" className="text-sm text-orange-400 underline mt-4 inline-block">{t('lifePages.order.backToProducts')}</Link>
          </div>
        ) : failed ? (
          <div role="alert" className="rounded-xl p-4 flex items-center justify-between gap-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <span className="text-sm" style={{ color: '#fca5a5' }}>{t('lifePages.loadFailed')}</span>
            <button type="button" onClick={() => setAttempt((a) => a + 1)} className="shrink-0 text-sm font-semibold text-red-300 underline">{t('common.retry')}</button>
          </div>
        ) : order ? (
          <>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{t('lifePages.order.title', { id: order.id })}</h1>
              <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>
                {order.created_at ? new Date(order.created_at).toLocaleString() : ''} · {t('lifePages.order.statusLabel', { status: order.status })}
              </p>
            </div>

            <section className="rounded-xl border border-border p-5">
              <h2 className="text-lg font-semibold mb-3">{t('lifePages.order.items')}</h2>
              {items.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>{t('lifePages.order.noItems')}</p>
              ) : (
                <ul className="divide-y">
                  {items.map((it) => (
                    <li key={it.id} className="py-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm truncate">{it.product_name}</div>
                        <div className="text-[11px]" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>
                          {t('lifePages.order.quantity', { count: it.quantity })} · {fmtCents(it.unit_price_cents)} {t('lifePages.order.each')}
                        </div>
                      </div>
                      <div className="text-sm font-semibold whitespace-nowrap">{fmtCents(it.total_price_cents)}</div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 space-y-1 text-sm">
                <div className="flex justify-between"><span>{t('lifePages.order.subtotal')}</span><span>{fmtCents(order.subtotal_cents)}</span></div>
                <div className="flex justify-between"><span>{t('lifePages.order.tax')}</span><span>{fmtCents(order.tax_cents)}</span></div>
                <div className="flex justify-between"><span>{t('lifePages.order.shipping')}</span><span>{fmtCents(order.shipping_cents)}</span></div>
                {Number(order.discount_cents) > 0 && (
                  <div className="flex justify-between"><span>{t('lifePages.order.discount')}</span><span>-{fmtCents(order.discount_cents)}</span></div>
                )}
                <div className="flex justify-between text-base font-bold pt-2 border-t" style={{ borderColor: 'var(--color-border, #1f2937)' }}>
                  <span>{t('lifePages.order.total')}</span><span>{fmtCents(order.total_cents)}</span>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-border p-5">
              <h2 className="text-lg font-semibold mb-3">{t('lifePages.order.payment')}</h2>
              {payment ? (
                <div className="text-sm space-y-1">
                  <div className="flex justify-between"><span>{t('lifePages.order.paymentStatus')}</span><span>{payment.status}</span></div>
                  <div className="flex justify-between"><span>{t('lifePages.order.paymentReference')}</span><span className="break-all">{payment.payment_intent_id}</span></div>
                  <div className="flex justify-between"><span>{t('lifePages.order.paymentAmount')}</span><span>{fmtCents(payment.amount_cents)}</span></div>
                </div>
              ) : (
                <p className="text-sm" style={{ color: 'var(--color-text-muted, #9ca3af)' }}>{t('lifePages.order.noPayment')}</p>
              )}
            </section>

            {/* Group 1, item 35: return requests. A request records the
                return; it never issues a refund. */}
            <section className="rounded-xl border border-border p-5">
              <h2 className="text-lg font-semibold mb-3">{t('lifePages.order.returnsTitle')}</h2>
              {returnRequests.length > 0 && (
                <ul className="space-y-2 mb-3">
                  {returnRequests.map((rr) => (
                    <li key={rr.id} className="text-sm flex items-start justify-between gap-3">
                      <span>
                        {t('lifePages.order.returnStatus', { status: rr.status })}
                        {rr.reason ? ` · ${rr.reason}` : ''}
                        {rr.admin_note ? ` · ${rr.admin_note}` : ''}
                      </span>
                      {rr.status === 'requested' && (
                        <button type="button" onClick={() => cancelReturn(rr.id)} className="shrink-0 text-sm text-orange-400 underline">
                          {t('common.cancel')}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {['paid', 'processing', 'completed'].includes(order.status)
                && !returnRequests.some((rr) => ['requested', 'approved'].includes(rr.status)) && (
                <>
                  {!showReturnForm ? (
                    <button
                      type="button"
                      onClick={() => setShowReturnForm(true)}
                      className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold"
                    >
                      {t('lifePages.order.requestReturn')}
                    </button>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <label htmlFor="return-reason" className="text-sm font-medium">{t('lifePages.order.returnReasonLabel')}</label>
                      <textarea
                        id="return-reason"
                        rows={3}
                        maxLength={1000}
                        value={returnReason}
                        onChange={(e) => setReturnReason(e.target.value)}
                        placeholder={t('lifePages.order.returnReasonPlaceholder')}
                        className="rounded-lg border border-border p-2 text-sm bg-transparent"
                      />
                      <p className="text-xs text-muted">
                        {t('lifePages.order.returnNoRefundNote')}
                      </p>
                      {returnError && <p role="alert" className="text-sm text-red-300">{returnError}</p>}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={submitReturn}
                          disabled={returnSaving}
                          className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold disabled:opacity-50"
                        >
                          {t('lifePages.order.submitReturn')}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowReturnForm(false); setReturnError(''); }}
                          className="px-4 py-2 rounded-xl border border-border text-sm"
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
              {!['paid', 'processing', 'completed'].includes(order.status) && returnRequests.length === 0 && (
                <p className="text-sm text-muted">
                  {t('lifePages.order.returnNotAvailable')}
                </p>
              )}
            </section>
          </>
        ) : null}
      </main>
      <Footer />
    </div>
  );
}
