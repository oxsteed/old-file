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
import {
  cancelFoodOrder,
  createFoodOrderDispute,
  deleteFoodOrderReview,
  getFoodCancelPreview,
  getFoodOrder,
  submitFoodOrderReview,
  updateFoodOrderReview,
} from '../api/food';
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
  // Food-order cancel: preview first (the server's refund amount, never a
  // guess), then confirm. The marketplace cancel route 404s for food orders.
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelPreview, setCancelPreview] = useState(null);
  const [cancelPreviewLoading, setCancelPreviewLoading] = useState(false);
  const [cancelPreviewError, setCancelPreviewError] = useState(null);
  const [cancelResult, setCancelResult] = useState(null);
  const [cancelError, setCancelError] = useState(null);
  // Food-order review (completed orders only, one per order, server-enforced).
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewBody, setReviewBody] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewDone, setReviewDone] = useState(false);
  const [reviewError, setReviewError] = useState(null);
  // Structured food-order dispute intake (job-scoped disputes do not cover
  // food orders): opens a restaurant support case linked to this order.
  const [disputeMode, setDisputeMode] = useState(false);
  const [disputeIssueType, setDisputeIssueType] = useState('missing_item');
  const [disputeResolution, setDisputeResolution] = useState('refund');
  const [disputeAmount, setDisputeAmount] = useState('');
  const [disputeDescription, setDisputeDescription] = useState('');
  const [disputeSending, setDisputeSending] = useState(false);
  const [disputeResult, setDisputeResult] = useState(null);
  const [disputeError, setDisputeError] = useState(null);

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
  // Food orders cancel through their own endpoint (the marketplace handler
  // 404s for them). The server transition allows cancelling until the order
  // is completed; the preview is the final word on cancellability.
  const FOOD_CANCELLABLE_STATUSES = ['received', 'accepted', 'preparing', 'ready'];
  const canCancelFood = isFoodOrder && order && FOOD_CANCELLABLE_STATUSES.includes(String(order.status || '').toLowerCase());

  const openFoodCancel = async () => {
    setCancelOpen(true);
    setCancelPreview(null);
    setCancelPreviewError(null);
    setCancelResult(null);
    setCancelError(null);
    setCancelPreviewLoading(true);
    try {
      setCancelPreview(await getFoodCancelPreview(orderId));
    } catch (err) {
      setCancelPreviewError(err.response?.data?.error || err.message || t('orders.cancelError'));
    } finally {
      setCancelPreviewLoading(false);
    }
  };

  const confirmFoodCancel = async () => {
    if (cancelLoading) return;
    setCancelLoading(true);
    setCancelError(null);
    try {
      const idempotencyKey = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await cancelFoodOrder(orderId, {}, idempotencyKey);
      setCancelResult(result);
      await loadOrder();
    } catch (err) {
      setCancelError(err.response?.data?.error || err.message || t('orders.cancelError'));
    } finally {
      setCancelLoading(false);
    }
  };

  useEffect(() => {
    if (order?.review) {
      setReviewRating(Number(order.review.rating) || 5);
      setReviewBody(String(order.review.body || ''));
      setReviewDone(true);
    } else {
      setReviewDone(Boolean(order?.has_review));
    }
  }, [order?.id, order?.has_review, order?.review]);

  const submitFoodReview = async () => {
    if (reviewSubmitting) return;
    setReviewSubmitting(true);
    try {
      if (order?.review || reviewDone) {
        await updateFoodOrderReview(orderId, { rating: reviewRating, body: reviewBody.trim() || undefined });
      } else {
        await submitFoodOrderReview(orderId, { rating: reviewRating, body: reviewBody.trim() || undefined });
      }
      setReviewDone(true);
      await loadOrder();
    } catch (err) {
      setReviewError(err.response?.data?.error || err.message || null);
    } finally {
      setReviewSubmitting(false);
    }
  };

  const deleteFoodReview = async () => {
    if (reviewSubmitting) return;
    setReviewSubmitting(true);
    try {
      await deleteFoodOrderReview(orderId, {});
      setReviewDone(false);
      setReviewBody('');
      await loadOrder();
    } catch (err) {
      setReviewError(err.response?.data?.error || err.message || null);
    } finally {
      setReviewSubmitting(false);
    }
  };

  const submitFoodDispute = async () => {
    if (disputeSending || !disputeDescription.trim()) return;
    setDisputeSending(true);
    setDisputeError(null);
    try {
      const idempotencyKey = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const amountCents = disputeResolution === 'partial_refund'
        ? Math.round(Number.parseFloat(disputeAmount.replace(/[^0-9.]/g, '')) * 100) || 0
        : undefined;
      const result = await createFoodOrderDispute({
        orderId: Number(orderId),
        restaurantId: order?.restaurant_id,
        issueType: disputeIssueType,
        requestedResolution: disputeResolution,
        requestedRefundAmountCents: amountCents || undefined,
        description: disputeDescription.trim(),
      }, idempotencyKey);
      setDisputeResult(result?.case || result);
    } catch (err) {
      setDisputeError(err.response?.data?.error || err.message || null);
    } finally {
      setDisputeSending(false);
    }
  };
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
    const keyMap = {
      card: 'orders.paymentMethods.card',
      card_payment: 'orders.paymentMethods.card',
      bank_transfer: 'orders.paymentMethods.bankTransfer',
      cash: 'orders.paymentMethods.cash',
      restaurant_credit: 'orders.paymentMethods.restaurantCredit',
      wallet_credit: 'orders.paymentMethods.restaurantCredit',
      direct_payment: 'orders.paymentMethods.directPayment',
      direct: 'orders.paymentMethods.directPayment',
      off_platform: 'orders.paymentMethods.directPayment',
      pay_at_restaurant: 'orders.paymentMethods.payAtRestaurant',
      pay_in_person: 'orders.paymentMethods.payAtRestaurant',
    };
    if (keyMap[raw]) return t(keyMap[raw]);
    if (order?.transaction) return t('orders.paymentMethods.processor', 'Processor payment');
    return t('orders.paymentMethods.unrecorded', 'Unrecorded');
  })();

  useEffect(() => {
    if (!isFoodOrder || !orderId || ['completed','delivered','cancelled','canceled','refunded','picked_up'].includes(order?.status)) return undefined;
    const interval = setInterval(async () => {
      if (document.visibilityState === 'hidden') return;
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
            <div className="order-details-error-actions">
              <button type="button" className="orders-btn orders-btn-primary" onClick={loadOrder} data-track="ui.74ee342991.1">
                <RefreshCw size={16} /> {t('common.retry', 'Retry')}
              </button>
              <button type="button" className="orders-btn" onClick={handleBackToOrders} data-track="ui.74ee342991.2">
                <ArrowLeft size={16} /> {t('orders.backToOrders')}
              </button>
            </div>
          </div>
        </div>
      </PageShell>
    );
  }

  const effectiveStatus = liveStatus || order.status;
  const StatusIcon = statusIcon(effectiveStatus);
  const items = Array.isArray(order.items) ? order.items : [];
  const totalItems = items.reduce((total, item) => total + Number(item.quantity || 0), 0);
  // Delivery orders store their address inside metadata.deliveryAddress, not
  // on top-level columns; read it before inferring fulfillment from absence.
  const deliveryAddress = order.metadata?.deliveryAddress || order.metadata?.delivery_address || null;
  const address = addressText(order.shipping_address || order.delivery_address || deliveryAddress);
  const deliveryInstructions = typeof deliveryAddress === 'object' ? deliveryAddress?.instructions || deliveryAddress?.notes || '' : '';
  const fulfillment = order.fulfillment_type || order.fulfillmentType || (address ? 'delivery' : 'pickup');

  return (
    <PageShell>
      <PageMeta title={`${t('orders.order')} #${orderId}`} />
      <div className="order-details-page">
        <div className="order-details-wrap">
          <div className="order-details-topbar">
            <button type="button" className="order-details-back" onClick={handleBackToOrders} data-track="ui.74ee342991.3"><ArrowLeft size={16} /> {t('orders.backToOrders')}</button>
            <button type="button" className="orders-btn" onClick={loadOrder} disabled={loading} data-track="ui.74ee342991.4"><RefreshCw size={16} className={loading ? 'orders-spin' : ''} /> {t('common.refresh')}</button>
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

          {error && <div role="alert" className="order-details-alert"><XCircle size={17} /> {error}<button type="button" onClick={loadOrder} data-track="ui.74ee342991.5">{t('common.tryAgain')}</button></div>}

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

              {isFoodOrder && String(order.status || '').toLowerCase() === 'completed' && (
                <section className="order-details-card">
                  <div className="order-details-card-head"><div><p className="order-details-card-kicker">{t('orders.review')}</p><h2>{reviewDone ? t('orders.reviewDone') : t('orders.reviewTitle')}</h2></div></div>
                  <div className="order-details-lines">
                    {reviewDone && order.review?.response && (
                      <p>{t('orders.reviewResponse', { response: order.review.response })}</p>
                    )}
                    <div role="radiogroup" aria-label={t('orders.reviewTitle')}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          role="radio"
                          aria-checked={reviewRating === star}
                          onClick={() => setReviewRating(star)}
                          className="orders-btn"
                          data-track="ui.74ee342991.15"
                        >
                          {star <= reviewRating ? '★' : '☆'}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={reviewBody}
                      onChange={(e) => setReviewBody(e.target.value)}
                      placeholder={t('orders.reviewPlaceholder')}
                      rows={4}
                      maxLength={2000}
                      className="order-help-textarea"
                    />
                    {reviewError && <p role="alert">{reviewError}</p>}
                    <div className="order-help-actions">
                      {reviewDone && (
                        <button type="button" className="orders-btn" onClick={deleteFoodReview} disabled={reviewSubmitting} data-track="ui.74ee342991.16">
                          {t('orders.reviewDelete')}
                        </button>
                      )}
                      <button type="button" className="orders-btn orders-btn-primary" onClick={submitFoodReview} disabled={reviewSubmitting} data-track="ui.74ee342991.17">
                        {reviewSubmitting ? t('common.sending') : t('orders.reviewSubmit')}
                      </button>
                    </div>
                  </div>
                </section>
              )}

              {(address || order.table_label || order.fulfillment_type) && (
                <section className="order-details-card">
                  <div className="order-details-card-head"><div><p className="order-details-card-kicker">{t('orders.fulfillment', { defaultValue: 'Fulfillment' })}</p><h2>{t('orders.deliveryDetails', { defaultValue: 'Where and how' })}</h2></div></div>
                  <div className="order-details-lines">
                    <DetailLine icon={MapPin} label={t('orders.fulfillment', { defaultValue: 'Fulfillment' })}>{String(fulfillment).replace(/_/g, ' ')}</DetailLine>
                    {address && <DetailLine icon={MapPin} label={t('orders.shippingAddress')}>{address}</DetailLine>}
                    {deliveryInstructions && <DetailLine icon={MapPin} label={t('orders.deliveryInstructions')}>{deliveryInstructions}</DetailLine>}
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
                  {order.service_fee_cents > 0 && <div><dt>{t('orders.serviceFee')}</dt><dd>{formatCents(order.service_fee_cents, currencyOptions)}</dd></div>}
                  {order.tip_cents > 0 && <div><dt>{t('orders.tip')}</dt><dd>{formatCents(order.tip_cents, currencyOptions)}</dd></div>}
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
                {canCancel && <button type="button" className="orders-btn orders-btn-danger" onClick={handleCancel} disabled={cancelLoading} data-track="ui.74ee342991.6"><XCircle size={16} /> {cancelLoading ? t('common.processing') : t('orders.cancelOrder')}</button>}
                {canCancelFood && <button type="button" className="orders-btn orders-btn-danger" onClick={openFoodCancel} data-track="ui.74ee342991.18"><XCircle size={16} /> {t('orders.cancelOrder')}</button>}
                {isFoodOrder && order?.tracking_token && <button type="button" className="orders-btn orders-btn-primary" onClick={() => navigate(`/food/track/${order.tracking_token}`)} data-track="ui.74ee342991.7"><RefreshCw size={16} /> {t('food.order.liveStatus', { defaultValue: 'Track order live' })}</button>}
                <button type="button" className="orders-btn" onClick={() => setHelpOpen(true)} data-track="ui.74ee342991.8"><HelpCircle size={16} /> {t('orders.getHelp', { defaultValue: 'Get help with this order' })}</button>
                {isFoodOrder && !['cancelled', 'refunded'].includes(String(order.status || '').toLowerCase()) && <button type="button" className="orders-btn" onClick={handleOrderAgain} data-track="ui.74ee342991.9"><RotateCcw size={16} /> {t('food.restaurant.orderAgain', { defaultValue: 'Order again' })}</button>}
                <button type="button" className="orders-btn" onClick={handleBackToOrders} data-track="ui.74ee342991.10"><ArrowLeft size={16} /> {t('orders.backToOrders')}</button>
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
              <button type="button" className="order-help-close" onClick={() => setHelpOpen(false)} aria-label={t('common.close')} data-track="ui.74ee342991.11">×</button>
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
                <button type="button" className="orders-btn orders-btn-primary" onClick={() => { setHelpOpen(false); setHelpSent(false); }} data-track="ui.74ee342991.12">
                  {t('common.done', { defaultValue: 'Done' })}
                </button>
              </div>
            ) : disputeMode ? (
              <>
                {disputeResult ? (
                  <div className="order-help-sent">
                    <p>{t('orders.disputeOpened', { caseNumber: disputeResult.public_case_number || disputeResult.id })}</p>
                    {disputeResult.owner_type && <p>{t('orders.disputeReviewingParty', { party: disputeResult.owner_type })}</p>}
                    <button type="button" className="orders-btn orders-btn-primary" onClick={() => { setHelpOpen(false); setDisputeMode(false); setDisputeResult(null); }} data-track="ui.74ee342991.19">
                      {t('common.done')}
                    </button>
                  </div>
                ) : (
                  <>
                    <p>{t('orders.disputeDescription')}</p>
                    <label>{t('orders.disputeIssueType')}</label>
                    <select value={disputeIssueType} onChange={(e) => setDisputeIssueType(e.target.value)} className="order-help-textarea" style={{ minHeight: 0 }}>
                      {['missing_item', 'wrong_item', 'food_quality', 'late_order', 'payment_problem', 'delivery_issue', 'other'].map((issue) => (
                        <option key={issue} value={issue}>{t(`orders.disputeIssues.${issue}`)}</option>
                      ))}
                    </select>
                    <label>{t('orders.disputeResolution')}</label>
                    <select value={disputeResolution} onChange={(e) => setDisputeResolution(e.target.value)} className="order-help-textarea" style={{ minHeight: 0 }}>
                      {['refund', 'partial_refund', 'store_credit', 'replacement_item', 'remake_order', 'discount_code', 'apology_only'].map((resolution) => (
                        <option key={resolution} value={resolution}>{t(`orders.disputeResolutions.${resolution}`)}</option>
                      ))}
                    </select>
                    {disputeResolution === 'partial_refund' && (
                      <input
                        value={disputeAmount}
                        onChange={(e) => setDisputeAmount(e.target.value)}
                        placeholder={t('orders.disputeAmountPlaceholder')}
                        inputMode="decimal"
                        className="order-help-textarea"
                        style={{ minHeight: 0 }}
                      />
                    )}
                    <textarea
                      value={disputeDescription}
                      onChange={(e) => setDisputeDescription(e.target.value)}
                      placeholder={t('orders.disputeDetailPlaceholder')}
                      rows={5}
                      maxLength={5000}
                      className="order-help-textarea"
                    />
                    {disputeError && <p role="alert">{disputeError}</p>}
                    <div className="order-help-actions">
                      <button type="button" className="orders-btn" onClick={() => setDisputeMode(false)} data-track="ui.74ee342991.20">
                        {t('common.back')}
                      </button>
                      <button
                        type="button"
                        className="orders-btn orders-btn-primary"
                        onClick={submitFoodDispute}
                        disabled={disputeSending || !disputeDescription.trim()} data-track="ui.74ee342991.21"
                      >
                        {disputeSending ? t('common.sending') : t('orders.disputeSubmit')}
                      </button>
                    </div>
                  </>
                )}
              </>
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
                  <button type="button" className="orders-btn" onClick={() => setHelpOpen(false)} data-track="ui.74ee342991.13">
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    className="orders-btn orders-btn-primary"
                    onClick={handleHelpSubmit}
                    disabled={helpSending || !helpMessage.trim()} data-track="ui.74ee342991.14"
                  >
                    {helpSending ? t('common.sending', { defaultValue: 'Sending...' }) : t('common.send', { defaultValue: 'Send' })}
                  </button>
                </div>
                {isFoodOrder && (
                  <button type="button" className="orders-btn" onClick={() => { setDisputeMode(true); setDisputeError(null); }} data-track="ui.74ee342991.22">
                    {t('orders.reportProblem')}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {cancelOpen && (
        <div className="order-help-overlay" onClick={() => !cancelLoading && setCancelOpen(false)}>
          <div className="order-help-panel" onClick={e => e.stopPropagation()}>
            <div className="order-help-head">
              <h3>{t('orders.cancelOrder')}</h3>
              <button type="button" className="order-help-close" onClick={() => !cancelLoading && setCancelOpen(false)} aria-label={t('common.close')} data-track="ui.74ee342991.23">×</button>
            </div>
            {cancelResult ? (
              <div className="order-help-sent">
                <p>{t('orders.cancelSuccess')}</p>
                {cancelResult.refundCents > 0 && (
                  <p>{t('orders.cancelRefund', { amount: formatCents(cancelResult.refundCents, currencyOptions) })}</p>
                )}
                {cancelResult.replayed && <p>{t('orders.cancelReplayed')}</p>}
                <button type="button" className="orders-btn orders-btn-primary" onClick={() => setCancelOpen(false)} data-track="ui.74ee342991.24">
                  {t('common.done')}
                </button>
              </div>
            ) : cancelPreviewLoading ? (
              <p>{t('common.loading')}</p>
            ) : cancelPreviewError ? (
              <>
                <p role="alert">{cancelPreviewError}</p>
                <div className="order-help-actions">
                  <button type="button" className="orders-btn" onClick={() => setCancelOpen(false)} data-track="ui.74ee342991.25">
                    {t('common.close')}
                  </button>
                </div>
              </>
            ) : cancelPreview && !cancelPreview.cancellable ? (
              <>
                <p>{t('orders.cancelNotAvailable')}</p>
                <div className="order-help-actions">
                  <button type="button" className="orders-btn" onClick={() => setCancelOpen(false)} data-track="ui.74ee342991.25">
                    {t('common.close')}
                  </button>
                </div>
              </>
            ) : cancelPreview ? (
              <>
                <p>{t('orders.cancelConfirm', { total: formatCents(cancelPreview.totalCents, currencyOptions) })}</p>
                {cancelPreview.refundCents > 0 ? (
                  <p>{t('orders.cancelRefundPreview', { amount: formatCents(cancelPreview.refundCents, currencyOptions) })}</p>
                ) : (
                  <p>{t('orders.cancelNoRefund')}</p>
                )}
                {cancelError && <p role="alert">{cancelError}</p>}
                <div className="order-help-actions">
                  <button type="button" className="orders-btn" onClick={() => setCancelOpen(false)} disabled={cancelLoading} data-track="ui.74ee342991.26">
                    {t('common.cancel')}
                  </button>
                  <button type="button" className="orders-btn orders-btn-danger" onClick={confirmFoodCancel} disabled={cancelLoading} data-track="ui.74ee342991.27">
                    {cancelLoading ? t('common.processing') : t('orders.cancelOrder')}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </PageShell>
  );
}
