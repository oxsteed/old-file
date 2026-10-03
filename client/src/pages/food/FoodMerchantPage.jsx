// OxSteed Food - merchant dashboard: onboarding, menu manager, live orders,
// and links to the in-store screens (kitchen display, queue board, kiosk).
import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Home, Receipt, UtensilsCrossed, Wallet, Settings, ClipboardList, ShoppingBag, Clock, ChefHat, Palette, UserCheck, MapPin, Tag } from 'lucide-react';
import { subscribeRestaurantDisplay } from '../../api/restaurantDisplaySocket';
import {
  listMyFoodRestaurants,
  createFoodRestaurant,
  updateFoodRestaurant,
  uploadFoodAsset,
  getFoodRestaurant,
  getManagedFoodMenu,
  createFoodCategory,
  deleteFoodCategory,
  createFoodMenuItem,
  updateFoodMenuItem,
  deleteFoodMenuItem,
  createFoodModifierGroup,
  listFoodRestaurantOrders,
  listFoodRestaurantOrdersPage,
  updateFoodOrderStatus,
  recordFoodOrderManualPayment,
  formatFoodMoney,
} from '../../api/food';
import { FoodBrand, FoodConnBadge, FOOD_STATUS_KEYS, apiErrorMessage } from './foodShared';
import DeviceSetupChecklist from './FoodDeviceSetupChecklist';
import RestaurantSetupGuide, { shouldShowRestaurantSetup } from './RestaurantSetupGuide';
import RestaurantMenuManager from './RestaurantMenuManager';
import RestaurantCreditManager from './RestaurantCreditManager';
import RestaurantPayoutsPanel from './RestaurantPayoutsPanel';
import RestaurantTopupEligibilityPanel from './RestaurantTopupEligibilityPanel';
import OxsteedCreditPartnerManager from './OxsteedCreditPartnerManager';
import LocationsPanel from './FoodLocationsPanel';
import PromotionsPanel from './FoodPromotionsPanel';
import { ChecklistsPanel, SopsPanel, InventoryPanel } from './RestaurantOpsPanels';
import PageShell from '../../components/PageShell';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import '../../styles/FoodPages.css';

const NEXT_STATUS = {
  received: 'preparing',
  accepted: 'preparing',
  preparing: 'ready',
  ready: 'completed',
};

// ── Onboarding form ──────────────────────────────────────────────────────────
function CreateRestaurantForm({ t, onCreated }) {
  const [form, setForm] = useState({
    displayName: '', description: '', phone: '', cuisine: '',
    addressStreet: '', addressCity: '', addressState: '', addressZip: '', addressCountry: 'US',
    latitude: '', longitude: '', currencyCode: 'USD',
  });
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.displayName.trim()) return;
    setSaving(true);
    try {
      const restaurant = await createFoodRestaurant({
        displayName: form.displayName.trim(),
        description: form.description.trim() || undefined,
        phone: form.phone.trim() || undefined,
        cuisineTags: form.cuisine.split(',').map((s) => s.trim()).filter(Boolean),
        addressStreet: form.addressStreet.trim() || undefined,
        addressCity: form.addressCity.trim() || undefined,
        addressState: form.addressState.trim() || undefined,
        addressZip: form.addressZip.trim() || undefined,
        addressCountry: form.addressCountry.trim() || 'US',
        latitude: form.latitude !== '' ? Number(form.latitude) : undefined,
        longitude: form.longitude !== '' ? Number(form.longitude) : undefined,
        currencyCode: form.currencyCode.trim() || 'USD',
      });
      toast.success(t('food.merchant.created'));
      onCreated(restaurant);
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.merchant.createError')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="fd-section">
      <h2>{t('food.merchant.addRestaurant')}</h2>
      <div className="fd-field">
        <label htmlFor="fd-r-name">{t('food.merchant.name')} *</label>
        <input id="fd-r-name" value={form.displayName} onChange={set('displayName')} required maxLength={160} />
      </div>
      <div className="fd-field">
        <label htmlFor="fd-r-desc">{t('food.merchant.description')}</label>
        <textarea id="fd-r-desc" value={form.description} onChange={set('description')} rows={3} maxLength={2000} />
      </div>
      <div className="fd-row">
        <div className="fd-field" style={{ flex: 1 }}>
          <label htmlFor="fd-r-cuisine">{t('food.merchant.cuisineTags')}</label>
          <input id="fd-r-cuisine" value={form.cuisine} onChange={set('cuisine')} placeholder={t('food.merchant.cuisinePlaceholder')} />
        </div>
        <div className="fd-field" style={{ flex: 1 }}>
          <label htmlFor="fd-r-phone">{t('food.merchant.phone')}</label>
          <input id="fd-r-phone" value={form.phone} onChange={set('phone')} maxLength={40} />
        </div>
      </div>
      <div className="fd-row">
        <div className="fd-field" style={{ flex: 2 }}>
          <label htmlFor="fd-r-street">{t('food.merchant.street')}</label>
          <AddressAutocomplete
            id="fd-r-street"
            value={form.addressStreet}
            onChange={(value) => setForm((current) => ({ ...current, addressStreet: value, latitude: '', longitude: '' }))}
            onSelect={(place) => setForm((current) => ({
              ...current,
              addressStreet: place.addressLine1 || place.display,
              addressCity: place.city || current.addressCity,
              addressState: place.state || current.addressState,
              addressZip: place.zip || current.addressZip,
              addressCountry: place.country || current.addressCountry,
              latitude: place.lat ?? current.latitude,
              longitude: place.lng ?? current.longitude,
            }))}
            inputClassName="fd-input"
            autoComplete="street-address"
            ariaLabel={t('food.merchant.street')}
          />
        </div>
        <div className="fd-field" style={{ flex: 1 }}>
          <label htmlFor="fd-r-city">{t('food.merchant.city')}</label>
          <input id="fd-r-city" value={form.addressCity} onChange={set('addressCity')} />
        </div>
      </div>
      <div className="fd-row">
        <div className="fd-field" style={{ flex: 1 }}>
          <label htmlFor="fd-r-state">{t('food.merchant.state')}</label>
          <input id="fd-r-state" value={form.addressState} onChange={set('addressState')} />
        </div>
        <div className="fd-field" style={{ flex: 1 }}>
          <label htmlFor="fd-r-zip">{t('food.merchant.zip')}</label>
          <input id="fd-r-zip" value={form.addressZip} onChange={set('addressZip')} />
        </div>
        <div className="fd-field" style={{ flex: 1 }}>
          <label htmlFor="fd-r-country">{t('food.merchant.country')}</label>
          <input id="fd-r-country" value={form.addressCountry} onChange={set('addressCountry')} maxLength={2} />
        </div>
        <div className="fd-field" style={{ flex: 1 }}>
          <label htmlFor="fd-r-currency">{t('food.merchant.currency')}</label>
          <input id="fd-r-currency" value={form.currencyCode} onChange={set('currencyCode')} maxLength={3} />
        </div>
      </div>
      <div className="fd-row">
        <div className="fd-field" style={{ flex: 1 }}>
          <label htmlFor="fd-r-lat">{t('food.merchant.latitude')}</label>
          <input id="fd-r-lat" value={form.latitude} onChange={set('latitude')} inputMode="decimal" />
        </div>
        <div className="fd-field" style={{ flex: 1 }}>
          <label htmlFor="fd-r-lng">{t('food.merchant.longitude')}</label>
          <input id="fd-r-lng" value={form.longitude} onChange={set('longitude')} inputMode="decimal" />
        </div>
      </div>
      <button type="submit" className="fd-btn" disabled={saving}>
        {saving ? t('food.common.saving') : t('food.merchant.createBtn')}
      </button>
    </form>
  );
}

const ORDER_PAGE_SIZE = 20;
const ORDER_HISTORY_STATUSES = ['completed', 'cancelled', 'refunded'];

function orderMetadata(order) {
  return order?.metadata && typeof order.metadata === 'object' ? order.metadata : {};
}

function orderPaymentMode(order) {
  const metadata = orderMetadata(order);
  return order.payment_mode
    || metadata.paymentMode
    || metadata.payment_mode
    || metadata.paymentContract?.mode
    || metadata.payment_contract?.mode
    || 'pay_at_restaurant';
}

function orderExternalPayment(order) {
  const metadata = orderMetadata(order);
  return metadata.externalPayment || metadata.external_payment || null;
}

function orderDeliveryAddress(order) {
  const metadata = orderMetadata(order);
  return metadata.deliveryAddress || metadata.delivery_address || null;
}

function formatAddress(address) {
  if (!address) return '';
  if (typeof address === 'string') return address;
  return [
    address.line1 || address.line_1 || address.street,
    address.line2 || address.line_2,
    address.city,
    address.state,
    address.postalCode || address.postal_code || address.zip,
    address.country,
  ].filter(Boolean).join(', ');
}

function formatOrderDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function historyStartDate(range) {
  if (range === 'all') return null;
  const days = Number(range);
  if (!Number.isFinite(days)) return null;
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - Math.max(0, days - 1));
  return date.toISOString();
}

function paymentModeLabel(t, order) {
  const mode = orderPaymentMode(order);
  const labels = {
    wallet_credit: t('food.merchant.orderCenter.restaurantCredit', 'Restaurant credit'),
    restaurant_credit: t('food.merchant.orderCenter.restaurantCredit', 'Restaurant credit'),
    direct_payment: t('food.merchant.orderCenter.directPayment', 'Direct payment'),
    pay_now: t('food.merchant.orderCenter.onlinePayment', 'Online payment'),
    pay_at_counter: t('food.merchant.orderCenter.payAtRestaurant', 'Pay at restaurant'),
    pay_at_restaurant: t('food.merchant.orderCenter.payAtRestaurant', 'Pay at restaurant'),
  };
  return labels[mode] || mode.replaceAll('_', ' ');
}

function paymentStatusLabel(t, status) {
  if (status === 'paid') return t('food.payment.paid');
  if (status === 'refunded') return t('food.merchant.orderCenter.paymentRefunded', 'Payment refunded');
  if (status === 'failed') return t('food.merchant.orderCenter.paymentFailed', 'Payment failed');
  if (status === 'requires_payment') return t('food.merchant.orderCenter.paymentPending', 'Payment pending');
  return t('food.payment.unpaid');
}

