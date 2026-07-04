// OxSteed Food - merchant dashboard: onboarding, menu manager, live orders,
// and links to the in-store screens (kitchen display, queue board, kiosk).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { subscribeRestaurantDisplay } from '../../api/restaurantDisplaySocket';
import {
  listMyFoodRestaurants,
  createFoodRestaurant,
  updateFoodRestaurant,
  getFoodRestaurant,
  createFoodCategory,
  deleteFoodCategory,
  createFoodMenuItem,
  updateFoodMenuItem,
  deleteFoodMenuItem,
  createFoodModifierGroup,
  listFoodRestaurantOrders,
  updateFoodOrderStatus,
  updateFoodOrderPayment,
  formatFoodMoney,
} from '../../api/food';
import { FoodBrand, FoodConnBadge, FOOD_STATUS_KEYS, apiErrorMessage } from './foodShared';
import SetupWizard, { defaultWeekdayHours } from './FoodSetupWizard';
import DeviceSetupChecklist, { isDeviceSetupComplete } from './FoodDeviceSetupChecklist';
import MerchantOnboardingWizard, { shouldShowMerchantOnboarding } from './FoodMerchantOnboardingWizard';
import LocationsPanel from './FoodLocationsPanel';
import PromotionsPanel from './FoodPromotionsPanel';
import { ChecklistsPanel, SopsPanel, InventoryPanel } from './RestaurantOpsPanels';
import PageShell from '../../components/PageShell';
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
          <input id="fd-r-street" value={form.addressStreet} onChange={set('addressStreet')} />
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

