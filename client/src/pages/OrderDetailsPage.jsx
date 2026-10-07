import { useEffect, useState } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Clock3,
  CreditCard,
  HelpCircle,
  MapPin,
  Package,
  RefreshCw,
  RotateCcw,
  ShoppingBag,
  Ticket,
  XCircle,
} from 'lucide-react';
import api from '../api/axios';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import OrderErrorBoundary from '../components/OrderErrorBoundary';
import { formatCents, formatDateTime } from '../lib/format';
import { getFoodOrder } from '../api/food';
import './OrderDetailsPage.css';

const STATUS_GROUPS = {
  positive: new Set(['paid', 'ready', 'completed', 'delivered', 'picked_up']),
  active: new Set(['processing', 'received', 'accepted', 'preparing']),
  negative: new Set(['cancelled', 'refunded', 'failed']),
};

function statusTone(status) {
  const value = String(status || '').toLowerCase();
  if (STATUS_GROUPS.positive.has(value)) return 'positive';
  if (STATUS_GROUPS.active.has(value)) return 'active';
  if (STATUS_GROUPS.negative.has(value)) return 'negative';
  return 'pending';
}
function statusIcon(status) {
  const tone = statusTone(status);
  if (tone === 'positive') return CheckCircle2;
  if (tone === 'negative') return XCircle;
  if (tone === 'active') return RefreshCw;
  return Clock3;
}

function statusText(status, t) {
  const key = String(status || 'pending').toLowerCase();
  return t(`orders.statusLabels.${key}`, {
    defaultValue: key.replace(/_/g, ' ').replace(/^\w/, (character) => character.toUpperCase()),
  });
}

function itemName(item, t) {
  return item.name || item.itemName || t('food.order.yourOrder');
}

function itemTotal(item, currencyOptions) {
  return formatCents(
    item.total_price_cents ?? item.lineTotalCents ?? (Number(item.unit_price_cents || 0) * Number(item.quantity || 0)),
    currencyOptions,
  );
}

function itemUnitPrice(item, currencyOptions) {
  const unitPrice = item.unit_price_cents ?? (
    Number(item.lineTotalCents || item.total_price_cents || 0) / Math.max(Number(item.quantity || 1), 1)
  );
  return formatCents(unitPrice, currencyOptions);
}

function addressText(address) {
  if (!address) return '';
  if (typeof address === 'string') return address;
  return [address.name, address.line1, address.line2, address.city, address.state, address.postal_code || address.zip, address.country]
    .filter(Boolean)
    .join(', ');
}