function OrderDetailPanel({ t, order, onAdvance, onCancel, onMarkPaid, onClose, detailRef }) {
  if (!order) {
    return (
      <aside ref={detailRef} className="fd-order-detail fd-order-detail-empty">
        <span aria-hidden>↖</span>
        <h3>{t('food.merchant.orderCenter.selectOrder', 'Select an order')}</h3>
        <p>{t('food.merchant.orderCenter.selectOrderHint', 'Choose an order to see customer, timing, payment, and item details.')}</p>
      </aside>
    );
  }

  const address = orderDeliveryAddress(order);
  const addressText = formatAddress(address);
  const externalPayment = orderExternalPayment(order);
  const submission = externalPayment?.submission || externalPayment?.proof || externalPayment?.paymentProof || null;
  const attachmentUrl = submission?.attachmentUrl || submission?.url || externalPayment?.attachmentUrl || null;
  const paymentReference = submission?.reference || externalPayment?.reference || null;
  const timeline = [
    ['placed', order.created_at],
    ['accepted', order.accepted_at || order.kitchen_acknowledged_at],
    ['preparing', order.preparation_started_at],
    ['ready', order.ready_at || order.quality_check_at],
    ['completed', order.completed_at || order.handed_off_at],
    ['cancelled', order.cancelled_at],
  ].filter(([, value]) => value);

  return (
    <aside ref={detailRef} className="fd-order-detail" aria-label={t('food.merchant.orderCenter.orderDetails', 'Order details')}>
      <div className="fd-order-detail-head">
        <div>
          <span>{t('food.merchant.orderCenter.orderNumber', 'Order')} #{order.queue_number || order.id}</span>
          <h3>{order.customer_name || order.guest_name || t('food.merchant.guest')}</h3>
          <small>{t('food.merchant.orderCenter.placed', 'Placed')} {formatOrderDateTime(order.created_at)}</small>
        </div>
        <div className="fd-order-detail-badges">
          <span className={`fd-status-pill fd-order-status-${order.status}`}>{t(FOOD_STATUS_KEYS[order.status] || 'food.status.received')}</span>
          <span className={`fd-status-pill${order.payment_status === 'paid' ? ' fd-paid-pill' : ''}`}>
            {paymentStatusLabel(t, order.payment_status)}
          </span>
        </div>
        <button type="button" className="fd-order-detail-close" onClick={onClose} aria-label={t('food.common.close', 'Close')}>×</button>
      </div>

      <section className="fd-order-detail-section">
        <h4>{t('food.merchant.orderCenter.customer', 'Customer')}</h4>
        <dl className="fd-order-detail-list">
          <div><dt>{t('food.merchant.orderCenter.name', 'Name')}</dt><dd>{order.customer_name || order.guest_name || t('food.merchant.guest')}</dd></div>
          {order.customer_phone && <div><dt>{t('food.merchant.orderCenter.phone', 'Phone')}</dt><dd><a href={`tel:${order.customer_phone}`}>{order.customer_phone}</a></dd></div>}
          {order.customer_email && <div><dt>{t('food.merchant.orderCenter.email', 'Email')}</dt><dd><a href={`mailto:${order.customer_email}`}>{order.customer_email}</a></dd></div>}
        </dl>
      </section>

      <section className="fd-order-detail-section">
        <h4>{t('food.merchant.orderCenter.fulfillment', 'Fulfillment')}</h4>
        <dl className="fd-order-detail-list">
          <div><dt>{t('food.merchant.orderCenter.type', 'Type')}</dt><dd>{t(`food.fulfillment.${order.fulfillment_type}`)}</dd></div>
          <div><dt>{t('food.merchant.orderCenter.source', 'Source')}</dt><dd>{t(`food.source.${order.order_source}`)}</dd></div>
          {order.table_label && <div><dt>{t('food.order.tableLabel')}</dt><dd>{order.table_label}</dd></div>}
          <div>
            <dt>{t('food.merchant.orderCenter.location', 'Location')}</dt>
            <dd>{addressText || (order.fulfillment_type === 'delivery'
              ? t('food.merchant.orderCenter.addressUnavailable', 'Delivery address unavailable')
              : t('food.merchant.orderCenter.atRestaurant', 'At the restaurant'))}</dd>
          </div>
          {address?.instructions && <div><dt>{t('food.merchant.orderCenter.deliveryNotes', 'Delivery notes')}</dt><dd>{address.instructions}</dd></div>}
          <div><dt>{t('food.merchant.orderCenter.promised', 'Promised')}</dt><dd>{formatOrderDateTime(order.promised_at)}</dd></div>
        </dl>
      </section>

      <section className="fd-order-detail-section">
        <h4>{t('food.merchant.orderCenter.items', 'Items')}</h4>
        <div className="fd-order-detail-items">
          {(order.items || []).map((item) => (
            <div key={item.id || `${item.itemName}-${item.quantity}`}>
              <span className="fd-order-item-qty">{item.quantity}×</span>
              <div>
                <strong>{item.itemName}</strong>
                {(item.modifiers || []).length > 0 && <small>{item.modifiers.map((modifier) => modifier.name).join(', ')}</small>}
                {item.specialInstructions && <small className="fd-order-item-note">“{item.specialInstructions}”</small>}
              </div>
              <b>{formatFoodMoney(item.lineTotalCents, order.currency_code)}</b>
            </div>
          ))}
        </div>
      </section>

      {(order.notes || externalPayment) && (
        <section className="fd-order-detail-section">
          <h4>{t('food.merchant.orderCenter.notesAndPayment', 'Notes & payment')}</h4>
          {order.notes && <p className="fd-order-notes">{order.notes}</p>}
          <dl className="fd-order-detail-list">
            <div><dt>{t('food.merchant.orderCenter.paymentMethod', 'Payment method')}</dt><dd>{paymentModeLabel(t, order)}</dd></div>
            {externalPayment?.handle && <div><dt>{t('food.merchant.orderCenter.paymentTo', 'Payment sent to')}</dt><dd>{externalPayment.handle}</dd></div>}
            {paymentReference && <div><dt>{t('food.merchant.orderCenter.reference', 'Reference')}</dt><dd>{paymentReference}</dd></div>}
          </dl>
          {attachmentUrl && <a className="fd-btn fd-btn-secondary fd-btn-sm" href={attachmentUrl} target="_blank" rel="noreferrer">{t('food.merchant.orderCenter.viewProof', 'View payment proof')}</a>}
        </section>
      )}

      <section className="fd-order-detail-section">
        <h4>{t('food.merchant.orderCenter.total', 'Total')}</h4>
        <dl className="fd-order-price-list">
          <div><dt>{t('food.merchant.orderCenter.subtotal', 'Subtotal')}</dt><dd>{formatFoodMoney(order.subtotal_cents, order.currency_code)}</dd></div>
          {Number(order.discount_cents) > 0 && <div><dt>{t('food.merchant.orderCenter.discount', 'Discount')}</dt><dd>−{formatFoodMoney(order.discount_cents, order.currency_code)}</dd></div>}
          {Number(order.tax_cents) > 0 && <div><dt>{t('food.merchant.orderCenter.tax', 'Tax')}</dt><dd>{formatFoodMoney(order.tax_cents, order.currency_code)}</dd></div>}
          {Number(order.service_fee_cents) > 0 && <div><dt>{t('food.merchant.orderCenter.serviceFee', 'Service fee')}</dt><dd>{formatFoodMoney(order.service_fee_cents, order.currency_code)}</dd></div>}
          {Number(order.delivery_fee_cents) > 0 && <div><dt>{t('food.merchant.orderCenter.deliveryFee', 'Delivery fee')}</dt><dd>{formatFoodMoney(order.delivery_fee_cents, order.currency_code)}</dd></div>}
          {Number(order.tip_cents) > 0 && <div><dt>{t('food.merchant.orderCenter.tip', 'Tip')}</dt><dd>{formatFoodMoney(order.tip_cents, order.currency_code)}</dd></div>}
          <div className="fd-order-price-total"><dt>{t('food.merchant.orderCenter.total', 'Total')}</dt><dd>{formatFoodMoney(order.total_cents, order.currency_code)}</dd></div>
        </dl>
      </section>

      {timeline.length > 1 && (
        <section className="fd-order-detail-section">
          <h4>{t('food.merchant.orderCenter.timeline', 'Order timeline')}</h4>
          <ol className="fd-order-timeline">
            {timeline.map(([key, value]) => <li key={key}><span>{t(`food.merchant.orderCenter.${key}`, key)}</span><time>{formatOrderDateTime(value)}</time></li>)}
          </ol>
        </section>
      )}

      <div className="fd-order-detail-actions">
        {order.payment_status !== 'paid' && <button type="button" className="fd-btn fd-btn-secondary" onClick={() => onMarkPaid(order)}>{orderExternalPayment(order) ? t('food.merchant.confirmPayment', 'Confirm payment') : t('food.merchant.markPaid')}</button>}
        {NEXT_STATUS[order.status] && <button type="button" className="fd-btn" onClick={() => onAdvance(order)}>{t(`food.advance.${NEXT_STATUS[order.status]}`)}</button>}
        {['received', 'accepted', 'preparing'].includes(order.status) && <button type="button" className="fd-btn fd-btn-danger" onClick={() => onCancel(order)}>{t('food.common.cancel')}</button>}
      </div>
    </aside>
  );
}

