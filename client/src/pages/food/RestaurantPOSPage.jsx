// RestaurantPOSPage — web POS for restaurant counter staff.
// Mirrors the OxSteed POS iOS app: category rail, menu grid, active ticket,
// modifier picker, discounts, and payment recording.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { UtensilsCrossed } from 'lucide-react';
import EmptyState from '../../components/EmptyState';
import api from '../../api/axios';
import { getFoodRestaurant, formatFoodMoney } from '../../api/food';
import { FoodBrand } from './foodShared';
import { isNetworkFailure, usePosSync } from './usePosSync';
import { clearPersistedCheckout, readPersistedCheckout, writePersistedCheckout } from './posCheckoutPersistence';
import PosStaffSessionBar from './PosStaffSession';
import {subscribeRestaurantDisplay} from '../../api/restaurantDisplaySocket';
import PageShell from '../../components/PageShell';
import '../../styles/FoodPages.css';

const FULFILLMENT_TYPES = [
  { value: 'dine_in', label: 'dine_in' },
  { value: 'pickup', label: 'takeout' },
  { value: 'delivery', label: 'delivery' },
];

function ModifierModal({ item, currency, onConfirm, onClose }) {
  const { t } = useTranslation();
  const [selections, setSelections] = useState({});
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');

  const toggle = (groupId, modId, maxSelect) => {
    setSelections((prev) => {
      const cur = prev[groupId] || [];
      if (cur.includes(modId)) return { ...prev, [groupId]: cur.filter((x) => x !== modId) };
      if (maxSelect === 1) return { ...prev, [groupId]: [modId] };
      if (cur.length >= maxSelect) return prev;
      return { ...prev, [groupId]: [...cur, modId] };
    });
  };

  const extraCents = (item.modifierGroups || []).reduce((sum, g) => {
    const sel = selections[g.group_id] || [];
    return sum + (g.modifiers || []).filter((m) => sel.includes(m.modifier_id)).reduce((s, m) => s + Number(m.price_delta_cents || 0), 0);
  }, 0);
  const unitCents = Number(item.price_cents || 0) + extraCents;

  const handleConfirm = () => {
    const mods = [];
    (item.modifierGroups || []).forEach((g) => {
      (selections[g.group_id] || []).forEach((modId) => {
        const mod = (g.modifiers || []).find((m) => m.modifier_id === modId);
        if (mod) mods.push({ modifier_id: modId, name: mod.modifier_name, price_delta_cents: mod.price_delta_cents });
      });
    });
    onConfirm({ item, qty, note, mods, unitCents });
  };

  const hasGroups = (item.modifierGroups || []).length > 0;

  return (
    <div className="fd-modal-overlay" onClick={onClose}>
      <div className="fd-modal fd-pos-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{item.name}</h3>
        {item.description && <p className="fd-pos-mod-desc">{item.description}</p>}

        {hasGroups && (item.modifierGroups || []).map((g) => (
          <div key={g.group_id} className="fd-modgroup">
            <div className="fd-modgroup-name">
              {g.group_name}{g.is_required ? ' *' : ''}
              {g.max_select > 1 ? <span className="fd-pos-mod-hint"> ({t('food.pos.maxSelect', { n: g.max_select })})</span> : null}
            </div>
            {(g.modifiers || []).map((m) => {
              const sel = (selections[g.group_id] || []).includes(m.modifier_id);
              return (
                <label key={m.modifier_id} className={`fd-modoption${sel ? ' fd-selected' : ''}`}>
                  <input type="checkbox" checked={sel} onChange={() => toggle(g.group_id, m.modifier_id, g.max_select)} data-track="ui.c952aceb7c.1" />
                  {m.modifier_name}
                  {m.price_delta_cents > 0 && <span className="fd-pos-mod-delta"> +{formatFoodMoney(m.price_delta_cents, currency)}</span>}
                </label>
              );
            })}
          </div>
        ))}

        <div className="fd-field">
          <label>{t('food.pos.note')}</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('food.pos.notePlaceholder')} />
        </div>

        <div className="fd-qty-row">
          <button className="fd-qty-btn" onClick={() => setQty((q) => Math.max(1, q - 1))} data-track="ui.c952aceb7c.2">−</button>
          <strong>{qty}</strong>
          <button className="fd-qty-btn" onClick={() => setQty((q) => q + 1)} data-track="ui.c952aceb7c.3">+</button>
          <span className="fd-price">{formatFoodMoney(unitCents * qty, currency)}</span>
        </div>
        <div className="fd-pos-modal-actions">
          <button className="fd-btn-secondary" onClick={onClose} data-track="ui.c952aceb7c.4">{t('food.common.cancel')}</button>
          <button className="fd-btn" onClick={handleConfirm} data-track="ui.c952aceb7c.5">{t('food.pos.addToTicket')}</button>
        </div>
      </div>
    </div>
  );
}

