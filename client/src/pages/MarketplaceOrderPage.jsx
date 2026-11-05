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

// Read-only buyer view of one marketplace order. No pay, refund, cancel,
// or edit actions live here; the fetch is buyer-scoped on the server.
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

            <section className="rounded-xl border p-5" style={{ borderColor: 'var(--color-border, #1f2937)' }}>
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

            <section className="rounded-xl border p-5" style={{ borderColor: 'var(--color-border, #1f2937)' }}>
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
          </>
        ) : null}
      </main>
      <Footer />
    </div>
  );
}