// ── Restaurant order center ─────────────────────────────────────────────────
function OrdersTab({ t, restaurant }) {
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState(null);
  const [meta, setMeta] = useState({ total: 0, hasMore: false });
  const [feedError, setFeedError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('active');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [statusFilter, setStatusFilter] = useState('all');
  const [fulfillmentFilter, setFulfillmentFilter] = useState('all');
  const [historyRange, setHistoryRange] = useState('30');
  const [page, setPage] = useState(0);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const timerRef = useRef(null);
  const requestSequenceRef = useRef(0);
  const detailRef = useRef(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    const requestSequence = ++requestSequenceRef.current;
    if (!quiet) setLoading(true);
    try {
      const result = await listFoodRestaurantOrdersPage(restaurant.id, {
        scope: view,
        q: deferredSearch || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
        fulfillment: fulfillmentFilter === 'all' ? undefined : fulfillmentFilter,
        from: view === 'history' ? historyStartDate(historyRange) || undefined : undefined,
        limit: ORDER_PAGE_SIZE,
        offset: page * ORDER_PAGE_SIZE,
        includeMeta: 1,
      });
      if (requestSequence !== requestSequenceRef.current) return;
      setOrders(result.orders);
      setMeta(result.meta);
      if (result.summary) setSummary(result.summary);
      setSelectedOrderId((current) => {
        if (current && result.orders.some((order) => String(order.id) === String(current))) return current;
        return null;
      });
      setFeedError(false);
    } catch {
      if (requestSequence === requestSequenceRef.current) setFeedError(true);
    } finally {
      if (!quiet && requestSequence === requestSequenceRef.current) setLoading(false);
    }
  }, [deferredSearch, fulfillmentFilter, historyRange, page, restaurant.id, statusFilter, view]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (view !== 'active') return undefined;
    timerRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') load({ quiet: true });
    }, 10000);
    const unsubscribe = subscribeRestaurantDisplay(restaurant.id, () => load({ quiet: true }));
    return () => {
      clearInterval(timerRef.current);
      unsubscribe();
    };
  }, [load, restaurant.id, view]);

  useEffect(() => {
    setPage(0);
  }, [deferredSearch, fulfillmentFilter, historyRange, statusFilter, view]);

  const selectView = (nextView) => {
    setView(nextView);
    setStatusFilter('all');
    setSelectedOrderId(null);
    setPage(0);
  };

  const selectedOrder = orders.find((order) => String(order.id) === String(selectedOrderId)) || null;

  const openOrder = (orderId) => {
    setSelectedOrderId(orderId);
    if (window.matchMedia('(max-width: 900px)').matches) {
      window.requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  const reloadAfterAction = useCallback(() => {
    load({ quiet: true });
  }, [load]);

  const refreshOrderInView = useCallback((orderId) => {
    if (String(selectedOrderId) === String(orderId)) setSelectedOrderId(null);
    reloadAfterAction();
  }, [reloadAfterAction, selectedOrderId]);

  const updateFailure = (err) => {
    toast.error(apiErrorMessage(err, t('food.merchant.statusError')));
  };

  const advance = async (order) => {
    const next = NEXT_STATUS[order.status];
    if (!next) return;
    try {
      await updateFoodOrderStatus(restaurant.id, order.id, next);
      refreshOrderInView(order.id);
    } catch (err) {
      updateFailure(err);
    }
  };

  const cancel = async (order) => {
    try {
      await updateFoodOrderStatus(restaurant.id, order.id, 'cancelled');
      refreshOrderInView(order.id);
    } catch (err) {
      updateFailure(err);
    }
  };

  const markPaid = async (order) => {
    try {
      const externalPayment = orderExternalPayment(order);
      const submission = externalPayment?.submission || externalPayment?.proof || externalPayment?.paymentProof || {};
      const reference = submission.reference || externalPayment?.reference || null;
      const amountCents = Number(order.amount_due_cents ?? order.balance_due_cents ?? order.total_cents ?? 0);
      const isDirectPayment = Boolean(externalPayment) || orderPaymentMode(order) === 'direct_payment';
      await recordFoodOrderManualPayment(restaurant.id, order.id, {
        paymentType: isDirectPayment ? 'external' : 'cash',
        paymentMode: isDirectPayment ? 'direct_payment' : 'pay_at_restaurant',
        amountCents,
        status: 'recorded',
        reference: reference || undefined,
        note: isDirectPayment
          ? 'Restaurant confirmed the customer payment submission.'
          : 'Restaurant confirmed payment received.',
        metadata: { source: 'restaurant_owner_web_confirmation', receiptConfirmed: true },
        idempotencyKey: `restaurant-owner-payment:${restaurant.id}:${order.id}:${amountCents}`,
      });
      toast.success(isDirectPayment ? t('food.merchant.orderCenter.paymentConfirmed', 'Payment confirmed.') : t('food.merchant.orderCenter.orderMarkedPaid', 'Order marked paid.'));
      reloadAfterAction();
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.merchant.orderCenter.paymentError', 'Unable to confirm this payment.')));
    }
  };

  const statusOptions = view === 'active'
    ? ['received', 'accepted', 'preparing', 'ready']
    : ORDER_HISTORY_STATUSES;

  const totalPages = Math.max(1, Math.ceil(Number(meta.total || 0) / ORDER_PAGE_SIZE));

  return (
    <div className="fd-section fd-order-center">
      <header className="fd-order-center-header">
        <div>
          <span className="fd-order-center-eyebrow">{t('food.merchant.orderCenter.eyebrow', 'Restaurant operations')}</span>
          <div className="fd-order-center-title">
            <h2>{t('food.merchant.orderCenter.title', 'Orders')}</h2>
            <FoodConnBadge ok={!feedError} />
          </div>
          <p>{t('food.merchant.orderCenter.subtitle', 'Manage live service and find every completed, cancelled, or refunded order.')}</p>
        </div>
        <nav className="fd-order-screen-links" aria-label={t('food.merchant.orderCenter.inStoreScreens', 'In-store screens')}>
          <Link to={`/restaurants/kitchen/${restaurant.id}`} className="fd-btn fd-btn-secondary fd-btn-sm">{t('food.merchant.openKitchen')}</Link>
          <Link to={`/restaurants/queue/${restaurant.id}`} className="fd-btn fd-btn-secondary fd-btn-sm">{t('food.merchant.openQueue')}</Link>
          <Link to={`/restaurants/kiosk/${restaurant.id}`} className="fd-btn fd-btn-secondary fd-btn-sm">{t('food.merchant.openKiosk')}</Link>
        </nav>
      </header>

      <div className="fd-order-summary" aria-label={t('food.merchant.orderCenter.todaySummary', "Today's summary")}>
        <div><span aria-hidden>●</span><strong>{Number(summary?.new_orders || 0)}</strong><small>{t('food.merchant.orderCenter.newOrders', 'New')}</small></div>
        <div><span aria-hidden>◷</span><strong>{Number(summary?.preparing_orders || 0)}</strong><small>{t('food.merchant.orderCenter.preparing', 'Preparing')}</small></div>
        <div><span aria-hidden>✓</span><strong>{Number(summary?.ready_orders || 0)}</strong><small>{t('food.merchant.orderCenter.ready', 'Ready')}</small></div>
        <div><span aria-hidden>▣</span><strong>{Number(summary?.completed_orders || 0)}</strong><small>{t('food.merchant.orderCenter.completedToday', 'Completed today')}</small></div>
        <div className="fd-order-summary-sales"><span aria-hidden>¤</span><strong>{formatFoodMoney(summary?.paid_sales_cents || 0, restaurant.currency_code)}</strong><small>{t('food.merchant.orderCenter.paidSalesToday', 'Paid sales today')}</small></div>
      </div>

      <div className="fd-order-view-tabs" role="tablist" aria-label={t('food.merchant.orderCenter.orderViews', 'Order views')}>
        <button type="button" role="tab" aria-selected={view === 'active'} className={view === 'active' ? 'fd-active' : ''} onClick={() => selectView('active')}>
          {t('food.merchant.orderCenter.live', 'Live')} <span>{view === 'active' ? meta.total : Number(summary?.new_orders || 0) + Number(summary?.preparing_orders || 0) + Number(summary?.ready_orders || 0)}</span>
        </button>
        <button type="button" role="tab" aria-selected={view === 'history'} className={view === 'history' ? 'fd-active' : ''} onClick={() => selectView('history')}>
          {t('food.merchant.orderCenter.history', 'Order history')}
        </button>
      </div>

      <div className="fd-order-filters">
        <label className="fd-order-search">
          <span aria-hidden>⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('food.merchant.orderCenter.search', 'Search order, customer, phone, or item…')} />
        </label>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label={t('food.merchant.orderCenter.filterStatus', 'Filter by status')}>
          <option value="all">{t('food.merchant.orderCenter.allStatuses', 'All statuses')}</option>
          {statusOptions.map((status) => <option key={status} value={status}>{t(FOOD_STATUS_KEYS[status] || `food.status.${status}`)}</option>)}
        </select>
        <select value={fulfillmentFilter} onChange={(event) => setFulfillmentFilter(event.target.value)} aria-label={t('food.merchant.orderCenter.filterFulfillment', 'Filter by fulfillment')}>
          <option value="all">{t('food.merchant.orderCenter.allFulfillment', 'All fulfillment')}</option>
          {['pickup', 'dine_in', 'delivery', 'kiosk'].map((type) => <option key={type} value={type}>{t(`food.fulfillment.${type}`)}</option>)}
        </select>
        {view === 'history' && (
          <select value={historyRange} onChange={(event) => setHistoryRange(event.target.value)} aria-label={t('food.merchant.orderCenter.dateRange', 'Date range')}>
            <option value="7">{t('food.merchant.orderCenter.last7Days', 'Last 7 days')}</option>
            <option value="30">{t('food.merchant.orderCenter.last30Days', 'Last 30 days')}</option>
            <option value="90">{t('food.merchant.orderCenter.last90Days', 'Last 90 days')}</option>
            <option value="all">{t('food.merchant.orderCenter.allTime', 'All time')}</option>
          </select>
        )}
        <button type="button" className="fd-order-refresh" onClick={() => load()} aria-label={t('food.merchant.orderCenter.refresh', 'Refresh orders')}>↻</button>
      </div>

      {feedError && <div className="fd-order-feed-error" role="alert">{t('food.merchant.orderCenter.loadError', 'Some order information could not be loaded.')} <button type="button" onClick={() => load()}>{t('food.common.retry', 'Retry')}</button></div>}

      <div className="fd-order-workspace">
        <div className="fd-order-list" aria-busy={loading}>
          {loading && orders.length === 0 && <div className="fd-order-loading">{t('food.merchant.orderCenter.loading', 'Loading orders…')}</div>}
          {!loading && orders.length === 0 && (
            <div className="fd-order-empty">
              <span aria-hidden>{view === 'active' ? '✓' : '⌕'}</span>
              <h3>{view === 'active' ? t('food.merchant.noOrders') : t('food.merchant.orderCenter.noHistory', 'No orders match these filters')}</h3>
              <p>{view === 'active' ? t('food.merchant.orderCenter.noLiveHint', 'New orders will appear here automatically.') : t('food.merchant.orderCenter.noHistoryHint', 'Try a longer date range or clear a filter.')}</p>
            </div>
          )}
          {orders.map((order) => {
            const addressText = formatAddress(orderDeliveryAddress(order));
            const selected = String(order.id) === String(selectedOrderId);
            return (
              <article key={order.id} className={`fd-order-list-card fd-status-${order.status}${selected ? ' fd-selected' : ''}`}>
                <button type="button" className="fd-order-list-select" onClick={() => openOrder(order.id)} aria-label={`${t('food.merchant.orderCenter.viewOrder', 'View order')} #${order.queue_number || order.id}`}>
                  <div className="fd-order-list-top">
                    <div><strong>#{order.queue_number || order.id}</strong><span>{order.customer_name || order.guest_name || t('food.merchant.guest')}</span></div>
                    <time>{formatOrderDateTime(order.created_at)}</time>
                  </div>
                  <div className="fd-order-list-pills">
                    <span className={`fd-status-pill fd-order-status-${order.status}`}>{t(FOOD_STATUS_KEYS[order.status] || 'food.status.received')}</span>
                    <span>{t(`food.fulfillment.${order.fulfillment_type}`)}</span>
                    <span>{t(`food.source.${order.order_source}`)}</span>
                  </div>
                  <p className="fd-order-list-items">{(order.items || []).map((item) => `${item.quantity}× ${item.itemName}`).join(', ') || t('food.merchant.orderCenter.noItems', 'No item details')}</p>
                  <div className="fd-order-list-bottom">
                    <span>{addressText || order.table_label || (order.fulfillment_type === 'delivery' ? t('food.merchant.orderCenter.delivery', 'Delivery') : t('food.merchant.orderCenter.atRestaurant', 'At the restaurant'))}</span>
                    <strong>{formatFoodMoney(order.total_cents, order.currency_code)}</strong>
                  </div>
                </button>
                <div className="fd-order-list-actions">
                  <span className={order.payment_status === 'paid' ? 'fd-order-paid' : 'fd-order-unpaid'}>{order.payment_status === 'unpaid' ? paymentModeLabel(t, order) : paymentStatusLabel(t, order.payment_status)}</span>
                  <button type="button" onClick={() => openOrder(order.id)}>{t('food.merchant.orderCenter.details', 'Details')} →</button>
                </div>
              </article>
            );
          })}

          {meta.total > ORDER_PAGE_SIZE && (
            <nav className="fd-order-pagination" aria-label={t('food.merchant.orderCenter.pagination', 'Order history pages')}>
              <button type="button" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>{t('food.merchant.orderCenter.previous', 'Previous')}</button>
              <span>{t('food.merchant.orderCenter.pageOf', 'Page {{page}} of {{pages}}', { page: page + 1, pages: totalPages })}</span>
              <button type="button" disabled={!meta.hasMore} onClick={() => setPage((current) => current + 1)}>{t('food.merchant.orderCenter.next', 'Next')}</button>
            </nav>
          )}
        </div>

        <OrderDetailPanel
          t={t}
          order={selectedOrder}
          onAdvance={advance}
          onCancel={cancel}
          onMarkPaid={markPaid}
          onClose={() => setSelectedOrderId(null)}
          detailRef={detailRef}
        />
      </div>
    </div>
  );
}