function DetailLine({ icon: Icon, label, children }) {
  return (
    <div className="order-details-line">
      <Icon size={16} aria-hidden="true" />
      <div>
        <span>{label}</span>
        <strong>{children || '—'}</strong>
      </div>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, detail, tone = '' }) {
  return (
    <div className={`order-details-summary-card ${tone ? `tone-${tone}` : ''}`}>
      <div className="order-details-summary-icon"><Icon size={18} aria-hidden="true" /></div>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

export default function OrderDetailsPage() {
  return (
    <OrderErrorBoundary componentNameKey="orderErrorBoundary.componentNames.orderDetails">
      <OrderDetailsPageContent />
    </OrderErrorBoundary>
  );
}

function OrderDetailsPageContent() {
  const { t } = useTranslation();
  const params = useParams();
  const orderId = params.orderId || params.id;
  const navigate = useNavigate();
  const location = useLocation();
  const isFoodOrder = location.pathname.startsWith('/food/orders/');
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [liveStatus, setLiveStatus] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpMessage, setHelpMessage] = useState('');
  const [helpSending, setHelpSending] = useState(false);
  const [helpSent, setHelpSent] = useState(false);

  const loadOrder = async () => {
    try {
      setLoading(true);
      setError(null);
      if (isFoodOrder) {
        setOrder(await getFoodOrder(orderId));
      } else {
        const response = await api.get(`/orders/${orderId}`);
        setOrder(response.data.data);
      }
    } catch (err) {
      setError(err.response?.data?.error || t('orders.loadError', { defaultValue: 'Failed to load order' }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadOrder(); }, [isFoodOrder, orderId]);

  const handleCancel = async () => {
    if (!window.confirm(t('orders.confirmCancel'))) return;
    try {
      setCancelLoading(true);
      await api.post(`/orders/${orderId}/cancel`);
      await loadOrder();
    } catch (err) {
      setError(err.response?.data?.error || t('orders.cancelError', { defaultValue: 'Failed to cancel order' }));
    } finally {
      setCancelLoading(false);
    }
  };

  const canCancel = !isFoodOrder && order && ['pending', 'paid'].includes(order.status);
  const currencyOptions = { currency: order?.currency_code || order?.currency || 'USD' };
  const supportUrl = isFoodOrder && order
    ? `/support?orderId=${order.id}${order.tracking_token ? `&token=${order.tracking_token}` : ''}`
    : `/support?orderId=${orderId}`;

  const handleHelpSubmit = async () => {
    if (!helpMessage.trim() || helpSending) return;
    setHelpSending(true);
    try {
      const context = isFoodOrder && order
        ? `Order #${order.id} (${order.restaurant_name || 'restaurant'}) - Status: ${order.status}, Total: ${formatCents(order.total_cents, currencyOptions)}. Items: ${(order.items || []).map(i => `${i.quantity}x ${i.item_name || i.name}`).join(', ')}`
        : `Order #${orderId}`;
      await api.post('/support/public/conversations', {
        message: `[${context}] ${helpMessage.trim()}`,
        clientRequestId: `order-help-${orderId}-${Date.now()}`,
      });
      setHelpSent(true);
      setHelpMessage('');
    } catch (err) {
      // Fall back to the support page on error
      navigate(supportUrl);
    } finally {
      setHelpSending(false);
    }
  };

  const handleBackToOrders = () => {
    // If the user arrived here from the orders list (or anywhere in-app),
    // browser-back preserves their scroll position and filters.
    // On direct entry (email link, bookmark), fall back to the orders list.
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      navigate('/orders');
    }
  };

  const handleOrderAgain = () => {
    const restaurantId = order?.restaurant_id || order?.restaurantId;
    if (restaurantId && isFoodOrder) {
      navigate(`/food/restaurants/${restaurantId}`, { state: { reorderOrder: order } });
    } else {
      navigate('/restaurants');
    }
  };
  const paymentMethodLabel = (() => {
    const raw = String(order?.payment_method || order?.paymentMode || order?.payment_mode || '').toLowerCase();
    const labels = {
      card: 'Card',
      card_payment: 'Card',
      bank_transfer: 'Bank transfer',
      cash: 'Cash',
      restaurant_credit: 'Restaurant credit',
      wallet_credit: 'Restaurant credit',
      direct_payment: 'Direct payment',
      direct: 'Direct payment',
      off_platform: 'Direct payment',
      pay_at_restaurant: 'Pay at restaurant',
      pay_in_person: 'Pay at restaurant',
    };
    if (labels[raw]) return labels[raw];
    if (order?.transaction) return 'Processor payment';
    return 'Unrecorded';
  })();

  useEffect(() => {
    if (!isFoodOrder || !orderId) return undefined;
    const interval = setInterval(async () => {
      try {
        const updated = await getFoodOrder(orderId);
        setLiveStatus(updated.status);
        if (updated.status !== order?.status) setOrder(updated);
      } catch {
        // The page keeps the last known state when a background refresh fails.
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [isFoodOrder, orderId, order?.status]);

  if (loading) {
    return (
      <PageShell>
        <div className="order-details-page">
          <div className="order-details-wrap">
            <div className="order-details-skeleton order-details-skeleton-back" />
            <div className="order-details-skeleton order-details-skeleton-hero" />
            <div className="order-details-skeleton-grid"><div /><div /><div /><div /></div>
            <div className="order-details-skeleton-content"><div /><div /></div>
          </div>
        </div>
      </PageShell>
    );
  }

  if (error || !order) {
    return (
      <PageShell>
        <div className="order-details-page">
          <div className="order-details-wrap order-details-centered-state">
            <XCircle size={42} aria-hidden="true" />
            <p className="order-details-kicker">{t('common.error')}</p>
            <h1>{order ? t('common.error') : t('orders.notFound')}</h1>
            <p>{error || t('orders.notFound')}</p>
            <button type="button" className="orders-btn orders-btn-primary" onClick={handleBackToOrders}>
              <ArrowLeft size={16} /> {t('orders.backToOrders')}
            </button>
          </div>
        </div>
      </PageShell>
    );
  }

  const effectiveStatus = liveStatus || order.status;
  const StatusIcon = statusIcon(effectiveStatus);
  const items = Array.isArray(order.items) ? order.items : [];
  const totalItems = items.reduce((total, item) => total + Number(item.quantity || 0), 0);
  const address = addressText(order.shipping_address || order.delivery_address);
  const fulfillment = order.fulfillment_type || order.fulfillmentType || (address ? 'delivery' : 'pickup');

  return (
    <PageShell>
      <PageMeta title={`${t('orders.order')} #${orderId}`} />
      <div className="order-details-page">
        <div className="order-details-wrap">
          <div className="order-details-topbar">
            <button type="button" className="order-details-back" onClick={handleBackToOrders}><ArrowLeft size={16} /> {t('orders.backToOrders')}</button>
            <button type="button" className="orders-btn" onClick={loadOrder} disabled={loading}><RefreshCw size={16} className={loading ? 'orders-spin' : ''} /> {t('common.refresh')}</button>
          </div>

          <header className="order-details-hero">
            <div>
              <p className="orders-kicker">{isFoodOrder ? t('orders.foodKicker') : t('orders.order')}</p>
              <h1>{order.restaurant_name ? `${order.restaurant_name} · ` : ''}{t('orders.order')} #{order.id}</h1>
              <p>{t('orders.placedOn')} {formatDateTime(order.created_at, { month: 'long' })}</p>
            </div>
            <div className={`order-details-status tone-${statusTone(effectiveStatus)}`}>
              <StatusIcon size={18} aria-hidden="true" />
              <span>{statusText(effectiveStatus, t)}</span>
            </div>
          </header>

          {error && <div role="alert" className="order-details-alert"><XCircle size={17} /> {error}<button type="button" onClick={loadOrder}>{t('common.tryAgain')}</button></div>}

          <section className="order-details-summary" aria-label={t('orders.summaryAriaLabel', { defaultValue: 'Order summary' })}>
            <SummaryCard icon={ShoppingBag} label={t('orders.items')} value={totalItems || '—'} detail={`${items.length} ${items.length === 1 ? 'line item' : 'line items'}`} />
            <SummaryCard icon={CreditCard} label={t('checkout.total')} value={formatCents(order.total_cents, currencyOptions)} detail={paymentMethodLabel} tone="accent" />
            <SummaryCard icon={MapPin} label={t('orders.fulfillment', { defaultValue: 'Fulfillment' })} value={String(fulfillment).replace(/_/g, ' ')} detail={order.queue_number ? `${t('orders.orderNumber', { defaultValue: 'Order number' })} ${order.queue_number}` : t('orders.notSet', { defaultValue: 'Not set' })} />
            <SummaryCard icon={CalendarClock} label={t('orders.date')} value={formatDateTime(order.created_at, { month: 'short', day: 'numeric' })} detail={order.updated_at ? `${t('orders.updated', { defaultValue: 'Updated' })} ${formatDateTime(order.updated_at)}` : ''} />
          </section>

          <div className="order-details-grid">
            <main className="order-details-main">
              <section className="order-details-card">
                <div className="order-details-card-head"><div><p className="order-details-card-kicker">{t('orders.items')}</p><h2>{t('orders.orderItems', { defaultValue: 'Your order' })}</h2></div><span>{totalItems} {t('orders.items')}</span></div>
                <div className="order-details-items">
                  {items.length ? items.map((item) => (
                    <div key={item.id || `${itemName(item, t)}-${item.quantity}`} className="order-details-item">
                      <div className="order-details-item-qty">{item.quantity || 0}×</div>
                      <div className="order-details-item-copy">
                        <strong>{itemName(item, t)}</strong>
                        {item.description && <p>{item.description}</p>}
                        {item.specialInstructions && <small>{item.specialInstructions}</small>}
                        <span>{itemUnitPrice(item, currencyOptions)} {t('common.each')}</span>
                      </div>
                      <b>{itemTotal(item, currencyOptions)}</b>
                    </div>
                  )) : <div className="order-details-empty-inline"><Package size={24} /><p>{t('orders.noItems', { defaultValue: 'No items were recorded for this order.' })}</p></div>}
                </div>
              </section>

              {(address || order.table_label || order.fulfillment_type) && (
                <section className="order-details-card">
                  <div className="order-details-card-head"><div><p className="order-details-card-kicker">{t('orders.fulfillment', { defaultValue: 'Fulfillment' })}</p><h2>{t('orders.deliveryDetails', { defaultValue: 'Where and how' })}</h2></div></div>
                  <div className="order-details-lines">
                    <DetailLine icon={MapPin} label={t('orders.fulfillment', { defaultValue: 'Fulfillment' })}>{String(fulfillment).replace(/_/g, ' ')}</DetailLine>
                    {address && <DetailLine icon={MapPin} label={t('orders.shippingAddress')}>{address}</DetailLine>}
                    {order.table_label && <DetailLine icon={Ticket} label={t('food.order.table', { defaultValue: 'Table' })}>{order.table_label}</DetailLine>}
                    {order.queue_number && <DetailLine icon={Package} label={t('orders.orderNumber', { defaultValue: 'Order number' })}>#{order.queue_number}</DetailLine>}
                  </div>
                </section>
              )}
            </main>

            <aside className="order-details-sidebar">
              <section className="order-details-card order-details-price-card">
                <div className="order-details-card-head"><div><p className="order-details-card-kicker">{t('orders.orderSummary')}</p><h2>{t('checkout.total')}</h2></div></div>
                <dl className="order-details-price-list">
                  <div><dt>{t('checkout.subtotal')}</dt><dd>{formatCents(order.subtotal_cents, currencyOptions)}</dd></div>
                  {order.tax_cents > 0 && <div><dt>{t('checkout.tax')}</dt><dd>{formatCents(order.tax_cents, currencyOptions)}</dd></div>}
                  {(order.shipping_cents > 0 || order.delivery_fee_cents > 0) && <div><dt>{t('orders.shipping')}</dt><dd>{formatCents(order.shipping_cents || order.delivery_fee_cents, currencyOptions)}</dd></div>}
                  {order.discount_cents > 0 && <div className="is-discount"><dt>{t('orders.discount')}</dt><dd>-{formatCents(order.discount_cents, currencyOptions)}</dd></div>}
                  <div className="is-total"><dt>{t('checkout.total')}</dt><dd>{formatCents(order.total_cents, currencyOptions)}</dd></div>
                </dl>
              </section>

              {(order.transaction || order.payment_method || order.payment_mode || order.payment_status) && (
                <section className="order-details-card">
                  <div className="order-details-card-head"><div><p className="order-details-card-kicker">{t('orders.payment')}</p><h2>{t('orders.paymentDetails', { defaultValue: 'Payment details' })}</h2></div></div>
                  <div className="order-details-lines">
                    <DetailLine icon={CreditCard} label={t('orders.paymentMethod')}>{paymentMethodLabel}</DetailLine>
                    {order.payment_status && <DetailLine icon={CheckCircle2} label={t('orders.status')}>{String(order.payment_status).replace(/_/g, ' ')}</DetailLine>}
                    {order.transaction?.payment_intent_id && <DetailLine icon={Ticket} label={t('orders.transactionId')}><span className="order-details-mono">{order.transaction.payment_intent_id}</span></DetailLine>}
                  </div>
                </section>
              )}

              <section className="order-details-actions">
                {canCancel && <button type="button" className="orders-btn orders-btn-danger" onClick={handleCancel} disabled={cancelLoading}><XCircle size={16} /> {cancelLoading ? t('common.processing') : t('orders.cancelOrder')}</button>}
                {isFoodOrder && order?.tracking_token && <button type="button" className="orders-btn orders-btn-primary" onClick={() => navigate(`/food/track/${order.tracking_token}`)}><RefreshCw size={16} /> {t('food.order.liveStatus', { defaultValue: 'Track order live' })}</button>}
                <button type="button" className="orders-btn" onClick={() => setHelpOpen(true)}><HelpCircle size={16} /> {t('orders.getHelp', { defaultValue: 'Get help with this order' })}</button>
                {isFoodOrder && !['cancelled', 'refunded'].includes(String(order.status || '').toLowerCase()) && <button type="button" className="orders-btn" onClick={handleOrderAgain}><RotateCcw size={16} /> {t('food.restaurant.orderAgain', { defaultValue: 'Order again' })}</button>}
                <button type="button" className="orders-btn" onClick={handleBackToOrders}><ArrowLeft size={16} /> {t('orders.backToOrders')}</button>
              </section>
            </aside>
          </div>
        </div>
      </div>

      {helpOpen && (
        <div className="order-help-overlay" onClick={() => setHelpOpen(false)}>
          <div className="order-help-panel" onClick={e => e.stopPropagation()}>
            <div className="order-help-head">
              <h3>{t('orders.helpTitle')}</h3>
              <button type="button" className="order-help-close" onClick={() => setHelpOpen(false)} aria-label={t('common.close')}>×</button>
            </div>
            {isFoodOrder && order && (
              <div className="order-help-context">
                <p><strong>{t('orders.order')} #{order.id}</strong>{order.restaurant_name ? ` · ${order.restaurant_name}` : ''}</p>
                <p>{t(`food.status.${order.status}`, order.status)} · {formatCents(order.total_cents, currencyOptions)}</p>
                {(order.items || []).length > 0 && (
                  <p className="order-help-items">{(order.items || []).map(i => `${i.quantity}x ${i.item_name || i.name}`).join(', ')}</p>
                )}
              </div>
            )}
            {helpSent ? (
              <div className="order-help-sent">
                <p>{t('orders.helpSent')}</p>
                <button type="button" className="orders-btn orders-btn-primary" onClick={() => { setHelpOpen(false); setHelpSent(false); }}>
                  {t('common.done', { defaultValue: 'Done' })}
                </button>
              </div>
            ) : (
              <>
                <textarea
                  value={helpMessage}
                  onChange={e => setHelpMessage(e.target.value)}
                  placeholder={t('orders.helpPlaceholder')}
                  rows={5}
                  className="order-help-textarea"
                />
                <div className="order-help-actions">
                  <button type="button" className="orders-btn" onClick={() => setHelpOpen(false)}>
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    className="orders-btn orders-btn-primary"
                    onClick={handleHelpSubmit}
                    disabled={helpSending || !helpMessage.trim()}
                  >
                    {helpSending ? t('common.sending', { defaultValue: 'Sending...' }) : t('common.send', { defaultValue: 'Send' })}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}