function PaymentModal({ total, currency, discounts, serverOrder, onCreateOrder, onConfirmPayment, onClose }) {
  const { t } = useTranslation();
  const [method, setMethod] = useState('cash');
  const [discountId, setDiscountId] = useState('');
  const [amountGiven, setAmountGiven] = useState('');
  const [tip, setTip] = useState('');
  const [creditHoldId, setCreditHoldId] = useState('');
  const [loading, setLoading] = useState(false);
  // S-07: set when the server answers discount_approval_required; the
  // modal then shows the manager-PIN prompt and the next review retries
  // once with the PIN.
  const [approvalNeeded, setApprovalNeeded] = useState(false);
  const [approvalPin, setApprovalPin] = useState('');

  const selectedDiscount = discounts.find((d) => String(d.id) === discountId);
  const rawDiscountCents = selectedDiscount
    ? selectedDiscount.discount_type === 'percent'
      ? Math.round(total * (selectedDiscount.value / 100))
      : Number(selectedDiscount.value_cents || 0)
    : 0;
  const discountCents = selectedDiscount?.max_discount_cents !== null && selectedDiscount?.max_discount_cents !== undefined
    ? Math.min(rawDiscountCents, Number(selectedDiscount.max_discount_cents))
    : rawDiscountCents;
  const tipCents = Math.round((parseFloat(tip) || 0) * 100);
  // F-14: once the order exists, every figure the cashier sees (subtotal,
  // tax, service fee, total, change) comes from the server-returned
  // order. The client-side estimate is only used before creation, to pick
  // a discount and tip; it never drives the payment.
  const serverTotal = serverOrder ? Number(serverOrder.total_cents || 0) : null;
  const changeCents = method === 'cash' && serverOrder
    ? Math.max(0, Math.round((parseFloat(amountGiven) || 0) * 100) - serverTotal)
    : 0;

  const handleReview = async () => {
    setLoading(true);
    const result = await onCreateOrder({
      method,
      discountId: discountId || null,
      discountCents,
      tipCents,
      approvalPin: approvalNeeded ? approvalPin : undefined,
    });
    setLoading(false);
    if (result && result.errorCode === 'discount_approval_required') {
      setApprovalNeeded(true);
    } else if (result?.offlineQueued) {
      onClose();
    } else if (result) {
      setApprovalNeeded(false);
      setApprovalPin('');
    }
  };

  const handleConfirm = async () => {
    if (method === 'oxsteed_credit' && !creditHoldId.trim()) {
      toast.error(t('food.pos.creditHoldRequired', { defaultValue: 'Enter the customer authorization code to use OxSteed Credit.' }));
      return;
    }
    setLoading(true);
    await onConfirmPayment({
      method,
      creditHoldId: creditHoldId.trim() || undefined,
    });
    setLoading(false);
  };

  return (
    <div className="fd-modal-overlay" onClick={onClose}>
      <div className="fd-modal fd-pos-pay-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('food.pos.payment')}</h3>
        <div className="fd-pos-pay-total">{formatFoodMoney(serverOrder ? serverTotal : total, currency)}</div>

        {!serverOrder && discounts.length > 0 && (
          <div className="fd-field">
            <label>{t('food.pos.discount')}</label>
            <select value={discountId} onChange={(e) => { setDiscountId(e.target.value); setApprovalNeeded(false); setApprovalPin(''); }}>
              <option value="">{t('food.pos.noDiscount')}</option>
              {discounts.map((d) => (
                <option key={d.id} value={d.id}>{d.name} {d.discount_type === 'percent' ? `(${d.value}%)` : formatFoodMoney(d.value_cents, currency)}</option>
              ))}
            </select>
          </div>
        )}

        {!serverOrder && approvalNeeded && (
          <div className="fd-field">
            <label htmlFor="pos-discount-approval-pin">{t('food.pos.managerPin')}</label>
            <p className="fd-pos-pay-hint">{t('food.pos.discountApprovalRequired')}</p>
            <input
              id="pos-discount-approval-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={approvalPin}
              onChange={(e) => setApprovalPin(e.target.value)}
              placeholder={t('food.pos.managerPinPlaceholder')}
            />
          </div>
        )}

        {!serverOrder && (
          <div className="fd-field">
            <label>{t('food.pos.tip')}</label>
            <input type="number" min="0" step="0.01" value={tip} onChange={(e) => setTip(e.target.value)} placeholder="0.00" />
          </div>
        )}

        {!serverOrder && (
          <div className="fd-pos-pay-methods">
            {['cash', 'mobile', 'oxsteed_credit'].map((m) => (
              <button key={m} className={`fd-pos-pay-method${method === m ? ' fd-active' : ''}`} onClick={() => setMethod(m)} data-track="ui.c952aceb7c.6" data-track-private>
                {t(`food.pos.method_${m}`, { defaultValue: m === 'oxsteed_credit' ? 'OxSteed Credit' : undefined })}
              </button>
            ))}
          </div>
        )}
        <p className="fd-pos-pay-hint">
          {method === 'oxsteed_credit'
            ? t('food.pos.creditPaymentHint', { defaultValue: 'The customer must have an active OxSteed Credit balance and an agreement that includes this restaurant.' })
            : t('food.pos.cardTerminalRequired', { defaultValue: 'Card payments require a connected POS terminal. Use the POS app for card checkout.' })}
        </p>

        {serverOrder && (
          <div className="fd-pos-pay-breakdown">
            <div className="fd-total-row">
              <span>{t('food.pos.subtotal')}</span>
              <span>{formatFoodMoney(serverOrder.subtotal_cents, currency)}</span>
            </div>
            {Number(serverOrder.discount_cents || 0) > 0 && (
              <div className="fd-total-row">
                <span>{t('food.pos.discount')}</span>
                <span>− {formatFoodMoney(serverOrder.discount_cents, currency)}</span>
              </div>
            )}
            <div className="fd-total-row">
              <span>{t('food.pos.tax')}</span>
              <span>{formatFoodMoney(serverOrder.tax_cents, currency)}</span>
            </div>
            <div className="fd-total-row">
              <span>{t('food.pos.serviceFee')}</span>
              <span>{formatFoodMoney(serverOrder.service_fee_cents, currency)}</span>
            </div>
            {Number(serverOrder.tip_cents || 0) > 0 && (
              <div className="fd-total-row">
                <span>{t('food.pos.tip')}</span>
                <span>{formatFoodMoney(serverOrder.tip_cents, currency)}</span>
              </div>
            )}
            <div className="fd-total-row">
              <span>{t('food.pos.total')}</span>
              <span>{formatFoodMoney(serverTotal, currency)}</span>
            </div>
          </div>
        )}

        {serverOrder && method === 'oxsteed_credit' && (
          <div className="fd-pos-credit-fields">
            <div className="fd-field">
              <label htmlFor="pos-credit-hold">{t('food.pos.creditHoldId', { defaultValue: 'Customer authorization code' })}</label>
              <input
                id="pos-credit-hold"
                type="text"
                value={creditHoldId}
                onChange={(e) => setCreditHoldId(e.target.value)}
                placeholder={t('food.pos.creditHoldPlaceholder')}
                autoComplete="off"
              />
            </div>
            <small>{t('food.pos.creditHoldHelp', { defaultValue: 'The customer starts an in-store authorization in OxSteed Credit and gives you the expiring hold ID. Email or phone alone cannot authorize spending.' })}</small>
          </div>
        )}

        {serverOrder && method === 'cash' && (
          <div className="fd-field">
            <label>{t('food.pos.amountGiven')}</label>
            <input type="number" min="0" step="0.01" value={amountGiven} onChange={(e) => setAmountGiven(e.target.value)} placeholder="0.00" />
            {changeCents > 0 && <div className="fd-pos-change">{t('food.pos.change')}: {formatFoodMoney(changeCents, currency)}</div>}
          </div>
        )}

        <div className="fd-pos-modal-actions">
          <button className="fd-btn-secondary" onClick={onClose} data-track="ui.c952aceb7c.7">{t('food.common.cancel')}</button>
          {serverOrder ? (
            <button className="fd-btn" onClick={handleConfirm} disabled={loading} data-track="ui.c952aceb7c.8">
              {loading ? t('food.common.saving') : t('food.pos.confirmPay')}
            </button>
          ) : (
            <button className="fd-btn" onClick={handleReview} disabled={loading} data-track="ui.c952aceb7c.8">
              {loading ? t('food.common.saving') : t('food.pos.reviewPayment')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RestaurantPOSPage() {
  const { restaurantId } = useParams();
  const { t } = useTranslation();

  const [restaurant, setRestaurant] = useState(null);
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [discounts, setDiscounts] = useState([]);
  const [discountDefinitions, setDiscountDefinitions] = useState([]);
  const [activeShift, setActiveShift] = useState(null);
  const [canManage, setCanManage] = useState(false);
  const [canUsePos, setCanUsePos] = useState(false);
  const [loading, setLoading] = useState(true);
  // F-04: one stable checkout id per checkout attempt, plus the order it
  // created. A payment retry reuses both; the id is cleared only when
  // the checkout completes or the ticket changes.
  const [checkoutId, setCheckoutId] = useState(null);
  const [checkoutOrder, setCheckoutOrder] = useState(null);

  const resetCheckout = useCallback(() => {
    setCheckoutId(null);
    setCheckoutOrder(null);
  }, []);

  const [activeCat, setActiveCat] = useState(null);
  const [ticket, setTicket] = useState([]); // [{item, qty, note, mods, unitCents}]
  const [fulfillment, setFulfillment] = useState('dine_in');
  const [tableName, setTableName] = useState('');
  const [guestName, setGuestName] = useState('');

  const [modItem, setModItem] = useState(null);
  const [showPay, setShowPay] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completedOrder, setCompletedOrder] = useState(null);
  const [checkoutHydrated, setCheckoutHydrated] = useState(false);

  // F13/F-08: wire the offline-sync pipeline into the web POS. Generic
  // failures are reported; cash-only network failures can be replayed with
  // the stable order/payment ids already used by the online flow.
  const {
    degraded: syncDegraded,
    failedOperations: syncFailed,
    pendingOperations: syncPending,
    outboxCount: syncOutbox,
    reportFailedOperation,
    queueOfflineCashCheckout,
  } = usePosSync(restaurantId, canManage || canUsePos);

  const ticketRef = useRef(null);

  // F-04: keep an in-progress ticket and its stable retry identity across a
  // browser reload. The two-hour bound prevents an abandoned checkout from
  // reappearing indefinitely, while an existing server order remains
  // recoverable for the same idempotent payment retry.
  useEffect(() => {
    const saved = readPersistedCheckout(restaurantId);
    if (saved) {
      setTicket(Array.isArray(saved.ticket) ? saved.ticket : []);
      setFulfillment(saved.fulfillment || 'dine_in');
      setTableName(saved.tableName || '');
      setGuestName(saved.guestName || '');
      setCheckoutId(saved.checkoutId || null);
      setCheckoutOrder(saved.checkoutOrder || null);
    }
    setCheckoutHydrated(String(restaurantId));
  }, [restaurantId]);

  useEffect(() => {
    if (checkoutHydrated !== String(restaurantId)) return;
    if (!ticket.length && !checkoutId && !checkoutOrder) {
      clearPersistedCheckout(restaurantId);
      return;
    }
    writePersistedCheckout(restaurantId, {
      ticket,
      fulfillment,
      tableName,
      guestName,
      checkoutId,
      checkoutOrder,
    });
  }, [checkoutHydrated, restaurantId, ticket, fulfillment, tableName, guestName, checkoutId, checkoutOrder]);

  const load = useCallback(async () => {
    try {
      let [r, shiftsResponse, bootstrapResponse] = await Promise.all([
        getFoodRestaurant(restaurantId),
        api.get(`/restaurants/${restaurantId}/pos/shifts?limit=50`).catch(() => ({ data: { shifts: [] } })),
        api.get(`/restaurants/${restaurantId}/app/bootstrap`).catch(() => null),
      ]);
      const openShifts = (shiftsResponse.data?.shifts || [])
        .filter((shift) => shift.status === 'open')
        .sort((a, b) => Number(Boolean(b.is_mine)) - Number(Boolean(a.is_mine)));
      const selectedShift = openShifts[0] || null;
      if (selectedShift?.location_id) r = await getFoodRestaurant(restaurantId, { locationId: selectedShift.location_id });
      const rest = r?.restaurant || r;
      setRestaurant({ ...rest, location_id: r?.location?.id ?? selectedShift?.location_id ?? null });
      // F-03: tendering a payment is a pos.use capability exercised
      // inside the cashier's own open drawer shift (the API enforces the
      // permission and the shift ownership). Managers keep their wider
      // access; refunds stay manager-only on the API.
      const membership = bootstrapResponse?.data?.membership;
      setCanManage(Boolean(membership?.canManage));
      // F-15: the restaurant's own discount definitions ride the
      // bootstrap payload; the discounts endpoint below also returns
      // them as a fallback.
      if (Array.isArray(bootstrapResponse?.data?.discountDefinitions)) {
        setDiscountDefinitions(bootstrapResponse.data.discountDefinitions);
      }
      const membershipPermissions = membership?.permissions || [];
      setCanUsePos(membershipPermissions.includes('*') || membershipPermissions.includes('pos.use'));
      setActiveShift(selectedShift);
      const cats = r?.categories || (r?.menu || []).map(({ items: _items, ...category }) => category);
      const its = r?.items || [...(r?.menu || []).flatMap((category) => category.items || []), ...(r?.uncategorizedItems || [])];
      // attach modifier groups to items
      const modGroups = r?.modifierGroups || [];
      const itemMap = {};
      its.forEach((item) => { itemMap[item.id] = { ...item, modifierGroups: (item.modifierGroups || []).map((group) => ({
        group_id: group.id, group_name: group.name, min_select: group.minSelect, max_select: group.maxSelect,
        is_required: group.isRequired, modifiers: (group.options || []).filter((option) => option.isAvailable !== false).map((option) => ({
          modifier_id: option.id, modifier_name: option.name, price_delta_cents: option.priceDeltaCents,
        })),
      })) }; });
      modGroups.forEach((g) => {
        if (itemMap[g.menu_item_id]) {
          const existing = itemMap[g.menu_item_id].modifierGroups.find((eg) => eg.group_id === g.group_id);
          if (!existing) {
            itemMap[g.menu_item_id].modifierGroups.push({ ...g, modifiers: [] });
          }
          const grp = itemMap[g.menu_item_id].modifierGroups.find((eg) => eg.group_id === g.group_id);
          if (g.modifier_id) {
            grp.modifiers.push({ modifier_id: g.modifier_id, modifier_name: g.modifier_name, price_delta_cents: g.price_delta_cents });
          }
        }
      });
      setCategories(cats);
      setItems(Object.values(itemMap));
      if (cats.length) setActiveCat(cats[0].id);
    } catch {
      toast.error(t('food.common.loadError'));
    } finally {
      setLoading(false);
    }
  }, [restaurantId, t]);

  useEffect(()=>{return subscribeRestaurantDisplay(restaurantId,load);},[restaurantId,canManage,load]);
  useEffect(() => {
    const stamps = items.map((item) => Date.parse(item.store_override?.available_again_at)).filter((stamp) => stamp > Date.now());
    if (!stamps.length) return undefined;
    const timer = setTimeout(load, Math.min(2147483647, Math.max(100, Math.min(...stamps) - Date.now() + 100)));
    return () => clearTimeout(timer);
  }, [items, load]);

  useEffect(() => {
    load();
    api.get(`/restaurants/${restaurantId}/pos/discounts`)
      .then((r) => {
        setDiscounts(r.data?.discounts || []);
        if (Array.isArray(r.data?.discountDefinitions)) {
          setDiscountDefinitions(r.data.discountDefinitions);
        }
      })
      .catch(() => {});
  }, [load, restaurantId]);

  const handleItemClick = (item) => {
    if (!item.is_available) return;
    if ((item.modifierGroups || []).length > 0) {
      setModItem(item);
    } else {
      addLine({ item, qty: 1, note: '', mods: [], unitCents: Number(item.price_cents || 0) });
    }
  };

  const addLine = ({ item, qty, note, mods, unitCents }) => {
    // The ticket no longer matches any order a checkout already created.
    resetCheckout();
    setTicket((prev) => {
      // merge identical lines (same item, same mods, no note)
      if (!note && mods.length === 0) {
        const idx = prev.findIndex((l) => l.item.id === item.id && l.mods.length === 0 && !l.note && (l.courseNumber || 1) === 1);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], qty: next[idx].qty + qty };
          return next;
        }
      }
      return [...prev, { item, qty, note, mods, unitCents, courseNumber: 1, seatNumber: null }];
    });
    setModItem(null);
  };

  const adjustQty = (idx, delta) => {
    resetCheckout();
    setTicket((prev) => {
      const next = [...prev];
      const newQty = next[idx].qty + delta;
      if (newQty <= 0) return next.filter((_, i) => i !== idx);
      next[idx] = { ...next[idx], qty: newQty };
      return next;
    });
  };

  const totalCents = ticket.reduce((s, l) => s + l.unitCents * l.qty, 0);
  const currency = restaurant?.currency_code || 'USD';
  const visibleItems = items.filter((i) => i.category_id === activeCat);
  const serializeTicket = () => ticket.map((l) => ({
    menuItemId: l.item.id,
    quantity: l.qty,
      courseNumber: l.courseNumber || 1,
      seatNumber: l.seatNumber || undefined,
    modifierIds: l.mods.map((modifier) => modifier.modifier_id),
    specialInstructions: l.note || undefined,
  }));
  const requireOpenShift = () => {
    if (activeShift) return true;
    toast.error(t('food.pos.openShiftRequired', { defaultValue: 'Open a POS shift before taking orders.' }));
    return false;
  };

  const changeCourse = (idx, courseNumber) => {
    resetCheckout();
    setTicket((prev) => prev.map((line, lineIndex) => (
      lineIndex === idx ? { ...line, courseNumber: Number(courseNumber) || 1 } : line
    )));
  };

  const changeSeat = (idx, seatNumber) => {
    resetCheckout();
    setTicket((prev) => prev.map((line, lineIndex) => (
      lineIndex === idx ? { ...line, seatNumber: seatNumber ? Number(seatNumber) : null } : line
    )));
  };

  const handleOpenShift = async () => {
    setSubmitting(true);
    try {
      const res = await api.post(`/restaurants/${restaurantId}/pos/shifts`, {});
      const shift = res.data?.shift;
      if (shift && shift.status === 'open') {
        setActiveShift(shift);
      } else {
        await load();
      }
      toast.success(t('food.merchant.posShiftOpened', 'POS shift opened. You can take orders now.'));
    } catch (err) {
      toast.error(err?.response?.data?.message || t('food.merchant.posShiftOpenError', 'Could not open the POS shift.'));
    } finally {
      setSubmitting(false);
    }
  };

  const canPay = canManage || canUsePos;

  // F-15: the discount picker lists the legacy global codes and the
  // restaurant's own definitions together. Definitions carry a prefixed
  // id so the two sets never collide; choosing one sends its
  // discount_definition_id and the server computes the amount.
  const pickerDiscounts = [
    ...discounts,
    ...discountDefinitions.map((definition) => ({
      ...definition,
      id: `definition-${definition.id}`,
      definitionId: Number(definition.id),
    })),
  ];

  // F-04 phase 1: create the order for this checkout. The stable
  // client_order_id makes a retry return the same order from the server
  // instead of duplicating the ticket; if this checkout already created
  // its order, it is reused as-is.
  const handleCreateCheckoutOrder = async ({ method, discountId, tipCents, approvalPin }) => {
    if (!requireOpenShift()) return null;
    const activeCheckoutId = checkoutId || crypto.randomUUID();
    if (!checkoutId) setCheckoutId(activeCheckoutId);
    if (checkoutOrder) return checkoutOrder;
    setSubmitting(true);
    const selectedDiscount = pickerDiscounts.find((discount) => String(discount.id) === String(discountId));
    const payload = {
      items: serializeTicket(),
      order_source: 'counter',
      location_id: restaurant?.location_id ?? activeShift.location_id,
      shift_id: activeShift.id,
      fulfillment_type: fulfillment,
      table_name: tableName || undefined,
      guest_name: guestName || undefined,
      client_order_id: activeCheckoutId,
      payment_mode: method === 'oxsteed_credit' ? 'oxsteed_credit' : 'pay_at_restaurant',
      payment_method: method,
      discount_definition_id: selectedDiscount?.definitionId || undefined,
      discount_lines: discountId && !selectedDiscount?.definitionId
        ? [{
            code: selectedDiscount?.code,
            label: selectedDiscount?.name,
            percent_bps: Math.round((selectedDiscount?.percentOff || 0) * 10000),
          }]
        : undefined,
      approval_pin: approvalPin || undefined,
      tip_cents: tipCents || undefined,
    };
    try {
      const res = await api.post(`/restaurants/${restaurantId}/pos/orders`, payload);
      const order = res.data?.order || null;
      if (order) setCheckoutOrder(order);
      return order;
    } catch (err) {
      // S-07: the server refused the definition discount until a manager
      // approves it. Not a failure: hand the code back so the payment
      // modal can prompt for the manager PIN and retry once with it.
      if (err?.response?.data?.code === 'discount_approval_required') {
        return { errorCode: 'discount_approval_required' };
      }
      if (method === 'cash' && isNetworkFailure(err)) {
        const queued = queueOfflineCashCheckout({
          method,
          orderPayload: payload,
          paymentPayload: {
            paymentType: 'cash',
            paymentMode: 'pay_at_restaurant',
            shiftId: activeShift.id,
            idempotencyKey: `pos-payment:${activeCheckoutId}`,
          },
        });
        if (!queued) {
          const message = t('food.pos.offlineCashReplayWaiting');
          reportFailedOperation('pos_order', message);
          toast.error(message);
          return null;
        }
        setTicket([]);
        setTableName('');
        setGuestName('');
        resetCheckout();
        clearPersistedCheckout(restaurantId);
        setShowPay(false);
        toast.success(t('food.pos.offlineCashSaved'));
        return { offlineQueued: true };
      }
      const message = err?.response?.data?.message || t('food.pos.orderError');
      reportFailedOperation('pos_order', message);
      toast.error(message);
      return null;
    } finally {
      setSubmitting(false);
    }
  };

  // F-04 phase 2: record the payment against the order this checkout
  // created. The payment idempotency key derives from the checkout id,
  // so retrying after a failure is the same payment, never a second one.
  // F-14: the amount is the server-returned order total.
  const handleConfirmPayment = async ({ method, creditHoldId }) => {
    if (!requireOpenShift() || !checkoutOrder) return false;
    setSubmitting(true);
    try {
      await api.post(`/restaurants/${restaurantId}/pos/orders/${checkoutOrder.id}/payments`, {
        paymentType: method === 'mobile' ? 'external' : method,
        paymentMode: method === 'mobile'
          ? 'direct_payment'
          : method === 'oxsteed_credit'
            ? 'oxsteed_credit'
            : 'pay_at_restaurant',
        amountCents: Number(checkoutOrder.total_cents),
        shiftId: activeShift.id,
        idempotencyKey: `pos-payment:${checkoutOrder.client_order_id || checkoutId}`,
        creditHoldId,
      });
      setCompletedOrder(checkoutOrder);
      setTicket([]);
      setTableName('');
      setGuestName('');
      resetCheckout();
      clearPersistedCheckout(restaurantId);
      setShowPay(false);
      toast.success(t('food.pos.orderSent'));
      return true;
    } catch (err) {
      const message = err?.response?.data?.message || t('food.pos.orderError');
      if (method === 'cash' && isNetworkFailure(err)) {
        const queued = queueOfflineCashCheckout({
          method,
          orderId: checkoutOrder.id,
          orderTotalCents: checkoutOrder.total_cents,
          paymentPayload: {
            paymentType: 'cash',
            paymentMode: 'pay_at_restaurant',
            amountCents: Number(checkoutOrder.total_cents),
            shiftId: activeShift.id,
            idempotencyKey: `pos-payment:${checkoutOrder.client_order_id || checkoutId}`,
          },
        });
        if (!queued) {
          const replayMessage = t('food.pos.offlineCashReplayWaiting');
          reportFailedOperation('pos_payment', replayMessage);
          toast.error(replayMessage);
          return false;
        }
        setTicket([]);
        setTableName('');
        setGuestName('');
        resetCheckout();
        clearPersistedCheckout(restaurantId);
        setShowPay(false);
        toast.success(t('food.pos.offlineCashSaved'));
        return true;
      }
      // Other failed POS mutations are reported to the offline-sync pipeline;
      // they stay visible for reconciliation and are never auto-retried.
      reportFailedOperation('pos_payment', message);
      toast.error(message);
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendToKitchen = async () => {
    if (!requireOpenShift()) return;
    setSubmitting(true);
    try {
      const payload = {
        items: serializeTicket(),
        location_id: restaurant?.location_id ?? activeShift.location_id,
        order_source: 'counter',
        shift_id: activeShift.id,
        fulfillment_type: fulfillment,
        table_name: tableName || undefined,
        guest_name: guestName || undefined,
        payment_mode: 'pay_at_restaurant',
      };
      const res = await api.post(`/restaurants/${restaurantId}/pos/orders`, payload);
      const order = res.data?.order;
      if (order) {
        setCompletedOrder(order);
        setTicket([]);
        setTableName('');
        setGuestName('');
        resetCheckout();
        clearPersistedCheckout(restaurantId);
        toast.success(t('food.pos.sentToKitchen'));
      }
    } catch (err) {
      const message = err?.response?.data?.message || t('food.pos.orderError');
      reportFailedOperation('pos_order', message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <PageShell>
        <div className="fd-page fd-empty">{t('food.common.loading')}</div>
      </PageShell>
    );
  }

  const rest = restaurant;

  return (
    <PageShell>
      <div className="fd-pos-shell">
        {syncDegraded && (
          <div className="fd-pos-sync-banner" role="alert">
            {t('food.pos.syncDegraded', 'Sync degraded: {{failed}} failed, {{pending}} pending, {{outbox}} unsent', {
              failed: syncFailed,
              pending: syncPending,
              outbox: syncOutbox,
            })}
          </div>
        )}
        {/* Header */}
        <header className="fd-pos-header">
          <FoodBrand />
          <div className="fd-pos-header-rest">
            <strong>{rest?.name}</strong>
            <span className="fd-tag">{t('food.pos.title')}</span>
          </div>
          <div className="fd-pos-fulfillment">
            {FULFILLMENT_TYPES.map((f) => (
              <button key={f.value} className={`fd-pos-ftype${fulfillment === f.value ? ' fd-active' : ''}`} onClick={() => { setFulfillment(f.value); resetCheckout(); }} data-track="ui.c952aceb7c.9">
                {t(`food.pos.fulfillment_${f.label}`)}
              </button>
            ))}
          </div>
          <div className="fd-pos-header-meta">
            <PosStaffSessionBar restaurantId={restaurantId} />
            {activeShift ? (
              <span className="fd-tag">
                {t('food.pos.shiftOpen', { defaultValue: 'POS shift open' })}
              </span>
            ) : (
              <>
                <span className="fd-tag">
                  {t('food.pos.shiftRequired', { defaultValue: 'Open POS shift required' })}
                </span>
                <button type="button" className="fd-btn fd-btn-sm" onClick={handleOpenShift} disabled={submitting} data-track="ui.c952aceb7c.10">
                  {submitting ? t('food.common.saving') : t('food.merchant.posOpenShift', 'Open shift')}
                </button>
              </>
            )}
            <input className="fd-pos-meta-input" value={tableName} onChange={(e) => setTableName(e.target.value)} placeholder={t('food.pos.table')} />
            <input className="fd-pos-meta-input" value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder={t('food.pos.guestName')} />
          </div>
          <Link className="fd-btn-secondary fd-btn-sm" to={`/restaurants/merchant`}>{t('food.common.back')}</Link>
        </header>

        <div className="fd-pos-body">
          {/* Left — menu */}
          <aside className="fd-pos-menu">
            {/* Category rail */}
            <div className="fd-pos-cat-rail">
              {categories.map((c) => (
                <button key={c.id} className={`fd-pos-cat${activeCat === c.id ? ' fd-active' : ''}`} onClick={() => setActiveCat(c.id)} data-track="ui.c952aceb7c.11">
                  {c.name}
                </button>
              ))}
            </div>
            {/* Item grid */}
            <div className="fd-pos-items">
              {visibleItems.length === 0 && (
                <EmptyState icon={UtensilsCrossed} title={t('food.pos.noItems')} />
              )}
              {visibleItems.map((item) => (
                <button
                  key={item.id}
                  className={`fd-pos-item${!item.is_available ? ' fd-unavailable' : ''}`}
                  onClick={() => handleItemClick(item)}
                  disabled={!item.is_available} data-track="ui.c952aceb7c.12"
                >
                  {item.image_url && <img src={item.image_url} alt={item.name} className="fd-pos-item-img" />}
                  <span className="fd-pos-item-name">{item.name}</span>
                  <span className="fd-price">{formatFoodMoney(item.price_cents, currency)}</span>
                  {!item.is_available && <span className="fd-pos-item-unavail">{t('food.pos.soldOut')}</span>}
                </button>
              ))}
            </div>
          </aside>

          {/* Right — active ticket */}
          <div className="fd-pos-ticket" ref={ticketRef}>
            <div className="fd-pos-ticket-head">
              <span>{t('food.pos.ticket')}</span>
              {ticket.length > 0 && (
                <button className="fd-pos-clear" onClick={() => { setTicket([]); resetCheckout(); }} data-track="ui.c952aceb7c.13">
                  {t('food.pos.clear')}
                </button>
              )}
            </div>

            {ticket.length === 0 && (
              <div className="fd-pos-ticket-empty">{t('food.pos.emptyTicket')}</div>
            )}

            <div className="fd-pos-lines">
              {ticket.map((line, idx) => (
                <div key={idx} className="fd-pos-line">
                  <div className="fd-pos-line-name">
                    {line.item.name}
                    {line.mods.length > 0 && <div className="fd-pos-line-mods">{line.mods.map((m) => m.name).join(', ')}</div>}
                    {line.note && <div className="fd-pos-line-note">🗒 {line.note}</div>}
                  </div>
                  <div className="fd-pos-line-qty">
                    <button className="fd-qty-btn" onClick={() => adjustQty(idx, -1)} data-track="ui.c952aceb7c.14">−</button>
                    <span>{line.qty}</span>
                    <button className="fd-qty-btn" onClick={() => adjustQty(idx, 1)} data-track="ui.c952aceb7c.15">+</button>
                  </div>
                  <label className="fd-pos-line-course">
                    <span className="sr-only">{t('food.pos.course')}</span>
                    <select value={line.courseNumber || 1} onChange={(e) => changeCourse(idx, e.target.value)} aria-label={t('food.pos.course')}>
                      {Array.from({ length: 4 }, (_, courseIndex) => courseIndex + 1).map((course) => (
                        <option key={course} value={course}>{t('food.pos.courseOption', { n: course })}</option>
                      ))}
                    </select>
                  </label>
                  <label className="fd-pos-line-seat">
                    <span className="sr-only">{t('food.pos.seat')}</span>
                    <select value={line.seatNumber || ''} onChange={(e) => changeSeat(idx, e.target.value)} aria-label={t('food.pos.seat')}>
                      <option value="">{t('food.pos.noSeat')}</option>
                      {Array.from({ length: 12 }, (_, seatIndex) => seatIndex + 1).map((seat) => (
                        <option key={seat} value={seat}>{t('food.pos.seatOption', { n: seat })}</option>
                      ))}
                    </select>
                  </label>
                  <div className="fd-price">{formatFoodMoney(line.unitCents * line.qty, currency)}</div>
                </div>
              ))}
            </div>

            {ticket.length > 0 && (
              <div className="fd-pos-ticket-foot">
                <div className="fd-total-row">
                  <span>{t('food.pos.subtotal')}</span>
                  <span>{formatFoodMoney(totalCents, currency)}</span>
                </div>
                <div className="fd-pos-actions">
                  <button className="fd-btn-secondary" onClick={handleSendToKitchen} disabled={submitting} data-track="ui.c952aceb7c.16">
                    {t('food.pos.sendKitchen')}
                  </button>
                  <button
                    className="fd-btn"
                    onClick={() => { if (!checkoutId) setCheckoutId(crypto.randomUUID()); setShowPay(true); }}
                    disabled={submitting || !canPay}
                    title={canPay ? undefined : t('food.pos.payPermissionRequired')} data-track="ui.c952aceb7c.17"
                  >
                    {t('food.pos.payNow')}
                  </button>
                </div>
                {!canPay && (
                  <div className="fd-pos-pay-hint">{t('food.pos.payPermissionRequired')}</div>
                )}
              </div>
            )}

            {completedOrder && (
              <div className="fd-pos-order-done">
                <div className="fd-pos-done-num">#{completedOrder.queue_number || completedOrder.id}</div>
                <div>{t('food.pos.orderDone')}</div>
                <button className="fd-btn-sm fd-btn-secondary" onClick={() => setCompletedOrder(null)} data-track="ui.c952aceb7c.18">
                  {t('food.pos.newOrder')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {modItem && (
        <ModifierModal
          item={modItem}
          currency={currency}
          onConfirm={addLine}
          onClose={() => setModItem(null)}
        />
      )}

      {showPay && (
        <PaymentModal
          total={totalCents}
          currency={currency}
          discounts={pickerDiscounts}
          serverOrder={checkoutOrder}
          onCreateOrder={handleCreateCheckoutOrder}
          onConfirmPayment={handleConfirmPayment}
          onClose={() => setShowPay(false)}
        />
      )}
    </PageShell>
  );
}