// ── Menu manager tab ─────────────────────────────────────────────────────────
function MenuTab({ t, restaurant }) {
  const [menuData, setMenuData] = useState(null);
  const [newCategory, setNewCategory] = useState('');
  const [itemForm, setItemForm] = useState({ name: '', price: '', categoryId: '', description: '' });
  const [modifierTarget, setModifierTarget] = useState(null);
  const [modifierForm, setModifierForm] = useState({ name: '', maxSelect: 1, required: false, options: '' });

  const load = useCallback(() => {
    getFoodRestaurant(restaurant.id).then(setMenuData).catch(() => {});
  }, [restaurant.id]);
  useEffect(() => { load(); }, [load]);

  const addCategory = async (e) => {
    e.preventDefault();
    if (!newCategory.trim()) return;
    try {
      await createFoodCategory(restaurant.id, { name: newCategory.trim() });
      setNewCategory('');
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.merchant.menuError')));
    }
  };

  const addItem = async (e) => {
    e.preventDefault();
    const priceCents = Math.round(Number(itemForm.price) * 100);
    if (!itemForm.name.trim() || !Number.isFinite(priceCents) || priceCents < 0) return;
    try {
      await createFoodMenuItem(restaurant.id, {
        name: itemForm.name.trim(),
        priceCents,
        categoryId: itemForm.categoryId || undefined,
        description: itemForm.description.trim() || undefined,
      });
      setItemForm({ name: '', price: '', categoryId: itemForm.categoryId, description: '' });
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.merchant.menuError')));
    }
  };

  const toggleAvailability = async (item) => {
    try {
      await updateFoodMenuItem(restaurant.id, item.id, { isAvailable: !item.is_available });
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.merchant.menuError')));
    }
  };

  const removeItem = async (item) => {
    try {
      await deleteFoodMenuItem(restaurant.id, item.id);
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.merchant.menuError')));
    }
  };

  const removeCategory = async (category) => {
    try {
      await deleteFoodCategory(restaurant.id, category.id);
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.merchant.menuError')));
    }
  };

  const addModifierGroup = async (e) => {
    e.preventDefault();
    if (!modifierTarget || !modifierForm.name.trim()) return;
    try {
      await createFoodModifierGroup(restaurant.id, modifierTarget.id, {
        name: modifierForm.name.trim(),
        maxSelect: Number(modifierForm.maxSelect) || 1,
        minSelect: modifierForm.required ? 1 : 0,
        isRequired: modifierForm.required,
        // "Small:0, Medium:50, Large:100" -> [{name, priceDeltaCents}]
        options: modifierForm.options
          .split(',')
          .map((chunk) => {
            const [name, delta] = chunk.split(':').map((s) => s.trim());
            return name ? { name, priceDeltaCents: Math.round(Number(delta || 0)) } : null;
          })
          .filter(Boolean),
      });
      setModifierTarget(null);
      setModifierForm({ name: '', maxSelect: 1, required: false, options: '' });
      load();
      toast.success(t('food.merchant.modifierAdded'));
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.merchant.menuError')));
    }
  };

  const categories = menuData?.menu || [];
  const allSections = [
    ...categories,
    ...((menuData?.uncategorizedItems || []).length
      ? [{ id: null, name: t('food.restaurant.otherItems'), items: menuData.uncategorizedItems }]
      : []),
  ];

  return (
    <div className="fd-section">
      <h2>{t('food.merchant.menu')}</h2>

      <form onSubmit={addCategory} className="fd-row" style={{ marginBottom: '1rem' }}>
        <input
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          placeholder={t('food.merchant.newCategoryPlaceholder')}
          maxLength={120}
          style={{ flex: 1, padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid var(--border-color, #e5e7eb)', background: 'var(--card-bg, #fff)', color: 'inherit' }}
        />
        <button type="submit" className="fd-btn fd-btn-sm">{t('food.merchant.addCategory')}</button>
      </form>

      <form onSubmit={addItem} className="fd-section" style={{ border: '1px dashed var(--border-color, #e5e7eb)', borderRadius: 12, padding: '0.9rem' }}>
        <strong>{t('food.merchant.addItem')}</strong>
        <div className="fd-row" style={{ marginTop: '0.6rem' }}>
          <div className="fd-field" style={{ flex: 2 }}>
            <label htmlFor="fd-i-name">{t('food.merchant.itemName')} *</label>
            <input id="fd-i-name" value={itemForm.name} onChange={(e) => setItemForm((f) => ({ ...f, name: e.target.value }))} maxLength={160} />
          </div>
          <div className="fd-field" style={{ flex: 1 }}>
            <label htmlFor="fd-i-price">{t('food.merchant.itemPrice')} *</label>
            <input id="fd-i-price" value={itemForm.price} onChange={(e) => setItemForm((f) => ({ ...f, price: e.target.value }))} inputMode="decimal" />
          </div>
          <div className="fd-field" style={{ flex: 1 }}>
            <label htmlFor="fd-i-cat">{t('food.merchant.itemCategory')}</label>
            <select id="fd-i-cat" value={itemForm.categoryId} onChange={(e) => setItemForm((f) => ({ ...f, categoryId: e.target.value }))}>
              <option value="">{t('food.merchant.noCategory')}</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="fd-field">
          <label htmlFor="fd-i-desc">{t('food.merchant.itemDescription')}</label>
          <input id="fd-i-desc" value={itemForm.description} onChange={(e) => setItemForm((f) => ({ ...f, description: e.target.value }))} maxLength={2000} />
        </div>
        <button type="submit" className="fd-btn fd-btn-sm">{t('food.merchant.addItemBtn')}</button>
      </form>

      {allSections.map((section) => (
        <div key={section.id ?? 'other'} style={{ marginTop: '1rem' }}>
          <div className="fd-row" style={{ justifyContent: 'space-between' }}>
            <h3 className="fd-cat-title" style={{ flex: 1 }}>{section.name}</h3>
            {section.id && (
              <button type="button" className="fd-btn fd-btn-danger fd-btn-sm" onClick={() => removeCategory(section)}>
                {t('food.common.delete')}
              </button>
            )}
          </div>
          {(section.items || []).map((item) => (
            <div key={item.id} className="fd-menu-item" style={{ cursor: 'default' }}>
              <div>
                <h4>{item.name}</h4>
                <p>{formatFoodMoney(item.price_cents, restaurant.currency_code)}{!item.is_available && ` · ${t('food.restaurant.soldOut')}`}</p>
              </div>
              <span className="fd-row">
                <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => setModifierTarget(item)}>
                  {t('food.merchant.addModifiers')}
                </button>
                <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => toggleAvailability(item)}>
                  {item.is_available ? t('food.merchant.markSoldOut') : t('food.merchant.markAvailable')}
                </button>
                <button type="button" className="fd-btn fd-btn-danger fd-btn-sm" onClick={() => removeItem(item)}>
                  {t('food.common.delete')}
                </button>
              </span>
            </div>
          ))}
        </div>
      ))}

      {modifierTarget && (
        <div className="fd-modal-overlay" onClick={() => setModifierTarget(null)} role="presentation">
          <form className="fd-modal" onClick={(e) => e.stopPropagation()} onSubmit={addModifierGroup}>
            <h3>{t('food.merchant.modifiersFor', { item: modifierTarget.name })}</h3>
            <div className="fd-field">
              <label htmlFor="fd-m-name">{t('food.merchant.modifierGroupName')} *</label>
              <input id="fd-m-name" value={modifierForm.name} onChange={(e) => setModifierForm((f) => ({ ...f, name: e.target.value }))} maxLength={120} />
            </div>
            <div className="fd-row">
              <div className="fd-field" style={{ flex: 1 }}>
                <label htmlFor="fd-m-max">{t('food.merchant.maxSelect')}</label>
                <input id="fd-m-max" type="number" min={1} max={10} value={modifierForm.maxSelect} onChange={(e) => setModifierForm((f) => ({ ...f, maxSelect: e.target.value }))} />
              </div>
              <div className="fd-field" style={{ flex: 1 }}>
                <label htmlFor="fd-m-req">{t('food.merchant.required')}</label>
                <select id="fd-m-req" value={modifierForm.required ? '1' : '0'} onChange={(e) => setModifierForm((f) => ({ ...f, required: e.target.value === '1' }))}>
                  <option value="0">{t('food.common.no')}</option>
                  <option value="1">{t('food.common.yes')}</option>
                </select>
              </div>
            </div>
            <div className="fd-field">
              <label htmlFor="fd-m-opts">{t('food.merchant.modifierOptions')}</label>
              <input id="fd-m-opts" value={modifierForm.options} onChange={(e) => setModifierForm((f) => ({ ...f, options: e.target.value }))} placeholder={t('food.merchant.modifierOptionsPlaceholder')} />
            </div>
            <div className="fd-row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="fd-btn fd-btn-secondary" onClick={() => setModifierTarget(null)}>{t('food.common.cancel')}</button>
              <button type="submit" className="fd-btn">{t('food.common.save')}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ── Settings tab ─────────────────────────────────────────────────────────────
const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DEFAULT_OPEN_TIME = '11:00';
const DEFAULT_CLOSE_TIME = '22:00';

const blankDayHours = (open = DEFAULT_OPEN_TIME, close = DEFAULT_CLOSE_TIME, closed = false) => ({ open, close, closed });

function dayHoursFromRestaurant(rest) {
  const weekly = rest && rest.operating_hours && typeof rest.operating_hours === 'object'
    ? rest.operating_hours.weekly
    : null;
  return WEEKDAY_KEYS.map((key) => {
    const entry = weekly && typeof weekly === 'object' ? weekly[key] : null;
    if (entry && entry.closed) return blankDayHours(entry.open || DEFAULT_OPEN_TIME, entry.close || DEFAULT_CLOSE_TIME, true);
    if (entry && (entry.open || entry.close)) {
      return blankDayHours(entry.open || DEFAULT_OPEN_TIME, entry.close || DEFAULT_CLOSE_TIME, false);
    }
    return blankDayHours();
  });
}

function weekDayLabel(i18n, index) {
  // 2026-06-01 is a Monday; weekday names come from the browser locale data.
  const date = new Date(Date.UTC(2026, 5, 1 + index));
  try {
    return new Intl.DateTimeFormat(i18n?.language || 'en', { weekday: 'short' }).format(date);
  } catch {
    return WEEKDAY_KEYS[index];
  }
}
// ── Settings tab primitives ──────────────────────────────────────────────────
// FdSwitch: accessible toggle switch. Replaces the old label-flipping boolean
// buttons throughout the settings tab.
function FdSwitch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`fd-switch${checked ? ' fd-switch--on' : ''}`}
    >
      <span className="fd-switch-knob" aria-hidden="true" />
    </button>
  );
}

function FdSwitchRow({ label, checked, disabled, onChange }) {
  return (
    <div className="fd-settings-switch-row">
      <span className="fd-settings-switch-label">{label}</span>
      <FdSwitch checked={checked} disabled={disabled} onChange={onChange} label={label} />
    </div>
  );
}

function SettingsCard({ icon: Icon, title, desc, cardKey, registerRef, wide, bareHead, children }) {
  return (
    <section
      ref={(el) => registerRef(cardKey, el)}
      className={`fd-settings-card${wide ? ' fd-settings-card--wide' : ''}`}
    >
      {!bareHead && (
        <header className="fd-settings-card-head">
          <span className="fd-settings-card-icon" aria-hidden="true"><Icon size={18} /></span>
          <div>
            <h3 className="fd-settings-card-title">{title}</h3>
            {desc && <p className="fd-card-meta fd-settings-card-desc">{desc}</p>}
          </div>
        </header>
      )}
      <div className="fd-settings-card-body">{children}</div>
    </section>
  );
}

function SettingsTab({ t, i18n, restaurant, onUpdated, onSetupChanged }) {
  const [saving, setSaving] = useState(false);
  const [prep, setPrep] = useState(restaurant.prep_time_min || 15);
  const [dayHours, setDayHours] = useState(() => dayHoursFromRestaurant(restaurant));
  const [brandHex, setBrandHex] = useState(restaurant.brand_accent_hex || '');
  const [taxRatePct, setTaxRatePct] = useState(() => {
    const bps = Number(restaurant.tax_rate_bps);
    return Number.isFinite(bps) && bps > 0 ? String(bps / 100) : '';
  });
  const restaurantSettings = restaurant.settings && typeof restaurant.settings === 'object' ? restaurant.settings : {};
  const kitchenPrepSettings = restaurantSettings.kitchenPrep && typeof restaurantSettings.kitchenPrep === 'object'
    ? restaurantSettings.kitchenPrep
    : {};
  const [requireQualityCheck, setRequireQualityCheck] = useState(
    kitchenPrepSettings.requireQualityCheck ?? kitchenPrepSettings.require_quality_check ?? true
  );
  const [handoffDisplaySeconds, setHandoffDisplaySeconds] = useState(
    kitchenPrepSettings.handoffDisplaySeconds ?? kitchenPrepSettings.handoff_display_seconds ?? 15
  );
  const [requirePickupGuestName, setRequirePickupGuestName] = useState(
    restaurantSettings.requireGuestNameForPickup ?? restaurantSettings.require_guest_name_for_pickup ?? true
  );
  const [requireContactForUpdates, setRequireContactForUpdates] = useState(
    restaurantSettings.requireContactForUpdates ?? restaurantSettings.require_contact_for_updates ?? false
  );
  const [externalPaymentEnabled, setExternalPaymentEnabled] = useState(
    restaurantSettings.externalPaymentEnabled ?? restaurantSettings.external_payment_enabled ?? false
  );
  const [requireExternalPaymentProof, setRequireExternalPaymentProof] = useState(
    restaurantSettings.requireExternalPaymentProof ?? restaurantSettings.require_external_payment_proof ?? false
  );
  const [externalPaymentLabel, setExternalPaymentLabel] = useState(
    restaurantSettings.externalPaymentLabel ?? restaurantSettings.external_payment_label ?? 'Cash App / payment app'
  );
  const [externalPaymentHandle, setExternalPaymentHandle] = useState(
    restaurantSettings.externalPaymentHandle ?? restaurantSettings.external_payment_handle ?? ''
  );
  const [externalPaymentInstructions, setExternalPaymentInstructions] = useState(
    restaurantSettings.externalPaymentInstructions ?? restaurantSettings.external_payment_instructions ?? ''
  );
  const [externalPaymentReferenceHint, setExternalPaymentReferenceHint] = useState(
    restaurantSettings.externalPaymentReferenceHint ?? restaurantSettings.external_payment_reference_hint ?? 'Include your order number or name in the payment note.'
  );
  const [externalPaymentQrUrl, setExternalPaymentQrUrl] = useState(
    restaurantSettings.externalPaymentQrUrl ?? restaurantSettings.external_payment_qr_url ?? ''
  );
  const [qrUploading, setQrUploading] = useState(false);
  const businessId = restaurant.business_id || restaurant.businessId || null;

  useEffect(() => {
    const nextSettings = restaurant.settings && typeof restaurant.settings === 'object' ? restaurant.settings : {};
    const nextTaxBps = Number(restaurant.tax_rate_bps);
    setTaxRatePct(Number.isFinite(nextTaxBps) && nextTaxBps > 0 ? String(nextTaxBps / 100) : '');
    setDayHours(dayHoursFromRestaurant(restaurant));
    setRequirePickupGuestName(nextSettings.requireGuestNameForPickup ?? nextSettings.require_guest_name_for_pickup ?? true);
    setRequireContactForUpdates(nextSettings.requireContactForUpdates ?? nextSettings.require_contact_for_updates ?? false);
    setExternalPaymentEnabled(nextSettings.externalPaymentEnabled ?? nextSettings.external_payment_enabled ?? false);
    setRequireExternalPaymentProof(nextSettings.requireExternalPaymentProof ?? nextSettings.require_external_payment_proof ?? false);
    setExternalPaymentLabel(nextSettings.externalPaymentLabel ?? nextSettings.external_payment_label ?? 'Cash App / payment app');
    setExternalPaymentHandle(nextSettings.externalPaymentHandle ?? nextSettings.external_payment_handle ?? '');
    setExternalPaymentInstructions(nextSettings.externalPaymentInstructions ?? nextSettings.external_payment_instructions ?? '');
    setExternalPaymentReferenceHint(nextSettings.externalPaymentReferenceHint ?? nextSettings.external_payment_reference_hint ?? 'Include your order number or name in the payment note.');
    setExternalPaymentQrUrl(nextSettings.externalPaymentQrUrl ?? nextSettings.external_payment_qr_url ?? '');
    const nextKitchenPrep = nextSettings.kitchenPrep && typeof nextSettings.kitchenPrep === 'object'
      ? nextSettings.kitchenPrep
      : {};
    setRequireQualityCheck(nextKitchenPrep.requireQualityCheck ?? nextKitchenPrep.require_quality_check ?? true);
    setHandoffDisplaySeconds(nextKitchenPrep.handoffDisplaySeconds ?? nextKitchenPrep.handoff_display_seconds ?? 15);
  }, [restaurant.id, restaurant.settings]);

  const savePaymentSettings = async (overrides = {}) => {
    await patch({
      settings: {
        ...restaurantSettings,
        externalPaymentEnabled,
        requireExternalPaymentProof,
        externalPaymentLabel: externalPaymentLabel.trim() || null,
        externalPaymentHandle: externalPaymentHandle.trim() || null,
        externalPaymentInstructions: externalPaymentInstructions.trim() || null,
        externalPaymentReferenceHint: externalPaymentReferenceHint.trim() || null,
        externalPaymentQrUrl: externalPaymentQrUrl.trim() || null,
        ...overrides,
      },
    });
  };

  const handleQrUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setQrUploading(true);
    try {
      const uploaded = await uploadFoodAsset(file, 'food-external-payment-qr');
      const nextUrl = uploaded?.url || '';
      setExternalPaymentQrUrl(nextUrl);
      await patch({
        settings: {
          ...restaurantSettings,
          externalPaymentEnabled,
          requireExternalPaymentProof,
          externalPaymentLabel: externalPaymentLabel.trim() || null,
          externalPaymentHandle: externalPaymentHandle.trim() || null,
          externalPaymentInstructions: externalPaymentInstructions.trim() || null,
          externalPaymentReferenceHint: externalPaymentReferenceHint.trim() || null,
          externalPaymentQrUrl: nextUrl || null,
        },
      });
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.merchant.menuError')));
    } finally {
      setQrUploading(false);
      event.target.value = '';
    }
  };

  const patch = async (payload) => {
    setSaving(true);
    try {
      const updated = await updateFoodRestaurant(restaurant.id, payload);
      onUpdated(updated);
      onSetupChanged?.();
      toast.success(t('food.common.saved'));
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.merchant.menuError')));
    } finally {
      setSaving(false);
    }
  };

  const saveTaxRate = () => {
    const pct = Number(taxRatePct);
    if (taxRatePct.trim() === '' || !Number.isFinite(pct) || pct < 0 || pct > 100) {
      toast.error(t('food.merchant.taxRateInvalid', 'Enter a tax rate between 0 and 100.'));
      return;
    }
    patch({ taxRateBps: Math.round(pct * 100) });
  };

  const cardRefs = useRef({});
  const registerCard = (key, el) => { cardRefs.current[key] = el; };
  const scrollToCard = (key) => cardRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const openDays = dayHours.filter((day) => !day.closed).length;
  const taxBpsNum = Number(restaurant.tax_rate_bps);
  const taxPct = Number.isFinite(taxBpsNum) && taxBpsNum > 0 ? String(taxBpsNum / 100) : null;
  const colorValue = /^#[0-9a-fA-F]{6}$/.test(brandHex) ? brandHex : '#f97316';

  const copyMondayToAll = () => {
    setDayHours((current) => {
      const monday = current[0];
      return current.map((day, index) => (index === 0 ? day : { ...monday }));
    });
  };

  const statusChips = [
    {
      key: 'status',
      target: 'ordering',
      tone: restaurant.status === 'active' ? 'ok' : restaurant.status === 'paused' ? 'warn' : 'off',
      label: t(`food.restaurantStatus.${restaurant.status}`, restaurant.status),
    },
    {
      key: 'online',
      target: 'ordering',
      tone: restaurant.accepts_online_orders ? 'ok' : 'off',
      label: restaurant.accepts_online_orders
        ? t('food.merchant.stChipOnlineOn', 'Online ordering on')
        : t('food.merchant.stChipOnlineOff', 'Online ordering off'),
    },
    {
      key: 'instore',
      target: 'ordering',
      tone: restaurant.accepts_in_store_orders ? 'ok' : 'off',
      label: restaurant.accepts_in_store_orders
        ? t('food.merchant.stChipInStoreOn', 'In-store on')
        : t('food.merchant.stChipInStoreOff', 'In-store off'),
    },
    {
      key: 'hours',
      target: 'hours',
      tone: openDays > 0 ? 'ok' : 'warn',
      label: openDays > 0
        ? t('food.merchant.stChipHours', 'Hours {{open}} of 7 days', { open: openDays })
        : t('food.merchant.stChipHoursNone', 'Hours not set'),
    },
    {
      key: 'tax',
      target: 'money',
      tone: taxPct ? 'ok' : 'warn',
      label: taxPct
        ? t('food.merchant.stChipTaxSet', 'Tax {{rate}}%', { rate: taxPct })
        : t('food.merchant.stChipTaxUnset', 'Tax not set'),
    },
    {
      key: 'direct',
      target: 'money',
      tone: externalPaymentEnabled ? 'ok' : 'off',
      label: externalPaymentEnabled
        ? t('food.merchant.stChipDirectOn', 'Direct payment on')
        : t('food.merchant.stChipDirectOff', 'Direct payment off'),
    },
  ];

  const saveHours = () => patch({
    operatingHours: {
      weekly: Object.fromEntries(WEEKDAY_KEYS.map((key, index) => {
        const day = dayHours[index];
        return day.closed
          ? [key, { closed: true, open: day.open, close: day.close }]
          : [key, { open: day.open, close: day.close }];
      })),
    },
  });

  const toggleQualityCheck = () => {
    const next = !requireQualityCheck;
    setRequireQualityCheck(next);
    patch({
      settings: {
        ...restaurantSettings,
        kitchenPrep: { ...kitchenPrepSettings, requireQualityCheck: next, handoffDisplaySeconds: Number(handoffDisplaySeconds) || 0 },
      },
    });
  };

  const saveHandoffDelay = () => patch({
    settings: {
      ...restaurantSettings,
      kitchenPrep: {
        ...kitchenPrepSettings,
        requireQualityCheck,
        handoffDisplaySeconds: Math.max(0, Math.min(120, Number(handoffDisplaySeconds) || 0)),
      },
    },
  });

  const toggleDirectPayment = () => {
    setExternalPaymentEnabled((current) => !current);
    patch({
      settings: {
        ...restaurantSettings,
        externalPaymentEnabled: !externalPaymentEnabled,
        requireExternalPaymentProof,
        externalPaymentLabel: externalPaymentLabel.trim() || null,
        externalPaymentHandle: externalPaymentHandle.trim() || null,
        externalPaymentInstructions: externalPaymentInstructions.trim() || null,
        externalPaymentReferenceHint: externalPaymentReferenceHint.trim() || null,
        externalPaymentQrUrl: externalPaymentQrUrl.trim() || null,
      },
    });
  };

  const toggleDirectPaymentProof = () => {
    setRequireExternalPaymentProof((current) => !current);
    patch({
      settings: {
        ...restaurantSettings,
        externalPaymentEnabled,
        requireExternalPaymentProof: !requireExternalPaymentProof,
        externalPaymentLabel: externalPaymentLabel.trim() || null,
        externalPaymentHandle: externalPaymentHandle.trim() || null,
        externalPaymentInstructions: externalPaymentInstructions.trim() || null,
        externalPaymentReferenceHint: externalPaymentReferenceHint.trim() || null,
        externalPaymentQrUrl: externalPaymentQrUrl.trim() || null,
      },
    });
  };

  return (
    <div className="fd-section fd-settings">
      <h2>{t('food.merchant.settings')}</h2>
      <div className="fd-settings-strip" role="navigation" aria-label={t('food.merchant.stAtAGlance', 'At a glance')}>
        {statusChips.map((chip) => (
          <button key={chip.key} type="button" className="fd-settings-chip" onClick={() => scrollToCard(chip.target)}>
            <span className={`fd-settings-chip-dot fd-settings-chip-dot--${chip.tone}`} aria-hidden="true" />
            {chip.label}
          </button>
        ))}
      </div>

      <div className="fd-settings-grid">
        <SettingsCard
          icon={ShoppingBag}
          title={t('food.merchant.stOrderingTitle', 'Ordering')}
          desc={t('food.merchant.stOrderingDesc', 'Take the restaurant live and control where guests can order.')}
          cardKey="ordering"
          registerRef={registerCard}
        >
          <div className="fd-settings-actions">
            {restaurant.status !== 'active' ? (
              <button type="button" className="fd-btn" disabled={saving} onClick={() => patch({ status: 'active' })}>
                {t('food.merchant.goLive')}
              </button>
            ) : (
              <button type="button" className="fd-btn fd-btn-secondary" disabled={saving} onClick={() => patch({ status: 'paused' })}>
                {t('food.merchant.pause')}
              </button>
            )}
          </div>
          <FdSwitchRow
            label={t('food.merchant.stSwitchOnline', 'Online orders')}
            checked={!!restaurant.accepts_online_orders}
            disabled={saving}
            onChange={() => patch({ acceptsOnlineOrders: !restaurant.accepts_online_orders })}
          />
          <FdSwitchRow
            label={t('food.merchant.stSwitchInStore', 'In-store orders')}
            checked={!!restaurant.accepts_in_store_orders}
            disabled={saving}
            onChange={() => patch({ acceptsInStoreOrders: !restaurant.accepts_in_store_orders })}
          />
          <div className="fd-settings-field-row">
            <div className="fd-field">
              <label htmlFor="fd-prep">{t('food.merchant.prepTimeMin')}</label>
              <input id="fd-prep" type="number" min={0} max={240} value={prep} onChange={(e) => setPrep(e.target.value)} />
            </div>
            <button type="button" className="fd-btn fd-btn-sm" disabled={saving} onClick={() => patch({ prepTimeMin: Number(prep) || 15 })}>
              {t('food.common.save')}
            </button>
          </div>
        </SettingsCard>

        <SettingsCard
          icon={ChefHat}
          title={t('food.merchant.kitchenWorkflowTitle', 'Kitchen workflow')}
          desc={t('food.merchant.kitchenWorkflowHint', 'Control the quality-check step and how long handed-off orders remain on the guest queue screen.')}
          cardKey="kitchen"
          registerRef={registerCard}
        >
          <FdSwitchRow
            label={t('food.merchant.stSwitchQuality', 'Quality check')}
            checked={requireQualityCheck}
            disabled={saving}
            onChange={toggleQualityCheck}
          />
          <div className="fd-settings-field-row">
            <div className="fd-field">
              <label htmlFor="fd-handoff-delay">{t('food.merchant.handoffDisplaySeconds', 'Queue removal delay (seconds)')}</label>
              <input
                id="fd-handoff-delay"
                type="number"
                min={0}
                max={120}
                value={handoffDisplaySeconds}
                onChange={(event) => setHandoffDisplaySeconds(event.target.value)}
              />
            </div>
            <button type="button" className="fd-btn fd-btn-sm" disabled={saving} onClick={saveHandoffDelay}>
              {t('food.common.save')}
            </button>
          </div>
        </SettingsCard>

        <SettingsCard
          icon={Palette}
          title={t('food.merchant.stBrandTitle', 'Brand')}
          desc={t('food.merchant.stBrandDesc', 'Your accent color on the customer page and receipts.')}
          cardKey="brand"
          registerRef={registerCard}
        >
          <div className="fd-settings-color-row">
            <input
              type="color"
              className="fd-settings-color"
              value={colorValue}
              onChange={(e) => setBrandHex(e.target.value)}
              aria-label={t('food.merchant.stColorPick', 'Pick a color')}
            />
            <div className="fd-field">
              <label htmlFor="fd-brand">{t('food.merchant.brandAccent', 'Brand accent (#RRGGBB)')}</label>
              <input id="fd-brand" value={brandHex} onChange={(e) => setBrandHex(e.target.value)} placeholder="#FF8800" maxLength={7} />
            </div>
            <span className="fd-settings-swatch" style={{ background: colorValue }} title={t('food.merchant.stColorPreview', 'Preview')} aria-hidden="true" />
          </div>
          <div className="fd-settings-actions">
            <button type="button" className="fd-btn fd-btn-sm" disabled={saving} onClick={() => patch({ brandAccentHex: brandHex.trim() || null })}>
              {t('food.common.save')}
            </button>
          </div>
        </SettingsCard>

        <SettingsCard
          icon={UserCheck}
          title={t('food.merchant.guestCheckoutTitle', 'Guest checkout')}
          desc={t('food.merchant.guestCheckoutHint', 'Choose how much information guests must provide before placing an order.')}
          cardKey="guest"
          registerRef={registerCard}
        >
          <FdSwitchRow
            label={t('food.merchant.stSwitchGuestName', 'Pickup name required')}
            checked={requirePickupGuestName}
            disabled={saving}
            onChange={() => patch({ settings: { ...restaurantSettings, requireGuestNameForPickup: !requirePickupGuestName } })}
          />
          <FdSwitchRow
            label={t('food.merchant.stSwitchContact', 'Contact for status updates')}
            checked={requireContactForUpdates}
            disabled={saving}
            onChange={() => patch({ settings: { ...restaurantSettings, requireContactForUpdates: !requireContactForUpdates } })}
          />
          <p className="fd-card-meta fd-settings-note-text">
            {requireContactForUpdates
              ? t('food.merchant.guestCheckoutContactNoteRequired', 'Guests must provide a phone number or email for order updates.')
              : t('food.merchant.guestCheckoutContactNoteOptional', 'Phone and email stay optional unless you turn on status updates.')}
          </p>
        </SettingsCard>

        <SettingsCard
          icon={Clock}
          title={t('food.merchant.hoursTitle', 'Operating hours')}
          desc={t('food.merchant.hoursPerDayHint', 'Set hours for each day. Toggle a day off when the restaurant is closed.')}
          cardKey="hours"
          registerRef={registerCard}
          wide
        >
          <div className="fd-settings-hours">
            {dayHours.map((day, index) => (
              <div key={WEEKDAY_KEYS[index]} className="fd-settings-hours-row">
                <span className="fd-settings-hours-day">{weekDayLabel(i18n, index)}</span>
                <input
                  id={`fd-hours-open-${WEEKDAY_KEYS[index]}`}
                  type="time"
                  className="fd-settings-time"
                  aria-label={t('food.merchant.openTime', 'Opens')}
                  value={day.open}
                  disabled={day.closed}
                  onChange={(e) => setDayHours((current) => current.map((entry, i) => (i === index ? { ...entry, open: e.target.value } : entry)))}
                />
                <input
                  id={`fd-hours-close-${WEEKDAY_KEYS[index]}`}
                  type="time"
                  className="fd-settings-time"
                  aria-label={t('food.merchant.closeTime', 'Closes')}
                  value={day.close}
                  disabled={day.closed}
                  onChange={(e) => setDayHours((current) => current.map((entry, i) => (i === index ? { ...entry, close: e.target.value } : entry)))}
                />
                <label className="fd-settings-closed">
                  <input
                    type="checkbox"
                    checked={day.closed}
                    onChange={(e) => setDayHours((current) => current.map((entry, i) => (i === index ? { ...entry, closed: e.target.checked } : entry)))}
                  />
                  {t('food.merchant.hoursClosed', 'Closed')}
                </label>
              </div>
            ))}
          </div>
          <div className="fd-settings-actions">
            <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={copyMondayToAll}>
              {t('food.merchant.stCopyMonday', 'Copy Monday to all days')}
            </button>
            <button type="button" className="fd-btn fd-btn-sm" disabled={saving} onClick={saveHours}>
              {t('food.merchant.saveHours', 'Save hours')}
            </button>
          </div>
        </SettingsCard>

        <SettingsCard
          icon={Wallet}
          title={t('food.merchant.stMoneyTitle', 'Money')}
          desc={t('food.merchant.stMoneyDesc', 'Sales tax and direct payment options for checkout.')}
          cardKey="money"
          registerRef={registerCard}
          wide
        >
          <div className="fd-settings-field-row">
            <div className="fd-field">
              <label htmlFor="fd-tax">{t('food.merchant.taxRate', 'Tax rate (%)')}</label>
              <input
                id="fd-tax"
                type="number"
                min="0"
                max="100"
                step="0.01"
                inputMode="decimal"
                value={taxRatePct}
                onChange={(e) => setTaxRatePct(e.target.value)}
                placeholder="8.5"
              />
            </div>
            <button type="button" className="fd-btn fd-btn-sm" disabled={saving} onClick={saveTaxRate}>
              {t('food.common.save')}
            </button>
          </div>
          <p className="fd-card-meta">
            {t('food.merchant.taxRateHint', 'Sales tax added to customer orders. Leave blank or 0 when tax does not apply.')}
          </p>

          <h4 className="fd-settings-subhead">{t('food.merchant.externalPaymentTitle', 'Direct payment')}</h4>
          <p className="fd-card-meta">
            {t('food.merchant.externalPaymentHint', 'Share one payment account or QR. Customers attach a receipt or confirmation number when they order.')}
          </p>
          <FdSwitchRow
            label={t('food.merchant.stSwitchDirectPay', 'Direct payment')}
            checked={externalPaymentEnabled}
            disabled={saving}
            onChange={toggleDirectPayment}
          />
          {externalPaymentEnabled && (
            <FdSwitchRow
              label={t('food.merchant.stSwitchProof', 'Require receipt or confirmation')}
              checked={requireExternalPaymentProof}
              disabled={saving}
              onChange={toggleDirectPaymentProof}
            />
          )}
          {externalPaymentEnabled && (
            <div className="fd-settings-direct">
              {String(restaurant?.oxsteed_pay_url ?? '').trim() && (
                <div className="fd-settings-notice">
                  {t('food.merchant.oxsteedPayReplacesQr')}{' '}
                  <a href="/qr-payments">{t('food.merchant.manageQrPayCodes')}</a>
                </div>
              )}
              <div className="fd-settings-field-grid">
                <div className="fd-field">
                  <label htmlFor="fd-ext-label">{t('food.merchant.externalPaymentLabel', 'Payment label')}</label>
                  <input
                    id="fd-ext-label"
                    value={externalPaymentLabel}
                    onChange={(e) => setExternalPaymentLabel(e.target.value)}
                    placeholder="Cash App / payment app"
                    maxLength={120}
                  />
                </div>
                <div className="fd-field">
                  <label htmlFor="fd-ext-handle">{t('food.merchant.externalPaymentHandle', 'Handle / account')}</label>
                  <input
                    id="fd-ext-handle"
                    value={externalPaymentHandle}
                    onChange={(e) => setExternalPaymentHandle(e.target.value)}
                    placeholder="$BonPate or @bonpate"
                    maxLength={120}
                  />
                </div>
              </div>
              <div className="fd-field">
                <label htmlFor="fd-ext-qr">{t('food.merchant.externalPaymentQr', 'QR code image')}</label>
                <input
                  id="fd-ext-qr"
                  type="file"
                  accept="image/*"
                  onChange={handleQrUpload}
                  disabled={qrUploading}
                />
                <p className="fd-card-meta fd-settings-hint">
                  {qrUploading ? t('food.common.saving', 'Saving…') : t('food.merchant.externalPaymentQrHint', 'Upload a payment QR image to show customers at checkout.')}
                </p>
              </div>
              {externalPaymentQrUrl && (
                <div className="fd-settings-qr-row">
                  <img
                    src={externalPaymentQrUrl}
                    alt="Restaurant payment QR"
                    className="fd-settings-qr-preview"
                  />
                  <p className="fd-card-meta">
                    {t('food.merchant.externalPaymentQrPreview', 'This QR code will show to guests when they choose external payment.')}
                  </p>
                </div>
              )}
              <div className="fd-settings-actions">
                <button
                  type="button"
                  className="fd-btn fd-btn-sm"
                  disabled={saving}
                  onClick={() => savePaymentSettings()}
                >
                  {saving ? t('food.common.saving') : t('food.common.save')}
                </button>
              </div>
              <details className="fd-settings-advanced">
                <summary>{t('food.merchant.externalPaymentAdvanced', 'Advanced instructions')}</summary>
                <div className="fd-field">
                  <label htmlFor="fd-ext-ref">{t('food.merchant.externalPaymentRef', 'Confirmation number hint')}</label>
                  <input
                    id="fd-ext-ref"
                    value={externalPaymentReferenceHint}
                    onChange={(e) => setExternalPaymentReferenceHint(e.target.value)}
                    placeholder="Confirmation number or sender name"
                    maxLength={255}
                  />
                </div>
                <div className="fd-field">
                  <label htmlFor="fd-ext-instructions">{t('food.merchant.externalPaymentInstructions', 'Extra payment instructions')}</label>
                  <textarea
                    id="fd-ext-instructions"
                    rows={3}
                    value={externalPaymentInstructions}
                    onChange={(e) => setExternalPaymentInstructions(e.target.value)}
                    placeholder="Only add details customers need before sending payment."
                    maxLength={2000}
                  />
                </div>
                <div className="fd-settings-actions">
                  <button type="button" className="fd-btn fd-btn-sm" disabled={saving} onClick={() => savePaymentSettings()}>
                    {saving ? t('food.common.saving') : t('food.common.save')}
                  </button>
                </div>
              </details>
            </div>
          )}
          <div className="fd-settings-note">
            <h4 className="fd-settings-subhead fd-settings-subhead--flush">{t('food.merchant.settlementTitle', 'Payment settlement records')}</h4>
            <p className="fd-card-meta">
              {t(
                'food.merchant.settlementHint',
                'Use restaurant credit for launch and keep direct-payment proof in the order record when guests pay outside the platform.'
              )}
            </p>
            <p className="fd-card-meta">
              {t(
                'food.merchant.settlementNote',
                'Orders can stay linked to the restaurant record so settlement, receipts, and support history remain visible in the app.'
              )}
            </p>
          </div>
        </SettingsCard>

        <SettingsCard
          icon={MapPin}
          title={t('food.merchant.locationsTitle', 'Locations')}
          desc={t('food.merchant.locationsHint', 'Add additional storefronts under the same brand.')}
          cardKey="locations"
          registerRef={registerCard}
          wide
        >
          <LocationsPanel t={t} restaurant={restaurant} onChanged={onSetupChanged} bare />
        </SettingsCard>

        <SettingsCard
          icon={Tag}
          title={t('food.merchant.promotionsTitle', 'Coupons & promotions')}
          desc={t('food.merchant.promotionsHint', 'Create codes customers enter at checkout on mobile, kiosk, or POS.')}
          cardKey="promotions"
          registerRef={registerCard}
          wide
        >
          <PromotionsPanel t={t} restaurant={restaurant} bare />
        </SettingsCard>
      </div>
    </div>
  );
}

// ── Operations tab ───────────────────────────────────────────────────────────
// Placeholder hub for the franchise-grade operating modules that land in later
// phases (inventory, checklists/SOPs, staff training, quality audits, reports),
// plus a live link into OxSteed Marketplace to hire help for the restaurant.
function OperationsTab({ t, restaurant }) {
  // Checklists + SOPs (Phase 2) and Inventory (Phase 3) are live; the rest are "coming next".
  const modules = ['training', 'audits', 'reports'];

  // Pre-fill a Marketplace job from the restaurant's context. PostJobPage reads
  // an optional prefill from navigation state; the query param is a harmless
  // fallback so the link works even if the prefill contract changes.
  const helpPrefill = {
    title: restaurant?.display_name ? `Help needed at ${restaurant.display_name}` : '',
    location_city: restaurant?.address_city || '',
    location_state: restaurant?.address_state || '',
    source: 'restaurant',
  };

  return (
    <div className="fd-section">
      <h2>{t('restaurants.ops.title', 'Operations')}</h2>
      <p className="fd-card-meta">{t('restaurants.ops.subtitle', 'Run your restaurant with franchise-grade systems.')}</p>

      {/* Live modules (Phase 2) */}
      <div style={{ marginTop: '1.25rem' }}>
        <ChecklistsPanel t={t} restaurant={restaurant} />
      </div>
      <div style={{ marginTop: '2rem' }}>
        <InventoryPanel t={t} restaurant={restaurant} />
      </div>
      <div style={{ marginTop: '2rem' }}>
        <SopsPanel t={t} restaurant={restaurant} />
      </div>

      {/* Coming-next modules */}
      <h3 style={{ marginTop: '2rem' }}>{t('restaurants.ops.moreModules', 'More operating tools')}</h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: '0.75rem',
          marginTop: '0.5rem',
        }}
      >
        {modules.map((key) => (
          <div
            key={key}
            className="fd-card"
            style={{ padding: '1rem', opacity: 0.85, position: 'relative' }}
          >
            <span
              className="fd-badge"
              style={{
                position: 'absolute', top: '0.75rem', right: '0.75rem',
                fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.04em', color: 'var(--color-primary, #F97316)',
              }}
            >
              {t('restaurants.ops.comingSoon', 'Coming next')}
            </span>
            <h3 style={{ margin: '0 0 0.35rem', fontSize: '1rem' }}>
              {t(`restaurants.ops.modules.${key}.title`, key)}
            </h3>
            <p className="fd-card-meta" style={{ margin: 0 }}>
              {t(`restaurants.ops.modules.${key}.desc`, '')}
            </p>
          </div>
        ))}
      </div>

      {/* Marketplace help connection */}
      <div
        className="fd-card"
        style={{ marginTop: '1.5rem', padding: '1.25rem', borderLeft: '3px solid var(--color-primary, #F97316)' }}
      >
        <h3 style={{ margin: '0 0 0.35rem' }}>{t('restaurants.ops.help.title', 'Need help at your restaurant?')}</h3>
        <p className="fd-card-meta" style={{ marginTop: 0 }}>
          {t('restaurants.ops.help.desc', 'Hire local helpers through OxSteed Marketplace: repairs, cleaning, equipment, signage, and more.')}
        </p>
        <Link
          to="/post-job?source=restaurant"
          state={{ restaurantPrefill: helpPrefill }}
          className="fd-btn fd-btn-primary"
        >
          {t('restaurants.ops.help.cta', 'Find help through OxSteed Marketplace')}
        </Link>
      </div>
    </div>
  );
}