// ── Live orders tab ──────────────────────────────────────────────────────────
function OrdersTab({ t, restaurant }) {
  const [orders, setOrders] = useState([]);
  const [feedError, setFeedError] = useState(false);
  const timerRef = useRef(null);

  const load = useCallback(() => {
    listFoodRestaurantOrders(restaurant.id, { active: 1 })
      .then((rows) => {
        setOrders(rows);
        setFeedError(false);
      })
      .catch(() => setFeedError(true));
  }, [restaurant.id]);

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, 7000);
    const unsubscribe = subscribeRestaurantDisplay(restaurant.id, load);
    return () => {
      clearInterval(timerRef.current);
      unsubscribe();
    };
  }, [load, restaurant.id]);

  const advance = async (order) => {
    const next = NEXT_STATUS[order.status];
    if (!next) return;
    try {
      await updateFoodOrderStatus(restaurant.id, order.id, next);
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.merchant.statusError')));
    }
  };

  const cancel = async (order) => {
    try {
      await updateFoodOrderStatus(restaurant.id, order.id, 'cancelled');
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.merchant.statusError')));
    }
  };

  const markPaid = async (order) => {
    try {
      await updateFoodOrderPayment(restaurant.id, order.id, 'paid');
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.merchant.statusError')));
    }
  };

  return (
    <div className="fd-section">
      <div className="fd-row" style={{ justifyContent: 'space-between', marginBottom: '0.8rem' }}>
        <span className="fd-row" style={{ gap: '0.6rem', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>{t('food.merchant.liveOrders')}</h2>
          <FoodConnBadge ok={!feedError} />
        </span>
        <div className="fd-row">
          <Link to={`/restaurants/kitchen/${restaurant.id}`} className="fd-btn fd-btn-secondary fd-btn-sm">
            {t('food.merchant.openKitchen')}
          </Link>
          <Link to={`/restaurants/queue/${restaurant.id}`} className="fd-btn fd-btn-secondary fd-btn-sm">
            {t('food.merchant.openQueue')}
          </Link>
          <Link to={`/restaurants/kiosk/${restaurant.id}`} className="fd-btn fd-btn-secondary fd-btn-sm">
            {t('food.merchant.openKiosk')}
          </Link>
        </div>
      </div>
      {orders.length === 0 && <div className="fd-empty">{t('food.merchant.noOrders')}</div>}
      {orders.map((order) => (
        <div key={order.id} className={`fd-order-card fd-status-${order.status}`}>
          <div className="fd-order-head">
            <strong>#{order.queue_number} · {order.guest_name || t('food.merchant.guest')}</strong>
            <span className="fd-row" style={{ gap: '0.4rem' }}>
              <span className="fd-status-pill">{t(FOOD_STATUS_KEYS[order.status] || 'food.status.received')}</span>
              <span className={`fd-status-pill${order.payment_status === 'paid' ? ' fd-paid-pill' : ''}`}>
                {order.payment_status === 'paid' ? t('food.payment.paid') : t('food.payment.unpaid')}
              </span>
            </span>
          </div>
          <div style={{ fontSize: '0.88rem', margin: '0.35rem 0' }}>
            {(order.items || []).map((item) => `${item.quantity}× ${item.itemName}`).join(', ')}
          </div>
          <div className="fd-row" style={{ justifyContent: 'space-between' }}>
            <span className="fd-card-meta">
              {t(`food.source.${order.order_source}`)} · {t(`food.fulfillment.${order.fulfillment_type}`)}
              {order.table_label ? ` · ${t('food.order.tableLabel')}: ${order.table_label}` : ''}
              {' · '}
              <strong>{formatFoodMoney(order.total_cents, order.currency_code)}</strong>
            </span>
            <span className="fd-row">
              {order.payment_status !== 'paid' && (
                <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => markPaid(order)}>
                  {t('food.merchant.markPaid')}
                </button>
              )}
              {NEXT_STATUS[order.status] && (
                <button type="button" className="fd-btn fd-btn-sm" onClick={() => advance(order)}>
                  {t(`food.advance.${NEXT_STATUS[order.status]}`)}
                </button>
              )}
              {['received', 'accepted', 'preparing'].includes(order.status) && (
                <button type="button" className="fd-btn fd-btn-danger fd-btn-sm" onClick={() => cancel(order)}>
                  {t('food.common.cancel')}
                </button>
              )}
            </span>
          </div>
        </div>
      ))}
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
function SettingsTab({ t, restaurant, onUpdated, onSetupChanged }) {
  const [saving, setSaving] = useState(false);
  const [prep, setPrep] = useState(restaurant.prep_time_min || 15);
  const [openTime, setOpenTime] = useState('11:00');
  const [closeTime, setCloseTime] = useState('22:00');
  const [brandHex, setBrandHex] = useState(restaurant.brand_accent_hex || '');
  const restaurantSettings = restaurant.settings && typeof restaurant.settings === 'object' ? restaurant.settings : {};
  const [requirePickupGuestName, setRequirePickupGuestName] = useState(
    restaurantSettings.requireGuestNameForPickup ?? restaurantSettings.require_guest_name_for_pickup ?? true
  );
  const [requireContactForUpdates, setRequireContactForUpdates] = useState(
    restaurantSettings.requireContactForUpdates ?? restaurantSettings.require_contact_for_updates ?? false
  );

  useEffect(() => {
    const nextSettings = restaurant.settings && typeof restaurant.settings === 'object' ? restaurant.settings : {};
    setRequirePickupGuestName(nextSettings.requireGuestNameForPickup ?? nextSettings.require_guest_name_for_pickup ?? true);
    setRequireContactForUpdates(nextSettings.requireContactForUpdates ?? nextSettings.require_contact_for_updates ?? false);
  }, [restaurant.id, restaurant.settings]);

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

  return (
    <div className="fd-section">
      <h2>{t('food.merchant.settings')}</h2>
      <p className="fd-card-meta">
        {t('food.merchant.statusLabel')}: <strong>{t(`food.restaurantStatus.${restaurant.status}`)}</strong>
      </p>
      <div className="fd-row" style={{ marginBottom: '1rem' }}>
        {restaurant.status !== 'active' && (
          <button type="button" className="fd-btn" disabled={saving} onClick={() => patch({ status: 'active' })}>
            {t('food.merchant.goLive')}
          </button>
        )}
        {restaurant.status === 'active' && (
          <button type="button" className="fd-btn fd-btn-secondary" disabled={saving} onClick={() => patch({ status: 'paused' })}>
            {t('food.merchant.pause')}
          </button>
        )}
        <button
          type="button"
          className="fd-btn fd-btn-secondary"
          disabled={saving}
          onClick={() => patch({ acceptsOnlineOrders: !restaurant.accepts_online_orders })}
        >
          {restaurant.accepts_online_orders ? t('food.merchant.disableOnline') : t('food.merchant.enableOnline')}
        </button>
        <button
          type="button"
          className="fd-btn fd-btn-secondary"
          disabled={saving}
          onClick={() => patch({ acceptsInStoreOrders: !restaurant.accepts_in_store_orders })}
        >
          {restaurant.accepts_in_store_orders ? t('food.merchant.disableInStore') : t('food.merchant.enableInStore')}
        </button>
      </div>
      <div className="fd-row" style={{ alignItems: 'flex-end' }}>
        <div className="fd-field" style={{ maxWidth: 180 }}>
          <label htmlFor="fd-prep">{t('food.merchant.prepTimeMin')}</label>
          <input id="fd-prep" type="number" min={0} max={240} value={prep} onChange={(e) => setPrep(e.target.value)} />
        </div>
        <button type="button" className="fd-btn fd-btn-sm" disabled={saving} onClick={() => patch({ prepTimeMin: Number(prep) || 15 })}>
          {t('food.common.save')}
        </button>
      </div>

      <h3 style={{ marginTop: '1.5rem' }}>{t('food.merchant.hoursTitle', 'Operating hours')}</h3>
      <div className="fd-row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="fd-field" style={{ maxWidth: 120 }}>
          <label htmlFor="fd-open">{t('food.merchant.openTime', 'Opens')}</label>
          <input id="fd-open" type="time" value={openTime} onChange={(e) => setOpenTime(e.target.value)} />
        </div>
        <div className="fd-field" style={{ maxWidth: 120 }}>
          <label htmlFor="fd-close">{t('food.merchant.closeTime', 'Closes')}</label>
          <input id="fd-close" type="time" value={closeTime} onChange={(e) => setCloseTime(e.target.value)} />
        </div>
        <button
          type="button"
          className="fd-btn fd-btn-sm"
          disabled={saving}
          onClick={() => patch({ operatingHours: defaultWeekdayHours(openTime, closeTime) })}
        >
          {t('food.merchant.saveHours', 'Save hours')}
        </button>
      </div>

      <div className="fd-row" style={{ alignItems: 'flex-end', marginTop: '1rem' }}>
        <div className="fd-field" style={{ maxWidth: 160 }}>
          <label htmlFor="fd-brand">{t('food.merchant.brandAccent', 'Brand accent (#RRGGBB)')}</label>
          <input id="fd-brand" value={brandHex} onChange={(e) => setBrandHex(e.target.value)} placeholder="#FF8800" maxLength={7} />
        </div>
        <button type="button" className="fd-btn fd-btn-sm" disabled={saving} onClick={() => patch({ brandAccentHex: brandHex.trim() || null })}>
          {t('food.common.save')}
        </button>
      </div>

      <div style={{ marginTop: '1.5rem' }}>
        <h3>{t('food.merchant.guestCheckoutTitle', 'Guest checkout')}</h3>
        <p className="fd-card-meta">
          {t('food.merchant.guestCheckoutHint', 'Choose how much information guests must provide before placing an order.')}
        </p>
        <div className="fd-row" style={{ flexWrap: 'wrap', gap: '0.75rem', alignItems: 'stretch' }}>
          <button
            type="button"
            className="fd-btn fd-btn-secondary"
            disabled={saving}
            onClick={() => patch({
              settings: {
                ...restaurantSettings,
                requireGuestNameForPickup: !requirePickupGuestName,
              },
            })}
          >
            {requirePickupGuestName
              ? t('food.merchant.guestCheckoutPickupNameRequired', 'Pickup name required')
              : t('food.merchant.guestCheckoutPickupNameOptional', 'Pickup name optional')}
          </button>
          <button
            type="button"
            className="fd-btn fd-btn-secondary"
            disabled={saving}
            onClick={() => patch({
              settings: {
                ...restaurantSettings,
                requireContactForUpdates: !requireContactForUpdates,
              },
            })}
          >
            {requireContactForUpdates
              ? t('food.merchant.guestCheckoutContactRequired', 'Status updates contact required')
              : t('food.merchant.guestCheckoutContactOptional', 'Status updates contact optional')}
          </button>
        </div>
        <p className="fd-card-meta" style={{ marginTop: '0.75rem' }}>
          {requireContactForUpdates
            ? t('food.merchant.guestCheckoutContactNoteRequired', 'Guests must provide a phone number or email for order updates.')
            : t('food.merchant.guestCheckoutContactNoteOptional', 'Phone and email stay optional unless you turn on status updates.')}
        </p>
      </div>

      <LocationsPanel t={t} restaurant={restaurant} onChanged={onSetupChanged} />

      <PromotionsPanel t={t} restaurant={restaurant} />

      <h3 style={{ marginTop: '1.5rem' }}>{t('food.merchant.inStoreScreens')}</h3>
      <p className="fd-card-meta">{t('food.merchant.inStoreScreensHint')}</p>
      <div className="fd-row">
        <Link to={`/restaurants/kitchen/${restaurant.id}`} className="fd-btn fd-btn-secondary">{t('food.merchant.openKitchen')}</Link>
        <Link to={`/restaurants/queue/${restaurant.id}`} className="fd-btn fd-btn-secondary">{t('food.merchant.openQueue')}</Link>
        <Link to={`/restaurants/kiosk/${restaurant.id}`} className="fd-btn fd-btn-secondary">{t('food.merchant.openKiosk')}</Link>
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
          {t('restaurants.ops.help.desc', 'Hire local helpers through OxSteed Marketplace — repairs, cleaning, equipment, signage, and more.')}
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
        <span className="fd-merchant-landing-eyebrow">{t('food.merchant.landing.eyebrow', 'OxSteed Restaurants')}</span>
        <h2 className="fd-merchant-landing-headline">{t('food.merchant.landing.headline', 'Franchise-grade tools for independent restaurants')}</h2>
        <p className="fd-merchant-landing-sub">{t('food.merchant.landing.sub', 'Go live the same day. Accept orders at the counter, kiosk, kitchen display, and online — all from one shared backend.')}</p>
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

// ── Tab icon map ──────────────────────────────────────────────────────────────
const TAB_ICONS = { orders: '🧾', menu: '🍴', operations: '⚙️', settings: '🔧' };

// ── Page ─────────────────────────────────────────────────────────────────────
export default function FoodMerchantPage() {
  const { t } = useTranslation();
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('orders');
  const [setupKey, setSetupKey] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const load = useCallback(() => {
    listMyFoodRestaurants()
      .then((rows) => {
        setRestaurants(rows);
        setSelectedId((prev) => prev || rows[0]?.id || null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const selected = restaurants.find((r) => r.id === selectedId) || null;

  useEffect(() => {
    if (loading) return;
    if (sessionStorage.getItem('ox.food.onboarding.dismissed') === '1') return;
    if (shouldShowMerchantOnboarding(restaurants, selected)) {
      setShowOnboarding(true);
    }
  }, [loading, restaurants, selected]);

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

  const hasDashboard = restaurants.length > 0 && !showCreate;

  return (
    <PageShell>
      {showOnboarding && (
        <MerchantOnboardingWizard
          t={t}
          restaurants={restaurants}
          selected={selected}
          onClose={() => {
            sessionStorage.setItem('ox.food.onboarding.dismissed', '1');
            setShowOnboarding(false);
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
          {hasDashboard && selected && (
            <div className="fd-merchant-hero-actions">
              <span className={`fd-merchant-status-badge fd-mstatus-${selected.status}`}>
                {t(`food.restaurantStatus.${selected.status}`, selected.status)}
              </span>
              <button
                type="button"
                className="fd-btn fd-btn-secondary fd-btn-sm"
                onClick={() => setShowOnboarding(true)}
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
          /* ── No-restaurant landing / create form ── */
          restaurants.length === 0 && !showCreate ? (
            <MerchantLanding t={t} onStart={() => setShowOnboarding(true)} />
          ) : (
            <>
              {restaurants.length > 0 && (
                <button
                  type="button"
                  className="fd-btn fd-btn-secondary fd-btn-sm"
                  style={{ marginBottom: '1rem' }}
                  onClick={() => setShowCreate(false)}
                >
                  {t('food.common.back')}
                </button>
              )}
              <CreateRestaurantForm
                t={t}
                onCreated={(restaurant) => {
                  setShowCreate(false);
                  setSelectedId(restaurant.id);
                  load();
                }}
              />
            </>
          )
        ) : (
          /* ── Dashboard ── */
          <>
            {/* Restaurant picker bar */}
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
              <button
                type="button"
                className="fd-btn fd-btn-secondary fd-btn-sm"
                onClick={() => setShowCreate(true)}
              >
                + {t('food.merchant.addAnother')}
              </button>
            </div>

            {/* Setup wizard + device checklist */}
            {selected && (
              <SetupWizard
                key={`${selected.id}-${setupKey}`}
                restaurant={selected}
                t={t}
                onGoTab={setTab}
                onStartGuide={() => setShowOnboarding(true)}
              />
            )}
            {selected && selected.status === 'active' && (
              <DeviceSetupChecklist
                restaurant={selected}
                t={t}
                onComplete={() => setSetupKey((k) => k + 1)}
              />
            )}

            {/* Tab navigation */}
            <div className="fd-tabs fd-merchant-tabs" role="tablist">
              {['orders', 'menu', 'operations', 'settings'].map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  className={`fd-tab${tab === key ? ' fd-active' : ''}`}
                  onClick={() => setTab(key)}
                >
                  <span className="fd-tab-icon" aria-hidden="true">{TAB_ICONS[key]}</span>
                  {t(`food.merchant.tab.${key}`)}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {selected && tab === 'orders' && <OrdersTab t={t} restaurant={selected} />}
            {selected && tab === 'menu' && <MenuTab t={t} restaurant={selected} />}
            {selected && tab === 'operations' && <OperationsTab t={t} restaurant={selected} />}
            {selected && tab === 'settings' && (
              <SettingsTab
                t={t}
                restaurant={selected}
                onUpdated={(updated) =>
                  setRestaurants((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
                }
                onSetupChanged={() => setSetupKey((k) => k + 1)}
              />
            )}
          </>
        )}
      </div>
    </PageShell>
  );
}
