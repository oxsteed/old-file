// RestaurantPOSPage — web POS for restaurant counter staff.
// Mirrors the OxSteed POS iOS app: category rail, menu grid, active ticket,
// modifier picker, discounts, and payment recording.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { getFoodRestaurant, formatFoodMoney } from '../../api/food';
import { FoodBrand } from './foodShared';
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
                  <input type="checkbox" checked={sel} onChange={() => toggle(g.group_id, m.modifier_id, g.max_select)} />
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
          <button className="fd-qty-btn" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
          <strong>{qty}</strong>
          <button className="fd-qty-btn" onClick={() => setQty((q) => q + 1)}>+</button>
          <span className="fd-price">{formatFoodMoney(unitCents * qty, currency)}</span>
        </div>
        <div className="fd-pos-modal-actions">
          <button className="fd-btn-secondary" onClick={onClose}>{t('food.common.cancel')}</button>
          <button className="fd-btn" onClick={handleConfirm}>{t('food.pos.addToTicket')}</button>
        </div>
      </div>
    </div>
  );
}

function PaymentModal({ total, currency, discounts, onPay, onClose }) {
  const { t } = useTranslation();
  const [method, setMethod] = useState('cash');
  const [discountId, setDiscountId] = useState('');
  const [amountGiven, setAmountGiven] = useState('');
  const [tip, setTip] = useState('');
  const [loading, setLoading] = useState(false);

  const selectedDiscount = discounts.find((d) => String(d.id) === discountId);
  const discountCents = selectedDiscount
    ? selectedDiscount.discount_type === 'percent'
      ? Math.round(total * (selectedDiscount.value / 100))
      : Number(selectedDiscount.value_cents || 0)
    : 0;
  const tipCents = Math.round((parseFloat(tip) || 0) * 100);
  const finalTotal = Math.max(0, total - discountCents) + tipCents;
  const changeCents = method === 'cash' ? Math.max(0, Math.round((parseFloat(amountGiven) || 0) * 100) - finalTotal) : 0;

  const handlePay = async () => {
    setLoading(true);
    await onPay({ method, discountId: discountId || null, discountCents, tipCents, finalTotal });
    setLoading(false);
  };

  return (
    <div className="fd-modal-overlay" onClick={onClose}>
      <div className="fd-modal fd-pos-pay-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('food.pos.payment')}</h3>
        <div className="fd-pos-pay-total">{formatFoodMoney(total, currency)}</div>

        {discounts.length > 0 && (
          <div className="fd-field">
            <label>{t('food.pos.discount')}</label>
            <select value={discountId} onChange={(e) => setDiscountId(e.target.value)}>
              <option value="">{t('food.pos.noDiscount')}</option>
              {discounts.map((d) => (
                <option key={d.id} value={d.id}>{d.name} {d.discount_type === 'percent' ? `(${d.value}%)` : formatFoodMoney(d.value_cents, currency)}</option>
              ))}
            </select>
          </div>
        )}

        <div className="fd-field">
          <label>{t('food.pos.tip')}</label>
          <input type="number" min="0" step="0.01" value={tip} onChange={(e) => setTip(e.target.value)} placeholder="0.00" />
        </div>

        <div className="fd-pos-pay-methods">
          {['cash', 'mobile'].map((m) => (
            <button key={m} className={`fd-pos-pay-method${method === m ? ' fd-active' : ''}`} onClick={() => setMethod(m)}>
              {t(`food.pos.method_${m}`)}
            </button>
          ))}
        </div>
        <p className="fd-pos-pay-hint">
          {t('food.pos.cardTerminalRequired', { defaultValue: 'Card payments require a connected POS terminal. Use the POS app for card checkout.' })}
        </p>

        {method === 'cash' && (
          <div className="fd-field">
            <label>{t('food.pos.amountGiven')}</label>
            <input type="number" min="0" step="0.01" value={amountGiven} onChange={(e) => setAmountGiven(e.target.value)} placeholder="0.00" />
            {changeCents > 0 && <div className="fd-pos-change">{t('food.pos.change')}: {formatFoodMoney(changeCents, currency)}</div>}
          </div>
        )}

        <div className="fd-total-row" style={{ marginTop: '1rem' }}>
          <span>{t('food.pos.total')}</span>
          <span>{formatFoodMoney(finalTotal, currency)}</span>
        </div>
        {discountCents > 0 && <div className="fd-pos-discount-line">− {formatFoodMoney(discountCents, currency)} {selectedDiscount?.name}</div>}

        <div className="fd-pos-modal-actions">
          <button className="fd-btn-secondary" onClick={onClose}>{t('food.common.cancel')}</button>
          <button className="fd-btn" onClick={handlePay} disabled={loading}>
            {loading ? t('food.common.saving') : t('food.pos.confirmPay')}
          </button>
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
  const [activeShift, setActiveShift] = useState(null);
  const [loading, setLoading] = useState(true);

  const [activeCat, setActiveCat] = useState(null);
  const [ticket, setTicket] = useState([]); // [{item, qty, note, mods, unitCents}]
  const [fulfillment, setFulfillment] = useState('dine_in');
  const [tableName, setTableName] = useState('');
  const [guestName, setGuestName] = useState('');

  const [modItem, setModItem] = useState(null);
  const [showPay, setShowPay] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completedOrder, setCompletedOrder] = useState(null);

  const ticketRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [r, shiftsResponse] = await Promise.all([
        getFoodRestaurant(restaurantId),
        api.get(`/restaurants/${restaurantId}/pos/shifts?limit=50`).catch(() => ({ data: { shifts: [] } })),
      ]);
      const rest = r?.restaurant || r;
      setRestaurant(rest);
      const openShifts = (shiftsResponse.data?.shifts || [])
        .filter((shift) => shift.status === 'open')
        .sort((a, b) => Number(Boolean(b.is_mine)) - Number(Boolean(a.is_mine)));
      setActiveShift(openShifts[0] || null);
      const cats = r?.categories || [];
      const its = r?.items || [];
      // attach modifier groups to items
      const modGroups = r?.modifierGroups || [];
      const itemMap = {};
      its.forEach((item) => { itemMap[item.id] = { ...item, modifierGroups: [] }; });
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

  useEffect(() => {
    load();
    api.get(`/restaurants/${restaurantId}/pos/discounts`)
      .then((r) => setDiscounts(r.data?.discounts || []))
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
    setTicket((prev) => {
      // merge identical lines (same item, same mods, no note)
      if (!note && mods.length === 0) {
        const idx = prev.findIndex((l) => l.item.id === item.id && l.mods.length === 0 && !l.note);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], qty: next[idx].qty + qty };
          return next;
        }
      }
      return [...prev, { item, qty, note, mods, unitCents }];
    });
    setModItem(null);
  };

  const adjustQty = (idx, delta) => {
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
    modifierIds: l.mods.map((modifier) => modifier.modifier_id),
    specialInstructions: l.note || undefined,
  }));
  const requireOpenShift = () => {
    if (activeShift) return true;
    toast.error(t('food.pos.openShiftRequired', { defaultValue: 'Open a POS shift before taking orders.' }));
    return false;
  };

  const handlePay = async ({ method, discountId, discountCents, tipCents, finalTotal }) => {
    if (!requireOpenShift()) return;
    setSubmitting(true);
    try {
      const payload = {
        items: serializeTicket(),
        order_source: 'counter',
        shift_id: activeShift.id,
        fulfillment_type: fulfillment,
        table_name: tableName || undefined,
        guest_name: guestName || undefined,
        payment_mode: 'pay_at_restaurant',
        payment_method: method,
        discount_lines: discountId
          ? [{
              code: discounts.find((discount) => String(discount.id) === String(discountId))?.code,
              label: discounts.find((discount) => String(discount.id) === String(discountId))?.name,
              percent_bps: Math.round((discounts.find((discount) => String(discount.id) === String(discountId))?.percentOff || 0) * 10000),
            }]
          : undefined,
        tip_cents: tipCents || undefined,
        total_cents: finalTotal,
      };
      const res = await api.post(`/restaurants/${restaurantId}/pos/orders`, payload);
      const order = res.data?.order;
      if (order) {
        // record payment
        await api.post(`/restaurants/${restaurantId}/pos/orders/${order.id}/payments`, {
          paymentType: method === 'mobile' ? 'external' : method,
          paymentMode: method === 'mobile' ? 'direct_payment' : 'pay_at_restaurant',
          amountCents: Number(order.total_cents ?? finalTotal),
          shiftId: activeShift.id,
          idempotencyKey: crypto.randomUUID(),
        });
        setCompletedOrder(order);
        setTicket([]);
        setTableName('');
        setGuestName('');
        setShowPay(false);
        toast.success(t('food.pos.orderSent'));
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || t('food.pos.orderError'));
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
        toast.success(t('food.pos.sentToKitchen'));
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || t('food.pos.orderError'));
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
        {/* Header */}
        <header className="fd-pos-header">
          <FoodBrand />
          <div className="fd-pos-header-rest">
            <strong>{rest?.name}</strong>
            <span className="fd-tag">{t('food.pos.title')}</span>
          </div>
          <div className="fd-pos-fulfillment">
            {FULFILLMENT_TYPES.map((f) => (
              <button key={f.value} className={`fd-pos-ftype${fulfillment === f.value ? ' fd-active' : ''}`} onClick={() => setFulfillment(f.value)}>
                {t(`food.pos.fulfillment_${f.label}`)}
              </button>
            ))}
          </div>
          <div className="fd-pos-header-meta">
            <span className="fd-tag">
              {activeShift
                ? t('food.pos.shiftOpen', { defaultValue: 'POS shift open' })
                : t('food.pos.shiftRequired', { defaultValue: 'Open POS shift required' })}
            </span>
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
                <button key={c.id} className={`fd-pos-cat${activeCat === c.id ? ' fd-active' : ''}`} onClick={() => setActiveCat(c.id)}>
                  {c.name}
                </button>
              ))}
            </div>
            {/* Item grid */}
            <div className="fd-pos-items">
              {visibleItems.length === 0 && <div className="fd-empty">{t('food.pos.noItems')}</div>}
              {visibleItems.map((item) => (
                <button
                  key={item.id}
                  className={`fd-pos-item${!item.is_available ? ' fd-unavailable' : ''}`}
                  onClick={() => handleItemClick(item)}
                  disabled={!item.is_available}
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
                <button className="fd-pos-clear" onClick={() => setTicket([])}>
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
                    <button className="fd-qty-btn" onClick={() => adjustQty(idx, -1)}>−</button>
                    <span>{line.qty}</span>
                    <button className="fd-qty-btn" onClick={() => adjustQty(idx, 1)}>+</button>
                  </div>
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
                  <button className="fd-btn-secondary" onClick={handleSendToKitchen} disabled={submitting}>
                    {t('food.pos.sendKitchen')}
                  </button>
                  <button className="fd-btn" onClick={() => setShowPay(true)} disabled={submitting}>
                    {t('food.pos.payNow')}
                  </button>
                </div>
              </div>
            )}

            {completedOrder && (
              <div className="fd-pos-order-done">
                <div className="fd-pos-done-num">#{completedOrder.queue_number || completedOrder.id}</div>
                <div>{t('food.pos.orderDone')}</div>
                <button className="fd-btn-sm fd-btn-secondary" onClick={() => setCompletedOrder(null)}>
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
          discounts={discounts}
          onPay={handlePay}
          onClose={() => setShowPay(false)}
        />
      )}
    </PageShell>
  );
}