// ── Merchant landing (no restaurant yet) ─────────────────────────────────────
const LANDING_FEATURES = [
  { icon: '⚡', tk: 'f1' },
  { icon: '🍽️', tk: 'f2' },
  { icon: '🎯', tk: 'f3' },
  { icon: '🌍', tk: 'f4' },
];
function MerchantLanding({ t, onStart }) {
  return (
    <div className="fd-merchant-landing">
      <div className="fd-merchant-landing-pitch">
        <span className="fd-merchant-landing-eyebrow">{t('food.merchant.landing.eyebrow', 'Local Food Directory')}</span>
        <h2 className="fd-merchant-landing-headline">{t('food.merchant.landing.headline', 'Franchise-grade tools for independent restaurants')}</h2>
        <p className="fd-merchant-landing-sub">{t('food.merchant.landing.sub', 'Go live the same day. Accept orders at the counter, kiosk, kitchen display, and online, all from one shared backend.')}</p>
        <button type="button" className="fd-btn fd-merchant-landing-cta" onClick={onStart}>
          {t('food.merchant.landing.cta', 'Add your restaurant')}
        </button>
      </div>

      <div className="fd-merchant-landing-features">
        {LANDING_FEATURES.map(({ icon, tk }) => (
          <div key={tk} className="fd-merchant-landing-feature">
            <span className="fd-merchant-landing-icon">{icon}</span>
            <h3>{t(`food.merchant.landing.${tk}Title`, '')}</h3>
            <p>{t(`food.merchant.landing.${tk}Desc`, '')}</p>
          </div>
        ))}
      </div>

      <div className="fd-merchant-landing-steps">
        {[1, 2, 3].map((n, i) => (
          <React.Fragment key={n}>
            {i > 0 && <div className="fd-merchant-step-arrow" aria-hidden="true">→</div>}
            <div className="fd-merchant-step">
              <span className="fd-merchant-step-num">{n}</span>
              <span>{t(`food.merchant.landing.step${n}`, `Step ${n}`)}</span>
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function OwnerHomeTab({ t, restaurant, onGoTab, onUpdated }) {
  const [summary, setSummary] = useState({ activeOrders: 0, menuItems: 0, drafts: 0, soldOut: 0 });
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const openCardRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getManagedFoodMenu(restaurant.id).catch(() => ({ menu: [], uncategorizedItems: [] })),
      listFoodRestaurantOrders(restaurant.id, { limit: 100 }).catch(() => []),
    ]).then(([menuData, fetchedOrders]) => {
      if (cancelled) return;
      const items = [...(menuData.menu || []).flatMap((category) => category.items || []), ...(menuData.uncategorizedItems || [])];
      const orderList = Array.isArray(fetchedOrders) ? fetchedOrders : [];
      setOrders(orderList);
      setSummary({
        activeOrders: orderList.filter((order) => !['completed', 'cancelled', 'refunded'].includes(order.status)).length,
        menuItems: items.filter((item) => !item.archived_at).length,
        drafts: items.filter((item) => !item.archived_at && item.publication_status === 'draft').length,
        soldOut: items.filter((item) => !item.archived_at && !item.is_available).length,
      });
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [restaurant.id]);

  const todayStats = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const todays = orders.filter((order) => {
      if (['cancelled', 'refunded'].includes(order.status)) return false;
      const ts = new Date(order.created_at).getTime();
      return Number.isFinite(ts) && ts >= startOfToday;
    });
    const totals = todays.map((order) => Number(order.total_cents)).filter((n) => Number.isFinite(n));
    return {
      count: todays.length,
      revenue: totals.length > 0 ? totals.reduce((a, b) => a + b, 0) : null,
      currency: todays.find((order) => order.currency_code)?.currency_code || 'USD',
    };
  }, [orders]);

  const attention = useMemo(() => {
    const items = [];
    if (restaurant.status !== 'active') {
      items.push({
        key: 'not-live',
        label: t('food.ownerHome.alertNotLive', 'Your restaurant is not live yet'),
        onClick: () => onGoTab('settings'),
      });
    } else if (restaurant.is_accepting_orders_now === false) {
      items.push({
        key: 'paused',
        label: t('food.ownerHome.alertPaused', 'Ordering is paused'),
        onClick: () => openCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      });
    }
    if (summary.drafts > 0) {
      items.push({
        key: 'drafts',
        label: t('food.ownerHome.alertDrafts', '{{count}} draft items are not published', { count: summary.drafts }),
        onClick: () => onGoTab('menu'),
      });
    }
    if (summary.soldOut > 0) {
      items.push({
        key: 'soldOut',
        label: t('food.ownerHome.alertSoldOut', '{{count}} items are marked sold out', { count: summary.soldOut }),
        onClick: () => onGoTab('menu'),
      });
    }
    return items;
  }, [onGoTab, restaurant.is_accepting_orders_now, restaurant.status, summary.drafts, summary.soldOut, t]);

  const toggleOrders = async () => {
    setSaving(true);
    try {
      const updated = await updateFoodRestaurant(restaurant.id, {
        isAcceptingOrdersNow: !(restaurant.is_accepting_orders_now !== false),
      });
      onUpdated(updated);
      toast.success(updated.is_accepting_orders_now
        ? t('food.ownerHome.ordersOn', 'Restaurant is accepting orders')
        : t('food.ownerHome.ordersOff', 'Online ordering paused'));
    } catch (error) {
      toast.error(apiErrorMessage(error, t('food.common.error', 'Could not update the restaurant')));
    } finally {
      setSaving(false);
    }
  };

  const accepting = restaurant.is_accepting_orders_now !== false && restaurant.status === 'active';
  return (
    <div className="fd-owner-home">
      <section ref={openCardRef} className={`fd-owner-open-card${accepting ? ' fd-owner-open-card--live' : ''}`}>
        <div>
          <span className="fd-owner-open-dot" aria-hidden />
          <div>
            <p>{restaurant.status === 'active' ? t('food.ownerHome.liveKicker', 'Customer ordering') : t('food.ownerHome.draftKicker', 'Restaurant setup')}</p>
            <h2>{accepting ? t('food.ownerHome.accepting', 'You are accepting orders') : restaurant.status === 'active' ? t('food.ownerHome.paused', 'Ordering is paused') : t('food.ownerHome.notLive', 'Your restaurant is not live yet')}</h2>
          </div>
        </div>
        {restaurant.status === 'active' && <button type="button" className={accepting ? 'fd-btn fd-btn-secondary' : 'fd-btn'} disabled={saving} onClick={toggleOrders}>{accepting ? t('food.ownerHome.pauseOrders', 'Pause orders') : t('food.ownerHome.resumeOrders', 'Resume orders')}</button>}
      </section>

      <section className="fd-owner-today" aria-label={t('food.ownerHome.today', 'Today')}>
        <h3>{t('food.ownerHome.today', 'Today')}</h3>
        <div className="fd-owner-today-stats">
          <div><strong>{todayStats.revenue == null ? '—' : formatFoodMoney(todayStats.revenue, todayStats.currency)}</strong><span>{t('food.ownerHome.todayRevenue', 'Revenue')}</span></div>
          <div><strong>{loading ? '—' : todayStats.count}</strong><span>{t('food.ownerHome.todayOrders', 'Orders')}</span></div>
        </div>
      </section>

      <div className="fd-owner-home-stats" aria-busy={loading}>
        <button type="button" onClick={() => onGoTab('orders')}><strong>{loading ? '—' : summary.activeOrders}</strong><span>{t('food.ownerHome.activeOrders', 'Active orders')}</span></button>
        <button type="button" onClick={() => onGoTab('menu')}><strong>{loading ? '—' : summary.menuItems}</strong><span>{t('food.ownerHome.menuItems', 'Menu items')}</span></button>
        <button type="button" onClick={() => onGoTab('menu')}><strong>{loading ? '—' : summary.drafts}</strong><span>{t('food.ownerHome.draftItems', 'Draft items')}</span></button>
        <button type="button" onClick={() => onGoTab('menu')}><strong>{loading ? '—' : summary.soldOut}</strong><span>{t('food.ownerHome.soldOutItems', 'Sold out')}</span></button>
      </div>

      <section className="fd-owner-attention">
        <h3>{t('food.ownerHome.needsAttention', 'Needs attention')}</h3>
        {attention.length === 0 ? (
          <p className="fd-owner-all-clear">{t('food.ownerHome.allClear', 'All clear. Nothing needs your attention right now.')}</p>
        ) : (
          <ul className="fd-owner-attention-list">
            {attention.map((item) => (
              <li key={item.key}>
                <button type="button" onClick={item.onClick}>
                  <span className="fd-owner-attention-dot" aria-hidden />
                  <span>{item.label}</span>
                  <span className="fd-owner-attention-go" aria-hidden>›</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link className="fd-owner-view-customer" to={`/restaurants/r/${restaurant.id}`} target="_blank" rel="noreferrer">
        <span aria-hidden>↗</span><strong>{t('food.ownerHome.viewStore', 'View customer page')}</strong>
      </Link>
    </div>
  );
}

// ── Tab icon map ──────────────────────────────────────────────────────────────
const TAB_ICONS = { home: Home, orders: Receipt, menu: UtensilsCrossed, payouts: Wallet, settings: Settings, operations: ClipboardList };

function hasRestaurantPermission(restaurant, requested) {
  if (restaurant?.effective_role === 'owner' || restaurant?.permissions?.includes('*')) return true;
  return requested.some((permission) => restaurant?.permissions?.includes(permission));
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function FoodMerchantPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedBusinessId = searchParams.get('business');
  const requestedSetup = searchParams.get('setup') === '1';
  const requestedTab = searchParams.get('tab');
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('home');
  const [setupKey, setSetupKey] = useState(0);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [setupForNew, setSetupForNew] = useState(false);

  useEffect(() => {
    if (requestedTab === 'store') {
      setTab('settings'); // legacy deep link
      return;
    }
    if (['home', 'orders', 'menu', 'payouts', 'settings', 'operations'].includes(requestedTab)) {
      setTab(requestedTab);
    }
  }, [requestedTab]);

  const load = useCallback(() => {
    listMyFoodRestaurants()
      .then((rows) => {
        setRestaurants(rows);
        const requested = requestedBusinessId
          ? rows.find((restaurant) => String(restaurant.business_id || restaurant.businessId) === String(requestedBusinessId))
          : null;
        setSelectedId((prev) => requested?.id || prev || rows[0]?.id || null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [requestedBusinessId]);
  useEffect(() => { load(); }, [load]);

  const selected = restaurants.find((r) => r.id === selectedId) || null;
  const canManageRestaurant = hasRestaurantPermission(selected, ['restaurant.manage', 'settings.manage']);
  const canManageCredit = hasRestaurantPermission(selected, ['credit.manage']);
  const canViewSettings = hasRestaurantPermission(selected, ['settings.view', 'settings.manage', 'restaurant.manage']);
  const canManageDisplays = hasRestaurantPermission(selected, ['display.manage', 'restaurant.manage']);
  const canManagePayouts = selected?.effective_role === 'owner';
  const availableTabs = useMemo(() => {
    if (!selected) return [];
    const tabs = [];
    if (canManageRestaurant) tabs.push('home');
    if (hasRestaurantPermission(selected, ['orders.view', 'orders.manage', 'kitchen.view', 'kitchen.update'])) tabs.push('orders');
    if (hasRestaurantPermission(selected, ['menu.view', 'menu.manage'])) tabs.push('menu');
    if (canManagePayouts || canManageCredit) tabs.push('payouts');
    if (canViewSettings) tabs.push('settings');
    if (canManageDisplays || canManageRestaurant) tabs.push('operations');
    return tabs;
  }, [canManageCredit, canManageDisplays, canManagePayouts, canManageRestaurant, canViewSettings, selected]);

  const goToTab = useCallback((nextTab) => {
    if (!availableTabs.includes(nextTab)) return;
    setTab(nextTab);
    const next = new URLSearchParams(searchParams);
    next.set('tab', nextTab);
    if (selected?.business_id) next.set('business', String(selected.business_id));
    setSearchParams(next, { replace: true });
  }, [availableTabs, searchParams, selected?.business_id, setSearchParams]);

  useEffect(() => {
    if (!selected || availableTabs.length === 0 || availableTabs.includes(tab)) return;
    goToTab(availableTabs[0]);
  }, [availableTabs, goToTab, selected, tab]);

  useEffect(() => {
    if (tab !== 'operations' || window.location.hash !== '#in-store-screens' || !selected?.id) return undefined;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('in-store-screens')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [tab, selected?.id]);

  useEffect(() => {
    if (loading) return;
    if (!requestedSetup && sessionStorage.getItem('ox.food.onboarding.dismissed') === '1') return;
    if (requestedSetup && selected && canManageRestaurant) {
      setSetupForNew(false);
      setShowOnboarding(true);
      return;
    }
    if (selected && canManageRestaurant && shouldShowRestaurantSetup(restaurants, selected)) {
      setSetupForNew(false);
      setShowOnboarding(true);
    }
  }, [canManageRestaurant, loading, requestedSetup, restaurants, selected]);

  const refreshRestaurant = useCallback((updated) => {
    if (!updated?.id) {
      load();
      return;
    }
    setRestaurants((prev) => {
      const exists = prev.some((r) => r.id === updated.id);
      if (exists) return prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r));
      return [updated, ...prev];
    });
    setSetupKey((k) => k + 1);
  }, [load]);

  if (loading) {
    return (
      <PageShell>
        <div className="fd-empty fd-merchant-loading">
          <span className="fd-merchant-loading-dot" />
          <span className="fd-merchant-loading-dot" />
          <span className="fd-merchant-loading-dot" />
        </div>
      </PageShell>
    );
  }

  const hasDashboard = restaurants.length > 0;

  return (
    <PageShell>
      {showOnboarding && (
        <RestaurantSetupGuide
          t={t}
          restaurants={restaurants}
          selected={setupForNew ? null : selected}
          onClose={() => {
            sessionStorage.setItem('ox.food.onboarding.dismissed', '1');
            setShowOnboarding(false);
            setSetupForNew(false);
          }}
          onRefresh={refreshRestaurant}
          onSelectRestaurant={setSelectedId}
        />
      )}

      {/* ── Merchant hero ── */}
      <div className={`fd-merchant-hero${hasDashboard ? ' fd-merchant-hero--dashboard' : ''}`}>
        <div className="fd-merchant-hero-inner">
          <div className="fd-merchant-hero-brand">
            <FoodBrand size={38} />
            <div>
              <h1 className="fd-merchant-hero-title">
                {hasDashboard && selected ? selected.display_name : t('food.merchant.title')}
              </h1>
              <p className="fd-merchant-hero-sub">
                {hasDashboard && selected
                  ? (selected.address_city
                      ? `${selected.address_city}${selected.address_state ? `, ${selected.address_state}` : ''}`
                      : t('food.merchant.subtitle'))
                  : t('food.merchant.subtitle')}
              </p>
            </div>
          </div>
          {hasDashboard && selected && canManageRestaurant && (
            <div className="fd-merchant-hero-actions">
              <span className={`fd-merchant-status-badge fd-mstatus-${selected.status}`}>
                {t(`food.restaurantStatus.${selected.status}`, selected.status)}
              </span>
              <button
                type="button"
                className="fd-btn fd-btn-secondary fd-btn-sm"
                onClick={() => { setSetupForNew(false); setShowOnboarding(true); }}
              >
                {t('food.merchant.openSetupGuide', 'Setup guide')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Page body ── */}
      <div className="fd-merchant-body">
        {!hasDashboard ? (
          <MerchantLanding t={t} onStart={() => navigate('/business-hub?create=restaurant')} />
        ) : (
          /* ── Dashboard ── */
          <>
            {/* Restaurant picker bar (hidden when there is nothing to pick or announce) */}
            {(restaurants.length > 1 || (selected && selected.status !== 'active')) && (
              <div className="fd-merchant-picker-bar">
                <div className="fd-merchant-picker-left">
                  {restaurants.length > 1 && (
                    <select
                      value={selectedId || ''}
                      onChange={(e) => setSelectedId(Number(e.target.value))}
                      className="fd-merchant-picker-select"
                      aria-label={t('food.merchant.selectRestaurant')}
                    >
                      {restaurants.map((r) => (
                        <option key={r.id} value={r.id}>{r.display_name}</option>
                      ))}
                    </select>
                  )}
                  {selected && selected.status !== 'active' && (
                    <span className="fd-pay-note fd-merchant-not-live">{t('food.merchant.notLiveHint')}</span>
                  )}
                </div>
              </div>
            )}

            {/* Tab navigation */}
            <div className="fd-tabs fd-merchant-tabs" role="tablist">
              {availableTabs.map((key) => {
                const TabIcon = TAB_ICONS[key];
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={tab === key}
                    className={`fd-tab${tab === key ? ' fd-active' : ''}`}
                    onClick={() => goToTab(key)}
                  >
                    <span className="fd-tab-icon" aria-hidden="true">{TabIcon ? <TabIcon size={16} /> : null}</span>
                    {t(`food.merchant.tab.${key}`, key === 'home' ? 'Home' : key)}
                  </button>
                );
              })}
            </div>

            {/* Tab content */}
            {selected && tab === 'home' && (
              <OwnerHomeTab
                t={t}
                restaurant={selected}
                onGoTab={goToTab}
                onUpdated={(updated) => setRestaurants((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)))}
              />
            )}
            {selected && tab === 'orders' && <OrdersTab t={t} restaurant={selected} />}
            {selected && tab === 'menu' && <RestaurantMenuManager t={t} restaurant={selected} />}
            {selected && tab === 'payouts' && (
              <>
                {canManagePayouts && <RestaurantPayoutsPanel t={t} restaurant={selected} />}
                {canManagePayouts && <RestaurantTopupEligibilityPanel t={t} restaurant={selected} onGoToPayouts={() => goToTab('payouts')} />}
                {canManageCredit && <RestaurantCreditManager restaurant={selected} />}
                {canManageCredit && <OxsteedCreditPartnerManager restaurant={selected} />}
              </>
            )}
            {selected && tab === 'settings' && canViewSettings && (
              <SettingsTab
                t={t}
                i18n={i18n}
                restaurant={selected}
                onUpdated={(updated) =>
                  setRestaurants((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)))
                }
                onSetupChanged={() => setSetupKey((k) => k + 1)}
              />
            )}
            {selected && tab === 'operations' && (
              <>
                {canManageDisplays && selected.status === 'active' && (
                  <details className="fd-owner-advanced-section">
                    <summary>{t('food.ownerHome.deviceSetup', 'Device setup')}</summary>
                    <DeviceSetupChecklist
                      key={`${selected.id}-${setupKey}`}
                      restaurant={selected}
                      t={t}
                      onComplete={() => setSetupKey((key) => key + 1)}
                    />
                  </details>
                )}
                {canManageRestaurant && (
                  <details className="fd-owner-advanced-section">
                    <summary>{t('food.ownerHome.advancedOperations', 'Advanced operations')}</summary>
                    <OperationsTab t={t} restaurant={selected} />
                  </details>
                )}
                <h3 id="in-store-screens" style={{ marginTop: '1.5rem', scrollMarginTop: '6rem' }}>{t('food.merchant.inStoreScreens')}</h3>
                <p className="fd-card-meta">{t('food.merchant.inStoreScreensHint')}</p>
                <div className="fd-row">
                  <Link to={`/restaurants/kitchen/${selected.id}`} className="fd-btn fd-btn-secondary">{t('food.merchant.openKitchen')}</Link>
                  <Link to={`/restaurants/queue/${selected.id}`} className="fd-btn fd-btn-secondary">{t('food.merchant.openQueue')}</Link>
                  <Link to={`/restaurants/kiosk/${selected.id}`} className="fd-btn fd-btn-secondary">{t('food.merchant.openKiosk')}</Link>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </PageShell>
  );
}
